import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createServer } = await importCompiled("src/server.js");
const { registerRateLimit } = await importCompiled("src/rate-limit.js");
const { errorEnvelope } = await importCompiled("src/error-envelope.js");
const { clientNetworkKey } = await importCompiled("src/client-network.js");

// IPv4 is its own key; IPv6 counts per /64; IPv4-mapped IPv6 counts as IPv4.
assert.equal(clientNetworkKey("203.0.113.7"), "203.0.113.7");
assert.equal(clientNetworkKey("::ffff:203.0.113.7"), "203.0.113.7");
assert.equal(clientNetworkKey("2001:db8:a:b:1:2:3:4"), "2001:db8:a:b::/64");
assert.equal(clientNetworkKey("2001:db8:a:b::9"), "2001:db8:a:b::/64");
assert.equal(clientNetworkKey("2001:0db8:000a:000b:ffff::1"), "2001:db8:a:b::/64");
assert.equal(clientNetworkKey("2001:db8::1"), "2001:db8:0:0::/64");
assert.equal(clientNetworkKey("::1"), "0:0:0:0::/64");
assert.equal(clientNetworkKey("fe80::1%eth0"), "fe80:0:0:0::/64");
assert.equal(clientNetworkKey("64:ff9b::192.0.2.1"), "64:ff9b:0:0::/64");

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

// Behind Caddy (or the web app) every connection comes from loopback. Each
// client must get its own window, keyed by the X-Forwarded-For address that the
// loopback proxy sets, not one shared window for 127.0.0.1.
{
  const server = createServer({ isReady: () => true });
  registerRateLimit(server, { max: 2, windowMs: 60_000, errorEnvelope, now: () => 0 });
  server.get("/web/context", async () => ({ ok: true }));
  await server.ready();

  const viaProxy = (client) =>
    server.inject({ method: "GET", url: "/web/context", headers: { "x-forwarded-for": client } });

  assert.equal((await viaProxy("198.51.100.1")).statusCode, 200);
  assert.equal((await viaProxy("198.51.100.1")).statusCode, 200);
  assert.equal((await viaProxy("198.51.100.1")).statusCode, 429, "the client over its cap is limited");
  assert.equal((await viaProxy("198.51.100.2")).statusCode, 200, "another client behind the same proxy is not limited");

  // A client cannot escape its window by adding its own X-Forwarded-For entry:
  // the proxy appends the real address and only loopback hops are trusted.
  assert.equal((await viaProxy("192.0.2.99, 198.51.100.1")).statusCode, 429);

  // One IPv6 host owns a /64, so new addresses in it share one window.
  assert.equal((await viaProxy("2001:db8:1:2::1")).statusCode, 200);
  assert.equal((await viaProxy("2001:db8:1:2::2")).statusCode, 200);
  assert.equal((await viaProxy("2001:db8:1:2::3")).statusCode, 429);
  assert.equal((await viaProxy("2001:db8:1:3::1")).statusCode, 200);

  // A peer that is not on loopback is not a trusted proxy: its X-Forwarded-For
  // is ignored and it is counted by its own address.
  const direct = (forwardedFor) =>
    server.inject({
      method: "GET",
      url: "/web/context",
      remoteAddress: "203.0.113.50",
      headers: { "x-forwarded-for": forwardedFor }
    });
  assert.equal((await direct("192.0.2.1")).statusCode, 200);
  assert.equal((await direct("192.0.2.2")).statusCode, 200);
  assert.equal((await direct("192.0.2.3")).statusCode, 429, "spoofed X-Forwarded-For from a non-loopback peer must not reset the window");
  await server.close();
}

console.log("rate-limit test passed.");
