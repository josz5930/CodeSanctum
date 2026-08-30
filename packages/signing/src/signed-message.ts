import type { IdentitySigningInput } from "../../protocol-ts/src/index.js";
import { canonicalizeProtocolJson } from "../../protocol-ts/src/index.js";

/**
 * Domain tag prefixed to canonical bytes before signing, so a signature over
 * one scheme's bytes can never be replayed as a signature over another's.
 * Must stay byte-identical to `SIGNED_MESSAGE_DOMAIN` in
 * `runner/crates/local-runner-scaffold/src/ml_dsa.rs`.
 */
export const SIGNED_MESSAGE_DOMAIN = "codeattest-ml-dsa-65-v1";

export function signedMessage(canonicalIdentitySigningInput: string): Uint8Array {
  return new Uint8Array(Buffer.from(`${SIGNED_MESSAGE_DOMAIN}\n${canonicalIdentitySigningInput}`, "utf8"));
}

export function signedMessageForSigningInput(signingInput: IdentitySigningInput): Uint8Array {
  return signedMessage(canonicalizeProtocolJson(signingInput));
}
