import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-completion-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-verification-completion-test-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p", "tsconfig.json",
    "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of [
    "buildVerificationEvidenceIntakeRecord",
    "buildVerificationEvidenceEvent",
    "projectVerificationEvidenceIntake",
    "buildVerificationDecision",
    "buildVerificationDecisionEvent",
    "projectVerificationDecision",
    "projectVerificationAddendum",
    "appendReviewEvent",
    "computeReviewEventId"
  ]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const reviewScope = await fixture("review-scope.json");
  const baseScope = await fixture("verification-pass-scope.eligible-guidance.json");
  const classification = await fixture("finding-classification-record.confirmed-submitted-evidence.json");
  const { remediation_guidance_ref: _guidance, customer_status_record_ref: _statusRef, current_customer_remediation_status: _status, ...selectedFinding } = baseScope.selected_findings[0];
  const scope = {
    ...baseScope,
    selected_findings: [{
      ...selectedFinding,
      classification_record_ref: classification.classification_record_id,
      current_classification: classification.classification
    }]
  };
  const evidence = verificationEvidence(reviewScope, scope, classification);
  const evidenceContext = { verification_scope: scope, verification_scope_history: [scope], trusted_tenant_id: "tenant:synthetic-demo", review_scope: reviewScope, classification };

  const projectedEvidence = controlPlane.buildVerificationEvidenceIntakeRecord(evidence, evidenceContext);
  assert(projectedEvidence.outcome === "projected", `valid metadata-only evidence must project: ${JSON.stringify(projectedEvidence)}`);
  assertDeepFrozen(projectedEvidence.record, "verification evidence projection");
  assert(controlPlane.projectVerificationEvidenceIntake(evidence, evidenceContext).outcome === "projected", "evidence projector must share runtime validation");

  const builtEvidence = controlPlane.buildVerificationEvidenceEvent(evidence, envelope(0), evidenceContext);
  assert(builtEvidence.outcome === "built", `verification evidence event must build: ${JSON.stringify(builtEvidence)}`);
  assert(builtEvidence.event.artifact_refs.length === 1 && builtEvidence.event.artifact_refs[0] === "artifact_ref:synthetic_follow_up_001", "evidence event uses one exact record artifact reference");
  assert(builtEvidence.event.idempotency_key.endsWith(":record_version:1"), "evidence event identity includes the positive record version");
  const evidenceEvent = await seal(controlPlane, builtEvidence.event);
  const emptyLog = { protocol_version: evidence.protocol_version, review_id: evidence.review_id, events: [] };
  const evidenceAppend = await controlPlane.appendReviewEvent(emptyLog, evidenceEvent);
  assert(evidenceAppend.outcome === "appended", `verification evidence append must succeed: ${JSON.stringify(evidenceAppend)}`);
  assert((await controlPlane.appendReviewEvent(evidenceAppend.log, evidenceEvent)).outcome === "idempotent_noop", "exact evidence replay is a no-op");
  const versionTwoStart = controlPlane.buildVerificationEvidenceEvent({ ...evidence, verification_evidence_record_id: "verification_evidence:synthetic_new_family_001", record_version: 2 }, envelope(1), evidenceContext);
  assert(versionTwoStart.outcome === "built", "version-two family start remains structurally buildable before append validation");
  assertRejected(await controlPlane.appendReviewEvent(evidenceAppend.log, await seal(controlPlane, versionTwoStart.event)), "review_event_verification_evidence_version_invalid");

  const correction = {
    ...evidence,
    record_version: 2,
    intake_state: "verification_pending",
    state_reason: "Additional bounded reviewer evaluation remains pending.",
    next_step_summary: "Review the submitted commit metadata against the recorded criterion."
  };
  const builtCorrection = controlPlane.buildVerificationEvidenceEvent(correction, { ...envelope(1), supersedes_event_id: evidenceEvent.event_id }, evidenceContext);
  assert(builtCorrection.outcome === "built", `evidence correction event must build: ${JSON.stringify(builtCorrection)}`);
  const correctionEvent = await seal(controlPlane, builtCorrection.event);
  const correctedLog = await controlPlane.appendReviewEvent(evidenceAppend.log, correctionEvent);
  assert(correctedLog.outcome === "appended", `higher-version same-family evidence correction must append: ${JSON.stringify(correctedLog)}`);
  const staleFork = {
    ...correction,
    record_version: 3,
    state_reason: "A later bounded reviewer evaluation remains pending."
  };
  const staleBuilt = controlPlane.buildVerificationEvidenceEvent(staleFork, { ...envelope(2), supersedes_event_id: evidenceEvent.event_id }, evidenceContext);
  assert(staleBuilt.outcome === "built", "stale correction is structurally buildable before append-log head validation");
  assertRejected(await controlPlane.appendReviewEvent(correctedLog.log, await seal(controlPlane, staleBuilt.event)), "review_event_verification_evidence_version_invalid");

  // C4-03: superseding the real evidence event with a forged overflow
  // version must be rejected as unparseable identity — a naive Number()
  // parse still compares greater than the real prior version (1), so this
  // must be caught by identity parsing, not version ordering.
  for (const overflowVersion of ["9007199254740992", "9007199254740993", "9".repeat(400)]) {
    const forgedCorrection = await seal(controlPlane, {
      ...builtCorrection.event,
      idempotency_key: builtCorrection.event.idempotency_key.replace(":record_version:2", `:record_version:${overflowVersion}`)
    });
    assertRejected(await controlPlane.appendReviewEvent(evidenceAppend.log, forgedCorrection), "review_event_verification_evidence_version_invalid");
  }

  const decision = verificationDecision(scope, classification, evidence);
  const decisionContext = { verification_scope: scope, verification_scope_history: [scope], trusted_tenant_id: "tenant:synthetic-demo", review_scope: reviewScope, classification, evidence_records: [evidence], evidence_record_history: [evidence] };
  const projectedDecision = controlPlane.buildVerificationDecision(decision, decisionContext);
  assert(projectedDecision.outcome === "projected", `valid reviewer decision must project: ${JSON.stringify(projectedDecision)}`);
  assertDeepFrozen(projectedDecision.record, "verification decision projection");
  assert(controlPlane.projectVerificationDecision(decision, decisionContext).outcome === "projected", "decision projector must share reviewer-owned validation");
  assertRejected(controlPlane.buildVerificationDecision({ ...decision, actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" } }, decisionContext), "verification_record_reviewer_actor_required");
  assertRejected(controlPlane.buildVerificationDecision({ ...decision, after_state: { ...decision.after_state, criteria_results: [{ criterion: decision.after_state.criteria_results[0].criterion, result: "not_evaluated" }] } }, decisionContext), "verification_record_schema_invalid");

  const customerFinding = controlPlane.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], verification_record: decision });
  assert(customerFinding.outcome === "projected", `customer finding must consume the reviewer decision: ${JSON.stringify(customerFinding)}`);
  assert(customerFinding.record.verification_state.status === "verification_complete", "customer finding emits the canonical reviewer outcome");
  assert(customerFinding.record.verification_state.verification_record_ref === decision.verification_record_id, "customer finding preserves the decision reference");
  assertRejected(controlPlane.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], verification_record: { ...decision, review_id: "review:other-review" } }), "customer_facing_finding_reference_mismatch");
  assertRejected(controlPlane.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], verification_record: { ...decision, after_state: { ...decision.after_state, criteria_results: [{ ...decision.after_state.criteria_results[0], result: "not_evaluated" }] } } }), "customer_facing_finding_input_invalid");

  const builtDecision = controlPlane.buildVerificationDecisionEvent(decision, envelope(1), decisionContext);
  assert(builtDecision.outcome === "built", `reviewer decision event must build: ${JSON.stringify(builtDecision)}`);
  const decisionEvent = await seal(controlPlane, builtDecision.event);
  const decisionAppend = await controlPlane.appendReviewEvent(evidenceAppend.log, decisionEvent);
  assert(decisionAppend.outcome === "appended", `reviewer decision append must succeed: ${JSON.stringify(decisionAppend)}`);

  const addendum = verificationAddendum(reviewScope, scope, classification, evidence, decision, evidenceEvent, decisionEvent);
  const addendumContext = {
    review_scope: reviewScope,
    verification_scope: scope,
    verification_scope_history: [scope],
    trusted_tenant_id: "tenant:synthetic-demo",
    classifications: [classification],
    verification_records: [decision],
    evidence_records: [evidence],
    evidence_record_history: [evidence],
    deletion_evidence: [],
    history_events: [evidenceEvent, decisionEvent]
  };
  const projectedAddendum = controlPlane.projectVerificationAddendum(addendum, addendumContext);
  assert(projectedAddendum.outcome === "projected", `complete retained-artifact addendum must project: ${JSON.stringify(projectedAddendum)}`);
  assert(projectedAddendum.record.finalization_state === "finalized", "complete bounded decision may produce a finalized standalone addendum");
  assert(projectedAddendum.record.selected_commit.commit_sha === reviewScope.selected_commit.commit_sha, "addendum preserves the original selected commit");
  assertDeepFrozen(projectedAddendum.record, "verification addendum projection");
  assertRejected(controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, history_events: [evidenceEvent] }), "verification_addendum_required_artifact_missing");
  assertRejected(controlPlane.projectVerificationAddendum({ ...addendum, review_id: "review:other-review" }, addendumContext), "verification_addendum_reference_mismatch");
  assertRejected(controlPlane.projectVerificationAddendum({ ...addendum, findings: [addendum.findings[0], addendum.findings[0]] }, addendumContext), "verification_addendum_required_artifact_missing");
  assertRejected(controlPlane.projectVerificationAddendum({ ...addendum, retained_evidence: [{ ...addendum.retained_evidence[0], recorded_at: "2026-07-30T12:00:01Z" }] }, addendumContext), "verification_addendum_required_artifact_missing");
  assertRejected(controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, evidence_records: [evidence, { ...evidence, verification_evidence_record_id: "verification_evidence:unrelated_001" }] }), "verification_addendum_reference_mismatch");
  // C4-21: this history entry's idempotency_key is tampered to claim
  // record_version:2 while its event_id still hashes the original
  // record_version:1 content -- a forged/corrupted event, not merely one
  // missing the required active-version ref. The replay validator now
  // catches this as an invalid history (hash/identity mismatch) before ever
  // reaching version resolution, so the reason is the earlier, stricter
  // `verification_addendum_reference_mismatch` rather than the previous
  // `verification_addendum_required_artifact_missing`.
  assertRejected(controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, history_events: [{ ...evidenceEvent, idempotency_key: evidenceEvent.idempotency_key.replace("record_version:1", "record_version:2") }, decisionEvent] }), "verification_addendum_reference_mismatch");

  // C4-21: `history_events` must replay-validate as a genuine append-only
  // sequence, not merely contain schema-valid individual entries. A lone
  // version-2 evidence correction with no version-1 predecessor, and history
  // supplied out of sequence order, could never have arisen from real
  // appends and must fail the whole addendum closed.
  const loneVersionTwoEvidence = { ...evidence, record_version: 2, state_reason: "Corrected bounded reviewer evaluation." };
  const loneVersionTwoBuilt = controlPlane.buildVerificationEvidenceEvent(loneVersionTwoEvidence, envelope(40), evidenceContext);
  assert(loneVersionTwoBuilt.outcome === "built", `lone v2 evidence event must build structurally in isolation; got ${JSON.stringify(loneVersionTwoBuilt)}`);
  const loneVersionTwoSealed = await seal(controlPlane, loneVersionTwoBuilt.event);
  assertRejected(
    controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, history_events: [loneVersionTwoSealed, decisionEvent] }),
    "verification_addendum_reference_mismatch"
  );
  assertRejected(
    controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, history_events: [decisionEvent, evidenceEvent] }),
    "verification_addendum_reference_mismatch"
  );
  // A history entry with an authority-invalid actor (empty actor_id) is
  // schema-valid JSON but not a genuine event the append boundary would ever
  // have accepted -- the replay validator must reject the whole history.
  const wrongActorEvidenceEvent = await seal(controlPlane, { ...evidenceEvent, event_id: `sha256:${"0".repeat(64)}`, actor: { actor_type: "customer_user", actor_id: "" } });
  assertRejected(
    controlPlane.projectVerificationAddendum(addendum, { ...addendumContext, history_events: [wrongActorEvidenceEvent, decisionEvent] }),
    "verification_addendum_reference_mismatch"
  );

  assertRejected(controlPlane.buildVerificationDecision({ ...decision, rationale: "This finding is fixed under all review contexts." }, decisionContext), "verification_record_text_forbidden");

  // C4-17: `access_scope.tenant_id` is evidence-supplied metadata, not an
  // authenticated fact -- it must be bound to a tenant the caller supplies
  // from trusted context, not merely required to be a nonempty string.
  const { trusted_tenant_id: _droppedTenant, ...evidenceContextWithoutTenant } = evidenceContext;
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, evidenceContextWithoutTenant),
    "verification_evidence_lifecycle_invalid"
  );
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, trusted_tenant_id: "" }),
    "verification_evidence_lifecycle_invalid"
  );
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, trusted_tenant_id: "tenant:arbitrary-other" }),
    "verification_evidence_lifecycle_invalid"
  );
  assert(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, trusted_tenant_id: evidence.access_scope.tenant_id }).outcome === "projected",
    "evidence whose access_scope.tenant_id matches the trusted context tenant remains accepted"
  );

  // C4-20: `internal_note` must never survive onto a non-`internal_only`
  // event -- a successful builder result must always be appendable, and the
  // authoritative append boundary rejects exactly this combination.
  const internalNote = "SYNTHETIC_DEMO_DATA internal reviewer note. NOT_CUSTOMER_SOURCE.";
  assertRejected(
    controlPlane.buildVerificationEvidenceEvent(evidence, { ...envelope(30), internal_note: internalNote }, evidenceContext),
    "verification_evidence_event_schema_invalid"
  );
  const internalEvidence = { ...evidence, visibility: "internal_only" };
  const internalEvidenceBuilt = controlPlane.buildVerificationEvidenceEvent(internalEvidence, { ...envelope(30), internal_note: internalNote }, evidenceContext);
  assert(internalEvidenceBuilt.outcome === "built", `internal-only evidence with an internal_note must build; got ${JSON.stringify(internalEvidenceBuilt)}`);
  const internalEvidenceSealed = await seal(controlPlane, internalEvidenceBuilt.event);
  const internalEvidenceAppend = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: evidence.review_id, events: [] }, internalEvidenceSealed);
  assert(internalEvidenceAppend.outcome === "appended", `internal-only evidence with an internal_note must seal and append; got ${JSON.stringify(internalEvidenceAppend)}`);

  assertRejected(
    controlPlane.buildVerificationDecisionEvent(decision, { ...envelope(30), internal_note: internalNote }, decisionContext),
    "verification_record_event_schema_invalid"
  );
  const internalDecision = { ...decision, visibility: "internal_only" };
  const internalDecisionBuilt = controlPlane.buildVerificationDecisionEvent(internalDecision, { ...envelope(30), internal_note: internalNote }, decisionContext);
  assert(internalDecisionBuilt.outcome === "built", `internal-only decision with an internal_note must build; got ${JSON.stringify(internalDecisionBuilt)}`);
  const internalDecisionSealed = await seal(controlPlane, internalDecisionBuilt.event);
  const internalDecisionAppend = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: decision.review_id, events: [] }, internalDecisionSealed);
  assert(internalDecisionAppend.outcome === "appended", `internal-only decision with an internal_note must seal and append; got ${JSON.stringify(internalDecisionAppend)}`);

  // C4-15: a schema-valid, self-consistent scope/evidence object is not
  // necessarily the *current* one -- callers must supply the authoritative
  // history so a stale (superseded) head cannot be silently trusted.
  const correctedScope = { ...scope, scope_version: 2, limitations: [...scope.limitations, "SYNTHETIC_DEMO_DATA correction preserves selection scope without a verification decision. NOT_CUSTOMER_SOURCE."] };
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, verification_scope_history: [scope, correctedScope] }),
    "verification_evidence_scope_ineligible"
  );
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, verification_scope_history: [] }),
    "verification_evidence_scope_ineligible"
  );
  assertRejected(
    controlPlane.buildVerificationEvidenceIntakeRecord(evidence, { ...evidenceContext, verification_scope_history: [scope, correctedScope, correctedScope] }),
    "verification_evidence_scope_ineligible"
  );

  const activeEvidenceCorrection = { ...evidence, record_version: 2, state_reason: "Additional bounded reviewer evaluation remains pending." };
  assertRejected(
    controlPlane.buildVerificationDecision(decision, { ...decisionContext, evidence_record_history: [evidence, activeEvidenceCorrection] }),
    "verification_record_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildVerificationDecision(decision, { ...decisionContext, evidence_record_history: [] }),
    "verification_record_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildVerificationDecision(decision, { ...decisionContext, evidence_record_history: [evidence, activeEvidenceCorrection, activeEvidenceCorrection] }),
    "verification_record_reference_mismatch"
  );

  assertRejected(controlPlane.buildVerificationEvidenceIntakeRecord({ ...evidence, payload: "forbidden" }, evidenceContext), "verification_evidence_payload_forbidden");
  assertRejected(controlPlane.buildVerificationEvidenceIntakeRecord({ ...evidence, review_id: "review:other-review" }, evidenceContext), "verification_evidence_reference_mismatch");
  assertRejected(controlPlane.buildVerificationEvidenceIntakeRecord(null, evidenceContext), "verification_evidence_schema_invalid");
  assertRejected(controlPlane.buildVerificationDecision(null, decisionContext), "verification_record_schema_invalid");
  assertRejected(controlPlane.projectVerificationAddendum(null, addendumContext), "verification_addendum_schema_invalid");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane verification completion tests passed.");

