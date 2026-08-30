// Direct unit tests for the Story 2.4 semantic validators in
// scripts/lib/protocol-utils.mjs. The fixture gate alone cannot prove these
// rules fire: for several negative fixtures the hand-rolled schema validator
// reports first (`enum`, `const`, `review_event_identity_mismatch`) and
// `expectedFailureCodes` accepts that schema code as an alternate, so deleting
// a semantic block leaves `npm run protocol:check` green. These tests call the
// validators with in-memory objects and assert the exact code each rule emits.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  reviewEventIdentity,
  validateReviewEventCustomerProjectionAgainstLog,
  validateReviewEventCustomerProjectionSemantics,
  validateReviewEventLogSemantics,
  validateReviewEventSemantics
} from "../../../scripts/lib/protocol-utils.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureLog = JSON.parse(await readFile(
  path.join(repoRoot, "protocol", "fixtures", "v0", "valid", "review-event-log.json"),
  "utf8"
));

const events = fixtureLog.events;
const reviewId = fixtureLog.review_id;

const seal = (event) => ({ ...event, event_id: reviewEventIdentity(event) });
const logOf = (kept) => ({ protocol_version: fixtureLog.protocol_version, review_id: reviewId, events: kept });

testValidFixtureIsClean();
testDuplicateEventId();
testIdentityExcludesInvalid();
testInternalOnlyProjectionEntry();
testIdentityMismatch();
testReviewIdMismatch();
testSequenceNotMonotonic();
testDuplicateIdempotencyKey();
testSupersedesUnknownEvent();
testCustomerCannotSupersedeClassification();
testInternalNoteRequiresInternalOnly();
testMissingSourceDerivedClass();
testDuplicateProjectionEventId();
testCustomerProjectionFaithfulnessAgainstLog();

console.log("control-plane review event semantic validator tests passed.");

function testValidFixtureIsClean() {
  assertCodes(logErrors(fixtureLog), [], "the valid fixture log must produce no semantic errors");
  for (const event of events) {
    assertCodes(eventErrors(event), [], "each valid fixture event must produce no semantic errors");
  }
}

// (a) The block a reviewer deleted without turning protocol:check red.
function testDuplicateEventId() {
  const duplicate = { ...events[2], idempotency_key: "unseen-key-9999", event_id: events[0].event_id };
  assertHasCode(logErrors(logOf([events[0], duplicate])), "review_event_log_duplicate_event_id");
}

// (b) The block a reviewer deleted without turning protocol:check red.
function testIdentityExcludesInvalid() {
  for (const excludes of [["review_id"], [], ["event_id", "review_id"]]) {
    const event = seal({ ...events[0], identity_input_excludes: excludes });
    assertHasCode(eventErrors(event), "review_event_identity_excludes_invalid");
  }
}

// (c) The block a reviewer deleted without turning protocol:check red.
function testInternalOnlyProjectionEntry() {
  const projection = {
    protocol_version: fixtureLog.protocol_version,
    review_id: reviewId,
    entries: [entryFor(events[0]), { ...entryFor(events[1]), visibility: "internal_only" }]
  };
  assertHasCode(projectionErrors(projection), "customer_projection_internal_only_entry");
}

function testIdentityMismatch() {
  const tampered = { ...events[0], reason: "SYNTHETIC_DEMO_DATA tampered content" };
  assertHasCode(eventErrors(tampered), "review_event_identity_mismatch");
}

function testReviewIdMismatch() {
  const foreign = seal({ ...events[0], review_id: "review:synthetic-demo-002" });
  assertHasCode(logErrors(logOf([foreign])), "review_event_log_review_id_mismatch");
}

function testSequenceNotMonotonic() {
  const later = seal({ ...events[2], sequence_number: 0 });
  assertHasCode(logErrors(logOf([events[0], later])), "review_event_log_sequence_not_monotonic");
}

function testDuplicateIdempotencyKey() {
  const repeated = seal({ ...events[2], idempotency_key: events[0].idempotency_key });
  assertHasCode(logErrors(logOf([events[0], repeated])), "review_event_log_duplicate_idempotency_key");
}

function testSupersedesUnknownEvent() {
  const orphan = seal({ ...events[2], supersedes_event_id: `sha256:${"b".repeat(64)}` });
  assertHasCode(logErrors(logOf([events[0], orphan])), "review_event_log_supersedes_unknown_event");
}

