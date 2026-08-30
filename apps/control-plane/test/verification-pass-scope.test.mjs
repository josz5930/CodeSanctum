import { readFileSync } from "node:fs";
// Story 4.1: verification-pass scope is a pure control-plane builder/projection
// over protocol artifacts, recorded through the existing append-only review log.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-pass-scope-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-verification-pass-scope-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of ["buildVerificationPassScopeEvent", "projectVerificationPassScope", "appendReviewEvent", "computeReviewEventId", "projectCustomerFacingFindingRecord"]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const scope = await readFixture("verification-pass-scope.requires-validation-path.json");
  const eligibleScope = await readFixture("verification-pass-scope.eligible-guidance.json");
  const additionalScope = await readFixture("verification-pass-scope.additional-script-pricing-tbd.json");
  const outcomeScope = await readFixture("verification-pass-scope.outcome-visible-out-of-scope.json");
  const classification = await readFixture("finding-classification-record.requires-validation.json");
  const likelyClassification = await readFixture("finding-classification-record.likely.json");
  const guidance = await readFixture("finding-remediation-guidance.requires-validation-path-only.json");
  const likelyGuidance = await readFixture("finding-remediation-guidance.likely-actionable.json");
  const status = await readFixture("customer-remediation-status-record.owner-due-date.json");
  const validationPath = await readFixture("finding-validation-path.customer-run-script.json");
  const additionalAgreementPath = await readFixture("finding-validation-path.additional-agreement-required.json");
  const script = await readFixture("reviewer-validation-script.included-slot-1.json");
  const additionalScript = await readFixture("reviewer-validation-script.additional-pricing-tbd.json");
  const acceptedRisk = await readFixture("accepted-risk-record.customer-rationale.json");
  const falsePositive = await readFixture("false-positive-record.reviewer.json");

  const outcomeFormalManualPath = await readFixture("finding-validation-path.outcome-formal-manual.json");
  const context = {
    review_finding_drafts: [
      await readFixture("review-finding-draft-set.metadata-only.json"),
      await readFixture("review-finding-draft-set.finding-context.json")
    ],
    classifications: [classification, likelyClassification],
    remediation_guidance_records: [guidance, likelyGuidance],
    customer_status_records: [status],
    validation_paths: [validationPath, additionalAgreementPath, outcomeFormalManualPath],
    reviewer_validation_scripts: [script, additionalScript],
    accepted_risk_records: [acceptedRisk],
    false_positive_records: [falsePositive]
  };

  await testBuildAppendAndProjection(controlPlane, scope, context);
  await testOverflowScopeVersionsRejected(controlPlane, scope, context);
  await testSafeIntegerBoundaryScopeVersions(controlPlane, scope, context);
  testActorAuthorityAndBinding(controlPlane, eligibleScope, scope, context, likelyClassification);
  testScopeGuidanceMustMatchSelectedClassification(controlPlane, eligibleScope, context, likelyGuidance);
  testLatestClassificationSelectionFailsClosed(controlPlane, eligibleScope, context, likelyClassification);
  await testDeadlineValidationPathScriptAndOutcomeRules(controlPlane, eligibleScope, scope, additionalScope, outcomeScope, context);
  await testAppendBoundaryBackstops(controlPlane, scope, context, classification);
  await testCustomerHistoryProjection(controlPlane, scope, context);
  testCustomerFindingProjectionUnchanged(controlPlane, likelyClassification, likelyGuidance, status);
  testVerificationScopeEventEnvelopeRejections(controlPlane, eligibleScope, context);
  testMalformedInputsReturnUnions(controlPlane, scope, context);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane verification pass scope tests passed.");

