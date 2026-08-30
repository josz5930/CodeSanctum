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

export function createMemoryClassificationStore(): StoredObjectClassificationStore {
  const rows = new Map<string, string>();
  return {
    async record(classification: StoredObjectClassification) {
      if (rows.has(classification.stored_object_ref)) {
        return { outcome: "already_present" as const };
      }
      rows.set(classification.stored_object_ref, toCanonicalRow(classification).body);
      return { outcome: "recorded" as const };
    },
    async find(storedObjectRef: string) {
      const body = rows.get(storedObjectRef);
      return body === undefined ? undefined : (JSON.parse(body) as StoredObjectClassification);
    }
  };
}

export function createMemoryRetentionRecordStore(): RetentionRecordStore {
  const rows = new Map<string, string>();
  return {
    async record(record: RetentionOptInRecord) {
      if (rows.has(record.retention_record_id)) {
        return { outcome: "already_present" as const };
      }
      rows.set(record.retention_record_id, toCanonicalRow(record).body);
      return { outcome: "recorded" as const };
    },
    async find(retentionRecordId: string) {
      const body = rows.get(retentionRecordId);
      return body === undefined ? undefined : (JSON.parse(body) as RetentionOptInRecord);
    },
    async listDue(now: string) {
      const due: RetentionOptInRecord[] = [];
      for (const body of rows.values()) {
        const record = JSON.parse(body) as RetentionOptInRecord;
        if (record.retention_period.end_timestamp <= now) {
          due.push(record);
        }
      }
      return due;
    }
  };
}

/**
 * Gate records are append-only and versioned. Raising the profile toward
 * partner_pilot_real_snippet_ready inserts a new version; it never updates an
 * existing row, so the path to that profile is itself an audit record.
 */
export function createMemoryEnvironmentGateStore(): EnvironmentGateStore {
  const versions = new Map<number, string>();
  return {
    async loadCurrent() {
      let highest: number | undefined;
      for (const version of versions.keys()) {
        if (highest === undefined || version > highest) {
          highest = version;
        }
      }
      if (highest === undefined) {
        return undefined;
      }
      const body = versions.get(highest);
      if (body === undefined) {
        return undefined;
      }
      return { version: highest, gate: JSON.parse(body) as EnvironmentEvidenceGate };
    },
    async recordVersion(input: { version: number; gate: EnvironmentEvidenceGate }) {
      if (versions.has(input.version)) {
        return { outcome: "version_conflict" as const };
      }
      versions.set(input.version, toCanonicalRow(input.gate).body);
      return { outcome: "recorded" as const };
    }
  };
}
