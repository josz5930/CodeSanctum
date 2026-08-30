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

function createMemoryIdentityStore<T extends object>(idOf: (record: T) => string): {
  record(record: T): Promise<IdentityRecordOutcome>;
  find(id: string): Promise<T | undefined>;
} {
  const rows = new Map<string, string>();
  return {
    async record(record: T) {
      const id = idOf(record);
      const body = toCanonicalRow(record).body;
      const existing = rows.get(id);
      if (existing === undefined) {
        rows.set(id, body);
        return { outcome: "recorded" as const };
      }
      return existing === body
        ? { outcome: "already_present" as const }
        : { outcome: "body_conflict" as const };
    },
    async find(id: string) {
      const body = rows.get(id);
      return body === undefined ? undefined : (JSON.parse(body) as T);
    }
  };
}

export function createMemoryReadinessEvidenceStore(): ReadinessEvidenceStore {
  return createMemoryIdentityStore((evidence: EnvironmentReadinessEvidence) => evidence.readiness_evidence_id);
}

export function createMemoryReadinessDecisionStore(): ReadinessDecisionStore {
  return createMemoryIdentityStore((decision: EnvironmentReadinessDecision) => decision.readiness_decision_id);
}