async function testBuildAppendAndProjection(controlPlane, scope, context) {
  const built = controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(0), context);
  assert(built.outcome === "built", `verification scope event must build; got ${JSON.stringify(built)}`);
  assert(built.event.event_type === "verification_scope_recorded", "scope uses verification_scope_recorded event type");
  assert(built.event.artifact_refs.length === 1 && built.event.artifact_refs[0] === "artifact_ref:synthetic_pass_requires_validation_001", "scope event references exact singleton scope artifact");
  assert(built.event.idempotency_key === `verification_scope:${scope.review_id}:${scope.verification_pass_id}:scope_version:${scope.scope_version}`, "scope idempotency derives from review, verification pass, and scope version");
  assert(built.event.actor.actor_type === "customer_user", "customer user can author selected scope");
  const sealed = await sealEvent(controlPlane, built.event);
  const appended = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, sealed);
  assert(appended.outcome === "appended", `scope append must succeed; got ${JSON.stringify(appended)}`);
  const replay = await controlPlane.appendReviewEvent(appended.log, sealed);
  assert(replay.outcome === "idempotent_noop", "same verification-scope event replay is idempotent");

  const correctionScope = { ...scope, scope_version: 2, limitations: [...scope.limitations, "SYNTHETIC_DEMO_DATA correction preserves selection scope without a verification decision. NOT_CUSTOMER_SOURCE."] };
  const correctionBuilt = controlPlane.buildVerificationPassScopeEvent(correctionScope, envelopeFor(1), context);
  assert(correctionBuilt.outcome === "built", `corrected scope must build; got ${JSON.stringify(correctionBuilt)}`);
  const correctionSealed = await sealEvent(controlPlane, { ...correctionBuilt.event, supersedes_event_id: sealed.event_id });
  const corrected = await controlPlane.appendReviewEvent(appended.log, correctionSealed);
  assert(corrected.outcome === "appended", `higher scope version must append as a same-family correction; got ${JSON.stringify(corrected)}`);

  const versionThreeScope = { ...scope, scope_version: 3, limitations: [...scope.limitations, "SYNTHETIC_DEMO_DATA version three preserves selection scope without a verification decision. NOT_CUSTOMER_SOURCE."] };
  const versionThreeBuilt = controlPlane.buildVerificationPassScopeEvent(versionThreeScope, envelopeFor(2), context);
  assert(versionThreeBuilt.outcome === "built", `scope version three must build; got ${JSON.stringify(versionThreeBuilt)}`);
  const versionThreeSealed = await sealEvent(controlPlane, { ...versionThreeBuilt.event, supersedes_event_id: correctionSealed.event_id });
  const versionThreeAppended = await controlPlane.appendReviewEvent(corrected.log, versionThreeSealed);
  assert(versionThreeAppended.outcome === "appended", `scope version three must supersede the active version; got ${JSON.stringify(versionThreeAppended)}`);
  const versionFourScope = { ...scope, scope_version: 4, limitations: [...scope.limitations, "SYNTHETIC_DEMO_DATA version four remains pending and does not record a verification decision. NOT_CUSTOMER_SOURCE."] };
  const versionFourBuilt = controlPlane.buildVerificationPassScopeEvent(versionFourScope, envelopeFor(3), context);
  assert(versionFourBuilt.outcome === "built", `scope version four must build; got ${JSON.stringify(versionFourBuilt)}`);
  const staleFork = await sealEvent(controlPlane, { ...versionFourBuilt.event, supersedes_event_id: sealed.event_id });
  assertRejected(await controlPlane.appendReviewEvent(versionThreeAppended.log, staleFork), "review_event_verification_scope_version_invalid");
  const unlinkedCorrection = await sealEvent(controlPlane, versionFourBuilt.event);
  assertRejected(await controlPlane.appendReviewEvent(versionThreeAppended.log, unlinkedCorrection), "review_event_verification_scope_version_invalid");

  const projected = controlPlane.projectVerificationPassScope(scope, context);
  assert(projected.outcome === "projected", `customer-facing scope projection must succeed; got ${JSON.stringify(projected)}`);
  assert(projected.record.selected_findings[0].eligibility_state === "eligible", "projection preserves text-first eligibility state");
  assert(projected.record.selected_findings[0].eligibility_reason === scope.selected_findings[0].eligibility_reason, "projection preserves exact eligibility reason");
  assert(JSON.stringify(projected.record.selected_findings[0].limitations) === JSON.stringify(scope.selected_findings[0].limitations), "projection preserves exact finding limitations");
  assert(JSON.stringify(projected.record.limitations) === JSON.stringify(scope.limitations), "projection preserves exact top-level limitations");
  assert(projected.record.included_script_allocation.included_slots[0].slot === 1, "projection preserves included script slot allocation");
  assert(projected.record.included_script_allocation.included_slots[0].validation_script_ref === scope.included_script_allocation.included_slots[0].validation_script_ref, "projection preserves included slot script identity");
  assertDeepFrozen(projected.record, "projected scope is immutable");
}

// C4-03: the append-path version parser must reject idempotency-key version
// segments that overflow `Number.isSafeInteger`, not silently collapse them
// via `Number()`.
async function testOverflowScopeVersionsRejected(controlPlane, scope, context) {
  const built = controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(0), context);
  assert(built.outcome === "built", "baseline scope event must build");
  const emptyLog = { protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] };
  for (const overflowVersion of ["9007199254740992", "9007199254740993", "9".repeat(300)]) {
    const forged = await sealEvent(controlPlane, {
      ...built.event,
      idempotency_key: built.event.idempotency_key.replace(`scope_version:${scope.scope_version}`, `scope_version:${overflowVersion}`)
    });
    assertRejected(
      await controlPlane.appendReviewEvent(emptyLog, forged),
      "review_event_verification_scope_version_invalid"
    );
  }
}

