import type { SqlExecutor, StoredObjectClassificationStore } from "../../../../packages/evidence-store/src/index.js";

export type NormalizationOutcomeRecord =
  | { submission_attempt_id: string; review_id: string; outcome: "normalized"; draft_set_digest: string }
  | { submission_attempt_id: string; review_id: string; outcome: "rejected"; rejection_reason: string };

/**
 * One normalization result per received submission attempt (migration 0007).
 * Recording twice is a no-op, so a re-run job cannot write a second result.
 */
export interface NormalizationOutcomeStore {
  record(record: NormalizationOutcomeRecord): Promise<{ outcome: "recorded" | "already_present" }>;
  find(submissionAttemptId: string): Promise<NormalizationOutcomeRecord | undefined>;
}

export function createMemoryNormalizationOutcomeStore(): NormalizationOutcomeStore {
  const records = new Map<string, NormalizationOutcomeRecord>();
  return {
    async record(record) {
      if (records.has(record.submission_attempt_id)) {
        return { outcome: "already_present" };
      }
      records.set(record.submission_attempt_id, record);
      return { outcome: "recorded" };
    },
    async find(submissionAttemptId) {
      return records.get(submissionAttemptId);
    }
  };
}

export function createPostgresNormalizationOutcomeStore(sql: SqlExecutor): NormalizationOutcomeStore {
  return {
    async record(record) {
      const inserted = await sql.query(
        `INSERT INTO finding_normalization_outcome
           (submission_attempt_id, review_id, outcome, rejection_reason, draft_set_digest)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (submission_attempt_id) DO NOTHING
         RETURNING submission_attempt_id`,
        [
          record.submission_attempt_id,
          record.review_id,
          record.outcome,
          record.outcome === "rejected" ? record.rejection_reason : null,
          record.outcome === "normalized" ? record.draft_set_digest : null
        ]
      );
      return inserted.rows.length > 0 ? { outcome: "recorded" } : { outcome: "already_present" };
    },
    async find(submissionAttemptId) {
      const { rows } = await sql.query(
        `SELECT submission_attempt_id, review_id, outcome, rejection_reason, draft_set_digest
           FROM finding_normalization_outcome WHERE submission_attempt_id = $1`,
        [submissionAttemptId]
      );
      const row = rows[0] as
        | { submission_attempt_id: string; review_id: string; outcome: string; rejection_reason: string | null; draft_set_digest: string | null }
        | undefined;
      if (row === undefined) {
        return undefined;
      }
      return row.outcome === "normalized"
        ? { submission_attempt_id: row.submission_attempt_id, review_id: row.review_id, outcome: "normalized", draft_set_digest: String(row.draft_set_digest) }
        : { submission_attempt_id: row.submission_attempt_id, review_id: row.review_id, outcome: "rejected", rejection_reason: String(row.rejection_reason) };
    }
  };
}

/** What the store knows about one artifact digest, without reading its bytes. */
export type ArtifactPresence =
  | { state: "stored" }
  | { state: "deleted"; deletion_evidence_id: string }
  | { state: "unknown" };

/**
 * Answers, for each digest, whether the store holds it, deleted it under
 * policy, or never received it. Normalization reports evidence availability
 * from this; it must not read every artifact (each read is access-logged).
 */
export type ArtifactPresenceReader = (digests: readonly string[]) => Promise<ReadonlyMap<string, ArtifactPresence>>;

function storedObjectRefFor(digest: string): string {
  return `stored_object:${digest.replace(/^sha256:/, "")}`;
}

/** For tests: a digest is stored when it has a classification; nothing is deleted. */
export function createMemoryArtifactPresenceReader(classifications: StoredObjectClassificationStore): ArtifactPresenceReader {
  return async (digests) => {
    const presence = new Map<string, ArtifactPresence>();
    for (const digest of digests) {
      const classified = await classifications.find(storedObjectRefFor(digest));
      presence.set(digest, classified === undefined ? { state: "unknown" } : { state: "stored" });
    }
    return presence;
  };
}

export function createPostgresArtifactPresenceReader(sql: SqlExecutor): ArtifactPresenceReader {
  return async (digests) => {
    const presence = new Map<string, ArtifactPresence>();
    for (const digest of digests) {
      presence.set(digest, { state: "unknown" });
    }
    if (digests.length === 0) {
      return presence;
    }
    const stored = await sql.query("SELECT digest FROM artifact_reference WHERE digest = ANY($1::text[])", [digests]);
    for (const row of stored.rows) {
      presence.set(String(row.digest), { state: "stored" });
    }
    // Deletion wins over a stored reference: artifact_reference is append-only
    // and keeps its row after the bytes are purged.
    const deleted = await sql.query(
      `SELECT d.deletion_evidence_id, deleted.digest
         FROM deletion_evidence d,
              jsonb_array_elements_text(d.body_query -> 'deleted_artifact_digests') AS deleted(digest)
        WHERE deleted.digest = ANY($1::text[])
        ORDER BY d.recorded_at ASC`,
      [digests]
    );
    for (const row of deleted.rows) {
      presence.set(String(row.digest), { state: "deleted", deletion_evidence_id: String(row.deletion_evidence_id) });
    }
    return presence;
  };
}
