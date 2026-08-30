import { readFileSync } from "node:fs";
// Story 4.1: verification-pass scope is protocol-owned selection/scope,
// not follow-up evidence intake, verification outcome, or addendum content.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-pass-scope-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-verification-pass-scope-test-dist");

const scopeSchemaId = "urn:codeattest:protocol:v0:verification-pass-scope";
const reviewEventSchemaId = "urn:codeattest:protocol:v0:review-event";
const projectionSchemaId = "urn:codeattest:protocol:v0:review-event-customer-projection";

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

  assert(scopeSchemaId in generatedSchemas.protocolV0Schemas, `${scopeSchemaId} must be generated`);
  assertNoErrors(protocol, scopeSchemaId, validScope());
  assertNoErrors(protocol, scopeSchemaId, validRequiresValidationScope());
  assertNoErrors(protocol, scopeSchemaId, validAdditionalScriptScope());
  assertNoErrors(protocol, reviewEventSchemaId, validVerificationScopeEvent());
  assertNoErrors(protocol, projectionSchemaId, validVerificationScopeProjection());
  testScopeShape(protocol);
  testForbiddenStory41Fields(protocol);
  testSemanticFixturesRegistered();
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts verification pass scope tests passed.");

function validScope() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    verification_pass_id: "verification_pass:synthetic_pass_001",
    scope_version: 1,
    included_pass_started_at: "2026-07-29T00:00:00Z",
    included_pass_start_basis: "SYNTHETIC_DEMO_DATA review completion timestamp recorded for included verification-pass availability. NOT_CUSTOMER_SOURCE.",
    scope_recorded_at: "2026-07-29T12:00:00Z",
    pass_deadline: "2026-08-28T00:00:00Z",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    selected_findings: [
      {
        review_finding_draft_ref: "review_finding_draft:demo_finding_context",
        classification_record_ref: "classification_record:synthetic_likely_001",
        current_classification: "likely",
        remediation_guidance_ref: "remediation_guidance:synthetic_likely_001",
        customer_status_record_ref: "customer_status:synthetic_status_owner_due_001",
        current_customer_remediation_status: "planned",
        requested_verification_type: "follow_up_commit",
        eligibility_state: "eligible",
        eligibility_reason: "SYNTHETIC_DEMO_DATA customer selected the likely finding for pending follow-up verification within the included pass. NOT_CUSTOMER_SOURCE.",
        limitations: ["SYNTHETIC_DEMO_DATA scope selection is limited to selected findings and recorded criteria. NOT_CUSTOMER_SOURCE."]
      }
    ],
    included_script_allocation: { included_slots: [], additional_script_candidates: [] },
    limitations: [
      "SYNTHETIC_DEMO_DATA this verification pass is limited to selected findings, submitted follow-up evidence, and recorded validation criteria. NOT_CUSTOMER_SOURCE.",
      "SYNTHETIC_DEMO_DATA this selection is not a complete fresh secure-code review and does not record a verification decision. NOT_CUSTOMER_SOURCE."
    ],
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function validRequiresValidationScope() {
  const scope = validScope();
  scope.verification_pass_id = "verification_pass:synthetic_pass_requires_validation_001";
  scope.selected_findings = [
    {
      review_finding_draft_ref: "review_finding_draft:demo_metadata_only",
      classification_record_ref: "classification_record:synthetic_requires_validation_001",
      current_classification: "requires_customer_side_validation",
      remediation_guidance_ref: "remediation_guidance:synthetic_requires_path_only_001",
      validation_path_ref: "validation_path:synthetic_script_001",
      reviewer_validation_script_refs: ["validation_script:synthetic_included_001"],
      requested_verification_type: "reviewer_authored_script_output",
      eligibility_state: "eligible",
      eligibility_reason: "SYNTHETIC_DEMO_DATA formal validation path and reviewer script are recorded before eligible selection. NOT_CUSTOMER_SOURCE.",
      limitations: ["SYNTHETIC_DEMO_DATA script output remains later evidence intake and is not a decision. NOT_CUSTOMER_SOURCE."]
    }
  ];
  scope.included_script_allocation = {
    included_slots: [{ slot: 1, validation_script_ref: "validation_script:synthetic_included_001", finding_ref: "review_finding_draft:demo_metadata_only" }],
    additional_script_candidates: []
  };
  return scope;
}

