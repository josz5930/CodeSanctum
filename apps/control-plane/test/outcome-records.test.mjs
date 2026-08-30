// Story 3.5: false-positive and accepted-risk records are protocol-owned
// outcome artifacts recorded through the append-only review log.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-outcome-records-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-outcome-records-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of ["buildFalsePositiveEvent", "buildCustomerAcceptedRiskEvent", "appendReviewEvent", "projectCustomerFacingFindingRecord"]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const classification = await readFixture("finding-classification-record.likely.json");
  const falsePositive = await readFixture("false-positive-record.reviewer.json");
  const acceptedRisk = await readFixture("accepted-risk-record.customer-rationale.json");
  const vendorAcceptedRisk = await readFixture("accepted-risk-record.vendor-signoff.json");
  const guidance = await readFixture("finding-remediation-guidance.likely-actionable.json");
  const validationClassification = await readFixture("finding-classification-record.requires-validation.json");
  const validationGuidance = await readFixture("finding-remediation-guidance.requires-validation-path-only.json");
  const validationPath = await readFixture("finding-validation-path.customer-run-script.json");
  const validationScript = await readFixture("reviewer-validation-script.included-slot-1.json");
  const status = await readFixture("customer-remediation-status-record.owner-due-date.json");

  await testOutcomeBuildersAndAppend(controlPlane, classification, falsePositive, acceptedRisk);
  testOutcomeBuilderGuardrails(controlPlane, classification, falsePositive, acceptedRisk, vendorAcceptedRisk, guidance, validationClassification, validationGuidance, validationPath, validationScript);
  await testAppendBoundaryBackstops(controlPlane, falsePositive, acceptedRisk);
  await testOutcomeSupersedesFamilyBackstops(controlPlane, classification, falsePositive, acceptedRisk);
  testCustomerFacingOutcomeProjection(controlPlane, classification, falsePositive, acceptedRisk, guidance, status, validationClassification, validationGuidance, validationPath, validationScript);
  testLatestRecordSelectionIsNanosecondAware(controlPlane, classification, acceptedRisk, status);
  testMalformedInputsReturnUnions(controlPlane, falsePositive, acceptedRisk);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane outcome record tests passed.");

async function testOutcomeBuildersAndAppend(controlPlane, classification, falsePositive, acceptedRisk) {
  const classificationEvent = await buildSealedClassificationEvent(controlPlane, classification, 0);
  assert(classificationEvent.outcome === "built", `classification precondition must build; got ${JSON.stringify(classificationEvent)}`);
  const first = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: classification.review_id, events: [] }, classificationEvent.event);
  assert(first.outcome === "appended", `classification append precondition must pass; got ${JSON.stringify(first)}`);

  const fpEvent = await buildSealedFalsePositiveEvent(controlPlane, falsePositive, 1, { classification });
  assert(fpEvent.outcome === "built", `false-positive event must build; got ${JSON.stringify(fpEvent)}`);
  assert(fpEvent.event.event_type === "false_positive_recorded", "false-positive uses dedicated event type");
  assert(fpEvent.event.actor.actor_type === "reviewer", "false-positive event is reviewer-authored");
  assert(fpEvent.event.artifact_refs.length === 1 && fpEvent.event.artifact_refs[0] === "artifact_ref:synthetic_reviewer_001", "false-positive event uses exact singleton typed artifact ref");
  assert(fpEvent.event.idempotency_key === `false_positive:${falsePositive.review_id}:${falsePositive.false_positive_record_id}`, "false-positive idempotency derives from typed identity");
  const fpAppend = await controlPlane.appendReviewEvent(first.log, fpEvent.event);
  assert(fpAppend.outcome === "appended", `false-positive append must pass; got ${JSON.stringify(fpAppend)}`);

  const arEvent = await buildSealedAcceptedRiskEvent(controlPlane, acceptedRisk, 2, { classification });
  assert(arEvent.outcome === "built", `accepted-risk event must build; got ${JSON.stringify(arEvent)}`);
  assert(arEvent.event.event_type === "customer_accepted_risk_recorded", "accepted risk uses existing customer_accepted_risk_recorded event type");
  assert(arEvent.event.artifact_refs.length === 1 && arEvent.event.artifact_refs[0] === "artifact_ref:synthetic_customer_001", "accepted-risk event uses exact singleton typed artifact ref");
  assert(arEvent.event.idempotency_key === `accepted_risk:${acceptedRisk.review_id}:${acceptedRisk.accepted_risk_record_id}`, "accepted-risk idempotency derives from typed identity");
  const arAppend = await controlPlane.appendReviewEvent(fpAppend.log, arEvent.event);
  assert(arAppend.outcome === "appended", `accepted-risk append must pass; got ${JSON.stringify(arAppend)}`);
  assert(Object.isFrozen(arAppend.log.events[0].actor), "returned prior events are deeply frozen");
  const originalActor = classificationEvent.event.actor.actor_id;
  try { arAppend.log.events[0].actor.actor_id = "mutated"; } catch {}
  assert(arAppend.log.events[0].actor.actor_id === originalActor, "returned append log event history resists caller mutation");
  try { classificationEvent.event.actor.actor_id = "mutated-source"; } catch {}
  assert(arAppend.log.events[0].actor.actor_id === originalActor, "returned append log does not share event objects with caller inputs");
  const replay = await controlPlane.appendReviewEvent(arAppend.log, arEvent.event);
  assert(replay.outcome === "idempotent_noop", "identical accepted-risk replay is idempotent");
}

