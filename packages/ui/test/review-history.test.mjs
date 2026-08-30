import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-review-history-test-"));

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const outDir = path.join(tempDir, "dist");
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

  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  const protocolTs = await import(pathToFileURL(path.join(outDir, "packages", "protocol-ts", "src", "index.js")).href);
  assert(typeof ui.buildReviewHistoryTimeline === "function", "buildReviewHistoryTimeline must be exported");

  const log = JSON.parse(await readFile(
    path.join(repoRoot, "protocol", "fixtures", "v0", "valid", "review-event-log.json"),
    "utf8"
  ));
  const verificationScopeLog = JSON.parse(await readFile(
    path.join(repoRoot, "protocol", "fixtures", "v0", "valid", "review-event-log.verification-scope.json"),
    "utf8"
  ));

  testVendorTimeline(ui, log);
  testCustomerTimeline(ui, log);
  testAppendedOrderIsPreserved(ui, log);
  testMultipleArtifactRefsAreRendered(ui, protocolTs, log);
  testVerificationScopeTimeline(ui, verificationScopeLog);
  testUnknownLocalOffsetIsRejected(ui, log);
  testStructuralIntegrityGuards(ui, protocolTs, log);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("ui review history timeline tests passed.");

function testVendorTimeline(ui, log) {
  const entries = ui.buildReviewHistoryTimeline(log, "vendor");
  assert(entries.length === log.events.length, "vendor audience must render one entry per event");
  assertAscending(entries);

  const notedEvents = log.events.filter((event) => event.internal_note !== undefined);
  assert(notedEvents.length > 0, "fixture must contain at least one event carrying an internal note");

  for (const [index, entry] of entries.entries()) {
    const event = log.events[index];
    assert(entry.eventId === event.event_id, "entry must carry the event id");
    assert(entry.sequenceNumber === event.sequence_number, "entry must carry the sequence number");
    assert(JSON.stringify(entry.artifactRefs) === JSON.stringify(event.artifact_refs), "entry must carry artifact refs");
    assert(entry.view.eventType === event.event_type, "entry view must carry the event type");
    assert(entry.view.timestamp.dateTime === event.event_timestamp, "entry view must carry the timestamp");
    assert(entry.view.visibility.value === event.visibility, "entry view must carry visibility");
    assert(typeof entry.view.visibility.label === "string" && entry.view.visibility.label.length > 0, "visibility must be text-first");
    assert(entry.view.actor !== undefined, "entry view must carry the actor when the event has a valid one");
    assert(
      JSON.stringify(entry.view.artifactReferences.map((reference) => reference.value)) ===
        JSON.stringify(event.artifact_refs),
      "entry view must render every artifact reference, not just the first"
    );

    if (event.internal_note === undefined) {
      assert(entry.view.internalNote === undefined, "an event with no internal note must not gain one");
    } else {
      assert(
        entry.view.internalNote === event.internal_note,
        "internal reviewer rationale must be forwarded to a vendor-audience entry"
      );
    }
  }
}

function testCustomerTimeline(ui, log) {
  const entries = ui.buildReviewHistoryTimeline(log, "customer");
  const customerFacing = log.events.filter((event) => event.visibility === "customer_facing");
  assert(customerFacing.length > 0 && customerFacing.length < log.events.length, "fixture must mix visibilities");
  assert(entries.length === customerFacing.length, "internal_only events must be omitted for a customer audience");
  assertAscending(entries);

  for (const [index, entry] of entries.entries()) {
    assert(entry.eventId === customerFacing[index].event_id, "customer entries must keep ascending order");
    assert(entry.view.visibility.value === "customer_facing", "customer entries must be customer-facing only");
  }

  const serialized = JSON.stringify(entries);
  assert(!serialized.includes("internalNote"), "no internalNote may reach a customer-audience entry");
  assert(!serialized.includes("internal_only"), "no internal_only event may reach a customer-audience entry");
  for (const event of log.events) {
    if (event.internal_note !== undefined) {
      assert(!serialized.includes(event.internal_note), "internal note text must never reach a customer-audience entry");
    }
  }
}

function testAppendedOrderIsPreserved(ui, log) {
  const shuffled = { ...log, events: [...log.events].reverse() };
  const entries = ui.buildReviewHistoryTimeline(shuffled, "ops");
  assertAscending(entries);
  assert(entries.length === log.events.length, "ops audience must render one entry per event");
  assert(
    JSON.stringify(entries.map((entry) => entry.eventId)) === JSON.stringify(log.events.map((event) => event.event_id)),
    "entries must be ordered by sequence_number, not by input order"
  );
}

// Regression: an event carrying N artifact refs previously rendered only
// `artifact_refs[0]`, so the view under-reported what the event touched.
function testMultipleArtifactRefsAreRendered(ui, protocolTs, log) {
  const refs = ["artifact_ref:demo-multi-a", "artifact_ref:demo-multi-b", "artifact_ref:demo-multi-c"];
  const widened = {
    ...log,
    events: log.events.map((event, index) => {
      if (index !== 0) return event;
      const withRefs = { ...event, artifact_refs: refs };
      // C6-02: the render boundary now verifies content-addressed event
      // identity, so a test that mutates event content must reseal it,
      // exactly like a genuine producer would.
      return { ...withRefs, event_id: protocolTs.recomputeExcludedFieldsIdentity(withRefs, ["event_id"]) };
    })
  };

  const [entry] = ui.buildReviewHistoryTimeline(widened, "vendor");
  assert(
    JSON.stringify(entry.view.artifactReferences.map((reference) => reference.value)) === JSON.stringify(refs),
    "every artifact ref on an event must reach the rendered view"
  );
  assert(JSON.stringify(entry.artifactRefs) === JSON.stringify(refs), "entry must retain the full ref list for callers");
}

