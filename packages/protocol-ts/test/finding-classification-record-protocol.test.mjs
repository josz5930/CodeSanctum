// Story 3.2: reviewer classification is a protocol-owned retained review
// artifact, not a scanner field or free-text review-event reason.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-finding-classification-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-finding-classification-test-dist");

const schemaId = "urn:codeattest:protocol:v0:finding-classification-record";

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);
  const generatedSchemas = await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href);

  assert(schemaId in generatedSchemas.protocolV0Schemas, `${schemaId} must be generated`);
  assertNoErrors(protocol, validClassificationRecord());
  await testClassificationInvariantCoverageMarkers();
  await testGeneratedFindingClassificationTypes();
  testClaimSafetyPhraseBoundaries(protocol);
  testSchemaEnforceableShapes(protocol);
  await testInvalidClassificationFixturesGeneratedMatcher(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts finding classification record tests passed.");

function validClassificationRecord() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    classification_record_id: "classification_record:synthetic-demo-likely-001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification: "likely",
    classified_at: "2026-07-22T00:00:00Z",
    actor: {
      actor_type: "reviewer",
      actor_id: "reviewer:synthetic-amelia"
    },
    evidence_basis: ["scanner_output", "finding_context_snippet", "retained_review_artifact"],
    review_finding_draft_evidence_refs: [
      {
        artifact_ref: "artifact_ref:scanner_finding_set",
        availability_state: "retained_review_artifact",
        available_for_review: true,
        display_state: "available_reference",
        source_derived_class: "retained_review_artifact"
      },
      {
        artifact_ref: "artifact_ref:synthetic_raw_snippet",
        availability_state: "retained_review_artifact",
        available_for_review: true,
        display_state: "available_reference",
        source_derived_class: "transient_source_derived"
      }
    ],
    confirmation_criteria: [],
    threshold_gaps: ["SYNTHETIC_DEMO_DATA bounded snippet context needs expert review before confirmation."],
    limitations: ["SYNTHETIC_DEMO_DATA classification keeps scanner provenance separate from expert judgment."],
    rationale: "SYNTHETIC_DEMO_DATA reviewer records a likely finding pending broader context.",
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

async function testClassificationInvariantCoverageMarkers() {
  const inventory = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "invariants.json"), "utf8"));
  const byId = new Map((inventory.invariants ?? []).map((invariant) => [invariant.id, invariant]));

  assertInvariantCoverage(byId, "finding-classification-confirmed-guardrails", {
    required: [
      "finding-classification-record.schema.json confirmation_criteria minItems",
      "FindingClassificationRecord conditional confirmation_criteria binding",
      "finding-classification-record-protocol.test.mjs generated type guard"
    ]
  });

  assertInvariantCoverage(byId, "finding-classification-validation-path-required", {
    required: [
      "validateFindingClassificationRecordSemantics",
      "buildFindingClassificationEvent",
      "finding-classification-record.validation-required-without-path.json",
      "finding-classification-record-protocol.test.mjs validation path cases",
      "finding-classification-convergence.test.mjs validation path fixture convergence"
    ],
    forbidden: ["ClassificationBadge", "ReviewerClassificationWorkbench"]
  });

  assertInvariantCoverage(byId, "finding-classification-text-source-safety", {
    required: [
      "validateFindingClassificationRecordSemantics",
      "finding-classification-record.raw-source-in-rationale.json",
      "finding-classification-record.claim-unsafe-validation-path-ref.json",
      "finding-classification-convergence.test.mjs text safety fixture convergence",
      "finding-classification.test.mjs forbidden text cases"
    ],
    forbidden: ["classification-workbench.test.mjs no forbidden copy cases"]
  });

  assert(!byId.has("finding-classification-reviewer-only-taxonomy"), "reviewer-only actor and allowed taxonomy must not be packed under one invariant id");
  assertInvariantCoverage(byId, "finding-classification-allowed-taxonomy", {
    required: [
      "validateFindingClassificationRecordSemantics",
      "finding-classification-record.disallowed-classification.json",
      "finding-classification-record-protocol.test.mjs taxonomy cases",
      "finding-classification-convergence.test.mjs taxonomy fixture convergence"
    ]
  });
  assertInvariantCoverage(byId, "finding-classification-reviewer-only-actor-authority", {
    required: [
      "validateFindingClassificationRecordSemantics",
      "validateReviewEventSemantics",
      "buildFindingClassificationEvent",
      "appendReviewEvent",
      "finding-classification-record.customer-authored.json",
      "review-event-log.customer-classification-actor.json",
      "finding-classification-convergence.test.mjs actor fixture convergence",
      "review-event-convergence.test.mjs classification actor fixture convergence",
      "finding-classification.test.mjs reviewer-only authority cases"
    ]
  });
}

