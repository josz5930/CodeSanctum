// Story 2.6 AC2/AC3: failed submission outcomes are recorded through the
// existing review-event-log, not a second history artifact, and failure notices
// remain claim-safe while successes project to nothing.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CLAIM_SAFE_FORBIDDEN_PHRASES } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-submission-outcome-event-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-submission-outcome-event-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  assert(typeof controlPlane.buildSubmissionOutcomeEvent === "function", "buildSubmissionOutcomeEvent must be exported");
  assert(typeof controlPlane.appendReviewEvent === "function", "appendReviewEvent must remain the append path");
  assert(typeof controlPlane.projectSubmissionFailureNotice === "function", "projectSubmissionFailureNotice must be exported");
  assert(!("appendSubmissionAttempt" in controlPlane), "Story 2.6 must not add a second submission history append path");

  const rejected = await readFixture("valid/submission-outcome.rejected-no-receipt.json");
  const quarantined = await readFixture("valid/submission-outcome.quarantined-no-receipt.json");
  const received = await readFixture("valid/submission-outcome.received-with-receipt.json");

  await testFailureEventBuildAndAppend(controlPlane, rejected, quarantined);
  testEventContradictions(controlPlane, rejected, received);
  testSubmissionIdentityBinding(controlPlane, rejected);
  testFailureNoticeTextSafety(controlPlane, rejected);
  testFailureNoticeShape(controlPlane, quarantined, rejected);
  testClaimUnsafeRuntimeSummaryIsRefused(controlPlane, quarantined);
  testReceivedProjectsToNull(controlPlane, received);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane submission outcome event tests passed.");

async function testFailureEventBuildAndAppend(controlPlane, rejected, quarantined) {
  const emptyLog = { protocol_version: "codeattest.v0", review_id: rejected.review_id, events: [] };
  const first = await buildSealedEvent(controlPlane, rejected, 0);
  assert(first.outcome === "built", `rejected outcome must build an event; got ${JSON.stringify(first)}`);
  assert(first.event.event_type === "submission_rejected", "rejected outcome maps to submission_rejected");
  assert(first.event.artifact_refs.includes("artifact_ref:synthetic-demo-0001"), "event references its outcome artifact");
  assert(first.event.artifact_refs.length === 1, "event references exactly one (the outcome) artifact ref");
  assert(
    first.event.idempotency_key === `submission_attempt:${rejected.bundle_instance_id}:${rejected.submission_attempt_id}`,
    "idempotency key derives from bundle and attempt identity"
  );

  const firstAppend = await controlPlane.appendReviewEvent(emptyLog, first.event);
  assert(firstAppend.outcome === "appended", `first append must succeed; got ${JSON.stringify(firstAppend)}`);
  assert(emptyLog.events.length === 0, "appendReviewEvent must not mutate the input log");

  const second = await buildSealedEvent(controlPlane, quarantined, 1);
  const secondAppend = await controlPlane.appendReviewEvent(firstAppend.log, second.event);
  assert(secondAppend.outcome === "appended", `distinct retry append must succeed; got ${JSON.stringify(secondAppend)}`);
  assert(secondAppend.log.events.length === 2, "review-event-log holds both submission events");
  assert(firstAppend.log.events.length === 1, "prior log value remains unchanged");
  assert(JSON.stringify(secondAppend.log.events[0]) === JSON.stringify(first.event), "prior event stays byte-identical");

  const reused = await buildSealedEvent(controlPlane, { ...rejected, submission_outcome_id: "submission_outcome:synthetic-demo-0009" }, 2);
  const duplicate = await controlPlane.appendReviewEvent(firstAppend.log, reused.event);
  assert(duplicate.outcome === "rejected", "reusing the attempt identity conflicts through appendReviewEvent");
  assert(duplicate.reason === "review_event_log_idempotency_key_conflict", `expected idempotency conflict; got ${duplicate.reason}`);
  assert(duplicate.log.events.length === 1, "conflicting append returns the unchanged log");
}

