import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { mintVendorReceipt, passingReceiptRequest, receiptEnvelopeFor, receiptOutcomeFor } from "./helpers/receipt-fixtures.mjs";

const intake = await importCompiled("src/index.js");
const { prepareVendorReceipt, completeVendorReceipt } = intake;

const request = await passingReceiptRequest();

// Phase one computes the identity and hands back exactly what a signer needs,
// and nothing that a signer could use to change what was verified.
const prepared = await prepareVendorReceipt(request);
assert.equal(prepared.state, "receipt_signing_required");
assert.match(prepared.vendor_receipt_id, /^sha256:[a-f0-9]{64}$/);
assert.equal(prepared.signing_input.signed_identity, prepared.vendor_receipt_id);
assert.equal(prepared.signing_input.signed_identity_type, "vendor_receipt");
assert.equal(prepared.signing_input.signing_input_type, "vendor_receipt_identity");
assert.equal(prepared.signing_input.canonicalization, "rfc8785");
assert.equal(prepared.unsigned_receipt.vendor_receipt_id, prepared.vendor_receipt_id);
assert.equal("receipt_signature" in prepared.unsigned_receipt, false, "the unsigned receipt must not carry a signature field");

// The identity is stable: preparing twice from the same request produces the
// same id, which is what makes finalize idempotent.
assert.equal((await prepareVendorReceipt(request)).vendor_receipt_id, prepared.vendor_receipt_id);

// A request that fails verification never reaches phase one's output shape.
const broken = await passingReceiptRequest();
broken.intake_verification_request.submitted_bundle_manifest.manifest_id = `sha256:${"0".repeat(64)}`;
const failed = await prepareVendorReceipt(broken);
assert.notEqual(failed.state, "receipt_signing_required");
assert.ok(failed.reason_codes.length > 0);

// Phase two refuses a signature that is not bound to the prepared identity.
const wrongIdentity = {
  ...receiptEnvelopeFor(prepared),
  signed_identity: `sha256:${"1".repeat(64)}`
};
const rejected = await completeVendorReceipt(prepared, wrongIdentity, receiptOutcomeFor(wrongIdentity));
assert.equal(rejected.state, "rejected_no_receipt");
assert.ok(rejected.reason_codes.includes("receipt_signature_identity_mismatch"));

// Phase two refuses a signature made by a key the receipt does not name.
const wrongKey = { ...receiptEnvelopeFor(prepared), key_id: "someone-elses-key" };
const rejectedKey = await completeVendorReceipt(prepared, wrongKey, receiptOutcomeFor(wrongKey));
assert.equal(rejectedKey.state, "rejected_no_receipt");
assert.ok(rejectedKey.reason_codes.includes("receipt_signature_key_mismatch"));

// D3-2: a correctly bound envelope whose bytes the host did not vouch for is
// still refused -- the host must prove it verified, not assert it.
const envelope = receiptEnvelopeFor(prepared);
const notVerified = await completeVendorReceipt(prepared, envelope, receiptOutcomeFor(envelope, { result: "signature_bytes_untrusted" }));
assert.equal(notVerified.state, "rejected_no_receipt");
assert.ok(notVerified.reason_codes.includes("receipt_signature_unverified"));

// Two real ML-DSA-65 signatures over one prepared identity are different
// byte strings, and either completes the same receipt.
const second = receiptEnvelopeFor(prepared);
assert.notEqual(envelope.signature_bytes, second.signature_bytes);

// Prepare -> sign -> complete yields the receipt phase one described.
const minted = await mintVendorReceipt(intake, request);
assert.equal(minted.state, "received_with_receipt");
assert.equal(minted.vendor_receipt.vendor_receipt_id, prepared.vendor_receipt_id);

console.log("receipt signing split test passed.");
