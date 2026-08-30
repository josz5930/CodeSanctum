// Story 3.2: finding classifications are reviewer-authored protocol artifacts
// recorded through the existing append-only review-event-log. The control-plane
// boundary builds only the event envelope; appendReviewEvent remains the single
// append path that owns ordering, idempotency, and supersedes protections.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-finding-classification-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-finding-classification-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  assert(typeof controlPlane.buildFindingClassificationEvent === "function", "buildFindingClassificationEvent must be exported");
  assert(typeof controlPlane.appendReviewEvent === "function", "appendReviewEvent must remain the append path");
  assert(!("appendFindingClassification" in controlPlane), "Story 3.2 must not add a second classification append path");

  const likely = await readFixture("valid/finding-classification-record.likely.json");
  const confirmed = await readFixture("valid/finding-classification-record.confirmed-submitted-evidence.json");
  const confirmedMetadata = await readFixture("valid/finding-classification-record.confirmed-metadata-defensible.json");
  const requiresValidation = await readFixture("valid/finding-classification-record.requires-validation.json");

  await testBuildAppendAndIdempotency(controlPlane, likely, confirmed);
  await testUpdateSupersedesSemantics(controlPlane, likely, confirmed, confirmedMetadata);
  await testCustomerCannotRewriteExpertClassification(controlPlane, likely);
  await testReviewerOnlyAuthority(controlPlane, likely);
  testClassificationGuardrails(controlPlane, likely, confirmed, requiresValidation);
  testMalformedInputsReturnUnions(controlPlane, likely);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane finding classification tests passed.");

async function testBuildAppendAndIdempotency(controlPlane, likely, confirmed) {
  const emptyLog = { protocol_version: "codeattest.v0", review_id: likely.review_id, events: [] };
  const first = await buildSealedClassificationEvent(controlPlane, likely, 0);

  assert(first.outcome === "built", `likely classification must build an event; got ${JSON.stringify(first)}`);
  assert(first.event.event_type === "classification_recorded", "classification records map to classification_recorded events");
  assert(first.event.artifact_refs.includes("artifact_ref:synthetic_likely_001"), "event references the classification artifact");
  assert(first.event.actor.actor_type === "reviewer", "classification event is authored by a reviewer actor");
  assert(first.event.reason.includes("Classification: likely."), "event history reason identifies the expert classification");
  assert(first.event.reason.includes("Evidence basis:"), "event history reason preserves evidence basis");
  assert(first.event.reason.includes(likely.rationale), "event history reason preserves reviewer rationale");
  assert(
    first.event.idempotency_key === `classification:${likely.review_id}:${likely.classification_record_id}`,
    "idempotency key derives from review and classification record identity"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, {
      ...envelopeFor(0),
      reason: "SYNTHETIC_DEMO_DATA token=caller_override must not replace the derived history reason. NOT_CUSTOMER_SOURCE."
    }),
    "classification_event_schema_invalid"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(
      { ...likely, visibility: "internal_only" },
      { ...envelopeFor(0), visibility: "customer_facing" }
    ),
    "classification_event_schema_invalid"
  );

  const firstAppend = await controlPlane.appendReviewEvent(emptyLog, first.event);
  assert(firstAppend.outcome === "appended", `first classification append must succeed; got ${JSON.stringify(firstAppend)}`);
  assert(emptyLog.events.length === 0, "appendReviewEvent must not mutate the input log");

  const replay = await controlPlane.appendReviewEvent(firstAppend.log, first.event);
  assert(replay.outcome === "idempotent_noop", `identical classification replay must be idempotent; got ${replay.outcome}`);
  assert(replay.log.events.length === 1, "idempotent replay must not grow the log");

  const conflictingRecord = {
    ...confirmed,
    classification_record_id: likely.classification_record_id,
    classified_at: "2026-07-22T00:04:00Z",
    rationale: "SYNTHETIC_DEMO_DATA different expert judgment body under a reused classification id. NOT_CUSTOMER_SOURCE."
  };
  const conflicting = await buildSealedClassificationEvent(controlPlane, conflictingRecord, 1);
  assert(conflicting.outcome === "built", "conflicting body must still build before append detects idempotency conflict");
  const conflictAppend = await controlPlane.appendReviewEvent(firstAppend.log, conflicting.event);
  assert(conflictAppend.outcome === "rejected", "different body under the same classification idempotency key must reject");
  assert(conflictAppend.reason === "review_event_log_idempotency_key_conflict", `expected idempotency conflict; got ${conflictAppend.reason}`);
  assert(conflictAppend.log.events.length === 1, "conflicting append returns unchanged log");
}

