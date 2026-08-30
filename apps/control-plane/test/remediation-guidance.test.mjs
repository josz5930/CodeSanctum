// Story 3.3: reviewer remediation guidance and customer remediation
// status are typed protocol artifacts recorded through the existing append-only
// review-event-log. Customer status may not rewrite expert classification or
// reviewer guidance, and customer-facing finding projections keep those states
// separate.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-remediation-guidance-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-remediation-guidance-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  assert(typeof controlPlane.buildFindingRemediationGuidanceEvent === "function", "buildFindingRemediationGuidanceEvent must be exported");
  assert(typeof controlPlane.buildCustomerRemediationStatusEvent === "function", "buildCustomerRemediationStatusEvent must be exported");
  assert(typeof controlPlane.projectCustomerFacingFindingRecord === "function", "projectCustomerFacingFindingRecord must be exported");
  assert(typeof controlPlane.appendReviewEvent === "function", "appendReviewEvent must remain the append path");
  assert(!("appendFindingRemediationGuidance" in controlPlane), "Story 3.3 must not add a second guidance append path");
  assert(!("appendCustomerRemediationStatus" in controlPlane), "Story 3.3 must not add a second customer status append path");

  const classification = await readFixture("valid/finding-classification-record.likely.json");
  const validationClassification = await readFixture("valid/finding-classification-record.requires-validation.json");
  const confirmedClassification = await readFixture("valid/finding-classification-record.confirmed-submitted-evidence.json");
  const guidance = await readFixture("valid/finding-remediation-guidance.likely-actionable.json");
  const confirmedGuidance = await readFixture("valid/finding-remediation-guidance.confirmed-actionable.json");
  const limitedGuidance = await readFixture("valid/finding-remediation-guidance.requires-validation-limited.json");
  const validationPathOnlyGuidance = await readFixture("valid/finding-remediation-guidance.requires-validation-path-only.json");
  const unavailableGuidance = await readFixture("valid/finding-remediation-guidance.unavailable-insufficient-evidence.json");
  const inconclusiveClassification = await readFixture("valid/finding-classification-record.inconclusive.json");
  const status = await readFixture("valid/customer-remediation-status-record.owner-due-date.json");
  const laterStatus = await readFixture("valid/customer-remediation-status-record.target-notes.json");
  const acceptedRisk = await readFixture("valid/accepted-risk-record.customer-rationale.json");
  const falsePositive = await readFixture("valid/false-positive-record.reviewer.json");

  await testBuildAppendAndIdempotency(controlPlane, classification, guidance, status);
  await testActorBoundaries(controlPlane, classification, guidance, status);
  await testCustomerCannotRewriteReviewerGuidance(controlPlane, classification, guidance, status);
  testGuidanceAndStatusGuardrails(controlPlane, classification, guidance, confirmedClassification, confirmedGuidance, validationClassification, limitedGuidance, status);
  await testUnavailableGuidanceBranch(controlPlane, inconclusiveClassification, unavailableGuidance);
  testProjectionSeparation(controlPlane, classification, validationClassification, guidance, validationPathOnlyGuidance, unavailableGuidance, status, laterStatus);
  testProjectionSafetyAndDeterminism(controlPlane, classification, guidance, status);
  testProjectionSemanticAndPrivacyBoundaries(controlPlane, classification, guidance, status);
  testCustomerStatusVocabulary(controlPlane, classification, guidance, status);
  testPositiveLaterOutcomeProjection(controlPlane, classification, guidance, acceptedRisk, falsePositive);
  testMalformedInputsReturnUnions(controlPlane, guidance, status, classification);
  testReferenceMismatchGuardrails(controlPlane, classification, guidance, inconclusiveClassification);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane remediation guidance tests passed.");

