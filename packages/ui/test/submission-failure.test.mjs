// Story 2.6 AC3: a failed submission renders as a blocking risk warning naming
// every known identity with at least one actionable next path, and the timeline
// reads the existing review-event-log rather than a bespoke history artifact.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CLAIM_SAFE_FORBIDDEN_PHRASES } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-submission-failure-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-submission-failure-test-dist");

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
    path.join(tempDir, "ui.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "control-plane.tsbuildinfo")
  ], {
    cwd: path.join(repoRoot, "apps", "control-plane"),
    stdio: "pipe"
  });

  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  const protocolTs = await import(pathToFileURL(path.join(outDir, "packages", "protocol-ts", "src", "index.js")).href);
  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  assert(typeof ui.SubmissionFailureNotice === "function", "SubmissionFailureNotice must be exported");
  assert(typeof ui.buildSubmissionAttemptTimeline === "function", "buildSubmissionAttemptTimeline must be exported");
  assert(!("buildSubmissionAttemptHistoryTimeline" in ui), "UI must not export the obsolete bespoke history timeline");

  const quarantined = await readFixture("valid/submission-outcome.quarantined-no-receipt.json");
  const rejected = await readFixture("valid/submission-outcome.rejected-no-receipt.json");
  const received = await readFixture("valid/submission-outcome.received-with-receipt.json");
  const log = await readFixture("valid/review-event-log.submission-failures.json");

  testCustomerQuarantineNotice(ui, noticeForOutcome(quarantined, "customer"));
  testRejectedNoticeForVendor(ui, noticeForOutcome(rejected, "vendor"));
  testReceivedOutcomeDoesNotRender(ui, received);
  testEveryIdentityIsNamed(ui, noticeForOutcome(rejected, "vendor"), rejected);
  testRiskWarningBackCompat(ui);
  testNoticeGuardsMalformedIdentities(ui, noticeForOutcome(rejected, "vendor"));
  testAttemptTimeline(ui, protocolTs, log);
  testTimelineDropsVisibilityGatedEvents(ui, log);
  testTimelineGuardsMalformedEvents(ui, log);
  testTimelineRejectsLowercaseUtcMarkers(ui, protocolTs, log);
  testProjectionComposesWithRenderer(ui, controlPlane, quarantined);
  testStateBoundNextPaths(ui, rejected, quarantined);
  testUnsafeAndMalformedNoticesRejected(ui, noticeForOutcome(rejected, "vendor"));
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("ui submission failure tests passed.");

/**
 * Story 2.1 drops a `quarantine` next path entirely for a customer audience, so
 * the renderer itself must keep a support path available after audience gating.
 */
function testCustomerQuarantineNotice(ui, notice) {
  const view = ui.SubmissionFailureNotice(notice);
  assert(view !== null, "a quarantined outcome must render");
  assert(view.role === "alert" && view.ariaLive === "assertive", "a failure notice is a blocking alert");
  assert(view.riskType === "quarantined_no_receipt", "the risk type names the outcome state");
  assert(view.doesNotRelyOnColor === true, "status must never rely on color alone");

  const pathTypes = view.nextPaths.map((nextPath) => nextPath.type);
  assert(!pathTypes.includes("quarantine"), "the quarantine path is not shown to a customer");
  assert(pathTypes.includes("support"), "a customer quarantine notice must still offer support");
  assert(view.nextPaths.some((nextPath) => nextPath.actionable), "at least one next path must be actionable");
  assertClaimSafe(view);

  const fallback = ui.SubmissionFailureNotice({ ...notice, next_paths: ["quarantine_support"] });
  assert(fallback.nextPaths.some((nextPath) => nextPath.type === "support"), "UI supplies support if audience gating would empty paths");
}

function testRejectedNoticeForVendor(ui, notice) {
  const view = ui.SubmissionFailureNotice(notice);
  assert(view.riskType === "rejected_no_receipt", "the risk type names the outcome state");
  assert(view.nextPaths.some((nextPath) => nextPath.type === "retry"), "a rejected submission offers retry");
  assert(view.nextPaths.some((nextPath) => nextPath.type === "support"), "a support path always accompanies it");
  assertClaimSafe(view);

  const quarantineView = ui.SubmissionFailureNotice({
    ...notice,
    outcome_state: "quarantined_no_receipt",
    next_paths: ["quarantine_support", "contact_support"],
    audience: "ops"
  });
  const quarantinePath = quarantineView.nextPaths.find((nextPath) => nextPath.type === "quarantine");
  assert(quarantinePath !== undefined && quarantinePath.actionable, "ops keeps an actionable quarantine path");
}

/** A success is never a blocking warning, and there is no receipt banner here. */
function testReceivedOutcomeDoesNotRender(ui, received) {
  assert(ui.SubmissionFailureNotice(noticeForOutcome(received, "customer")) === null, "a received outcome must not render as a risk warning");
  assert(ui.SubmissionFailureNotice(noticeForOutcome(received, "vendor")) === null, "a received outcome must not render for any audience");
  for (const value of [null, undefined, "notice", 7]) {
    assert(ui.SubmissionFailureNotice(value) === null, "malformed props render nothing");
  }
}

