import type { AccessibleAction, IdentityRef } from "../../../packages/ui/src/index.js";
import { actionableAttributes } from "./a11y.js";

type TextFirstStatus = {
  id: string;
  visibleLabel: string;
  accessibleLabel: string;
  meaning: string;
  tokenRole: string;
  role: "status";
  ariaLive: "polite";
};

type SectionLike = {
  id: string;
  title: string;
  summary: string;
  items: IdentityRef[];
  body: string[];
  actions: AccessibleAction[];
};

/** A text-first status chip: colour is never the only signal (E-6 / a11y). */
export function StatusChip({ view }: { view: TextFirstStatus }) {
  return (
    <span
      data-slot="status-chip"
      data-status-id={view.id}
      data-token-role={view.tokenRole}
      role={view.role}
      aria-live={view.ariaLive}
      aria-label={view.accessibleLabel}
      title={view.meaning}
    >
      {view.visibleLabel}
    </span>
  );
}

function ActionButton({ action }: { action: AccessibleAction }) {
  return (
    <button
      type="button"
      data-action-type={action.type}
      aria-label={action.accessibleLabel}
      disabled={!action.actionable}
      {...actionableAttributes({ minTargetSizePx: action.minTargetSizePx, hoverOnly: action.hoverOnly })}
    >
      {action.label}
    </button>
  );
}

/** A finding / verification-scope section, rendered text-first. */
export function Section({ view }: { view: SectionLike }) {
  return (
    <section data-slot="record-section" data-section-id={view.id}>
      <h3>{view.title}</h3>
      <p>{view.summary}</p>
      {view.items.length === 0 ? null : (
        <dl>
          {view.items.map((item, index) => (
            <div key={index}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {view.body.map((line, index) => (
        <p key={index}>{line}</p>
      ))}
      {view.actions.length === 0 ? null : (
        <ul>
          {view.actions.map((action, index) => (
            <li key={index}>
              <ActionButton action={action} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { ActionButton };