async function testBuildAppendAndIdempotency(controlPlane, classification, guidance, status) {
  const classificationEvent = await buildSealedClassificationEvent(controlPlane, classification, 0);
  assert(classificationEvent.outcome === "built", `classification precondition must build; got ${JSON.stringify(classificationEvent)}`);
  const log = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: guidance.review_id, events: [] }, classificationEvent.event);
  assert(log.outcome === "appended", "classification must append before remediation events");

  const guidanceEvent = await buildSealedGuidanceEvent(controlPlane, guidance, 1, {}, { classification });
  assert(guidanceEvent.outcome === "built", `guidance event must build; got ${JSON.stringify(guidanceEvent)}`);
  assert(guidanceEvent.event.event_type === "remediation_guidance_recorded", "reviewer guidance maps to remediation_guidance_recorded");
  assert(guidanceEvent.event.actor.actor_type === "reviewer", "guidance event is reviewer-authored");
  assert(guidanceEvent.event.artifact_refs.includes("artifact_ref:synthetic_likely_001"), "guidance event references the typed artifact");
  assert(
    guidanceEvent.event.idempotency_key === `remediation_guidance:${guidance.review_id}:${guidance.remediation_guidance_id}`,
    "guidance idempotency derives from review and remediation guidance identity"
  );

  const guidanceAppend = await controlPlane.appendReviewEvent(log.log, guidanceEvent.event);
  assert(guidanceAppend.outcome === "appended", `guidance append must succeed; got ${JSON.stringify(guidanceAppend)}`);

  const statusEvent = await buildSealedStatusEvent(controlPlane, status, 2);
  assert(statusEvent.outcome === "built", `customer status event must build; got ${JSON.stringify(statusEvent)}`);
  assert(statusEvent.event.event_type === "customer_remediation_recorded", "customer status maps to existing customer_remediation_recorded event");
  assert(statusEvent.event.actor.actor_type === "customer_user", "customer status event is customer-authored");
  assert(statusEvent.event.artifact_refs.includes("artifact_ref:synthetic_status_owner_due_001"), "customer status event references the typed status artifact");
  assert(
    statusEvent.event.idempotency_key === `customer_remediation:${status.review_id}:${status.customer_status_record_id}`,
    "customer status idempotency derives from review and customer status identity"
  );

  const statusAppend = await controlPlane.appendReviewEvent(guidanceAppend.log, statusEvent.event);
  assert(statusAppend.outcome === "appended", `customer status append must succeed; got ${JSON.stringify(statusAppend)}`);

  const replay = await controlPlane.appendReviewEvent(statusAppend.log, statusEvent.event);
  assert(replay.outcome === "idempotent_noop", `identical customer status replay must be idempotent; got ${replay.outcome}`);

  const conflicting = await buildSealedStatusEvent({ ...controlPlane }, { ...status, customer_remediation_status: "deferred" }, 3);
  assert(conflicting.outcome === "built", "different status body under same customer status id must build before append detects conflict");
  const conflictAppend = await controlPlane.appendReviewEvent(statusAppend.log, conflicting.event);
  assert(conflictAppend.outcome === "rejected", "different body under the same customer status idempotency key must reject");
  assert(conflictAppend.reason === "review_event_log_idempotency_key_conflict", `expected idempotency conflict; got ${conflictAppend.reason}`);
}

async function testActorBoundaries(controlPlane, classification, guidance, status) {
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, envelopeFor(0), { classification }),
    "remediation_guidance_reviewer_actor_required"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, { ...envelopeFor(0), actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, { classification }),
    "remediation_guidance_event_actor_mismatch"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent({ ...status, actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic" } }, envelopeFor(0)),
    "customer_remediation_status_customer_actor_required"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(status, { ...envelopeFor(0), actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic" } }),
    "customer_remediation_event_actor_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(
      { ...guidance, visibility: "internal_only" },
      { ...envelopeFor(0), visibility: "customer_facing" },
      { classification }
    ),
    "remediation_guidance_event_schema_invalid"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(
      { ...status, visibility: "internal_only" },
      { ...envelopeFor(0), visibility: "customer_facing" }
    ),
    "customer_remediation_event_schema_invalid"
  );

  const forgedGuidanceEvent = {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: guidance.review_id,
    sequence_number: 0,
    idempotency_key: "remediation_guidance:forged",
    event_type: "remediation_guidance_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic" },
    event_timestamp: "2026-07-23T00:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_likely_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  };
  forgedGuidanceEvent.event_id = await controlPlane.computeReviewEventId(forgedGuidanceEvent);
  const forgedGuidanceAppend = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: guidance.review_id, events: [] }, forgedGuidanceEvent);
  assertRejected(forgedGuidanceAppend, "review_event_remediation_guidance_reviewer_actor_required");

  const forgedStatusEvent = { ...forgedGuidanceEvent, event_type: "customer_remediation_recorded", actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic" }, idempotency_key: "customer_remediation:forged" };
  forgedStatusEvent.event_id = await controlPlane.computeReviewEventId(forgedStatusEvent);
  const forgedStatusAppend = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: guidance.review_id, events: [] }, forgedStatusEvent);
  assertRejected(forgedStatusAppend, "review_event_customer_remediation_actor_required");
}

