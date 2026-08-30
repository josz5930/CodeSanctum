import { codeAttestDesignTokens, colorTokensForRole, deepFreeze as deepFreezeStatusRegistry, type CodeAttestColorRole } from "./tokens.js";

export const receiptReviewStateValues = [
  "not_submitted",
  "submitted",
  "received",
  "received_with_receipt",
  "rejected_no_receipt",
  "quarantined_no_receipt",
  "under_review",
  "review_complete",
  "verification_pending",
  "finalized",
  "deleted",
  "retained",
  "not_collected",
  "unknown"
] as const;

export type ReceiptReviewState = typeof receiptReviewStateValues[number];

export type ReceiptReviewStateDefinition = {
  value: ReceiptReviewState;
  label: string;
  meaning: string;
  colorRole: CodeAttestColorRole;
  receiptImplication: "no_receipt" | "receipt_required" | "neutral" | "unknown";
};

export const receiptReviewStateDefinitions: Record<ReceiptReviewState, ReceiptReviewStateDefinition> = deepFreezeStatusRegistry({
  not_submitted: {
    value: "not_submitted",
    label: "Not submitted",
    meaning: "No evidence has been submitted to CodeAttest.",
    colorRole: "neutral",
    receiptImplication: "no_receipt"
  },
  submitted: {
    value: "submitted",
    label: "Submitted",
    meaning: "A submission attempt exists, but verified receipt has not been established by this label.",
    colorRole: "primary",
    receiptImplication: "neutral"
  },
  received: {
    value: "received",
    label: "Received",
    meaning: "A plain-language lifecycle label. Use received with receipt when Vendor Receipt identity exists.",
    colorRole: "review",
    receiptImplication: "neutral"
  },
  received_with_receipt: {
    value: "received_with_receipt",
    label: "Received with receipt",
    meaning: "CodeAttest has issued a Vendor Receipt after required verification checks.",
    colorRole: "verification",
    receiptImplication: "receipt_required"
  },
  rejected_no_receipt: {
    value: "rejected_no_receipt",
    label: "Rejected without receipt",
    meaning: "CodeAttest rejected the submission and no Vendor Receipt exists.",
    colorRole: "risk",
    receiptImplication: "no_receipt"
  },
  quarantined_no_receipt: {
    value: "quarantined_no_receipt",
    label: "Quarantined without receipt",
    meaning: "CodeAttest quarantined the submission and no Vendor Receipt exists.",
    colorRole: "risk",
    receiptImplication: "no_receipt"
  },
  under_review: {
    value: "under_review",
    label: "Under review",
    meaning: "Review is active; this does not imply classification completion.",
    colorRole: "review",
    receiptImplication: "neutral"
  },
  review_complete: {
    value: "review_complete",
    label: "Review complete",
    meaning: "Review workflow is complete; this does not imply attestation or static portal completion.",
    colorRole: "review",
    receiptImplication: "neutral"
  },
  verification_pending: {
    value: "verification_pending",
    label: "Verification pending",
    meaning: "Verification work is still open and must not be presented as final.",
    colorRole: "warning",
    receiptImplication: "neutral"
  },
  finalized: {
    value: "finalized",
    label: "Finalized",
    meaning: "Finalized within the product workflow; this does not imply auditor acceptance.",
    colorRole: "neutral",
    receiptImplication: "neutral"
  },
  deleted: {
    value: "deleted",
    label: "Deleted",
    meaning: "Evidence is deleted under policy when deletion evidence exists.",
    colorRole: "neutral",
    receiptImplication: "neutral"
  },
  retained: {
    value: "retained",
    label: "Retained",
    meaning: "Evidence is retained under policy or explicit customer opt-in.",
    colorRole: "warning",
    receiptImplication: "neutral"
  },
  not_collected: {
    value: "not_collected",
    label: "Not collected",
    meaning: "This artifact or evidence category was never collected.",
    colorRole: "neutral",
    receiptImplication: "no_receipt"
  },
  unknown: {
    value: "unknown",
    label: "Unknown state",
    meaning: "Status value is unknown or drifted; treat as not verified.",
    colorRole: "neutral",
    // C6-28: absence of knowledge is not evidence of absence. An unknown or
    // drifted state must not be treated as positive proof no receipt exists.
    receiptImplication: "unknown"
  }
});

const unknownReceiptReviewStateDefinition: ReceiptReviewStateDefinition = receiptReviewStateDefinitions.unknown;

export type StatusPillProps = {
  state: ReceiptReviewState | string;
  emphasis?: "default" | "compact";
};

export type StatusPillView = {
  kind: "status-pill";
  dataSlot: "status-pill";
  state: ReceiptReviewState;
  visibleLabel: string;
  accessibleLabel: string;
  meaning: string;
  colorRole: CodeAttestColorRole;
  tokens: ReturnType<typeof colorTokensForRole>;
  doesNotRelyOnColor: true;
  minTargetSizePx: number;
  /** C6-47: propagated so adapters can actually honor a compact rendering. */
  emphasis: "default" | "compact";
};

export function StatusPill(props: StatusPillProps): StatusPillView {
  const definition = statusDefinitionFor(props.state);
  return {
    kind: "status-pill",
    dataSlot: "status-pill",
    state: definition.value,
    visibleLabel: definition.label,
    accessibleLabel: `${definition.label}: ${definition.meaning}`,
    meaning: definition.meaning,
    colorRole: definition.colorRole,
    tokens: colorTokensForRole(definition.colorRole),
    doesNotRelyOnColor: true,
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    emphasis: props.emphasis === "compact" ? "compact" : "default"
  };
}

export function isNoReceiptState(state: ReceiptReviewState | string): boolean {
  return statusDefinitionFor(state).receiptImplication === "no_receipt";
}

function statusDefinitionFor(state: ReceiptReviewState | string): ReceiptReviewStateDefinition {
  if (isReceiptReviewState(state)) {
    return receiptReviewStateDefinitions[state];
  }
  return unknownReceiptReviewStateDefinition;
}

export function isReceiptReviewState(state: string): state is ReceiptReviewState {
  return receiptReviewStateValues.includes(state as ReceiptReviewState);
}
