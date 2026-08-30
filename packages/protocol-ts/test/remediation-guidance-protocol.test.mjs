// Story 3.3: remediation guidance, customer remediation status, and
// customer-facing finding projections are protocol-owned retained review
// artifacts with closed schemas and claim-safe shape boundaries.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { validateCustomerFacingFindingRecordSemantics } from "../../../scripts/lib/protocol-utils.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-remediation-guidance-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-remediation-guidance-test-dist");

const guidanceSchemaId = "urn:codeattest:protocol:v0:finding-remediation-guidance";
const statusSchemaId = "urn:codeattest:protocol:v0:customer-remediation-status-record";
const projectionSchemaId = "urn:codeattest:protocol:v0:customer-facing-finding-record";

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

  assert(guidanceSchemaId in generatedSchemas.protocolV0Schemas, `${guidanceSchemaId} must be generated`);
  assert(statusSchemaId in generatedSchemas.protocolV0Schemas, `${statusSchemaId} must be generated`);
  assert(projectionSchemaId in generatedSchemas.protocolV0Schemas, `${projectionSchemaId} must be generated`);

  assertNoErrors(protocol, guidanceSchemaId, validRemediationGuidance());
  assertNoErrors(protocol, statusSchemaId, validCustomerStatus());
  assertNoErrors(protocol, projectionSchemaId, validCustomerFacingProjection());
  testGuidanceSchemaShape(protocol);
  testCustomerStatusSchemaShape(protocol);
  testProjectionSchemaShape(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts remediation guidance tests passed.");

function evidenceRef() {
  return {
    artifact_ref: "artifact_ref:synthetic_raw_snippet",
    availability_state: "retained_review_artifact",
    available_for_review: true,
    display_state: "available_reference",
    source_derived_class: "transient_source_derived"
  };
}

function reviewerActor() {
  return {
    actor_type: "reviewer",
    actor_id: "reviewer:synthetic-amelia"
  };
}

function customerActor() {
  return {
    actor_type: "customer_user",
    actor_id: "customer:synthetic-maya"
  };
}

function validRemediationGuidance() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    remediation_guidance_id: "remediation_guidance:synthetic-demo-likely-001",
    classification_record_ref: "classification_record:synthetic-demo-likely-001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    review_finding_draft_evidence_refs: [evidenceRef()],
    guidance_status: "actionable_guidance_provided",
    authored_at: "2026-07-23T00:00:00Z",
    actor: reviewerActor(),
    classification_context: {
      classification: "likely",
      confirmation_criteria: [],
      evidence_basis: ["scanner_output", "finding_context_snippet"],
      source_reference_state: "retained_review_artifact"
    },
    exploitability_rationale: "SYNTHETIC_DEMO_DATA reviewer rationale stays scoped to submitted evidence and visible limitations.",
    suggested_remediation: "SYNTHETIC_DEMO_DATA rotate the demo configuration path and add bounded input checks before release.",
    validation_steps: "SYNTHETIC_DEMO_DATA rerun the scoped check and preserve the validation evidence reference for later verification.",
    limitations: ["SYNTHETIC_DEMO_DATA guidance is based only on submitted fixture evidence."],
    evidence_refs: ["artifact_ref:synthetic_raw_snippet"],
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validCustomerStatus() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    customer_status_record_id: "customer_status:synthetic-demo-status-001",
    finding_ref: "review_finding_draft:demo_finding_context",
    classification_record_ref: "classification_record:synthetic-demo-likely-001",
    remediation_guidance_ref: "remediation_guidance:synthetic-demo-likely-001",
    customer_remediation_status: "planned",
    owner: "Synthetic platform owner",
    due_date: "2026-08-31",
    customer_notes: "SYNTHETIC_DEMO_DATA owner plans a bounded remediation window without changing reviewer rationale.",
    recorded_at: "2026-07-23T01:00:00Z",
    actor: customerActor(),
    field_export_policy: {
      owner: "exclude",
      due_date: "include",
      target_state: "include",
      customer_notes: "exclude"
    },
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };
}