async function testCustomerCannotRewriteReviewerGuidance(controlPlane, classification, guidance, status) {
  const classificationEvent = await buildSealedClassificationEvent(controlPlane, classification, 0);
  const guidanceEvent = await buildSealedGuidanceEvent(controlPlane, guidance, 1, {}, { classification });
  const first = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: guidance.review_id, events: [] }, classificationEvent.event);
  const second = await controlPlane.appendReviewEvent(first.log, guidanceEvent.event);
  assert(second.outcome === "appended", "guidance event must append before rewrite test");

  const customerRewrite = await buildSealedStatusEvent(controlPlane, status, 2, { supersedes_event_id: guidanceEvent.event.event_id });
  assert(customerRewrite.outcome === "built", `customer event should build before append rejects rewrite; got ${JSON.stringify(customerRewrite)}`);
  const result = await controlPlane.appendReviewEvent(second.log, customerRewrite.event);
  assertRejected(result, "customer_event_cannot_supersede_expert_record");
  assert(result.log.events.length === 2, "rejected customer rewrite leaves expert guidance history unchanged");

  const middle = await sealEvent(controlPlane, {
    ...guidanceEvent.event,
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: 2,
    idempotency_key: "validation_path:review:synthetic-demo-001:validation_path:synthetic_middle_001",
    event_type: "validation_recorded",
    artifact_refs: ["artifact_ref:synthetic_middle_001"],
    supersedes_event_id: guidanceEvent.event.event_id
  });
  const withMiddle = await controlPlane.appendReviewEvent(second.log, middle);
  assert(withMiddle.outcome === "appended", "non-customer middle event can supersede reviewer guidance");

  const twoHopCustomer = await buildSealedStatusEvent(controlPlane, status, 3, { supersedes_event_id: middle.event_id });
  assert(twoHopCustomer.outcome === "built", "two-hop customer event builds before append checks chain");
  assertRejected(await controlPlane.appendReviewEvent(withMiddle.log, twoHopCustomer.event), "customer_event_cannot_supersede_expert_record");
}

