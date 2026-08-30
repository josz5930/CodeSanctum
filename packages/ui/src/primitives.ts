import { codeAttestDesignTokens, colorTokensForRole } from "./tokens.js";
import { StatusPill, receiptReviewStateDefinitions, type ReceiptReviewState, type StatusPillView } from "./status.js";

export type IdentityRef = {
  label: string;
  value: string;
};

type ActorRef = {
  label: string;
  id?: string;
};

type TimestampView = {
  label: string;
  dateTime: string;
  display: string;
};

export type AccessibleAction = {
  type: string;
  label: string;
  accessibleLabel: string;
  hoverOnly: false;
  minTargetSizePx: number;
  actionable: boolean;
};

export type ReceiptVerificationState = "received_with_receipt" | "verification_pending" | "rejected_no_receipt" | "quarantined_no_receipt" | "failed_verification";

export type ReceiptBannerProps = {
  vendorReceiptId: string;
  evidenceBundleId: string;
  receiptTimestamp: string;
  verificationState: ReceiptVerificationState;
  manifestId?: string;
  signingKeyVersion?: string;
  mldsaProfile?: string;
  technicalDetailsLabel?: string;
};

export type ReceiptBannerView = {
  kind: "receipt-banner";
  dataSlot: "receipt-banner";
  role: "status";
  ariaLive: "polite";
  summary: string;
  identities: IdentityRef[];
  timestamp: TimestampView;
  verification: StatusPillView;
  technicalDetails: {
    label: string;
    expandedByDefault: false;
    rows: IdentityRef[];
  };
  tokens: ReturnType<typeof colorTokensForRole>;
  minTargetSizePx: number;
  reducedMotion: typeof codeAttestDesignTokens.motion;
};

export function canRenderReceiptBanner(props: ReceiptBannerProps | null | undefined): props is ReceiptBannerProps & { verificationState: "received_with_receipt" } {
  return props !== null
    && props !== undefined
    && isReceiptBannerSuccessState(props.verificationState)
    && hasVisibleText(props.vendorReceiptId)
    && hasVisibleText(props.evidenceBundleId)
    && isUtcRfc3339(props.receiptTimestamp);
}

export function ReceiptBanner(props: ReceiptBannerProps | null | undefined): ReceiptBannerView | null {
  if (!canRenderReceiptBanner(props)) {
    return null;
  }

  const receipt = sanitizeVisibleText(props.vendorReceiptId);
  const bundle = sanitizeVisibleText(props.evidenceBundleId);
  const identities: IdentityRef[] = [
    { label: "Vendor Receipt", value: receipt },
    { label: "Evidence Bundle", value: bundle }
  ];
  addOptionalIdentity(identities, "Outbound Manifest", props.manifestId);

  const technicalRows: IdentityRef[] = [
    { label: "Vendor Receipt", value: receipt },
    { label: "Evidence Bundle", value: bundle }
  ];
  addOptionalIdentity(technicalRows, "Outbound Manifest", props.manifestId);
  addOptionalIdentity(technicalRows, "Signing key/version", props.signingKeyVersion);
  addOptionalIdentity(technicalRows, "ML-DSA profile", props.mldsaProfile);
  technicalRows.push({ label: "Verification state", value: receiptReviewStateDefinitions.received_with_receipt.label });

  return {
    kind: "receipt-banner",
    dataSlot: "receipt-banner",
    role: "status",
    ariaLive: "polite",
    summary: `Vendor Receipt ${receipt} records that CodeAttest received bundle ${bundle}.`,
    identities,
    timestamp: timestampView("Receipt timestamp", props.receiptTimestamp),
    verification: StatusPill({ state: "received_with_receipt" }),
    technicalDetails: {
      label: visibleOrDefault(props.technicalDetailsLabel, "Receipt technical details"),
      expandedByDefault: false,
      rows: technicalRows
    },
    tokens: colorTokensForRole("verification"),
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    reducedMotion: codeAttestDesignTokens.motion
  };
}

export type RiskWarningNextPathType = "retry" | "quarantine" | "support" | "verify_receipt";
export type RiskWarningAudience = "customer" | "vendor" | "ops";

export type RiskWarningProps = {
  title: string;
  message: string;
  riskType: "failed_verification" | "malformed_bundle" | "failed_submission" | "storage_blocker" | "signature_verification_failed" | "rejected_no_receipt" | "quarantined_no_receipt";
  audience: RiskWarningAudience;
  /**
   * One failed submission can name several identities at once (manifest, bundle,
   * instance, attempt), so an array is allowed here. `affectedIdentity` stays
   * populated with the first one for callers written against the single-identity
   * shape.
   */
  affectedIdentity?: IdentityRef | IdentityRef[] | null;
  nextPaths?: Array<{ type: RiskWarningNextPathType; label: string } | null | undefined> | null;
};

