import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { reviewEventIdentity } from "./lib/protocol-utils.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const schemaRoot = path.join(projectRoot, "protocol/schemas");
const fixtureRoot = path.join(projectRoot, "protocol/fixtures");
const v0Root = path.join(fixtureRoot, "v0");
const indexPath = path.join(v0Root, "fixture-index.json");
const manifestPath = path.join(fixtureRoot, "canonical-manifest.json");

const index = await readJson(indexPath);
const manifest = await readJson(manifestPath);
const schemaFiles = (await readdir(schemaRoot)).filter((file) => file.endsWith(".schema.json"));
const schemas = await Promise.all(schemaFiles.map((file) => readJson(path.join(schemaRoot, file))));
const schemaById = new Map(schemas.map((schema) => [schema.$id, schema]));
const newFixturePaths = new Set();

await generateCalendarNegatives();
await generateEnumNegatives();
await generateLiveEnumFixtures();
await generateVerificationEvidenceChains();

await writeJson(indexPath, index);
newFixturePaths.add("v0/fixture-index.json");
await updateManifest();
await writeJson(manifestPath, manifest);

console.log(`Generated or refreshed ${newFixturePaths.size - 1} C1 Phase 5 fixtures.`);

async function generateCalendarNegatives() {
  const coveredSchemas = new Set(
    index.negative_fixtures
      .filter((entry) => entry.expected_failure === "utc_rfc3339_timestamp")
      .map((entry) => entry.schema)
  );
  const invalidTimestamps = [
    "2026-02-30T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2027-02-29T00:00:00Z"
  ];
  let timestampIndex = 0;

  for (const schema of schemas) {
    if (schema.$id?.endsWith(":shared-definitions") || coveredSchemas.has(schema.$id)) continue;
    const timestampPath = findSchemaPath(schema, (node) => node.$ref?.endsWith("#/$defs/utc_rfc3339_timestamp"));
    if (timestampPath === undefined) continue;

    const schemaName = schemaNameFromId(schema.$id);
    const relativePath = `v0/invalid/${schemaName}.invalid-calendar-timestamp-c1-08.json`;
    const fixture = focusedObjectFixture(
      timestampPath,
      invalidTimestamps[timestampIndex % invalidTimestamps.length]
    );
    timestampIndex += 1;
    await writeFixture(relativePath, fixture);
    upsertIndexEntry("negative_fixtures", {
      path: relativePath,
      schema: schema.$id,
      source_safety: "synthetic_non_customer",
      expected_failure: "utc_rfc3339_timestamp"
    });
  }
}