function testOutcomeBuilderGuardrails(controlPlane, classification, falsePositive, acceptedRisk, vendorAcceptedRisk, guidance, validationClassification, validationGuidance, validationPath, validationScript) {
  assertRejected(controlPlane.buildFalsePositiveEvent({ ...falsePositive, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, envelopeFor(0), { classification }), "false_positive_record_reviewer_actor_required");
  assertRejected(controlPlane.buildFalsePositiveEvent({ ...falsePositive, classification_record_ref: "classification_record:other" }, envelopeFor(0), { classification }), "false_positive_record_reference_mismatch");
  assertRejected(controlPlane.buildFalsePositiveEvent(falsePositive, envelopeFor(0), { classification: { ...classification, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } } }), "false_positive_record_reference_mismatch");
  assertRejected(controlPlane.buildFalsePositiveEvent({ ...falsePositive, rationale: "SYNTHETIC_DEMO_DATA token: unsafe marker. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification }), "false_positive_record_text_forbidden");
  assertRejected(controlPlane.buildFalsePositiveEvent(falsePositive, { ...envelopeFor(0), artifact_refs: ["artifact_ref:wrong"] }, { classification }), "false_positive_event_missing_record_ref");
  assertRejected(controlPlane.buildFalsePositiveEvent(falsePositive, { ...envelopeFor(0), idempotency_key: "false_positive:wrong" }, { classification }), "false_positive_event_idempotency_key_not_derived");

  const missingAcceptance = { ...acceptedRisk };
  delete missingAcceptance.customer_rationale;
  delete missingAcceptance.customer_actor_ref;
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(missingAcceptance, envelopeFor(0), { classification }), "accepted_risk_record_customer_acceptance_required");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent({ ...acceptedRisk, classification: "accepted_risk" }, envelopeFor(0), { classification }), "accepted_risk_record_rewrite_forbidden");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent({ ...acceptedRisk, classification_record_ref: "classification_record:other" }, envelopeFor(0), { classification }), "accepted_risk_record_reference_mismatch");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent({ ...acceptedRisk, scope_of_acceptance: "SYNTHETIC_DEMO_DATA accepted risk must not claim independent assurance. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification }), "accepted_risk_record_text_forbidden");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent({ ...acceptedRisk, scope_of_acceptance: "SYNTHETIC_DEMO_DATA customer says this finding is fixed and verified. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification }), "accepted_risk_record_text_forbidden");
  const safeNegated = controlPlane.buildCustomerAcceptedRiskEvent({ ...acceptedRisk, scope_of_acceptance: "SYNTHETIC_DEMO_DATA accepted risk does not mean the finding is fixed or verified. NOT_CUSTOMER_SOURCE." }, envelopeFor(0), { classification });
  assert(safeNegated.outcome === "built", `safe negated fixed/verified copy must build; got ${JSON.stringify(safeNegated)}`);
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(acceptedRisk, { ...envelopeFor(0), event_type: "customer_remediation_recorded" }, { classification }), "accepted_risk_event_type_mismatch");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(acceptedRisk, { ...envelopeFor(0), artifact_refs: ["artifact_ref:wrong"] }, { classification }), "accepted_risk_event_missing_record_ref");

  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(acceptedRisk, envelopeFor(0), { classification: { ...classification, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } } }), "accepted_risk_record_reference_mismatch");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(vendorAcceptedRisk, envelopeFor(0), { classification, remediation_guidance: { ...guidance, review_finding_draft_ref: "review_finding_draft:other" }, validation_path: validationPath }), "accepted_risk_record_reference_mismatch");
  const validationAcceptedRisk = {
    ...vendorAcceptedRisk,
    review_finding_draft_ref: validationClassification.review_finding_draft_ref,
    classification_record_ref: validationClassification.classification_record_id,
    review_finding_draft_evidence_refs: validationClassification.review_finding_draft_evidence_refs,
    evidence_basis: validationClassification.evidence_basis,
    source_reference_state: validationClassification.source_reference_state,
    remediation_context_ref: validationGuidance.remediation_guidance_id,
    validation_path_ref: validationPath.validation_path_id
  };
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(validationAcceptedRisk, envelopeFor(0), { classification: validationClassification, remediation_guidance: validationGuidance, validation_path: { ...validationPath, source_reference_state: "deleted_under_policy" }, reviewer_validation_scripts: [validationScript] }), "accepted_risk_record_reference_mismatch");
  const withCustomerRunScript = controlPlane.buildCustomerAcceptedRiskEvent(validationAcceptedRisk, envelopeFor(0), { classification: validationClassification, remediation_guidance: validationGuidance, validation_path: validationPath, reviewer_validation_scripts: [validationScript] });
  assert(withCustomerRunScript.outcome === "built", `accepted risk must bind to valid customer-run-script validation path context; got ${JSON.stringify(withCustomerRunScript)}`);
  const vendorResult = controlPlane.buildCustomerAcceptedRiskEvent(vendorAcceptedRisk, envelopeFor(0), { classification, remediation_guidance: guidance });
  assert(vendorResult.outcome === "built", `vendor-recorded accepted risk with sign-off evidence must build; got ${JSON.stringify(vendorResult)}`);
}

