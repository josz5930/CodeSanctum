import assert from "node:assert/strict";

import { postgresAvailable, withPostgres } from "./helpers/postgres-harness.mjs";
import { makeReviewEvent, REVIEW_ID } from "./helpers/fixtures.mjs";

if (!(await postgresAvailable())) {
  console.log("postgres-grants test skipped: no database reachable.");
  process.exit(0);
}

await withPostgres(async ({ appPool }) => {
  const event = makeReviewEvent();
  await appPool.query(
    "INSERT INTO review_event (review_id, sequence_number, idempotency_key, event_id, body) VALUES ($1, $2, $3, $4, $5)",
    [REVIEW_ID, event.sequence_number, event.idempotency_key, event.event_id, JSON.stringify(event)]
  );

  // The application role may insert and read history but may never rewrite it.
  await assert.rejects(
    () => appPool.query("UPDATE review_event SET body = '{}' WHERE review_id = $1", [REVIEW_ID]),
    /permission denied/i,
    "codeattest_app must not be able to UPDATE review_event"
  );

  await assert.rejects(
    () => appPool.query("DELETE FROM review_event WHERE review_id = $1", [REVIEW_ID]),
    /permission denied/i,
    "codeattest_app must not be able to DELETE review_event"
  );

  // It also must not own the tables, or it could ALTER away its own limits.
  await assert.rejects(
    () => appPool.query("ALTER TABLE review_event DROP CONSTRAINT review_event_pkey"),
    /must be owner|permission denied/i,
    "codeattest_app must not own review_event"
  );

  // The same restriction covers every append-only table.
  for (const table of [
    "evidence_lifecycle_event",
    "stored_object_classification",
    "retention_opt_in_record",
    "deletion_evidence",
    "artifact_reference",
    "environment_evidence_gate",
    "environment_readiness_evidence",
    "environment_readiness_decision",
    "chain_head_anchor"
  ]) {
    await assert.rejects(
      () => appPool.query(`DELETE FROM ${table}`),
      /permission denied/i,
      `codeattest_app must not be able to DELETE ${table}`
    );
  }

  // The job table is deliberately mutable: queue state legitimately changes.
  await appPool.query("INSERT INTO job (job_id, job_type, payload) VALUES ('job:grant', 'normalize', '{}')");
  await appPool.query("UPDATE job SET attempts = 1 WHERE job_id = 'job:grant'");

  console.log("postgres-grants test passed.");
});
