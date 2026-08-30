import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { runGrantSelfTest } = await importCompiled("src/grant-self-test.js");

function fakePool(updateBehavior) {
  const calls = [];
  const pool = {
    calls,
    async withConnection(fn) {
      const client = {
        async query(text) {
          calls.push(text);
          if (text.startsWith("UPDATE")) {
            return updateBehavior();
          }
          return { rows: [] };
        }
      };
      return fn(client);
    }
  };
  return pool;
}

// Grants correctly deny the UPDATE (it throws): the self-test passes and
// boot continues. BEGIN and ROLLBACK must both have run regardless.
{
  const pool = fakePool(() => {
    const error = new Error("permission denied for table review_event");
    error.code = "42501";
    throw error;
  });
  const result = await runGrantSelfTest(pool);
  assert.deepEqual(result, { ok: true });
  assert.equal(pool.calls[0], "BEGIN");
  assert.equal(pool.calls.at(-1), "ROLLBACK");
  assert.equal(pool.calls.some((c) => c.startsWith("UPDATE")), true);
}

// Grants are wrong: the UPDATE succeeds. This is fatal — the process must
// not boot — and ROLLBACK must still run so no state change survives even
// though the check failed.
{
  const pool = fakePool(() => ({ rows: [] }));
  const result = await runGrantSelfTest(pool);
  assert.equal(result.ok, false);
  assert.equal(pool.calls.at(-1), "ROLLBACK");
}

// An unexpected error shape (not a permission-denied error) also fails
// closed rather than being silently treated as "grants are fine".
{
  const pool = fakePool(() => {
    throw new Error("connection reset by peer");
  });
  const result = await runGrantSelfTest(pool);
  assert.equal(result.ok, false);
}

console.log("grant-self-test test passed.");
