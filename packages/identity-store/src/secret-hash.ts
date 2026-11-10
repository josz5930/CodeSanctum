import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Memory-hard by design. The parameters are stored in the hash string rather
 * than compiled in, so raising them later is a write-time change with no
 * migration: old hashes keep verifying under their own parameters.
 */
export const SCRYPT_PARAMETERS = { N: 32768, r: 8, p: 1, keyLength: 32 } as const;

const MAXMEM = 128 * SCRYPT_PARAMETERS.N * SCRYPT_PARAMETERS.r * 2;

export function hashSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plaintext, salt, SCRYPT_PARAMETERS.keyLength, {
    N: SCRYPT_PARAMETERS.N,
    r: SCRYPT_PARAMETERS.r,
    p: SCRYPT_PARAMETERS.p,
    maxmem: MAXMEM
  });
  return `scrypt$${SCRYPT_PARAMETERS.N}$${SCRYPT_PARAMETERS.r}$${SCRYPT_PARAMETERS.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error === null) {
        resolve(derived);
      } else {
        reject(error);
      }
    });
  });
}

/**
 * The derivation runs on the libuv thread pool, not on the main thread. One
 * derivation takes tens of milliseconds, and the host calls this for each
 * login and each submission request, so a synchronous call would stop every
 * other request (health checks included) while it runs.
 */
export async function verifySecret(stored: string, presented: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N <= 1 || r < 1 || p < 1) {
    return false;
  }
  if (!/^[a-f0-9]+$/.test(parts[4] ?? "") || !/^[a-f0-9]+$/.test(parts[5] ?? "")) {
    return false;
  }
  const salt = Buffer.from(parts[4] as string, "hex");
  const expected = Buffer.from(parts[5] as string, "hex");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = await scryptAsync(presented, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
