import { customerVisibleTextForbidden, structurallyValidReviewEvents, type ReviewEvent as ProtocolReviewEvent } from "../../protocol-ts/src/index.js";
import {
  RiskWarning,
  TimelineEvent,
  type RiskWarningAudience,
  type RiskWarningNextPathType,
  type RiskWarningView,
  type TimelineAudience,
  type TimelineEventView
} from "./primitives.js";

/**
 * The protocol `next_path` vocabulary records what the *system* offers; the
 * Story 2.1 `RiskWarningNextPathType` vocabulary records what an *audience* may
 * act on. They are deliberately different unions, mapped here rather than by
 * widening either one.
 */
export type SubmissionProtocolNextPath = "retry" | "quarantine_support" | "contact_support" | "verify_receipt";

// C6-03: a plain object literal still exposes `Object.prototype` members
// (`toString`, `constructor`, `__proto__`, ...) through bracket access, so a
// runtime (non-TypeScript-checked) `protocolPath` value of one of those names
// would resolve to an inherited function instead of `undefined`, silently
// bypassing the "unknown path" guard below. `Map`s have no prototype-chain
// key collisions and are frozen so no consumer can add/remove a mapping.
const NEXT_PATH_BY_PROTOCOL_PATH: ReadonlyMap<SubmissionProtocolNextPath, RiskWarningNextPathType> = new Map([
  ["retry", "retry"],
  ["quarantine_support", "quarantine"],
  ["contact_support", "support"],
  ["verify_receipt", "verify_receipt"]
]);

const NEXT_PATH_LABELS: ReadonlyMap<RiskWarningNextPathType, string> = new Map([
  ["retry", "Retry this submission"],
  ["quarantine", "Open the quarantine queue"],
  ["support", "Contact CodeAttest support"],
  ["verify_receipt", "Verify the Vendor Receipt"]
]);

// C6-04: which next paths make sense depends on the outcome state, matching
// the protocol's own real convention (`submission-outcome.schema.json`'s
// `next_path` is a single value per state: `rejected_no_receipt` fixtures
// carry `retry`, `quarantined_no_receipt` fixtures carry `quarantine_support`).
// Neither no-receipt state has anything to `verify_receipt` — there is no
// receipt. `contact_support` is always allowed as the UI's own fallback path.
const ALLOWED_NEXT_PATHS_BY_STATE: ReadonlyMap<"rejected_no_receipt" | "quarantined_no_receipt", ReadonlySet<SubmissionProtocolNextPath>> = new Map([
  ["rejected_no_receipt", new Set<SubmissionProtocolNextPath>(["retry", "contact_support"])],
  ["quarantined_no_receipt", new Set<SubmissionProtocolNextPath>(["quarantine_support", "contact_support"])]
]);

const RISK_WARNING_AUDIENCES: ReadonlySet<RiskWarningAudience> = new Set(["customer", "vendor", "ops"]);
const TIMELINE_AUDIENCES: ReadonlySet<TimelineAudience> = new Set(["customer", "vendor", "ops"]);

const OUTCOME_TITLES = {
  rejected_no_receipt: "Submission rejected without a receipt",
  quarantined_no_receipt: "Submission quarantined without a receipt"
} as const;

const UTC_RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/;

/**
 * Props are declared structurally rather than imported from `apps/control-plane`:
 * `npm run lint:deps` enforces that direction, so this package describes the
 * exact notice shape it renders instead of depending on the boundary that
 * produces one.
 */
export type SubmissionFailureNoticeProps = {
  outcome_state: "rejected_no_receipt" | "quarantined_no_receipt" | "received_with_receipt";
  review_id: string;
  submission_outcome_id: string;
  occurred_at: string;
  submission_identities: Array<{ identity_type: string; identity_value: string }>;
  failure_reason_codes?: string[];
  next_paths: SubmissionProtocolNextPath[];
  customer_facing_summary: string;
  audience: RiskWarningAudience;
  title?: string;
};

/**
 * A failed submission renders as the Story 2.1 blocking risk warning naming
 * every identity it knows. `received_with_receipt` returns `null` — a success is
 * never a blocking warning, and there is no path here that renders one as
 * anything other than a failure.
 *
 * C6-04: `outcome_state` now bounds which `next_paths` may render (see
 * `ALLOWED_NEXT_PATHS_BY_STATE`), `audience` is runtime-whitelisted before
 * use, and `customer_facing_summary`/`title` are rejected outright (the
 * whole notice becomes unavailable, not silently blanked) when they are
 * blank or trip the shared claim/source-safety guard — an unsafe or empty
 * message must never reach an assertive alert.
 */
export function SubmissionFailureNotice(props: SubmissionFailureNoticeProps | null | undefined): RiskWarningView | null {
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    return null;
  }
  if (props.outcome_state !== "rejected_no_receipt" && props.outcome_state !== "quarantined_no_receipt") {
    return null;
  }
  if (!RISK_WARNING_AUDIENCES.has(props.audience)) {
    return null;
  }
  if (!isSafeVisibleText(props.customer_facing_summary)) {
    return null;
  }
  if (props.title !== undefined && !isSafeVisibleText(props.title)) {
    return null;
  }

  const nextPaths = riskNextPaths(props.next_paths, props.audience, props.outcome_state);
  const submissionIdentities = Array.isArray(props.submission_identities) ? props.submission_identities : [];

  return RiskWarning({
    title: typeof props.title === "string" && props.title.length > 0 ? props.title : OUTCOME_TITLES[props.outcome_state],
    message: props.customer_facing_summary,
    riskType: props.outcome_state,
    audience: props.audience,
    affectedIdentity: submissionIdentities.flatMap((identity) => submissionIdentityView(identity)),
    nextPaths
  });
}