function verificationEvidence(reviewScope, scope, classification) {
  return {
    protocol_version: "codeattest.v0",
    review_id: scope.review_id,
    verification_evidence_record_id: "verification_evidence:synthetic_follow_up_001",
    record_version: 1,
    verification_pass_id: scope.verification_pass_id,
    verification_pass_ref: scope.verification_pass_id,
    scope_version: scope.scope_version,
    review_finding_draft_ref: classification.review_finding_draft_ref,
    classification_record_ref: classification.classification_record_id,
    requested_verification_type: "follow_up_commit",
    intake_state: "accepted_for_review",
    state_reason: "Commit metadata is ready for bounded reviewer evaluation.",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    follow_up_commit: {
      original_selected_commit: reviewScope.selected_commit,
      follow_up_commit: { commit_sha: "1123456789abcdef0123456789abcdef01234567", source_control_system: "git" },
      original_repository_identity: reviewScope.repository_identity,
      follow_up_repository_identity: reviewScope.repository_identity,
      relationship_to_selected_commit: "customer_declared_related",
      relationship_basis: "Customer declares this commit belongs to the selected repository and review lineage."
    },
    recorded_at: "2026-07-30T12:00:00Z",
    access_scope: { tenant_id: "tenant:synthetic-demo", review_scope: scope.review_id },
    environment_profile: "synthetic_demo",
    disclosure_state: "metadata_only",
    limitations: ["Commit relationship remains customer-declared and no repository ancestry is inferred."],
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function verificationDecision(scope, classification, evidence) {
  const criterion = classification.confirmation_criteria[0];
  return {
    protocol_version: "codeattest.v0",
    review_id: scope.review_id,
    verification_record_id: "verification_record:synthetic_decision_001",
    record_version: 1,
    verification_pass_id: scope.verification_pass_id,
    verification_pass_ref: scope.verification_pass_id,
    review_finding_draft_ref: classification.review_finding_draft_ref,
    classification_record_ref: classification.classification_record_id,
    verification_evidence_record_refs: [evidence.verification_evidence_record_id],
    verification_status: "verification_complete",
    recorded_at: "2026-07-31T12:00:00Z",
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" },
    before_state: {
      classification: classification.classification,
      review_finding_draft_evidence_refs: classification.review_finding_draft_evidence_refs.map((ref) => ref.artifact_ref),
      evidence_basis: classification.evidence_basis,
      source_reference_state: classification.source_reference_state,
      confirmation_criteria: classification.confirmation_criteria
    },
    after_state: {
      summary: "Reviewer evaluated the bounded follow-up metadata against the recorded criterion.",
      criteria_results: [{ criterion, result: "satisfied" }],
      evidence_refs: ["artifact_ref:synthetic_follow_up_001"]
    },
    rationale: "The submitted metadata satisfies the recorded criterion for this selected finding only.",
    remaining_limitations: ["The decision does not extend beyond the selected finding and recorded criterion."],
    source_derived_class: "retained_review_artifact",
    visibility: "customer_facing"
  };
}

function verificationAddendum(reviewScope, scope, classification, evidence, decision, evidenceEvent, decisionEvent) {
  return {
    protocol_version: "codeattest.v0",
    verification_addendum_id: "verification_addendum:synthetic_001",
    review_id: scope.review_id,
    verification_pass_id: scope.verification_pass_id,
    review_scope_ref: reviewScope.review_scope_id,
    verification_pass_ref: scope.verification_pass_id,
    selected_commit: reviewScope.selected_commit,
    repository_identity: reviewScope.repository_identity,
    generated_at: "2026-08-01T12:00:00Z",
    findings: [{
      review_finding_draft_ref: classification.review_finding_draft_ref,
      classification_record_ref: classification.classification_record_id,
      current_classification: classification.classification,
      verification_status: decision.verification_status,
      reviewer_actor_category: "reviewer",
      verification_record_ref: decision.verification_record_id,
      verification_evidence_record_refs: [evidence.verification_evidence_record_id],
      timestamp: decision.recorded_at,
      summary: decision.rationale,
      remaining_limitations: decision.remaining_limitations
    }],
    retained_evidence: [{
      artifact_ref: "artifact_ref:synthetic_follow_up_001",
      source_derived_class: "retained_review_artifact",
      recorded_at: evidence.recorded_at
    }],
    deleted_evidence: [],
    history_refs: [evidenceEvent.event_id, decisionEvent.event_id],
    limitations: ["This standalone addendum preserves the original review scope and recorded limitations."],
    finalization_state: "finalized",
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };
}

async function fixture(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8"));
}

function envelope(sequence_number) {
  return { event_id: zeroId(), sequence_number };
}

function zeroId() {
  return `sha256:${"0".repeat(64)}`;
}

async function seal(controlPlane, event) {
  const draft = { ...event, event_id: zeroId() };
  return { ...draft, event_id: await controlPlane.computeReviewEventId(draft) };
}

function assertRejected(result, reason) {
  assert(result.outcome === "rejected", `expected rejection ${reason}, got ${JSON.stringify(result)}`);
  assert(result.reason === reason, `expected ${reason}, got ${result.reason}`);
}

function assertDeepFrozen(value, label) {
  if (value === null || typeof value !== "object") return;
  assert(Object.isFrozen(value), `${label}: object must be frozen`);
  for (const child of Object.values(value)) assertDeepFrozen(child, label);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