/** AC3: every known submission identity must be named, not just the first. */
function testEveryIdentityIsNamed(ui, notice, outcome) {
  const view = ui.SubmissionFailureNotice(notice);
  assert(
    view.affectedIdentities.length === outcome.submission_identities.length,
    `every identity must be rendered; got ${view.affectedIdentities.length} of ${outcome.submission_identities.length}`
  );
  for (const identity of outcome.submission_identities) {
    assert(
      view.affectedIdentities.some((rendered) => rendered.value === identity.identity_value),
      `identity ${identity.identity_type} is missing from the view`
    );
  }
  assert(view.affectedIdentity.value === view.affectedIdentities[0].value, "the singular field stays populated for back-compat");
}

/** The widened prop must not break the Story 2.1 single-identity callers. */
function testRiskWarningBackCompat(ui) {
  const single = ui.RiskWarning({
    title: "Verification failed",
    message: "The submitted bundle did not verify.",
    riskType: "failed_verification",
    audience: "vendor",
    affectedIdentity: { label: "Evidence Bundle", value: "sha256:abc" }
  });
  assert(single.affectedIdentity.value === "sha256:abc", "a single identity still populates affectedIdentity");
  assert(single.affectedIdentities.length === 1, "a single identity yields one entry");

  for (const absent of [undefined, null, []]) {
    const view = ui.RiskWarning({
      title: "Verification failed",
      message: "The submitted bundle did not verify.",
      riskType: "failed_verification",
      audience: "vendor",
      affectedIdentity: absent
    });
    assert(view.affectedIdentities.length === 1, "an absent identity still yields one entry");
    assert(view.affectedIdentity.value === "unavailable", "the placeholder identity is preserved");
  }
}

/** Prior attempts stay visible through review-event-log sequence order. */
function testAttemptTimeline(ui, protocolTs, log) {
  const entries = ui.buildSubmissionAttemptTimeline(log, "customer");
  const submissionEvents = log.events.filter((event) => event.event_type === "submission_rejected" || event.event_type === "submission_quarantined");
  assert(entries.length === submissionEvents.length, "every submission event must render");
  assert(entries[0].outcomeEventType === "submission_rejected", "the rejected attempt stays visible first");
  assert(entries[1].outcomeEventType === "submission_quarantined", "the distinct retry is rendered after the prior attempt");
  assert(entries[0].sequenceNumber < entries[1].sequenceNumber, "timeline follows sequence_number order");
  for (const entry of entries) {
    assert(entry.view.kind === "timeline-event", "valid attempts render through the timeline primitive");
    assert(entry.view.artifactReferences.length > 0, "each attempt names its outcome artifact ref");
  }

  assert(ui.buildSubmissionAttemptTimeline({ ...log, events: [] }, "customer").length === 0, "an empty log renders nothing");
  assert(ui.buildSubmissionAttemptTimeline(null, "customer").length === 0, "null input renders nothing");

  const invalidTimestamp = structuredClone(log);
  invalidTimestamp.events[0].event_timestamp = "not-a-timestamp";
  // C6-05: content identity now binds `event_timestamp` too, so a test that
  // corrupts it must reseal `event_id`, exactly like a genuine producer would
  // — otherwise this is indistinguishable from a tampered event and is
  // correctly dropped by identity verification rather than surfaced as a
  // friendlier "bad timestamp format" error.
  invalidTimestamp.events[0].event_id = protocolTs.recomputeExcludedFieldsIdentity(invalidTimestamp.events[0], ["event_id"]);
  const invalidEntries = ui.buildSubmissionAttemptTimeline(invalidTimestamp, "customer");
  assert(invalidEntries[0].view.kind === "timeline-error", "invalid timestamps surface explicitly");
  assert(invalidEntries[0].view.error === "submission_timeline_invalid_timestamp", "invalid timestamp error is typed");
}

// C6-04: a next path that does not apply to the notice's own outcome_state
// must never render, even if the caller (or a compromised upstream
// projection) claims it.
function testStateBoundNextPaths(ui, rejected, quarantined) {
  const rejectedWithQuarantine = ui.SubmissionFailureNotice({
    ...noticeForOutcome(rejected, "ops"),
    next_paths: ["quarantine_support", "verify_receipt", "retry"]
  });
  const rejectedTypes = rejectedWithQuarantine.nextPaths.map((path) => path.type);
  assert(!rejectedTypes.includes("quarantine"), "a rejected (never-quarantined) submission must not offer the quarantine path");
  assert(!rejectedTypes.includes("verify_receipt"), "a no-receipt state must not offer to verify a receipt that does not exist");
  assert(rejectedTypes.includes("retry"), "retry remains valid for a rejected submission");

  const quarantinedWithVerify = ui.SubmissionFailureNotice({
    ...noticeForOutcome(quarantined, "ops"),
    next_paths: ["verify_receipt", "retry", "quarantine_support"]
  });
  const quarantinedTypes = quarantinedWithVerify.nextPaths.map((path) => path.type);
  assert(!quarantinedTypes.includes("verify_receipt"), "a no-receipt state must not offer to verify a receipt that does not exist");
  assert(!quarantinedTypes.includes("retry"), "retry is not an allowed path for an already-quarantined submission");
  assert(quarantinedTypes.includes("quarantine"), "quarantine_support remains valid for a quarantined submission");
}

