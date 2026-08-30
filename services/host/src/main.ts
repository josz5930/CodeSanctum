import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createFilesystemObjectStore,
  createPostgresArtifactStore,
  createPostgresClassificationStore,
  createPostgresEnvironmentGateStore,
  createPostgresEvidenceLifecycleLogStore,
  createPostgresJobQueue,
  createPostgresPool,
  createPostgresReviewEventLogStore
} from "../../../packages/evidence-store/src/index.js";
import {
  createPostgresAccountStore,
  createPostgresLoginThrottle,
  createPostgresSessionStore,
  createPostgresSubmissionCredentialStore
} from "../../../packages/identity-store/src/index.js";
import { decodeBase64Url } from "../../../packages/signing/src/index.js";

import { registerActorResolution } from "./auth/resolve-actor.js";
import { runBootSequence } from "./boot.js";
import { loadConfig, ConfigError } from "./config.js";
import { errorEnvelope } from "./error-envelope.js";
import { createServer, drain } from "./server.js";
import { createDatabaseReadiness } from "./readiness.js";
import { registerRateLimit } from "./rate-limit.js";
import { checkSigningKey } from "./signing-key-check.js";
import { createKeyService } from "./signing/key-service.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBudgetHaltGuard, registerSubmissionRoutes } from "./routes/submissions.js";
import { registerWebRoutes } from "./routes/web.js";
import { createMemoryReviewRecordStore } from "./web/record-store.js";
import { seedSyntheticDemoReviewRecords } from "./web/seed-record-store.js";
import { createSubmissionAccessMinter } from "./submission/access.js";
import { createConfigBudgetMeter } from "./submission/budget-meter.js";
import { createEventDerivedBudgetMeter } from "./submission/event-derived-budget-meter.js";
import { createSubmissionReviewEventAppender } from "./submission/review-events.js";
import { createPostgresSubmissionAttemptStore } from "./submission/attempt-state.js";

function nowUtcRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function loadTotpKey(credentialsDirectory: string | undefined, keyRef: string): Promise<Buffer> {
  if (credentialsDirectory === undefined || credentialsDirectory.length === 0) {
    throw new Error("CREDENTIALS_DIRECTORY is required to open TOTP secrets");
  }
  const bytes = await readFile(join(credentialsDirectory, keyRef));
  if (bytes.length !== 32) {
    throw new Error("TOTP encryption key must be 32 bytes");
  }
  return bytes;
}

const LISTEN_ADDR_PATTERN = /^(?:\[(?<v6>.+)\]|(?<plain>[^:]+)):(?<port>\d+)$/;

/**
 * `config.ts`'s LOOPBACK_HOSTS/extractHost() accept bare "::1"/"[::1]" (no
 * port) as valid listen_addr values (config.test.mjs asserts this), but
 * Fastify's listen() needs a concrete host and port. Splitting on ":" alone
 * mis-parses those bare IPv6 forms into a non-undefined but empty/garbage
 * host (`""` or `"["`), which would silently bind wide open (`::`, all
 * interfaces) or crash uncaught — the opposite of this file's fail-closed
 * error envelope. Require the strict host:port shape instead.
 */
export function parseListenAddr(listenAddr: string): { host: string; port: number } | undefined {
  const match = listenAddr.match(LISTEN_ADDR_PATTERN);
  if (match === null) {
    return undefined;
  }
  const host = match.groups?.v6 ?? match.groups?.plain;
  const port = Number(match.groups?.port);
  if (host === undefined || host === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    return undefined;
  }
  return { host, port };
}