export type RiskWarningView = {
  kind: "risk-warning";
  dataSlot: "risk-warning";
  role: "alert";
  ariaLive: "assertive";
  title: string;
  message: string;
  riskType: RiskWarningProps["riskType"];
  audience: RiskWarningAudience;
  affectedIdentity: IdentityRef;
  affectedIdentities: IdentityRef[];
  nextPaths: AccessibleAction[];
  tokens: ReturnType<typeof colorTokensForRole>;
  doesNotRelyOnColor: true;
};

// C6-27: frozen so the shared fallback reference can never be mutated and
// leak into a later, unrelated view.
const unavailableIdentity: IdentityRef = Object.freeze({ label: "Affected identity", value: "unavailable" });

const riskWarningRiskTypes = new Set<RiskWarningProps["riskType"]>(["failed_verification", "malformed_bundle", "failed_submission", "storage_blocker", "signature_verification_failed", "rejected_no_receipt", "quarantined_no_receipt"]);
const riskWarningAudiences = new Set<RiskWarningAudience>(["customer", "vendor", "ops"]);

/** C6-26: unavailable view returned instead of throwing/rendering an unwhitelisted enum. */
export const unavailableRiskWarning: RiskWarningView = Object.freeze({
  kind: "risk-warning",
  dataSlot: "risk-warning",
  role: "alert",
  ariaLive: "assertive",
  title: "Status unavailable",
  message: "This warning could not be validated and is not shown.",
  riskType: "failed_verification",
  audience: "ops",
  affectedIdentity: unavailableIdentity,
  affectedIdentities: [unavailableIdentity],
  nextPaths: [],
  tokens: colorTokensForRole("risk"),
  doesNotRelyOnColor: true
});

export function RiskWarning(props: RiskWarningProps | null | undefined): RiskWarningView {
  if (props === null || props === undefined || typeof props !== "object" || Array.isArray(props) || !riskWarningRiskTypes.has(props.riskType) || !riskWarningAudiences.has(props.audience) || !hasVisibleText(props.title) || !hasVisibleText(props.message)) {
    return unavailableRiskWarning;
  }
  const affectedIdentities = affectedIdentityViews(props.affectedIdentity);
  const candidateNextPaths = Array.isArray(props.nextPaths) ? props.nextPaths : [];
  const nextPaths = candidateNextPaths
    .filter(isRiskWarningNextPath)
    .filter((nextPath) => shouldRenderNextPathForAudience(nextPath.type, props.audience))
    .map((nextPath) => actionView(nextPath.type, nextPath.label, isActionableForAudience(nextPath.type, props.audience)));

  return {
    kind: "risk-warning",
    dataSlot: "risk-warning",
    role: "alert",
    ariaLive: "assertive",
    title: sanitizeVisibleText(props.title),
    message: sanitizeVisibleText(props.message),
    riskType: props.riskType,
    audience: props.audience,
    affectedIdentity: affectedIdentities[0] ?? unavailableIdentity,
    affectedIdentities,
    nextPaths,
    tokens: colorTokensForRole("risk"),
    doesNotRelyOnColor: true
  };
}

export type EvidenceCardProps = {
  artifactLabel: string;
  artifactIdentity: string;
  timestamp?: string;
  actor?: ActorRef;
  state: ReceiptReviewState;
  detailAction?: { label: string };
};

export type EvidenceCardView = {
  kind: "evidence-card";
  dataSlot: "evidence-card";
  oneBoundedArtifact: true;
  artifactLabel: string;
  identity: IdentityRef;
  timestamp?: TimestampView;
  actor?: ActorRef;
  state: StatusPillView;
  actions: AccessibleAction[];
  tokens: ReturnType<typeof colorTokensForRole>;
};

export function EvidenceCard(props: EvidenceCardProps | null | undefined): EvidenceCardView | null {
  if (props === null || props === undefined || typeof props !== "object" || Array.isArray(props) || !hasVisibleText(props.artifactLabel) || !hasVisibleText(props.artifactIdentity)) {
    // C6-26: a bounded-artifact card claiming "View details" with no real
    // identity is worse than no card at all — fail closed rather than render.
    return null;
  }
  const artifactLabel = sanitizeVisibleText(props.artifactLabel);
  const view: EvidenceCardView = {
    kind: "evidence-card",
    dataSlot: "evidence-card",
    oneBoundedArtifact: true,
    artifactLabel,
    identity: { label: artifactLabel, value: sanitizeVisibleText(props.artifactIdentity) },
    state: StatusPill({ state: props.state }),
    actions: [actionView("detail", visibleOrDefault(props.detailAction?.label, `View ${artifactLabel} details`), true)],
    tokens: colorTokensForRole("neutral")
  };
  if (isUtcRfc3339(props.timestamp)) {
    view.timestamp = timestampView(`${artifactLabel} timestamp`, props.timestamp);
  }
  if (isValidActor(props.actor)) {
    view.actor = actorView(props.actor);
  }
  return view;
}