function testGuidanceAndStatusGuardrails(controlPlane, classification, guidance, confirmedClassification, confirmedGuidance, validationClassification, limitedGuidance, status) {
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, evidence_refs: [] }, envelopeFor(0), { classification }),
    "remediation_guidance_evidence_ref_required"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, limitations: ["   "] }, envelopeFor(0), { classification }),
    "remediation_guidance_actionable_details_required"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, exploitability_rationale: undefined }, envelopeFor(0), { classification }),
    "remediation_guidance_exploitability_rationale_required"
  );
  // A "confirmed" classification with empty confirmation_criteria is not
  // itself a valid classification record (finding_classification_confirmed_
  // criteria_required), so binding classification_context to an authoritative
  // record now makes this fail at the reference layer before the guidance's
  // own downstream confirmed-criteria check is ever reached — C4-12 closes
  // this exact gap: the drifted claim can no longer stand on its own.
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(
      { ...confirmedGuidance, classification_context: { ...confirmedGuidance.classification_context, confirmation_criteria: [] } },
      envelopeFor(0),
      { classification: confirmedClassification }
    ),
    "remediation_guidance_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, source_reference_state: "not_submitted_by_policy" }, envelopeFor(0), { classification }),
    "remediation_guidance_source_reference_state_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, evidence_refs: ["artifact_ref:unrelated_evidence_ref"] }, envelopeFor(0), { classification }),
    "remediation_guidance_evidence_ref_unbound"
  );
  // Same reasoning: the classification this guidance is bound to must really
  // be inconclusive, not just claimed as inconclusive in classification_context.
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(
      { ...guidance, classification_context: { ...guidance.classification_context, classification: "inconclusive" } },
      envelopeFor(0),
      { classification: { ...classification, classification: "inconclusive" } }
    ),
    "remediation_guidance_inconclusive_not_actionable"
  );
  const missingReason = { ...limitedGuidance };
  delete missingReason.insufficient_evidence_reason;
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(missingReason, envelopeFor(0), { classification: validationClassification }),
    "remediation_guidance_insufficient_evidence_reason_required"
  );
  const missingNextStep = { ...limitedGuidance };
  delete missingNextStep.next_step_summary;
  delete missingNextStep.validation_path_summary;
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(missingNextStep, envelopeFor(0), { classification: validationClassification }),
    "remediation_guidance_next_step_required"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, suggested_remediation: "SYNTHETIC_DEMO_DATA raw scanner output must not enter remediation. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification }),
    "remediation_guidance_text_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent({ ...guidance, suggested_remediation: "SYNTHETIC_DEMO_DATA wording must not imply soc2 certification. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification }),
    "remediation_guidance_text_forbidden"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent({ ...status, classification: "confirmed" }, envelopeFor(0)),
    "customer_remediation_status_rewrite_forbidden"
  );
  const missingFindingRef = { ...status };
  delete missingFindingRef.finding_ref;
  delete missingFindingRef.classification_record_ref;
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(missingFindingRef, envelopeFor(0)),
    "customer_remediation_status_finding_ref_required"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent({ ...status, due_date: "2026-02-30" }, envelopeFor(0)),
    "customer_remediation_status_due_date_invalid"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent({ ...status, customer_notes: "SYNTHETIC_DEMO_DATA scanner stderr must not enter notes. NOT_CUSTOMER_SOURCE." }, envelopeFor(0)),
    "customer_remediation_status_text_forbidden"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(status, { ...envelopeFor(0), idempotency_key: "manual-key" }),
    "customer_remediation_event_idempotency_key_not_derived"
  );
}

// C4-12: the builder previously accepted no classification context at all, so
// guidance could name a classification that never existed. It must now
// require an authoritative, intrinsically valid classification and bind
// every reference (including the embedded classification_context) to it.
function testReferenceMismatchGuardrails(controlPlane, classification, guidance, inconclusiveClassification) {
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0)),
    "remediation_guidance_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), {}),
    "remediation_guidance_reference_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), { classification: null }),
    "remediation_guidance_reference_mismatch"
  );
  // Nonexistent classification: a different, unrelated but intrinsically
  // valid classification record.
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), { classification: inconclusiveClassification }),
    "remediation_guidance_reference_mismatch"
  );
  // Drifted classification: matches on id/draft but disagrees on review_id.
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), { classification: { ...classification, review_id: "review:synthetic-demo-999" } }),
    "remediation_guidance_reference_mismatch"
  );
  // Schema-invalid classification must not be trusted merely because its ids match.
  const { rationale: _rationale, ...schemaInvalidClassification } = classification;
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), { classification: schemaInvalidClassification }),
    "remediation_guidance_reference_mismatch"
  );
  // Valid chain positive.
  const valid = controlPlane.buildFindingRemediationGuidanceEvent(guidance, envelopeFor(0), { classification });
  assert(valid.outcome === "built", `a genuinely authoritative classification must still build; got ${JSON.stringify(valid)}`);
}

async function testUnavailableGuidanceBranch(controlPlane, inconclusiveClassification, unavailableGuidance) {
  const event = await buildSealedGuidanceEvent(controlPlane, unavailableGuidance, 0, {}, { classification: inconclusiveClassification });
  assert(event.outcome === "built", `unavailable guidance must build a reviewer event; got ${JSON.stringify(event)}`);
  assert(event.event.event_type === "remediation_guidance_recorded", "unavailable guidance still records a reviewer guidance event");

  const projection = controlPlane.projectCustomerFacingFindingRecord({
    classification: inconclusiveClassification,
    remediation_guidance: unavailableGuidance,
    customer_status_records: []
  });
  assert(projection.outcome === "projected", `unavailable guidance must project; got ${JSON.stringify(projection)}`);
  assert(projection.record.reviewer_remediation_guidance.guidance_status === "guidance_unavailable_from_submitted_evidence", "projection preserves unavailable-guidance status");
  assert(projection.record.reviewer_remediation_guidance.insufficient_evidence_reason === unavailableGuidance.insufficient_evidence_reason, "projection preserves unavailable-guidance reason");
  assert(projection.record.reviewer_remediation_guidance.next_step_summary === unavailableGuidance.next_step_summary, "projection preserves unavailable-guidance next step");
}