async function testSafeIntegerBoundaryScopeVersions(controlPlane, scope, context) {
  const nearMax = String(Number.MAX_SAFE_INTEGER - 1);
  const atMax = String(Number.MAX_SAFE_INTEGER);
  const emptyLog = { protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] };

  const firstBuilt = controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(0), context);
  const first = await sealEvent(controlPlane, {
    ...firstBuilt.event,
    idempotency_key: firstBuilt.event.idempotency_key.replace(`scope_version:${scope.scope_version}`, `scope_version:${nearMax}`)
  });
  const firstAppended = await controlPlane.appendReviewEvent(emptyLog, first);
  assert(firstAppended.outcome === "appended", `Number.MAX_SAFE_INTEGER - 1 scope version must append; got ${JSON.stringify(firstAppended)}`);

  const correctionScope = { ...scope, limitations: [...scope.limitations, "SYNTHETIC_DEMO_DATA safe-integer boundary correction. NOT_CUSTOMER_SOURCE."] };
  const correctionBuilt = controlPlane.buildVerificationPassScopeEvent(correctionScope, envelopeFor(1), context);
  const correction = await sealEvent(controlPlane, {
    ...correctionBuilt.event,
    idempotency_key: correctionBuilt.event.idempotency_key.replace(`scope_version:${scope.scope_version}`, `scope_version:${atMax}`),
    supersedes_event_id: first.event_id
  });
  const correctionAppended = await controlPlane.appendReviewEvent(firstAppended.log, correction);
  assert(correctionAppended.outcome === "appended", `Number.MAX_SAFE_INTEGER scope correction must append; got ${JSON.stringify(correctionAppended)}`);
}

function testActorAuthorityAndBinding(controlPlane, eligibleScope, scope, context, likelyClassification) {
  const reviewerWithoutBacking = { ...eligibleScope, actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(reviewerWithoutBacking, envelopeFor(0), context), "verification_scope_customer_backing_required");
  for (const blankBacking of ["", "   "]) {
    assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...reviewerWithoutBacking, customer_actor_ref: blankBacking }, envelopeFor(0), context), "verification_scope_customer_backing_required");
  }
  const vendorWithBacking = { ...eligibleScope, actor: { actor_type: "vendor_service", actor_id: "vendor:synthetic-control-plane" }, customer_selection_evidence_ref: "customer_selection:synthetic_ticket_001" };
  assert(controlPlane.buildVerificationPassScopeEvent(vendorWithBacking, envelopeFor(0), context).outcome === "built", "vendor recorder is allowed only with customer-backed selection evidence");
  const reviewerWithCustomerActorRef = { ...eligibleScope, actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" }, customer_actor_ref: "customer:synthetic-maya" };
  assert(controlPlane.buildVerificationPassScopeEvent(reviewerWithCustomerActorRef, envelopeFor(0), context).outcome === "built", "reviewer recorder can use existing customer: actor ref provenance");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, actor: { actor_type: "local_runner", actor_id: "runner:synthetic" } }, envelopeFor(0), context), "verification_scope_actor_authority_required");
  for (const actorId of ["scanner1", "runner01", "workerpool", "worker_pool", "local_runner_svc"]) {
    assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, actor: { actor_type: "vendor_service", actor_id: actorId }, customer_actor_ref: "customer:synthetic-maya" }, envelopeFor(0), context), "verification_scope_actor_authority_required");
  }
  for (const actorId of ["brunner", "sworkerman", "customer-scanner-team"]) {
    assert(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, actor: { actor_type: "vendor_service", actor_id: actorId }, customer_actor_ref: "customer:synthetic-maya" }, envelopeFor(0), context).outcome === "built", `${actorId} must not be mistaken for a machine actor`);
  }
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, actor: { actor_type: "vendor_service", actor_id: "scanner:synthetic-worker" }, customer_actor_ref: "customer:synthetic-maya" }, envelopeFor(0), context), "verification_scope_actor_authority_required");
  for (const actorId of ["vendor:scanner:worker", "vendor:runner:service", "vendor:worker:pool"]) {
    assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, actor: { actor_type: "vendor_service", actor_id: actorId }, customer_actor_ref: "customer:synthetic-maya" }, envelopeFor(0), context), "verification_scope_actor_authority_required");
  }
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], classification_record_ref: undefined }] }, envelopeFor(0), context), "verification_scope_classification_binding_required");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], review_finding_draft_ref: "review_finding_draft:other" }] }, envelopeFor(0), context), "verification_scope_classification_binding_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], current_classification: "confirmed" }] }, envelopeFor(0), { ...context, classifications: [likelyClassification] }), "verification_scope_classification_binding_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" } }, context), "verification_scope_event_actor_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), idempotency_key: "verification_scope:review:synthetic-demo-001:verification_pass:other" }, context), "verification_scope_event_idempotency_key_not_derived");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), artifact_refs: ["artifact_ref:other"] }, context), "verification_scope_event_missing_record_ref");
}

