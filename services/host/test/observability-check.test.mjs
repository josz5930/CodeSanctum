import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deliverSloAlert, evaluateSloMetrics, resolveAlertSink } from "../../../scripts/check-observability.mjs";

const now = new Date("2026-08-21T12:00:00Z");

function metric(overrides = {}) {
  return {
    time: now.getTime() - 60_000,
    event: "metric",
    metric_name: "http_request",
    route: "/v0/submissions",
    method: "POST",
    status_code: 201,
    latency_ms: 100,
    ...overrides
  };
}

const healthy = [
  ...Array.from({ length: 200 }, () => metric({ route: "/readyz", method: "GET", status_code: 200 })),
  ...Array.from({ length: 20 }, () => metric())
];
assert.deepEqual(evaluateSloMetrics(healthy, now).breaches, []);

const breached = [
  ...Array.from({ length: 198 }, () => metric({ route: "/readyz", method: "GET", status_code: 200 })),
  ...Array.from({ length: 2 }, () => metric({ route: "/readyz", method: "GET", status_code: 503 })),
  ...Array.from({ length: 18 }, () => metric()),
  ...Array.from({ length: 2 }, () => metric({ status_code: 500, latency_ms: 6000 }))
];
const evaluation = evaluateSloMetrics(breached, now);
assert.deepEqual(
  evaluation.breaches.map((breach) => breach.slo),
  ["readiness_availability", "submission_success_rate", "submission_latency_p95"]
);

// The executable contract matters to the systemd timer: healthy data exits
// zero and breached data exits non-zero without requiring a live host in CI.
const temp = await mkdtemp(path.join(tmpdir(), "onevps-observability-"));
const metricsPath = path.join(temp, "metrics.jsonl");
const script = fileURLToPath(new URL("../../../scripts/check-observability.mjs", import.meta.url));
await writeFile(metricsPath, `${healthy.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
const healthyRun = spawnSync(process.execPath, [script, "--metrics-file", metricsPath, "--skip-probe", "--now", now.toISOString()], {
  encoding: "utf8"
});
assert.equal(healthyRun.status, 0, healthyRun.stderr);

await writeFile(metricsPath, `${breached.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
const breachedRun = spawnSync(process.execPath, [script, "--metrics-file", metricsPath, "--skip-probe", "--now", now.toISOString()], {
  encoding: "utf8"
});
assert.equal(breachedRun.status, 1);
assert.match(breachedRun.stderr, /readiness_availability/);
assert.match(breachedRun.stderr, /submission_success_rate/);
assert.match(breachedRun.stderr, /submission_latency_p95/);

// --- C7: configurable alert sink ---

// Sink config comes from CLI flags or env, with CLI taking precedence, and is
// absent when nothing is configured.
assert.equal(resolveAlertSink([], {}), undefined);
assert.deepEqual(
  resolveAlertSink(["--alert-webhook", "https://sink.invalid/hook", "--alert-token", "t0ken"], {}),
  { url: "https://sink.invalid/hook", token: "t0ken" }
);
assert.deepEqual(
  resolveAlertSink([], { CODEATTEST_ALERT_WEBHOOK_URL: "https://env.invalid/hook", CODEATTEST_ALERT_SOURCE: "onevps-demo" }),
  { url: "https://env.invalid/hook", source: "onevps-demo" }
);
assert.equal(
  resolveAlertSink(["--alert-webhook", "https://cli.invalid/hook"], { CODEATTEST_ALERT_WEBHOOK_URL: "https://env.invalid/hook" }).url,
  "https://cli.invalid/hook",
  "CLI flag overrides env"
);

// With a stub sink configured, a breach delivers exactly one alert carrying the
// breach payload and the bearer credential.
{
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 202 };
  };
  const result = await deliverSloAlert(
    evaluation,
    { url: "https://sink.invalid/hook", token: "t0ken", source: "onevps-demo" },
    { fetch: stubFetch, now, log: () => {} }
  );
  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1, "exactly one alert is delivered");
  assert.equal(calls[0].url, "https://sink.invalid/hook");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer t0ken");
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.source, "onevps-demo");
  assert.deepEqual(payload.breaches.map((breach) => breach.slo), evaluation.breaches.map((breach) => breach.slo));
}

// With the sink unreachable, the checker logs and does not crash: no throw, a
// structured not-delivered result, and a logged reason.
{
  const logged = [];
  const throwingFetch = async () => { throw new Error("ECONNREFUSED"); };
  const result = await deliverSloAlert(
    evaluation,
    { url: "https://sink.invalid/hook" },
    { fetch: throwingFetch, now, log: (message) => logged.push(message) }
  );
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "sink_unreachable");
  assert.ok(logged.some((message) => /unreachable/i.test(message)), "an unreachable sink is logged");
}

// A sink that rejects the delivery (non-2xx) is a logged non-delivery, not a crash.
{
  const logged = [];
  const rejectingFetch = async () => ({ ok: false, status: 500 });
  const result = await deliverSloAlert(
    evaluation,
    { url: "https://sink.invalid/hook" },
    { fetch: rejectingFetch, now, log: (message) => logged.push(message) }
  );
  assert.equal(result.delivered, false);
  assert.equal(result.reason, "sink_rejected");
  assert.equal(result.status, 500);
}

// A missing or malformed sink is a no-op, never a throw.
assert.equal((await deliverSloAlert(evaluation, undefined, { log: () => {} })).reason, "no_sink_configured");
assert.equal((await deliverSloAlert(evaluation, { url: "ftp://bad" }, { log: () => {} })).reason, "invalid_sink_url");

console.log("Observability SLO check test passed.");
