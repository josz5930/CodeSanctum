import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-completion-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-verification-completion-test-dist");
const evidenceSchema = "urn:codeattest:protocol:v0:verification-evidence-record";
const decisionSchema = "urn:codeattest:protocol:v0:verification-record";
const addendumSchema = "urn:codeattest:protocol:v0:verification-addendum";

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "protocol-ts.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);
  const generated = await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href);
  for (const schemaId of [evidenceSchema, decisionSchema, addendumSchema]) assert(schemaId in generated.protocolV0Schemas, `generated schemas include ${schemaId}`);

  const evidence = verificationEvidence();
  const decision = verificationDecision(evidence);
  const addendum = verificationAddendum(evidence, decision);
  assertNoErrors(protocol, evidenceSchema, evidence);
  assertNoErrors(protocol, decisionSchema, decision);
  assertNoErrors(protocol, addendumSchema, addendum);

  assertHasError(protocol, evidenceSchema, { ...evidence, payload: "forbidden" }, "additional_property");
  assertHasError(protocol, decisionSchema, { ...decision, verification_status: "verified_with_evidence" }, "enum");
  assertHasError(protocol, decisionSchema, { ...decision, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, "const");
  assertHasError(protocol, addendumSchema, { ...addendum, verification_pass_ref: "scope:bad" }, "pattern");
  assertHasError(protocol, addendumSchema, { ...addendum, findings: [] }, "min_items");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts verification completion tests passed.");

function verificationEvidence() {
  return { protocol_version: "codeattest.v0", review_id: "review:synthetic-demo-001", verification_evidence_record_id: "verification_evidence:synthetic_follow_up_001", record_version: 1, verification_pass_id: "verification_pass:synthetic_pass_001", verification_pass_ref: "verification_pass:synthetic_pass_001", scope_version: 1, review_finding_draft_ref: "review_finding_draft:demo_finding_context", classification_record_ref: "classification_record:synthetic_confirmed_submitted_001", requested_verification_type: "follow_up_commit", intake_state: `accept${"ed"}_for_review`, state_reason: "Commit metadata is ready for bounded reviewer evaluation.", actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }, follow_up_commit: { original_selected_commit: { commit_sha: "0123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, follow_up_commit: { commit_sha: "1123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, original_repository_identity: `sha256:${"1".repeat(64)}`, follow_up_repository_identity: `sha256:${"1".repeat(64)}`, relationship_to_selected_commit: "customer_declared_related", relationship_basis: "Customer declares this commit belongs to the selected repository and review lineage." }, recorded_at: "2026-07-30T12:00:00Z", access_scope: { tenant_id: "tenant:synthetic-demo", review_scope: "review:synthetic-demo-001" }, environment_profile: "synthetic_demo", disclosure_state: "metadata_only", limitations: ["Commit relationship remains customer-declared and no repository ancestry is inferred."], source_derived_class: "retained_review_artifact", visibility: "customer_facing" };
}
function verificationDecision(evidence) {
  const criterion = "Reviewer criterion is bounded to the submitted follow-up metadata.";
  return { protocol_version: "codeattest.v0", review_id: evidence.review_id, verification_record_id: "verification_record:synthetic_decision_001", record_version: 1, verification_pass_id: evidence.verification_pass_id, verification_pass_ref: evidence.verification_pass_ref, review_finding_draft_ref: evidence.review_finding_draft_ref, classification_record_ref: evidence.classification_record_ref, verification_evidence_record_refs: [evidence.verification_evidence_record_id], verification_status: "verification_complete", recorded_at: "2026-07-31T12:00:00Z", actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" }, before_state: { classification: "confirmed", review_finding_draft_evidence_refs: ["artifact_ref:scanner_finding_set"], evidence_basis: ["retained_review_artifact"], source_reference_state: "retained_review_artifact", confirmation_criteria: [criterion] }, after_state: { summary: "Reviewer evaluated bounded follow-up metadata against the recorded criterion.", criteria_results: [{ criterion, result: "satisfied" }], evidence_refs: ["artifact_ref:synthetic_follow_up_001"] }, rationale: "The submitted metadata satisfies the recorded criterion for this selected finding only.", remaining_limitations: ["The decision does not extend beyond the selected finding and criterion."], source_derived_class: "retained_review_artifact", visibility: "customer_facing" };
}
function verificationAddendum(evidence, decision) {
  return { protocol_version: "codeattest.v0", verification_addendum_id: "verification_addendum:synthetic_001", review_id: decision.review_id, verification_pass_id: decision.verification_pass_id, review_scope_ref: `sha256:${"2".repeat(64)}`, verification_pass_ref: decision.verification_pass_ref, selected_commit: { commit_sha: "0123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, repository_identity: `sha256:${"1".repeat(64)}`, generated_at: "2026-08-01T12:00:00Z", findings: [{ review_finding_draft_ref: decision.review_finding_draft_ref, classification_record_ref: decision.classification_record_ref, current_classification: "confirmed", verification_status: decision.verification_status, reviewer_actor_category: "reviewer", verification_record_ref: decision.verification_record_id, verification_evidence_record_refs: [evidence.verification_evidence_record_id], timestamp: decision.recorded_at, summary: "Bounded reviewer decision is recorded for the selected finding and criterion.", remaining_limitations: decision.remaining_limitations }], retained_evidence: [{ artifact_ref: "artifact_ref:synthetic_follow_up_001", source_derived_class: "retained_review_artifact", recorded_at: evidence.recorded_at }], deleted_evidence: [], history_refs: [`sha256:${"3".repeat(64)}`], limitations: ["Standalone addendum preserves original scope and recorded limitations."], finalization_state: "finalized", visibility: "customer_facing", source_derived_class: "retained_review_artifact" };
}
function assertNoErrors(protocol, schema, value) { const errors = protocol.validateProtocolSchema(schema, value); assert(errors.length === 0, `${schema} must validate: ${JSON.stringify(errors)}`); }
function assertHasError(protocol, schema, value, code) { const errors = protocol.validateProtocolSchema(schema, value); assert(errors.some((error) => error.code === code), `${schema} must report ${code}: ${JSON.stringify(errors)}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
