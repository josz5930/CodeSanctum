import type { IdentitySigningInput, SignatureEnvelope, SignatureVerificationOutcome, SigningKeyDirectory } from "../../protocol-ts/src/index.js";
import { canonicalizeProtocolJson } from "../../protocol-ts/src/index.js";

import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import { publicKeyFromPkcs8, signMlDsa65, verifyMlDsa65 } from "./ml-dsa.js";
import { signedMessage } from "./signed-message.js";
import { resolveSigningKey, verifyKeyDirectory } from "./key-directory.js";

export const ML_DSA_65_SIGNATURE_PREFIX = "ml_dsa_65:";

export type SigningKeyHandle = {
  key_id: string;
  key_version: string;
  privateKeyPkcs8: Uint8Array;
};

export type SignIdentityEnvelopeInput = {
  signing_input: IdentitySigningInput;
  key: SigningKeyHandle;
  signing_time: string;
  signing_mode: "managed_key" | "enrolled_runner_key";
  signing_limitations: [string, ...string[]];
};

export function signIdentityEnvelope(input: SignIdentityEnvelopeInput): SignatureEnvelope {
  const message = signedMessage(canonicalizeProtocolJson(input.signing_input));
  const signature = signMlDsa65(input.key.privateKeyPkcs8, message);
  return {
    protocol_version: input.signing_input.protocol_version,
    algorithm_profile: "ml_dsa_65",
    key_id: input.key.key_id,
    key_version: input.key.key_version,
    signing_time: input.signing_time,
    signed_identity_type: input.signing_input.signed_identity_type,
    signed_identity: input.signing_input.signed_identity,
    canonicalization: "rfc8785",
    signing_mode: input.signing_mode,
    signing_limitations: [...input.signing_limitations],
    signature_bytes: `${ML_DSA_65_SIGNATURE_PREFIX}${encodeBase64Url(signature)}`
  };
}

export type VerifyIdentityEnvelopeInput = {
  envelope: SignatureEnvelope;
  signing_input: IdentitySigningInput;
  verified_at: string;
};

export type SignatureVerifier = {
  readonly directoryTrusted: boolean;
  verify(input: VerifyIdentityEnvelopeInput): SignatureVerificationOutcome;
};

function outcome(input: VerifyIdentityEnvelopeInput, directoryVersion: number, result: SignatureVerificationOutcome["result"]): SignatureVerificationOutcome {
  return {
    protocol_version: "codeattest.v0",
    signed_identity_type: input.envelope.signed_identity_type as SignatureVerificationOutcome["signed_identity_type"],
    signed_identity: input.envelope.signed_identity,
    algorithm_profile: "ml_dsa_65",
    key_id: input.envelope.key_id,
    key_version: input.envelope.key_version,
    key_directory_version: directoryVersion,
    verified_at: input.verified_at,
    result
  };
}

/**
 * The `directory_version` actually present in the supplied directory, whether
 * or not the directory is trusted, so an untrusted outcome reports the real
 * version rather than a fabricated one. The schema floors
 * `key_directory_version` at 1, so `1` doubles as the sentinel meaning "the
 * directory could not be parsed or carried no valid version"; the `result`
 * field (`signature_key_directory_untrusted`) is what tells a consumer the
 * directory was not trusted, not the version number.
 */
function parsedDirectoryVersion(directory: unknown): number {
  if (typeof directory === "object" && directory !== null) {
    const version = (directory as Record<string, unknown>).directory_version;
    if (typeof version === "number" && Number.isInteger(version) && version >= 1) {
      return version;
    }
  }
  return 1;
}

export function createSignatureVerifier(config: { directory: unknown; trustAnchorPublicKey: Uint8Array }): SignatureVerifier {
  const trusted = verifyKeyDirectory(config.directory, config.trustAnchorPublicKey);
  const directory = config.directory as SigningKeyDirectory;
  const directoryVersion = parsedDirectoryVersion(config.directory);
  return {
    directoryTrusted: trusted,
    verify(input) {
      if (!trusted) return outcome(input, directoryVersion, "signature_key_directory_untrusted");
      const envelope = input.envelope;
      const signingInput = input.signing_input;
      if (
        signingInput.signed_identity !== envelope.signed_identity ||
        signingInput.signed_identity_type !== envelope.signed_identity_type ||
        signingInput.canonicalization !== envelope.canonicalization ||
        signingInput.algorithm_profile !== "ml_dsa_65"
      ) {
        return outcome(input, directoryVersion, "signature_signing_input_mismatch");
      }
      const resolution = resolveSigningKey(directory, {
        key_id: envelope.key_id,
        key_version: envelope.key_version,
        signing_time: envelope.signing_time,
        purpose: "verify"
      });
      if (!resolution.ok) return outcome(input, directoryVersion, resolution.reason);
      if (!envelope.signature_bytes.startsWith(ML_DSA_65_SIGNATURE_PREFIX)) {
        return outcome(input, directoryVersion, "signature_bytes_untrusted");
      }
      const signature = decodeBase64Url(envelope.signature_bytes.slice(ML_DSA_65_SIGNATURE_PREFIX.length));
      const publicKey = decodeBase64Url(resolution.record.public_key);
      if (signature === undefined || publicKey === undefined) {
        return outcome(input, directoryVersion, "signature_bytes_untrusted");
      }
      const message = signedMessage(canonicalizeProtocolJson(signingInput));
      const verified = verifyMlDsa65(publicKey, message, signature);
      return outcome(input, directoryVersion, verified ? "verified" : "signature_bytes_untrusted");
    }
  };
}

export { publicKeyFromPkcs8 };
