import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const schemaRoot = path.join(projectRoot, "protocol/schemas");
const fixtureRoot = path.join(projectRoot, "protocol/fixtures");
const index = await readJson(path.join(fixtureRoot, "v0/fixture-index.json"));
const schemaFiles = (await readdir(schemaRoot)).filter((file) => file.endsWith(".schema.json"));
const schemas = await Promise.all(schemaFiles.map((file) => readJson(path.join(schemaRoot, file))));
const schemaById = new Map(schemas.map((schema) => [schema.$id, schema]));
const artifactSchemas = schemas.filter((schema) => !schema.$id?.endsWith(":shared-definitions"));
const errors = [];

const calendarNegativeSchemas = new Set(
  index.negative_fixtures
    .filter((entry) => entry.expected_failure === "utc_rfc3339_timestamp")
    .map((entry) => entry.schema)
);
for (const schema of artifactSchemas.filter((candidate) => hasTimestamp(candidate))) {
  expect(calendarNegativeSchemas.has(schema.$id), `${schema.$id} lacks a utc_rfc3339_timestamp negative fixture`);
}

const enumNegativeSchemas = new Set(
  index.negative_fixtures
    .filter((entry) => entry.path.includes("invalid-enum"))
    .map((entry) => entry.schema)
);
for (const schema of artifactSchemas.filter((candidate) => hasEnum(candidate))) {
  expect(enumNegativeSchemas.has(schema.$id), `${schema.$id} lacks an invalid-enum negative fixture`);
}

const validFixtures = await Promise.all(
  index.valid_fixtures.map(async (entry) => ({
    entry,
    value: await readJson(path.join(fixtureRoot, entry.path))
  }))
);

expectValues(
  "local-runner-attempt.stage",
  valuesForSchema("local-runner-attempt", (value) => [value.stage]),
  ["scope_init", "scan_run", "disclosure_configure", "manifest_preview", "approval", "bundle_signing", "bundle_prepare", "bundle_packaging", "status_inspect", "runner_trust"]
);
expectValues(
  "stored-object-classification.object_kind",
  valuesForSchema("stored-object-classification", (value) => [value.object_kind]),
  ["evidence_artifact", "queue_payload", "worker_scratch", "generated_export", "support_attachment", "log_or_trace", "analytics_record", "crash_report"]
);
expectValues(
  "environment-evidence-gate.environment_profile",
  valuesForSchema("environment-evidence-gate", (value) => [value.environment_profile]),
  ["synthetic_demo", "partner_pilot_candidate", "partner_pilot_real_snippet_ready"]
);

const liveReviewEventTypes = [
  "receipt_issued",
  "submission_rejected",
  "submission_quarantined",
  "classification_recorded",
  "remediation_guidance_recorded",
  "validation_recorded",
  "verification_scope_recorded",
  "verification_evidence_recorded",
  "verification_recorded",
  "customer_remediation_recorded",
  "false_positive_recorded",
  "customer_accepted_risk_recorded",
  "attestation_generated",
  "static_bundle_generated",
  "attestation_package_finalized",
  "attestation_package_exported",
  "pilot_metric_recorded",
  "pilot_feedback_recorded",
  "evidence_deleted",
  "retention_status_changed",
  "evidence_accessed"
];
const seenReviewEventTypes = new Set();
for (const fixture of validFixtures) collectPropertyValues(fixture.value, "event_type", seenReviewEventTypes);
expectValues("review-event.event_type", seenReviewEventTypes, liveReviewEventTypes);

const evidenceTypes = ["customer_validation_evidence", "remote_dynamic_testing_evidence"];
expectValues(
  "verification-pass-scope.selected_findings.requested_verification_type",
  valuesForSchema("verification-pass-scope", (value) => value.selected_findings?.map((finding) => finding.requested_verification_type) ?? []),
  evidenceTypes
);
expectValues(
  "verification-evidence-record.requested_verification_type",
  valuesForSchema("verification-evidence-record", (value) => [value.requested_verification_type]),
  evidenceTypes
);
for (const evidenceType of evidenceTypes) {
  const slug = evidenceType.replaceAll("_", "-");
  expect(
    index.negative_fixtures.some((entry) => entry.path === `v0/invalid/verification-evidence-record.${slug}-missing-artifacts.json`),
    `${evidenceType} lacks a missing-validation-artifacts negative fixture`
  );
}

if (errors.length > 0) {
  console.error("Fixture coverage check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Fixture coverage check passed: calendar, enum, and verification-evidence branches are registered and exercised.");

function valuesForSchema(schemaName, selectValues) {
  const schema = `urn:codeattest:protocol:v0:${schemaName}`;
  return new Set(
    validFixtures
      .filter((fixture) => fixture.entry.schema === schema)
      .flatMap((fixture) => selectValues(fixture.value))
      .filter((value) => value !== undefined)
  );
}

function expectValues(label, actualValues, expectedValues) {
  for (const expectedValue of expectedValues) {
    expect(actualValues.has(expectedValue), `${label} lacks valid fixture coverage for ${expectedValue}`);
  }
}

function collectPropertyValues(value, propertyName, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectPropertyValues(item, propertyName, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value[propertyName] === "string") output.add(value[propertyName]);
  for (const child of Object.values(value)) collectPropertyValues(child, propertyName, output);
}

function hasEnum(value, seenReferences = new Set()) {
  if (Array.isArray(value)) return value.some((item) => hasEnum(item, seenReferences));
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value.enum)) return true;
  if (typeof value.$ref === "string") {
    if (seenReferences.has(value.$ref)) return false;
    const nextSeen = new Set(seenReferences);
    nextSeen.add(value.$ref);
    return hasEnum(resolveSchemaRef(value.$ref), nextSeen);
  }
  return Object.values(value).some((child) => hasEnum(child, seenReferences));
}

function hasTimestamp(value, seenReferences = new Set()) {
  if (Array.isArray(value)) return value.some((item) => hasTimestamp(item, seenReferences));
  if (!value || typeof value !== "object") return false;
  if (typeof value.$ref === "string") {
    if (value.$ref.endsWith("#/$defs/utc_rfc3339_timestamp")) return true;
    if (seenReferences.has(value.$ref)) return false;
    const nextSeen = new Set(seenReferences);
    nextSeen.add(value.$ref);
    return hasTimestamp(resolveSchemaRef(value.$ref), nextSeen);
  }
  return Object.values(value).some((child) => hasTimestamp(child, seenReferences));
}

function resolveSchemaRef(reference) {
  const [schemaReference, fragment = ""] = reference.split("#");
  let value = schemaById.get(schemaReference);
  for (const rawPart of fragment.replace(/^\//u, "").split("/").filter(Boolean)) {
    value = value?.[rawPart.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return value;
}

function expect(condition, message) {
  if (!condition) errors.push(message);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
