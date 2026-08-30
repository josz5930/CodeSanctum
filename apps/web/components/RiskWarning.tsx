import type { RiskWarningView } from "../../../packages/ui/src/index.js";
import { actionableAttributes } from "./a11y.js";

/**
 * Renders a RiskWarning contract as an `role="alert"` region. The affected
 * identities and every next-path action come straight from the sanitized view;
 * text is escaped by React at this boundary (E-6) and colour is never the only
 * signal (`doesNotRelyOnColor`).
 */
export function RiskWarning({ view }: { view: RiskWarningView }) {
  return (
    <section role={view.role} aria-live={view.ariaLive} data-slot={view.dataSlot} data-risk-type={view.riskType}>
      <h2>{view.title}</h2>
      <p>{view.message}</p>
      <dl>
        {view.affectedIdentities.map((identity, index) => (
          <div key={index}>
            <dt>{identity.label}</dt>
            <dd>{identity.value}</dd>
          </div>
        ))}
      </dl>
      {view.nextPaths.length === 0 ? null : (
        <ul>
          {view.nextPaths.map((action, index) => (
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
      )}
    </section>
  );
}