function testEventContradictions(controlPlane, rejected, received) {
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(received, envelopeFor(received, 0)),
    "submission_event_state_not_a_failure"
  );
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(rejected, { ...envelopeFor(rejected, 0), event_type: "submission_quarantined" }),
    "submission_event_type_state_mismatch"
  );
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(rejected, { ...envelopeFor(rejected, 0), artifact_refs: ["artifact_ref:missing_outcome"] }),
    "submission_event_missing_outcome_ref"
  );
  // C4-09: the expected outcome ref plus an extra ref must still be
  // rejected, not silently narrowed to the expected singleton.
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(rejected, {
      ...envelopeFor(rejected, 0),
      artifact_refs: ["artifact_ref:synthetic-demo-0001", "artifact_ref:unrelated_extra"]
    }),
    "submission_event_missing_outcome_ref"
  );
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(rejected, { ...envelopeFor(rejected, 0), idempotency_key: "manual-key" }),
    "submission_event_idempotency_key_not_derived"
  );
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent({ ...rejected, failure_reason_codes: [] }, envelopeFor(rejected, 0)),
    "submission_outcome_failure_requires_reason_codes"
  );
}

// C4-11: append-time review-event text checks do not protect this
// independently callable projector — the shared source-text/claim-safe/PII
// guards must apply to the rendered summary and every identity_value.
function testFailureNoticeTextSafety(controlPlane, rejected) {
  for (const forbiddenSummary of [
    "Raw scanner output showed the failure: eval('1 + 1')",
    "Investigate secret=sk_live_abc123 in the submitted evidence.",
    "Contact ops-lead@example.com for details.",
    "Customer support line: phone: 555-0100000."
  ]) {
    const outcome = { ...rejected, customer_facing_summary: forbiddenSummary };
    assertRejected(controlPlane.buildSubmissionOutcomeEvent(outcome, envelopeFor(outcome, 0)), "submission_outcome_summary_text_forbidden");
    assert(controlPlane.projectSubmissionFailureNotice(outcome, "customer") === null, `projector must return null for forbidden summary text: ${forbiddenSummary}`);
  }

  // C5-22: every identity_type now has a strict per-type value grammar
  // (sha256 hex for manifest_id/evidence_bundle_id), which no realistic
  // narrative/secret-leakage text can satisfy -- so these are now caught
  // earlier, as a grammar violation, rather than reaching the narrative
  // forbidden-phrase check at all.
  for (const forbiddenValue of ["raw scanner output: token=abc123", "contact support@example.com for a manual retry"]) {
    const outcome = {
      ...rejected,
      submission_identities: rejected.submission_identities.map((row) => row.identity_type === "manifest_id" ? { ...row, identity_value: forbiddenValue } : row)
    };
    assertRejected(controlPlane.buildSubmissionOutcomeEvent(outcome, envelopeFor(outcome, 0)), "submission_outcome_schema_invalid");
    assert(controlPlane.projectSubmissionFailureNotice(outcome, "customer") === null, `projector must return null for grammar-invalid identity_value: ${forbiddenValue}`);
  }

  // Valid structural identities (sha256:, bundle_instance:, submission_attempt:)
  // must remain byte-for-byte unchanged and must not trip the text guard.
  const notice = controlPlane.projectSubmissionFailureNotice(rejected, "customer");
  assert(notice !== null, "a genuinely clean outcome must still project a notice");
  assert(
    JSON.stringify(notice.submission_identities) === JSON.stringify(rejected.submission_identities.map((identity) => ({ ...identity }))),
    "valid structural identity values must survive projection byte-for-byte unchanged"
  );
}

// C4-10: submission_identities rows must not merely be schema-uniqueItems —
// there must be at most one row per identity_type, and the bundle_instance_id
// / submission_attempt_id rows must be present and equal the outcome's own
// top-level fields.
function testSubmissionIdentityBinding(controlPlane, rejected) {
  const bundleRow = rejected.submission_identities.find((row) => row.identity_type === "bundle_instance_id");
  const attemptRow = rejected.submission_identities.find((row) => row.identity_type === "submission_attempt_id");
  assert(bundleRow !== undefined && attemptRow !== undefined, "fixture setup: base outcome must carry both identity rows");

  const duplicateType = {
    ...rejected,
    submission_identities: [...rejected.submission_identities, { identity_type: "bundle_instance_id", identity_value: "bundle_instance:synthetic-demo-9999" }]
  };
  assertRejected(controlPlane.buildSubmissionOutcomeEvent(duplicateType, envelopeFor(rejected, 0)), "submission_outcome_duplicate_identity_type");

  const missingBundleRow = { ...rejected, submission_identities: rejected.submission_identities.filter((row) => row.identity_type !== "bundle_instance_id") };
  assertRejected(controlPlane.buildSubmissionOutcomeEvent(missingBundleRow, envelopeFor(rejected, 0)), "submission_outcome_identity_field_mismatch");

  const missingAttemptRow = { ...rejected, submission_identities: rejected.submission_identities.filter((row) => row.identity_type !== "submission_attempt_id") };
  assertRejected(controlPlane.buildSubmissionOutcomeEvent(missingAttemptRow, envelopeFor(rejected, 0)), "submission_outcome_identity_field_mismatch");

  const mismatchedBundleValue = {
    ...rejected,
    submission_identities: rejected.submission_identities.map((row) => row.identity_type === "bundle_instance_id" ? { ...row, identity_value: "bundle_instance:synthetic-demo-9999" } : row)
  };
  assertRejected(controlPlane.buildSubmissionOutcomeEvent(mismatchedBundleValue, envelopeFor(rejected, 0)), "submission_outcome_identity_field_mismatch");

  const mismatchedAttemptValue = {
    ...rejected,
    submission_identities: rejected.submission_identities.map((row) => row.identity_type === "submission_attempt_id" ? { ...row, identity_value: "submission_attempt:synthetic-demo-9999" } : row)
  };
  assertRejected(controlPlane.buildSubmissionOutcomeEvent(mismatchedAttemptValue, envelopeFor(rejected, 0)), "submission_outcome_identity_field_mismatch");

  const valid = controlPlane.buildSubmissionOutcomeEvent(rejected, envelopeFor(rejected, 0));
  assert(valid.outcome === "built", `a genuinely bound identity set must still build; got ${JSON.stringify(valid)}`);
}