// C4-13: a verification scope's bound remediation guidance must actually match
// the classification it claims to remediate -- both the classification_context
// fields and the evidence_refs subset -- not just share a valid guidance_id.
function testScopeGuidanceMustMatchSelectedClassification(controlPlane, eligibleScope, context, likelyGuidance) {
  const withDriftedGuidance = (guidance) => ({
    ...context,
    remediation_guidance_records: context.remediation_guidance_records.map((record) =>
      record.remediation_guidance_id === likelyGuidance.remediation_guidance_id ? guidance : record
    )
  });

  const driftedClassification = {
    ...likelyGuidance,
    classification_context: { ...likelyGuidance.classification_context, classification: "confirmed" }
  };
  assertRejected(
    controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(driftedClassification)),
    "verification_scope_reference_mismatch"
  );
  assertRejected(
    controlPlane.projectVerificationPassScope(eligibleScope, withDriftedGuidance(driftedClassification)),
    "verification_scope_reference_mismatch"
  );

  const driftedCriteria = {
    ...likelyGuidance,
    classification_context: { ...likelyGuidance.classification_context, confirmation_criteria: ["SYNTHETIC_DEMO_DATA drifted criterion. NOT_CUSTOMER_SOURCE."] }
  };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(driftedCriteria)), "verification_scope_reference_mismatch");

  const driftedEvidenceBasis = {
    ...likelyGuidance,
    classification_context: { ...likelyGuidance.classification_context, evidence_basis: ["scanner_output"] }
  };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(driftedEvidenceBasis)), "verification_scope_reference_mismatch");

  const driftedSourceState = {
    ...likelyGuidance,
    classification_context: { ...likelyGuidance.classification_context, source_reference_state: "not_retained" }
  };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(driftedSourceState)), "verification_scope_reference_mismatch");

  const driftedDraftEvidenceRefs = {
    ...likelyGuidance,
    review_finding_draft_evidence_refs: [likelyGuidance.review_finding_draft_evidence_refs[0]]
  };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(driftedDraftEvidenceRefs)), "verification_scope_reference_mismatch");

  const untetheredEvidenceRef = {
    ...likelyGuidance,
    evidence_refs: ["artifact_ref:synthetic_unrelated_snippet"]
  };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), withDriftedGuidance(untetheredEvidenceRef)), "verification_scope_reference_mismatch");

  assert(
    likelyGuidance.evidence_refs.length < likelyGuidance.review_finding_draft_evidence_refs.length,
    "fixture must exercise a genuine partial subset, not every classification evidence ref"
  );
  assert(
    controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), context).outcome === "built",
    "the unmodified guidance's partial evidence_refs subset of the classification's available draft evidence must remain accepted"
  );
}

// C4-14: `context.classifications` (and the guidance/status arrays) are never
// bulk schema-validated before the "latest record" freshness check runs -- only
// the specifically referenced record is. A decoy record elsewhere in that array
// with an unparseable timestamp must fail the whole selection closed rather than
// being silently skipped, and a genuine same-instant tie must never be resolved
// by array order.
function testLatestClassificationSelectionFailsClosed(controlPlane, eligibleScope, context, likelyClassification) {
  const decoyWithInvalidTimestamp = {
    ...likelyClassification,
    classification_record_id: "classification_record:synthetic_decoy_bad_timestamp_001",
    classified_at: "2026-02-30T00:00:00Z"
  };
  for (const classifications of [
    [likelyClassification, decoyWithInvalidTimestamp],
    [decoyWithInvalidTimestamp, likelyClassification]
  ]) {
    assertRejected(
      controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), { ...context, classifications }),
      "verification_scope_classification_binding_mismatch"
    );
  }

  const decoySameInstantDifferentSpelling = {
    ...likelyClassification,
    classification_record_id: "classification_record:synthetic_decoy_same_instant_001",
    classified_at: "2026-07-22T00:00:00.000+00:00"
  };
  for (const classifications of [
    [likelyClassification, decoySameInstantDifferentSpelling],
    [decoySameInstantDifferentSpelling, likelyClassification]
  ]) {
    assertRejected(
      controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), { ...context, classifications }),
      "verification_scope_classification_binding_mismatch"
    );
  }
}

