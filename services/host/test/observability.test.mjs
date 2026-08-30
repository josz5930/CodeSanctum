import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createServer } = await importCompiled("src/server.js");

const captured = [];
let ready = false;
const server = createServer({
  isReady: () => ready,
  logger: {
    stream: { write: (line) => captured.push(JSON.parse(line)) },
    level: "info"
  }
});

await server.inject({
  method: "GET",
  url: "/healthz?probe=synthetic",
  headers: {
    authorization: "Bearer must-not-appear",
    cookie: "__Host-codeattest_session=must-not-appear"
  }
});
await server.inject({ method: "GET", url: "/readyz" });
await server.inject({ method: "GET", url: "/readyz" });
ready = true;
await server.inject({ method: "GET", url: "/readyz" });
await server.close();

const requestMetrics = captured.filter((line) => line.event === "metric" && line.metric_name === "http_request");
assert.equal(requestMetrics.length, 4);
assert.deepEqual(
  requestMetrics.map(({ route, status_code }) => ({ route, status_code })),
  [
    { route: "/healthz", status_code: 200 },
    { route: "/readyz", status_code: 503 },
    { route: "/readyz", status_code: 503 },
    { route: "/readyz", status_code: 200 }
  ]
);
for (const metric of requestMetrics) {
  assert.equal(metric.method, "GET");
  assert.equal(Number.isFinite(metric.latency_ms), true);
  assert.ok(metric.latency_ms >= 0);
}

const availabilityMetrics = captured.filter(
  (line) => line.event === "metric" && line.metric_name === "readiness_availability"
);
assert.deepEqual(
  availabilityMetrics.map(({ available, value, status_code }) => ({ available, value, status_code })),
  [
    { available: false, value: 0, status_code: 503 },
    { available: true, value: 1, status_code: 200 }
  ],
  "readiness metrics are emitted on observed state transitions only"
);

const serialized = JSON.stringify(captured);
assert.equal(serialized.includes("must-not-appear"), false);
assert.equal(serialized.includes("authorization"), false);
assert.equal(serialized.includes("cookie"), false);

console.log("Observability metric log test passed.");