async function main() {
  const configPath = process.argv[2];
  if (configPath === undefined) {
    console.error("usage: node src/main.js <config-path>");
    process.exit(1);
    return;
  }

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    console.error(`config failed: ${(error instanceof ConfigError ? error.message : String(error))}`);
    process.exit(1);
    return;
  }

  const pool = createPostgresPool(config.database_url);
  const gateStore = createPostgresEnvironmentGateStore(pool);

  let bootResult;
  try {
    bootResult = await runBootSequence({
      config,
      sql: pool,
      gateStore,
      pool,
      signingKeyCheck: () => checkSigningKey({
        config,
        credentialsDirectory: process.env.CREDENTIALS_DIRECTORY,
        readKeyDirectory: (keyDirectoryPath) => readFile(keyDirectoryPath, "utf8"),
        now: nowUtcRfc3339
      })
    });
  } catch (error) {
    console.error(`boot failed: ${(error as Error).message}`);
    await pool.end();
    process.exit(1);
    return;
  }
  if (!bootResult.ok) {
    console.error(`boot failed at step "${bootResult.step}": ${bootResult.reason}`);
    await pool.end();
    process.exit(1);
    return;
  }

  const listenAddr = parseListenAddr(config.listen_addr);
  if (listenAddr === undefined) {
    console.error(`listen_addr "${config.listen_addr}" is not in host:port form`);
    await pool.end();
    process.exit(1);
    return;
  }

  const objects = createFilesystemObjectStore(config.object_store_root);
  const evidenceLifecycleLog = createPostgresEvidenceLifecycleLogStore(pool);
  let objectEnvelope: { keyId: string; key: Uint8Array } | undefined;
  if (config.object_store_envelope_key_ref !== undefined) {
    try {
      const envelopeBytes = await loadTotpKey(process.env.CREDENTIALS_DIRECTORY, config.object_store_envelope_key_ref);
      objectEnvelope = { keyId: config.object_store_envelope_key_ref, key: new Uint8Array(envelopeBytes) };
    } catch (error) {
      console.error(`object-store envelope key failed: ${(error as Error).message}`);
      await pool.end();
      process.exit(1);
      return;
    }
  }
  const reviewEventLog = createPostgresReviewEventLogStore(pool);
  const budget = config.deployment_identity === "demo"
    ? createEventDerivedBudgetMeter({ eventLog: reviewEventLog, config: config.demo_budget_meter })
    : createConfigBudgetMeter({ demo_budget: { spend_ratio: 0 } });

  const trustAnchorPublicKey = decodeBase64Url(config.signing.trust_anchor_public_key);
  if (trustAnchorPublicKey === undefined) {
    console.error("signing.trust_anchor_public_key failed to decode after boot verified it");
    await pool.end();
    process.exit(1);
    return;
  }
  const keyService = createKeyService({
    key: bootResult.signingKey,
    directory: bootResult.keyDirectory,
    trustAnchorPublicKey
  });

  const accounts = createPostgresAccountStore(pool);
  const sessions = createPostgresSessionStore(pool);

  // Readiness = not shutting down AND the database is live. The DB check is
  // TTL-cached and timeout-bounded so readiness polling cannot hammer Postgres,
  // and short-circuits during drain so shutdown never issues a probe.
  let ready = true;
  const readiness = createDatabaseReadiness({ sql: pool });
  const server = createServer({ isReady: async () => ready && (await readiness.isLive()), logger: true });
  // C6: a dependency-free per-IP global cap in front of every business route
  // (auth + submission + web). Loopback-only today; swap for @fastify/rate-limit
  // with a shared store when Caddy fronts a real route (Section 2 §1).
  registerRateLimit(server, { max: 600, windowMs: 60_000, errorEnvelope });
  // C3: the web review surface reads from a record store that has no live writer
  // yet. For the demo deployment, seed it from the shipped synthetic protocol
  // fixtures (E's owner decision (a)). Re-seeded on every boot, so the content
  // survives a restart even though the store itself is in-memory. Non-demo
  // deployments start empty until a real read model exists.
  const records = createMemoryReviewRecordStore();
  if (config.deployment_identity === "demo") {
    seedSyntheticDemoReviewRecords(records, {
      fixturesRoot: fileURLToPath(new URL("../../../protocol/fixtures/v0", import.meta.url)),
      verifier: keyService.verifier,
      verifiedAt: nowUtcRfc3339()
    });
  }
  server.decorate("ports", { evidenceLifecycleLog, reviewEventLog, records });
  server.decorate("now", nowUtcRfc3339);
  registerBudgetHaltGuard(server, {
    deploymentIdentity: config.deployment_identity,
    budget,
    errorEnvelope
  });
  registerActorResolution(server, {
    accounts,
    sessions,
    sessionCookieSecure: config.session_cookie_secure
  });
  await registerWebRoutes(server, { errorEnvelope });
  await registerSubmissionRoutes(server, {
    credentials: createPostgresSubmissionCredentialStore(pool),
    attempts: createPostgresSubmissionAttemptStore(pool),
    artifacts: createPostgresArtifactStore(objectEnvelope === undefined
      ? { sql: pool, objects, lifecycleLog: evidenceLifecycleLog }
      : { sql: pool, objects, lifecycleLog: evidenceLifecycleLog, envelope: objectEnvelope }),
    classifications: createPostgresClassificationStore(pool),
    reviewEventLog,
    jobs: createPostgresJobQueue(pool),
    budget,
    boundGate: bootResult.gate,
    keyService,
    errorEnvelope,
    now: nowUtcRfc3339,
    mintSubmissionAccess: createSubmissionAccessMinter(evidenceLifecycleLog, nowUtcRfc3339),
    appendSubmissionReviewEvent: createSubmissionReviewEventAppender(reviewEventLog)
  });

  let totpKey: Buffer;
  try {
    totpKey = await loadTotpKey(process.env.CREDENTIALS_DIRECTORY, config.encryption_key_ref);
  } catch (error) {
    console.error(`totp key failed: ${(error as Error).message}`);
    await pool.end();
    process.exit(1);
    return;
  }
  await registerAuthRoutes(server, {
    accounts,
    sessions,
    throttle: createPostgresLoginThrottle(pool),
    totpKey,
    sessionCookieSecure: config.session_cookie_secure,
    errorEnvelope
  });
  await server.listen({ host: listenAddr.host, port: listenAddr.port });

  installShutdownHandlers({
    drain: () => drain(server),
    endPool: () => pool.end(),
    setNotReady: () => { ready = false; },
    exit: (code) => process.exit(code)
  });
}

