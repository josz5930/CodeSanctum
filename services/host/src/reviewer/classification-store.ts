import type { SqlExecutor } from "../../../../packages/evidence-store/src/index.js";
import { canonicalizeProtocolJson, type FindingClassificationRecord } from "../../../../packages/protocol-ts/src/index.js";

export type StoredFindingClassification = {
  record: FindingClassificationRecord;
  /** The normalized draft set the record was bound to when it was made. */
  draft_set_digest: string;
};

/**
 * Reviewer classification records (migration 0008). Append-only: recording an
 * id that is already present is a no-op, and nothing is ever rewritten. Which
 * record is current for a draft is decided by the review-event log, not here:
 * a record whose event never landed is never shown.
 */
export interface FindingClassificationRecordStore {
  record(input: StoredFindingClassification): Promise<{ outcome: "recorded" | "already_present" }>;
  listForReview(reviewId: string): Promise<StoredFindingClassification[]>;
}

export function createMemoryFindingClassificationRecordStore(): FindingClassificationRecordStore {
  const records = new Map<string, StoredFindingClassification>();
  return {
    async record(input) {
      if (records.has(input.record.classification_record_id)) {
        return { outcome: "already_present" };
      }
      records.set(input.record.classification_record_id, structuredClone(input));
      return { outcome: "recorded" };
    },
    async listForReview(reviewId) {
      return [...records.values()].filter((stored) => stored.record.review_id === reviewId).map((stored) => structuredClone(stored));
    }
  };
}

export function createPostgresFindingClassificationRecordStore(sql: SqlExecutor): FindingClassificationRecordStore {
  return {
    async record(input) {
      const inserted = await sql.query(
        `INSERT INTO finding_classification_record
           (classification_record_id, review_id, review_finding_draft_ref, draft_set_digest, record_body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (classification_record_id) DO NOTHING
         RETURNING classification_record_id`,
        [
          input.record.classification_record_id,
          input.record.review_id,
          input.record.review_finding_draft_ref,
          input.draft_set_digest,
          canonicalizeProtocolJson(input.record)
        ]
      );
      return inserted.rows.length > 0 ? { outcome: "recorded" } : { outcome: "already_present" };
    },
    async listForReview(reviewId) {
      const { rows } = await sql.query(
        `SELECT draft_set_digest, record_body FROM finding_classification_record
          WHERE review_id = $1 ORDER BY recorded_at ASC, classification_record_id ASC`,
        [reviewId]
      );
      return rows.map((row) => ({
        record: JSON.parse(String(row.record_body)) as FindingClassificationRecord,
        draft_set_digest: String(row.draft_set_digest)
      }));
    }
  };
}