function testProjectionSeparation(controlPlane, classification, validationClassification, guidance, validationPathOnlyGuidance, unavailableGuidance, status, laterStatus) {
  const result = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [status, laterStatus],
    evidence_consumer_export: "include"
  });
  assert(result.outcome === "projected", `customer-facing projection must build; got ${JSON.stringify(result)}`);
  const projection = result.record;
  assert(projection.expert_classification.classification === classification.classification, "projection preserves expert classification separately");
  assert(projection.reviewer_remediation_guidance.guidance_status === guidance.guidance_status, "projection preserves reviewer guidance separately");
  assert(projection.reviewer_remediation_guidance.exploitability_rationale_summary === guidance.exploitability_rationale, "projection preserves bounded exploitability rationale");
  assert(projection.customer_remediation_status.latest_status === laterStatus.customer_remediation_status, "projection derives latest customer status from status records");
  assert(projection.verification_state.status === "not_verified", "customer remediation is not treated as verification");
  assert(projection.future_outcome_visibility.accepted_risk_visible === false, "accepted risk is hidden unless later artifacts provide it");
  assert(projection.future_outcome_visibility.false_positive_visible === false, "false positive is hidden unless later artifacts provide it");
  assert(!JSON.stringify(projection).includes("customer_notes_summary"), "hidden customer notes are not exported by default");

  const validationPathOnlyProjection = controlPlane.projectCustomerFacingFindingRecord({
    classification: validationClassification,
    remediation_guidance: validationPathOnlyGuidance,
    customer_status_records: []
  });
  assert(validationPathOnlyProjection.outcome === "projected", `validation-path-only guidance must project; got ${JSON.stringify(validationPathOnlyProjection)}`);
  assert(
    validationPathOnlyProjection.record.reviewer_remediation_guidance.validation_path_ref === validationPathOnlyGuidance.validation_path_ref,
    "validation-path-ref-only guidance must preserve the customer-facing validation handoff"
  );
  assert(
    validationPathOnlyProjection.record.reviewer_remediation_guidance.validation_path_summary === undefined,
    "validation-path-ref-only guidance must not require a validation path summary"
  );
  assert(
    validationPathOnlyProjection.record.reviewer_remediation_guidance.insufficient_evidence_reason === validationPathOnlyGuidance.insufficient_evidence_reason,
    "limited guidance must preserve its insufficient-evidence reason"
  );
  assert(
    validationPathOnlyProjection.record.reviewer_remediation_guidance.next_step_summary === undefined,
    "validation-path-ref-only guidance must not require an unrelated next-step summary"
  );

  // C4-12: the classification-guidance binding is now checked inside
  // rejectionForFindingRemediationGuidance itself (called earlier, as part
  // of validating each input record), so a drifted review_id/classification
  // ref now fails closed at customer_facing_finding_input_invalid rather
  // than reaching the projector's own later, separate binding check.
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({ classification: { ...classification, review_id: "review:other-demo-001" }, remediation_guidance: guidance, customer_status_records: [] }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({ classification, remediation_guidance: { ...guidance, classification_record_ref: "classification_record:unrelated" }, customer_status_records: [] }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: guidance,
      customer_status_records: [{ ...status, classification_record_ref: "classification_record:unrelated" }]
    }),
    "customer_facing_finding_reference_mismatch"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: guidance,
      customer_status_records: [{ ...status, finding_ref: "review_finding_draft:unrelated" }]
    }),
    "customer_facing_finding_reference_mismatch"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: guidance,
      customer_status_records: [{ ...status, remediation_guidance_ref: "remediation_guidance:unrelated" }]
    }),
    "customer_facing_finding_reference_mismatch"
  );
}