async function generateEnumNegatives() {
  const coveredSchemas = new Set(
    index.negative_fixtures
      .filter((entry) => entry.path.includes("invalid-enum"))
      .map((entry) => entry.schema)
  );

  for (const schema of schemas) {
    if (schema.$id?.endsWith(":shared-definitions") || coveredSchemas.has(schema.$id)) continue;
    const enumPath = findSchemaPath(schema, (node) => Array.isArray(node.enum));
    if (enumPath === undefined) continue;

    const schemaName = schemaNameFromId(schema.$id);
    const relativePath = `v0/invalid/${schemaName}.invalid-enum-value-c1-09.json`;
    const invalidValue = enumPath.length === 0
      ? "invalid_enum_value_SYNTHETIC_DEMO_DATA_NOT_CUSTOMER_SOURCE"
      : "invalid_enum_value";
    const fixture = enumPath.length === 0
      ? invalidValue
      : focusedObjectFixture(enumPath, invalidValue);
    await writeFixture(relativePath, fixture);
    upsertIndexEntry("negative_fixtures", {
      path: relativePath,
      schema: schema.$id,
      source_safety: "synthetic_non_customer",
      expected_failure: "invalid_enum_value"
    });
  }

  // These semantic validators intentionally recognize partially populated
  // records. Use a complete valid fixture so the enum is the only invalid
  // behavior under test rather than accepting unrelated semantic omissions.
  for (const [schemaName, propertyName] of [
    ["customer-remediation-status-record", "visibility"],
    ["finding-classification-record", "visibility"],
    ["finding-remediation-guidance", "visibility"],
    ["reviewer-validation-script", "visibility"]
  ]) {
    const schema = schemaById.get(schemaId(schemaName));
    const sourceEntry = index.valid_fixtures.find((entry) => entry.schema === schema.$id);
    const fixture = await readJson(path.join(fixtureRoot, sourceEntry.path));
    fixture[propertyName] = "invalid_enum_value";
    const relativePath = `v0/invalid/${schemaName}.invalid-enum-value-c1-09.json`;
    await writeFixture(relativePath, fixture);
    upsertIndexEntry("negative_fixtures", {
      path: relativePath,
      schema: schema.$id,
      source_safety: "synthetic_non_customer",
      expected_failure: "invalid_enum_value"
    });
  }

  const signingSchema = schemaById.get(schemaId("identity-signing-input"));
  const signingSource = index.valid_fixtures.find((entry) => entry.schema === signingSchema.$id);
  const signingFixture = await readJson(path.join(fixtureRoot, signingSource.path));
  signingFixture.signing_input_type = "invalid_enum_value";
  const signingPath = "v0/invalid/identity-signing-input.invalid-enum-value-c1-09.json";
  await writeFixture(signingPath, signingFixture);
  upsertIndexEntry("negative_fixtures", {
    path: signingPath,
    schema: signingSchema.$id,
    source_safety: "synthetic_non_customer",
    expected_failure: "invalid_identity_signing_input_type"
  });
}

async function generateLiveEnumFixtures() {
  const localAttemptTemplate = await readJson(path.join(v0Root, "valid/local-runner-attempt.pre-approval-failure.json"));
  for (const stage of ["scope_init", "scan_run", "disclosure_configure", "bundle_signing", "status_inspect"]) {
    const fixture = structuredClone(localAttemptTemplate);
    fixture.attempt_id = `runner_attempt:enum_${stage}`;
    fixture.stage = stage;
    fixture.diagnostics.stage_failed = stage;
    fixture.diagnostics.message = `SYNTHETIC_DEMO_DATA ${stage} failed in enum coverage. NOT_CUSTOMER_SOURCE.`;
    fixture.diagnostics.support_summary = `Inspect the synthetic ${stage} inputs and retry.`;
    const relativePath = `v0/valid/local-runner-attempt.stage-${stage.replaceAll("_", "-")}.json`;
    await writeFixture(relativePath, fixture);
    upsertIndexEntry("valid_fixtures", validEntry(relativePath, "local-runner-attempt"));
  }

  const storedObjectTemplate = await readJson(path.join(v0Root, "valid/stored-object-classification.evidence-artifact.json"));
  for (const objectKind of ["queue_payload", "worker_scratch", "generated_export", "support_attachment", "analytics_record", "crash_report"]) {
    const fixture = structuredClone(storedObjectTemplate);
    fixture.stored_object_ref = `stored_object:synthetic_enum_${objectKind}`;
    fixture.object_kind = objectKind;
    delete fixture.artifact_ref;
    if (["support_attachment", "analytics_record", "crash_report"].includes(objectKind)) {
      fixture.source_derived_class = "never_collected";
    }
    const relativePath = `v0/valid/stored-object-classification.${objectKind.replaceAll("_", "-")}.json`;
    await writeFixture(relativePath, fixture);
    upsertIndexEntry("valid_fixtures", validEntry(relativePath, "stored-object-classification"));
  }

  const environmentTemplate = await readJson(path.join(v0Root, "valid/environment-evidence-gate.synthetic-demo.json"));
  const candidateEnvironment = structuredClone(environmentTemplate);
  candidateEnvironment.environment_profile = "partner_pilot_candidate";
  candidateEnvironment.evidence_boundary = "partner-pilot-candidate-metadata-only";
  candidateEnvironment.notes = [
    "Partner pilot candidate mode rejects real Raw Snippets and real targeted files.",
    "This candidate profile requires a separate readiness decision before accepting source-derived evidence."
  ];
  const environmentPath = "v0/valid/environment-evidence-gate.partner-pilot-candidate.json";
  await writeFixture(environmentPath, candidateEnvironment);
  upsertIndexEntry("valid_fixtures", validEntry(environmentPath, "environment-evidence-gate"));

  const eventLogPath = "v0/valid/review-event-log.enum-live-values.json";
  await writeFixture(eventLogPath, buildLiveEnumEventLog());
  upsertIndexEntry("valid_fixtures", validEntry(eventLogPath, "review-event-log"));
}

