import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-review-patches-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-verification-review-patches-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const cp = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  const reviewScope = await fixture("review-scope.json");
  const scope = await fixture("verification-pass-scope.requires-validation-path.json");
  const classification = await fixture("finding-classification-record.requires-validation.json");
  const guidance = await fixture("finding-remediation-guidance.requires-validation-path-only.json");
  const validationPath = await fixture("finding-validation-path.customer-run-script.json");
  const validationScript = await fixture("reviewer-validation-script.included-slot-1.json");
  const storedClassification = { protocol_version: "codeattest.v0", stored_object_ref: "stored_object:synthetic-validation-output", object_kind: "evidence_artifact", source_derived_class: "retained_review_artifact", environment_profile: "synthetic_demo", artifact_ref: "artifact_ref:synthetic_validation_output" };
  const evidence = validationEvidence(scope, classification);
  const evidenceContext = { verification_scope: scope, verification_scope_history: [scope], trusted_tenant_id: "tenant:synthetic-demo", review_scope: reviewScope, classification, remediation_guidance: guidance, validation_path: validationPath, validation_paths: [validationPath], reviewer_validation_script: validationScript, reviewer_validation_scripts: [validationScript], stored_object_classifications: [storedClassification] };

  const validNonCommit = cp.buildVerificationEvidenceIntakeRecord(evidence, evidenceContext);
  assert(validNonCommit.outcome === "projected", `valid non-commit customer validation evidence projects: ${JSON.stringify(validNonCommit)}`);
  assertRejected(cp.buildVerificationEvidenceIntakeRecord({ ...evidence, validation_path_ref: "validation_path:other" }, evidenceContext), "verification_evidence_validation_context_invalid");
  assertRejected(cp.buildVerificationEvidenceIntakeRecord({ ...evidence, reviewer_validation_script_ref: "validation_script:other" }, evidenceContext), "verification_evidence_validation_context_invalid");
  assertRejected(cp.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, stored_object_classifications: [{ ...storedClassification, source_derived_class: "transient_source_derived" }] }), "verification_evidence_lifecycle_invalid");
  assertRejected(cp.buildVerificationEvidenceIntakeRecord({ ...evidence, access_scope: { ...evidence.access_scope, review_scope: "review:other" } }, evidenceContext), "verification_evidence_lifecycle_invalid");

  const sameCommitScope = { ...scope, verification_pass_id: "verification_pass:commit_edge_pass", selected_findings: [{ ...scope.selected_findings[0], requested_verification_type: "follow_up_commit", validation_path_ref: undefined, reviewer_validation_script_refs: undefined, classification_record_ref: classification.classification_record_id }] };
  delete sameCommitScope.selected_findings[0].validation_path_ref;
  delete sameCommitScope.selected_findings[0].reviewer_validation_script_refs;
  const commitContext = { verification_scope: sameCommitScope, verification_scope_history: [sameCommitScope], trusted_tenant_id: "tenant:synthetic-demo", review_scope: reviewScope, classification };
  const sameCommit = commitEvidence(reviewScope, sameCommitScope, classification, "same_commit_submitted", reviewScope.selected_commit.commit_sha, reviewScope.repository_identity, "verification_pending");
  assert(cp.buildVerificationEvidenceIntakeRecord(sameCommit, commitContext).outcome === "projected", "same commit remains pending with next step");
  const repositoryMismatch = commitEvidence(reviewScope, sameCommitScope, classification, "repository_mismatch", "1123456789abcdef0123456789abcdef01234567", `sha256:${"9".repeat(64)}`, "broader_context_required");
  assert(cp.buildVerificationEvidenceIntakeRecord(repositoryMismatch, commitContext).outcome === "projected", "repository mismatch remains broader-context-required");

  const decisionContext = { ...evidenceContext, evidence_records: [evidence], evidence_record_history: [evidence] };
  for (const [status, result] of [["verification_pending", "not_evaluated"], ["not_verified", "not_satisfied"], ["requires_customer_side_validation", "customer_validation_required"]]) {
    const decision = validationDecision(scope, classification, evidence, status, result);
    assert(cp.buildVerificationDecision(decision, decisionContext).outcome === "projected", `${status} decision projects`);
    const built = cp.buildVerificationDecisionEvent(decision, envelope(10), decisionContext);
    assert(built.outcome === "built", `${status} event builds`);
    const finding = cp.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], validation_paths: [validationPath], reviewer_validation_scripts: [validationScript], verification_record: decision });
    assert(finding.outcome === "projected" && finding.record.verification_state.status === status, `${status} flows to customer finding`);
  }

  // C4-19: `not_verified` is a terminal negative outcome, exactly like
  // `verification_complete` is terminal positive -- both must be backed by
  // fully intake-accepted evidence, not merely "some evidence exists".
  const pendingEvidence = { ...evidence, intake_state: "verification_pending", next_step_summary: "Reviewer requests additional bounded customer validation output before evaluation." };
  const pendingEvidenceContext = { ...decisionContext, evidence_records: [pendingEvidence], evidence_record_history: [pendingEvidence] };
  const notVerifiedWithPendingEvidence = validationDecision(scope, classification, pendingEvidence, "not_verified", "not_satisfied");
  assertRejected(
    cp.buildVerificationDecision(notVerifiedWithPendingEvidence, pendingEvidenceContext),
    "verification_record_evidence_insufficient"
  );
  const notVerifiedWithAcceptedEvidence = validationDecision(scope, classification, evidence, "not_verified", "not_satisfied");
  assert(
    cp.buildVerificationDecision(notVerifiedWithAcceptedEvidence, decisionContext).outcome === "projected",
    "not_verified backed by fully accepted evidence still passes"
  );
  const pendingWithPendingEvidence = validationDecision(scope, classification, pendingEvidence, "verification_pending", "not_evaluated");
  assert(
    cp.buildVerificationDecision(pendingWithPendingEvidence, pendingEvidenceContext).outcome === "projected",
    "a non-terminal verification_pending decision remains allowed with non-accepted evidence"
  );

  // C4-16: decision criteria for `requires_customer_side_validation` with
  // empty `confirmation_criteria` must come from the same canonically
  // resolved validation path evidence uses -- never from an independent,
  // unbound singular `context.validation_path` a caller could supply.
  const decoyValidationPath = { ...validationPath, validation_path_id: "validation_path:synthetic_decoy_001", expected_result: "SYNTHETIC_DEMO_DATA decoy result must never become the recorded criterion. NOT_CUSTOMER_SOURCE." };
  const contextWithUnrelatedSingularDecoy = { ...decisionContext, validation_path: decoyValidationPath };
  const correctCriterionDecision = validationDecision(scope, classification, evidence, "requires_customer_side_validation", "customer_validation_required");
  assert(
    cp.buildVerificationDecision(correctCriterionDecision, contextWithUnrelatedSingularDecoy).outcome === "projected",
    "decision using the canonically array-resolved path criterion passes even with an unrelated singular decoy present"
  );
  const decoyCriterionDecision = {
    ...correctCriterionDecision,
    before_state: { ...correctCriterionDecision.before_state, confirmation_criteria: [decoyValidationPath.expected_result] },
    after_state: { ...correctCriterionDecision.after_state, criteria_results: [{ criterion: decoyValidationPath.expected_result, result: "customer_validation_required" }] }
  };
  assertRejected(
    cp.buildVerificationDecision(decoyCriterionDecision, contextWithUnrelatedSingularDecoy),
    "verification_record_before_state_mismatch"
  );

  // Duplicate path IDs in the plural array must fail resolution closed, not
  // silently pick one of the ambiguous candidates. The bound evidence resolves
  // the same ambiguous ref too (evidence and decision share one canonical
  // resolution by construction), so the ambiguity surfaces at the evidence
  // layer first as `verification_record_evidence_insufficient`.
  const duplicateIdPath = { ...decoyValidationPath, validation_path_id: validationPath.validation_path_id };
  assertRejected(
    cp.buildVerificationDecision(correctCriterionDecision, { ...decisionContext, validation_paths: [validationPath, duplicateIdPath] }),
    "verification_record_evidence_insufficient"
  );

  // A path at the right ID but bound to a different classification must not
  // be trusted either -- same reasoning: the shared resolver rejects it for
  // the bound evidence before the decision's own criteria check runs.
  const misboundPath = { ...validationPath, classification_record_ref: "classification_record:synthetic_other_001" };
  assertRejected(
    cp.buildVerificationDecision(correctCriterionDecision, { ...decisionContext, validation_paths: [misboundPath] }),
    "verification_record_evidence_insufficient"
  );

  const pending = validationDecision(scope, classification, evidence, "verification_pending", "not_evaluated");
  const evidenceBuilt = cp.buildVerificationEvidenceEvent(evidence, envelope(1), evidenceContext);
  const decisionBuilt = cp.buildVerificationDecisionEvent(pending, envelope(2), decisionContext);
  assert(evidenceBuilt.outcome === "built" && decisionBuilt.outcome === "built", "incomplete addendum events build");
  const evidenceEvent = await seal(cp, evidenceBuilt.event);
  const decisionEvent = await seal(cp, decisionBuilt.event);
  const addendum = incompleteAddendum(reviewScope, scope, classification, evidence, pending, evidenceEvent, decisionEvent);
  const addendumContext = { ...evidenceContext, classifications: [classification], verification_records: [pending], evidence_records: [evidence], evidence_record_history: [evidence], deletion_evidence: [], lifecycle_events: [], history_events: [evidenceEvent, decisionEvent] };
  const incompleteProjection = cp.projectVerificationAddendum(addendum, addendumContext);
  assert(incompleteProjection.outcome === "projected", `valid incomplete addendum projects as not finalized: ${JSON.stringify(incompleteProjection)}`);

  const correctedDecision = { ...pending, record_version: 2, rationale: "Reviewer records a corrected pending rationale for the bounded criterion." };
  const correctionBuilt = cp.buildVerificationDecisionEvent(correctedDecision, { ...envelope(3), supersedes_event_id: decisionEvent.event_id }, decisionContext);
  assert(correctionBuilt.outcome === "built", "decision correction builds");
  const correctionEvent = await seal(cp, correctionBuilt.event);
  const baseLog = { protocol_version: "codeattest.v0", review_id: scope.review_id, events: [evidenceEvent, decisionEvent] };
  const correctionAppend = await cp.appendReviewEvent(baseLog, correctionEvent);
  assert(correctionAppend.outcome === "appended", "decision correction appends");
  assert((await cp.appendReviewEvent(correctionAppend.log, correctionEvent)).outcome === "idempotent_noop", "decision correction replay is no-op");
  // C4-03: superseding the real decision event with a forged idempotency-key
  // version segment beyond Number.isSafeInteger must be rejected as
  // unparseable identity — a naive Number() parse still compares greater
  // than the real prior version (1), so this must be caught by identity
  // parsing, not version ordering.
  for (const overflowVersion of ["9007199254740992", "9007199254740993", "9".repeat(400)]) {
    const forgedCorrection = await seal(cp, {
      ...correctionBuilt.event,
      idempotency_key: correctionBuilt.event.idempotency_key.replace(":record_version:2", `:record_version:${overflowVersion}`)
    });
    assertRejected(await cp.appendReviewEvent(baseLog, forgedCorrection), "review_event_verification_record_version_invalid");
  }
  const stale = cp.buildVerificationDecisionEvent({ ...correctedDecision, record_version: 3 }, { ...envelope(4), supersedes_event_id: decisionEvent.event_id }, decisionContext);
  assert(stale.outcome === "built", "stale correction structurally builds");
  assertRejected(await cp.appendReviewEvent(correctionAppend.log, await seal(cp, stale.event)), "review_event_verification_record_version_invalid");
  const crossFamily = await seal(cp, { ...correctionBuilt.event, event_id: zeroId(), event_type: "verification_evidence_recorded", artifact_refs: ["artifact_ref:synthetic_validation_evidence"], idempotency_key: "verification_evidence:review:synthetic-demo-001:verification_evidence:synthetic_validation_evidence:record_version:2", actor: evidence.actor });
  assertRejected(await cp.appendReviewEvent(baseLog, crossFamily), "review_event_verification_evidence_supersedes_family_mismatch");
  assertRejected(cp.projectVerificationAddendum(addendum, { ...addendumContext, verification_records: [pending], history_events: [evidenceEvent, decisionEvent, correctionEvent] }), "verification_addendum_required_artifact_missing");

  const deletedEvidence = { ...evidence, validation_artifacts: [{ ...evidence.validation_artifacts[0], artifact_ref: "artifact_ref:raw_snippet_001", digest: `sha256:${"6f4b6612125fb3a0daecd2799dfd6c9c299424fd920f9b308110a2c1fbd8f443"}`, source_derived_class: "transient_source_derived" }] };
  // C4-22: the fixture's stock deletion_timestamp (2026-07-19) predates this
  // test's evidence.recorded_at (2026-07-30), which the causal-bounds check
  // now correctly rejects. Override to an instant within
  // [evidence.recorded_at, addendum.generated_at] for this local scenario
  // without touching the shared fixture file other tests also load.
  const deletion = { ...await fixture("deletion-evidence.json"), deletion_timestamp: "2026-07-30T13:00:00Z" };
  const lifecycle = { ...await fixture("evidence-lifecycle-event.deleted.json"), event_timestamp: "2026-07-30T13:00:00Z" };
  const deletedDecision = validationDecision(scope, classification, deletedEvidence, "verification_pending", "not_evaluated");
  const deletedStoredClassification = await fixture("stored-object-classification.evidence-artifact.json");
  deletedStoredClassification.artifact_ref = "artifact_ref:raw_snippet_001";
  const deletedEvidenceContext = { ...evidenceContext, evidence_records: [deletedEvidence], evidence_record_history: [deletedEvidence], stored_object_classifications: [deletedStoredClassification] };
  const deletedEvidenceBuilt = cp.buildVerificationEvidenceEvent(deletedEvidence, envelope(5), deletedEvidenceContext);
  const deletedDecisionBuilt = cp.buildVerificationDecisionEvent(deletedDecision, envelope(6), { ...deletedEvidenceContext, evidence_records: [deletedEvidence] });
  assert(deletedEvidenceBuilt.outcome === "built" && deletedDecisionBuilt.outcome === "built", `deleted transient chain events build: ${JSON.stringify({ deletedEvidenceBuilt, deletedDecisionBuilt })}`);
  const deletedEvidenceEvent = await seal(cp, deletedEvidenceBuilt.event);
  const deletedDecisionEvent = await seal(cp, deletedDecisionBuilt.event);
  const deletedAddendum = incompleteAddendum(reviewScope, scope, classification, deletedEvidence, deletedDecision, deletedEvidenceEvent, deletedDecisionEvent);
  deletedAddendum.retained_evidence = deletedAddendum.retained_evidence.filter((entry) => entry.artifact_ref !== "artifact_ref:raw_snippet_001");
  deletedAddendum.deleted_evidence = [{ artifact_ref: "artifact_ref:raw_snippet_001", deletion_evidence_ref: deletion.deletion_evidence_id, deletion_timestamp: deletion.deletion_timestamp, deletion_verification_status: "verified" }];
  const deletedContext = { ...deletedEvidenceContext, classifications: [classification], verification_records: [deletedDecision], deletion_evidence: [deletion], lifecycle_events: [lifecycle], history_events: [deletedEvidenceEvent, deletedDecisionEvent] };
  assert(cp.projectVerificationAddendum(deletedAddendum, deletedContext).outcome === "projected", "deleted transient evidence resolves through lifecycle and deletion evidence");
  assertRejected(cp.projectVerificationAddendum(deletedAddendum, { ...deletedContext, lifecycle_events: [] }), "verification_addendum_deletion_evidence_missing");

  // C4-22: require evidence.recorded_at <= deletion_timestamp <= addendum.generated_at.
  // evidence.recorded_at === "2026-07-30T12:00:00Z"; deletedAddendum.generated_at === "2026-08-01T12:00:00Z".
  function deletionScenario(deletionTimestamp, lifecycleTimestamp = deletionTimestamp, deletedEntryTimestamp = deletionTimestamp) {
    const scenarioDeletion = { ...deletion, deletion_timestamp: deletionTimestamp };
    const scenarioLifecycle = { ...lifecycle, event_timestamp: lifecycleTimestamp };
    const scenarioAddendum = { ...deletedAddendum, deleted_evidence: [{ ...deletedAddendum.deleted_evidence[0], deletion_timestamp: deletedEntryTimestamp }] };
    const scenarioContext = { ...deletedContext, deletion_evidence: [scenarioDeletion], lifecycle_events: [scenarioLifecycle] };
    return cp.projectVerificationAddendum(scenarioAddendum, scenarioContext);
  }
  assertRejected(deletionScenario("2026-07-30T11:59:59Z"), "verification_addendum_deletion_evidence_missing");
  assertRejected(deletionScenario("2026-08-01T12:00:01Z"), "verification_addendum_deletion_evidence_missing");
  assertRejected(deletionScenario("2026-07-30T13:00:00Z", "2026-07-30T13:00:01Z"), "verification_addendum_deletion_evidence_missing");
  assert(deletionScenario("2026-07-30T12:00:00Z").outcome === "projected", "deletion exactly at evidence.recorded_at is the inclusive lower boundary");
  assert(deletionScenario("2026-08-01T12:00:00Z").outcome === "projected", "deletion exactly at addendum.generated_at is the inclusive upper boundary");

  const history = cp.projectCustomerFacingHistory({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [evidenceEvent, decisionEvent] });
  assert(history.entries.map((entry) => entry.event_type).join(",") === "verification_evidence_recorded,verification_recorded", "new events project through customer history");

  const cyclic = { ...evidence };
  cyclic.self = cyclic;
  assertRejected(cp.buildVerificationEvidenceIntakeRecord(cyclic, evidenceContext), "verification_evidence_schema_invalid");
  const sparse = { ...evidence, limitations: new Array(1) };
  assertRejected(cp.buildVerificationEvidenceIntakeRecord(sparse, evidenceContext), "verification_evidence_schema_invalid");
  const prototyped = Object.create({ payload: "hidden" });
  Object.assign(prototyped, evidence);
  assertRejected(cp.buildVerificationEvidenceIntakeRecord(prototyped, evidenceContext), "verification_evidence_schema_invalid");
  const accessor = { ...evidence };
  Object.defineProperty(accessor, "hidden", { enumerable: true, get() { throw new Error("must not execute"); } });
  assertRejected(cp.buildVerificationEvidenceIntakeRecord(accessor, evidenceContext), "verification_evidence_schema_invalid");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane verification review patch tests passed.");

