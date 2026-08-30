import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

function recent(entries, now, windowMs) {
  const start = now.getTime() - windowMs;
  return entries.filter((entry) =>
    entry?.event === "metric" &&
    entry.metric_name === "http_request" &&
    typeof entry.time === "number" &&
    entry.time >= start &&
    entry.time <= now.getTime()
  );
}

function ratio(numerator, denominator) {
  return denominator === 0 ? undefined : numerator / denominator;
}

function percentile95(values) {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

export function evaluateSloMetrics(entries, now = new Date()) {
  const readiness = recent(entries, now, 30 * DAY_MS).filter((entry) => entry.route === "/readyz");
  const intakeWeek = recent(entries, now, 7 * DAY_MS).filter((entry) =>
    typeof entry.route === "string" && entry.route.startsWith("/v0/submissions") &&
    typeof entry.status_code === "number" && (entry.status_code < 400 || entry.status_code >= 500)
  );
  const intakeDay = recent(entries, now, DAY_MS).filter((entry) =>
    typeof entry.route === "string" && entry.route.startsWith("/v0/submissions") &&
    typeof entry.latency_ms === "number" && Number.isFinite(entry.latency_ms)
  );

  const readinessValue = ratio(readiness.filter((entry) => entry.status_code === 200).length, readiness.length);
  const successValue = ratio(intakeWeek.filter((entry) => entry.status_code < 500).length, intakeWeek.length);
  const latencyValue = percentile95(intakeDay.map((entry) => entry.latency_ms));
  const breaches = [];

  if (readinessValue !== undefined && readinessValue < 0.995) {
    breaches.push({ slo: "readiness_availability", actual: readinessValue, target: 0.995, samples: readiness.length });
  }
  if (intakeWeek.length >= 20 && successValue !== undefined && successValue < 0.99) {
    breaches.push({ slo: "submission_success_rate", actual: successValue, target: 0.99, samples: intakeWeek.length });
  }
  if (intakeDay.length >= 20 && latencyValue !== undefined && latencyValue > 5000) {
    breaches.push({ slo: "submission_latency_p95", actual: latencyValue, target: 5000, samples: intakeDay.length });
  }

  return {
    ok: breaches.length === 0,
    breaches,
    observations: {
      readiness: { value: readinessValue, samples: readiness.length },
      submission_success: { value: successValue, samples: intakeWeek.length },
      submission_latency_p95_ms: { value: latencyValue, samples: intakeDay.length }
    }
  };
}

export function parseMetricLines(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {
      // journald may contain non-JSON service messages; only metric JSON is relevant.
    }
  }
  return entries;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function readMetrics(args) {
  const metricsFile = option(args, "--metrics-file");
  if (metricsFile !== undefined) {
    return parseMetricLines(await readFile(metricsFile, "utf8"));
  }
  const journalUnit = option(args, "--journal-unit");
  if (journalUnit === undefined) {
    throw new Error("provide --metrics-file or --journal-unit");
  }
  const { stdout } = await execFileAsync("journalctl", [
    "--unit", journalUnit,
    "--since", "30 days ago",
    "--output", "cat",
    "--no-pager"
  ], { maxBuffer: 32 * 1024 * 1024 });
  return parseMetricLines(stdout);
}

async function runNotifyHook(hook, evaluation) {
  if (hook === undefined) {
    return;
  }
  await execFileAsync(hook, [JSON.stringify(evaluation)], { timeout: 30_000 });
}

/**
 * Resolves the configurable alert-sink target (C7) from CLI flags or env, the
 * same precedence the notify hook uses. Credentials and destination are
 * operator-provisioned (Section 2 §7); the checker only consumes them. Returns
 * `undefined` when no sink is configured, in which case a breach still exits
 * non-zero and logs — the sink is an addition to, not a replacement for, the
 * exit-code contract.
 */
export function resolveAlertSink(args, env = process.env) {
  const url = option(args, "--alert-webhook") ?? env.CODEATTEST_ALERT_WEBHOOK_URL;
  if (url === undefined || url.length === 0) {
    return undefined;
  }
  const token = option(args, "--alert-token") ?? env.CODEATTEST_ALERT_WEBHOOK_TOKEN;
  const source = option(args, "--alert-source") ?? env.CODEATTEST_ALERT_SOURCE;
  return {
    url,
    ...(token === undefined || token.length === 0 ? {} : { token }),
    ...(source === undefined || source.length === 0 ? {} : { source })
  };
}

/**
 * Emits one SLO-breach alert to the configured webhook sink and degrades safely
 * if the sink is missing, misconfigured, rejecting, or unreachable: every
 * failure path logs and returns a result object, never throwing, so a down sink
 * cannot crash the checker (its exit code already carries the breach). Returns
 * `{ delivered }` plus a reason so callers and tests can assert the outcome.
 * `deps.fetch`/`deps.log`/`deps.now` are injectable for tests.
 */
export async function deliverSloAlert(evaluation, sink, deps = {}) {
  const log = deps.log ?? ((message) => console.error(message));
  if (sink === undefined) {
    return { delivered: false, reason: "no_sink_configured" };
  }
  if (typeof sink.url !== "string" || !/^https?:\/\//u.test(sink.url)) {
    log(`CodeAttest SLO alert sink misconfigured: url must be http(s)`);
    return { delivered: false, reason: "invalid_sink_url" };
  }
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? new Date();
  const body = JSON.stringify({
    source: sink.source ?? "codeattest-slo-checker",
    detected_at: now.toISOString(),
    breaches: evaluation.breaches,
    observations: evaluation.observations
  });
  try {
    const response = await fetchImpl(sink.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sink.token === undefined ? {} : { authorization: `Bearer ${sink.token}` })
      },
      body,
      signal: AbortSignal.timeout(sink.timeoutMs ?? 5000)
    });
    if (!response.ok) {
      log(`CodeAttest SLO alert sink rejected delivery: HTTP ${response.status}`);
      return { delivered: false, reason: "sink_rejected", status: response.status };
    }
    return { delivered: true, status: response.status };
  } catch (error) {
    log(`CodeAttest SLO alert sink unreachable: ${error instanceof Error ? error.message : String(error)}`);
    return { delivered: false, reason: "sink_unreachable" };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const nowText = option(args, "--now");
  const now = nowText === undefined ? new Date() : new Date(nowText);
  if (Number.isNaN(now.getTime())) {
    throw new Error("--now must be an RFC 3339 timestamp");
  }
  const entries = args.includes("--self-test")
    ? [
        ...Array.from({ length: 200 }, () => ({
          time: now.getTime(), event: "metric", metric_name: "http_request",
          route: "/readyz", method: "GET", status_code: 200, latency_ms: 1
        })),
        ...Array.from({ length: 20 }, () => ({
          time: now.getTime(), event: "metric", metric_name: "http_request",
          route: "/v0/submissions", method: "POST", status_code: 201, latency_ms: 100
        }))
      ]
    : await readMetrics(args);

  if (!args.includes("--skip-probe") && !args.includes("--self-test")) {
    const url = option(args, "--url");
    if (url === undefined || !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/readyz$/u.test(url)) {
      throw new Error("--url must identify a loopback /readyz endpoint");
    }
    let statusCode = 503;
    try {
      statusCode = (await fetch(url, { signal: AbortSignal.timeout(5000) })).status;
    } catch {
      // A failed probe is an unavailable observation, not a checker crash.
    }
    entries.push({
      time: now.getTime(),
      event: "metric",
      metric_name: "http_request",
      route: "/readyz",
      method: "GET",
      status_code: statusCode,
      latency_ms: 0
    });
  }

  const evaluation = evaluateSloMetrics(entries, now);
  if (!evaluation.ok) {
    console.error(`CodeAttest SLO breach: ${JSON.stringify(evaluation)}`);
    await runNotifyHook(option(args, "--notify-hook") ?? process.env.CODEATTEST_NOTIFY_HOOK, evaluation);
    await deliverSloAlert(evaluation, resolveAlertSink(args), { now });
    process.exitCode = 1;
    return;
  }
  console.log(`CodeAttest SLO check passed: ${JSON.stringify(evaluation.observations)}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`CodeAttest observability check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