export type TimelineVisibility = "customer_facing" | "internal_only";
export type TimelineAudience = "customer" | "vendor" | "ops";

export type TimelineEventProps = {
  eventType: string;
  timestamp: string;
  actor?: ActorRef;
  artifactReferences: IdentityRef[];
  visibility: TimelineVisibility;
  audience: TimelineAudience;
  internalNote?: string;
};

export type TimelineEventView = {
  kind: "timeline-event";
  dataSlot: "timeline-event";
  /** Raw machine-facing discriminator. Rendering adapters should use visibleEventType for display. */
  eventType: string;
  visibleEventType: string;
  timestamp: TimestampView;
  actor?: ActorRef;
  /** Every artifact the event references, in caller order. Empty when the event references none. */
  artifactReferences: IdentityRef[];
  visibility: {
    value: TimelineVisibility;
    label: "Customer-facing" | "Internal only";
  };
  internalDetailsVisible: boolean;
  internalNote?: string;
  tokens: ReturnType<typeof colorTokensForRole>;
};

export function TimelineEvent(props: TimelineEventProps): TimelineEventView | null {
  if (!isValidTimelineAudience(props.audience) || !isValidTimelineVisibility(props.visibility)) {
    return null;
  }
  if (!isUtcRfc3339(props.timestamp) || (props.visibility === "internal_only" && props.audience === "customer")) {
    return null;
  }

  if (props.visibility === "customer_facing" && hasVisibleText(props.internalNote)) {
    console.warn("TimelineEvent internalNote provided with customer_facing visibility; note was dropped from the view contract.");
  }

  const internalDetailsVisible = props.visibility === "internal_only" && props.audience !== "customer";
  const view: TimelineEventView = {
    kind: "timeline-event",
    dataSlot: "timeline-event",
    eventType: typeof props.eventType === "string" ? props.eventType : "",
    visibleEventType: sanitizeVisibleText(labelFromSnakeCase(typeof props.eventType === "string" ? props.eventType : "")),
    timestamp: timestampView("Event timestamp", props.timestamp),
    artifactReferences: (Array.isArray(props.artifactReferences) ? props.artifactReferences : []).map((reference) =>
      identityView(reference, { label: "Artifact reference", value: "unavailable" })
    ),
    visibility: {
      value: props.visibility,
      label: props.visibility === "customer_facing" ? "Customer-facing" : "Internal only"
    },
    internalDetailsVisible,
    tokens: colorTokensForRole("primary")
  };
  if (isValidActor(props.actor)) {
    view.actor = actorView(props.actor);
  }
  if (internalDetailsVisible && hasVisibleText(props.internalNote)) {
    view.internalNote = sanitizeVisibleText(props.internalNote);
  }
  return view;
}

export type AppShellProps = {
  actorContext?: ActorRef;
  selectedApplication?: string;
  selectedCommit?: string;
  reviewState?: ReceiptReviewState;
  navigationLabel?: string;
};

export type AppShellView = {
  kind: "app-shell";
  dataSlot: "app-shell";
  actorContext?: ActorRef;
  selectedApplication?: string;
  selectedCommit?: string;
  reviewState: StatusPillView;
  navigationLabel: string;
  separatesCustomerAndVendorControls: true;
  tokens: ReturnType<typeof colorTokensForRole>;
  minTargetSizePx: number;
};

export function AppShell(props: AppShellProps | null | undefined): AppShellView {
  const safeProps: AppShellProps = props !== null && props !== undefined && typeof props === "object" && !Array.isArray(props) ? props : {};
  const view: AppShellView = {
    kind: "app-shell",
    dataSlot: "app-shell",
    // C6-26/C6-28: missing state is absence of knowledge, not proof nothing
    // was submitted — default to "unknown", never the factual "not_submitted".
    reviewState: StatusPill({ state: hasVisibleText(safeProps.reviewState) ? safeProps.reviewState : "unknown" }),
    navigationLabel: visibleOrDefault(safeProps.navigationLabel, "CodeAttest evidence workflow"),
    separatesCustomerAndVendorControls: true,
    tokens: colorTokensForRole("neutral"),
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx
  };
  if (isValidActor(safeProps.actorContext)) {
    view.actorContext = actorView(safeProps.actorContext);
  }
  if (hasVisibleText(safeProps.selectedApplication)) {
    view.selectedApplication = sanitizeVisibleText(safeProps.selectedApplication);
  }
  if (hasVisibleText(safeProps.selectedCommit)) {
    view.selectedCommit = sanitizeVisibleText(safeProps.selectedCommit);
  }
  return view;
}

