import type {
  EnvironmentEvidenceGate,
  RetentionOptInRecord,
  StoredObjectClassification
} from "../../../protocol-ts/src/index.js";
import { toCanonicalRow } from "../canonical-row.js";
import type {
  EnvironmentGateStore,
  RetentionRecordStore,
  StoredObjectClassificationStore
} from "../ports.js";
import type { SqlExecutor } from "./pool.js";

export function createPostgresClassificationStore(sql: SqlExecutor): StoredObjectClassificationStore {
  return {
    async record(classification: StoredObjectClassification) {
      const row = toCanonicalRow(classification);
      const result = await sql.query(
        `INSERT INTO stored_object_classification (stored_object_ref, body) VALUES ($1, $2)
         ON CONFLICT (stored_object_ref) DO NOTHING
         RETURNING stored_object_ref`,
        [classification.stored_object_ref, row.body]
      );
      return { outcome: result.rows.length > 0 ? ("recorded" as const) : ("already_present" as const) };
    },
    async find(storedObjectRef: string) {
      const { rows } = await sql.query(
        "SELECT body FROM stored_object_classification WHERE stored_object_ref = $1",
        [storedObjectRef]
      );
      const row = rows[0];
      return row === undefined ? undefined : (JSON.parse(row.body as string) as StoredObjectClassification);
    }
  };
}

export function createPostgresRetentionRecordStore(sql: SqlExecutor): RetentionRecordStore {
  return {
    async record(record: RetentionOptInRecord) {
      const row = toCanonicalRow(record);
      const result = await sql.query(
        `INSERT INTO retention_opt_in_record (retention_record_id, body) VALUES ($1, $2)
         ON CONFLICT (retention_record_id) DO NOTHING
         RETURNING retention_record_id`,
        [record.retention_record_id, row.body]
      );
      return { outcome: result.rows.length > 0 ? ("recorded" as const) : ("already_present" as const) };
    },
    async find(retentionRecordId: string) {
      const { rows } = await sql.query(
        "SELECT body FROM retention_opt_in_record WHERE retention_record_id = $1",
        [retentionRecordId]
      );
      const row = rows[0];
      return row === undefined ? undefined : (JSON.parse(row.body as string) as RetentionOptInRecord);
    },
    async listDue(now: string) {
      const { rows } = await sql.query(
        `SELECT body FROM retention_opt_in_record
         WHERE (body_query #>> '{retention_period,end_timestamp}') <= $1
         ORDER BY retention_record_id`,
        [now]
      );
      return rows.map((row) => JSON.parse(row.body as string) as RetentionOptInRecord);
    }
  };
}

/**
 * Versioned and append-only: a version is never rewritten, and loadCurrent
 * reads the highest one. Raising the profile toward
 * partner_pilot_real_snippet_ready therefore leaves an audit trail of every
 * intermediate state.
 */
export function createPostgresEnvironmentGateStore(sql: SqlExecutor): EnvironmentGateStore {
  return {
    async loadCurrent() {
      const { rows } = await sql.query(
        "SELECT version, body FROM environment_evidence_gate ORDER BY version DESC LIMIT 1"
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      return { version: Number(row.version), gate: JSON.parse(row.body as string) as EnvironmentEvidenceGate };
    },
    async recordVersion(input: { version: number; gate: EnvironmentEvidenceGate }) {
      const row = toCanonicalRow(input.gate);
      const result = await sql.query(
        `INSERT INTO environment_evidence_gate (version, body) VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING
         RETURNING version`,
        [input.version, row.body]
      );
      return { outcome: result.rows.length > 0 ? ("recorded" as const) : ("version_conflict" as const) };
    }
  };
}
