import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { importCompiled as importIntake } from "../../intake/test/helpers/compile.mjs";
import { importCompiled as importSigning } from "../../../packages/signing/test/helpers/compile.mjs";
import { directory, keyRecord, TEST_LIMITATIONS } from "../../../packages/signing/test/helpers/test-directory.mjs";
import { passingReceiptRequest } from "../../intake/test/helpers/receipt-fixtures.mjs";

// D2-2's producer/consumer split (prepare in the pure intake tier, sign in
// the host, complete back in the pure tier) is exercised task-by-task
// elsewhere, but nothing runs all three steps against a real signing key end
// to end -- this is that seam, without needing subproject B's HTTP route.
const { createKeyService } = await importCompiled("src/signing/key-service.js");
const { generateMlDsa65KeyPair, encodeBase64Url, signIdentityEnvelope, keyDirectorySigningInput } = await importSigning("src/index.js");
const { prepareVendorReceipt, completeVendorReceipt } = await importIntake("src/index.js");

const anchor = generateMlDsa65KeyPair();
const signer = generateMlDsa65KeyPair();

const shell = directory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })]);
shell.directory_signature = signIdentityEnvelope({
  signing_input: keyDirectorySigningInput(shell),
  key: { key_id: "codeattest-demo-trust-anchor", key_version: "v1", privateKeyPkcs8: anchor.privateKeyPkcs8 },
  signing_time: "2026-01-01T00:00:00Z",
  signing_mode: "managed_key",
  signing_limitations: [...TEST_LIMITATIONS]
});

const key = { key_id: "codeattest-demo-signing-key", key_version: "v1", privateKeyPkcs8: signer.privateKeyPkcs8 };
const keyService = createKeyService({ key, directory: shell, trustAnchorPublicKey: anchor.publicKey });

const request = await passingReceiptRequest();
request.signing = {
  key_id: keyService.key_id,
  key_version: keyService.key_version,
  signing_mode: "managed_key",
  canonicalization: "rfc8785",
  public_key_reference: "fixture:receipt-signing-seam-test-key",
  signing_limitations: [
    "Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.",
    "A valid signature shows which deployment key produced this artifact and says nothing about the completeness or quality of any review."
  ]
};

// Phase one: the pure intake tier computes the identity and hands back
// exactly what a signer needs.
const prepared = await prepareVendorReceipt(request);
assert.equal(prepared.state, "receipt_signing_required");
assert.equal(prepared.unsigned_receipt.public_verification_metadata.signing_mode, "managed_key");
assert.equal(prepared.unsigned_receipt.public_verification_metadata.algorithm_profile, "ml_dsa_65");

// Middle: the host signs with a real key, and independently re-verifies its
// own signature through the same trust-anchor-signed directory a caller
// would resolve the key through.
const receiptSignature = keyService.sign({ signing_input: prepared.signing_input, signing_time: prepared.unsigned_receipt.receipt_timestamp });
assert.equal(receiptSignature.signing_mode, "managed_key");
assert.match(receiptSignature.signature_bytes, /^ml_dsa_65:[A-Za-z0-9_-]{4412}$/);

const outcome = keyService.verifier.verify({ envelope: receiptSignature, signing_input: prepared.signing_input, verified_at: "2026-07-10T00:21:00Z" });
assert.equal(outcome.result, "verified");

// Phase two: the pure intake tier completes the receipt, trusting the
// outcome structurally rather than the envelope's own claims.
const completed = await completeVendorReceipt(prepared, receiptSignature, outcome);
assert.equal(completed.state, "received_with_receipt");
assert.equal(completed.vendor_receipt.receipt_signature.signature_bytes, receiptSignature.signature_bytes);
assert.equal(completed.vendor_receipt.public_verification_metadata.signing_mode, "managed_key");

// A revoked key breaks the seam at the outcome, not at the envelope: the
// same signature bytes, verified against a directory that has since revoked
// the key, is refused -- not silently accepted because the bytes still
// parse. (Unlike the submitted-bundle path, the receipt path collapses every
// key-trust failure to the single generic "receipt_signature_unverified"
// reason rather than forwarding the outcome's specific result -- a known,
// ledger-parked gap, not asserted as fixed here.)
const revokedShell = directory([keyRecord({ public_key: encodeBase64Url(signer.publicKey), status: "revoked" })]);
revokedShell.directory_signature = signIdentityEnvelope({
  signing_input: keyDirectorySigningInput(revokedShell),
  key: { key_id: "codeattest-demo-trust-anchor", key_version: "v1", privateKeyPkcs8: anchor.privateKeyPkcs8 },
  signing_time: "2026-01-02T00:00:00Z",
  signing_mode: "managed_key",
  signing_limitations: [...TEST_LIMITATIONS]
});
const revokedKeyService = createKeyService({ key, directory: revokedShell, trustAnchorPublicKey: anchor.publicKey });
const revokedOutcome = revokedKeyService.verifier.verify({ envelope: receiptSignature, signing_input: prepared.signing_input, verified_at: "2026-07-10T00:21:00Z" });
assert.notEqual(revokedOutcome.result, "verified");
const revokedComplete = await completeVendorReceipt(prepared, receiptSignature, revokedOutcome);
assert.equal(revokedComplete.state, "rejected_no_receipt");
assert.ok(revokedComplete.reason_codes.includes("receipt_signature_unverified"), "a revoked key must never complete a receipt");

console.log("host / intake-service receipt signing seam test passed.");