function isSafeVisibleText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && customerVisibleTextForbidden(value) === undefined;
}

export type SubmissionAttemptTimelineEntry = {
  eventId: string;
  sequenceNumber: number;
  artifactRefs: string[];
  outcomeEventType: "submission_rejected" | "submission_quarantined";
  view: TimelineEventView | { kind: "timeline-error"; dataSlot: "timeline-event"; role: "alert"; error: "submission_timeline_invalid_timestamp"; eventId: string; message: string };
};

/**
 * Prior failed attempts stay visible through the existing review-event-log. This
 * reads the Story 2.4 log directly; it never introduces a bespoke attempt
 * history type. Invalid timestamps surface as explicit error entries rather than
 * silently disappearing.
 *
 * C6-05: consumes the same protocol-ts `structurallyValidReviewEvents`
 * snapshot as the review-history timeline (see [C6-02]) instead of a local,
 * weaker shape guard — closing the enclosing-log review binding, protocol
 * version, event identity/hash, sequence/order/idempotency-uniqueness, and
 * typed-ref-shape gaps the local guard previously left open. `audience` is
 * validated before any event is inspected, so an unrecognized audience can
 * never reach the timestamp-error path (which would otherwise expose an
 * internal event id before visibility gating had a chance to run).
 */
export function buildSubmissionAttemptTimeline(
  log: unknown,
  audience: TimelineAudience
): SubmissionAttemptTimelineEntry[] {
  if (!TIMELINE_AUDIENCES.has(audience)) {
    return [];
  }
  const events = structurallyValidReviewEvents(log);
  if (events === undefined) {
    return [];
  }
  return events
    .filter(isRenderableSubmissionEvent)
    .flatMap((event) => entryForSubmissionEvent(event, audience));
}

function entryForSubmissionEvent(event: RenderableSubmissionEvent, audience: TimelineAudience): SubmissionAttemptTimelineEntry[] {
  if (event.visibility === "internal_only" && audience === "customer") {
    return [];
  }

  const outcomeEventType = event.event_type;
  if (!isUtcRfc3339(event.event_timestamp)) {
    return [timelineTimestampError(event, outcomeEventType)];
  }

  const artifactReferences = event.artifact_refs.map((value) => ({ label: "Artifact reference", value }));
  const view = TimelineEvent({
    eventType: event.event_type,
    timestamp: event.event_timestamp,
    actor: { label: event.actor.actor_type, id: event.actor.actor_id },
    artifactReferences,
    visibility: event.visibility,
    audience,
    ...(event.internal_note === undefined ? {} : { internalNote: event.internal_note })
  });

  if (view === null) {
    return [];
  }

  return [{
    eventId: event.event_id,
    sequenceNumber: event.sequence_number,
    artifactRefs: [...event.artifact_refs],
    outcomeEventType,
    view
  }];
}

function timelineTimestampError(
  event: RenderableSubmissionEvent,
  outcomeEventType: "submission_rejected" | "submission_quarantined"
): SubmissionAttemptTimelineEntry {
  return {
    eventId: event.event_id,
    sequenceNumber: event.sequence_number,
    artifactRefs: [...event.artifact_refs],
    outcomeEventType,
    view: {
      kind: "timeline-error",
      dataSlot: "timeline-event",
      role: "alert",
      error: "submission_timeline_invalid_timestamp",
      eventId: event.event_id,
      message: "Submission event timestamp could not be rendered."
    }
  };
}

function submissionIdentityView(identity: unknown): Array<{ label: string; value: string }> {
  if (!isRecord(identity) || typeof identity.identity_type !== "string" || typeof identity.identity_value !== "string") {
    return [];
  }
  return [{ label: identity.identity_type, value: identity.identity_value }];
}

function riskNextPaths(
  protocolPaths: SubmissionProtocolNextPath[] | null | undefined,
  audience: RiskWarningAudience,
  outcomeState: "rejected_no_receipt" | "quarantined_no_receipt"
): Array<{ type: RiskWarningNextPathType; label: string }> {
  const allowedForState = ALLOWED_NEXT_PATHS_BY_STATE.get(outcomeState) ?? new Set<SubmissionProtocolNextPath>();
  const seenPathTypes = new Set<RiskWarningNextPathType>();
  const nextPaths: Array<{ type: RiskWarningNextPathType; label: string }> = [];
  for (const protocolPath of Array.isArray(protocolPaths) ? protocolPaths : []) {
    if (!allowedForState.has(protocolPath)) {
      continue;
    }
    const type = NEXT_PATH_BY_PROTOCOL_PATH.get(protocolPath);
    if (type === undefined || seenPathTypes.has(type)) {
      continue;
    }
    seenPathTypes.add(type);
    nextPaths.push({ type, label: NEXT_PATH_LABELS.get(type)! });
  }

  // The UI owns the post-gating non-empty guarantee because it cannot depend on
  // the control-plane projection that usually adds contact_support.
  if (!nextPaths.some((nextPath) => nextPath.type !== "quarantine" || audience !== "customer")) {
    nextPaths.push({ type: "support", label: NEXT_PATH_LABELS.get("support")! });
  }

  return nextPaths;
}

// C6-05: shape/identity/order/actor/visibility/typed-ref validation now
// happens once, upstream, in the shared `structurallyValidReviewEvents`
// snapshot every event here has already passed — this only narrows by the
// two event types this timeline renders.
type RenderableSubmissionEvent = ProtocolReviewEvent & {
  event_type: "submission_rejected" | "submission_quarantined";
};

function isRenderableSubmissionEvent(event: ProtocolReviewEvent): event is RenderableSubmissionEvent {
  return event.event_type === "submission_rejected" || event.event_type === "submission_quarantined";
}

function isUtcRfc3339(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = UTC_RFC3339_PATTERN.exec(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
