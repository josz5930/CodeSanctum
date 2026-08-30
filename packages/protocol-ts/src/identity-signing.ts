import type { IdentitySigningInput, SignatureEnvelope, SignatureVerificationOutcome } from "./generated/protocol-v0.js";
import { canonicalizeProtocolJson } from "./canonical-identity.js";
import { validateProtocolSchema } from "./validation.js";

export type IdentitySignatureExpectation = {
  protocol_version: "codeattest.v0";
  signing_input_type: IdentitySigningInput["signing_input_type"];
  signed_identity_type: IdentitySigningInput["signed_identity_type"];
  signed_identity: string;
  identity_input_path: string;
  key_id: string;
  key_version: string;
  signing_time: string;
};

export function createIdentitySigningInput(expectation: IdentitySignatureExpectation): IdentitySigningInput {
  return {
    protocol_version: expectation.protocol_version,
    signing_input_type: expectation.signing_input_type,
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: expectation.signed_identity_type,
    signed_identity: expectation.signed_identity,
    canonicalization: "rfc8785",
    identity_input_path: expectation.identity_input_path
  };
}

/**
 * The signing input half of `signatureEnvelopeMatchesExpectation`: schema-valid
 * and byte-identical (RFC 8785) to the input the expectation describes. Split
 * out for callers that display or ship a signing input without holding the
 * envelope it belongs to.
 */
export function signingInputMatchesExpectation(signingInput: unknown, expectation: IdentitySignatureExpectation): boolean {
  try {
    if (validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", signingInput).length > 0) return false;
    return canonicalizeProtocolJson(signingInput) === canonicalizeProtocolJson(createIdentitySigningInput(expectation));
  } catch {
    return false;
  }
}

/**
 * D3-2: everything the retired synthetic signature verification checked except
 * the signature bytes -- both documents schema-valid, the supplied signing
 * input byte-identical (RFC 8785) to the one the expectation describes, and
 * every envelope field bound to that same expectation.
 *
 * The bytes are deliberately not checked here. A synthetic signature could be
 * recomputed from its own inputs; a real ML-DSA-65 signature cannot be, and no
 * pure module in this repository holds key material. "Are these bytes good" is
 * answered separately by an independently produced
 * `SignatureVerificationOutcome` -- see `signatureOutcomeCovers`.
 */
export function signatureEnvelopeMatchesExpectation(signingInput: unknown, envelope: unknown, expectation: IdentitySignatureExpectation): boolean {
  try {
    if (!signingInputMatchesExpectation(signingInput, expectation)) return false;
    if (validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", envelope).length > 0) return false;
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) return false;
    const signature = envelope as SignatureEnvelope;
    return signature.protocol_version === expectation.protocol_version &&
      signature.algorithm_profile === "ml_dsa_65" &&
      signature.key_id === expectation.key_id &&
      signature.key_version === expectation.key_version &&
      signature.signing_time === expectation.signing_time &&
      signature.signed_identity_type === expectation.signed_identity_type &&
      signature.signed_identity === expectation.signed_identity &&
      signature.canonicalization === "rfc8785";
  } catch {
    return false;
  }
}

/**
 * D2-1/D3-2: a verification outcome is untrusted *input*, so every claim it
 * makes is bound back to the envelope it is supposed to describe. A caller who
 * could hand in any "verified"-looking outcome for an unrelated artifact would
 * have replaced signature verification with an honour system.
 */
export function signatureOutcomeCovers(envelope: SignatureEnvelope, outcome: SignatureVerificationOutcome | undefined): boolean {
  return outcome !== undefined &&
    outcome.result === "verified" &&
    outcome.signed_identity === envelope.signed_identity &&
    outcome.signed_identity_type === envelope.signed_identity_type &&
    outcome.key_id === envelope.key_id &&
    outcome.key_version === envelope.key_version &&
    outcome.algorithm_profile === envelope.algorithm_profile;
}