function testProjectionSafetyAndDeterminism(controlPlane, classification, guidance, status) {
  const internalGuidanceResult = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: { ...guidance, visibility: "internal_only" },
    customer_status_records: []
  });
  assert(internalGuidanceResult.outcome === "projected", `internal-only guidance must project its no-guidance branch; got ${JSON.stringify(internalGuidanceResult)}`);
  assert(internalGuidanceResult.record.remediation_guidance_ref === undefined, "internal-only guidance must not expose its record reference");
  assert(internalGuidanceResult.record.reviewer_remediation_guidance.suggested_remediation_summary === undefined, "internal-only guidance must not expose remediation copy");

  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: { ...guidance, evidence_refs: [] },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );

  const duplicateEvidenceResult = controlPlane.projectCustomerFacingFindingRecord({
    classification: {
      ...classification,
      review_finding_draft_evidence_refs: [
        ...classification.review_finding_draft_evidence_refs,
        { ...classification.review_finding_draft_evidence_refs[0], display_state: "available_reference" }
      ]
    },
    customer_status_records: []
  });
  assert(duplicateEvidenceResult.outcome === "projected", `duplicate source refs must deduplicate before projection; got ${JSON.stringify(duplicateEvidenceResult)}`);
  assert(
    new Set(duplicateEvidenceResult.record.evidence_basis.evidence_refs).size === duplicateEvidenceResult.record.evidence_basis.evidence_refs.length,
    "projected evidence refs must be unique"
  );

  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      customer_status_records: [{ ...status, remediation_guidance_ref: guidance.remediation_guidance_id }]
    }),
    "customer_facing_finding_reference_mismatch"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: { ...guidance, source_reference_state: "not_submitted_by_policy", classification_context: { ...guidance.classification_context, source_reference_state: "not_submitted_by_policy" } },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );

  const noPolicyStatus = { ...status };
  delete noPolicyStatus.field_export_policy;
  const noPolicyResult = controlPlane.projectCustomerFacingFindingRecord({ classification, remediation_guidance: guidance, customer_status_records: [noPolicyStatus] });
  assert(noPolicyResult.outcome === "projected", `status without export policy must project safely; got ${JSON.stringify(noPolicyResult)}`);
  assert(noPolicyResult.record.customer_remediation_status.owner === undefined, "missing export policy must exclude owner");
  assert(noPolicyResult.record.customer_remediation_status.due_date === undefined, "missing export policy must exclude due date");
  assert(noPolicyResult.record.customer_remediation_status.target_state === undefined, "missing export policy must exclude target state");

  const simultaneousStatuses = [
    { ...status, customer_status_record_id: "customer_status:synthetic_status_tie_a", customer_remediation_status: "planned", recorded_at: "2026-07-23T02:00:00Z" },
    { ...status, customer_status_record_id: "customer_status:synthetic_status_tie_b", customer_remediation_status: "in_progress", recorded_at: "2026-07-23T02:00:00Z" }
  ];
  const tieBreakResult = controlPlane.projectCustomerFacingFindingRecord({ classification, remediation_guidance: guidance, customer_status_records: simultaneousStatuses });
  assert(tieBreakResult.outcome === "projected", `simultaneous statuses must project deterministically; got ${JSON.stringify(tieBreakResult)}`);
  assert(tieBreakResult.record.customer_remediation_status.latest_status_record_ref === "customer_status:synthetic_status_tie_b", "customer status tie-break must use the stable record id");
}

