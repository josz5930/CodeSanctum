import type { ReviewEvent } from "../../../protocol-ts/src/index.js";
import type { TimestampedReviewEventLogStore } from "../ports.js";
import { createPostgresAppendOnlyLog } from "./append-only-log.js";
import type { SqlExecutor } from "./pool.js";

export function createPostgresReviewEventLogStore(sql: SqlExecutor): TimestampedReviewEventLogStore {
  return createPostgresAppendOnlyLog<ReviewEvent>(sql, "review_event", "event_id");
}
