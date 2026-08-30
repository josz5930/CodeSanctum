import type { StaticBundleGenerationViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton } from "./finding-primitives.js";

/**
 * Renders a StaticBundleGeneration contract read-only. The non-dismissible
 * disclosure carries the software-custody signing limitation so the offline
 * static-sharing boundary always travels with the package (E-6).
 */
export function StaticBundleGeneration({ view }: { view: StaticBundleGenerationViewContract }) {
  return (
    <article
      data-slot="static-bundle-generation"
      data-available={String(view.available)}
      data-blocked={String(view.blocked)}
    >
      <p data-slot="status-label">{view.statusLabel}</p>
      {view.riskWarning === undefined ? null : (
        <div role={view.riskWarning.role} data-slot="bundle-risk" data-affected-identity={view.riskWarning.affectedIdentity}>
          <h3>{view.riskWarning.title}</h3>
          <p>{view.riskWarning.message}</p>
        </div>
      )}
      <dl data-slot="bundle-identities">
        {view.identities.map((identity, index) => (
          <div key={index}>
            <dt>{identity.label}</dt>
            <dd>{identity.value}</dd>
          </div>
        ))}
      </dl>
      <ul data-slot="bundle-files">
        {view.files.map((file, index) => (
          <li key={index} data-artifact-role={file.artifactRole}>
            {file.path} — {file.digest} ({file.sizeBytes} bytes, {file.sourceDerivedClass})
          </li>
        ))}
      </ul>
      <ul data-slot="minimization">
        {view.minimization.map((entry, index) => (
          <li key={index} data-category={entry.category}>
            {entry.reference}
          </li>
        ))}
      </ul>
      <dl data-slot="verification-details">
        {view.verificationDetails.map((entry, index) => (
          <div key={index}>
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
      <aside role="note" data-slot="signing-limitation" data-non-dismissible={String(view.disclosure.nonDismissible)}>
        <h3>{view.disclosure.title}</h3>
        {view.disclosure.body.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </aside>
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
