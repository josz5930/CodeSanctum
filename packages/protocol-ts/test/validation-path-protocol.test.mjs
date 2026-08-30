// Story 3.4: validation paths and reviewer-authored scripts are protocol-owned
// retained review artifacts, not hidden reviewer notes or classification fields.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-validation-path-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-validation-path-test-dist");

const pathSchemaId = "urn:codeattest:protocol:v0:finding-validation-path";
const scriptSchemaId = "urn:codeattest:protocol:v0:reviewer-validation-script";

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

  assert(pathSchemaId in generatedSchemas.protocolV0Schemas, `${pathSchemaId} must be generated`);
  assert(scriptSchemaId in generatedSchemas.protocolV0Schemas, `${scriptSchemaId} must be generated`);
  assertNoErrors(protocol, pathSchemaId, validRemoteValidationPath());
  assertNoErrors(protocol, pathSchemaId, validCustomerRunScriptPath());
  assertNoErrors(protocol, scriptSchemaId, validIncludedScript());
  assertNoErrors(protocol, scriptSchemaId, validAdditionalScriptCandidate());
  testValidationPathSchemaShape(protocol);
  testValidationScriptSchemaShape(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts validation path tests passed.");

export function draftEvidenceRef() {
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

function basePath() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    validation_path_id: "validation_path:synthetic_remote_001",
    classification_record_ref: "classification_record:synthetic_requires_validation_001",
    review_finding_draft_ref: "review_finding_draft:demo_metadata_only",
    review_finding_draft_evidence_refs: [draftEvidenceRef()],
    remediation_guidance_ref: "remediation_guidance:synthetic_requires_path_only_001",
    path_type: "remote_dynamic_testing",
    required_evidence: "SYNTHETIC_DEMO_DATA collect bounded runtime response evidence from an authorized synthetic target. NOT_CUSTOMER_SOURCE.",
    steps: "SYNTHETIC_DEMO_DATA run the documented remote check from the reviewer workbench. NOT_CUSTOMER_SOURCE.",
    expected_result: "SYNTHETIC_DEMO_DATA the target rejects the unsafe synthetic behavior and emits retained evidence. NOT_CUSTOMER_SOURCE.",
    limitations: ["SYNTHETIC_DEMO_DATA validation path does not prove absence of vulnerabilities. NOT_CUSTOMER_SOURCE."],
    included_pass_verifiability: "verifiable_within_included_pass",
    authored_at: "2026-07-28T00:00:00Z",
    actor: reviewerActor(),
    source_reference_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validRemoteValidationPath() {
  return {
    ...basePath(),
    target: "SYNTHETIC_DEMO_DATA authorized demo endpoint https://example.invalid/health. NOT_CUSTOMER_SOURCE.",
    authorization_assumption: "SYNTHETIC_DEMO_DATA customer authorizes this bounded remote check before execution. NOT_CUSTOMER_SOURCE.",
    method: "SYNTHETIC_DEMO_DATA send a safe non-destructive request and capture status plus headers. NOT_CUSTOMER_SOURCE.",
    safety_constraints: "SYNTHETIC_DEMO_DATA do not fuzz, brute force, scan broadly, or exceed one synthetic request. NOT_CUSTOMER_SOURCE.",
    evidence_artifacts_to_collect: ["artifact_ref:synthetic_remote_validation_output"]
  };
}

function validCustomerRunScriptPath() {
  return {
    ...basePath(),
    validation_path_id: "validation_path:synthetic_script_001",
    path_type: "customer_run_script",
    reviewer_validation_script_refs: ["validation_script:synthetic_included_001"],
    output_attachment_instructions: "SYNTHETIC_DEMO_DATA attach command output as retained review artifact with line references. NOT_CUSTOMER_SOURCE."
  };
}

function baseScript() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    validation_script_id: "validation_script:synthetic_included_001",
    validation_path_ref: "validation_path:synthetic_script_001",
    classification_record_ref: "classification_record:synthetic_requires_validation_001",
    remediation_guidance_ref: "remediation_guidance:synthetic_requires_path_only_001",
    script_package_status: "included_base_package",
    included_script_slot: 1,
    purpose: "SYNTHETIC_DEMO_DATA confirm the bounded synthetic runtime condition in the customer environment. NOT_CUSTOMER_SOURCE.",
    prerequisites: "SYNTHETIC_DEMO_DATA run from the selected application test shell with fixture data only. NOT_CUSTOMER_SOURCE.",
    execution_steps: "SYNTHETIC_DEMO_DATA execute node ./scripts/synthetic-validation.mjs and capture retained output. NOT_CUSTOMER_SOURCE.",
    expected_output: "SYNTHETIC_DEMO_DATA command prints validation evidence reference and a bounded pass or fail detail. NOT_CUSTOMER_SOURCE.",
    safety_notes: "SYNTHETIC_DEMO_DATA script is read-only and does not contact unauthorized targets. NOT_CUSTOMER_SOURCE.",
    output_attachment_instructions: "SYNTHETIC_DEMO_DATA attach output as customer-provided validation evidence for Epic 4. NOT_CUSTOMER_SOURCE.",
    script_content: "#!/usr/bin/env node\nconsole.log('SYNTHETIC_DEMO_DATA validation output NOT_CUSTOMER_SOURCE');",
    authored_at: "2026-07-28T00:05:00Z",
    actor: reviewerActor(),
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validIncludedScript() {
  return baseScript();
}

function validAdditionalScriptCandidate() {
  const script = {
    ...baseScript(),
    validation_script_id: "validation_script:synthetic_additional_001",
    script_package_status: "additional_script_candidate_pricing_tbd"
  };
  delete script.included_script_slot;
  return script;
}

function testValidationPathSchemaShape(protocol) {
  const base = validRemoteValidationPath();
  const missingRequiredEvidence = { ...base };
  delete missingRequiredEvidence.required_evidence;
  assertErrorCode(protocol, pathSchemaId, missingRequiredEvidence, "required");
  assertErrorCode(protocol, pathSchemaId, { ...base, validation_path_id: "path:demo" }, "pattern");
  assertErrorCode(protocol, pathSchemaId, { ...base, path_type: "generic_validation" }, "enum");
  assertErrorCode(protocol, pathSchemaId, { ...base, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, "const");
  assertErrorCode(protocol, pathSchemaId, { ...base, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, pathSchemaId, { ...base, validationPathId: base.validation_path_id }, "additional_property");
  assertNoErrors(protocol, "urn:codeattest:protocol:v0:customer-facing-finding-record", validCustomerFacingValidationProjection());
  const missingProjectedScriptContent = validCustomerFacingValidationProjection();
  delete missingProjectedScriptContent.reviewer_validation_scripts[0].script_content;
  assertErrorCode(protocol, "urn:codeattest:protocol:v0:customer-facing-finding-record", missingProjectedScriptContent, "required");
}

function validCustomerFacingValidationProjection() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    customer_facing_finding_record_id: "customer_facing_finding:synthetic_validation_001",
    review_finding_draft_ref: "review_finding_draft:demo_metadata_only",
    classification_record_ref: "classification_record:synthetic_requires_validation_001",
    expert_classification: {
      classification: "requires_customer_side_validation",
      classification_record_ref: "classification_record:synthetic_requires_validation_001",
      rationale_summary: "SYNTHETIC_DEMO_DATA reviewer requires customer-side runtime validation. NOT_CUSTOMER_SOURCE.",
      criteria_summary: "SYNTHETIC_DEMO_DATA validation criteria stay bounded to future customer evidence. NOT_CUSTOMER_SOURCE.",
      limitations: ["SYNTHETIC_DEMO_DATA submitted evidence is not sufficient to verify runtime behavior. NOT_CUSTOMER_SOURCE."]
    },
    evidence_basis: {
      evidence_refs: ["artifact_ref:synthetic_raw_snippet"],
      source_reference_state: "retained_review_artifact",
      limitations: ["SYNTHETIC_DEMO_DATA evidence remains bounded. NOT_CUSTOMER_SOURCE."]
    },
    reviewer_remediation_guidance: {
      guidance_status: "limited_guidance_requires_validation",
      insufficient_evidence_reason: "SYNTHETIC_DEMO_DATA runtime behavior is not present in submitted evidence. NOT_CUSTOMER_SOURCE.",
      validation_path_ref: "validation_path:synthetic_script_001",
      limitations: ["SYNTHETIC_DEMO_DATA guidance requires customer-side validation. NOT_CUSTOMER_SOURCE."]
    },
    customer_remediation_status: {
      latest_status: "not_started",
      customer_notes_visible: false
    },
    verification_state: {
      status: "not_verified",
      summary: "SYNTHETIC_DEMO_DATA validation path and script do not prove verification complete. NOT_CUSTOMER_SOURCE."
    },
    future_outcome_visibility: {
      accepted_risk_visible: false,
      false_positive_visible: false
    },
    validation_paths: [
      {
        validation_path_ref: "validation_path:synthetic_remote_001",
        path_type: "remote_dynamic_testing",
        required_evidence: "SYNTHETIC_DEMO_DATA collect bounded runtime response evidence from an authorized synthetic target. NOT_CUSTOMER_SOURCE.",
        steps: "SYNTHETIC_DEMO_DATA run the documented remote check from the reviewer workbench. NOT_CUSTOMER_SOURCE.",
        expected_result: "SYNTHETIC_DEMO_DATA the target rejects unsafe synthetic behavior and emits retained evidence. NOT_CUSTOMER_SOURCE.",
        limitations: ["SYNTHETIC_DEMO_DATA validation path does not prove verification complete. NOT_CUSTOMER_SOURCE."],
        included_pass_verifiability: "verifiable_within_included_pass",
        output_attachment_instructions: "SYNTHETIC_DEMO_DATA attach remote testing evidence artifacts for Epic 4 review. NOT_CUSTOMER_SOURCE.",
        target: "SYNTHETIC_DEMO_DATA authorized demo endpoint https://example.invalid/health. NOT_CUSTOMER_SOURCE.",
        authorization_assumption: "SYNTHETIC_DEMO_DATA customer authorizes this bounded remote check before execution. NOT_CUSTOMER_SOURCE.",
        method: "SYNTHETIC_DEMO_DATA send a safe non-destructive request and capture status plus headers. NOT_CUSTOMER_SOURCE.",
        safety_constraints: "SYNTHETIC_DEMO_DATA do not fuzz, brute force, scan broadly, or exceed one synthetic request. NOT_CUSTOMER_SOURCE.",
        evidence_artifacts_to_collect: ["artifact_ref:synthetic_remote_validation_output"]
      }
    ],
    reviewer_validation_scripts: [
      {
        validation_script_ref: "validation_script:synthetic_included_001",
        validation_path_ref: "validation_path:synthetic_script_001",
        script_package_status: "included_base_package",
        included_script_slot: 1,
        purpose: "SYNTHETIC_DEMO_DATA confirm the bounded synthetic runtime condition in the customer environment. NOT_CUSTOMER_SOURCE.",
        prerequisites: "SYNTHETIC_DEMO_DATA run from the selected application test shell with fixture data only. NOT_CUSTOMER_SOURCE.",
        execution_steps: "SYNTHETIC_DEMO_DATA execute node ./scripts/synthetic-validation.mjs and capture retained output. NOT_CUSTOMER_SOURCE.",
        expected_output: "SYNTHETIC_DEMO_DATA command prints validation evidence reference and bounded detail. NOT_CUSTOMER_SOURCE.",
        safety_notes: "SYNTHETIC_DEMO_DATA script is read-only and does not contact unauthorized targets. NOT_CUSTOMER_SOURCE.",
        output_attachment_instructions: "SYNTHETIC_DEMO_DATA attach output as customer-provided validation evidence for Epic 4. NOT_CUSTOMER_SOURCE.",
        script_content: "#!/usr/bin/env node\nconsole.log('SYNTHETIC_DEMO_DATA validation output NOT_CUSTOMER_SOURCE');"
      }
    ],
    evidence_consumer_export: "include",
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };
}

function testValidationScriptSchemaShape(protocol) {
  const base = validIncludedScript();
  const missingPurpose = { ...base };
  delete missingPurpose.purpose;
  assertErrorCode(protocol, scriptSchemaId, missingPurpose, "required");
  assertErrorCode(protocol, scriptSchemaId, { ...base, validation_script_id: "script:demo" }, "pattern");
  assertErrorCode(protocol, scriptSchemaId, { ...base, script_package_status: "premium" }, "enum");
  assertErrorCode(protocol, scriptSchemaId, { ...base, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, "const");
  assertErrorCode(protocol, scriptSchemaId, { ...base, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, scriptSchemaId, { ...base, scriptContent: base.script_content }, "additional_property");
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