function validAdditionalScriptScope() {
  const scope = validRequiresValidationScope();
  scope.verification_pass_id = "verification_pass:synthetic_pass_additional_script_001";
  scope.selected_findings[0].reviewer_validation_script_refs = ["validation_script:synthetic_included_001", "validation_script:synthetic_additional_002"];
  scope.selected_findings[0].eligibility_state = "requires_additional_agreement";
  scope.selected_findings[0].eligibility_reason = "SYNTHETIC_DEMO_DATA selected finding needs an additional script candidate with pricing TBD before included-pass scope can proceed. NOT_CUSTOMER_SOURCE.";
  scope.included_script_allocation.additional_script_candidates = [
    {
      validation_script_ref: "validation_script:synthetic_additional_002",
      finding_ref: "review_finding_draft:demo_metadata_only",
      pricing_posture: "pricing_tbd",
      reason: "SYNTHETIC_DEMO_DATA pricing TBD applies to this additional reviewer-authored script candidate. NOT_CUSTOMER_SOURCE."
    }
  ];
  return scope;
}

function validVerificationScopeEvent() {
  return {
    protocol_version: "codeattest.v0",
    event_id: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    review_id: "review:synthetic-demo-001",
    sequence_number: 10,
    idempotency_key: "verification_scope:review:synthetic-demo-001:verification_pass:synthetic_pass_001:scope_version:1",
    event_type: "verification_scope_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    event_timestamp: "2026-07-29T12:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_pass_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason: "SYNTHETIC_DEMO_DATA verification-pass scope recorded for selected findings only. NOT_CUSTOMER_SOURCE."
  };
}

function validVerificationScopeProjection() {
  return {
    protocol_version: "codeattest.v0",
    review_id: "review:synthetic-demo-001",
    entries: [
      {
        event_id: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        event_type: "verification_scope_recorded",
        event_timestamp: "2026-07-29T12:00:00Z",
        actor_category: "customer_user",
        artifact_refs: ["artifact_ref:synthetic_pass_001"],
        visibility: "customer_facing",
        reason: "SYNTHETIC_DEMO_DATA verification-pass scope recorded for selected findings only. NOT_CUSTOMER_SOURCE."
      }
    ]
  };
}

function testScopeShape(protocol) {
  const base = validScope();
  const missingFinding = { ...base };
  delete missingFinding.selected_findings;
  assertErrorCode(protocol, scopeSchemaId, missingFinding, "required");
  assertErrorCode(protocol, scopeSchemaId, { ...base, verification_pass_id: "pass:demo" }, "pattern");
  const missingScopeVersion = { ...base };
  delete missingScopeVersion.scope_version;
  assertErrorCode(protocol, scopeSchemaId, missingScopeVersion, "required");
  assertErrorCode(protocol, scopeSchemaId, { ...base, scope_version: 0 }, "minimum");
  assertErrorCode(protocol, scopeSchemaId, { ...base, source_derived_class: "transient_source_derived" }, "const");
  assertErrorCode(protocol, scopeSchemaId, { ...base, selected_findings: [{ ...base.selected_findings[0], requested_verification_type: "new_full_review" }] }, "enum");
  assertErrorCode(protocol, scopeSchemaId, { ...base, included_script_allocation: { included_slots: [{ slot: 4, validation_script_ref: "validation_script:synthetic_extra", finding_ref: "review_finding_draft:demo_finding_context" }], additional_script_candidates: [] } }, "maximum");
  assertErrorCode(protocol, scopeSchemaId, { ...base, verificationPassId: base.verification_pass_id }, "additional_property");
}

function testForbiddenStory41Fields(protocol) {
  const base = validScope();
  assertErrorCode(protocol, scopeSchemaId, { ...base, follow_up_commit_ref: "commit:future-story" }, "additional_property");
  assertErrorCode(protocol, scopeSchemaId, { ...base, selected_findings: [{ ...base.selected_findings[0], verified_with_evidence: true }] }, "additional_property");
}

function testSemanticFixturesRegistered() {
  const fixtureIndex = JSON.parse(readFileSync(path.join(repoRoot, "protocol", "fixtures", "v0", "fixture-index.json"), "utf8"));
  const negativePaths = new Set((fixtureIndex.negative_fixtures ?? []).map((entry) => entry.path));
  for (const requiredPath of [
    "v0/invalid/verification-pass-scope.more-than-three-included-scripts.json",
    "v0/invalid/verification-pass-scope.additional-script-missing-pricing-tbd.json",
    "v0/invalid/verification-pass-scope.future-evidence-field.json"
  ]) {
    assert(negativePaths.has(requiredPath), `required semantic Story 4.1 fixture must stay registered: ${requiredPath}`);
  }
}

function assertNoErrors(protocol, schemaId, value) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.length === 0, `${schemaId} rejected a structurally valid value: ${JSON.stringify(errors)}`);
}

function assertErrorCode(protocol, schemaId, value, expectedCode) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.some((error) => error.code === expectedCode), `${schemaId} should produce ${expectedCode}; got ${JSON.stringify(errors)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
