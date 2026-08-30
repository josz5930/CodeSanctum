import type { EvidenceLifecycleEvent } from "../../../protocol-ts/src/index.js";
import type { EvidenceLifecycleLogStore } from "../ports.js";
import { createPostgresAppendOnlyLog } from "./append-only-log.js";
import type { SqlExecutor } from "./pool.js";

export function createPostgresEvidenceLifecycleLogStore(sql: SqlExecutor): EvidenceLifecycleLogStore {
  return createPostgresAppendOnlyLog<EvidenceLifecycleEvent>(sql, "evidence_lifecycle_event", "event_digest");
}