async function testDeadlineValidationPathScriptAndOutcomeRules(controlPlane, eligibleScope, scope, additionalScope, outcomeScope, context) {
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, pass_deadline: "2026-08-28T00:00:01Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, pass_deadline: "2026-07-29T00:00:00Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, pass_deadline: "2026-07-28T23:59:59Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, included_pass_start_basis: "SYNTHETIC_DEMO_DATA guaranteed within 30 days. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), context), "verification_scope_deadline_basis_limitation_required");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, scope_recorded_at: "2026-07-28T23:59:59Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, scope_recorded_at: "2026-08-28T00:00:01Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, included_pass_started_at: "2026-13-01T00:00:00Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, included_pass_started_at: "2026-02-30T00:00:00Z", scope_recorded_at: "2026-03-02T12:00:00Z", pass_deadline: "2026-04-01T00:00:00Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, pass_deadline: "2026-08-28T00:00:00.000000001Z" }, envelopeFor(0), context), "verification_scope_deadline_outside_included_window");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...scope, selected_findings: [{ ...scope.selected_findings[0], validation_path_ref: undefined }] }, envelopeFor(0), context), "verification_scope_validation_path_required_for_eligible");
  const genericBlocked = { ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], eligibility_state: "blocked_pending_validation_path", eligibility_reason: "SYNTHETIC_DEMO_DATA waiting without a specific action. NOT_CUSTOMER_SOURCE." }] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(genericBlocked, envelopeFor(0), context), "verification_scope_blocked_next_step_required");
  const vagueAdditionalAgreement = { ...additionalScope, selected_findings: [{ ...additionalScope.selected_findings[0], eligibility_reason: "SYNTHETIC_DEMO_DATA extra work is present. NOT_CUSTOMER_SOURCE." }] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(vagueAdditionalAgreement, envelopeFor(0), context), "verification_scope_additional_agreement_next_step_required");
  const capitalizedAdditionalAgreement = { ...additionalScope, selected_findings: [{ ...additionalScope.selected_findings[0], eligibility_reason: "SYNTHETIC_DEMO_DATA Obtain the agreed customer approval before this additional script proceeds with pricing TBD. NOT_CUSTOMER_SOURCE." }] };
  assert(controlPlane.buildVerificationPassScopeEvent(capitalizedAdditionalAgreement, envelopeFor(0), context).outcome === "built", "capitalized next-step keywords remain valid");
  const additionalAgreementEligible = { ...scope, selected_findings: [{ ...scope.selected_findings[0], validation_path_ref: "validation_path:synthetic_additional_agreement_001", reviewer_validation_script_refs: undefined, requested_verification_type: "manual_validation_record" }], included_script_allocation: { included_slots: [], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(additionalAgreementEligible, envelopeFor(0), context), "verification_scope_validation_path_required_for_eligible");
  const blockedWithoutNextStep = { ...scope, selected_findings: [{ ...scope.selected_findings[0], validation_path_ref: undefined, reviewer_validation_script_refs: undefined, eligibility_state: "blocked_pending_validation_path", eligibility_reason: "SYNTHETIC_DEMO_DATA waiting without a specific action. NOT_CUSTOMER_SOURCE.", limitations: ["SYNTHETIC_DEMO_DATA selection remains blocked until a specific customer-side validation step is recorded. NOT_CUSTOMER_SOURCE."] }], included_script_allocation: { included_slots: [], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(blockedWithoutNextStep, envelopeFor(0), context), "verification_scope_blocked_next_step_required");
  for (const eligibilityReason of [
    "SYNTHETIC_DEMO_DATA no validation path has been recorded yet. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA do not record a formal path yet. NOT_CUSTOMER_SOURCE."
  ]) {
    assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...blockedWithoutNextStep, selected_findings: [{ ...blockedWithoutNextStep.selected_findings[0], eligibility_reason: eligibilityReason }] }, envelopeFor(0), context), "verification_scope_blocked_next_step_required");
  }
  const fourSlots = { ...scope, included_script_allocation: { included_slots: [1, 2, 3, 4].map((slot) => ({ slot, validation_script_ref: `validation_script:synthetic_included_00${slot}`, finding_ref: "review_finding_draft:demo_metadata_only" })), additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(fourSlots, envelopeFor(0), context), "verification_scope_included_script_cap_exceeded");
  const duplicateSlot = { ...scope, included_script_allocation: { included_slots: [{ slot: 1, validation_script_ref: "validation_script:synthetic_included_001", finding_ref: "review_finding_draft:demo_metadata_only" }, { slot: 1, validation_script_ref: "validation_script:synthetic_included_002", finding_ref: "review_finding_draft:demo_metadata_only" }], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(duplicateSlot, envelopeFor(0), context), "verification_scope_included_script_slot_duplicate");
  const duplicateScriptRef = { ...additionalScope, included_script_allocation: { included_slots: [{ slot: 1, validation_script_ref: "validation_script:synthetic_included_001", finding_ref: "review_finding_draft:demo_metadata_only" }, { slot: 2, validation_script_ref: "validation_script:synthetic_included_001", finding_ref: "review_finding_draft:demo_metadata_only" }], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(duplicateScriptRef, envelopeFor(0), context), "verification_scope_script_allocation_ref_mismatch");
  const duplicateAcrossIncludedAndAdditional = { ...additionalScope, included_script_allocation: { ...additionalScope.included_script_allocation, additional_script_candidates: [{ ...additionalScope.included_script_allocation.additional_script_candidates[0], validation_script_ref: "validation_script:synthetic_included_001" }] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(duplicateAcrossIncludedAndAdditional, envelopeFor(0), context), "verification_scope_script_allocation_ref_mismatch");
  const missingPricing = { ...additionalScope, included_script_allocation: { ...additionalScope.included_script_allocation, additional_script_candidates: [{ ...additionalScope.included_script_allocation.additional_script_candidates[0], pricing_posture: "included_base_package" }] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(missingPricing, envelopeFor(0), context), "verification_scope_additional_script_pricing_tbd_required");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...additionalScope, selected_findings: [{ ...additionalScope.selected_findings[0], reviewer_validation_script_refs: ["validation_script:missing"] }] }, envelopeFor(0), context), "verification_scope_script_allocation_ref_mismatch");
  const orphanedAllocation = { ...scope, included_script_allocation: { included_slots: [{ ...scope.included_script_allocation.included_slots[0], finding_ref: "review_finding_draft:missing_selected" }], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(orphanedAllocation, envelopeFor(0), context), "verification_scope_script_allocation_ref_mismatch");
  const crossFindingAllocation = { ...additionalScope, included_script_allocation: { ...additionalScope.included_script_allocation, additional_script_candidates: [{ ...additionalScope.included_script_allocation.additional_script_candidates[0], finding_ref: "review_finding_draft:demo_finding_context" }] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(crossFindingAllocation, envelopeFor(0), context), "verification_scope_script_allocation_ref_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...scope, selected_findings: [{ ...scope.selected_findings[0], classification_record_ref: "classification_record:missing_scope_001" }] }, envelopeFor(0), context), "verification_scope_classification_binding_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(0), { ...context, review_finding_drafts: [] }), "verification_scope_draft_binding_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [eligibleScope.selected_findings[0], { ...eligibleScope.selected_findings[0] }] }, envelopeFor(0), context), "verification_scope_reference_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(eligibleScope, envelopeFor(0), { ...context, classifications: [context.classifications[1], context.classifications[1]] }), "verification_scope_reference_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], remediation_guidance_ref: "remediation_guidance:missing_scope_001" }] }, envelopeFor(0), context), "verification_scope_reference_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, selected_findings: [{ ...eligibleScope.selected_findings[0], customer_status_record_ref: "customer_status:missing_scope_001" }] }, envelopeFor(0), context), "verification_scope_reference_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...scope, selected_findings: [{ ...scope.selected_findings[0], validation_path_ref: "validation_path:missing_scope_001" }] }, envelopeFor(0), context), "verification_scope_reference_mismatch");
  const missingScriptContext = { ...scope, selected_findings: [{ ...scope.selected_findings[0], reviewer_validation_script_refs: ["validation_script:missing_scope_001"] }], included_script_allocation: { included_slots: [{ slot: 1, validation_script_ref: "validation_script:missing_scope_001", finding_ref: "review_finding_draft:demo_metadata_only" }], additional_script_candidates: [] } };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(missingScriptContext, envelopeFor(0), context), "verification_scope_reference_mismatch");
  const unsafeCopy = { ...eligibleScope, limitations: ["SYNTHETIC_DEMO_DATA this finding is fixed and verified with no vulnerabilities. NOT_CUSTOMER_SOURCE."] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(unsafeCopy, envelopeFor(0), context), "verification_scope_text_forbidden");
  const negationBypass = { ...eligibleScope, limitations: ["SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review. The selected finding is resolved. NOT_CUSTOMER_SOURCE."] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(negationBypass, envelopeFor(0), context), "verification_scope_text_forbidden");
  for (const limitation of [
    "SYNTHETIC_DEMO_DATA verification_pass:verified later evidence remains pending. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA the finding is not verified but now fixed before evidence. NOT_CUSTOMER_SOURCE."
  ]) {
    assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...eligibleScope, limitations: [limitation] }, envelopeFor(0), context), "verification_scope_text_forbidden");
  }
  const futureField = { ...eligibleScope, follow_up_commit_ref: "commit:future-story" };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(futureField, envelopeFor(0), context), "verification_scope_story_4_1_field_forbidden");
  const missingAcceptedRisk = { ...outcomeScope, selected_findings: [{ ...outcomeScope.selected_findings[0], accepted_risk_record_ref: "accepted_risk:missing_scope_001" }] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(missingAcceptedRisk, envelopeFor(0), context), "verification_scope_reference_mismatch");
  const missingFalsePositive = { ...outcomeScope, selected_findings: [{ ...outcomeScope.selected_findings[0], false_positive_record_ref: "false_positive:missing_scope_001" }] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(missingFalsePositive, envelopeFor(0), context), "verification_scope_reference_mismatch");
  const outcomeNotOutOfScope = { ...outcomeScope, selected_findings: [{ ...outcomeScope.selected_findings[0], eligibility_state: "eligible" }] };
  assertRejected(controlPlane.buildVerificationPassScopeEvent(outcomeNotOutOfScope, envelopeFor(0), context), "verification_scope_outcome_default_out_of_scope_required");
  const outcomeBuilt = controlPlane.buildVerificationPassScopeEvent(outcomeScope, envelopeFor(0), context);
  assert(outcomeBuilt.outcome === "built", "visible accepted-risk/false-positive context is allowed when out of scope");
  const eligibleOutcomeFormalPath = await awaitOutcomeFormalPathBuild(controlPlane, context);
  assert(eligibleOutcomeFormalPath.outcome === "built", `eligible outcome with formal path remains a positive path; got ${JSON.stringify(eligibleOutcomeFormalPath)}`);
  const uncertainBasisPositive = {
    ...eligibleScope,
    verification_pass_id: "verification_pass:synthetic_pass_uncertain_basis_valid_001",
    included_pass_start_basis: "SYNTHETIC_DEMO_DATA estimated fallback timestamp used because review completion was unavailable. NOT_CUSTOMER_SOURCE.",
    limitations: [
      "SYNTHETIC_DEMO_DATA estimated fallback basis is recorded for the included-pass deadline calculation and is not an SLA. NOT_CUSTOMER_SOURCE.",
      "SYNTHETIC_DEMO_DATA this selection is not a complete fresh secure-code review and does not record a verification decision. NOT_CUSTOMER_SOURCE."
    ]
  };
  assert(controlPlane.buildVerificationPassScopeEvent(uncertainBasisPositive, envelopeFor(0), context).outcome === "built", "uncertain basis with explicit limitation remains a positive path");
}