function testVerificationScopeTimeline(ui, log) {
  const entries = ui.buildReviewHistoryTimeline(log, "customer");
  const scopeEntry = entries.find((entry) => entry.view.eventType === "verification_scope_recorded");
  assert(scopeEntry !== undefined, "verification_scope_recorded event must reach customer history timeline");
  assert(scopeEntry.artifactRefs.includes("artifact_ref:synthetic_pass_requires_validation_001"), "verification scope artifact ref is preserved");
  assert(scopeEntry.view.artifactReferences.some((reference) => reference.value === "artifact_ref:synthetic_pass_requires_validation_001"), "timeline view includes verification scope artifact ref");
}

// `-00:00` is RFC 3339 section 4.3 "unknown local offset", not UTC. The protocol
// schema was narrowed to reject it (matching this primitive's existing Story 2.1
// behavior) so it fails loudly at the gate instead of being silently dropped
// here. This pins the UI side of that agreement.
function testUnknownLocalOffsetIsRejected(ui, log) {
  const retimed = {
    ...log,
    events: log.events.map((event, index) =>
      index === 0 ? { ...event, event_timestamp: event.event_timestamp.replace(/(?:Z|\+00:00)$/, "-00:00") } : event
    )
  };
  assert(retimed.events[0].event_timestamp.endsWith("-00:00"), "test setup must produce a -00:00 timestamp");

  const entries = ui.buildReviewHistoryTimeline(retimed, "vendor");
  assert(
    entries.length === log.events.length - 1,
    "an unknown-local-offset timestamp must not render as though it were UTC"
  );
  assert(
    !entries.some((entry) => entry.eventId === retimed.events[0].event_id),
    "the -00:00 event must not appear in the timeline"
  );
}

// C6-02: a stored review event log must be verified as one hash-linked,
// uniquely-identified, review-bound structure before rendering — not merely
// sorted and rendered as given.
function testStructuralIntegrityGuards(ui, protocolTs, log) {
  // Null/undefined/non-log-shaped input must not throw.
  assert(ui.buildReviewHistoryTimeline(null, "customer").length === 0, "null log must render nothing, not throw");
  assert(ui.buildReviewHistoryTimeline(undefined, "customer").length === 0, "undefined log must render nothing, not throw");
  assert(ui.buildReviewHistoryTimeline("not-a-log", "customer").length === 0, "a non-object log must render nothing, not throw");
  assert(ui.buildReviewHistoryTimeline({ ...log, events: "not-an-array" }, "customer").length === 0, "a log with a non-array events field must render nothing, not throw");

  // An event whose content was tampered with after signing (identity no
  // longer matches its recomputed content-addressed hash) must be dropped.
  const tampered = {
    ...log,
    events: log.events.map((event, index) => (index === 0 ? { ...event, artifact_refs: ["artifact_ref:tampered-after-signing"] } : event))
  };
  const tamperedEntries = ui.buildReviewHistoryTimeline(tampered, "vendor");
  assert(
    !tamperedEntries.some((entry) => entry.eventId === log.events[0].event_id),
    "an event whose content diverges from its content-addressed id must be dropped, not rendered with mismatched content"
  );
  assert(tamperedEntries.length === log.events.length - 1, "only the tampered event must be dropped, not the whole log");

  // A resealed event claiming a different review_id (cross-review
  // contamination) must be dropped, never rendered into this review's history.
  const relabeled = {
    ...log,
    events: log.events.map((event, index) => {
      if (index !== 1) return event;
      const withOtherReview = { ...event, review_id: "review:synthetic-other-review" };
      return { ...withOtherReview, event_id: protocolTs.recomputeExcludedFieldsIdentity(withOtherReview, ["event_id"]) };
    })
  };
  const relabeledEntries = ui.buildReviewHistoryTimeline(relabeled, "vendor");
  assert(
    !relabeledEntries.some((entry) => entry.eventId === relabeled.events[1].event_id),
    "an event bound to a different review_id must never appear in this review's timeline"
  );

  // Two events claiming the same event_id (one necessarily forged, since a
  // real content-addressed id is unique to its content) must both be
  // treated as untrustworthy rather than picking one arbitrarily to keep.
  const duplicated = {
    ...log,
    events: log.events.map((event, index) => (index === 2 ? { ...event, event_id: log.events[0].event_id } : event))
  };
  const duplicatedEntries = ui.buildReviewHistoryTimeline(duplicated, "vendor");
  assert(
    duplicatedEntries.filter((entry) => entry.eventId === log.events[0].event_id).length <= 1,
    "a duplicated event_id must never render twice"
  );
}

function assertAscending(entries) {
  for (let index = 1; index < entries.length; index += 1) {
    assert(
      entries[index].sequenceNumber > entries[index - 1].sequenceNumber,
      "timeline entries must be ascending by sequence_number"
    );
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