async function testUpdateSupersedesSemantics(controlPlane, likely, confirmed, confirmedMetadata) {
  const first = await buildSealedClassificationEvent(controlPlane, likely, 0);
  const firstAppend = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: likely.review_id, events: [] }, first.event);
  assert(firstAppend.outcome === "appended", "first event must append before update tests");

  const updateRecord = {
    ...confirmed,
    classification_record_id: "classification_record:synthetic_confirmed_update_001",
    classified_at: "2026-07-22T00:05:00Z",
    supersedes_classification_record_ref: likely.classification_record_id,
    supersedes_event_id: first.event.event_id
  };
  const update = await buildSealedClassificationEvent(controlPlane, updateRecord, 1);
  assert(update.outcome === "built", `classification update must build; got ${JSON.stringify(update)}`);
  assert(update.event.supersedes_event_id === first.event.event_id, "update event preserves supersedes_event_id");
  assert(update.event.supersedes_classification_record_ref === likely.classification_record_id, "update event preserves the prior classification record reference");
  assert(update.event.reason.includes(likely.classification_record_id), "event history reason preserves the superseded classification record reference");

  const updatedLog = await controlPlane.appendReviewEvent(firstAppend.log, update.event);
  assert(updatedLog.outcome === "appended", `classification update append must succeed; got ${JSON.stringify(updatedLog)}`);
  assert(updatedLog.log.events.length === 2, "update is appended rather than rewriting prior history");
  assert(JSON.stringify(updatedLog.log.events[0]) === JSON.stringify(first.event), "prior classification event remains byte-identical");

  const refOnlyUpdateRecord = {
    ...confirmedMetadata,
    classification_record_id: "classification_record:synthetic_confirmed_ref_update_001",
    classified_at: "2026-07-22T00:06:00Z",
    supersedes_classification_record_ref: likely.classification_record_id
  };
  const refOnlyUpdate = controlPlane.buildFindingClassificationEvent(refOnlyUpdateRecord, envelopeFor(2));
  assert(refOnlyUpdate.outcome === "built", "a prior classification record reference is sufficient update context");
  assert(refOnlyUpdate.event.supersedes_event_id === undefined, "record-reference-only updates do not invent an event supersedes link");

  const envelopeOnlyUpdate = controlPlane.buildFindingClassificationEvent(
    confirmed,
    { ...envelopeFor(1), supersedes_event_id: first.event.event_id }
  );
  assert(envelopeOnlyUpdate.outcome === "built", "an envelope supersedes_event_id is sufficient update context");
  assert(envelopeOnlyUpdate.event.supersedes_event_id === first.event.event_id, "envelope-only update preserves its prior event reference");
  assertRejected(
    controlPlane.buildFindingClassificationEvent(updateRecord, { ...envelopeFor(1), supersedes_event_id: `sha256:${"c".repeat(64)}` }),
    "classification_event_supersedes_mismatch"
  );

  const unknownRefRecord = {
    ...confirmedMetadata,
    classification_record_id: "classification_record:synthetic_confirmed_unknown_ref_001",
    classified_at: "2026-07-22T00:06:30Z",
    supersedes_classification_record_ref: "classification_record:does_not_exist"
  };
  const unknownRefEvent = await buildSealedClassificationEvent(controlPlane, unknownRefRecord, 2);
  assert(unknownRefEvent.outcome === "built", "unknown prior artifact is resolved by the authoritative append path");
  assertRejected(
    await controlPlane.appendReviewEvent(firstAppend.log, unknownRefEvent.event),
    "review_event_log_supersedes_unknown_event"
  );
}

