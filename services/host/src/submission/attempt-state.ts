import type { SqlExecutor } from "../../../../packages/evidence-store/src/index.js";

export type SubmissionAttemptRecord = {
  submission_attempt_id: string;
  review_id: string;
  tenant_id: string;
  token_key_id: string;
  manifest_id: string;
  evidence_bundle_id: string;
  bundle_manifest_body: string;
  signature_envelope_body: string;
  customer_approval_body: string;
  approved_outbound_manifest_body: string;
};

export type OpenAttemptResult =
  | { outcome: "opened"; record: SubmissionAttemptRecord }
  | { outcome: "already_open"; record: SubmissionAttemptRecord }
  | { outcome: "conflict" };

export interface SubmissionAttemptStore {
  open(record: SubmissionAttemptRecord): Promise<OpenAttemptResult>;
  find(attemptId: string): Promise<SubmissionAttemptRecord | undefined>;
  findOutcome(attemptId: string): Promise<string | undefined>;
  recordOutcome(attemptId: string, outcomeBody: string): Promise<{ outcome: "recorded" | "already_present" }>;
}

function sameAttemptBody(existing: SubmissionAttemptRecord, record: SubmissionAttemptRecord): boolean {
  return (
    existing.manifest_id === record.manifest_id &&
    existing.evidence_bundle_id === record.evidence_bundle_id &&
    existing.bundle_manifest_body === record.bundle_manifest_body &&
    existing.signature_envelope_body === record.signature_envelope_body &&
    existing.customer_approval_body === record.customer_approval_body &&
    existing.approved_outbound_manifest_body === record.approved_outbound_manifest_body
  );
}

export function createMemorySubmissionAttemptStore(): SubmissionAttemptStore {
  const attempts = new Map<string, SubmissionAttemptRecord>();
  const outcomes = new Map<string, string>();
  return {
    async open(record) {
      const existing = attempts.get(record.submission_attempt_id);
      if (existing === undefined) {
        attempts.set(record.submission_attempt_id, record);
        return { outcome: "opened", record };
      }
      // Reopening is a no-op only when every declared identity is identical.
      // A different body under the same attempt id is a rewrite attempt.
      return sameAttemptBody(existing, record) ? { outcome: "already_open", record: existing } : { outcome: "conflict" };
    },
    async find(attemptId) {
      return attempts.get(attemptId);
    },
    async findOutcome(attemptId) {
      return outcomes.get(attemptId);
    },
    async recordOutcome(attemptId, outcomeBody) {
      if (outcomes.has(attemptId)) {
        return { outcome: "already_present" };
      }
      outcomes.set(attemptId, outcomeBody);
      return { outcome: "recorded" };
    }
  };
}

type SubmissionAttemptRow = {
  submission_attempt_id: string;
  review_id: string;
  tenant_id: string;
  token_key_id: string;
  manifest_id: string;
  evidence_bundle_id: string;
  bundle_manifest_body: string;
  signature_envelope_body: string;
  customer_approval_body: string;
  approved_outbound_manifest_body: string;
};

export function createPostgresSubmissionAttemptStore(sql: SqlExecutor): SubmissionAttemptStore {
  const store: SubmissionAttemptStore = {
    async open(record) {
      const inserted = await sql.query(
        `INSERT INTO submission_attempt (submission_attempt_id, review_id, tenant_id, token_key_id,
           manifest_id, evidence_bundle_id, bundle_manifest_body, signature_envelope_body,
           customer_approval_body, approved_outbound_manifest_body)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (submission_attempt_id) DO NOTHING
         RETURNING submission_attempt_id`,
        [
          record.submission_attempt_id, record.review_id, record.tenant_id, record.token_key_id,
          record.manifest_id, record.evidence_bundle_id, record.bundle_manifest_body,
          record.signature_envelope_body, record.customer_approval_body,
          record.approved_outbound_manifest_body
        ]
      );
      if (inserted.rows.length > 0) {
        return { outcome: "opened", record };
      }
      const existing = await store.find(record.submission_attempt_id);
      if (existing === undefined) {
        return { outcome: "conflict" };
      }
      return sameAttemptBody(existing, record) ? { outcome: "already_open", record: existing } : { outcome: "conflict" };
    },
    async find(attemptId) {
      const { rows } = await sql.query(
        `SELECT submission_attempt_id, review_id, tenant_id, token_key_id, manifest_id,
                evidence_bundle_id, bundle_manifest_body, signature_envelope_body,
                customer_approval_body, approved_outbound_manifest_body
           FROM submission_attempt WHERE submission_attempt_id = $1`,
        [attemptId]
      );
      const row = rows[0] as SubmissionAttemptRow | undefined;
      return row === undefined ? undefined : { ...row };
    },
    async findOutcome(attemptId) {
      const { rows } = await sql.query(
        `SELECT outcome_body FROM submission_attempt_outcome WHERE submission_attempt_id = $1`,
        [attemptId]
      );
      return (rows[0] as { outcome_body: string } | undefined)?.outcome_body;
    },
    async recordOutcome(attemptId, outcomeBody) {
      const inserted = await sql.query(
        `INSERT INTO submission_attempt_outcome (submission_attempt_id, outcome_body)
         VALUES ($1,$2) ON CONFLICT (submission_attempt_id) DO NOTHING
         RETURNING submission_attempt_id`,
        [attemptId, outcomeBody]
      );
      return inserted.rows.length > 0 ? { outcome: "recorded" } : { outcome: "already_present" };
    }
  };
  return store;
}
