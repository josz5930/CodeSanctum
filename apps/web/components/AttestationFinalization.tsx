import type { AttestationFinalizationViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton } from "./finding-primitives.js";

/**
 * Pre-action confirmation of the attestation package (E-11): it keeps the
 * receipt / signature / deletion / portal / limitation / recipient context
 * visible and requires a customer actor. It writes nothing — the web app posts
 * no finalize/export mutation; the action buttons are the confirmation surface
 * the builder produced.
 */
export function AttestationFinalization({ view }: { view: AttestationFinalizationViewContract }) {
  return (
    <section
      data-slot="attestation-finalization"
      data-available={String(view.available)}
      data-blocked={String(view.blocked)}
      data-actor-authority={view.actorAuthority}
    >
      {view.blocker === undefined ? null : (
        <div role={view.blocker.role} data-slot="finalization-blocker" data-affected-identity={view.blocker.affectedIdentity}>
          <h3>{view.blocker.title}</h3>
          <p>{view.blocker.message}</p>
        </div>
      )}
      <dl data-slot="finalization-identities">
        {view.identities.map((identity, index) => (
          <div key={index}>
            <dt>{identity.label}</dt>
            <dd>{identity.value}</dd>
          </div>
        ))}
      </dl>
      <dl data-slot="finalization-context">
        {view.visibleContext.map((entry, index) => (
          <div key={index}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
      <ul data-slot="included-artifacts">
        {view.includedArtifactRefs.map((ref, index) => (
          <li key={index}>{ref}</li>
        ))}
      </ul>
      <ul data-slot="deleted-artifacts">
        {view.deletedArtifacts.map((entry, index) => (
          <li key={index}>
            {entry.artifact_ref} — {entry.deletion_evidence_ref}
          </li>
        ))}
      </ul>
      <ul data-slot="finalization-limitations">
        {view.limitations.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
      {view.recipientNotes === undefined ? null : <p data-slot="recipient-notes">{view.recipientNotes}</p>}
      {view.sharingNotes === undefined ? null : <p data-slot="sharing-notes">{view.sharingNotes}</p>}
      <p data-slot="inline-confirmation" data-affected-identity={view.inlineConfirmation.affectedIdentity}>
        {view.inlineConfirmation.label}
      </p>
      <p data-slot="customer-control-notice">{view.customerControlNotice}</p>
      <ul>
        {view.actions.map((action, index) => (
          <li key={index}>
            <ActionButton action={action} />
          </li>
        ))}
      </ul>
    </section>
  );
}
