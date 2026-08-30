import { recomputeExcludedFieldsIdentity } from "./canonical-identity.js";
import { validateProtocolSchema } from "./validation.js";
import type { ReviewEvent, ReviewEventLog } from "./generated/protocol-v0.js";

/**
 * C6-02/C6-05: canonical, runtime-safe validation for a *stored* review
 * event log, shared by every independently callable UI/static rendering
 * boundary that consumes one (customer timelines, submission-attempt
 * timelines). Schema validation alone (which `review-event-log.schema.json`
 * already gives every event via its own `$ref`) cannot express: strictly
 * ordered/unique sequence numbers, unique event/idempotency identities, an
 * event's own protocol/review binding, resolvable `supersedes_event_id`
 * chains, or an event's content-addressed identity. This module closes those
 * gaps without re-implementing control-plane's full per-event-type
 * append-authority tree (`rejectionForReviewEventSemantics` in
 * `apps/control-plane/src/index.ts`) — that tree governs whether an event was
 * legitimately *appended*, a stronger write-boundary concern; this module
 * governs whether an already-stored log's events are individually
 * self-consistent enough to render, the render-boundary's job.
 */
export type ReviewEventLogIssue =
  | "schema_invalid"
  | "sequence_not_strictly_increasing"
  | "duplicate_event_id"
  | "duplicate_idempotency_key"
  | "event_protocol_version_mismatch"
  | "event_review_id_mismatch"
  | "event_identity_excludes_invalid"
  | "event_identity_mismatch"
  | "supersedes_event_unresolved";

/** Strict, all-or-nothing check: every event issue for a `review-event-log`-shaped value. */
export function reviewEventLogIssues(log: unknown): ReviewEventLogIssue[] {
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event-log", log).length > 0) {
    return ["schema_invalid"];
  }
  const typedLog = log as ReviewEventLog;
  const issues: ReviewEventLogIssue[] = [];
  for (const perEventIssues of orderedEventsWithIssues(typedLog).map((entry) => entry.issues)) {
    issues.push(...perEventIssues);
  }
  return issues;
}

export function reviewEventLogStructurallyValid(log: unknown): log is ReviewEventLog {
  return reviewEventLogIssues(log).length === 0;
}

const PLACEHOLDER_VALID_TIMESTAMP = "2026-01-01T00:00:00Z";

function isReviewEventShapedIgnoringTimestampFormat(candidate: unknown): candidate is ReviewEvent {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", candidate).length === 0) return true;
  const withPlaceholderTimestamp = { ...(candidate as Record<string, unknown>), event_timestamp: PLACEHOLDER_VALID_TIMESTAMP };
  return validateProtocolSchema("urn:codeattest:protocol:v0:review-event", withPlaceholderTimestamp).length === 0;
}

function isReviewEventLogShaped(value: unknown): value is { protocol_version: unknown; review_id: unknown; events: unknown[] } {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Array.isArray((value as { events?: unknown }).events);
}

function orderedEventsWithIssues(log: { protocol_version: unknown; review_id: unknown; events: unknown[] }): Array<{ event: ReviewEvent; issues: ReviewEventLogIssue[] }> {
  const seenEventIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();
  // Populated only with earlier (lower sequence_number) events, so a
  // `supersedes_event_id` cannot resolve to the event's own id or a later one.
  const priorEventIds = new Set<string>();
  let previousSequence = -Infinity;

  // The authoritative order is `sequence_number`, not array position — a
  // transport/storage layer reordering the array does not by itself make an
  // otherwise well-formed, uniquely-sequenced log invalid.
  //
  // A malformed `event_timestamp` is intentionally *not* fatal here: content
  // identity binds to whatever bytes the producer actually signed (garbage
  // timestamp included), so identity verification does not depend on the
  // timestamp being well-formed, and different render surfaces want to
  // handle a bad timestamp differently (e.g. an explicit visible error entry
  // vs. silently omitting that one event) — that is a presentation decision
  // for the caller, not a structural-integrity one for this shared module.
  const ordered = [...log.events].filter((candidate): candidate is ReviewEvent =>
    isReviewEventShapedIgnoringTimestampFormat(candidate)
  ).sort((left, right) => left.sequence_number - right.sequence_number);

  const results: Array<{ event: ReviewEvent; issues: ReviewEventLogIssue[] }> = [];
  for (const event of ordered) {
    const issues: ReviewEventLogIssue[] = [];

    if (event.sequence_number <= previousSequence) issues.push("sequence_not_strictly_increasing");
    previousSequence = event.sequence_number;

    if (seenEventIds.has(event.event_id)) issues.push("duplicate_event_id");
    if (seenIdempotencyKeys.has(event.idempotency_key)) issues.push("duplicate_idempotency_key");
    if (event.protocol_version !== log.protocol_version) issues.push("event_protocol_version_mismatch");
    if (event.review_id !== log.review_id) issues.push("event_review_id_mismatch");

    if (event.identity_input_excludes.length !== 1 || event.identity_input_excludes[0] !== "event_id") {
      issues.push("event_identity_excludes_invalid");
    } else {
      const recomputed = recomputeExcludedFieldsIdentity(event, ["event_id"]);
      if (recomputed === undefined || recomputed !== event.event_id) issues.push("event_identity_mismatch");
    }

    if (event.supersedes_event_id !== undefined && !priorEventIds.has(event.supersedes_event_id)) {
      issues.push("supersedes_event_unresolved");
    }

    // Only events that passed every check so far establish identity that a
    // later event may validly build on (duplicate/dangling references, or
    // events that never happened, must not become valid anchors).
    if (issues.length === 0) {
      seenEventIds.add(event.event_id);
      seenIdempotencyKeys.add(event.idempotency_key);
      priorEventIds.add(event.event_id);
    }

    results.push({ event, issues });
  }
  return results;
}

/**
 * Sorted-ascending, individually self-consistent events: each surviving
 * event passed schema validation, its own protocol/review binding, its
 * content-addressed identity, sequence/idempotency uniqueness, and (if
 * present) a resolvable `supersedes_event_id`. A single malformed, forged, or
 * cross-review event is dropped rather than invalidating the whole log or
 * being silently "repaired" into a plausible position — but it never makes
 * an otherwise-legitimate sibling event disappear. Returns `undefined` only
 * when `log` itself is not even log-shaped (not an object, or `events` is
 * not an array) — there is nothing to filter in that case.
 */
export function structurallyValidReviewEvents(log: unknown): ReviewEvent[] | undefined {
  if (!isReviewEventLogShaped(log)) return undefined;
  return orderedEventsWithIssues(log)
    .filter((entry) => entry.issues.length === 0)
    .map((entry) => entry.event);
}
