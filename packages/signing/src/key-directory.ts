import type { IdentitySigningInput, SigningKeyDirectory, SigningKeyRecord } from "../../protocol-ts/src/index.js";
import { canonicalizeProtocolJson, sha256ProtocolText, validateProtocolSchema } from "../../protocol-ts/src/index.js";

import { decodeBase64Url } from "./base64url.js";
import { ML_DSA_65_PUBLIC_KEY_BYTES, verifyMlDsa65 } from "./ml-dsa.js";
import { signedMessage } from "./signed-message.js";

export type KeyTrustFailure =
  | "signature_key_unknown"
  | "signature_key_revoked"
  | "signature_key_outside_validity_window"
  | "signature_key_algorithm_mismatch";

export type KeyResolution =
  | { ok: true; record: SigningKeyRecord }
  | { ok: false; reason: KeyTrustFailure };

export type KeyResolutionQuery = {
  key_id: string;
  key_version: string;
  signing_time: string;
  purpose: "sign" | "verify";
};

export const KEY_DIRECTORY_IDENTITY_INPUT_PATH = "v0/valid/signing-key-directory.identity-input.json";

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function insideWindow(record: SigningKeyRecord, signingTime: string): boolean {
  const at = instant(signingTime);
  const from = instant(record.valid_from);
  if (at === undefined || from === undefined || at < from) return false;
  if (record.valid_until === undefined) return true;
  const until = instant(record.valid_until);
  // valid_from is inclusive and valid_until exclusive so that a rotation
  // boundary belongs to exactly one key version.
  return until !== undefined && at < until;
}

export function resolveSigningKey(directory: SigningKeyDirectory, query: KeyResolutionQuery): KeyResolution {
  const record = directory.keys.find((candidate) => candidate.key_id === query.key_id && candidate.key_version === query.key_version);
  if (record === undefined) return { ok: false, reason: "signature_key_unknown" };
  if (record.algorithm_profile !== "ml_dsa_65") return { ok: false, reason: "signature_key_algorithm_mismatch" };
  if (record.status === "revoked") return { ok: false, reason: "signature_key_revoked" };
  if (query.purpose === "sign" && record.status !== "active") return { ok: false, reason: "signature_key_outside_validity_window" };
  if (!insideWindow(record, query.signing_time)) return { ok: false, reason: "signature_key_outside_validity_window" };
  return { ok: true, record };
}

export function keyDirectoryIdentity(directory: SigningKeyDirectory): string {
  const { directory_signature: _excluded, ...identityDocument } = directory;
  return sha256ProtocolText(canonicalizeProtocolJson(identityDocument));
}

export function keyDirectorySigningInput(directory: SigningKeyDirectory): IdentitySigningInput {
  return {
    protocol_version: "codeattest.v0",
    signing_input_type: "signing_key_directory_identity",
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: "signing_key_directory",
    signed_identity: keyDirectoryIdentity(directory),
    canonicalization: "rfc8785",
    identity_input_path: KEY_DIRECTORY_IDENTITY_INPUT_PATH
  };
}

export function verifyKeyDirectory(directory: unknown, trustAnchorPublicKey: Uint8Array): boolean {
  if (trustAnchorPublicKey.length !== ML_DSA_65_PUBLIC_KEY_BYTES) return false;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:signing-key-directory", directory).length > 0) return false;
  const typed = directory as SigningKeyDirectory;
  const signature = typed.directory_signature;
  if (signature.signed_identity_type !== "signing_key_directory") return false;
  if (signature.key_id !== typed.trust_anchor_key_id) return false;
  if (signature.algorithm_profile !== "ml_dsa_65") return false;
  const input = keyDirectorySigningInput(typed);
  if (signature.signed_identity !== input.signed_identity) return false;
  const bytes = decodeBase64Url(signature.signature_bytes.slice("ml_dsa_65:".length));
  if (bytes === undefined) return false;
  return verifyMlDsa65(trustAnchorPublicKey, signedMessage(canonicalizeProtocolJson(input)), bytes);
}
