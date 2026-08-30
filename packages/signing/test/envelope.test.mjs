import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { directory, keyRecord, TEST_LIMITATIONS } from "./helpers/test-directory.mjs";

const { signIdentityEnvelope, createSignatureVerifier, generateMlDsa65KeyPair, encodeBase64Url, publicKeyFromPkcs8, keyDirectorySigningInput } = await importCompiled("src/index.js");

const anchor = generateMlDsa65KeyPair();
const signer = generateMlDsa65KeyPair();

const signingInput = {
  protocol_version: "codeattest.v0",
  signing_input_type: "vendor_receipt_identity",
  algorithm_profile: "ml_dsa_65",
  signed_identity_type: "vendor_receipt",
  signed_identity: `sha256:${"b".repeat(64)}`,
  canonicalization: "rfc8785",
  identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
};

const key = { key_id: "codeattest-demo-signing-key", key_version: "v1", privateKeyPkcs8: signer.privateKeyPkcs8 };

const envelope = signIdentityEnvelope({
  signing_input: signingInput,
  key,
  signing_time: "2026-06-01T00:00:00Z",
  signing_mode: "managed_key",
  signing_limitations: [...TEST_LIMITATIONS]
});

// The envelope restates the signing input, never contradicts it, and carries
// exactly 4412 base64url characters after the algorithm prefix.
assert.equal(envelope.algorithm_profile, "ml_dsa_65");
assert.equal(envelope.signed_identity, signingInput.signed_identity);
assert.equal(envelope.signed_identity_type, "vendor_receipt");
assert.equal(envelope.canonicalization, "rfc8785");
assert.equal(envelope.signing_mode, "managed_key");
assert.equal(envelope.key_id, "codeattest-demo-signing-key");
assert.match(envelope.signature_bytes, /^ml_dsa_65:[A-Za-z0-9_-]{4412}$/);

// The derived public key round-trips from the PKCS#8 private key, which is
// what the boot-time custody self-test in Task 4 depends on.
assert.deepEqual(publicKeyFromPkcs8(signer.privateKeyPkcs8), signer.publicKey);
assert.equal(publicKeyFromPkcs8(new Uint8Array([1, 2, 3])), undefined);

// Sign the directory for real: build the shell, ask the library for its own
// signing input, and let signIdentityEnvelope produce the anchor signature.
function directoryFor(records) {
  const shell = directory(records);
  shell.directory_signature = signIdentityEnvelope({
    signing_input: keyDirectorySigningInput(shell),
    key: { key_id: "codeattest-demo-trust-anchor", key_version: "v1", privateKeyPkcs8: anchor.privateKeyPkcs8 },
    signing_time: "2026-01-01T00:00:00Z",
    signing_mode: "managed_key",
    signing_limitations: [...TEST_LIMITATIONS]
  });
  return shell;
}

const signerPublicKeyText = encodeBase64Url(signer.publicKey);
const trusted = directoryFor([keyRecord({ public_key: signerPublicKeyText })]);
const verifier = createSignatureVerifier({ directory: trusted, trustAnchorPublicKey: anchor.publicKey });
assert.equal(verifier.directoryTrusted, true);

const verifiedAt = "2026-06-01T00:00:01Z";
const ok = verifier.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt });
assert.equal(ok.result, "verified");
assert.equal(ok.signed_identity, signingInput.signed_identity);
assert.equal(ok.key_id, "codeattest-demo-signing-key");
assert.equal(ok.key_version, "v1");
assert.equal(ok.key_directory_version, 1);
assert.equal(ok.verified_at, verifiedAt);
assert.equal(ok.algorithm_profile, "ml_dsa_65");

// Flipping one character of the signature is untrusted bytes, not a crash.
const flipped = envelope.signature_bytes.endsWith("A") ? `${envelope.signature_bytes.slice(0, -1)}B` : `${envelope.signature_bytes.slice(0, -1)}A`;
assert.equal(verifier.verify({ envelope: { ...envelope, signature_bytes: flipped }, signing_input: signingInput, verified_at: verifiedAt }).result, "signature_bytes_untrusted");

// A signature over a different identity is a mismatch before any crypto runs.
const otherInput = { ...signingInput, signed_identity: `sha256:${"c".repeat(64)}` };
assert.equal(verifier.verify({ envelope, signing_input: otherInput, verified_at: verifiedAt }).result, "signature_signing_input_mismatch");

// An unknown key, a revoked key, and an out-of-window key each get their own
// reason -- spec section 7 requires these be distinguishable.
assert.equal(verifier.verify({ envelope: { ...envelope, key_version: "v9" }, signing_input: signingInput, verified_at: verifiedAt }).result, "signature_key_unknown");

const revokedDirectory = directoryFor([keyRecord({ public_key: signerPublicKeyText, status: "revoked" })]);
const revokedVerifier = createSignatureVerifier({ directory: revokedDirectory, trustAnchorPublicKey: anchor.publicKey });
assert.equal(revokedVerifier.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt }).result, "signature_key_revoked");

const expiredDirectory = directoryFor([keyRecord({ public_key: signerPublicKeyText, valid_until: "2026-02-01T00:00:00Z" })]);
const expiredVerifier = createSignatureVerifier({ directory: expiredDirectory, trustAnchorPublicKey: anchor.publicKey });
assert.equal(expiredVerifier.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt }).result, "signature_key_outside_validity_window");

// A directory the anchor did not sign taints every outcome it produces, so a
// tampered directory cannot launder a genuine signature into a trusted one.
const impostor = generateMlDsa65KeyPair();
const untrusted = createSignatureVerifier({ directory: trusted, trustAnchorPublicKey: impostor.publicKey });
assert.equal(untrusted.directoryTrusted, false);
assert.equal(untrusted.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt }).result, "signature_key_directory_untrusted");

// C6: an untrusted outcome must report the directory's *actual* parsed version,
// not a fabricated 1. This unsigned version-7 shell is untrusted (the anchor
// never signed it), yet its key_directory_version must round-trip as 7.
const version7 = directory([keyRecord({ public_key: signerPublicKeyText })], { directory_version: 7 });
const version7Verifier = createSignatureVerifier({ directory: version7, trustAnchorPublicKey: anchor.publicKey });
const version7Outcome = version7Verifier.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt });
assert.equal(version7Verifier.directoryTrusted, false);
assert.equal(version7Outcome.result, "signature_key_directory_untrusted");
assert.equal(version7Outcome.key_directory_version, 7, "untrusted outcome must report the real parsed directory_version, not 1");

// A directory with no parseable version falls back to the schema-minimum
// sentinel 1 rather than crashing; the result still marks it untrusted.
const garbageVerifier = createSignatureVerifier({ directory: {}, trustAnchorPublicKey: anchor.publicKey });
const garbageOutcome = garbageVerifier.verify({ envelope, signing_input: signingInput, verified_at: verifiedAt });
assert.equal(garbageOutcome.result, "signature_key_directory_untrusted");
assert.equal(garbageOutcome.key_directory_version, 1);

// D3-1: the retired synthetic envelope form is never verified by this path.
assert.equal(
  verifier.verify({
    envelope: { ...envelope, algorithm_profile: "ml_dsa_65_demo_pilot", signature_bytes: `synthetic_demo_sha256:${"a".repeat(64)}` },
    signing_input: signingInput,
    verified_at: verifiedAt
  }).result,
  "signature_bytes_untrusted"
);

console.log("envelope test passed.");
