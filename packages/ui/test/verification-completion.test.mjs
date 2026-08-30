import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-verification-completion-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-verification-completion-test-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "ui.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  for (const name of ["VerificationEvidenceIntakeView", "VerificationDecisionView", "VerificationAddendumView", "normalizeVerificationState"]) assert(name in ui, `missing UI export: ${name}`);

  const evidence = verificationEvidence();
  const evidenceView = ui.VerificationEvidenceIntakeView({ intake: evidence });
  assert(evidenceView.verificationEvidenceRef === evidence.verification_evidence_record_id, "evidence view preserves canonical record identity");
  assert(evidenceView.intakeState.value === evidence.intake_state, "evidence view uses text-first intake status");
  assert(evidenceView.artifacts.length === 0, "commit intake does not invent validation artifacts");
  assertAccessible(evidenceView);
  assert(ui.VerificationEvidenceIntakeView({ intake: { ...evidence, payload: "forbidden" } }).verificationEvidenceRef.endsWith(":unavailable"), "payload-bearing evidence fails closed");
  assert(ui.VerificationEvidenceIntakeView({ intake: { ...evidence, visibility: "internal_only" } }).verificationEvidenceRef.endsWith(":unavailable"), "customer cannot view internal-only evidence");
  assert(!ui.VerificationEvidenceIntakeView({ intake: { ...evidence, visibility: "internal_only" }, audience: "reviewer" }).verificationEvidenceRef.endsWith(":unavailable"), "reviewer may view valid internal-only metadata");
  assert(ui.VerificationEvidenceIntakeView({ intake: { ...evidence, access_scope: { ...evidence.access_scope, review_scope: "review:other" } } }).verificationEvidenceRef.endsWith(":unavailable"), "access scope mismatch fails closed");
  assert(ui.VerificationEvidenceIntakeView({ intake: { ...evidence, follow_up_commit: { ...evidence.follow_up_commit, follow_up_repository_identity: `sha256:${"9".repeat(64)}` } } }).verificationEvidenceRef.endsWith(":unavailable"), "unmarked repository mismatch fails closed");
  const cyclicEvidence = { ...evidence }; cyclicEvidence.self = cyclicEvidence;
  assert(ui.VerificationEvidenceIntakeView({ intake: cyclicEvidence }).verificationEvidenceRef.endsWith(":unavailable"), "cyclic evidence fails closed without throwing");
  const getterEvidence = { ...evidence };
  Object.defineProperty(getterEvidence, "intake_state", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(ui.VerificationEvidenceIntakeView({ intake: getterEvidence }).verificationEvidenceRef.endsWith(":unavailable"), "getter-bearing evidence fails closed without invoking the getter");
  const validationEvidence = { ...evidence, verification_evidence_record_id: "verification_evidence:validation_ui", requested_verification_type: "customer_validation_evidence", follow_up_commit: undefined, validation_path_ref: "validation_path:synthetic", validation_artifacts: [{ artifact_ref: "artifact_ref:validation_ui", digest: `sha256:${"7".repeat(64)}`, size_bytes: 1, media_type: "application/verified+json", source_derived_class: "retained_review_artifact" }] }; delete validationEvidence.follow_up_commit;
  assert(!ui.VerificationEvidenceIntakeView({ intake: validationEvidence }).verificationEvidenceRef.endsWith(":unavailable"), "MIME metadata is not treated as claim prose");

  const decision = verificationDecision();
  const decisionView = ui.VerificationDecisionView({ decision });
  assert(decisionView.verificationRecordRef === decision.verification_record_id, "decision view preserves canonical record identity");
  assert(decisionView.decisionState.value === "verification_complete", "decision view emits canonical complete vocabulary");
  assert(decisionView.actorCategory === "CodeAttest reviewer", "decision view preserves reviewer ownership");
  assert(decisionView.beforeBasisSummary.includes("Original classification"), "decision view presents original basis");
  assert(decisionView.originalEvidenceRefs[0] === decision.before_state.review_finding_draft_evidence_refs[0], "decision view preserves original evidence refs");
  assert(decisionView.sourceReferenceState === decision.before_state.source_reference_state, "decision view preserves source-reference state");
  assert(decisionView.criteriaResults[0].result === "satisfied", "decision view preserves criterion results");
  assertAccessible(decisionView);
  assert(ui.VerificationDecisionView({ decision: { ...decision, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } } }).verificationRecordRef.endsWith(":unavailable"), "non-reviewer decision fails closed");
  assert(ui.VerificationDecisionView({ decision: { ...decision, verification_status: "verification_pending", next_step_summary: undefined } }).verificationRecordRef.endsWith(":unavailable"), "pending decision without next step fails closed");
  assert(ui.VerificationDecisionView({ decision: { ...decision, rationale: "This finding is fixed under all review contexts." } }).verificationRecordRef.endsWith(":unavailable"), "unsupported closure prose fails closed");
  assert(ui.VerificationDecisionView({ decision: { ...decision, before_state: { ...decision.before_state, evidence_basis: ["no vulnerabilities"] } } }).verificationRecordRef.endsWith(":unavailable"), "unsafe evidence-basis copy fails closed");
  assert(!ui.VerificationDecisionView({ decision: { ...decision, rationale: "Verification complete for the selected finding and recorded criterion." } }).verificationRecordRef.endsWith(":unavailable"), "bounded canonical completion prose remains valid for complete outcome");
  const getterDecision = { ...decision };
  Object.defineProperty(getterDecision, "verification_status", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(ui.VerificationDecisionView({ decision: getterDecision }).verificationRecordRef.endsWith(":unavailable"), "getter-bearing decision fails closed without invoking the getter");

  const addendum = verificationAddendum(evidence, decision);
  const addendumView = ui.VerificationAddendumView({ addendum, audience: "evidence_consumer" });
  assert(addendumView.verificationAddendumRef === addendum.verification_addendum_id, "addendum view preserves canonical identity");
  assert(addendumView.selectedCommitRef === `git_commit:${addendum.selected_commit.commit_sha}`, "addendum view preserves selected commit");
  assert(addendumView.finalizationState.value === "finalized", "complete addendum finalization is text-first");
  assert(addendumView.findings[0].classificationRecordRef === decision.classification_record_ref && addendumView.findings[0].timestamp === decision.recorded_at, "addendum view preserves per-finding classification and timestamp");
  assert(addendumView.findings[0].verificationEvidenceRecordRefs[0] === evidence.verification_evidence_record_id, "addendum view preserves evidence refs");
  assert(addendumView.timelineLinks.every((link) => link.href.startsWith("./history/")), "history links are derived print/export-safe relative links");
  assertAccessible(addendumView);
  assert(ui.VerificationAddendumView({ addendum: { ...addendum, finalization_state: "finalized", findings: [{ ...addendum.findings[0], verification_status: "verification_pending", next_step_summary: "Submit more bounded evidence before reviewer evaluation." }] } }).verificationAddendumRef.endsWith(":unavailable"), "pending finding cannot appear finalized");
  assert(ui.VerificationAddendumView({ addendum: { ...addendum, findings: [{ ...addendum.findings[0], summary: "This finding is fixed under all review contexts." }] } }).verificationAddendumRef.endsWith(":unavailable"), "unsafe addendum summary fails closed");
  const pendingAddendum = structuredClone(addendum); pendingAddendum.finalization_state = "not_finalized"; pendingAddendum.next_step_summary = "Submit bounded evidence for the next reviewer evaluation."; pendingAddendum.findings[0].verification_status = "verification_pending"; pendingAddendum.findings[0].next_step_summary = pendingAddendum.next_step_summary;
  assert(!ui.VerificationAddendumView({ addendum: pendingAddendum }).verificationAddendumRef.endsWith(":unavailable"), "valid incomplete addendum with per-finding next step renders");
  assert(ui.VerificationAddendumView({ addendum: { ...addendum, findings: [addendum.findings[0], addendum.findings[0]] } }).verificationAddendumRef.endsWith(":unavailable"), "duplicate finding chain fails closed");
  assert(ui.VerificationAddendumView({ addendum: { ...addendum, retained_evidence: [] } }).verificationAddendumRef.endsWith(":unavailable"), "unresolved evidence record fails closed");
  assert(ui.VerificationAddendumView(null).verificationAddendumRef.endsWith(":unavailable"), "malformed addendum fails closed");
  const getterAddendum = { ...addendum };
  Object.defineProperty(getterAddendum, "finalization_state", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(ui.VerificationAddendumView({ addendum: getterAddendum }).verificationAddendumRef.endsWith(":unavailable"), "getter-bearing addendum fails closed without invoking the getter");
  const customerRecord = canonicalCustomerFinding(decision);
  assert(!ui.CustomerFindingRecordView({ record: customerRecord }).recordRef.endsWith(":unavailable"), "canonical customer verification state renders");
  assert(ui.CustomerFindingRecordView({ record: { ...customerRecord, verification_state: { ...customerRecord.verification_state, summary: "This finding is fixed everywhere." } } }).recordRef.endsWith(":unavailable"), "unsafe customer verification closure fails closed");
  const refOnly = structuredClone(customerRecord); refOnly.future_outcome_visibility = { accepted_risk_visible: true, accepted_risk_record_ref: "accepted_risk:synthetic_ref", false_positive_visible: false }; refOnly.accepted_risk_record_ref = "accepted_risk:synthetic_ref";
  assert(ui.CustomerFindingRecordView({ record: refOnly }).recordRef.endsWith(":unavailable"), "accepted-risk visible without a matching outcome section fails closed");
  const prototypedOutcome = Object.create({ actor_category: "reviewer" }); refOnly.accepted_risk_outcome = prototypedOutcome;
  assert(ui.CustomerFindingRecordView({ record: refOnly }).recordRef.endsWith(":unavailable"), "prototype outcome fails closed without crashing");
  const getterRecord = { ...customerRecord };
  Object.defineProperty(getterRecord, "visibility", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(ui.CustomerFindingRecordView({ record: getterRecord }).recordRef.endsWith(":unavailable"), "getter-bearing customer finding record fails closed without invoking the getter");
  assert(ui.normalizeVerificationState("verified_with_evidence") === "verification_complete", "legacy alias is accepted only at input normalization");
  assert(ui.normalizeVerificationState("verification_failed") === "not_verified", "legacy failure alias maps to canonical not-verified output");
  assert(ui.normalizeVerificationState("customer_validation_required") === "requires_customer_side_validation", "legacy customer-validation alias maps to canonical output");
  assert(ui.normalizeVerificationState("customer_side_validation_required") === "requires_customer_side_validation", "legacy customer-side alias maps to canonical output");
  assert(ui.normalizeVerificationState("requires_customer_validation") === "requires_customer_side_validation", "legacy requires-validation alias maps to canonical output");
  assert(ui.normalizeVerificationState("constructor") === undefined && ui.normalizeVerificationState("toString") === undefined, "prototype property names are not accepted as status aliases");
  for (const [status, result] of [["verification_pending", "not_evaluated"], ["not_verified", "not_satisfied"], ["requires_customer_side_validation", "customer_validation_required"]]) {
    const incompleteDecision = structuredClone(decision);
    incompleteDecision.verification_status = status;
    incompleteDecision.after_state.criteria_results[0].result = result;
    incompleteDecision.next_step_summary = "Submit the requested bounded evidence for reviewer evaluation.";
    const incompleteView = ui.VerificationDecisionView({ decision: incompleteDecision });
    assert(incompleteView.verificationRecordRef === decision.verification_record_id && incompleteView.decisionState.value === status, `${status} renders as canonical incomplete state`);
  }
  const sameCommitEvidence = structuredClone(evidence);
  sameCommitEvidence.intake_state = "verification_pending";
  sameCommitEvidence.next_step_summary = "Submit a distinct follow-up commit before reviewer evaluation.";
  sameCommitEvidence.follow_up_commit.follow_up_commit.commit_sha = sameCommitEvidence.follow_up_commit.original_selected_commit.commit_sha;
  sameCommitEvidence.follow_up_commit.relationship_to_selected_commit = "same_commit_submitted";
  assert(ui.VerificationEvidenceIntakeView({ intake: sameCommitEvidence }).intakeState.value === "verification_pending", "same commit renders as pending");
  const mismatchEvidence = structuredClone(evidence);
  mismatchEvidence.intake_state = "broader_context_required";
  mismatchEvidence.next_step_summary = "Submit broader repository context for reviewer comparison.";
  mismatchEvidence.follow_up_commit.follow_up_repository_identity = `sha256:${"9".repeat(64)}`;
  mismatchEvidence.follow_up_commit.relationship_to_selected_commit = "repository_mismatch";
  assert(ui.VerificationEvidenceIntakeView({ intake: mismatchEvidence }).intakeState.value === "broader_context_required", "repository mismatch renders as broader-context required");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("UI verification completion tests passed.");

function verificationEvidence() {
  return {
    protocol_version: "codeattest.v0", review_id: "review:synthetic-demo-001", verification_evidence_record_id: "verification_evidence:synthetic_follow_up_001", record_version: 1,
    verification_pass_id: "verification_pass:synthetic_pass_001", verification_pass_ref: "verification_pass:synthetic_pass_001", scope_version: 1,
    review_finding_draft_ref: "review_finding_draft:demo_finding_context", classification_record_ref: "classification_record:synthetic_confirmed_submitted_001", requested_verification_type: "follow_up_commit",
    intake_state: `accept${"ed"}_for_review`, state_reason: "Commit metadata is ready for bounded reviewer evaluation.", actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    follow_up_commit: { original_selected_commit: { commit_sha: "0123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, follow_up_commit: { commit_sha: "1123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, original_repository_identity: `sha256:${"1".repeat(64)}`, follow_up_repository_identity: `sha256:${"1".repeat(64)}`, relationship_to_selected_commit: "customer_declared_related", relationship_basis: "Customer declares this commit belongs to the selected repository and review lineage." },
    recorded_at: "2026-07-30T12:00:00Z", access_scope: { tenant_id: "tenant:synthetic-demo", review_scope: "review:synthetic-demo-001" }, environment_profile: "synthetic_demo", disclosure_state: "metadata_only",
    limitations: ["Commit relationship remains customer-declared and no repository ancestry is inferred."], source_derived_class: "retained_review_artifact", visibility: "customer_facing"
  };
}

function verificationDecision() {
  const criterion = "Reviewer criterion is bounded to the submitted follow-up metadata.";
  return {
    protocol_version: "codeattest.v0", review_id: "review:synthetic-demo-001", verification_record_id: "verification_record:synthetic_decision_001", record_version: 1,
    verification_pass_id: "verification_pass:synthetic_pass_001", verification_pass_ref: "verification_pass:synthetic_pass_001", review_finding_draft_ref: "review_finding_draft:demo_finding_context",
    classification_record_ref: "classification_record:synthetic_confirmed_submitted_001", verification_evidence_record_refs: ["verification_evidence:synthetic_follow_up_001"], verification_status: "verification_complete",
    recorded_at: "2026-07-31T12:00:00Z", actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" },
    before_state: { classification: "confirmed", review_finding_draft_evidence_refs: ["artifact_ref:scanner_finding_set"], evidence_basis: ["retained_review_artifact"], source_reference_state: "retained_review_artifact", confirmation_criteria: [criterion] },
    after_state: { summary: "Reviewer evaluated bounded follow-up metadata against the recorded criterion.", criteria_results: [{ criterion, result: "satisfied" }], evidence_refs: ["artifact_ref:synthetic_follow_up_001"] },
    rationale: "The submitted metadata satisfies the recorded criterion for this selected finding only.", remaining_limitations: ["The decision does not extend beyond the selected finding and criterion."], source_derived_class: "retained_review_artifact", visibility: "customer_facing"
  };
}

function verificationAddendum(evidence, decision) {
  return {
    protocol_version: "codeattest.v0", verification_addendum_id: "verification_addendum:synthetic_001", review_id: decision.review_id, verification_pass_id: decision.verification_pass_id,
    review_scope_ref: `sha256:${"2".repeat(64)}`, verification_pass_ref: decision.verification_pass_ref, selected_commit: { commit_sha: "0123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, repository_identity: `sha256:${"1".repeat(64)}`, generated_at: "2026-08-01T12:00:00Z",
    findings: [{ review_finding_draft_ref: decision.review_finding_draft_ref, classification_record_ref: decision.classification_record_ref, current_classification: "confirmed", verification_status: decision.verification_status, reviewer_actor_category: "reviewer", verification_record_ref: decision.verification_record_id, verification_evidence_record_refs: [evidence.verification_evidence_record_id], timestamp: decision.recorded_at, summary: "Bounded reviewer decision is recorded for the selected finding and criterion.", remaining_limitations: decision.remaining_limitations }],
    retained_evidence: [{ artifact_ref: "artifact_ref:synthetic_follow_up_001", source_derived_class: "retained_review_artifact", recorded_at: evidence.recorded_at }], deleted_evidence: [], history_refs: [`sha256:${"3".repeat(64)}`, `sha256:${"4".repeat(64)}`], limitations: ["Standalone addendum preserves original scope and recorded limitations."], finalization_state: "finalized", visibility: "customer_facing", source_derived_class: "retained_review_artifact"
  };
}

function canonicalCustomerFinding(decision) {
  return {
    protocol_version: "codeattest.v0", review_id: decision.review_id, customer_facing_finding_record_id: "customer_facing_finding:synthetic_verification", review_finding_draft_ref: decision.review_finding_draft_ref, classification_record_ref: decision.classification_record_ref, customer_status_record_refs: [], verification_record_ref: decision.verification_record_id,
    expert_classification: { classification: "confirmed", classification_record_ref: decision.classification_record_ref, rationale_summary: "Reviewer rationale remains bounded to submitted evidence.", criteria_summary: decision.before_state.confirmation_criteria[0], limitations: ["Classification remains bounded to submitted evidence."] },
    evidence_basis: { evidence_refs: [...decision.before_state.review_finding_draft_evidence_refs], source_reference_state: decision.before_state.source_reference_state, limitations: ["Evidence basis remains bounded to submitted references."] },
    reviewer_remediation_guidance: { guidance_status: "guidance_unavailable_from_submitted_evidence", insufficient_evidence_reason: "Reviewer guidance is not included in this projection.", next_step_summary: "Use the recorded verification decision and limitations.", limitations: ["No remediation guidance is inferred from verification."] },
    customer_remediation_status: { latest_status: "not_started", customer_notes_visible: false },
    verification_state: { status: decision.verification_status, verification_record_ref: decision.verification_record_id, summary: decision.rationale },
    future_outcome_visibility: { accepted_risk_visible: false, false_positive_visible: false }, evidence_consumer_export: "include", visibility: "customer_facing", source_derived_class: "retained_review_artifact"
  };
}

function assertAccessible(view) {
  assert(view.doesNotRelyOnColor === true, "view meaning must not rely on color");
  assert(view.minTargetSizePx >= 44, "view actions retain minimum target size");
  assert(view.disclosure.nonDismissible === true, "boundary disclosure is non-dismissible");
  assert(view.actions.every((action) => action.hoverOnly === false && action.minTargetSizePx >= 44), "actions are keyboard-visible and not hover-only");
}
function assert(condition, message) { if (!condition) throw new Error(message); }
