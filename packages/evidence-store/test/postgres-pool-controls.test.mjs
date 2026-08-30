import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

// C1: connection controls + idle-client error listener. This test needs no
// live database: it drives the failure path (an unreachable backend) and
// confirms the pool surfaces errors as rejections and never crashes the
// process, and that our own error sink is invoked rather than a bare
// unhandled 'error' event.
const { createPostgresPool } = await importCompiled("src/postgres/pool.js");

// An unreachable backend with a tiny connection timeout must reject the query
// (honoring connectionTimeoutMillis) rather than hang or terminate the process.
{
  const errors = [];
  const pool = createPostgresPool(
    "postgres://codeattest_app:x@127.0.0.1:1/codeattest_does_not_exist",
    {
      connectionTimeoutMillis: 250,
      max: 3,
      idleTimeoutMillis: 1000,
      logError: (message, error) => errors.push({ message, error })
    }
  );
  await assert.rejects(
    () => pool.query("SELECT 1"),
    "an unreachable backend must reject, not crash the process"
  );
  await pool.end();
}

// The idle-client error listener must be attached and must not rethrow. We
// spy on pg.Pool.prototype.on to confirm createPostgresPool registers exactly
// one 'error' handler, then invoke that captured handler to confirm it logs
// via our sink and swallows the error a dropped backend connection raises.
{
  const pgModule = (await import("pg")).default;
  const originalOn = pgModule.Pool.prototype.on;
  const registered = [];
  pgModule.Pool.prototype.on = function patchedOn(event, handler) {
    if (event === "error") {
      registered.push(handler);
    }
    return originalOn.call(this, event, handler);
  };
  const errors = [];
  let pool;
  try {
    pool = createPostgresPool(
      "postgres://codeattest_app:x@127.0.0.1:1/codeattest_does_not_exist",
      { logError: (message, error) => errors.push({ message, error }) }
    );
  } finally {
    pgModule.Pool.prototype.on = originalOn;
  }
  assert.equal(registered.length, 1, "exactly one 'error' listener must be attached");
  const handler = registered[0];
  const simulated = new Error("simulated backend drop");
  assert.doesNotThrow(() => handler(simulated), "the idle-client error handler must not rethrow");
  assert.equal(errors.length, 1, "the idle-client error must be reported to our sink");
  assert.equal(errors[0].error, simulated);
  await pool.end();
}

console.log("postgres-pool-controls test passed.");
