import { structurallyValidReviewEvents, type ReviewEvent as ProtocolReviewEvent } from "../../protocol-ts/src/index.js";
import { TimelineEvent, type TimelineAudience, type TimelineEventView } from "./primitives.js";

export type ReviewHistoryTimelineEntry = {
  eventId: string;
  sequenceNumber: number;
  artifactRefs: string[];
  view: TimelineEventView;
};

/**
 * Renders a Story 2.4 review event log through the shipped Story 2.1
 * `TimelineEvent` primitive.
 *
 * C6-02: the whole log is first validated as one append-only, hash-verified,
 * uniquely-identified, strictly-ordered structure via protocol-ts's shared
 * `structurallyValidReviewEvents` (schema, content-addressed event identity,
 * sequence/duplicate/supersedes-chain checks — see [C6-02] finding entry for
 * the scoped boundary between this render-time structural check and
 * control-plane's deeper per-event-type append-authority tree). A log that
 * fails any of those checks renders nothing at all — an invalid history is
 * never sorted/repaired into a plausible-looking one. Entries are ascending
 * by `sequence_number` and an individual event is still dropped when
 * `TimelineEvent` returns `null` (audience/visibility filtering, e.g.
 * removing `internal_only` events from a customer audience).
 */
export function buildReviewHistoryTimeline(
  log: unknown,
  audience: TimelineAudience
): ReviewHistoryTimelineEntry[] {
  const events = structurallyValidReviewEvents(log);
  if (events === undefined) return [];
  return events
    .map((event) => entryForEvent(event, audience))
    .filter((entry): entry is ReviewHistoryTimelineEntry => entry !== undefined);
}

function entryForEvent(event: ProtocolReviewEvent, audience: TimelineAudience): ReviewHistoryTimelineEntry | undefined {
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
    return undefined;
  }
  return {
    eventId: event.event_id,
    sequenceNumber: event.sequence_number,
    artifactRefs: [...event.artifact_refs],
    view
  };
}
