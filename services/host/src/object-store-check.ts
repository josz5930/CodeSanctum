import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ObjectStoreCheckResult = { ok: true } | { ok: false; reason: string };

export type EncryptedBackingProbe = (root: string) => Promise<{ encrypted: boolean; detail: string }>;

export function backingLooksEncrypted(findmntLine: string): boolean {
  return /mapper|crypt|crypto_luks/i.test(findmntLine);
}

export async function probeFindmntEncryptedBacking(root: string): Promise<{ encrypted: boolean; detail: string }> {
  try {
    const { stdout } = await execFileAsync("findmnt", ["-n", "-T", root, "-o", "SOURCE,FSTYPE,OPTIONS"], {
      encoding: "utf8",
      timeout: 3000
    });
    const detail = stdout.trim();
    return { encrypted: backingLooksEncrypted(detail), detail };
  } catch (error) {
    return { encrypted: false, detail: (error as Error).message };
  }
}

/**
 * Verifies the object-store root exists and is writable by probing a real
 * write, that the operator's config-declared encryption status agrees with
 * the gate's `encryption_at_rest_ready`, and — when encryption is declared or
 * required — that the backing mount is a crypt/mapper device rather than a
 * config attestation alone.
 */
export async function verifyObjectStore(input: {
  root: string;
  declaredEncrypted: boolean;
  gateExpectsEncrypted: boolean;
  probeEncryptedBacking?: EncryptedBackingProbe;
}): Promise<ObjectStoreCheckResult> {
  const probeDir = await mkdtemp(path.join(input.root, ".onevps-boot-probe-")).catch((error: unknown) => {
    return error as Error;
  });
  if (probeDir instanceof Error) {
    return { ok: false, reason: `object_store_root "${input.root}" does not exist or is not writable: ${probeDir.message}` };
  }
  try {
    await writeFile(path.join(probeDir, "probe"), "ok");
  } catch (error) {
    return { ok: false, reason: `object_store_root "${input.root}" is not writable: ${(error as Error).message}` };
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }

  if (input.declaredEncrypted !== input.gateExpectsEncrypted) {
    return {
      ok: false,
      reason: `config declares object_store_encrypted=${input.declaredEncrypted} but the gate's encryption_at_rest_ready=${input.gateExpectsEncrypted}`
    };
  }

  if (input.declaredEncrypted || input.gateExpectsEncrypted) {
    const probe = input.probeEncryptedBacking ?? probeFindmntEncryptedBacking;
    const backing = await probe(input.root);
    if (!backing.encrypted) {
      return { ok: false, reason: `object store backing device is not encrypted: ${backing.detail}` };
    }
  }

  return { ok: true };
}