async function testCustomerCannotRewriteExpertClassification(controlPlane, likely) {
  const classification = await buildSealedClassificationEvent(controlPlane, likely, 0);
  const appended = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: likely.review_id, events: [] }, classification.event);
  assert(appended.outcome === "appended", "classification event must append before customer rewrite test");

  for (const eventType of ["customer_remediation_recorded", "customer_accepted_risk_recorded", "validation_recorded"]) {
    const customerEvent = {
      protocol_version: "codeattest.v0",
      event_id: `sha256:${"0".repeat(64)}`,
      review_id: likely.review_id,
      sequence_number: 1,
      idempotency_key: `${eventType}:synthetic-demo-001`,
      event_type: eventType,
      actor: { actor_type: "customer_user", actor_id: "customer:synthetic-owner" },
      event_timestamp: "2026-07-22T00:07:00Z",
      artifact_refs: ["artifact_ref:synthetic_customer_update_001"],
      visibility: "customer_facing",
      canonicalization: "rfc8785",
      identity_hash_algorithm: "sha256",
      identity_input_excludes: ["event_id"],
      supersedes_event_id: classification.event.event_id,
      reason: "SYNTHETIC_DEMO_DATA customer workflow state must not rewrite expert classification. NOT_CUSTOMER_SOURCE."
    };
    customerEvent.event_id = await controlPlane.computeReviewEventId(customerEvent);
    const result = await controlPlane.appendReviewEvent(appended.log, customerEvent);
    assert(result.outcome === "rejected", `${eventType} must not supersede an expert classification`);
    assert(result.reason === "customer_event_cannot_supersede_classification", `expected customer rewrite protection; got ${result.reason}`);
    assert(result.log.events.length === 1, "rejected customer rewrite leaves classification history unchanged");
  }

  const directRecordRefRewrite = {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: likely.review_id,
    sequence_number: 1,
    idempotency_key: "customer_remediation:synthetic-direct-classification-rewrite",
    event_type: "customer_remediation_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic-owner" },
    event_timestamp: "2026-07-22T00:07:30Z",
    artifact_refs: ["artifact_ref:synthetic_customer_update_002"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    supersedes_classification_record_ref: likely.classification_record_id
  };
  directRecordRefRewrite.event_id = await controlPlane.computeReviewEventId(directRecordRefRewrite);
  assertRejected(
    await controlPlane.appendReviewEvent(appended.log, directRecordRefRewrite),
    "customer_event_cannot_supersede_classification"
  );
}

async function testReviewerOnlyAuthority(controlPlane, likely) {
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...likely, actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }, envelopeFor(0)),
    "finding_classification_reviewer_actor_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), actor: { actor_type: "customer_user", actor_id: "customer:synthetic" } }),
    "classification_event_actor_mismatch"
  );

  const forgedEvent = {
    protocol_version: "codeattest.v0",
    event_id: `sha256:${"0".repeat(64)}`,
    review_id: likely.review_id,
    sequence_number: 0,
    idempotency_key: "classification:forged-customer-authority",
    event_type: "classification_recorded",
    actor: { actor_type: "customer_user", actor_id: "customer:synthetic" },
    event_timestamp: "2026-07-22T00:08:00Z",
    artifact_refs: ["artifact_ref:synthetic_forged_classification"],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"]
  };
  forgedEvent.event_id = await controlPlane.computeReviewEventId(forgedEvent);
  const result = await controlPlane.appendReviewEvent({ protocol_version: "codeattest.v0", review_id: likely.review_id, events: [] }, forgedEvent);
  assert(result.outcome === "rejected", `customer-authored classification_recorded append must reject; got ${JSON.stringify(result)}`);
  assert(result.reason === "review_event_classification_reviewer_actor_required", `expected reviewer actor append rejection; got ${result.reason}`);
}

