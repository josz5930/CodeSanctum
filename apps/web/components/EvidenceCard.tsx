import type { EvidenceCardView } from "../../../packages/ui/src/index.js";
import { StatusPill } from "./StatusPill.js";
import { actionableAttributes } from "./a11y.js";

/**
 * Renders a bounded EvidenceCard contract: one artifact identity, its state
 * pill, and the card's accessible actions. Reveals a reference only — never
 * artifact bytes (E-5).
 */
export function EvidenceCard({ view }: { view: EvidenceCardView }) {
  return (
    <article data-slot={view.dataSlot}>
      <h3>{view.artifactLabel}</h3>
      <dl>
        <dt>{view.identity.label}</dt>
        <dd>{view.identity.value}</dd>
      </dl>
      {view.timestamp === undefined ? null : (
        <time dateTime={view.timestamp.dateTime}>{view.timestamp.display}</time>
      )}
      <StatusPill view={view.state} />
      <ul>
        {view.actions.map((action, index) => (
          <li key={index}>
            <button
              type="button"
              data-action-type={action.type}
              aria-label={action.accessibleLabel}
              disabled={!action.actionable}
              {...actionableAttributes({ minTargetSizePx: action.minTargetSizePx, hoverOnly: action.hoverOnly })}
            >
              {action.label}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}
