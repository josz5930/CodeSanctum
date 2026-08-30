import type { ReceiptBannerView } from "../../../packages/ui/src/index.js";
import { StatusPill } from "./StatusPill.js";

/**
 * Renders a ReceiptBanner contract. The technical details stay collapsed by
 * default (`expandedByDefault: false`); text is escaped by React at this
 * boundary (E-6).
 */
export function ReceiptBanner({ view }: { view: ReceiptBannerView }) {
  return (
    <section
      role={view.role}
      aria-live={view.ariaLive}
      data-slot={view.dataSlot}
      data-min-target-size-px={view.minTargetSizePx}
    >
      <p>{view.summary}</p>
      <dl>
        {view.identities.map((identity, index) => (
          <div key={index}>
            <dt>{identity.label}</dt>
            <dd>{identity.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        <span>{view.timestamp.label}: </span>
        <time dateTime={view.timestamp.dateTime}>{view.timestamp.display}</time>
      </p>
      <StatusPill view={view.verification} />
      <details open={view.technicalDetails.expandedByDefault}>
        <summary>{view.technicalDetails.label}</summary>
        <dl>
          {view.technicalDetails.rows.map((row, index) => (
            <div key={index}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
