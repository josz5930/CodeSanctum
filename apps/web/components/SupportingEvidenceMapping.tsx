import type { SupportingEvidenceMappingViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton } from "./finding-primitives.js";

/**
 * Renders a SupportingEvidenceMapping contract read-only. The builder only
 * exposes approved, versioned profiles; the acceptance disclaimer ("an evidence
 * consumer decides…") always travels with the mapping so no acceptance or
 * certification claim is implied (E-6).
 */
export function SupportingEvidenceMapping({ view }: { view: SupportingEvidenceMappingViewContract }) {
  return (
    <article
      data-slot="supporting-evidence-mapping"
      data-available={String(view.available)}
      data-profile={view.profile}
      data-mapping-id={view.mappingId}
    >
      <header>
        <p>{view.decisionAuthority}</p>
        <p data-slot="acceptance-disclaimer">{view.acceptanceDisclaimer}</p>
      </header>
      {view.entries.map((entry) => (
        <section key={entry.id} data-slot="mapping-entry">
          <h3>{entry.topic}</h3>
          <p>{entry.supportingEvidenceRole}</p>
          <p>{entry.scopeSummary}</p>
          <p>{entry.methodSummary}</p>
          <p>{entry.receiptContext}</p>
          <ul data-slot="entry-references">
            {entry.evidenceRefs.map((ref, index) => (
              <li key={index}>{ref}</li>
            ))}
          </ul>
          <ul data-slot="entry-limitations">
            {entry.limitations.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      ))}
      <ul data-slot="mapping-limitations">
        {view.limitations.map((line, index) => (
          <li key={index}>{line}</li>
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
