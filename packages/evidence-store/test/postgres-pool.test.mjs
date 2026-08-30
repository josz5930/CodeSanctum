import assert from "node:assert/strict";

import { postgresAvailable, APP_URL } from "./helpers/postgres-harness.mjs";
import { importCompiled } from "./helpers/compile.mjs";

if (!(await postgresAvailable())) {
  console.log("postgres-pool test skipped: no database reachable.");
  process.exit(0);
}

const { createPostgresPool } = await importCompiled("src/postgres/pool.js");

const pool = createPostgresPool(APP_URL);
try {
  // A plain query works through the pool directly.
  const { rows } = await pool.query("SELECT 1 AS one");
  assert.equal(rows[0].one, 1);

  // withConnection keeps BEGIN/ROLLBACK on the same session, and the
  // connection is returned to the pool afterward (not leaked).
  let sawError = false;
  await pool.withConnection(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("UPDATE review_event SET recorded_at = now() WHERE false");
    } catch (error) {
      sawError = /permission denied/i.test(error.message);
    } finally {
      await client.query("ROLLBACK");
    }
  });
  assert.equal(sawError, true, "codeattest_app must not be able to UPDATE review_event, even a no-op WHERE false");

  // Pool must still be usable after withConnection releases its client.
  const after = await pool.query("SELECT 2 AS two");
  assert.equal(after.rows[0].two, 2);

  console.log("postgres-pool test passed.");
} finally {
  await pool.end();
}
