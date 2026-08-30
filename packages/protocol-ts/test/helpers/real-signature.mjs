// D3-2: every protocol signature is now a real ML-DSA-65 signature, so tests
// across every workspace need the same two things -- an envelope actually
// signed over a signing input, and the independently produced
// `SignatureVerificationOutcome` that authenticates its bytes. Both live here
// once rather than being re-derived per workspace; consumers import this file
// by relative path, matching how the other cross-workspace test helpers are
// consumed.
//
// This helper deliberately does not compile any TypeScript: it reimplements
// the same three primitives `packages/signing` exports (SPKI wrapping, the
// domain-separated signed message, base64url) directly on `node:crypto`, so
// any test file can import it without a build step. `packages/signing`'s own
// tests are the authority on those primitives; this is a test fixture builder.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import canonicalizeJson from "canonicalize";

// Mirrors SIGNED_MESSAGE_DOMAIN in packages/signing/src/signed-message.ts.
export const SIGNED_MESSAGE_DOMAIN = "codeattest-ml-dsa-65-v1";
// Mirrors SPKI_PREFIX in packages/signing/src/ml-dsa.ts.
const SPKI_PREFIX = Buffer.from("308207b2300b0609608648016503040312038207a100", "hex");
const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;

// Mirrors MANAGED_KEY_LIMITATIONS in services/host/src/signing/key-service.ts
// and RUNNER_SIGNING_LIMITATIONS in runner/crates/local-runner-scaffold/src/keys.rs.
export const MANAGED_KEY_LIMITATIONS = [
  "Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.",
  "A valid signature shows which deployment key produced this artifact and says nothing about the completeness or quality of any review."
];
export const RUNNER_SIGNING_LIMITATIONS = [
  "Key custody is customer-held runner custody; the private key is generated on this machine and never transmitted.",
  "The runner is open source and runs on the customer's own machine, so this signature cannot attest that the runner code was unmodified."
];

export function createTestSigningKey({ key_id = "codeattest-test-signing-key", key_version = "v1" } = {}) {
  const pair = generateKeyPairSync("ml-dsa-65");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  return {
    key_id,
    key_version,
    privateKey: pair.privateKey,
    publicKey: new Uint8Array(spki.subarray(spki.length - ML_DSA_65_PUBLIC_KEY_BYTES))
  };
}

export function signedMessage(signingInput) {
  const canonical = canonicalizeJson(signingInput);
  if (typeof canonical !== "string") throw new Error("signing input must be canonicalizable");
  return Buffer.from(`${SIGNED_MESSAGE_DOMAIN}\n${canonical}`, "utf8");
}

export function identitySigningInput({ signing_input_type, signed_identity_type, signed_identity, identity_input_path }) {
  return {
    protocol_version: "codeattest.v0",
    signing_input_type,
    algorithm_profile: "ml_dsa_65",
    signed_identity_type,
    signed_identity,
    canonicalization: "rfc8785",
    identity_input_path
  };
}

export function realSignatureEnvelope({ signing_input, key, signing_time, signing_mode = "managed_key", signing_limitations }) {
  const limitations = signing_limitations ?? (signing_mode === "enrolled_runner_key" ? RUNNER_SIGNING_LIMITATIONS : MANAGED_KEY_LIMITATIONS);
  const signature = sign(null, signedMessage(signing_input), key.privateKey);
  return {
    protocol_version: signing_input.protocol_version,
    algorithm_profile: "ml_dsa_65",
    key_id: key.key_id,
    key_version: key.key_version,
    signing_time,
    signed_identity_type: signing_input.signed_identity_type,
    signed_identity: signing_input.signed_identity,
    canonicalization: "rfc8785",
    signing_mode,
    signing_limitations: [...limitations],
    signature_bytes: `ml_dsa_65:${signature.toString("base64url")}`
  };
}

export function verifiedOutcome(envelope, { verified_at = "2026-08-16T00:00:00Z", key_directory_version = 1, result = "verified" } = {}) {
  return {
    protocol_version: "codeattest.v0",
    signed_identity_type: envelope.signed_identity_type,
    signed_identity: envelope.signed_identity,
    algorithm_profile: "ml_dsa_65",
    key_id: envelope.key_id,
    key_version: envelope.key_version,
    key_directory_version,
    verified_at,
    result
  };
}

/** Flips one base64url character so the bytes stay schema-valid but no longer verify. */
export function tamperSignatureBytes(signatureBytes) {
  const last = signatureBytes.at(-1);
  return `${signatureBytes.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

export function verifyRealSignature(publicKey, signingInput, signatureBytes) {
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
  return verify(null, signedMessage(signingInput), key, Buffer.from(signatureBytes.slice("ml_dsa_65:".length), "base64url"));
}

export function signingKeyFromPkcs8(privateKeyPkcs8, { key_id, key_version }) {
  return { key_id, key_version, privateKey: createPrivateKey({ key: Buffer.from(privateKeyPkcs8), format: "der", type: "pkcs8" }) };
}
