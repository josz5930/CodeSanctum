import { toCanonicalRow } from "../canonical-row.js";
import type { AppendOutcome } from "../ports.js";
import type { SqlExecutor } from "./pool.js";

type MinimalEvent = {
  event_timestamp: string;
  idempotency_key: string;
  sequence_number: number;
};

/**
 * Postgres-backed append-only log with the same semantics as the memory
 * adapter, proven by the same contract suite.
 *
 * Ordering is serialized per review with pg_advisory_xact_lock, because the
 * caller derives the next sequence number from a previously loaded log and two
 * concurrent appends could otherwise both believe they are next. The unique
 * constraints remain the backstop.
 */
export function createPostgresAppendOnlyLog<TEvent extends MinimalEvent>(
  sql: SqlExecutor,
  table: "review_event" | "evidence_lifecycle_event",
  digestColumn: "event_id" | "event_digest"
) {
  return {
    async loadLog(reviewId: string): Promise<TEvent[]> {
      const { rows } = await sql.query(
        `SELECT body FROM ${table} WHERE review_id = $1 ORDER BY sequence_number ASC`,
        [reviewId]
      );
      return rows.map((row) => JSON.parse(row.body as string) as TEvent);
    },

    async loadEventsByTimestampRange(startInclusive: string, endExclusive: string): Promise<TEvent[]> {
      const { rows } = await sql.query(
        `SELECT body FROM ${table}
         WHERE (body_query ->> 'event_timestamp')::timestamptz >= $1::timestamptz
           AND (body_query ->> 'event_timestamp')::timestamptz < $2::timestamptz
         ORDER BY (body_query ->> 'event_timestamp')::timestamptz ASC, review_id ASC, sequence_number ASC`,
        [startInclusive, endExclusive]
      );
      return rows.map((row) => JSON.parse(row.body as string) as TEvent);
    },

    async append(reviewId: string, event: TEvent): Promise<AppendOutcome<TEvent>> {
      const row = toCanonicalRow(event);

      await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [reviewId]);

      const existing = await sql.query(
        `SELECT body, ${digestColumn} AS digest FROM ${table} WHERE review_id = $1 AND idempotency_key = $2`,
        [reviewId, event.idempotency_key]
      );
      const priorRow = existing.rows[0];
      if (priorRow !== undefined) {
        // The digest is the identity of the body, so an identical replay is a
        // no-op and a differing body under the same key is the rewrite
        // Architecture Rule 9 forbids.
        return priorRow.digest === row.digest
          ? { outcome: "idempotent_noop", event: JSON.parse(priorRow.body as string) as TEvent }
          : { outcome: "rejected", reason: "idempotency_key_body_conflict" };
      }

      const highest = await sql.query(
        `SELECT max(sequence_number) AS highest FROM ${table} WHERE review_id = $1`,
        [reviewId]
      );
      const currentHighest = highest.rows[0]?.highest;
      if (currentHighest !== null && currentHighest !== undefined && Number(currentHighest) >= event.sequence_number) {
        return { outcome: "rejected", reason: "sequence_number_not_monotonic" };
      }

      await sql.query(
        `INSERT INTO ${table} (review_id, sequence_number, idempotency_key, ${digestColumn}, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [reviewId, event.sequence_number, event.idempotency_key, row.digest, row.body]
      );

      return { outcome: "appended", event: JSON.parse(row.body) as TEvent };
    }
  };
}
