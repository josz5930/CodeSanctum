import type { ReviewEvent } from "../../../../packages/protocol-ts/src/index.js";
import type { TimestampedReviewEventLogStore } from "../../../../packages/evidence-store/src/index.js";

import type { BudgetMeter } from "./budget-meter.js";

export type EventDerivedBudgetConfig = {
  monthly_unit_ceiling: number;
  unit_per_billable_event: number;
};

type BudgetEventLog = Pick<TimestampedReviewEventLogStore, "loadEventsByTimestampRange">;

const BILLABLE_EVENT_TYPES: ReadonlySet<ReviewEvent["event_type"]> = new Set([
  "receipt_issued",
  "submission_rejected",
  "submission_quarantined"
]);

function requirePositiveFinite(value: number, name: keyof EventDerivedBudgetConfig): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function utcMonthRange(now: Date): { startInclusive: string; endExclusive: string } {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("now must return a valid Date");
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    startInclusive: new Date(Date.UTC(year, month, 1)).toISOString(),
    endExclusive: new Date(Date.UTC(year, month + 1, 1)).toISOString()
  };
}

/**
 * Derives demo spend from the append-only submission-outcome projection in the
 * review-event log. Each finalized submission produces exactly one of the
 * three billable event types, so retries that never finalize do not inflate
 * the meter and no parallel mutable ledger can drift from product history.
 */
export function createEventDerivedBudgetMeter(input: {
  eventLog: BudgetEventLog;
  config: EventDerivedBudgetConfig;
  now?: () => Date;
}): BudgetMeter {
  requirePositiveFinite(input.config.monthly_unit_ceiling, "monthly_unit_ceiling");
  requirePositiveFinite(input.config.unit_per_billable_event, "unit_per_billable_event");
  const now = input.now ?? (() => new Date());

  return {
    async spendRatio(): Promise<number> {
      const range = utcMonthRange(now());
      const events = await input.eventLog.loadEventsByTimestampRange(range.startInclusive, range.endExclusive);
      const billableCount = events.reduce(
        (count, event) => count + (BILLABLE_EVENT_TYPES.has(event.event_type) ? 1 : 0),
        0
      );
      const ratio = billableCount * input.config.unit_per_billable_event / input.config.monthly_unit_ceiling;
      return Math.min(1, Math.max(0, ratio));
    }
  };
}
