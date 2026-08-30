import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

function routeFor(request: FastifyRequest): string {
  const configuredRoute = request.routeOptions.url;
  if (configuredRoute !== undefined && configuredRoute.length > 0) {
    return configuredRoute;
  }
  return request.url.split("?", 1)[0] ?? request.url;
}

function roundedLatency(reply: FastifyReply): number {
  return Math.max(0, Math.round(reply.elapsedTime * 1000) / 1000);
}

/**
 * Emits one low-cardinality request metric for every response. Readiness also
 * emits a second metric only when its observed state changes, which makes
 * availability transitions visible without flooding journald on every probe.
 */
export function registerMetricLogging(server: FastifyInstance): void {
  let lastReadiness: boolean | undefined;

  server.addHook("onResponse", async (request, reply) => {
    const route = routeFor(request);
    const statusCode = reply.statusCode;
    request.log.info({
      event: "metric",
      metric_name: "http_request",
      route,
      method: request.method,
      status_code: statusCode,
      latency_ms: roundedLatency(reply)
    }, "http request metric");

    if (route !== "/readyz") {
      return;
    }
    const available = statusCode >= 200 && statusCode < 500;
    if (available === lastReadiness) {
      return;
    }
    lastReadiness = available;
    request.log.info({
      event: "metric",
      metric_name: "readiness_availability",
      route,
      status_code: statusCode,
      available,
      value: available ? 1 : 0
    }, "readiness availability transition");
  });
}