async function testAppendBoundaryBackstops(controlPlane, falsePositive, acceptedRisk) {
  const forgedCustomerFalsePositive = await sealEvent(controlPlane, {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: falsePositive.review_id,
    sequence_number: 0,
    idempotency_key: `false_positive:${falsePositive.review_id}:${falsePositive.false_positive_record_id}`,
    event_type: "false_positive_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic" },
    event_timestamp: "2026-07-28T02:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_reviewer_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: falsePositive.review_id, events: [] }, forgedCustomerFalsePositive), "review_event_false_positive_reviewer_actor_required");

  const forgedAcceptedRisk = await sealEvent(controlPlane, {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: acceptedRisk.review_id,
    sequence_number: 0,
    idempotency_key: `accepted_risk:${acceptedRisk.review_id}:${acceptedRisk.accepted_risk_record_id}`,
    event_type: "customer_accepted_risk_recorded",
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic-amelia" },
    event_timestamp: "2026-07-28T02:05:00Z",
    artifact_refs: ["artifact_ref:synthetic_customer_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason: "Accepted risk recorded without explicit customer evidence."
  });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedAcceptedRisk), "review_event_accepted_risk_customer_evidence_required");

  const forgedLocalRunner = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: { actor_type: "local_runner", actor_id: "runner:synthetic" }, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. Customer rationale: customer approved carrying residual risk for the bounded demo finding.`, event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedLocalRunner), "review_event_accepted_risk_customer_evidence_required");

  const forgedOutcomeSupersedesClassificationRef = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. Customer rationale: customer approved carrying residual risk for the bounded demo finding.`, supersedes_classification_record_ref: "classification_record:synthetic_likely_001", event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedOutcomeSupersedesClassificationRef), "review_event_outcome_supersedes_family_mismatch");

  const forgedCustomerNoReason = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: undefined, event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedCustomerNoReason), "review_event_accepted_risk_customer_evidence_required");

  const forgedNegatedReason = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. No customer rationale was provided.`, event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedNegatedReason), "review_event_accepted_risk_customer_evidence_required");

  const forgedExtraRefs = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. Customer rationale: customer approved carrying residual risk for the bounded demo finding.`, artifact_refs: ["artifact_ref:synthetic_customer_001", "artifact_ref:unrelated"], event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, forgedExtraRefs), "review_event_schema_invalid");

  const internalSourceReason = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. Customer rationale: token: synthetic secret.`, visibility: "internal_only", event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, internalSourceReason), "review_event_reason_raw_source_text_forbidden");
  const internalClaimReason = await sealEvent(controlPlane, { ...forgedAcceptedRisk, actor: acceptedRisk.actor, reason: `Accepted risk recorded for ${acceptedRisk.review_finding_draft_ref}. Customer rationale: regulator approval granted for synthetic demo.`, visibility: "internal_only", event_id: `sha256:${"0".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: acceptedRisk.review_id, events: [] }, internalClaimReason), "review_event_reason_claim_unsafe_text_forbidden");
}

