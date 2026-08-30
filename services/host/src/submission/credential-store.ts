import { scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Secret comparison stays here; issuance, expiry, and revocation live in
 * identity-store. Routes call `resolve(tokenKeyId, now)` then
 * `verifyCredentialSecret`.
 */
export type SubmissionCredential = {
  token_key_id: string;
  review_id: string;
  tenant_id: string;
  customer_id: string;
  selected_application_id: string;
  selected_commit: string;
  repository_identity_hash: string;
  expected_manifest_id: string;
  expected_evidence_bundle_id?: string;
  /** `scrypt$N$r$p$saltHex$hashHex`. The plaintext secret is never stored. */
  secret_hash: string;
};

export interface SubmissionCredentialStore {
  resolve(tokenKeyId: string, now: Date): Promise<SubmissionCredential | undefined>;
}

type ScryptParts = { N: number; r: number; p: number; salt: Buffer; hash: Buffer };

function parseScryptHash(stored: string): ScryptParts | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return undefined;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return undefined;
  }
  try {
    return { N, r, p, salt: Buffer.from(parts[4] ?? "", "hex"), hash: Buffer.from(parts[5] ?? "", "hex") };
  } catch {
    return undefined;
  }
}

export function verifyCredentialSecret(credential: SubmissionCredential, presented: string): boolean {
  const parsed = parseScryptHash(credential.secret_hash);
  if (parsed === undefined || parsed.hash.length === 0 || parsed.salt.length === 0) {
    return false;
  }
  let derived: Buffer;
  try {
    derived = scryptSync(presented, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 64 * 1024 * 1024
    });
  } catch {
    return false;
  }
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}
