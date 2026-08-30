import type { IdentitySigningInput, SignatureEnvelope, SigningKeyDirectory } from "../../../../packages/protocol-ts/src/index.js";
import type { SignatureVerifier, SigningKeyHandle } from "../../../../packages/signing/src/index.js";
import { createSignatureVerifier, signIdentityEnvelope } from "../../../../packages/signing/src/index.js";

export const MANAGED_KEY_LIMITATIONS: [string, ...string[]] = [
  "Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.",
  "A valid signature shows which deployment key produced this artifact and says nothing about the completeness or quality of any review."
];

export type KeyService = {
  readonly key_id: string;
  readonly key_version: string;
  readonly verifier: SignatureVerifier;
  sign(input: { signing_input: IdentitySigningInput; signing_time: string }): SignatureEnvelope;
};

export function createKeyService(input: { key: SigningKeyHandle; directory: SigningKeyDirectory; trustAnchorPublicKey: Uint8Array }): KeyService {
  const verifier = createSignatureVerifier({ directory: input.directory, trustAnchorPublicKey: input.trustAnchorPublicKey });
  return {
    key_id: input.key.key_id,
    key_version: input.key.key_version,
    verifier,
    sign(signInput) {
      return signIdentityEnvelope({
        signing_input: signInput.signing_input,
        key: input.key,
        signing_time: signInput.signing_time,
        signing_mode: "managed_key",
        signing_limitations: [...MANAGED_KEY_LIMITATIONS]
      });
    }
  };
}