function validationEvidence(scope, classification) {
  return { protocol_version: "codeattest.v0", review_id: scope.review_id, verification_evidence_record_id: "verification_evidence:synthetic_validation_evidence", record_version: 1, verification_pass_id: scope.verification_pass_id, verification_pass_ref: scope.verification_pass_id, scope_version: scope.scope_version, review_finding_draft_ref: classification.review_finding_draft_ref, classification_record_ref: classification.classification_record_id, requested_verification_type: "reviewer_authored_script_output", intake_state: "accepted_for_review", state_reason: "Customer validation metadata is ready for bounded reviewer evaluation.", actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }, validation_path_ref: "validation_path:synthetic_script_001", reviewer_validation_script_ref: "validation_script:synthetic_included_001", validation_artifacts: [{ artifact_ref: "artifact_ref:synthetic_validation_output", digest: `sha256:${"7".repeat(64)}`, size_bytes: 128, media_type: "application/json", source_derived_class: "retained_review_artifact" }], recorded_at: "2026-07-30T12:00:00Z", access_scope: { tenant_id: "tenant:synthetic-demo", review_scope: scope.review_id }, environment_profile: "synthetic_demo", disclosure_state: "metadata_only", limitations: ["Customer validation metadata remains bounded to the formal path and criterion."], source_derived_class: "retained_review_artifact", visibility: "customer_facing" };
}

