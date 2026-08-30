import type { CustomerFindingRecordViewContract } from "../../../packages/ui/src/index.js";
import { ActionButton, Section, StatusChip } from "./finding-primitives.js";

/**
 * Renders a CustomerFindingRecord contract read-only: status chips, the
 * classification / evidence-basis / remediation / verification sections, and
 * the record actions. No create/edit controls (E-11). The host already applied
 * the export posture and fail-closed to an "unavailable" view when needed.
 */
export function CustomerFindingRecord({ view }: { view: CustomerFindingRecordViewContract }) {
  return (
    <article data-slot="customer-finding-record" data-record-ref={view.recordRef} data-audience={view.audience}>
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
