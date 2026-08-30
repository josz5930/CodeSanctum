import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const validFixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-review-event-log-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-test-dist");

const FORBIDDEN_SOURCE_PATTERNS = [
  /["']node:fs["']/,
  /["']node:net["']/,
  /["']node:http["']/,
  /["']node:https["']/,
  /["']node:child_process["']/,
  /["']node:dgram["']/,
  /["']node:worker_threads["']/,
  /firestore/i,
  /@google-cloud/i,
  /aws-sdk/i,
  /pg["']/,
  /mongodb/i,
  /redis/i,
  /amqplib/i,
  /express/i,
  /fastify/i
];

try {
  const sourceFiles = await collectTypeScriptSources(path.join(workspacePath, "src"));
  assert(sourceFiles.length > 0, "control-plane must have TypeScript sources to check");
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, "utf8");
    for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
      assert(!pattern.test(source), `control-plane boundary must stay pure; found ${pattern} in ${path.relative(workspacePath, sourceFile)}`);
    }
  }

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
    path.join(tempDir, "control-plane.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  for (const exportName of ["appendReviewEvent", "computeReviewEventId", "projectCustomerFacingHistory", "workspaceName"]) {
    assert(exportName in controlPlane, `missing public export: ${exportName}`);
  }

  const fixtureLog = JSON.parse(await readFile(path.join(validFixtureRoot, "review-event-log.json"), "utf8"));
  const events = fixtureLog.events;
  const reviewId = fixtureLog.review_id;
  const emptyLog = { protocol_version: fixtureLog.protocol_version, review_id: reviewId, events: [] };

  const seal = async (event) => ({ ...event, event_id: await controlPlane.computeReviewEventId(event) });
  const logOf = (kept) => ({ protocol_version: fixtureLog.protocol_version, review_id: reviewId, events: kept });

  await testContentAddressedIdentity(controlPlane, events);
  await testAppendFirstEvent(controlPlane, emptyLog, events);
  await testAppendMonotonic(controlPlane, logOf, events);
  await testNonMonotonicAppend(controlPlane, logOf, events, seal);
  await testInvalidSequenceNumber(controlPlane, logOf, events);
  await testProtocolVersionMismatch(controlPlane, logOf, events, seal);
  await testIdempotentReAppend(controlPlane, logOf, events);
  await testIdempotencyKeyConflict(controlPlane, logOf, events, seal);
  await testTwoHopSupersedesBypass(controlPlane, logOf, events, seal);
  await testCyclicSupersedesChain(controlPlane, logOf, events, seal);
  await testDuplicateEventId(controlPlane, logOf, events);
  await testTamperedIdentity(controlPlane, logOf, events);
  await testWrongReviewScope(controlPlane, logOf, events, seal);
  await testSupersedesUnknownEvent(controlPlane, logOf, events, seal);
  await testCustomerCannotSupersedeClassification(controlPlane, logOf, events, seal);
  await testInternalNoteOnCustomerFacingEvent(controlPlane, logOf, events, seal);
  await testLifecycleEventWithoutClass(controlPlane, logOf, events, seal);
  await testBadIdentityExcludes(controlPlane, logOf, events, seal);
  await testSchemaInvalidEvent(controlPlane, logOf, events, seal);
  await testPreloadedHistoryActorTamperFailsClosed(controlPlane, logOf, events, seal);
  await testPreloadedHistoryForbiddenTextFailsClosed(controlPlane, logOf, events, seal);
  await testUnchangedPreloadedHistoryRemainsValid(controlPlane, logOf, events);
  await testMutationDuringAsyncBoundaryIsIgnored(controlPlane, logOf, events);
  await testSourceCodeLikeReasonRejected(controlPlane, logOf, events, seal);
  testCustomerProjection(controlPlane, fixtureLog);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane review event log tests passed.");

async function testContentAddressedIdentity(controlPlane, events) {
  for (const event of events) {
    const computed = await controlPlane.computeReviewEventId(event);
    assert(computed === event.event_id, `event_id must be the sha256 of its canonical content excluding event_id (${event.idempotency_key})`);
    const recomputed = await controlPlane.computeReviewEventId(structuredClone(event));
    assert(recomputed === computed, "canonical event identity must be stable across runs");
  }
}

async function testAppendFirstEvent(controlPlane, emptyLog, events) {
  const first = events[0];
  assert(first.sequence_number === 0, "fixture must start at sequence_number 0");
  const result = await controlPlane.appendReviewEvent(emptyLog, first);
  assert(result.outcome === "appended", `first append must succeed; got ${result.outcome}`);
  assert(result.log.events.length === 1, "first append must produce a one-event log");
  assert(emptyLog.events.length === 0, "appendReviewEvent must not mutate the input log");
}

async function testAppendMonotonic(controlPlane, logOf, events) {
  const prior = events.slice(0, 4);
  const log = logOf(prior);
  const snapshot = structuredClone(log);
  const result = await controlPlane.appendReviewEvent(log, events[4]);
  assert(result.outcome === "appended", `monotonic append must succeed; got ${result.outcome}`);
  assert(result.log.events.length === 5, "appended log must carry every prior event plus the new one");
  assert(
    JSON.stringify(result.log.events.slice(0, 4)) === JSON.stringify(snapshot.events),
    "append must leave prior elements byte-identical"
  );
  assert(result.log.events !== log.events, "append must return a new events array");
  assert(JSON.stringify(log) === JSON.stringify(snapshot), "appendReviewEvent must not mutate the input log");
}

async function testNonMonotonicAppend(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);
  for (const sequenceNumber of [3, 2]) {
    const candidate = await seal({ ...events[4], sequence_number: sequenceNumber });
    const result = await controlPlane.appendReviewEvent(log, candidate);
    assertRejected(result, "review_event_log_sequence_not_monotonic");
    assert(JSON.stringify(log) === JSON.stringify(snapshot), "rejected append must leave the input log unchanged");
    assert(result.log.events.length === snapshot.events.length, "rejected append must return the log unchanged");
  }
}

async function testInvalidSequenceNumber(controlPlane, logOf, events) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);
  for (const sequenceNumber of [Number.NaN, -1, 4.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
    const candidate = { ...events[4], sequence_number: sequenceNumber };
    const result = await controlPlane.appendReviewEvent(log, candidate);
    assertRejected(result, "review_event_sequence_number_invalid");
    assert(JSON.stringify(log) === JSON.stringify(snapshot), "rejected append must leave the input log unchanged");
  }
}

async function testProtocolVersionMismatch(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const candidate = await seal({ ...events[4], protocol_version: "codeattest.v1" });
  assertRejected(await controlPlane.appendReviewEvent(log, candidate), "review_event_log_protocol_version_mismatch");
}

async function testIdempotencyKeyConflict(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);

  // Same key, byte-identical body: the documented no-op.
  const replay = structuredClone(events[2]);
  const replayResult = await controlPlane.appendReviewEvent(log, replay);
  assert(replayResult.outcome === "idempotent_noop", `identical replay must be a no-op; got ${replayResult.outcome}`);

  // Same key and stale event_id, different body: compare the body before returning
  // idempotent_noop, or a stale client can suppress a changed event.
  const staleSameId = {
    ...events[2],
    reason: "SYNTHETIC_DEMO_DATA changed body under stale event identity. NOT_CUSTOMER_SOURCE."
  };
  const staleSameIdResult = await controlPlane.appendReviewEvent(log, staleSameId);
  assertRejected(staleSameIdResult, "review_event_log_idempotency_key_conflict");

  // Same key, different body: an event-suppression attempt, never a success.
  const conflicting = await seal({
    ...events[4],
    idempotency_key: events[2].idempotency_key,
    reason: "SYNTHETIC_DEMO_DATA different body replayed under an already-used key"
  });
  const conflictResult = await controlPlane.appendReviewEvent(log, conflicting);
  assertRejected(conflictResult, "review_event_log_idempotency_key_conflict");
  assert(JSON.stringify(log) === JSON.stringify(snapshot), "a conflicting replay must leave the input log unchanged");
  assert(
    conflictResult.log.events.length === snapshot.events.length,
    "a conflicting replay must not append a second entry under the same key"
  );
}

async function testTwoHopSupersedesBypass(controlPlane, logOf, events, seal) {
  const classification = events[1];
  assert(classification.event_type === "classification_recorded", "fixture event 1 must be the classification event");

  // A non-customer event legitimately supersedes the classification...
  const middle = await seal({
    ...events[4],
    sequence_number: 5,
    idempotency_key: "validation_path:review:synthetic-demo-001:validation_path:synthetic_middle_001",
    event_type: "validation_recorded",
    artifact_refs: ["artifact_ref:synthetic_middle_001"],
    supersedes_event_id: classification.event_id
  });
  const withMiddle = await controlPlane.appendReviewEvent(logOf(events.slice(0, 5)), middle);
  assert(withMiddle.outcome === "appended", `expected the intermediate event to append; got ${withMiddle.outcome}`);

  // ...and a customer event must not reach the classification through it.
  const twoHop = await seal({
    ...events[4],
    sequence_number: 6,
    idempotency_key: "remediation-0006",
    visibility: "customer_facing",
    event_type: "customer_remediation_recorded",
    supersedes_event_id: middle.event_id
  });
  delete twoHop.internal_note;
  const sealedTwoHop = await seal(twoHop);
  assertRejected(
    await controlPlane.appendReviewEvent(withMiddle.log, sealedTwoHop),
    "customer_event_cannot_supersede_classification"
  );
}

async function testCyclicSupersedesChain(controlPlane, logOf, events, seal) {
  // Prior logs are untrusted at the boundary. A malformed historical cycle
  // fails closed before a new event can be considered.
  const first = { ...events[1], supersedes_event_id: events[2].event_id };
  const second = { ...events[2], supersedes_event_id: events[1].event_id };
  const cyclicLog = logOf([first, second]);
  const candidateDraft = {
    ...events[4],
    sequence_number: 5,
    idempotency_key: "customer-cycle-0005",
    event_type: "customer_remediation_recorded",
    visibility: "customer_facing",
    supersedes_event_id: first.event_id
  };
  delete candidateDraft.internal_note;
  const candidate = await seal(candidateDraft);
  assertRejected(
    await controlPlane.appendReviewEvent(cyclicLog, candidate),
    "review_event_schema_invalid"
  );
}

async function testIdempotentReAppend(controlPlane, logOf, events) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);
  const result = await controlPlane.appendReviewEvent(log, events[2]);
  assert(result.outcome === "idempotent_noop", `repeated idempotency_key must be a no-op; got ${result.outcome}`);
  assert(JSON.stringify(result.log) === JSON.stringify(snapshot), "idempotent re-append must return the log unchanged");
  assert(JSON.stringify(log) === JSON.stringify(snapshot), "idempotent re-append must not mutate the input log");
}

async function testDuplicateEventId(controlPlane, logOf, events) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);
  const candidate = { ...events[4], idempotency_key: "unseen-key-9999", event_id: events[1].event_id };
  const result = await controlPlane.appendReviewEvent(log, candidate);
  assertRejected(result, "review_event_log_duplicate_event_id");
  assert(JSON.stringify(log) === JSON.stringify(snapshot), "rejected append must leave the input log unchanged");
}

