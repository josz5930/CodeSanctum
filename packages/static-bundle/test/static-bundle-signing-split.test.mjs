import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { passingGenerationInput, passingVerificationOutcomes, signStaticBundleRequest } from "./helpers/static-bundle-fixtures.mjs";

const {
  prepareSignedStaticBundle,
  completeSignedStaticBundle
} = await importCompiled("src/index.js");

const input = passingGenerationInput();
const outcomes = passingVerificationOutcomes();

// Phase one produces the manifest and the document to sign, and nothing else.
const prepared = prepareSignedStaticBundle(input, outcomes);
assert.equal(prepared.ok, true);
assert.match(prepared.manifest.static_bundle_manifest_id, /^sha256:[a-f0-9]{64}$/);
assert.equal(prepared.signing_request.signing_input.signed_identity, prepared.manifest.static_bundle_manifest_id);
assert.equal(prepared.signing_request.signing_input.signed_identity_type, "static_bundle_manifest");

// The manifest identity does not depend on the signature, so signing it twice
// with different keys yields two signatures over one identity.
const again = prepareSignedStaticBundle(input, outcomes);
assert.equal(again.manifest.static_bundle_manifest_id, prepared.manifest.static_bundle_manifest_id);

// D3-2: two real ML-DSA-65 signatures over the same signing input are
// different byte strings, and both bind the same manifest identity -- the
// identity can never be recomputed from either one.
const firstSignature = signStaticBundleRequest(prepared.signing_request);
const secondSignature = signStaticBundleRequest(prepared.signing_request);
assert.notEqual(firstSignature.signature_bytes, secondSignature.signature_bytes);
assert.match(firstSignature.signature_bytes, /^ml_dsa_65:[A-Za-z0-9_-]{4412}$/);

// Phase two assembles and re-validates.
const completed = completeSignedStaticBundle(prepared, firstSignature);
assert.equal(completed.ok, true);
assert.equal(completed.signature_envelope.signed_identity, prepared.manifest.static_bundle_manifest_id);
assert.equal(completed.verification_package.signature_attachment.signature_envelope.signed_identity, prepared.manifest.static_bundle_manifest_id);

// Phase two refuses a signature over a different manifest.
const foreign = { ...firstSignature, signed_identity: `sha256:${"3".repeat(64)}` };
const refused = completeSignedStaticBundle(prepared, foreign);
assert.equal(refused.ok, false);

// D3-2: generation input whose embedded Evidence Bundle and Vendor Receipt
// signatures carry no verification outcome cannot be prepared at all -- the
// pure module has no way to authenticate their bytes for itself.
assert.equal(prepareSignedStaticBundle(passingGenerationInput()).ok, false);

console.log("static bundle signing split test passed.");