function testFailureNoticeShape(controlPlane, quarantined, rejected) {
  for (const outcome of [quarantined, rejected]) {
    const notice = controlPlane.projectSubmissionFailureNotice(outcome, "customer");
    assert(notice !== null, `${outcome.outcome_state} must project a notice`);
    assert(notice.outcome_state === outcome.outcome_state, "the notice states the outcome it came from");
    assert(notice.audience === "customer", "the notice carries the target audience for field-for-field UI composition");
    assert(
      notice.submission_identities.length === outcome.submission_identities.length,
      "every submission identity must reach the notice"
    );
    assert(notice.next_paths.includes(outcome.next_path), "the outcome's own next path must be offered");
    assert(notice.next_paths.includes("contact_support"), "a support path must always accompany it");
    assert(notice.failure_reason_codes.length > 0, "a failure notice carries its reason codes");

    const summary = notice.customer_facing_summary.toLowerCase();
    for (const phrase of CLAIM_SAFE_FORBIDDEN_PHRASES) {
      assert(!summary.includes(phrase), `notice copy must not contain claim-unsafe phrase: ${phrase}`);
    }
  }

  assert(controlPlane.projectSubmissionFailureNotice({ ...rejected, failure_reason_codes: [] }) === null, "an invalid failure projects null");
  for (const value of [null, "outcome", 7]) {
    assert(controlPlane.projectSubmissionFailureNotice(value) === null, "malformed input projects null");
  }
}

function testClaimUnsafeRuntimeSummaryIsRefused(controlPlane, quarantined) {
  const claimUnsafe = {
    ...quarantined,
    customer_facing_summary: "CodeAttest reviewed and received this submitted evidence."
  };
  assertRejected(
    controlPlane.buildSubmissionOutcomeEvent(claimUnsafe, envelopeFor(claimUnsafe, 0)),
    "submission_outcome_summary_implies_review"
  );
  assert(controlPlane.projectSubmissionFailureNotice(claimUnsafe) === null, "claim-unsafe runtime copy must not project a notice");
}

function testReceivedProjectsToNull(controlPlane, received) {
  assert(controlPlane.projectSubmissionFailureNotice(received) === null, "a received outcome never renders as a blocking warning");
}

async function buildSealedEvent(controlPlane, outcome, sequenceNumber) {
  const draft = controlPlane.buildSubmissionOutcomeEvent(outcome, envelopeFor(outcome, sequenceNumber));
  if (draft.outcome !== "built") {
    return draft;
  }
  const eventId = await controlPlane.computeReviewEventId(draft.event);
  return controlPlane.buildSubmissionOutcomeEvent(outcome, { ...envelopeFor(outcome, sequenceNumber), event_id: eventId });
}

function envelopeFor(outcome, sequenceNumber) {
  return {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: sequenceNumber,
    actor: { actor_type: "vendor_service", actor_id: "SYNTHETIC_DEMO_DATA-intake-service" },
    visibility: "customer_facing",
    event_timestamp: outcome.occurred_at
  };
}

function assertRejected(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}; got ${JSON.stringify(result)}`);
  assert(result.reason === expectedReason, `expected reason ${expectedReason}; got ${result.reason}`);
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
