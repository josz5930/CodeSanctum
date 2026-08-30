import type { EnvironmentGateStore, SqlExecutor } from "../../../packages/evidence-store/src/index.js";
import type { EnvironmentEvidenceGate, SigningKeyDirectory } from "../../../packages/protocol-ts/src/index.js";
import type { SigningKeyHandle } from "../../../packages/signing/src/index.js";

import { bindEnvironmentGate } from "./gate-binding.js";
import { checkMigrationHead } from "./migration-check.js";
import { verifyObjectStore } from "./object-store-check.js";
import { runGrantSelfTest } from "./grant-self-test.js";
import type { HostConfig } from "./config.js";
import type { SigningKeyCheckResult } from "./signing-key-check.js";

export type BootResult =
  | { ok: true; signingKey: SigningKeyHandle; keyDirectory: SigningKeyDirectory; gate: EnvironmentEvidenceGate }
  | { ok: false; step: "migration_head" | "gate_binding" | "session_cookie" | "object_store" | "grant_self_test" | "signing_key"; reason: string };

/**
 * Loopback for the cookie-hardening rule: 127.0.0.0/8, ::1, and localhost.
 * Wider than loadConfig's internet-exposure check, which still rejects any
 * non-loopback listen_addr at parse time.
 */
export function isLoopbackListenAddress(listenAddr: string): boolean {
  const host = hostOfListenAddr(listenAddr);
  if (host === "localhost" || host === "::1") {
    return true;
  }
  const octets = host.split(".");
  if (octets.length !== 4 || octets[0] !== "127") {
    return false;
  }
  return octets.every((octet) => {
    const n = Number(octet);
    return Number.isInteger(n) && n >= 0 && n <= 255 && String(n) === octet;
  });
}

function hostOfListenAddr(listenAddr: string): string {
  if (listenAddr === "::1" || listenAddr === "localhost") {
    return listenAddr;
  }
  if (listenAddr.startsWith("[")) {
    const closeBracket = listenAddr.indexOf("]");
    return closeBracket === -1 ? listenAddr : listenAddr.slice(1, closeBracket);
  }
  const lastColon = listenAddr.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(listenAddr.slice(lastColon + 1))) {
    return listenAddr.slice(0, lastColon);
  }
  return listenAddr;
}

/**
 * Steps 2-5 of the design doc's six-step boot ladder (step 1, config, runs
 * before this is called; step 6, serve, is server.ts), plus the signing-key
 * custody self-test from the key custody spec (section 5.2). The signing
 * check runs last because it is the only step that depends on a key rather
 * than the database. Every step must pass or boot stops immediately — there
 * is no degraded mode.
 */
export async function runBootSequence(input: {
  config: HostConfig;
  sql: SqlExecutor;
  gateStore: EnvironmentGateStore;
  pool: { withConnection<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T> };
  signingKeyCheck: () => Promise<SigningKeyCheckResult>;
}): Promise<BootResult> {
  const migration = await checkMigrationHead(input.sql);
  if (!migration.ok) {
    return { ok: false, step: "migration_head", reason: migration.reason };
  }

  let gate;
  try {
    gate = await bindEnvironmentGate(input.gateStore, input.config.deployment_identity);
  } catch (error) {
    return { ok: false, step: "gate_binding", reason: (error as Error).message };
  }
  if (!gate.ok) {
    return { ok: false, step: "gate_binding", reason: gate.reason };
  }

  // Fail closed, in the shape of every other ladder step: a deployment that is
  // reachable from anywhere but loopback must issue Secure, __Host- cookies.
  // This cannot be waived by editing one config line on a production box.
  if (!input.config.session_cookie_secure && !isLoopbackListenAddress(input.config.listen_addr)) {
    return { ok: false, step: "session_cookie", reason: "session_cookie_secure_required_off_loopback" };
  }

  const objectStore = await verifyObjectStore({
    root: input.config.object_store_root,
    declaredEncrypted: input.config.object_store_encrypted,
    gateExpectsEncrypted: gate.gate.encryption_at_rest_ready
  });
  if (!objectStore.ok) {
    return { ok: false, step: "object_store", reason: objectStore.reason };
  }

  let grantSelfTest;
  try {
    grantSelfTest = await runGrantSelfTest(input.pool);
  } catch (error) {
    return { ok: false, step: "grant_self_test", reason: (error as Error).message };
  }
  if (!grantSelfTest.ok) {
    return { ok: false, step: "grant_self_test", reason: grantSelfTest.reason };
  }

  const signingKey = await input.signingKeyCheck();
  if (!signingKey.ok) {
    return { ok: false, step: "signing_key", reason: signingKey.reason };
  }

  return { ok: true, signingKey: signingKey.key, keyDirectory: signingKey.directory, gate: gate.gate };
}
