import { createHash } from "node:crypto";

import type { IdentitySigningInput, RunnerReleaseRecord, SignatureEnvelope } from "../../protocol-ts/src/index.js";
import { canonicalizeProtocolJson, sha256ProtocolText, validateProtocolSchema } from "../../protocol-ts/src/index.js";

import { decodeBase64Url } from "./base64url.js";
import { ML_DSA_65_SIGNATURE_PREFIX, signIdentityEnvelope, type SigningKeyHandle } from "./envelope.js";
import { ML_DSA_65_PUBLIC_KEY_BYTES, verifyMlDsa65 } from "./ml-dsa.js";
import { signedMessage } from "./signed-message.js";

export const RUNNER_RELEASE_IDENTITY_INPUT_PATH = "v0/valid/runner-release-record.identity-input.json";
export const SOFTWARE_CUSTODY_LIMITATION =
  "Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.";

export type RunnerReleaseVerificationArtifact = {
  release_record: RunnerReleaseRecord;
  signing_input: IdentitySigningInput;
  signature: SignatureEnvelope;
};

export type RunnerReleaseVerification =
  | { ok: true; release_record: RunnerReleaseRecord }
  | {
      ok: false;
      reason:
        | "release_artifact_malformed"
        | "release_record_invalid"
        | "release_build_mismatch"
        | "release_identifier_mismatch"
        | "release_artifact_digest_mismatch"
        | "release_signing_input_mismatch"
        | "release_signature_invalid"
        | "release_trust_anchor_invalid";
    };

export function runnerReleaseSigningInput(record: RunnerReleaseRecord): IdentitySigningInput {
  return {
    protocol_version: "codeattest.v0",
    signing_input_type: "runner_release_identity",
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: "runner_release",
    signed_identity: sha256ProtocolText(canonicalizeProtocolJson(record)),
    canonicalization: "rfc8785",
    identity_input_path: RUNNER_RELEASE_IDENTITY_INPUT_PATH
  };
}

export function signRunnerReleaseArtifact(input: {
  release_record: RunnerReleaseRecord;
  key: SigningKeyHandle;
  signing_time: string;
}): RunnerReleaseVerificationArtifact {
  const signingInput = runnerReleaseSigningInput(input.release_record);
  return {
    release_record: input.release_record,
    signing_input: signingInput,
    signature: signIdentityEnvelope({
      signing_input: signingInput,
      key: input.key,
      signing_time: input.signing_time,
      signing_mode: "managed_key",
      signing_limitations: [SOFTWARE_CUSTODY_LIMITATION]
    })
  };
}

export function verifyRunnerReleaseArtifact(input: {
  artifact: unknown;
  artifact_bytes: Uint8Array;
  trust_anchor_public_key: Uint8Array;
  expected_build_identifier?: string;
  expected_release_identifier?: string;
}): RunnerReleaseVerification {
  if (!isClosedArtifact(input.artifact)) return { ok: false, reason: "release_artifact_malformed" };
  const artifact = input.artifact as RunnerReleaseVerificationArtifact;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:runner-release-record", artifact.release_record).length > 0) {
    return { ok: false, reason: "release_record_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", artifact.signing_input).length > 0) {
    return { ok: false, reason: "release_artifact_malformed" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", artifact.signature).length > 0) {
    return { ok: false, reason: "release_artifact_malformed" };
  }
  if (
    input.expected_build_identifier !== undefined &&
    artifact.release_record.build_identifier !== input.expected_build_identifier
  ) {
    return { ok: false, reason: "release_build_mismatch" };
  }
  if (
    input.expected_release_identifier !== undefined &&
    artifact.release_record.release_identifier !== input.expected_release_identifier
  ) {
    return { ok: false, reason: "release_identifier_mismatch" };
  }
  const artifactDigest = `sha256:${createHash("sha256").update(input.artifact_bytes).digest("hex")}`;
  if (artifact.release_record.artifact_digest !== artifactDigest) {
    return { ok: false, reason: "release_artifact_digest_mismatch" };
  }

  const expectedInput = runnerReleaseSigningInput(artifact.release_record);
  if (canonicalizeProtocolJson(artifact.signing_input) !== canonicalizeProtocolJson(expectedInput)) {
    return { ok: false, reason: "release_signing_input_mismatch" };
  }
  if (
    artifact.signature.protocol_version !== "codeattest.v0" ||
    artifact.signature.algorithm_profile !== "ml_dsa_65" ||
    artifact.signature.signed_identity_type !== "runner_release" ||
    artifact.signature.signed_identity !== expectedInput.signed_identity ||
    artifact.signature.canonicalization !== "rfc8785" ||
    artifact.signature.signing_mode !== "managed_key" ||
    !artifact.signature.signing_limitations.includes(SOFTWARE_CUSTODY_LIMITATION) ||
    !artifact.signature.signature_bytes.startsWith(ML_DSA_65_SIGNATURE_PREFIX)
  ) {
    return { ok: false, reason: "release_signature_invalid" };
  }
  if (input.trust_anchor_public_key.length !== ML_DSA_65_PUBLIC_KEY_BYTES) {
    return { ok: false, reason: "release_trust_anchor_invalid" };
  }
  const signatureBytes = decodeBase64Url(
    artifact.signature.signature_bytes.slice(ML_DSA_65_SIGNATURE_PREFIX.length)
  );
  if (
    signatureBytes === undefined ||
    !verifyMlDsa65(
      input.trust_anchor_public_key,
      signedMessage(canonicalizeProtocolJson(expectedInput)),
      signatureBytes
    )
  ) {
    return { ok: false, reason: "release_signature_invalid" };
  }
  return { ok: true, release_record: artifact.release_record };
}

function isClosedArtifact(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys[0] === "release_record" && keys[1] === "signature" && keys[2] === "signing_input";
}