async function testTamperedIdentity(controlPlane, logOf, events) {
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);
  const candidate = { ...events[4], reason: "SYNTHETIC_DEMO_DATA tampered content" };
  const result = await controlPlane.appendReviewEvent(log, candidate);
  assertRejected(result, "review_event_identity_mismatch");
  assert(JSON.stringify(log) === JSON.stringify(snapshot), "rejected append must leave the input log unchanged");
}

async function testWrongReviewScope(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const candidate = await seal({ ...events[4], review_id: "review:synthetic-demo-002" });
  assertRejected(await controlPlane.appendReviewEvent(log, candidate), "review_event_log_review_id_mismatch");
}

async function testSupersedesUnknownEvent(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const candidate = await seal({ ...events[4], supersedes_event_id: `sha256:${"b".repeat(64)}` });
  assertRejected(await controlPlane.appendReviewEvent(log, candidate), "review_event_log_supersedes_unknown_event");
}

async function testCustomerCannotSupersedeClassification(controlPlane, logOf, events, seal) {
  const classification = events[1];
  assert(classification.event_type === "classification_recorded", "fixture event 1 must be the classification event");
  const log = logOf(events.slice(0, 4));
  const snapshot = structuredClone(log);

  for (const eventType of ["customer_remediation_recorded", "customer_accepted_risk_recorded"]) {
    const candidate = {
      ...events[4],
      event_type: eventType,
      visibility: "customer_facing",
      supersedes_event_id: classification.event_id
    };
    delete candidate.internal_note;
    const result = await controlPlane.appendReviewEvent(log, await seal(candidate));
    assertRejected(result, "customer_event_cannot_supersede_classification");
    assert(
      JSON.stringify(log.events[1]) === JSON.stringify(snapshot.events[1]),
      "the superseded classification event must remain unchanged"
    );
  }
}