async function generateVerificationEvidenceChains() {
  const scopeTemplate = await readJson(path.join(v0Root, "valid/verification-pass-scope.outcome-eligible-with-formal-path.json"));
  const evidenceTemplate = await readJson(path.join(v0Root, "valid/verification-evidence-record.manual-validation.json"));
  const variants = [
    {
      type: "customer_validation_evidence",
      slug: "customer-validation-evidence",
      passId: "verification_pass:synthetic_customer_validation_evidence_001",
      recordId: "verification_evidence:synthetic_customer_validation_evidence_001",
      artifactRef: "artifact_ref:synthetic_customer_validation_evidence_001",
      digestDigit: "9"
    },
    {
      type: "remote_dynamic_testing_evidence",
      slug: "remote-dynamic-testing-evidence",
      passId: "verification_pass:synthetic_remote_dynamic_testing_001",
      recordId: "verification_evidence:synthetic_remote_dynamic_testing_001",
      artifactRef: "artifact_ref:synthetic_remote_dynamic_testing_001",
      digestDigit: "a"
    }
  ];

  for (const variant of variants) {
    const scope = structuredClone(scopeTemplate);
    scope.verification_pass_id = variant.passId;
    scope.selected_findings[0].requested_verification_type = variant.type;
    scope.selected_findings[0].eligibility_reason = `SYNTHETIC_DEMO_DATA customer selected ${variant.type} for bounded verification. NOT_CUSTOMER_SOURCE.`;
    scope.selected_findings[0].limitations = [
      `SYNTHETIC_DEMO_DATA ${variant.type} remains bounded to the selected finding and validation path. NOT_CUSTOMER_SOURCE.`
    ];
    const scopePath = `v0/valid/verification-pass-scope.${variant.slug}.json`;
    await writeFixture(scopePath, scope);
    upsertIndexEntry("valid_fixtures", validEntry(scopePath, "verification-pass-scope"));

    const evidence = structuredClone(evidenceTemplate);
    evidence.verification_evidence_record_id = variant.recordId;
    evidence.verification_pass_id = variant.passId;
    evidence.verification_pass_ref = variant.passId;
    evidence.requested_verification_type = variant.type;
    evidence.state_reason = `SYNTHETIC_DEMO_DATA ${variant.type} is ready for bounded reviewer evaluation. NOT_CUSTOMER_SOURCE.`;
    evidence.validation_artifacts[0].artifact_ref = variant.artifactRef;
    evidence.validation_artifacts[0].digest = `sha256:${variant.digestDigit.repeat(64)}`;
    evidence.limitations = [
      `SYNTHETIC_DEMO_DATA ${variant.type} evidence remains bounded to the selected validation path. NOT_CUSTOMER_SOURCE.`
    ];
    const evidencePath = `v0/valid/verification-evidence-record.${variant.slug}.json`;
    await writeFixture(evidencePath, evidence);
    upsertIndexEntry("valid_fixtures", validEntry(evidencePath, "verification-evidence-record"));

    const missingArtifacts = structuredClone(evidence);
    delete missingArtifacts.validation_artifacts;
    const negativePath = `v0/invalid/verification-evidence-record.${variant.slug}-missing-artifacts.json`;
    await writeFixture(negativePath, missingArtifacts);
    upsertIndexEntry("negative_fixtures", {
      path: negativePath,
      schema: schemaId("verification-evidence-record"),
      source_safety: "synthetic_non_customer",
      expected_failure: "verification_evidence_validation_context_invalid"
    });
  }
}

