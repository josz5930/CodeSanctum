import type { ReviewEvent } from "../../../protocol-ts/src/index.js";
import type { TimestampedReviewEventLogStore } from "../ports.js";
import { createMemoryAppendOnlyLog } from "./append-only-log.js";

export function createMemoryReviewEventLogStore(): TimestampedReviewEventLogStore {
  return createMemoryAppendOnlyLog<ReviewEvent>();
}