function actionView(type: string, label: string, actionable: boolean): AccessibleAction {
  const visibleLabel = sanitizeVisibleText(label);
  return {
    type: sanitizeVisibleText(type),
    label: visibleLabel,
    accessibleLabel: visibleLabel,
    hoverOnly: false,
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    actionable
  };
}

function isRiskWarningNextPath(value: { type?: unknown; label?: unknown } | null | undefined): value is { type: RiskWarningNextPathType; label: string } {
  return value !== null
    && value !== undefined
    && isRiskWarningNextPathType(value.type)
    && hasVisibleText(value.label);
}

function isRiskWarningNextPathType(value: unknown): value is RiskWarningNextPathType {
  return value === "retry" || value === "quarantine" || value === "support" || value === "verify_receipt";
}

function shouldRenderNextPathForAudience(type: RiskWarningNextPathType, audience: RiskWarningAudience): boolean {
  if (type !== "quarantine") {
    return true;
  }
  return audience === "vendor" || audience === "ops";
}

function isActionableForAudience(type: RiskWarningNextPathType, audience: RiskWarningAudience): boolean {
  if (type === "quarantine") {
    return audience === "vendor" || audience === "ops";
  }
  return true;
}

/**
 * Every identity a failed submission names must survive into the view, so the
 * array form is mapped entry by entry. An empty or absent input still yields one
 * entry, because a risk warning that names no identity at all is worse than one
 * that says the identity is unavailable.
 */
function affectedIdentityViews(affected: IdentityRef | IdentityRef[] | null | undefined): IdentityRef[] {
  if (Array.isArray(affected)) {
    const views = affected
      .filter((identity) => hasVisibleText(identity?.label) || hasVisibleText(identity?.value))
      .map((identity) => identityView(identity, unavailableIdentity));
    return views.length > 0 ? views : [{ ...unavailableIdentity }];
  }
  return [identityView(affected, unavailableIdentity)];
}

function identityView(identity: IdentityRef | null | undefined, fallback: IdentityRef = { label: "", value: "" }): IdentityRef {
  const label: string = hasVisibleText(identity?.label) ? (identity!.label) : fallback.label;
  const value: string = hasVisibleText(identity?.value) ? (identity!.value) : fallback.value;
  return {
    label: sanitizeVisibleText(label),
    value: sanitizeVisibleText(value)
  };
}

function actorView(actor: ActorRef): ActorRef {
  const view: ActorRef = {
    label: sanitizeVisibleText(actor.label)
  };
  if (actor.id !== undefined) {
    view.id = sanitizeVisibleText(actor.id);
  }
  return view;
}

function timestampView(label: string, dateTime: string): TimestampView {
  return {
    label: sanitizeVisibleText(label),
    dateTime: sanitizeVisibleText(dateTime),
    display: sanitizeVisibleText(dateTime)
  };
}

function addOptionalIdentity(rows: IdentityRef[], label: string, value: unknown): void {
  if (hasVisibleText(value)) {
    rows.push({ label: sanitizeVisibleText(label), value: sanitizeVisibleText(value) });
  }
}

function hasVisibleText(value: unknown): value is string {
  return sanitizeVisibleText(value).trim().length > 0;
}

function visibleOrDefault(value: unknown, fallback: string): string {
  return hasVisibleText(value) ? sanitizeVisibleText(value) : fallback;
}

function isReceiptBannerSuccessState(state: ReceiptVerificationState | null | undefined): state is "received_with_receipt" {
  return state === "received_with_receipt";
}

const utcRfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/;

function isUtcRfc3339(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const match = utcRfc3339Pattern.exec(value);
  if (match === null) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function sanitizeVisibleText(value: unknown): string {
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = String(value);
  } else if (typeof value === "bigint") {
    raw = String(value);
  } else {
    return "";
  }
  return raw
    .replace(/[\u0009\u000A\u000D]/gu, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\u2800\u3164\uFE00-\uFE0F\uFEFF\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/gu, "");
}

function labelFromSnakeCase(value: string): string {
  const spaced = value.replaceAll("_", " ").trim();
  if (spaced.length === 0) {
    return "Event";
  }
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function isValidActor(actor: unknown): actor is ActorRef {
  return actor !== null
    && actor !== undefined
    && typeof actor === "object"
    && !Array.isArray(actor)
    && hasVisibleText((actor as { label?: unknown }).label);
}

function isValidTimelineAudience(audience: unknown): audience is TimelineAudience {
  return audience === "customer" || audience === "vendor" || audience === "ops";
}

function isValidTimelineVisibility(visibility: unknown): visibility is TimelineVisibility {
  return visibility === "customer_facing" || visibility === "internal_only";
}