function commitEvidence(reviewScope, scope, classification, relationship, sha, repositoryIdentity, intakeState) {
  return { protocol_version: "codeattest.v0", review_id: scope.review_id, verification_evidence_record_id: `verification_evidence:${relationship}`, record_version: 1, verification_pass_id: scope.verification_pass_id, verification_pass_ref: scope.verification_pass_id, scope_version: scope.scope_version, review_finding_draft_ref: classification.review_finding_draft_ref, classification_record_ref: classification.classification_record_id, requested_verification_type: "follow_up_commit", intake_state: intakeState, state_reason: "Commit relationship requires a bounded reviewer next step.", next_step_summary: "Submit broader repository context for reviewer comparison against the selected commit.", actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" }, follow_up_commit: { original_selected_commit: reviewScope.selected_commit, follow_up_commit: { commit_sha: sha, source_control_system: "git" }, original_repository_identity: reviewScope.repository_identity, follow_up_repository_identity: repositoryIdentity, relationship_to_selected_commit: relationship, relationship_basis: "Customer declares the relationship; no Git ancestry is inferred." }, recorded_at: "2026-07-30T12:00:00Z", access_scope: { tenant_id: "tenant:synthetic-demo", review_scope: scope.review_id }, environment_profile: "synthetic_demo", disclosure_state: "metadata_only", limitations: ["Commit relationship remains customer-declared."], source_derived_class: "retained_review_artifact", visibility: "customer_facing" };
}

function validationDecision(scope, classification, evidence, status, result) {
  const criterion = "SYNTHETIC_DEMO_DATA script output shows whether the synthetic runtime condition is present. NOT_CUSTOMER_SOURCE.";
  return { protocol_version: "codeattest.v0", review_id: scope.review_id, verification_record_id: `verification_record:${status}`, record_version: 1, verification_pass_id: scope.verification_pass_id, verification_pass_ref: scope.verification_pass_id, review_finding_draft_ref: classification.review_finding_draft_ref, classification_record_ref: classification.classification_record_id, verification_evidence_record_refs: [evidence.verification_evidence_record_id], verification_status: status, recorded_at: "2026-07-31T12:00:00Z", actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" }, before_state: { classification: classification.classification, review_finding_draft_evidence_refs: classification.review_finding_draft_evidence_refs.map((ref) => ref.artifact_ref), evidence_basis: classification.evidence_basis, source_reference_state: classification.source_reference_state, confirmation_criteria: [criterion] }, after_state: { summary: "Reviewer evaluated the bounded customer validation metadata against the formal criterion.", criteria_results: [{ criterion, result }], evidence_refs: [evidence.validation_artifacts[0].artifact_ref] }, rationale: "Reviewer records the bounded outcome for this selected finding and formal criterion.", remaining_limitations: ["The outcome does not extend beyond the selected finding and formal criterion."], next_step_summary: "Submit the requested bounded customer evidence for the next reviewer evaluation.", source_derived_class: "retained_review_artifact", visibility: "customer_facing" };
}

function incompleteAddendum(reviewScope, scope, classification, evidence, decision, evidenceEvent, decisionEvent) {
  return { protocol_version: "codeattest.v0", verification_addendum_id: "verification_addendum:synthetic_incomplete", review_id: scope.review_id, verification_pass_id: scope.verification_pass_id, review_scope_ref: reviewScope.review_scope_id, verification_pass_ref: scope.verification_pass_id, selected_commit: reviewScope.selected_commit, repository_identity: reviewScope.repository_identity, generated_at: "2026-08-01T12:00:00Z", findings: [{ review_finding_draft_ref: classification.review_finding_draft_ref, classification_record_ref: classification.classification_record_id, current_classification: classification.classification, verification_status: decision.verification_status, reviewer_actor_category: "reviewer", verification_record_ref: decision.verification_record_id, verification_evidence_record_refs: [evidence.verification_evidence_record_id], remediation_guidance_ref: "remediation_guidance:synthetic_requires_path_only_001", validation_path_ref: evidence.validation_path_ref, timestamp: decision.recorded_at, summary: decision.rationale, remaining_limitations: decision.remaining_limitations, next_step_summary: decision.next_step_summary }], retained_evidence: [{ artifact_ref: `artifact_ref:${evidence.verification_evidence_record_id.slice("verification_evidence:".length)}`, source_derived_class: "retained_review_artifact", recorded_at: evidence.recorded_at }, ...(evidence.validation_artifacts ?? []).filter((artifact) => artifact.source_derived_class !== "transient_source_derived").map((artifact) => ({ artifact_ref: artifact.artifact_ref, source_derived_class: artifact.source_derived_class, recorded_at: evidence.recorded_at }))], deleted_evidence: [], history_refs: [evidenceEvent.event_id, decisionEvent.event_id], limitations: ["Standalone addendum remains bounded to the selected finding and formal criterion."], next_step_summary: decision.next_step_summary, finalization_state: "not_finalized", visibility: "customer_facing", source_derived_class: "retained_review_artifact" };
}

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
function envelope(sequence_number) { return { event_id: zeroId(), sequence_number }; }
function zeroId() { return `sha256:${"0".repeat(64)}`; }
async function seal(cp, event) { const draft = { ...event, event_id: zeroId() }; return { ...draft, event_id: await cp.computeReviewEventId(draft) }; }
function assertRejected(result, reason) { assert(result.outcome === "rejected", `expected ${reason}, got ${JSON.stringify(result)}`); assert(result.reason === reason, `expected ${reason}, got ${result.reason}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