function testCustomerCannotSupersedeClassification() {
  const classification = events[1];
  assert(classification.event_type === "classification_recorded", "fixture event 1 must be the classification event");
  const correction = seal({
    ...events[2],
    event_type: "customer_accepted_risk_recorded",
    supersedes_event_id: classification.event_id
  });
  assertHasCode(logErrors(logOf([classification, correction])), "customer_event_cannot_supersede_classification");
}

function testInternalNoteRequiresInternalOnly() {
  const leaky = seal({
    ...events[0],
    visibility: "customer_facing",
    internal_note: "NOT_CUSTOMER_SOURCE note that must not ride a customer-facing event"
  });
  assertHasCode(eventErrors(leaky), "review_event_internal_note_requires_internal_only");
}

function testMissingSourceDerivedClass() {
  for (const eventType of ["evidence_deleted", "retention_status_changed"]) {
    const candidate = { ...events[0], event_type: eventType };
    delete candidate.source_derived_class;
    assertHasCode(eventErrors(seal(candidate)), "review_event_missing_source_derived_class");
  }
}

function testDuplicateProjectionEventId() {
  const projection = {
    protocol_version: fixtureLog.protocol_version,
    review_id: reviewId,
    entries: [entryFor(events[0]), entryFor(events[0])]
  };
  assertHasCode(projectionErrors(projection), "customer_projection_duplicate_event_id");
}

function testCustomerProjectionFaithfulnessAgainstLog() {
  const customerFacing = events.filter((event) => event.visibility === "customer_facing").sort((left, right) => left.sequence_number - right.sequence_number);
  const faithful = {
    protocol_version: fixtureLog.protocol_version,
    review_id: reviewId,
    entries: customerFacing.map(entryFor)
  };
  assertCodes(projectionAgainstLogErrors(faithful, fixtureLog), [], "faithful customer projection must match its log");
  assertHasCode(projectionAgainstLogErrors({ ...faithful, review_id: "review:synthetic-demo-002" }, fixtureLog), "customer_projection_review_scope_mismatch");
  assertHasCode(projectionAgainstLogErrors({ ...faithful, entries: faithful.entries.slice(0, -1) }, fixtureLog), "customer_projection_missing_event");
  assertHasCode(projectionAgainstLogErrors({ ...faithful, entries: [...faithful.entries, { ...faithful.entries[0], event_id: `sha256:${"f".repeat(64)}` }] }, fixtureLog), "customer_projection_unknown_event");
  assertHasCode(projectionAgainstLogErrors({ ...faithful, entries: [{ ...faithful.entries[0], actor_category: "customer_user" }, ...faithful.entries.slice(1)] }, fixtureLog), "customer_projection_entry_mismatch");
  assertHasCode(projectionAgainstLogErrors({ ...faithful, entries: [...faithful.entries].reverse() }, fixtureLog), "customer_projection_order_mismatch");
}

function entryFor(event) {
  const entry = {
    event_id: event.event_id,
    event_type: event.event_type,
    event_timestamp: event.event_timestamp,
    actor_category: event.actor.actor_type,
    artifact_refs: event.artifact_refs,
    visibility: "customer_facing"
  };
  return event.reason === undefined ? entry : { ...entry, reason: event.reason };
}

function eventErrors(event) {
  const errors = [];
  validateReviewEventSemantics(event, errors);
  return errors;
}

function logErrors(log) {
  const errors = [];
  validateReviewEventLogSemantics(log, errors);
  return errors;
}

function projectionErrors(projection) {
  const errors = [];
  validateReviewEventCustomerProjectionSemantics(projection, errors);
  return errors;
}

function projectionAgainstLogErrors(projection, log) {
  const errors = [];
  validateReviewEventCustomerProjectionAgainstLog(projection, log, errors);
  return errors;
}

function assertHasCode(errors, expectedCode) {
  const codes = errors.map((error) => error.code);
  assert(codes.includes(expectedCode), `expected ${expectedCode}; got [${codes.join(", ")}]`);
}

function assertCodes(errors, expectedCodes, message) {
  const codes = errors.map((error) => error.code);
  assert(JSON.stringify(codes) === JSON.stringify(expectedCodes), `${message}; got [${codes.join(", ")}]`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
