import type { TimelineEventView } from "../../../packages/ui/src/index.js";

/**
 * Renders one review-history TimelineEvent contract. The host already drops
 * `internal_only` events for a customer audience, so an `internalNote` only
 * appears here when the contract says internal details are visible; the
 * adapter never re-derives visibility.
 */
export function TimelineEvent({ view }: { view: TimelineEventView }) {
  return (
    <li data-slot={view.dataSlot} data-event-type={view.eventType} data-visibility={view.visibility.value}>
      <span>{view.visibleEventType}</span>
      <time dateTime={view.timestamp.dateTime}>{view.timestamp.display}</time>
      {view.actor === undefined ? null : <span data-slot="actor">{view.actor.label}</span>}
      <span data-slot="visibility">{view.visibility.label}</span>
      {view.artifactReferences.length === 0 ? null : (
        <ul>
          {view.artifactReferences.map((reference, index) => (
            <li key={index}>{reference.value}</li>
          ))}
        </ul>
      )}
      {view.internalDetailsVisible && view.internalNote !== undefined ? (
        <p data-slot="internal-note">{view.internalNote}</p>
      ) : null}
    </li>
  );
}
