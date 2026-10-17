import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  catchUpRetentionExpiry,
  createFilesystemObjectStore,
  createPostgresArtifactStore,
  createPostgresClassificationStore,
  createPostgresEnvironmentGateStore,
  createPostgresEvidenceLifecycleLogStore,
  createPostgresJobQueue,
  createPostgresPool,
  createPostgresRetentionRecordStore,
  createPostgresReviewEventLogStore,
  processRetentionExpiryJob,
  releaseStaleJobClaims,
  type PostgresPool
} from "../../../../packages/evidence-store/src/index.js";
import { createSignatureVerifier } from "../../../../packages/signing/src/index.js";

import { ConfigError, loadConfig, type HostConfig } from "../config.js";
import { installShutdownHandlers, loadTotpKey } from "../main.js";
import { createSubmissionAccessMinter } from "../submission/access.js";
import { createPostgresSubmissionAttemptStore } from "../submission/attempt-state.js";
import { createPostgresVendorReceiptStore } from "../submission/receipt-store.js";
import { runWorkerBootSequence } from "./boot.js";
import { drainNormalizeJobs, WORKER_ACTOR_ID, type NormalizeJobDeps } from "./normalize-job.js";
import { createPostgresArtifactPresenceReader, createPostgresNormalizationOutcomeStore } from "./normalization-records.js";
import {
  createHttpTransparencyAnchor,
  createPostgresCheckpointPublicationStore,
  loadReviewHeads,
  runTransparencyCheckpoint
} from "./transparency.js";

/** How often `run` looks for queued normalization jobs. */
export const NORMALIZE_POLL_MS = 5_000;
/** A claim older than this belongs to a worker that died; the job goes back. */
export const STALE_CLAIM_SECONDS = 15 * 60;

const COMMANDS = ["run", "retention", "checkpoint"] as const;
type Command = (typeof COMMANDS)[number];

function nowUtcRfc3339(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ component: "codeattest-worker", ...entry }));
}

/**
 * The long-running normalization loop. Each pass returns stale claims to the
 * queue and drains it; a pass that throws (for example, Postgres is briefly
 * down) is logged and retried on the next tick rather than ending the process.
 */
export async function runNormalizeLoop(input: {
  pass: () => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  stopping: () => boolean;
  log: (entry: Record<string, unknown>) => void;
  pollMs?: number;
}): Promise<void> {
  while (!input.stopping()) {
    try {
      await input.pass();
    } catch (error) {
      input.log({ event: "normalize_pass_failed", error: (error as Error).message });
    }
    if (input.stopping()) {
      return;
    }
    await input.sleep(input.pollMs ?? NORMALIZE_POLL_MS);
  }
}

async function loadEnvelope(config: HostConfig): Promise<{ keyId: string; key: Uint8Array } | undefined> {
  if (config.object_store_envelope_key_ref === undefined) {
    return undefined;
  }
  const bytes = await loadTotpKey(process.env.CREDENTIALS_DIRECTORY, config.object_store_envelope_key_ref);
  return { keyId: config.object_store_envelope_key_ref, key: new Uint8Array(bytes) };
}

async function loadAnchorToken(config: HostConfig): Promise<string | undefined> {
  if (config.transparency_anchor === undefined) {
    return undefined;
  }
  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (directory === undefined || directory.length === 0) {
    throw new Error("CREDENTIALS_DIRECTORY is required to read the transparency anchor token");
  }
  const token = (await readFile(join(directory, config.transparency_anchor.token_credential), "utf8")).trim();
  if (token.length === 0) {
    throw new Error("the transparency anchor token is empty");
  }
  return token;
}

