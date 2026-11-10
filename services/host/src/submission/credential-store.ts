import { verifySecret } from "../../../../packages/identity-store/src/index.js";

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

/**
 * Asynchronous: the scrypt derivation runs off the main thread (see
 * `verifySecret`). A malformed stored hash does not verify and does not throw.
 */
export function verifyCredentialSecret(credential: Pick<SubmissionCredential, "secret_hash">, presented: string): Promise<boolean> {
  return verifySecret(credential.secret_hash, presented);
}
