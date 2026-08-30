// Story 3.5: false-positive and accepted-risk records are protocol-owned
// retained review artifacts, not classification or customer-remediation statuses.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-outcome-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-outcome-test-dist");
const falsePositiveSchemaId = "urn:codeattest:protocol:v0:false-positive-record";
const acceptedRiskSchemaId = "urn:codeattest:protocol:v0:accepted-risk-record";

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);
  const generatedSchemas = await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href);
  assert(falsePositiveSchemaId in generatedSchemas.protocolV0Schemas, "false-positive schema must be generated");
  assert(acceptedRiskSchemaId in generatedSchemas.protocolV0Schemas, "accepted-risk schema must be generated");

  assertNoErrors(protocol, falsePositiveSchemaId, await readValid("false-positive-record.reviewer.json"));
  assertNoErrors(protocol, acceptedRiskSchemaId, await readValid("accepted-risk-record.customer-rationale.json"));
  assertNoErrors(protocol, acceptedRiskSchemaId, await readValid("accepted-risk-record.vendor-signoff.json"));
  assertNoErrors(protocol, "urn:codeattest:protocol:v0:customer-facing-finding-record", await readValid("customer-facing-finding-record.false-positive-outcome.json"));
  assertNoErrors(protocol, "urn:codeattest:protocol:v0:customer-facing-finding-record", await readValid("customer-facing-finding-record.accepted-risk-outcome.json"));
  assertSchemaShapes(protocol);
  assertBoundaryTaxonomiesStaySeparate(protocol);
  assertOutcomeSharedClaimSafety(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts outcome record tests passed.");

function assertSchemaShapes(protocol) {
  const fp = validFalsePositive();
  const missingRationale = { ...fp };
  delete missingRationale.rationale;
  assertErrorCode(protocol, falsePositiveSchemaId, missingRationale, "required");
  assertErrorCode(protocol, falsePositiveSchemaId, { ...fp, false_positive_record_id: "fp:demo" }, "pattern");
  assertErrorCode(protocol, falsePositiveSchemaId, { ...fp, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, "const");
  assertErrorCode(protocol, falsePositiveSchemaId, { ...fp, falsePositiveRecordId: fp.false_positive_record_id }, "additional_property");

  const ar = validAcceptedRisk();
  const missingLimitations = { ...ar };
  delete missingLimitations.limitations;
  assertErrorCode(protocol, acceptedRiskSchemaId, missingLimitations, "required");
  assertErrorCode(protocol, acceptedRiskSchemaId, { ...ar, accepted_risk_record_id: "risk:demo" }, "pattern");
  assertErrorCode(protocol, acceptedRiskSchemaId, { ...ar, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, acceptedRiskSchemaId, { ...ar, customerRationale: ar.customer_rationale }, "additional_property");
}

function assertBoundaryTaxonomiesStaySeparate(protocol) {
  const classification = {
    ...validClassification(),
    classification: "false_positive"
  };
  assertErrorCode(protocol, "urn:codeattest:protocol:v0:finding-classification-record", classification, "enum");
  const customerStatus = {
    ...validCustomerStatus(),
    customer_remediation_status: "accepted_risk"
  };
  assertErrorCode(protocol, "urn:codeattest:protocol:v0:customer-remediation-status-record", customerStatus, "enum");
}


function assertOutcomeSharedClaimSafety(protocol) {
  assert(protocol.claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA deployment is certified for demo. NOT_CUSTOMER_SOURCE.") !== undefined, "shared claim safety catches certification variants");
  assert(protocol.claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA regulatory approval was implied. NOT_CUSTOMER_SOURCE.") === "regulatory approval", "shared claim safety catches regulatory approval variants");
}

function validFalsePositive() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    false_positive_record_id: "false_positive:synthetic_reviewer_001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification_record_ref: "classification_record:synthetic_likely_001",
    review_finding_draft_evidence_refs: [draftEvidenceRef()],
    evidence_basis: ["scanner_output"],
    rationale: "SYNTHETIC_DEMO_DATA reviewer explains why this is false positive. NOT_CUSTOMER_SOURCE.",
    limitations: ["SYNTHETIC_DEMO_DATA finding remains visible in evidence package. NOT_CUSTOMER_SOURCE."],
    recorded_at: "2026-07-28T02:00:00Z",
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" },
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validAcceptedRisk() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    accepted_risk_record_id: "accepted_risk:synthetic_customer_001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification_record_ref: "classification_record:synthetic_likely_001",
    review_finding_draft_evidence_refs: [draftEvidenceRef()],
    evidence_basis: ["scanner_output"],
    customer_rationale: "SYNTHETIC_DEMO_DATA customer approved carrying residual risk for bounded demo scope. NOT_CUSTOMER_SOURCE.",
    recorded_at: "2026-07-28T02:05:00Z",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    limitations: ["SYNTHETIC_DEMO_DATA accepted risk is not verification or remediation. NOT_CUSTOMER_SOURCE."],
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validClassification() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    classification_record_id: "classification_record:synthetic_likely_001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification: "likely",
    classified_at: "2026-07-22T00:00:00Z",
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" },
    evidence_basis: ["scanner_output"],
    confirmation_criteria: [],
    threshold_gaps: ["SYNTHETIC_DEMO_DATA bounded evidence needs broader review. NOT_CUSTOMER_SOURCE."],
    limitations: ["SYNTHETIC_DEMO_DATA classification remains bounded. NOT_CUSTOMER_SOURCE."],
    rationale: "SYNTHETIC_DEMO_DATA reviewer records a likely finding. NOT_CUSTOMER_SOURCE.",
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing",
    review_finding_draft_evidence_refs: [draftEvidenceRef()]
  };
}

function validCustomerStatus() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    customer_status_record_id: "customer_status:synthetic_status_001",
    finding_ref: "review_finding_draft:demo_finding_context",
    customer_remediation_status: "planned",
    recorded_at: "2026-07-23T01:00:00Z",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };
}

function draftEvidenceRef() {
  return {
    artifact_ref: "artifact_ref:scanner_finding_set",
    availability_state: "retained_review_artifact",
    available_for_review: true,
    display_state: "available_reference",
    source_derived_class: "retained_review_artifact"
  };
}

async function readValid(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, "valid", fileName), "utf8"));
}

function assertNoErrors(protocol, schemaId, value) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.length === 0, `${schemaId} rejected structurally valid value: ${JSON.stringify(errors)}`);
}

function assertErrorCode(protocol, schemaId, value, expectedCode) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.some((error) => error.code === expectedCode), `${schemaId} must report ${expectedCode}; got ${JSON.stringify(errors)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
