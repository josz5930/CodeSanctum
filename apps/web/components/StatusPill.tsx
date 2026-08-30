import type { StatusPillView } from "../../../packages/ui/src/index.js";

/**
 * Renders a StatusPill contract. Text goes through React children only, so the
 * visible and accessible labels are entity-escaped at this boundary (E-6).
 */
export function StatusPill({ view }: { view: StatusPillView }) {
  return (
    <span
      data-slot={view.dataSlot}
      data-state={view.state}
      data-color-role={view.colorRole}
      data-does-not-rely-on-color={String(view.doesNotRelyOnColor)}
      data-emphasis={view.emphasis}
      data-min-target-size-px={view.minTargetSizePx}
      aria-label={view.accessibleLabel}
      title={view.meaning}
    >
      {view.visibleLabel}
    </span>
  );
}
