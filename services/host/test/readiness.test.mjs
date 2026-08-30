import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createDatabaseReadiness } = await importCompiled("src/readiness.js");
const { createServer } = await importCompiled("src/server.js");

// A reachable DB reports live; an unreachable one (query rejects) reports
// not-live rather than throwing.
{
  let clock = 0;
  const readiness = createDatabaseReadiness({ sql: { query: async () => ({ rows: [{ "?column?": 1 }] }) }, now: () => clock });
  assert.equal(await readiness.isLive(), true);

  const down = createDatabaseReadiness({ sql: { query: async () => { throw new Error("ECONNREFUSED"); } }, now: () => clock });
  assert.equal(await down.isLive(), false);
}

// The result is cached for the TTL: within the window the DB is not re-queried;
// after it, a fresh probe runs and picks up recovery.
{
  let clock = 0;
  let live = false;
  let queries = 0;
  const readiness = createDatabaseReadiness({
    sql: { query: async () => { queries += 1; if (!live) { throw new Error("down"); } return { rows: [{ one: 1 }] }; } },
    ttlMs: 1000,
    now: () => clock
  });

  assert.equal(await readiness.isLive(), false);
  assert.equal(queries, 1);
  // Within the TTL: cached, no new query even though the DB "recovered".
  live = true;
  clock = 999;
  assert.equal(await readiness.isLive(), false, "within TTL the cached result is served");
  assert.equal(queries, 1, "no extra query within the TTL");
  // Past the TTL: re-probe picks up recovery.
  clock = 1000;
  assert.equal(await readiness.isLive(), true);
  assert.equal(queries, 2);
}

// A hung query is bounded by the timeout and reports not-ready.
{
  let clock = 0;
  const readiness = createDatabaseReadiness({
    sql: { query: () => new Promise(() => {}) }, // never resolves
    timeoutMs: 50,
    now: () => clock
  });
  assert.equal(await readiness.isLive(), false, "a hung query must time out as not-ready");
}

// End to end through /readyz: 200 when live, 503 when the DB is down.
{
  let live = true;
  let clock = 0;
  const readiness = createDatabaseReadiness({
    sql: { query: async () => { if (!live) { throw new Error("down"); } return { rows: [{ one: 1 }] }; } },
    ttlMs: 0,
    now: () => { clock += 1; return clock; }
  });
  const server = createServer({ isReady: async () => readiness.isLive() });
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 200);
  live = false;
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 503, "DB down → 503");
  live = true;
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 200, "recovery → 200");
  await server.close();
}

console.log("readiness test passed.");
