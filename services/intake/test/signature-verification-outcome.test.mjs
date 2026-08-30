import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { bundleSignatureOutcomeFor, passingIntakeRequest, realBundleSignatureFor } from "./helpers/receipt-fixtures.mjs";

const { verifyIntakeSubmission } = await importCompiled("src/index.js");

function realRequest(outcomeOverrides = {}, envelopeOverrides = {}) {
  const request = passingIntakeRequest();
  const bundleId = request.submitted_bundle_manifest.evidence_bundle_id;
  request.signature_envelope = { ...realBundleSignatureFor(bundleId), ...envelopeOverrides };
  request.signature_verification_outcome = bundleSignatureOutcomeFor(request.signature_envelope, { verified_at: "2026-06-01T00:00:00Z", ...outcomeOverrides });
  return request;
}

// A real, verified runner signature is accepted.
{
  const result = await verifyIntakeSubmission(realRequest());
  assert.equal(result.state, "verified_receipt_eligible");
}

// D3-1: the manifest's declared `bundle_signing_mode` must equal the mode the
// signature was actually made in.
{
  const result = await verifyIntakeSubmission(realRequest({}, { signing_mode: "managed_key" }));
  assert.notEqual(result.state, "verified_receipt_eligible");
  assert.ok(result.reason_codes.includes("unsupported_signature_mode"));
}

// A real signature with no outcome at all is refused: intake never assumes.
{
  const request = realRequest();
  delete request.signature_verification_outcome;
  const result = await verifyIntakeSubmission(request);
  assert.notEqual(result.state, "verified_receipt_eligible");
  assert.ok(result.reason_codes.includes("signature_bytes_untrusted"));
}

// Each key-trust failure surfaces as its own reason code, unchanged, so a
// customer-facing outcome can say which of them happened.
for (const result of ["signature_key_unknown", "signature_key_revoked", "signature_key_outside_validity_window", "signature_key_directory_untrusted", "signature_signing_input_mismatch", "signature_bytes_untrusted"]) {
  const outcome = await verifyIntakeSubmission(realRequest({ result }));
  assert.notEqual(outcome.state, "verified_receipt_eligible");
  assert.ok(outcome.reason_codes.includes(result), `${result} must reach the caller verbatim`);
  assert.match(result, /^[a-z][a-z0-9_]{2,63}$/);
}

// An outcome that describes a different artifact is not evidence about this
// one, however verified it claims to be.
{
  const result = await verifyIntakeSubmission(realRequest({ signed_identity: `sha256:${"9".repeat(64)}` }));
  assert.notEqual(result.state, "verified_receipt_eligible");
  assert.ok(result.reason_codes.includes("signature_bytes_untrusted"));
}

// Nor is an outcome about a different key.
{
  const result = await verifyIntakeSubmission(realRequest({ key_id: "someone-elses-key" }));
  assert.notEqual(result.state, "verified_receipt_eligible");
  assert.ok(result.reason_codes.includes("signature_key_mismatch"));
}

console.log("intake signature verification outcome test passed.");