async function testAppendBoundaryBackstops(controlPlane, scope, context, classification) {
  const provenanceBearingScope = { ...scope, actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" }, customer_actor_ref: "customer:verified" };
  const provenanceBearingBuilt = controlPlane.buildVerificationPassScopeEvent(provenanceBearingScope, envelopeFor(0), context);
  assert(provenanceBearingBuilt.outcome === "built", "a typed customer provenance ref containing verified must build");
  const provenanceBearingSealed = await sealEvent(controlPlane, provenanceBearingBuilt.event);
  assert((await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, provenanceBearingSealed)).outcome === "appended", "generated event reason must not reject valid typed provenance refs");

  const built = controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(1), context);
  assert(built.outcome === "built", "scope event must build before append backstop tests");
  const sealedScopeEvent = await sealEvent(controlPlane, built.event);
  const forgedLocalRunner = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), actor: { actor_type: "local_runner", actor_id: "runner:synthetic" } });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedLocalRunner), "review_event_verification_scope_actor_required");
  const forgedWrongRef = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), artifact_refs: ["artifact_ref:other"] });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedWrongRef), "review_event_schema_invalid");
  const forgedVendorNoBacking = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), actor: { actor_type: "vendor_service", actor_id: "vendor:synthetic-control-plane" }, reason: "SYNTHETIC_DEMO_DATA verification scope recorded for selected findings. NOT_CUSTOMER_SOURCE." });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedVendorNoBacking), "review_event_verification_scope_customer_backing_required");
  const forgedVendorBlankBacking = await sealEvent(controlPlane, { ...forgedVendorNoBacking, event_id: zeroId(), customer_actor_ref: "   " });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedVendorBlankBacking), "review_event_verification_scope_customer_backing_required");
  const forgedVendorScanner = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), actor: { actor_type: "vendor_service", actor_id: "scanner:synthetic-worker" }, customer_actor_ref: "customer:synthetic-maya", reason: "SYNTHETIC_DEMO_DATA customer-backed selection provenance recorded. NOT_CUSTOMER_SOURCE." });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedVendorScanner), "review_event_verification_scope_actor_required");
  const forgedNamespacedVendorScanner = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), actor: { actor_type: "vendor_service", actor_id: "vendor:scanner:worker" }, customer_actor_ref: "customer:synthetic-maya", reason: "SYNTHETIC_DEMO_DATA customer-backed selection provenance recorded. NOT_CUSTOMER_SOURCE." });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedNamespacedVendorScanner), "review_event_verification_scope_actor_required");
  const forgedUnsafeReason = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), reason: "SYNTHETIC_DEMO_DATA verification scope says the selected finding is fixed and verified. NOT_CUSTOMER_SOURCE." });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, forgedUnsafeReason), "review_event_verification_scope_reason_claim_unsafe_text_forbidden");

  const classificationEvent = controlPlane.buildFindingClassificationEvent(classification, envelopeFor(0));
  assert(classificationEvent.outcome === "built", "classification event precondition must build");
  const sealedClassification = await sealEvent(controlPlane, classificationEvent.event);
  const first = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [] }, sealedClassification);
  assert(first.outcome === "appended", "classification precondition appends");
  const scopeSupersedesClassification = await sealEvent(controlPlane, { ...sealedScopeEvent, event_id: zeroId(), sequence_number: 1, supersedes_event_id: sealedClassification.event_id });
  assertRejected(await controlPlane.appendReviewEvent(first.log, scopeSupersedesClassification), "customer_event_cannot_supersede_classification");
  const scopeAppend = await controlPlane.appendReviewEvent(first.log, { ...sealedScopeEvent, sequence_number: 1 });
  assert(scopeAppend.outcome === "appended", `scope append after classification must succeed; got ${JSON.stringify(scopeAppend)}`);
  const classificationSupersedesScope = await sealEvent(controlPlane, { ...sealedClassification, event_id: zeroId(), sequence_number: 2, idempotency_key: `classification:${scope.review_id}:classification_record:synthetic_requires_validation_002`, artifact_refs: ["artifact_ref:synthetic_requires_validation_002"], supersedes_event_id: sealedScopeEvent.event_id });
  assertRejected(await controlPlane.appendReviewEvent(scopeAppend.log, classificationSupersedesScope), "review_event_verification_scope_supersedes_family_mismatch");
}