async function testOutcomeSupersedesFamilyBackstops(controlPlane, classification, falsePositive, acceptedRisk) {
  const classificationEvent = await buildSealedClassificationEvent(controlPlane, classification, 0);
  const seeded = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: classification.review_id, events: [] }, classificationEvent.event);
  assert(seeded.outcome === "appended", "classification event precondition appends");
  const falsePositiveEvent = await buildSealedFalsePositiveEvent(controlPlane, falsePositive, 1, { classification });
  assert(falsePositiveEvent.outcome === "built", "false-positive event precondition builds");
  const withFalsePositive = await controlPlane.appendReviewEvent(seeded.log, falsePositiveEvent.event);
  assert(withFalsePositive.outcome === "appended", "false-positive precondition appends");

  const acceptedRiskPrecondition = await buildSealedAcceptedRiskEvent(controlPlane, acceptedRisk, 2, { classification });
  assert(acceptedRiskPrecondition.outcome === "built", "accepted-risk event precondition builds");
  const withBothOutcomes = await controlPlane.appendReviewEvent(withFalsePositive.log, acceptedRiskPrecondition.event);
  assert(withBothOutcomes.outcome === "appended", "accepted-risk precondition appends");
  const fpSupersedesAcceptedRisk = await sealEvent(controlPlane, { ...falsePositiveEvent.event, event_id: `sha256:${"0".repeat(64)}`, sequence_number: 3, idempotency_key: "false_positive:review:synthetic-demo-001:false_positive:synthetic_reviewer_002", artifact_refs: ["artifact_ref:synthetic_reviewer_002"], supersedes_event_id: acceptedRiskPrecondition.event.event_id });
  assertRejected(await controlPlane.appendReviewEvent(withBothOutcomes.log, fpSupersedesAcceptedRisk), "review_event_outcome_supersedes_family_mismatch");

  const classificationSupersedesFp = await sealEvent(controlPlane, { ...classificationEvent.event, event_id: `sha256:${"0".repeat(64)}`, sequence_number: 3, idempotency_key: "classification:review:synthetic-demo-001:classification_record:synthetic_likely_002", artifact_refs: ["artifact_ref:synthetic_likely_002"], supersedes_event_id: falsePositiveEvent.event.event_id });
  assertRejected(await controlPlane.appendReviewEvent(withFalsePositive.log, classificationSupersedesFp), "review_event_outcome_supersedes_family_mismatch");

  const customerRemediation = await sealEvent(controlPlane, {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: acceptedRisk.review_id,
    sequence_number: 3,
    idempotency_key: "customer_remediation:review:synthetic-demo-001:customer_status:synthetic_status_for_family_001",
    event_type: "customer_remediation_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-maya" },
    event_timestamp: "2026-07-28T02:20:00Z",
    artifact_refs: ["artifact_ref:synthetic_status_for_family_001"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  });
  const withCustomerStatus = await controlPlane.appendReviewEvent(withBothOutcomes.log, customerRemediation);
  assert(withCustomerStatus.outcome === "appended", "customer remediation precondition appends");
  const arSupersedesCustomerStatus = await sealEvent(controlPlane, { ...acceptedRiskPrecondition.event, event_id: `sha256:${"0".repeat(64)}`, sequence_number: 4, idempotency_key: "accepted_risk:review:synthetic-demo-001:accepted_risk:synthetic_customer_003", artifact_refs: ["artifact_ref:synthetic_customer_003"], supersedes_event_id: customerRemediation.event_id });
  assertRejected(await controlPlane.appendReviewEvent(withCustomerStatus.log, arSupersedesCustomerStatus), "review_event_outcome_supersedes_family_mismatch");

  const fpCorrection = await sealEvent(controlPlane, { ...falsePositiveEvent.event, event_id: `sha256:${"0".repeat(64)}`, sequence_number: 3, idempotency_key: "false_positive:review:synthetic-demo-001:false_positive:synthetic_reviewer_004", artifact_refs: ["artifact_ref:synthetic_reviewer_004"], supersedes_event_id: falsePositiveEvent.event.event_id });
  const withFpCorrection = await controlPlane.appendReviewEvent(withBothOutcomes.log, fpCorrection);
  assert(withFpCorrection.outcome === "appended", `same-family false-positive correction must append; got ${JSON.stringify(withFpCorrection)}`);
  const arCorrection = await sealEvent(controlPlane, { ...acceptedRiskPrecondition.event, event_id: `sha256:${"0".repeat(64)}`, sequence_number: 3, idempotency_key: "accepted_risk:review:synthetic-demo-001:accepted_risk:synthetic_customer_004", artifact_refs: ["artifact_ref:synthetic_customer_004"], supersedes_event_id: acceptedRiskPrecondition.event.event_id });
  const withArCorrection = await controlPlane.appendReviewEvent(withBothOutcomes.log, arCorrection);
  assert(withArCorrection.outcome === "appended", `same-family accepted-risk correction must append; got ${JSON.stringify(withArCorrection)}`);
}

