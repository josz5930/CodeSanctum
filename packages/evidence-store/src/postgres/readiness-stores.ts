import type {
  EnvironmentReadinessDecision,
  EnvironmentReadinessEvidence
} from "../../../protocol-ts/src/index.js";
import { toCanonicalRow } from "../canonical-row.js";
import type {
  IdentityRecordOutcome,
  ReadinessDecisionStore,
  ReadinessEvidenceStore
} from "../ports.js";
import type { SqlExecutor } from "./pool.js";

async function recordCanonical(
  sql: SqlExecutor,
  table: "environment_readiness_evidence" | "environment_readiness_decision",
  idColumn: "readiness_evidence_id" | "readiness_decision_id",
  id: string,
  body: string
): Promise<IdentityRecordOutcome> {
  const inserted = await sql.query(
    `INSERT INTO ${table} (${idColumn}, body) VALUES ($1, $2)
     ON CONFLICT (${idColumn}) DO NOTHING
     RETURNING ${idColumn}`,
    [id, body]
  );
  if (inserted.rows.length > 0) {
    return { outcome: "recorded" };
  }
  const existing = await sql.query(`SELECT body FROM ${table} WHERE ${idColumn} = $1`, [id]);
  const existingBody = existing.rows[0]?.body;
  return existingBody === body
    ? { outcome: "already_present" }
    : { outcome: "body_conflict" };
}

export function createPostgresReadinessEvidenceStore(sql: SqlExecutor): ReadinessEvidenceStore {
  return {
    async record(evidence: EnvironmentReadinessEvidence) {
      return recordCanonical(
        sql,
        "environment_readiness_evidence",
        "readiness_evidence_id",
        evidence.readiness_evidence_id,
        toCanonicalRow(evidence).body
      );
    },
    async find(readinessEvidenceId: string) {
      const { rows } = await sql.query(
        "SELECT body FROM environment_readiness_evidence WHERE readiness_evidence_id = $1",
        [readinessEvidenceId]
      );
      const row = rows[0];
      return row === undefined ? undefined : (JSON.parse(row.body as string) as EnvironmentReadinessEvidence);
    }
  };
}

export function createPostgresReadinessDecisionStore(sql: SqlExecutor): ReadinessDecisionStore {
  return {
    async record(decision: EnvironmentReadinessDecision) {
      return recordCanonical(
        sql,
        "environment_readiness_decision",
        "readiness_decision_id",
        decision.readiness_decision_id,
        toCanonicalRow(decision).body
      );
    },
    async find(readinessDecisionId: string) {
      const { rows } = await sql.query(
        "SELECT body FROM environment_readiness_decision WHERE readiness_decision_id = $1",
        [readinessDecisionId]
      );
      const row = rows[0];
      return row === undefined ? undefined : (JSON.parse(row.body as string) as EnvironmentReadinessDecision);
    }
  };
}