function buildLiveEnumEventLog() {
  const reviewId = "review:synthetic-demo-001";
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const hashC = "c".repeat(64);
  const hashD = "d".repeat(64);
  const hashE = "e".repeat(64);
  const hashF = "f".repeat(64);
  const specifications = [
    ["validation_recorded", "reviewer", `validation_path:${reviewId}:validation_path:synthetic_enum_validation_001`, "artifact_ref:synthetic_enum_validation_001"],
    ["false_positive_recorded", "reviewer", `false_positive:${reviewId}:false_positive:synthetic_enum_001`, "artifact_ref:synthetic_enum_001"],
    ["customer_accepted_risk_recorded", "customer_user", `accepted_risk:${reviewId}:accepted_risk:synthetic_enum_001`, "artifact_ref:synthetic_enum_001"],
    ["attestation_generated", "vendor_service", `attestation:${reviewId}:attestation:${hashA}:attestation_version:1`, `artifact_ref:${hashA}`],
    ["static_bundle_generated", "vendor_service", `static_bundle:${reviewId}:static_bundle:synthetic_enum_001:manifest_version:1:manifest_id:${hashB}`, `sha256:${hashB}`],
    ["attestation_package_finalized", "customer_user", `attestation_package_finalized:${reviewId}:static_bundle:synthetic_enum_001:finalization_version:1:record_id:${hashC}:generated_manifest_id:${hashD}:manifest_id:${hashE}`, `sha256:${hashE}`],
    ["attestation_package_exported", "customer_user", `attestation_package_exported:${reviewId}:static_bundle:synthetic_enum_002:finalization_version:1:record_id:${hashD}:generated_manifest_id:${hashE}:manifest_id:${hashF}`, `sha256:${hashF}`],
    ["pilot_metric_recorded", "vendor_service", `pilot_metric:${reviewId}:pilot_metric:synthetic_enum_001:record_version:1:content_id:${hashA}`, `sha256:${hashA}`],
    ["pilot_feedback_recorded", "reviewer", `pilot_feedback:${reviewId}:pilot_feedback:synthetic_enum_001:record_version:1:content_id:${hashB}`, `sha256:${hashB}`]
  ];
  const events = specifications.map(([eventType, actorType, idempotencyKey, artifactRef], indexValue) => {
    const internalLearning = eventType.startsWith("pilot_");
    const event = {
      protocol_version: "codeattest.v0",
      event_id: "sha256:" + "0".repeat(64),
      review_id: reviewId,
      sequence_number: 100 + indexValue,
      idempotency_key: idempotencyKey,
      event_type: eventType,
      actor: {
        actor_type: actorType,
        actor_id: `${actorType}:SYNTHETIC_DEMO_DATA-enum-coverage-NOT_CUSTOMER_SOURCE`
      },
      event_timestamp: `2026-08-01T00:00:0${indexValue}Z`,
      artifact_refs: [artifactRef],
      visibility: internalLearning ? "internal_only" : "customer_facing",
      canonicalization: "rfc8785",
      identity_hash_algorithm: "sha256",
      identity_input_excludes: ["event_id"]
    };
    if (!internalLearning) {
      event.reason = eventType === "customer_accepted_risk_recorded"
        ? "Accepted risk recorded for synthetic enum coverage. Customer rationale: SYNTHETIC_DEMO_DATA bounded test rationale NOT_CUSTOMER_SOURCE"
        : `SYNTHETIC_DEMO_DATA ${eventType} enum coverage record. NOT_CUSTOMER_SOURCE.`;
    }
    event.event_id = reviewEventIdentity(event);
    return event;
  });
  return { protocol_version: "codeattest.v0", review_id: reviewId, events };
}

function focusedObjectFixture(schemaPath, value) {
  const fixture = {
    protocol_version: "codeattest.v0",
    fixture_markers: ["SYNTHETIC_DEMO_DATA", "NOT_CUSTOMER_SOURCE"]
  };
  setAtSchemaPath(fixture, schemaPath, value);
  return fixture;
}