function testCustomerFacingOutcomeProjection(controlPlane, classification, falsePositive, acceptedRisk, guidance, status, validationClassification, validationGuidance, validationPath, validationScript) {
  const projected = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: guidance,
    customer_status_records: [status],
    accepted_risk_records: [acceptedRisk],
    false_positive_records: [falsePositive],
    evidence_consumer_export: "include"
  });
  assert(projected.outcome === "projected", `outcome projection must succeed; got ${JSON.stringify(projected)}`);
  assert(projected.record.review_finding_draft_ref === classification.review_finding_draft_ref, "finding remains present in customer-facing record");
  assert(projected.record.accepted_risk_outcome.accepted_risk_record_ref === acceptedRisk.accepted_risk_record_id, "accepted-risk section is record backed");
  assert(projected.record.false_positive_outcome.false_positive_record_ref === falsePositive.false_positive_record_id, "false-positive section is record backed");
  assert(projected.record.accepted_risk_outcome.customer_acceptance_summary.includes("accepted residual risk"), "accepted-risk section preserves customer rationale/sign-off summary");
  assert(projected.record.false_positive_outcome.rationale_summary === falsePositive.rationale, "false-positive section preserves reviewer rationale");
  assert(projected.record.verification_state.status === "not_verified", "outcome records do not mark verification complete");
  assert(projected.record.customer_remediation_status.latest_status === "planned", "accepted risk coexists with remediation history without rewriting status");

  const internalOutcome = controlPlane.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], accepted_risk_records: [{ ...acceptedRisk, visibility: "internal_only" }] });
  assert(internalOutcome.outcome === "projected", "internal-only outcome is omitted rather than leaked");
  assert(internalOutcome.record.accepted_risk_outcome === undefined, "internal-only accepted risk does not project to customers");

  const danglingRef = controlPlane.projectCustomerFacingFindingRecord({ classification, customer_status_records: [], accepted_risk_record_ref: acceptedRisk.accepted_risk_record_id });
  assert(danglingRef.outcome === "rejected" && danglingRef.reason === "customer_facing_finding_reference_mismatch", "requesting an outcome ref without a supplied record fails closed");

  const tiedAcceptedRisk = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    customer_status_records: [],
    accepted_risk_records: [acceptedRisk, { ...acceptedRisk, accepted_risk_record_id: "accepted_risk:synthetic_tie_001" }]
  });
  assert(tiedAcceptedRisk.outcome === "rejected" && tiedAcceptedRisk.reason === "customer_facing_finding_reference_mismatch", "tied accepted-risk records without requested ref fail closed");
  const tiedFalsePositive = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    customer_status_records: [],
    false_positive_records: [falsePositive, { ...falsePositive, false_positive_record_id: "false_positive:synthetic_tie_001" }]
  });
  assert(tiedFalsePositive.outcome === "rejected" && tiedFalsePositive.reason === "customer_facing_finding_reference_mismatch", "tied false-positive records without requested ref fail closed");

  const excluded = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    customer_status_records: [],
    accepted_risk_records: [{ ...acceptedRisk, field_export_policy: { customer_rationale: "exclude", customer_signoff_summary: "exclude", risk_owner: "exclude", scope_of_acceptance: "exclude", limitations: "exclude", evidence_basis: "exclude", evidence_consumer_export: "include" } }],
    false_positive_records: [{ ...falsePositive, field_export_policy: { rationale: "exclude", limitations: "exclude", evidence_basis: "exclude", candidate_finding_refs: "exclude", evidence_consumer_export: "include" } }],
    evidence_consumer_export: "include"
  });
  assert(excluded.outcome === "projected", `export-policy projection must succeed; got ${JSON.stringify(excluded)}`);
  assert(!JSON.stringify(excluded.record).includes(acceptedRisk.customer_rationale), "accepted-risk rationale excluded by export policy does not project");
  assert(!JSON.stringify(excluded.record).includes(falsePositive.rationale), "false-positive rationale excluded by export policy does not project");
  assert(!JSON.stringify(excluded.record).includes("candidate_finding:synthetic_semgrep_001"), "candidate provenance excluded by export policy does not project");
  assert(!excluded.record.accepted_risk_outcome.evidence_basis_summary.includes("scanner_output"), "accepted-risk evidence basis excluded by export policy does not project details");
  assert(!excluded.record.false_positive_outcome.evidence_basis_summary.includes("scanner_output"), "false-positive evidence basis excluded by export policy does not project details");
  assert(excluded.record.accepted_risk_outcome.evidence_refs.length === 0, "excluded accepted-risk evidence basis does not fabricate artifact refs");
  assert(excluded.record.false_positive_outcome.evidence_refs.length === 0, "excluded false-positive evidence basis does not fabricate artifact refs");

  const validationAcceptedRisk = {
    ...acceptedRisk,
    review_finding_draft_ref: validationClassification.review_finding_draft_ref,
    classification_record_ref: validationClassification.classification_record_id,
    review_finding_draft_evidence_refs: validationClassification.review_finding_draft_evidence_refs,
    evidence_basis: validationClassification.evidence_basis,
    source_reference_state: validationClassification.source_reference_state,
    remediation_context_ref: validationGuidance.remediation_guidance_id,
    validation_path_ref: validationPath.validation_path_id
  };
  const combined = controlPlane.projectCustomerFacingFindingRecord({
    classification: validationClassification,
    remediation_guidance: validationGuidance,
    customer_status_records: [],
    validation_paths: [validationPath],
    reviewer_validation_scripts: [validationScript],
    accepted_risk_records: [validationAcceptedRisk],
    evidence_consumer_export: "include"
  });
  assert(combined.outcome === "projected", `accepted risk must coexist with remediation and validation history; got ${JSON.stringify(combined)}`);
  assert(combined.record.validation_paths?.some((path) => path.validation_path_ref === validationPath.validation_path_id), "combined projection retains validation paths");
  assert(combined.record.reviewer_validation_scripts?.some((script) => script.validation_script_ref === validationScript.validation_script_id), "combined projection retains reviewer validation scripts");
  assert(combined.record.accepted_risk_outcome.validation_path_ref === validationPath.validation_path_id, "accepted-risk outcome retains visible validation path ref");

  const hiddenGuidanceRef = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    remediation_guidance: { ...guidance, visibility: "internal_only" },
    customer_status_records: [],
    accepted_risk_records: [{ ...acceptedRisk, remediation_context_ref: guidance.remediation_guidance_id }]
  });
  assert(hiddenGuidanceRef.outcome === "rejected" && hiddenGuidanceRef.reason === "customer_facing_finding_reference_mismatch", "outcome refs to internal-only guidance fail closed");
  const hiddenPathRef = controlPlane.projectCustomerFacingFindingRecord({
    classification: validationClassification,
    remediation_guidance: validationGuidance,
    customer_status_records: [],
    validation_paths: [{ ...validationPath, visibility: "internal_only" }],
    reviewer_validation_scripts: [{ ...validationScript, visibility: "internal_only" }],
    accepted_risk_records: [{ ...validationAcceptedRisk, remediation_context_ref: undefined }]
  });
  assert(hiddenPathRef.outcome === "rejected", "outcome refs to internal-only validation paths fail closed");

  // C4-18: source-like code that avoids the exact SOURCE_TEXT_FORBIDDEN_PHRASES
  // list must still be caught in the customer-facing finding projection.
  // (Caught by the classification builder's own rule, reapplied to the input
  // record here — `customer_facing_finding_input_invalid` fires before the
  // projection's own `customerFacingFindingHasForbiddenText` guard is ever
  // reached, which is defense-in-depth for the same content once projected.)
  const sourceLikeRationale = controlPlane.projectCustomerFacingFindingRecord({
    classification: { ...classification, rationale: "NOT_CUSTOMER_SOURCE src/auth.ts:42 if (!user.isAdmin) { eval(userInput); }" },
    customer_status_records: []
  });
  assert(
    sourceLikeRationale.outcome === "rejected" && sourceLikeRationale.reason === "customer_facing_finding_input_invalid",
    `source-code-like rationale must fail closed; got ${JSON.stringify(sourceLikeRationale)}`
  );
  const bareLocationRationale = controlPlane.projectCustomerFacingFindingRecord({
    classification: { ...classification, rationale: "NOT_CUSTOMER_SOURCE reviewer confirmed the finding at src/auth.ts:42 during manual review." },
    customer_status_records: []
  });
  assert(bareLocationRationale.outcome === "projected", `a bare source location must remain allowed; got ${JSON.stringify(bareLocationRationale)}`);
}

