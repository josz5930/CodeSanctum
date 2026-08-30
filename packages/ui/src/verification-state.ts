import type { CodeAttestColorRole } from "./tokens.js";

export type CanonicalVerificationState = "verification_complete" | "verification_pending" | "not_verified" | "requires_customer_side_validation";

const VERIFICATION_STATE_DEFINITIONS: Record<CanonicalVerificationState, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  verification_complete: {
    label: "Verification complete",
    meaning: "Reviewer recorded a bounded verification-complete decision for the selected finding and recorded criteria only.",
    tokenRole: "verification"
  },
  verification_pending: {
    label: "Verification pending",
    meaning: "Follow-up evidence or reviewer decision is still pending for the selected finding.",
    tokenRole: "warning"
  },
  not_verified: {
    label: "Not verified",
    meaning: "No bounded verification-complete decision has been recorded for the selected finding.",
    tokenRole: "neutral"
  },
  requires_customer_side_validation: {
    label: "Requires customer-side validation",
    meaning: "Customer-side validation is still required before a reviewer can complete the bounded verification decision.",
    tokenRole: "warning"
  }
};

const LEGACY_VERIFICATION_STATE_ALIASES: Record<string, CanonicalVerificationState> = {
  verified_with_evidence: "verification_complete",
  verification_failed: "not_verified",
  customer_validation_required: "requires_customer_side_validation",
  customer_side_validation_required: "requires_customer_side_validation",
  requires_customer_validation: "requires_customer_side_validation"
};

export function normalizeVerificationState(value: unknown): CanonicalVerificationState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(VERIFICATION_STATE_DEFINITIONS, value)) {
    return value as CanonicalVerificationState;
  }
  return Object.prototype.hasOwnProperty.call(LEGACY_VERIFICATION_STATE_ALIASES, value)
    ? LEGACY_VERIFICATION_STATE_ALIASES[value]
    : undefined;
}

export function verificationStateDefinition(value: CanonicalVerificationState): { label: string; meaning: string; tokenRole: CodeAttestColorRole } {
  const definition = VERIFICATION_STATE_DEFINITIONS[value];
  if (definition === undefined) {
    throw new Error(`Unknown canonical verification state: ${String(value)}`);
  }
  return definition;
}