function findSchemaPath(root, predicate) {
  const candidates = [];
  visit(root, [], new Set());
  candidates.sort((left, right) => left.length - right.length || left.join(".").localeCompare(right.join(".")));
  return candidates[0];

  function visit(node, currentPath, seenRefs) {
    if (!node || typeof node !== "object") return;
    if (predicate(node)) candidates.push(currentPath);
    if (typeof node.$ref === "string") {
      const target = resolveSchemaRef(node.$ref);
      const key = `${node.$ref}@${currentPath.join(".")}`;
      if (target !== undefined && !seenRefs.has(key)) {
        const nextSeen = new Set(seenRefs);
        nextSeen.add(key);
        visit(target, currentPath, nextSeen);
      }
      return;
    }
    for (const [propertyName, propertySchema] of Object.entries(node.properties ?? {})) {
      visit(propertySchema, [...currentPath, propertyName], seenRefs);
    }
    if (node.items !== undefined) visit(node.items, [...currentPath, "[]"], seenRefs);
    for (const keyword of ["oneOf", "anyOf"]) {
      for (const child of node[keyword] ?? []) visit(child, currentPath, seenRefs);
    }
  }
}

function resolveSchemaRef(reference) {
  const [schemaReference, fragment = ""] = reference.split("#");
  let value = schemaById.get(schemaReference);
  if (value === undefined) return undefined;
  for (const rawPart of fragment.replace(/^\//u, "").split("/").filter(Boolean)) {
    value = value?.[rawPart.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return value;
}

function setAtSchemaPath(root, schemaPath, value) {
  let cursor = root;
  for (let indexValue = 0; indexValue < schemaPath.length; indexValue += 1) {
    const part = schemaPath[indexValue];
    const isLast = indexValue === schemaPath.length - 1;
    if (part === "[]") {
      if (!Array.isArray(cursor)) throw new Error(`Cannot set array path ${schemaPath.join(".")}`);
      if (isLast) cursor.push(value);
      else {
        const next = schemaPath[indexValue + 1] === "[]" ? [] : {};
        cursor.push(next);
        cursor = next;
      }
      continue;
    }
    if (isLast) cursor[part] = value;
    else {
      cursor[part] = schemaPath[indexValue + 1] === "[]" ? [] : {};
      cursor = cursor[part];
    }
  }
}

function validEntry(relativePath, schemaName) {
  return {
    path: relativePath,
    schema: schemaId(schemaName),
    source_safety: "synthetic_non_customer"
  };
}

function schemaId(schemaName) {
  return `urn:codeattest:protocol:v0:${schemaName}`;
}

function schemaNameFromId(id) {
  return id.slice(id.lastIndexOf(":") + 1);
}

function upsertIndexEntry(collectionName, entry) {
  const collection = index[collectionName];
  const existingIndex = collection.findIndex((candidate) => candidate.path === entry.path);
  if (existingIndex === -1) collection.push(entry);
  else collection[existingIndex] = entry;
}

async function writeFixture(relativePath, value) {
  await writeJson(path.join(fixtureRoot, relativePath), value);
  newFixturePaths.add(relativePath);
}

async function updateManifest() {
  for (const relativePath of newFixturePaths) {
    const content = await readFile(path.join(fixtureRoot, relativePath));
    const text = content.toString("utf8");
    const entry = {
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex"),
      synthetic: text.includes("SYNTHETIC_DEMO_DATA") && text.includes("NOT_CUSTOMER_SOURCE")
    };
    if (!entry.synthetic && relativePath !== "v0/fixture-index.json") {
      entry.nonSyntheticReason = "Structured protocol JSON fixture uses fixed synthetic identifiers and enum values; its additionalProperties:false schema provides no marker-text field, so safety is declared in the fixture index.";
    }
    const existingIndex = manifest.files.findIndex((candidate) => candidate.path === relativePath);
    if (existingIndex === -1) manifest.files.push(entry);
    else manifest.files[existingIndex] = entry;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