function assertInvariantCoverage(byId, invariantId, { required, forbidden = [] }) {
  const invariant = byId.get(invariantId);
  assert(invariant !== undefined, `${invariantId} must be registered in invariants.json`);
  const coverage = invariant.javascript_coverage ?? [];
  for (const marker of required) {
    assert(coverage.includes(marker), `${invariantId} must list ${marker} as JavaScript coverage`);
  }
  for (const marker of forbidden) {
    assert(!coverage.includes(marker), `${invariantId} must not overclaim ${marker} as JavaScript coverage`);
  }
}

async function testGeneratedFindingClassificationTypes() {
  const generatedTypeSource = await readFile(path.join(repoRoot, "packages", "protocol-ts", "src", "generated", "protocol-v0.ts"), "utf8");
  const generatedSchemaSource = await readFile(path.join(repoRoot, "packages", "protocol-ts", "src", "generated", "protocol-v0-schemas.ts"), "utf8");

  assert(
    generatedTypeSource.includes("export type NonEmptyArray<T> = [T, ...T[]];"),
    "generated bindings must include a non-empty array helper for minItems: 1 arrays"
  );
  assert(
    /confirmation_criteria: Array<NonEmptyString>;/.test(generatedTypeSource),
    "FindingClassificationRecord confirmation_criteria must allow schema-valid empty arrays for non-confirmed classifications"
  );
  assert(
    /review_finding_draft_evidence_refs: NonEmptyArray<\{/.test(generatedTypeSource),
    "FindingClassificationRecord draft evidence refs must preserve minItems: 1 as a non-empty array binding"
  );
  const generatedSchema = (await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href)).protocolV0Schemas[schemaId];
  const confirmedCriteriaGuard = generatedSchema.allOf?.some((entry) =>
    entry.if?.properties?.classification?.const === "confirmed" &&
    entry.then?.properties?.confirmation_criteria?.minItems === 1
  );
  assert(confirmedCriteriaGuard === true, "generated schema binding must preserve confirmed confirmation_criteria minItems guard");
}

function testClaimSafetyPhraseBoundaries(protocol) {
  const ordinaryReviewerProse = {
    ...validClassificationRecord(),
    rationale: "SYNTHETIC_DEMO_DATA customer submitted metadata and reviewer received attestation context from a certified training fixture."
  };
  assertNoErrors(protocol, ordinaryReviewerProse);
}

function testSchemaEnforceableShapes(protocol) {
  const base = validClassificationRecord();
  assertErrorCode(protocol, { ...base, classification: "false_positive" }, "enum");
  assertErrorCode(protocol, { ...base, classification_record_id: "finding:demo" }, "pattern");
  assertErrorCode(protocol, { ...base, review_finding_draft_ref: "candidate_finding:demo" }, "pattern");
  assertErrorCode(protocol, { ...base, classified_at: "2026-07-22T00:00:00-00:00" }, "pattern");
  assertErrorCode(protocol, { ...base, actor: { actor_type: "customer_user", actor_id: "customer:demo" } }, "const");
  assertErrorCode(protocol, { ...base, evidence_basis: [] }, "min_items");
  assertErrorCode(protocol, { ...base, classification: "confirmed", confirmation_criteria: [] }, "min_items");
  assertErrorCode(protocol, { ...base, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, { ...base, visibility: "public" }, "enum");
  assertErrorCode(protocol, { ...base, classificationRecordId: base.classification_record_id }, "additional_property");
}

async function testInvalidClassificationFixturesGeneratedMatcher(protocol) {
  const fixtureIndex = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "fixture-index.json"), "utf8"));
  const fixtures = (fixtureIndex.negative_fixtures ?? []).filter((entry) => entry.schema === schemaId);
  assert(fixtures.length > 0, "invalid finding-classification fixtures must be registered");
  let schemaRejected = 0;
  for (const entry of fixtures) {
    const fixture = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", entry.path), "utf8"));
    const errors = protocol.validateProtocolSchema(schemaId, fixture);
    if (errors.length > 0) {
      schemaRejected += 1;
    }
  }
  assert(schemaRejected > 0, "generated schema matcher must reject schema-invalid classification fixtures, not leave all invalid coverage to semantic gates");
}

function assertNoErrors(protocol, value) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.length === 0, `${schemaId} rejected a structurally valid value: ${JSON.stringify(errors)}`);
}

function assertErrorCode(protocol, value, expectedCode) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(
    errors.some((error) => error.code === expectedCode),
    `${schemaId} must report ${expectedCode}; got ${JSON.stringify(errors)}`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
