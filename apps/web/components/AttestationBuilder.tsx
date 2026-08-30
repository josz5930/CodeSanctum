import type { AttestationBuilderViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton } from "./finding-primitives.js";

function LabelValues({ rows }: { rows: ReadonlyArray<{ label: string; value: string }> }) {
  return (
    <dl>
      {rows.map((row, index) => (
        <div key={index}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Renders an AttestationBuilder contract read-only: scope, receipt chain,
 * per-section evidence basis / limitations / references, lifecycle, and the
 * non-dismissible bounded-attestation disclosure. Any "generate" action is
 * whatever the builder chose for the audience; E adds no mutation route (E-11).
 */
export function AttestationBuilder({ view }: { view: AttestationBuilderViewContract }) {
  return (
    <article
      data-slot="attestation-builder"
      data-available={String(view.available)}
      data-audience={view.audience}
      data-attestation-id={view.attestationId}
    >
      <header>
        <p>{view.generationAuthority}</p>
        <LabelValues rows={view.scopeContext} />
      </header>
      <section data-slot="receipt-chain">
        <h3>Receipt chain</h3>
        <LabelValues rows={view.receiptChain} />
      </section>
      {view.sections.map((section) => (
        <section key={section.id} data-slot="attestation-section" data-section-type={section.sectionType}>
          <h3>{section.title}</h3>
          <p>{section.summary}</p>
          <p>{section.scope}</p>
          <ul data-slot="evidence-basis">
            {section.evidenceBasis.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <ul data-slot="section-limitations">
            {section.limitations.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <ul data-slot="section-references">
            {section.supportingArtifactRefs.map((ref, index) => (
              <li key={index}>{ref}</li>
            ))}
          </ul>
          <ul>
            {section.actions.map((action, index) => (
              <li key={index}>
                <ActionButton action={action} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section data-slot="lifecycle">
        <h3>Evidence lifecycle</h3>
        <dl>
          {view.lifecycle.map((entry, index) => (
            <div key={index}>
              <dt>{entry.label}</dt>
              <dd>
                {entry.reference} — {entry.visibleState}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <ul data-slot="method-limitations">
        {view.methodLimitations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      <ul data-slot="attestation-limitations">
        {view.limitations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      <aside role="note" data-slot="attestation-disclosure" data-non-dismissible={String(view.disclosure.nonDismissible)}>
        <h3>{view.disclosure.title}</h3>
        {view.disclosure.body.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </aside>
      <ul data-slot="copy-actions">
        {view.copyActions.map((action, index) => (
          <li key={index}>
            <ActionButton action={action} />
          </li>
        ))}
      </ul>
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