export type ShutdownDeps = {
  drain: () => Promise<void>;
  endPool: () => Promise<void>;
  setNotReady: () => void;
  exit: (code: number) => void;
  log?: (message: string) => void;
  /** Injectable event registrar (defaults to `process.once`) for tests. */
  register?: (event: string, handler: (arg?: unknown) => void) => void;
};

/**
 * Wires every shutdown trigger to a single bounded drain-then-exit path.
 * SIGTERM and SIGINT (Ctrl-C / some supervisors) drain cleanly and exit 0. On
 * Node 24 an unhandled promise rejection or uncaught exception outside
 * Fastify's request lifecycle otherwise terminates the process without
 * draining in-flight requests or closing the pool; both are caught here, run
 * the same drain path, and exit non-zero so a supervisor sees the failure.
 * `shuttingDown` guards a second signal (or a crash mid-drain) from racing two
 * drain/pool-close sequences. Returns the shutdown function for direct testing.
 */
export function installShutdownHandlers(deps: ShutdownDeps): (exitCode: number) => Promise<void> {
  const log = deps.log ?? ((message) => console.error(message));
  const register = deps.register ?? ((event, handler) => { process.once(event, handler); });
  let shuttingDown = false;
  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    deps.setNotReady();
    try {
      await deps.drain();
      await deps.endPool();
    } catch (error) {
      log(`shutdown drain failed: ${(error as Error).message}`);
    } finally {
      deps.exit(exitCode);
    }
  }
  register("SIGTERM", () => { void shutdown(0); });
  register("SIGINT", () => { void shutdown(0); });
  register("unhandledRejection", (reason) => {
    log(`unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    void shutdown(1);
  });
  register("uncaughtException", (error) => {
    log(`uncaughtException: ${error instanceof Error ? error.message : String(error)}`);
    void shutdown(1);
  });
  return shutdown;
}

// Guarded like scripts/run-migrations.mjs and scripts/seed-environment-gate.mjs
// so this module can be imported (e.g. to unit-test parseListenAddr / loadTotpKey)
// without its CLI side effect running.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`fatal: ${(error as Error).message}`);
    process.exit(1);
  });
}