async function testInternalNoteOnCustomerFacingEvent(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  const candidate = await seal({
    ...events[4],
    visibility: "customer_facing",
    internal_note: "NOT_CUSTOMER_SOURCE note that must not ride a customer-facing event"
  });
  assertRejected(await controlPlane.appendReviewEvent(log, candidate), "review_event_internal_note_requires_internal_only");
}

async function testLifecycleEventWithoutClass(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  for (const eventType of ["evidence_deleted", "retention_status_changed"]) {
    const candidate = { ...events[4], event_type: eventType };
    delete candidate.source_derived_class;
    assertRejected(
      await controlPlane.appendReviewEvent(log, await seal(candidate)),
      "review_event_missing_source_derived_class"
    );
  }
}

async function testBadIdentityExcludes(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));
  for (const excludes of [["review_id"], [], ["event_id", "review_id"]]) {
    const candidate = await seal({ ...events[4], identity_input_excludes: excludes });
    assertRejected(await controlPlane.appendReviewEvent(log, candidate), "review_event_identity_excludes_invalid");
  }
}

// Regression: `ReviewEvent` does not exist at runtime, so input that merely
// satisfies the erased type — unknown properties, a malformed `artifact_refs`,
// a non-object — must still be rejected by the schema rather than hashed and
// appended with a self-consistent `event_id`.
async function testSchemaInvalidEvent(controlPlane, logOf, events, seal) {
  const log = logOf(events.slice(0, 4));

  const withUnknownProperty = await seal({ ...events[4], smuggled_property: "not in the schema" });
  assertRejected(await controlPlane.appendReviewEvent(log, withUnknownProperty), "review_event_schema_invalid");

  const withMalformedRefs = await seal({ ...events[4], artifact_refs: [{ nested: "object" }] });
  assertRejected(await controlPlane.appendReviewEvent(log, withMalformedRefs), "review_event_schema_invalid");

  for (const notAnObject of [null, "a string", 42, ["array"]]) {
    assertRejected(await controlPlane.appendReviewEvent(log, notAnObject), "review_event_schema_invalid");
  }

  for (const badLog of [null, "log", 42, { protocol_version: log.protocol_version, review_id: log.review_id }, { ...log, events: "not-array" }]) {
    assertRejected(await controlPlane.appendReviewEvent(badLog, events[4]), "review_event_schema_invalid");
  }

  const typedEvents = [
    {
      ...events[1],
      sequence_number: 6,
      idempotency_key: "classification:review:synthetic-demo-001:classification_record:direct_wrong_ref_001",
      artifact_refs: ["artifact_ref:unrelated_record"]
    },
    {
      ...events[5],
      sequence_number: 6,
      idempotency_key: "remediation_guidance:review:synthetic-demo-001:remediation_guidance:direct_extra_ref_001",
      artifact_refs: ["artifact_ref:direct_extra_ref_001", "artifact_ref:unrelated_record"]
    },
    {
      ...events[2],
      sequence_number: 6,
      idempotency_key: "customer_remediation:review:synthetic-demo-001:customer_status:direct_wrong_ref_001",
      artifact_refs: ["artifact_ref:unrelated_record"]
    }
  ];
  for (const event of typedEvents) {
    assertRejected(await controlPlane.appendReviewEvent(log, await seal(event)), "review_event_schema_invalid");
  }
}