function testClassificationGuardrails(controlPlane, likely, confirmed, requiresValidation) {
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, confirmation_criteria: [] }, envelopeFor(0)),
    "finding_classification_confirmed_criteria_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, confirmation_criteria: ["   "] }, envelopeFor(0)),
    "finding_classification_confirmed_criteria_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, confirmation_criteria: ["aaaaaaaaaaaa"] }, envelopeFor(0)),
    "finding_classification_confirmed_criteria_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({
      ...confirmed,
      evidence_basis: ["scanner_output", "retained_review_artifact"],
      defensible_confirmation_criteria: undefined
    }, envelopeFor(0)),
    "finding_classification_confirmed_defensible_criteria_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...requiresValidation, validation_path_summary: "   ", validation_path_ref: undefined }, envelopeFor(0)),
    "finding_classification_validation_path_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...requiresValidation, validation_path_summary: undefined, validation_path_ref: "validation_path:received_with_receipt" }, envelopeFor(0)),
    "finding_classification_text_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, evidence_basis: [] }, envelopeFor(0)),
    "finding_classification_evidence_basis_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({
      ...confirmed,
      evidence_basis: ["extended_approved_source_context", "retained_review_artifact"]
    }, envelopeFor(0)),
    "finding_classification_evidence_basis_not_bound_to_draft"
  );
  const retainedRef = {
    artifact_ref: "artifact_ref:synthetic_unbound_retained",
    availability_state: "retained_review_artifact",
    available_for_review: true,
    display_state: "available_reference",
    source_derived_class: "retained_review_artifact"
  };
  const scannerRef = {
    artifact_ref: "artifact_ref:scanner_finding_set",
    availability_state: "retained_review_artifact",
    available_for_review: true,
    display_state: "available_reference",
    source_derived_class: "retained_review_artifact"
  };
  const snippetRef = {
    artifact_ref: "artifact_ref:synthetic_raw_snippet",
    availability_state: "retained_review_artifact",
    available_for_review: true,
    display_state: "available_reference",
    source_derived_class: "transient_source_derived"
  };
  const bindingCases = [
    ["scanner_output", "wrong artifact ref", { ...scannerRef, artifact_ref: "artifact_ref:not_scanner_output" }],
    ["scanner_output", "deleted scanner output", { ...scannerRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }],
    ["scanner_output", "not-submitted scanner output", { ...scannerRef, availability_state: "not_submitted_by_policy", display_state: "not_submitted", available_for_review: false }],
    ["metadata_only", "deleted metadata ref", { ...retainedRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }],
    ["metadata_only", "unresolved metadata ref", { ...retainedRef, availability_state: "unresolved_reference", display_state: "unresolved_reference", available_for_review: false }],
    ["finding_context_snippet", "retained artifact is not a snippet", retainedRef],
    ["finding_context_snippet", "withheld snippet is unavailable", { ...snippetRef, available_for_review: false, display_state: "not_submitted", availability_state: "not_submitted_by_policy" }],
    ["retained_review_artifact", "snippet is not retained review artifact", snippetRef],
    ["retained_review_artifact", "deleted retained artifact", { ...retainedRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }],
    ["deleted_under_policy_reference", "retained ref is not deleted", retainedRef],
    ["deleted_under_policy_reference", "unresolved ref is not deleted", { ...retainedRef, availability_state: "unresolved_reference", display_state: "unresolved_reference", available_for_review: false }],
    ["deleted_under_policy_reference", "deleted ref without deletion evidence", { ...retainedRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }],
    ["not_submitted_by_policy_reference", "retained ref is not not-submitted", retainedRef],
    ["not_submitted_by_policy_reference", "deleted ref is not not-submitted", { ...retainedRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }],
    ["never_collected_reference", "retained ref is not never-collected", retainedRef],
    ["never_collected_reference", "not-submitted ref is not never-collected", { ...retainedRef, availability_state: "not_submitted_by_policy", display_state: "not_submitted", available_for_review: false }],
    ["unresolved_reference", "retained ref is not unresolved", retainedRef],
    ["unresolved_reference", "deleted ref is not unresolved", { ...retainedRef, availability_state: "deleted_under_policy", display_state: "deleted", available_for_review: false }]
  ];
  for (const [basis, scenario, ref] of bindingCases) {
    assertRejected(
      controlPlane.buildFindingClassificationEvent({
        ...likely,
        classification_record_id: `classification_record:synthetic_unbound_${basis}_${slug(scenario)}`,
        evidence_basis: [basis],
        review_finding_draft_evidence_refs: [ref],
        source_reference_state: ref.availability_state
      }, envelopeFor(0)),
      "finding_classification_evidence_basis_not_bound_to_draft"
    );
  }
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, source_reference_state: "never_collected" }, envelopeFor(0)),
    "finding_classification_source_reference_state_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, limitations: [] }, envelopeFor(0)),
    "finding_classification_limitations_required"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, scanner_execution: "SYNTHETIC_DEMO_DATA forbidden scanner execution field" }, envelopeFor(0)),
    "finding_classification_forbidden_field"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, rationale: "SYNTHETIC_DEMO_DATA eval('1 + 1') must not enter rationale. NOT_CUSTOMER_SOURCE." }, envelopeFor(0)),
    "finding_classification_text_forbidden"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent({ ...confirmed, rationale: "SYNTHETIC_DEMO_DATA no vulnerabilities claim must not enter rationale. NOT_CUSTOMER_SOURCE." }, envelopeFor(0)),
    "finding_classification_text_forbidden"
  );

  const ordinaryReviewerProse = controlPlane.buildFindingClassificationEvent({
    ...confirmed,
    rationale: "SYNTHETIC_DEMO_DATA customer submitted metadata and reviewer received attestation context from a certified training fixture. NOT_CUSTOMER_SOURCE."
  }, envelopeFor(0));
  assert(ordinaryReviewerProse.outcome === "built", `ordinary reviewer prose must not trip claim safety; got ${JSON.stringify(ordinaryReviewerProse)}`);

  // C4-18: source-like code that avoids the exact SOURCE_TEXT_FORBIDDEN_PHRASES
  // list must still be caught — the content class has no other matching guard.
  assertRejected(
    controlPlane.buildFindingClassificationEvent(
      { ...confirmed, rationale: "SYNTHETIC_DEMO_DATA src/auth.ts:42 if (!user.isAdmin) { eval(userInput); } NOT_CUSTOMER_SOURCE." },
      envelopeFor(0)
    ),
    "finding_classification_text_forbidden"
  );
  const bareLocation = controlPlane.buildFindingClassificationEvent(
    { ...confirmed, rationale: "SYNTHETIC_DEMO_DATA reviewer confirmed the finding at src/auth.ts:42 during manual review. NOT_CUSTOMER_SOURCE." },
    envelopeFor(0)
  );
  assert(bareLocation.outcome === "built", `a bare source location must remain allowed; got ${JSON.stringify(bareLocation)}`);
  const authorizationProse = controlPlane.buildFindingClassificationEvent(
    { ...confirmed, rationale: "SYNTHETIC_DEMO_DATA the authorization condition requires customer validation before this finding can close. NOT_CUSTOMER_SOURCE." },
    envelopeFor(0)
  );
  assert(authorizationProse.outcome === "built", `ordinary authorization prose must remain allowed; got ${JSON.stringify(authorizationProse)}`);
}

function testMalformedInputsReturnUnions(controlPlane, likely) {
  for (const malformedRecord of [null, "classification", 42, [likely]]) {
    assertRejected(controlPlane.buildFindingClassificationEvent(malformedRecord, envelopeFor(0)), "finding_classification_schema_invalid");
  }
  for (const malformedEnvelope of [null, "envelope", 42, []]) {
    assertRejected(controlPlane.buildFindingClassificationEvent(likely, malformedEnvelope), "finding_classification_schema_invalid");
  }
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), event_type: "validation_recorded" }),
    "classification_event_type_mismatch"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), artifact_refs: ["artifact_ref:unrelated_record"] }),
    "classification_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), artifact_refs: ["artifact_ref:synthetic_likely_001", "artifact_ref:unrelated_record"] }),
    "classification_event_missing_record_ref"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), idempotency_key: "manual-key" }),
    "classification_event_idempotency_key_not_derived"
  );
  assertRejected(
    controlPlane.buildFindingClassificationEvent(likely, { ...envelopeFor(0), sequence_number: Number.NaN }),
    "classification_event_schema_invalid"
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

function envelopeFor(sequenceNumber) {
  return {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: sequenceNumber
  };
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
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
