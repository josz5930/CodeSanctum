import {
  appendReviewEvent,
  buildSubmissionOutcomeEvent,
  computeReviewEventId,
  type ReviewEvent,
  type SubmissionOutcome
} from "../../../../apps/control-plane/src/index.js";
import type { ReviewEventLogStore } from "../../../../packages/evidence-store/src/index.js";

export type SubmissionReviewEventType = "receipt_issued" | "submission_rejected" | "submission_quarantined";

export type AppendSubmissionReviewEventInput = {
  reviewId: string;
  eventType: SubmissionReviewEventType;
  eventTimestamp: string;
  outcome: SubmissionOutcome;
};

const VENDOR_SERVICE_ACTOR = { actor_type: "vendor_service" as const, actor_id: "vendor_service:codeattest-intake" };

/**
 * Mirrors control-plane's own private `submissionEventIdempotencyKey`, which
 * `buildSubmissionOutcomeEvent` defaults to whenever the caller does not
 * supply one. Reused verbatim here for `receipt_issued` too, so every
 * submission-outcome event -- success or failure -- keys the same way.
 */
function submissionEventIdempotencyKey(outcome: SubmissionOutcome): string {
  return `submission_attempt:${outcome.bundle_instance_id}:${outcome.submission_attempt_id}`;
}

/**
 * Builds the review event a submission outcome produces. `receipt_issued`
 * has no dedicated builder in apps/control-plane (its own `receipt_issued`
 * check only recognizes a fixed `artifact_ref:vendor_receipt`), so it is
 * built here, by hand, in the same shape `buildSubmissionOutcomeEvent`
 * produces for the two failure states.
 */
function draftEvent(input: AppendSubmissionReviewEventInput, sequenceNumber: number): ReviewEvent {
  if (input.eventType === "receipt_issued") {
    return {
      protocol_version: input.outcome.protocol_version,
      event_id: `sha256:${"0".repeat(64)}`,
      review_id: input.reviewId,
      sequence_number: sequenceNumber,
      idempotency_key: submissionEventIdempotencyKey(input.outcome),
      event_type: "receipt_issued",
      actor: VENDOR_SERVICE_ACTOR,
      event_timestamp: input.eventTimestamp,
      artifact_refs: ["artifact_ref:vendor_receipt"],
      visibility: "customer_facing",
      canonicalization: "rfc8785",
      identity_hash_algorithm: "sha256",
      identity_input_excludes: ["event_id"]
      // No `reason`: the outcome's own customer_facing_summary text
      // ("...Vendor Receipt...") trips the claim-safety scan's forbidden
      // "vendor receipt" phrase on this field. `reason` is optional and the
      // fixed artifact_refs/event_type already say what happened.
    };
  }
  const built = buildSubmissionOutcomeEvent(input.outcome, {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: sequenceNumber,
    actor: VENDOR_SERVICE_ACTOR,
    visibility: "customer_facing"
  });
  if (built.outcome !== "built") {
    throw new Error(`submission outcome event could not be built: ${built.reason}`);
  }
  return built.event;
}

export type AppendSubmissionReviewEventResult = { outcome: "appended" | "idempotent_noop" } | { outcome: "rejected"; reason: string };

/**
 * Loads the current review-event log, builds the draft event, computes its
 * real identity (excluding `event_id`, matching `identity_input_excludes`),
 * runs it through the pure `appendReviewEvent` authority boundary, and only
 * then persists it through the store port -- the same load/call/persist
 * shape A1 uses everywhere else.
 */
export function createSubmissionReviewEventAppender(reviewEventLog: ReviewEventLogStore) {
  return async function appendSubmissionReviewEvent(input: AppendSubmissionReviewEventInput): Promise<AppendSubmissionReviewEventResult> {
    const events = await reviewEventLog.loadLog(input.reviewId);
    const existing = events.find((event) => event.idempotency_key === submissionEventIdempotencyKey(input.outcome));
    const sequenceNumber = existing?.sequence_number ?? events.length;

    const draft = draftEvent(input, sequenceNumber);
    const eventId = await computeReviewEventId(draft);
    const event: ReviewEvent = { ...draft, event_id: eventId };

    const log = { protocol_version: event.protocol_version, review_id: input.reviewId, events };
    const appended = await appendReviewEvent(log, event);
    if (appended.outcome === "rejected") {
      return { outcome: "rejected", reason: appended.reason };
    }
    if (appended.outcome === "idempotent_noop") {
      return { outcome: "idempotent_noop" };
    }

    const persisted = await reviewEventLog.append(input.reviewId, event);
    if (persisted.outcome === "rejected") {
      return { outcome: "rejected", reason: persisted.reason };
    }
    return { outcome: persisted.outcome === "idempotent_noop" ? "idempotent_noop" : "appended" };
  };
}
