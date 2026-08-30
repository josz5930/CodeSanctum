import type { AuthenticatedActor } from "../../../../packages/identity-store/src/index.js";
import type { ReviewEvent } from "../../../../packages/protocol-ts/src/index.js";
import { StatusPill, type AppShellView, type ReceiptReviewState, type StatusPillView } from "../../../../packages/ui/src/index.js";
import { projectContext } from "./project-context.js";

export type ReviewListView = {
  shell: AppShellView;
  reviews: StatusPillView[];
};

/**
 * Submission-outcome events map onto the existing StatusPill vocabulary.
 * An empty log is unknown, never not_submitted.
 */
export function receiptReviewStateForEvents(
  events: readonly Pick<ReviewEvent, "event_type">[]
): ReceiptReviewState {
  if (events.length === 0) {
    return "unknown";
  }
  let mapped: ReceiptReviewState | undefined;
  for (const event of events) {
    if (event.event_type === "receipt_issued") {
      mapped = "received_with_receipt";
    } else if (event.event_type === "submission_rejected") {
      mapped = "rejected_no_receipt";
    } else if (event.event_type === "submission_quarantined") {
      mapped = "quarantined_no_receipt";
    }
  }
  return mapped ?? "under_review";
}

export function statusPillForReviewEvents(
  events: readonly Pick<ReviewEvent, "event_type">[]
): StatusPillView {
  return StatusPill({ state: receiptReviewStateForEvents(events) });
}

export function projectReviewList(
  actor: AuthenticatedActor,
  logs: readonly ReviewEvent[][]
): ReviewListView {
  return {
    shell: projectContext(actor),
    reviews: logs.map(statusPillForReviewEvents)
  };
}
