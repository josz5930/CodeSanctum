// This workspace's tsconfig.json overrides skipLibCheck to true (only here,
// not in the shared tsconfig.base.json) because fastify's own types import
// pino, whose pino.d.ts default-imports thread-stream — a CJS `export =`
// module — which TS rejects (TS1259) under this repo's
// allowSyntheticDefaultImports: false. The inconsistency is inside pino's
// declaration file, not in how we use fastify here, so there's no fix on
// our side short of skipping lib checking for this workspace.
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";

import { registerMetricLogging } from "./observability/metrics.js";

export type HostLoggerOption = boolean | {
  stream?: { write: (msg: string) => void };
  level?: string;
};

const REDACTED_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie"]);

function withoutSecretHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (headers === undefined) {
    return result;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (!REDACTED_HEADER_NAMES.has(name.toLowerCase())) {
      result[name] = value;
    }
  }
  return result;
}

function hostLogger(logger: HostLoggerOption): boolean | FastifyLoggerOptions {
  if (logger === false) {
    return false;
  }
  const options: FastifyLoggerOptions = {
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          hostname: request.hostname,
          remoteAddress: request.ip,
          headers: withoutSecretHeaders({ ...request.headers })
        };
      },
      res(reply) {
        const headers =
          "getHeaders" in reply && typeof reply.getHeaders === "function"
            ? { ...reply.getHeaders() }
            : undefined;
        return {
          statusCode: reply.statusCode,
          headers: withoutSecretHeaders(headers)
        };
      }
    }
  };
  if (logger !== true) {
    if (logger.level !== undefined) {
      options.level = logger.level;
    }
    if (logger.stream !== undefined) {
      options.stream = logger.stream;
    }
  }
  return options;
}

/**
 * A ships no business endpoints (design doc section 6): only /healthz for
 * liveness and /readyz for readiness. Everything else legitimately 404s.
 * Logger defaults off; pass a stream to capture request logs. Cookie,
 * authorization, and set-cookie headers are dropped from those logs.
 */
export function createServer(input: { isReady: () => boolean | Promise<boolean>; logger?: HostLoggerOption }): FastifyInstance {
  const server = Fastify({ logger: hostLogger(input.logger ?? false) });

  registerMetricLogging(server);

  server.get("/healthz", async () => ({ status: "ok" }));

  // Readiness is awaited so it can be backed by a cheap, TTL-cached live
  // database probe (C2), not just a boot-time boolean: an upstream must stop
  // routing traffic when Postgres is unreachable after boot, not only on
  // SIGTERM.
  server.get("/readyz", async (_request, reply) => {
    if (!(await input.isReady())) {
      reply.code(503);
      return { status: "not_ready" };
    }
    return { status: "ready" };
  });

  return server;
}

/**
 * Stops accepting new connections and waits for in-flight requests to
 * finish, but never waits past `timeoutMs` — a SIGTERM drain must complete
 * within a deadline, not hang on a slow or stuck handler (design doc
 * section 5.6, step 6).
 */
export async function drain(server: FastifyInstance, timeoutMs = 10000): Promise<void> {
  await Promise.race([
    server.close(),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref();
    })
  ]);
}
