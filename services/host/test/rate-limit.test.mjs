import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createServer } = await importCompiled("src/server.js");
const { registerRateLimit } = await importCompiled("src/rate-limit.js");
const { errorEnvelope } = await importCompiled("src/error-envelope.js");

// A per-IP fixed-window cap: the first `max` requests pass, the next is 429
// with a claim-safe body and a retry-after header. Health/readiness probes are
// exempt so an upstream checker is never throttled into a false "down".
{
  let clock = 0;
  const server = createServer({ isReady: () => true });
  registerRateLimit(server, { max: 3, windowMs: 1000, errorEnvelope, now: () => clock });
  server.get("/web/context", async () => ({ ok: true }));
  await server.ready();

  for (let i = 0; i < 3; i += 1) {
    const res = await server.inject({ method: "GET", url: "/web/context" });
    assert.equal(res.statusCode, 200, `request ${i + 1} within the cap must pass`);
  }
  const limited = await server.inject({ method: "GET", url: "/web/context" });
  assert.equal(limited.statusCode, 429);
  assert.equal(JSON.parse(limited.body).reason_code, "rate_limited");
  assert.ok(limited.headers["retry-after"], "a retry-after header must be set");

  // Probes stay exempt even while the client is over the cap.
  assert.equal((await server.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 200);

  // The window resets once the clock advances past resetAt.
  clock = 1001;
  assert.equal((await server.inject({ method: "GET", url: "/web/context" })).statusCode, 200);
  await server.close();
}

console.log("rate-limit test passed.");
