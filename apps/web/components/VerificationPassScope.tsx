import type { VerificationPassScopeViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton, Section, StatusChip } from "./finding-primitives.js";

/**
 * Renders a VerificationPassScope contract. The scope-limitation disclosure is
 * rendered as a non-dismissible note (no close control) so the "limited to
 * selected findings … not a fresh full review" statement always travels with
 * the scope (E-11 read-only).
 */
export function VerificationPassScope({ view }: { view: VerificationPassScopeViewContract }) {
  return (
    <article data-slot="verification-pass-scope" data-pass-ref={view.verificationPassRef} data-audience={view.audience}>
      <aside role="note" data-slot="scope-disclosure" data-non-dismissible={String(view.disclosure.nonDismissible)}>
        <h3>{view.disclosure.title}</h3>
        {view.disclosure.body.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </aside>
      <div data-slot="status-chips">
        {view.statusChips.map((chip, index) => (
          <StatusChip key={index} view={chip} />
        ))}
      </div>
      {view.sections.map((section, index) => (
        <Section key={index} view={section} />
      ))}
      <ul>
        {view.actions.map((action, index) => (
          <li key={index}>
            <ActionButton action={action} />
          </li>
        ))}
      </ul>
    </article>
  );
}