function testProjectionSemanticAndPrivacyBoundaries(controlPlane, classification, guidance, status) {
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification: { ...classification, visibility: "internal_only" },
      remediation_guidance: guidance,
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );

  const internalStatus = {
    ...status,
    customer_status_record_id: "customer_status:synthetic_internal_status_001",
    owner: "SYNTHETIC_DEMO_DATA internal owner sentinel NOT_CUSTOMER_SOURCE",
    visibility: "internal_only"
  };
  const internalStatusResult = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [internalStatus],
    evidence_consumer_export: "include"
  });
  assert(internalStatusResult.outcome === "projected", `internal-only status must be safely omitted; got ${JSON.stringify(internalStatusResult)}`);
  assert(internalStatusResult.record.customer_status_record_refs.length === 0, "internal-only status references must not enter a customer-facing projection");
  assert(!JSON.stringify(internalStatusResult.record).includes("internal owner sentinel"), "internal-only status metadata must not enter customer-facing copy");

  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: {
        ...guidance,
        classification_context: { ...guidance.classification_context, classification: "inconclusive" }
      },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: {
        ...guidance,
        classification_context: { ...guidance.classification_context, evidence_basis: ["metadata_only"] }
      },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: { ...guidance, evidence_refs: ["artifact_ref:completely_unrelated_evidence"] },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: guidance,
      customer_status_records: [{ ...status, due_date: "2026-02-30" }]
    }),
    "customer_facing_finding_input_invalid"
  );

  const defaultExport = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: []
  });
  assert(defaultExport.outcome === "projected", "projection without explicit evidence-consumer posture must still build");
  assert(defaultExport.record.evidence_consumer_export === "exclude", "projection must default evidence-consumer export to exclude");
}

function testCustomerStatusVocabulary(controlPlane, classification, guidance, status) {
  const statuses = ["not_started", "planned", "in_progress", "remediated_by_customer", "validation_pending", "deferred", "not_applicable"];
  for (const [index, value] of statuses.entries()) {
    const record = {
      ...status,
      customer_status_record_id: `customer_status:synthetic_status_${value}_001`,
      customer_remediation_status: value,
      recorded_at: `2026-07-24T00:0${index}:00Z`
    };
    const built = controlPlane.buildCustomerRemediationStatusEvent(record, envelopeFor(index));
    assert(built.outcome === "built", `${value} customer status must build; got ${JSON.stringify(built)}`);
    const projection = controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: guidance,
      customer_status_records: [record]
    });
    assert(projection.outcome === "projected", `${value} customer status must project; got ${JSON.stringify(projection)}`);
    assert(projection.record.customer_remediation_status.latest_status === value, `${value} status survives projection`);
  }
}

function testPositiveLaterOutcomeProjection(controlPlane, classification, guidance, acceptedRisk, falsePositive) {
  const result = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [],
    accepted_risk_records: [acceptedRisk],
    false_positive_records: [falsePositive],
    verification_record_ref: "verification_record:synthetic_verification_001",
    accepted_risk_record_ref: acceptedRisk.accepted_risk_record_id,
    false_positive_record_ref: falsePositive.false_positive_record_id,
    evidence_consumer_export: "include"
  });
  assert(result.outcome === "projected", `later outcome references must project; got ${JSON.stringify(result)}`);
  assert(result.record.verification_state.status === "verification_pending", "verification reference produces an explicit pending verification state");
  assert(result.record.verification_state.verification_record_ref === "verification_record:synthetic_verification_001", "verification reference survives projection");
  assert(result.record.future_outcome_visibility.accepted_risk_visible === true, "accepted-risk reference makes the later outcome visible");
  assert(result.record.future_outcome_visibility.accepted_risk_record_ref === acceptedRisk.accepted_risk_record_id, "accepted-risk reference survives projection");
  assert(result.record.future_outcome_visibility.false_positive_visible === true, "false-positive reference makes the later outcome visible");
  assert(result.record.future_outcome_visibility.false_positive_record_ref === falsePositive.false_positive_record_id, "false-positive reference survives projection");
  assert(result.record.accepted_risk_outcome.accepted_risk_record_ref === acceptedRisk.accepted_risk_record_id, "accepted-risk outcome section is record-backed");
  assert(result.record.false_positive_outcome.false_positive_record_ref === falsePositive.false_positive_record_id, "false-positive outcome section is record-backed");
}