// C4-14: "latest record" selection must compare true nanosecond-precision UTC
// instants, not RFC 3339 string spelling (Z vs +00:00) or millisecond-rounded
// Date.parse, and must never let array order silently break a genuine tie.
function testLatestRecordSelectionIsNanosecondAware(controlPlane, classification, acceptedRisk, status) {
  const sameInstantDifferentSpelling = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    customer_status_records: [],
    accepted_risk_records: [
      { ...acceptedRisk, recorded_at: "2026-07-28T02:05:00Z" },
      { ...acceptedRisk, accepted_risk_record_id: "accepted_risk:synthetic_same_instant_001", recorded_at: "2026-07-28T02:05:00.000+00:00" }
    ]
  });
  assert(
    sameInstantDifferentSpelling.outcome === "rejected" && sameInstantDifferentSpelling.reason === "customer_facing_finding_reference_mismatch",
    `same instant spelled as Z and +00:00 must be recognized as a genuine tie and fail closed, not silently ordered by string; got ${JSON.stringify(sameInstantDifferentSpelling)}`
  );

  // Sub-millisecond difference: Date.parse truncates both to the same millisecond,
  // so a millisecond-precision comparison would treat these as tied and fall back to
  // an ID tie-break. The nanosecond-aware selector must instead recognize record B as
  // strictly later and select it deterministically, regardless of ID ordering.
  const { remediation_guidance_ref: _droppedGuidanceRef, ...statusWithoutGuidanceRef } = status;
  const earlierWithLaterId = { ...statusWithoutGuidanceRef, recorded_at: "2026-07-23T01:00:00.0001Z" };
  const laterWithEarlierId = { ...statusWithoutGuidanceRef, customer_status_record_id: "customer_status:synthetic_aaa_earlier_id_001", recorded_at: "2026-07-23T01:00:00.0002Z" };
  const subMillisecondOrdering = controlPlane.projectCustomerFacingFindingRecord({
    classification,
    customer_status_records: [earlierWithLaterId, laterWithEarlierId]
  });
  assert(subMillisecondOrdering.outcome === "projected", `sub-millisecond status ordering must still project; got ${JSON.stringify(subMillisecondOrdering)}`);
  assert(
    subMillisecondOrdering.record.customer_remediation_status.latest_status_record_ref === laterWithEarlierId.customer_status_record_id,
    "the record with the true later nanosecond instant must be selected even though its ID sorts first"
  );
}