function testCustomerProjection(controlPlane, fixtureLog) {
  const projection = controlPlane.projectCustomerFacingHistory(fixtureLog);
  const customerFacing = fixtureLog.events.filter((event) => event.visibility === "customer_facing");
  assert(projection.review_id === fixtureLog.review_id, "projection must stay review scoped");
  assert(projection.entries.length === customerFacing.length, "projection must contain exactly the customer-facing events");

  const serialized = JSON.stringify(projection);
  assert(!serialized.includes("internal_note"), "projection must never carry internal_note");
  assert(!serialized.includes("internal_only"), "projection must never carry internal_only entries");

  for (const [index, entry] of projection.entries.entries()) {
    const event = customerFacing[index];
    assert(entry.event_id === event.event_id, "projection entry must preserve event_id");
    assert(entry.event_type === event.event_type, "projection entry must preserve event_type");
    assert(entry.event_timestamp === event.event_timestamp, "projection entry must preserve event_timestamp");
    assert(entry.actor_category === event.actor.actor_type, "projection entry must preserve actor_category");
    assert(JSON.stringify(entry.artifact_refs) === JSON.stringify(event.artifact_refs), "projection entry must preserve artifact_refs");
    assert(entry.visibility === "customer_facing", "projection entries are customer-facing only");
    if (event.reason === undefined) {
      assert(!("reason" in entry), "projection entry must omit reason when the event has none");
    } else {
      assert(entry.reason === event.reason, "projection entry must preserve reason when present");
    }
  }

  // An out-of-order prior log is malformed system-of-record state and must
  // fail closed rather than being silently repaired by projection.
  const reversed = controlPlane.projectCustomerFacingHistory({ ...fixtureLog, events: [...fixtureLog.events].reverse() });
  assert(reversed.review_id === "review:invalid" && reversed.entries.length === 0, "customer projection rejects malformed prior log ordering");
  for (let index = 1; index < projection.entries.length; index += 1) {
    const previous = fixtureLog.events.find((event) => event.event_id === projection.entries[index - 1].event_id);
    const current = fixtureLog.events.find((event) => event.event_id === projection.entries[index].event_id);
    assert(current.sequence_number > previous.sequence_number, "valid projection entries remain ascending by sequence_number");
  }

  const remediationGuidanceEvent = fixtureLog.events.find((event) => event.event_type === "remediation_guidance_recorded" && event.visibility === "customer_facing");
  assert(remediationGuidanceEvent !== undefined, "fixture must include customer-facing remediation guidance history");
  const remediationGuidanceEntry = projection.entries.find((entry) => entry.event_id === remediationGuidanceEvent.event_id);
  assert(remediationGuidanceEntry !== undefined, "customer-facing history projection must preserve remediation_guidance_recorded events");
  assert(remediationGuidanceEntry.event_type === "remediation_guidance_recorded", "projected event type remains remediation_guidance_recorded");
  assert(JSON.stringify(remediationGuidanceEntry.artifact_refs) === JSON.stringify(remediationGuidanceEvent.artifact_refs), "projected remediation guidance artifact refs are preserved exactly");
}

