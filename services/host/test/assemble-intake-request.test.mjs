import assert from "node:assert/strict";
import { importCompiled } from "./helpers/compile.mjs";
import { syntheticBundle, syntheticCredential, syntheticGate, testKeyService } from "./helpers/submission-fixtures.mjs";

const { assembleIntakeRequest } = await importCompiled("src/submission/assemble-intake-request.js");

const bundle = await syntheticBundle();
const credential = await syntheticCredential();
const keyService = await testKeyService();

const request = assembleIntakeRequest({
  attempt: {
    submission_attempt_id: bundle.bundle_manifest.submission_attempt_id,
    review_id: credential.review_id,
    tenant_id: credential.tenant_id,
    token_key_id: credential.token_key_id,
    manifest_id: bundle.bundle_manifest.manifest_id,
    evidence_bundle_id: bundle.bundle_manifest.evidence_bundle_id,
    bundle_manifest_body: JSON.stringify(bundle.bundle_manifest),
    signature_envelope_body: JSON.stringify(bundle.signature_envelope),
    customer_approval_body: JSON.stringify(bundle.customer_approval),
    approved_outbound_manifest_body: JSON.stringify(bundle.approved_outbound_manifest)
  },
  credential,
  presentedSecret: "synthetic-demo-submission-secret",
  artifactBytesByRef: bundle.artifact_bytes_by_ref,
  gate: await syntheticGate(),
  spendRatio: 0.1,
  keyService,
  verifiedAt: "2026-08-16T12:00:00Z"
});

// The authenticated context is built from the credential, never from the
// body: a runner cannot choose which review or which application it submits
// into. `review_request_id` carries the same credential-sourced suffix as
// `review_id`, adapted to intake's own `review_request:` identity grammar.
assert.equal(request.authenticated_context.review_request_id, `review_request:${credential.review_id.replace(/^review:/, "")}`);
assert.equal(request.authenticated_context.customer_id, credential.customer_id);
assert.equal(request.submission_token_expectation.token_key_id, credential.token_key_id);
assert.equal(request.submission_token.token_secret_material, "synthetic-demo-submission-secret");
assert.equal(request.submission_token_expectation.token_secret_material, "synthetic-demo-submission-secret");
assert.equal(request.environment_evidence_gate.environment_profile, "synthetic_demo");
assert.equal(request.demo_budget_enforcement.spend_ratio, 0.1);
assert.deepEqual(
  Object.keys(request.artifact_bytes_by_ref).sort(),
  bundle.bundle_manifest.artifact_references.map((r) => r.artifact_ref).sort()
);

// The host independently re-verifies the submitted bundle's real ML-DSA-65
// signature against the boot-bound key directory rather than trusting the
// manifest's own claim about it.
assert.equal(request.signature_verification_outcome.result, "verified");
assert.equal(request.signature_verification_outcome.signed_identity, bundle.bundle_manifest.evidence_bundle_id);

// A tampered signature is refused, not silently accepted.
const tampered = assembleIntakeRequest({
  attempt: {
    submission_attempt_id: bundle.bundle_manifest.submission_attempt_id,
    review_id: credential.review_id,
    tenant_id: credential.tenant_id,
    token_key_id: credential.token_key_id,
    manifest_id: bundle.bundle_manifest.manifest_id,
    evidence_bundle_id: bundle.bundle_manifest.evidence_bundle_id,
    bundle_manifest_body: JSON.stringify(bundle.bundle_manifest),
    signature_envelope_body: JSON.stringify({ ...bundle.signature_envelope, signed_identity: `sha256:${"f".repeat(64)}` }),
    customer_approval_body: JSON.stringify(bundle.customer_approval),
    approved_outbound_manifest_body: JSON.stringify(bundle.approved_outbound_manifest)
  },
  credential,
  presentedSecret: "synthetic-demo-submission-secret",
  artifactBytesByRef: bundle.artifact_bytes_by_ref,
  gate: await syntheticGate(),
  spendRatio: 0.1,
  keyService,
  verifiedAt: "2026-08-16T12:00:00Z"
});
assert.notEqual(tampered.signature_verification_outcome.result, "verified");

console.log("Intake request assembly test passed.");