// C6-04: a blank/unsafe summary or title must make the whole notice
// unavailable, not render an empty or claim-unsafe alert; an unrecognized
// audience must fail closed the same way.
function testUnsafeAndMalformedNoticesRejected(ui, notice) {
  assert(ui.SubmissionFailureNotice({ ...notice, customer_facing_summary: "" }) === null, "a blank summary must return no notice");
  assert(ui.SubmissionFailureNotice({ ...notice, customer_facing_summary: "   " }) === null, "a whitespace-only summary must return no notice");
  assert(ui.SubmissionFailureNotice({ ...notice, customer_facing_summary: "Review complete — no vulnerabilities" }) === null, "a claim-unsafe summary must return no notice, not render as an assertive alert");
  assert(ui.SubmissionFailureNotice({ ...notice, title: "Review complete — no vulnerabilities" }) === null, "a claim-unsafe title must return no notice");
  assert(ui.SubmissionFailureNotice({ ...notice, audience: "prototype_polluted_audience" }) === null, "an unrecognized audience must fail closed");
  assert(ui.SubmissionFailureNotice({ ...notice, audience: "toString" }) === null, "a prototype-method-named audience must fail closed, not resolve through the prototype chain");
}

function testNoticeGuardsMalformedIdentities(ui, notice) {
  const view = ui.SubmissionFailureNotice({
    ...notice,
    submission_identities: [null, { identity_type: "manifest_id", identity_value: notice.submission_identities[0].identity_value }]
  });
  assert(view !== null, "a notice with a malformed identity entry still renders the valid identities");
  assert(view.affectedIdentities.some((identity) => identity.label === "manifest_id"), "the valid identity survives malformed siblings");
}

function testTimelineDropsVisibilityGatedEvents(ui, log) {
  const internalOnly = structuredClone(log);
  internalOnly.events[0].visibility = "internal_only";
  internalOnly.events[0].internal_note = "internal investigation only";
  const entries = ui.buildSubmissionAttemptTimeline(internalOnly, "customer");
  assert(entries.length === 1, "customer timeline drops internal-only submission events instead of surfacing them as errors");
  assert(entries.every((entry) => entry.eventId !== internalOnly.events[0].event_id), "internal-only event id must not leak to customers");
  assert(entries.every((entry) => !entry.artifactRefs.includes(internalOnly.events[0].artifact_refs[0])), "internal-only artifact refs must not leak to customers");
}

function testTimelineGuardsMalformedEvents(ui, log) {
  const malformed = { ...log, events: [null, { event_type: "submission_rejected" }, { ...log.events[0], artifact_refs: null }, log.events[0], { ...log.events[1], sequence_number: "late" }] };
  const entries = ui.buildSubmissionAttemptTimeline(malformed, "vendor");
  assert(entries.length === 1, "only the structurally renderable submission event survives malformed entries");
  assert(entries[0].view.kind === "timeline-event", "the surviving entry still renders through the timeline primitive");
}

function testTimelineRejectsLowercaseUtcMarkers(ui, protocolTs, log) {
  const lowercaseTimestamp = structuredClone(log);
  lowercaseTimestamp.events[0].event_timestamp = "2026-07-20t00:00:00z";
  lowercaseTimestamp.events[0].event_id = protocolTs.recomputeExcludedFieldsIdentity(lowercaseTimestamp.events[0], ["event_id"]);
  const entries = ui.buildSubmissionAttemptTimeline(lowercaseTimestamp, "customer");
  assert(entries[0].view.kind === "timeline-error", "lowercase t/z timestamps are rejected to match the protocol schema");
  assert(entries[0].view.error === "submission_timeline_invalid_timestamp", "lowercase timestamp rejection is explicit");
}

function testProjectionComposesWithRenderer(ui, controlPlane, outcome) {
  const notice = controlPlane.projectSubmissionFailureNotice(outcome, "customer");
  const view = ui.SubmissionFailureNotice(notice);
  assert(view !== null, "control-plane projection must render unmodified in UI");
  assert(view.role === "alert", "projected failure notice renders as a blocking alert");
}

function noticeForOutcome(outcome, audience) {
  return {
    outcome_state: outcome.outcome_state,
    review_id: outcome.review_id,
    submission_outcome_id: outcome.submission_outcome_id,
    occurred_at: outcome.occurred_at,
    submission_identities: outcome.submission_identities,
    failure_reason_codes: outcome.failure_reason_codes ?? [],
    next_paths: [outcome.next_path, "contact_support"],
    customer_facing_summary: outcome.customer_facing_summary,
    audience
  };
}

function assertClaimSafe(view) {
  const copy = `${view.title} ${view.message}`.toLowerCase();
  for (const phrase of CLAIM_SAFE_FORBIDDEN_PHRASES) {
    assert(!copy.includes(phrase), `failure copy must not contain claim-unsafe phrase: ${phrase}`);
  }
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
