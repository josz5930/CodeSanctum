import type { FastifyInstance } from "fastify";

import { clientNetworkKey } from "./client-network.js";
import type { ErrorEnvelopeBody } from "./error-envelope.js";

/**
 * A dependency-free per-client global request cap (C6). The client is
 * `request.ip`, which `createServer` resolves through the loopback proxies
 * (Caddy and the Next.js web app) to the real client address; an IPv6 client
 * counts as its /64 (see `clientNetworkKey`). It is a fixed-window counter —
 * deliberately small and in-process — meant to be swapped for
 * `@fastify/rate-limit` (with a shared store) once the host runs as multiple
 * replicas.
 *
 * Liveness/readiness probes are exempt: an upstream health checker polling
 * `/healthz` / `/readyz` must never be throttled into reporting the host down.
 */
export type RateLimitOptions = {
  /** Max requests per window per client network. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  errorEnvelope: (reasonCode: string) => ErrorEnvelopeBody;
  /** Injectable clock for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Routes exempt from the limit. Defaults to the health/readiness probes. */
  exemptRoutes?: readonly string[];
};

type Window = { count: number; resetAt: number };

export function registerRateLimit(server: FastifyInstance, options: RateLimitOptions): void {
  const now = options.now ?? (() => Date.now());
  const exempt = new Set(options.exemptRoutes ?? ["/healthz", "/readyz"]);
  const windows = new Map<string, Window>();

  server.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url ?? request.url.split("?", 1)[0] ?? request.url;
    if (exempt.has(route)) {
      return;
    }
    const key = clientNetworkKey(request.ip);
    const current = now();
    let window = windows.get(key);
    if (window === undefined || current >= window.resetAt) {
      window = { count: 0, resetAt: current + options.windowMs };
      windows.set(key, window);
    }
    window.count += 1;

    // Opportunistically evict windows that have fully expired so the map does
    // not grow without bound under a churn of distinct client IPs.
    if (windows.size > 1024) {
      for (const [otherKey, otherWindow] of windows) {
        if (current >= otherWindow.resetAt) {
          windows.delete(otherKey);
        }
      }
    }

    if (window.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - current) / 1000));
      reply.header("retry-after", String(retryAfterSeconds));
      reply.code(429).send(options.errorEnvelope("rate_limited"));
      return reply;
    }
    return undefined;
  });
}