function testMalformedInputsReturnUnions(controlPlane, falsePositive, acceptedRisk) {
  for (const value of [null, "outcome", 42, []]) {
    assertRejected(controlPlane.buildFalsePositiveEvent(value, envelopeFor(0), {}), "false_positive_record_schema_invalid");
    assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(value, envelopeFor(0), {}), "accepted_risk_record_schema_invalid");
  }
  assertRejected(controlPlane.buildFalsePositiveEvent(falsePositive, null, {}), "false_positive_record_schema_invalid");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(acceptedRisk, null, {}), "accepted_risk_record_schema_invalid");
  assertRejected(controlPlane.buildFalsePositiveEvent(falsePositive, envelopeFor(0), null), "false_positive_record_reference_mismatch");
  assertRejected(controlPlane.buildCustomerAcceptedRiskEvent(acceptedRisk, envelopeFor(0), null), "accepted_risk_record_reference_mismatch");
}

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

async function buildSealedClassificationEvent(controlPlane, classification, sequenceNumber) {
  const draft = controlPlane.buildFindingClassificationEvent(classification, envelopeFor(sequenceNumber));
  if (draft.outcome !== "built") return draft;
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function buildSealedFalsePositiveEvent(controlPlane, record, sequenceNumber, context) {
  const draft = controlPlane.buildFalsePositiveEvent(record, envelopeFor(sequenceNumber), context);
  if (draft.outcome !== "built") return draft;
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function buildSealedAcceptedRiskEvent(controlPlane, record, sequenceNumber, context) {
  const draft = controlPlane.buildCustomerAcceptedRiskEvent(record, envelopeFor(sequenceNumber), context);
  if (draft.outcome !== "built") return draft;
  return { outcome: "built", event: await sealEvent(controlPlane, draft.event) };
}

async function sealEvent(controlPlane, event) {
  return { ...event, event_id: await controlPlane.computeReviewEventId(event) };
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertRejected(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}, got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected ${expectedReason}, got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