function validCustomerFacingProjection() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    customer_facing_finding_record_id: "customer_facing_finding:synthetic-demo-001",
    review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification_record_ref: "classification_record:synthetic-demo-likely-001",
    remediation_guidance_ref: "remediation_guidance:synthetic-demo-likely-001",
    customer_status_record_refs: ["customer_status:synthetic-demo-status-001"],
    expert_classification: {
      classification: "likely",
      classification_record_ref: "classification_record:synthetic-demo-likely-001",
      rationale_summary: "SYNTHETIC_DEMO_DATA expert rationale remains separate from customer remediation state.",
      criteria_summary: "SYNTHETIC_DEMO_DATA likely criteria are bounded to submitted evidence.",
      limitations: ["SYNTHETIC_DEMO_DATA no verification artifact has been recorded yet."]
    },
    evidence_basis: {
      evidence_refs: ["artifact_ref:synthetic_raw_snippet"],
      source_reference_state: "retained_review_artifact",
      limitations: ["SYNTHETIC_DEMO_DATA retained evidence is synthetic and bounded."]
    },
    reviewer_remediation_guidance: {
      guidance_status: "actionable_guidance_provided",
      remediation_guidance_ref: "remediation_guidance:synthetic-demo-likely-001",
      suggested_remediation_summary: "SYNTHETIC_DEMO_DATA apply the bounded configuration fix and record evidence.",
      validation_step_summary: "SYNTHETIC_DEMO_DATA rerun the scoped validation and attach retained evidence.",
      limitations: ["SYNTHETIC_DEMO_DATA guidance does not imply audit acceptance."]
    },
    customer_remediation_status: {
      latest_status: "planned",
      latest_status_record_ref: "customer_status:synthetic-demo-status-001",
      owner: "Synthetic platform owner",
      due_date: "2026-08-31",
      target_state: "Synthetic control ready for customer validation",
      customer_notes_visible: false
    },
    verification_state: {
      status: "not_verified",
      summary: "SYNTHETIC_DEMO_DATA Epic 4 verification evidence has not been recorded."
    },
    future_outcome_visibility: {
      accepted_risk_visible: false,
      false_positive_visible: false
    },
    evidence_consumer_export: "include",
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };
}

function testGuidanceSchemaShape(protocol) {
  const base = validRemediationGuidance();
  const missingClassification = { ...base };
  delete missingClassification.classification_record_ref;
  assertErrorCode(protocol, guidanceSchemaId, missingClassification, "required");
  assertErrorCode(protocol, guidanceSchemaId, { ...base, remediation_guidance_id: "guidance:demo" }, "pattern");
  assertErrorCode(protocol, guidanceSchemaId, { ...base, guidance_status: "low_confidence" }, "enum");
  assertErrorCode(protocol, guidanceSchemaId, { ...base, actor: customerActor() }, "const");
  assertErrorCode(protocol, guidanceSchemaId, { ...base, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, guidanceSchemaId, { ...base, remediationGuidanceId: base.remediation_guidance_id }, "additional_property");
}

function testCustomerStatusSchemaShape(protocol) {
  const base = validCustomerStatus();
  assertErrorCode(protocol, statusSchemaId, { ...base, customer_status_record_id: "status:demo" }, "pattern");
  assertErrorCode(protocol, statusSchemaId, { ...base, customer_remediation_status: "accepted_risk" }, "enum");
  assertErrorCode(protocol, statusSchemaId, { ...base, actor: reviewerActor() }, "const");
  assertErrorCode(protocol, statusSchemaId, { ...base, due_date: "2026/13/01" }, "pattern");
  assertErrorCode(protocol, statusSchemaId, { ...base, classification: "confirmed" }, "additional_property");
  assertErrorCode(protocol, statusSchemaId, { ...base, source_derived_class: "transient_source_derived" }, "const");
}

function testProjectionSchemaShape(protocol) {
  const base = validCustomerFacingProjection();
  assertErrorCode(protocol, projectionSchemaId, { ...base, customer_facing_finding_record_id: "finding:demo" }, "pattern");
  assertErrorCode(protocol, projectionSchemaId, { ...base, expert_classification: { ...base.expert_classification, classification: "remediated" } }, "enum");
  assertErrorCode(protocol, projectionSchemaId, { ...base, customer_remediation_status: { ...base.customer_remediation_status, latest_status: "verified" } }, "enum");
  assertErrorCode(protocol, projectionSchemaId, { ...base, verification_state: { ...base.verification_state, status: "soc2_accepted" } }, "enum");
  assertErrorCode(protocol, projectionSchemaId, { ...base, evidence_basis: { ...base.evidence_basis, evidence_refs: [] } }, "min_items");
  assertErrorCode(protocol, projectionSchemaId, { ...base, ambiguous_status: "resolved" }, "additional_property");

  const semanticErrors = [];
  validateCustomerFacingFindingRecordSemantics({ ...base, status: "resolved" }, semanticErrors);
  assert(
    semanticErrors.some((error) => error.code === "customer_facing_finding_status_separation_required"),
    "customer-facing projection semantics must directly reject collapsed top-level status fields"
  );
}

function assertNoErrors(protocol, schemaId, value) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.length === 0, `${schemaId} rejected a structurally valid value: ${JSON.stringify(errors)}`);
}

function assertErrorCode(protocol, schemaId, value, expectedCode) {
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
