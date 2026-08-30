import { toCanonicalRow } from "../canonical-row.js";
import type { AppendOutcome } from "../ports.js";

type StoredEntry = {
  digest: string;
  idempotencyKey: string;
  sequenceNumber: number;
  body: string;
};

type MinimalEvent = {
  event_timestamp: string;
  idempotency_key: string;
  sequence_number: number;
};

/**
 * In-memory append-only log with the semantics Architecture Rule 9 requires:
 * a repeated idempotency key with an identical body is a no-op, a differing
 * body under that key is a rewrite and is rejected, and a new event's sequence
 * number must be strictly greater than every one already present.
 *
 * Identity comparison uses the canonical digest rather than reference or
 * shallow equality, so key order in the caller's object is irrelevant.
 */
export function createMemoryAppendOnlyLog<TEvent extends MinimalEvent>() {
  const logs = new Map<string, StoredEntry[]>();

  return {
    async loadLog(reviewId: string): Promise<TEvent[]> {
      const entries = logs.get(reviewId) ?? [];
      return entries.map((entry) => JSON.parse(entry.body) as TEvent);
    },

    async loadEventsByTimestampRange(startInclusive: string, endExclusive: string): Promise<TEvent[]> {
      return [...logs.values()]
        .flat()
        .map((entry) => JSON.parse(entry.body) as TEvent)
        .filter((event) => event.event_timestamp >= startInclusive && event.event_timestamp < endExclusive)
        .sort((left, right) => left.event_timestamp.localeCompare(right.event_timestamp));
    },

    async append(reviewId: string, event: TEvent): Promise<AppendOutcome<TEvent>> {
      const entries = logs.get(reviewId) ?? [];
      const row = toCanonicalRow(event);

      const existing = entries.find((entry) => entry.idempotencyKey === event.idempotency_key);
      if (existing !== undefined) {
        return existing.digest === row.digest
          ? { outcome: "idempotent_noop", event: JSON.parse(existing.body) as TEvent }
          : { outcome: "rejected", reason: "idempotency_key_body_conflict" };
      }

      for (const entry of entries) {
        if (entry.sequenceNumber >= event.sequence_number) {
          return { outcome: "rejected", reason: "sequence_number_not_monotonic" };
        }
      }

      // A new array rather than a push, so a caller holding a previously
      // returned log cannot observe it growing underneath them.
      logs.set(reviewId, [
        ...entries,
        {
          digest: row.digest,
          idempotencyKey: event.idempotency_key,
          sequenceNumber: event.sequence_number,
          body: row.body
        }
      ]);

      return { outcome: "appended", event: JSON.parse(row.body) as TEvent };
    }
  };
}
