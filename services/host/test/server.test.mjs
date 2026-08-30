import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createServer, drain } = await importCompiled("src/server.js");

// /healthz is always 200 once the process is up, regardless of readiness.
{
  const server = createServer({ isReady: () => false });
  const response = await server.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  await server.close();
}

// /readyz reflects the injected readiness function.
{
  let ready = false;
  const server = createServer({ isReady: () => ready });
  const notReady = await server.inject({ method: "GET", url: "/readyz" });
  assert.equal(notReady.statusCode, 503);
  ready = true;
  const isReady = await server.inject({ method: "GET", url: "/readyz" });
  assert.equal(isReady.statusCode, 200);
  await server.close();
}

// A has no business endpoints: anything else 404s.
{
  const server = createServer({ isReady: () => true });
  const response = await server.inject({ method: "GET", url: "/submit" });
  assert.equal(response.statusCode, 404);
  await server.close();
}

// drain() resolves even if it has to hit its deadline rather than hanging
// forever waiting for a request that never completes.
{
  const server = createServer({ isReady: () => true });
  server.get("/slow", async () => new Promise(() => {})); // never resolves
  await server.ready();
  const inflight = server.inject({ method: "GET", url: "/slow" });
  const start = Date.now();
  await drain(server, 200);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 2000, `drain must respect its deadline, took ${elapsed}ms`);
  inflight.catch(() => {});
}

console.log("server test passed.");