async function runCommand(command: Command, config: HostConfig, pool: PostgresPool): Promise<number> {
  const boot = await runWorkerBootSequence({
    config,
    sql: pool,
    gateStore: createPostgresEnvironmentGateStore(pool),
    pool,
    readKeyDirectory: (keyDirectoryPath) => readFile(keyDirectoryPath, "utf8")
  });
  if (!boot.ok) {
    log({ event: "worker_boot_failed", command, step: boot.step, reason: boot.reason });
    return 1;
  }

  const lifecycleLog = createPostgresEvidenceLifecycleLogStore(pool);
  const objects = createFilesystemObjectStore(config.object_store_root);
  const envelope = await loadEnvelope(config);
  const artifacts = createPostgresArtifactStore(envelope === undefined
    ? { sql: pool, objects, lifecycleLog }
    : { sql: pool, objects, lifecycleLog, envelope });
  const jobs = createPostgresJobQueue(pool);
  const actor = { actor_type: "vendor_service" as const, actor_id: WORKER_ACTOR_ID };

  if (command === "retention") {
    const retentionRecords = createPostgresRetentionRecordStore(pool);
    const now = nowUtcRfc3339();
    await releaseStaleJobClaims(pool, STALE_CLAIM_SECONDS);
    const caughtUp = await catchUpRetentionExpiry({ jobs, retentionRecords, now, artifacts });
    const processed = await processRetentionExpiryJob({ jobs, artifacts, retentionRecords, now, actor });
    log({ event: "retention_run", ...caughtUp, ...processed });
    // A failed purge stays queued for the next run, but this run must show as
    // failed so the timer's unit state reports it.
    return processed.failed.length > 0 ? 1 : 0;
  }

  if (command === "checkpoint") {
    const token = await loadAnchorToken(config);
    const anchor = config.transparency_anchor === undefined || token === undefined
      ? undefined
      : createHttpTransparencyAnchor({ baseUrl: config.transparency_anchor.base_url, token });
    const result = await runTransparencyCheckpoint({
      anchor,
      heads: await loadReviewHeads(pool, createPostgresReviewEventLogStore(pool)),
      publications: createPostgresCheckpointPublicationStore(pool),
      now: nowUtcRfc3339
    });
    log({ event: "checkpoint_run", ...result });
    return 0;
  }

  const verifier = createSignatureVerifier({ directory: boot.keyDirectory, trustAnchorPublicKey: boot.trustAnchorPublicKey });
  const deps: NormalizeJobDeps = {
    jobs,
    attempts: createPostgresSubmissionAttemptStore(pool),
    receipts: createPostgresVendorReceiptStore(pool),
    artifacts,
    classifications: createPostgresClassificationStore(pool),
    presence: createPostgresArtifactPresenceReader(pool),
    outcomes: createPostgresNormalizationOutcomeStore(pool),
    verifier,
    mintAccess: (jobAttempt, attempt, reference) =>
      createSubmissionAccessMinter(lifecycleLog, nowUtcRfc3339, {
        actorId: WORKER_ACTOR_ID,
        purpose: "finding_normalization",
        idempotencyScope: `normalize:${jobAttempt}`
      })(attempt, reference),
    environmentProfile: boot.gate.environment_profile,
    now: nowUtcRfc3339,
    log
  };

  let stopping = false;
  let wake: (() => void) | undefined;
  const loop = runNormalizeLoop({
    pass: async () => {
      const released = await releaseStaleJobClaims(pool, STALE_CLAIM_SECONDS);
      const drained = await drainNormalizeJobs(deps);
      if (released > 0 || drained.normalized + drained.rejected + drained.failed.length > 0) {
        log({ event: "normalize_pass", released_stale_claims: released, ...drained });
      }
    },
    sleep: (milliseconds) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      wake = () => { clearTimeout(timer); resolve(); };
    }),
    stopping: () => stopping,
    log
  });
  log({ event: "worker_started", deployment_identity: config.deployment_identity });
  installShutdownHandlers({
    setNotReady: () => {
      stopping = true;
      wake?.();
    },
    drain: () => loop,
    endPool: () => pool.end(),
    exit: (code) => process.exit(code)
  });
  await loop;
  return 0;
}

async function main(): Promise<void> {
  const [command, configPath] = process.argv.slice(2);
  if (!COMMANDS.includes(command as Command) || configPath === undefined) {
    console.error("usage: node worker/main.js <run|retention|checkpoint> <config-path>");
    process.exit(2);
    return;
  }
  let config: HostConfig;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    console.error(`config failed: ${error instanceof ConfigError ? error.message : String(error)}`);
    process.exit(1);
    return;
  }
  const pool = createPostgresPool(config.database_url);
  let code: number;
  try {
    code = await runCommand(command as Command, config, pool);
  } catch (error) {
    log({ event: "worker_command_failed", command, error: (error as Error).message });
    code = 1;
  }
  // A `run` that started its loop only returns after the shutdown handler,
  // which ends the pool and exits itself. Any other result must exit here: a
  // `run` that failed to boot would otherwise sit idle on its open pool, and
  // systemd would never see the failure or restart it.
  if (command !== "run" || code !== 0) {
    await pool.end();
    process.exit(code);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`fatal: ${(error as Error).message}`);
    process.exit(1);
  });
}