async function collectTypeScriptSources(directory) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...await collectTypeScriptSources(absolutePath));
    } else if (entry.isFile() && absolutePath.endsWith(".ts")) {
      collected.push(absolutePath);
    }
  }
  return collected.sort();
}

// C4-01: a schema-valid/rehashed historical event must not become acceptable
// merely by arriving in `log.events` instead of through `appendReviewEvent` —
// event-local authority/content rules must apply to preloaded history too.
async function testPreloadedHistoryActorTamperFailsClosed(controlPlane, logOf, events, seal) {
  const classification = events[1];
  assert(classification.event_type === "classification_recorded", "fixture event 1 must be the classification event");
  const tamperedClassification = await seal({
    ...classification,
    actor: { actor_type: "customer_user", actor_id: classification.actor.actor_id }
  });
  const tamperedLog = logOf([events[0], tamperedClassification, events[2], events[3]]);

  const projection = controlPlane.projectCustomerFacingHistory(tamperedLog);
  assert(
    projection.review_id === "review:invalid" && projection.entries.length === 0,
    "a rehashed historical actor-authority violation must fail the whole customer projection closed"
  );

  assertRejected(await controlPlane.appendReviewEvent(tamperedLog, events[4]), "review_event_schema_invalid");
}

async function testPreloadedHistoryForbiddenTextFailsClosed(controlPlane, logOf, events, seal) {
  const remediation = events[2];
  assert(
    remediation.event_type === "customer_remediation_recorded" && remediation.visibility === "customer_facing",
    "fixture event 2 must be a customer-facing remediation event"
  );
  const tamperedRemediation = await seal({
    ...remediation,
    reason: "NOT_CUSTOMER_SOURCE customer recorded a remediation referencing token: synthetic-secret"
  });
  const tamperedLog = logOf([events[0], events[1], tamperedRemediation, events[3]]);

  const projection = controlPlane.projectCustomerFacingHistory(tamperedLog);
  assert(
    projection.review_id === "review:invalid" && projection.entries.length === 0,
    "a rehashed historical forbidden-source-text violation must fail the whole customer projection closed"
  );

  assertRejected(await controlPlane.appendReviewEvent(tamperedLog, events[4]), "review_event_schema_invalid");
}

