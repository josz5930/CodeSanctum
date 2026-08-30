import type { EvidenceLifecycleEvent } from "../../../protocol-ts/src/index.js";
import type { EvidenceLifecycleLogStore } from "../ports.js";
import { createMemoryAppendOnlyLog } from "./append-only-log.js";

export function createMemoryEvidenceLifecycleLogStore(): EvidenceLifecycleLogStore {
  return createMemoryAppendOnlyLog<EvidenceLifecycleEvent>();
}