async function testCustomerHistoryProjection(controlPlane, scope, context) {
  const built = controlPlane.buildVerificationPassScopeEvent(scope, envelopeFor(0), context);
  assert(built.outcome === "built", "scope event must build for customer history projection");
  const sealed = await sealEvent(controlPlane, built.event);
  const projection = controlPlane.projectCustomerFacingHistory({ protocol_version: "codeattest.v0", review_id: scope.review_id, events: [sealed] });
  assert(projection.entries.length === 1, "customer-facing history includes verification scope event");
  assert(projection.entries[0].event_type === "verification_scope_recorded", "customer history preserves verification_scope_recorded event type");
  assert(projection.entries[0].artifact_refs[0] === "artifact_ref:synthetic_pass_requires_validation_001", "customer history preserves scope artifact ref");
}

function testCustomerFindingProjectionUnchanged(controlPlane, likelyClassification, likelyGuidance, status) {
  const withoutOutcomeContext = controlPlane.projectCustomerFacingFindingRecord({
    classification: likelyClassification,
    remediation_guidance: likelyGuidance,
    customer_status_records: [status]
  });
  assert(withoutOutcomeContext.outcome === "projected", `baseline customer finding projection must still work; got ${JSON.stringify(withoutOutcomeContext)}`);
  assert(withoutOutcomeContext.record.verification_state.status === "not_verified", "customer remediation remains separate from verification");
}

