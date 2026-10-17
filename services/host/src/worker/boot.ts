import type { EnvironmentGateStore, SqlExecutor } from "../../../../packages/evidence-store/src/index.js";
import type { EnvironmentEvidenceGate, SigningKeyDirectory } from "../../../../packages/protocol-ts/src/index.js";
import { decodeBase64Url, verifyKeyDirectory } from "../../../../packages/signing/src/index.js";

import type { HostConfig } from "../config.js";
import { bindEnvironmentGate } from "../gate-binding.js";
import { runGrantSelfTest } from "../grant-self-test.js";
import { checkMigrationHead } from "../migration-check.js";
import { verifyObjectStore } from "../object-store-check.js";

export type WorkerBootResult =
  | { ok: true; gate: EnvironmentEvidenceGate; keyDirectory: SigningKeyDirectory; trustAnchorPublicKey: Uint8Array }
  | { ok: false; step: "migration_head" | "gate_binding" | "object_store" | "grant_self_test" | "key_directory"; reason: string };

/**
 * The worker's fail-closed boot: the host's ladder (runBootSequence) without
 * the session-cookie step, which has no meaning here, and without the signing
 * private key. The worker only verifies signatures, so it loads the
 * trust-anchor-signed key directory and never the deployment signing key.
 */
export async function runWorkerBootSequence(input: {
  config: HostConfig;
  sql: SqlExecutor;
  gateStore: EnvironmentGateStore;
  pool: { withConnection<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T> };
  readKeyDirectory: (keyDirectoryPath: string) => Promise<string>;
}): Promise<WorkerBootResult> {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(await input.readKeyDirectory(input.config.signing.key_directory_path));
  } catch {
    return { ok: false, step: "key_directory", reason: "signing_key_directory_unreadable" };
  }
  const trustAnchorPublicKey = decodeBase64Url(input.config.signing.trust_anchor_public_key);
  if (trustAnchorPublicKey === undefined || !verifyKeyDirectory(parsed, trustAnchorPublicKey)) {
    return { ok: false, step: "key_directory", reason: "signing_key_directory_untrusted" };
  }

  return { ok: true, gate: gate.gate, keyDirectory: parsed as SigningKeyDirectory, trustAnchorPublicKey };
}