function testMalformedInputsReturnUnions(controlPlane, guidance, status, classification) {
  for (const malformedRecord of [null, "guidance", 42, [guidance]]) {
    assertRejected(controlPlane.buildFindingRemediationGuidanceEvent(malformedRecord, envelopeFor(0)), "remediation_guidance_schema_invalid");
  }
  for (const malformedEnvelope of [null, "envelope", 42, []]) {
    assertRejected(controlPlane.buildFindingRemediationGuidanceEvent(guidance, malformedEnvelope), "remediation_guidance_schema_invalid");
    assertRejected(controlPlane.buildCustomerRemediationStatusEvent(status, malformedEnvelope), "customer_remediation_status_schema_invalid");
  }
  for (const malformedStatus of [null, "status", 42, [status]]) {
    assertRejected(controlPlane.buildCustomerRemediationStatusEvent(malformedStatus, envelopeFor(0)), "customer_remediation_status_schema_invalid");
  }
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, { ...envelopeFor(0), event_type: "customer_remediation_recorded" }, { classification }),
    "remediation_guidance_event_type_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, { ...envelopeFor(0), artifact_refs: ["artifact_ref:unrelated"] }, { classification }),
    "remediation_guidance_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.buildFindingRemediationGuidanceEvent(guidance, { ...envelopeFor(0), artifact_refs: ["artifact_ref:synthetic_likely_001", "artifact_ref:unrelated"] }, { classification }),
    "remediation_guidance_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(status, { ...envelopeFor(0), artifact_refs: ["artifact_ref:unrelated"] }),
    "customer_remediation_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.buildCustomerRemediationStatusEvent(status, { ...envelopeFor(0), artifact_refs: ["artifact_ref:synthetic_status_owner_due_001", "artifact_ref:unrelated"] }),
    "customer_remediation_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord(null),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({ classification, remediation_guidance: guidance, customer_status_records: null }),
    "customer_facing_finding_input_invalid"
  );
  const malformedClassification = { ...classification };
  delete malformedClassification.limitations;
  delete malformedClassification.confirmation_criteria;
  delete malformedClassification.review_finding_draft_evidence_refs;
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({ classification: malformedClassification, remediation_guidance: guidance, customer_status_records: [] }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification: { ...classification, rationale: "SYNTHETIC_DEMO_DATA raw scanner output must not enter projection copy. NOT_CUSTOMER_SOURCE." },
      remediation_guidance: guidance,
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );
  assertRejected(
    controlPlane.projectCustomerFacingFindingRecord({
      classification,
      remediation_guidance: { ...guidance, suggested_remediation: "SYNTHETIC_DEMO_DATA remediation gives SOC 2 acceptance. NOT_CUSTOMER_SOURCE." },
      customer_status_records: []
    }),
    "customer_facing_finding_input_invalid"
  );
}

async function buildSealedClassificationEvent(controlPlane, record, sequenceNumber) {
  const draft = controlPlane.buildFindingClassificationEvent(record, envelopeFor(sequenceNumber));
  if (draft.outcome !== "built") {
    return draft;
  }
  const eventId = await controlPlane.computeReviewEventId(draft.event);
  return controlPlane.buildFindingClassificationEvent(record, { ...envelopeFor(sequenceNumber), event_id: eventId });
}

async function buildSealedGuidanceEvent(controlPlane, record, sequenceNumber, extraEnvelope = {}, context = {}) {
  const envelope = { ...envelopeFor(sequenceNumber), ...extraEnvelope };
  const draft = controlPlane.buildFindingRemediationGuidanceEvent(record, envelope, context);
  if (draft.outcome !== "built") {
    return draft;
  }
  const eventId = await controlPlane.computeReviewEventId(draft.event);
  return controlPlane.buildFindingRemediationGuidanceEvent(record, { ...envelope, event_id: eventId }, context);
}

async function buildSealedStatusEvent(controlPlane, record, sequenceNumber, extraEnvelope = {}) {
  const envelope = { ...envelopeFor(sequenceNumber), ...extraEnvelope };
  const draft = controlPlane.buildCustomerRemediationStatusEvent(record, envelope);
  if (draft.outcome !== "built") {
    return draft;
  }
  const eventId = await controlPlane.computeReviewEventId(draft.event);
  return controlPlane.buildCustomerRemediationStatusEvent(record, { ...envelope, event_id: eventId });
}

async function sealEvent(controlPlane, event) {
  return { ...event, event_id: await controlPlane.computeReviewEventId(event) };
}

function envelopeFor(sequenceNumber) {
  return {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: sequenceNumber
  };
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assertRejected(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}; got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected reason ${expectedReason}; got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