function testMalformedInputsReturnUnions(controlPlane, scope, context) {
  assertRejected(controlPlane.buildVerificationPassScopeEvent(null, envelopeFor(0), context), "verification_scope_schema_invalid");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, null, context), "verification_scope_schema_invalid");
  assertRejected(controlPlane.projectVerificationPassScope(null, context), "verification_scope_projection_input_invalid");
  assertRejected(controlPlane.projectVerificationPassScope(scope, null), "verification_scope_projection_input_invalid");
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function envelopeFor(sequence_number) {
  return { event_id: zeroId(), sequence_number };
}

function zeroId() {
  return `sha256:${"0".repeat(64)}`;
}

async function sealEvent(controlPlane, event) {
  const draft = { ...event, event_id: zeroId() };
  return { ...draft, event_id: await controlPlane.computeReviewEventId(draft) };
}

function assertRejected(result, reason) {
  assert(result.outcome === "rejected", `expected rejection ${reason}, got ${JSON.stringify(result)}`);
  assert(result.reason === reason, `expected ${reason}, got ${result.reason}`);
}

async function awaitOutcomeFormalPathBuild(controlPlane, context) {
  const outcomeFormalPath = await readFixture("verification-pass-scope.outcome-eligible-with-formal-path.json");
  return controlPlane.buildVerificationPassScopeEvent(outcomeFormalPath, envelopeFor(0), context);
}

function testVerificationScopeEventEnvelopeRejections(controlPlane, scope, context) {
  const expected = new Set([
    "verification_scope_event_type_mismatch",
    "verification_scope_event_missing_record_ref",
    "verification_scope_event_actor_mismatch",
    "verification_scope_event_idempotency_key_not_derived",
    "verification_scope_event_reason_mismatch",
    "verification_scope_event_schema_invalid"
  ]);
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const match = /export type VerificationPassScopeEventBuildRejectionReason =([\s\S]*?);\n\nexport type VerificationPassScopeEventEnvelope/.exec(source);
  assert(match !== null, "VerificationPassScopeEventBuildRejectionReason must remain discoverable");
  const actual = new Set(Array.from(match[1].matchAll(/"([^"]+)"/g), (reasonMatch) => reasonMatch[1]).filter((reason) => reason.startsWith("verification_scope_event_")));
  assert(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `event-envelope rejection union drifted: expected ${JSON.stringify([...expected].sort())}, got ${JSON.stringify([...actual].sort())}`);

  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), event_type: "classification_recorded" }, context), "verification_scope_event_type_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), reason: "SYNTHETIC_DEMO_DATA caller supplied a different reason. NOT_CUSTOMER_SOURCE." }, context), "verification_scope_event_reason_mismatch");
  assertRejected(controlPlane.buildVerificationPassScopeEvent({ ...scope, visibility: "internal_only" }, { ...envelopeFor(0), visibility: "customer_facing" }, context), "verification_scope_event_schema_invalid");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), internal_note: "SYNTHETIC_DEMO_DATA internal only note. NOT_CUSTOMER_SOURCE." }, context), "verification_scope_event_schema_invalid");
  assertRejected(controlPlane.buildVerificationPassScopeEvent(scope, { ...envelopeFor(0), event_id: "bad-event-id" }, context), "verification_scope_event_schema_invalid");
}

function assertDeepFrozen(value, label) {
  assert(Object.isFrozen(value), `${label}: root object must be frozen`);
  assertDeepFrozenRecursive(value, label);
}

function assertDeepFrozenRecursive(value, label) {
  if (value === null || typeof value !== "object") {
    return;
  }
  assert(Object.isFrozen(value), `${label}: nested object must be frozen`);
  for (const child of Object.values(value)) {
    assertDeepFrozenRecursive(child, label);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