async function testUnchangedPreloadedHistoryRemainsValid(controlPlane, logOf, events) {
  const log = logOf(events.slice(0, 4));
  const projection = controlPlane.projectCustomerFacingHistory(log);
  assert(projection.review_id !== "review:invalid", "an unchanged valid preloaded log must still project");
  const result = await controlPlane.appendReviewEvent(log, events[4]);
  assert(result.outcome === "appended", `expected append onto a valid preloaded log to succeed; got ${JSON.stringify(result)}`);
}

// C4-02: `appendReviewEvent` must snapshot its caller-owned arguments before
// the first async boundary (the identity digest inside `rejectionForEvent`),
// so a caller mutating `log`/`event` while that promise is suspended cannot
// influence validation, hashing, or the returned log.
async function testMutationDuringAsyncBoundaryIsIgnored(controlPlane, logOf, events) {
  const priorEvents = structuredClone(events.slice(0, 4));
  const log = logOf(priorEvents);
  const candidate = structuredClone(events[4]);
  const preCallLogSnapshot = structuredClone(log);
  const preCallCandidateSnapshot = structuredClone(candidate);

  const promise = controlPlane.appendReviewEvent(log, candidate);
  // These mutations race the identity-digest promise inside `appendReviewEvent`.
  log.events[0].actor.actor_id = "MUTATION_SENTINEL_LOG";
  candidate.actor.actor_id = "MUTATION_SENTINEL_EVENT";

  const result = await promise;
  assert(result.outcome === "appended", `expected append to succeed; got ${JSON.stringify(result)}`);
  assert(
    JSON.stringify(result.log.events.slice(0, 4)) === JSON.stringify(preCallLogSnapshot.events),
    "prior events in the result must match the pre-call snapshot, not the mutated caller objects"
  );
  const appended = result.log.events[4];
  assert(appended.actor.actor_id !== "MUTATION_SENTINEL_EVENT", "the appended event must not carry the post-call mutation");
  assert(JSON.stringify(appended) === JSON.stringify(preCallCandidateSnapshot), "the appended event must match the pre-call snapshot exactly");
  const recomputedId = await controlPlane.computeReviewEventId(appended);
  assert(recomputedId === appended.event_id, "the appended event's event_id must recompute from its own (unmutated) body");
}

// C4-18: source-like code that avoids the exact SOURCE_TEXT_FORBIDDEN_PHRASES
// list must still be caught in a fresh, direct append via a resealed event.
async function testSourceCodeLikeReasonRejected(controlPlane, logOf, events, seal) {
  const classification = events[1];
  assert(classification.event_type === "classification_recorded", "fixture event 1 must be the classification event");
  const forged = await seal({
    ...classification,
    reason: "NOT_CUSTOMER_SOURCE src/auth.ts:42 if (!user.isAdmin) { eval(userInput); }"
  });
  assertRejected(
    await controlPlane.appendReviewEvent(logOf(events.slice(0, 1)), forged),
    "review_event_reason_raw_source_text_forbidden"
  );

  const bareLocation = await seal({
    ...classification,
    reason: "NOT_CUSTOMER_SOURCE reviewer confirmed the finding at src/auth.ts:42 during manual review."
  });
  const bareLocationAppend = await controlPlane.appendReviewEvent(logOf(events.slice(0, 1)), bareLocation);
  assert(bareLocationAppend.outcome === "appended", `a bare source location reason must remain allowed; got ${JSON.stringify(bareLocationAppend)}`);
}

function assertRejected(result, expectedReason) {
  assert(result.outcome === "rejected", `expected rejection ${expectedReason}; got ${result.outcome}`);
  assert(result.reason === expectedReason, `expected reason ${expectedReason}; got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
