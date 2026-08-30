import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { importCompiled as importSigning } from "../../../packages/signing/test/helpers/compile.mjs";
import { directory, keyRecord, TEST_LIMITATIONS } from "../../../packages/signing/test/helpers/test-directory.mjs";

const { createKeyService, MANAGED_KEY_LIMITATIONS } = await importCompiled("src/signing/key-service.js");
const { generateMlDsa65KeyPair, encodeBase64Url, signIdentityEnvelope, keyDirectorySigningInput } = await importSigning("src/index.js");

const anchor = generateMlDsa65KeyPair();
const signer = generateMlDsa65KeyPair();

function signedDirectory(records) {
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

const trustedDirectory = signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })]);
const key = { key_id: "codeattest-demo-signing-key", key_version: "v1", privateKeyPkcs8: signer.privateKeyPkcs8 };

const keyService = createKeyService({ key, directory: trustedDirectory, trustAnchorPublicKey: anchor.publicKey });

assert.equal(keyService.key_id, "codeattest-demo-signing-key");
assert.equal(keyService.key_version, "v1");
assert.equal(keyService.verifier.directoryTrusted, true);

const signingInput = {
  protocol_version: "codeattest.v0",
  signing_input_type: "vendor_receipt_identity",
  algorithm_profile: "ml_dsa_65",
  signed_identity_type: "vendor_receipt",
  signed_identity: `sha256:${"b".repeat(64)}`,
  canonicalization: "rfc8785",
  identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
};
const signingTime = "2026-06-01T00:00:00Z";

const envelope = keyService.sign({ signing_input: signingInput, signing_time: signingTime });

// `sign` produces a real (not synthetic) managed_key envelope carrying the
// service's own declared limitations.
assert.equal(envelope.signing_mode, "managed_key");
assert.equal(envelope.algorithm_profile, "ml_dsa_65");
assert.equal(envelope.key_id, "codeattest-demo-signing-key");
assert.equal(envelope.key_version, "v1");
assert.equal(envelope.signed_identity, signingInput.signed_identity);
assert.deepEqual(envelope.signing_limitations, MANAGED_KEY_LIMITATIONS);

// The service's own verifier verifies what its own sign produced -- this is
// the same pairing `completeVendorReceipt` depends on: a signing key with no
// way to check its own work would be unable to ever produce a
// `SignatureVerificationOutcome` a real receipt could complete with.
const outcome = keyService.verifier.verify({ envelope, signing_input: signingInput, verified_at: "2026-06-01T00:00:01Z" });
assert.equal(outcome.result, "verified");
assert.equal(outcome.signed_identity, signingInput.signed_identity);
assert.equal(outcome.key_id, "codeattest-demo-signing-key");
assert.equal(outcome.key_version, "v1");
assert.equal(outcome.algorithm_profile, "ml_dsa_65");

// A signature that declares itself fake while actually being a real ML-DSA-65
// signature is exactly the failure mode spec section 8.1 describes -- the
// limitations text must never say so, unlike the synthetic-demo path.
for (const limitation of MANAGED_KEY_LIMITATIONS) {
  assert.equal(limitation.toLowerCase().includes("not a production ml-dsa signature"), false, `managed-key limitation must not disclaim a real signature as fake: "${limitation}"`);
}

console.log("key service test passed.");
