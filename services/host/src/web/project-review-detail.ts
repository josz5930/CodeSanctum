import {
  actorTypeForRole,
  type AuthenticatedActor
} from "../../../../packages/identity-store/src/index.js";
import type { EvidenceAccessRole } from "../../../../packages/identity-store/src/index.js";
import type { ReviewEvent } from "../../../../packages/protocol-ts/src/index.js";
import {
  buildReviewHistoryTimeline,
  EvidenceCard,
  ReceiptBanner,
  RiskWarning,
  StatusPill,
  type AppShellView,
  type EvidenceCardView,
  type ReceiptBannerView,
  type RiskWarningAudience,
  type RiskWarningView,
  type StatusPillView,
  type TimelineAudience,
  type TimelineEventView
} from "../../../../packages/ui/src/index.js";
import { projectContext } from "./project-context.js";
import { receiptReviewStateForEvents } from "./project-review-list.js";
import type { ReviewRecordSet } from "./record-store.js";

export type ReviewDetailView = {
  shell: AppShellView;
  reviewScope: string;
  reviewState: StatusPillView;
  receipt: ReceiptBannerView | null;
  noReceipt: RiskWarningView | null;
  timeline: TimelineEventView[];
  evidence: EvidenceCardView[];
};

/**
 * `internal_only` timeline entries and risk actions are gated by the audience,
 * which is derived from the grant's role (never the request). A reviewer sees
 * the internal ops view; a customer never does.
 */
export function audienceForRole(role: EvidenceAccessRole): TimelineAudience & RiskWarningAudience {
  return actorTypeForRole(role) === "customer_user" ? "customer" : "ops";
}

function receiptBannerFor(records: ReviewRecordSet | undefined): ReceiptBannerView | null {
  const record = records?.vendorReceipt;
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const receipt = record as Record<string, unknown>;
  return ReceiptBanner({
    vendorReceiptId: String(receipt.vendor_receipt_id ?? ""),
    evidenceBundleId: String(receipt.evidence_bundle_id ?? ""),
    receiptTimestamp: String(receipt.receipt_timestamp ?? ""),
    verificationState: "received_with_receipt",
    ...(typeof receipt.manifest_id === "string" ? { manifestId: receipt.manifest_id } : {})
  });
}

function noReceiptWarningFor(
  state: ReturnType<typeof receiptReviewStateForEvents>,
  audience: RiskWarningAudience,
  reviewScope: string
): RiskWarningView | null {
  if (state !== "rejected_no_receipt" && state !== "quarantined_no_receipt") {
    return null;
  }
  const rejected = state === "rejected_no_receipt";
  return RiskWarning({
    title: rejected ? "Rejected without a Vendor Receipt" : "Quarantined without a Vendor Receipt",
    message: rejected
      ? "CodeAttest rejected this submission. No Vendor Receipt was issued."
      : "CodeAttest quarantined this submission. No Vendor Receipt was issued.",
    riskType: state,
    audience,
    affectedIdentity: { label: "Review", value: reviewScope }
  });
}

function evidenceCardsFor(
  timeline: readonly { artifactRefs: string[] }[],
  reviewState: StatusPillView["state"]
): EvidenceCardView[] {
  const seen = new Set<string>();
  const cards: EvidenceCardView[] = [];
  for (const entry of timeline) {
    for (const ref of entry.artifactRefs) {
      if (seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      const card = EvidenceCard({ artifactLabel: "Evidence reference", artifactIdentity: ref, state: reviewState });
      if (card !== null) {
        cards.push(card);
      }
    }
  }
  return cards;
}

export function projectReviewDetail(input: {
  actor: AuthenticatedActor;
  role: EvidenceAccessRole;
  reviewScope: string;
  events: readonly ReviewEvent[];
  records: ReviewRecordSet | undefined;
}): ReviewDetailView {
  const audience = audienceForRole(input.role);
  const state = receiptReviewStateForEvents(input.events);
  const timelineEntries = buildReviewHistoryTimeline(
    { protocol_version: "codeattest.v0", review_id: input.reviewScope, events: [...input.events] },
    audience
  );
  return {
    shell: projectContext(input.actor),
    reviewScope: input.reviewScope,
    reviewState: StatusPill({ state }),
    receipt: state === "received_with_receipt" ? receiptBannerFor(input.records) : null,
    noReceipt: noReceiptWarningFor(state, audience, input.reviewScope),
    timeline: timelineEntries.map((entry) => entry.view),
    evidence: evidenceCardsFor(timelineEntries, state)
  };
}
