import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildTestServer, syntheticBundle, AUTH_HEADER, REVIEW_ID } from "./helpers/submission-fixtures.mjs";

const { server, deps } = await buildTestServer();
const bundle = await syntheticBundle();

const opened = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {
    bundle_manifest: bundle.bundle_manifest,
    signature_envelope: bundle.signature_envelope,
    customer_approval: bundle.customer_approval,
    approved_outbound_manifest: bundle.approved_outbound_manifest
  }
});

assert.equal(opened.statusCode, 201, opened.body);
const body = opened.json();
assert.equal(body.submission_attempt_id, bundle.bundle_manifest.submission_attempt_id);
assert.equal(body.review_id, REVIEW_ID);
assert.deepEqual(
  [...body.missing_digests].sort(),
  bundle.bundle_manifest.artifact_references.map((reference) => reference.digest).sort(),
  "a fresh attempt is missing every artifact"
);

// Idempotent: re-opening the same attempt returns the same identity, not a conflict.
const reopened = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {
    bundle_manifest: bundle.bundle_manifest,
    signature_envelope: bundle.signature_envelope,
    customer_approval: bundle.customer_approval,
    approved_outbound_manifest: bundle.approved_outbound_manifest
  }
});
assert.equal(reopened.statusCode, 200, reopened.body);
assert.equal(reopened.json().submission_attempt_id, body.submission_attempt_id);

// No credential: default deny, and the body must not name what was missing.
const unauthenticated = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { "content-type": "application/json" },
  payload: { bundle_manifest: bundle.bundle_manifest, signature_envelope: bundle.signature_envelope, customer_approval: bundle.customer_approval, approved_outbound_manifest: bundle.approved_outbound_manifest }
});
assert.equal(unauthenticated.statusCode, 401);
assert.equal(unauthenticated.json().reason_code, "submission_credential_invalid");

// A wrong secret is the same reason code as an unknown key id: no enumeration.
const wrongSecret = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: "Bearer demo-runner-key-1:wrong", "content-type": "application/json" },
  payload: { bundle_manifest: bundle.bundle_manifest, signature_envelope: bundle.signature_envelope, customer_approval: bundle.customer_approval, approved_outbound_manifest: bundle.approved_outbound_manifest }
});
assert.equal(wrongSecret.statusCode, 401);
assert.equal(wrongSecret.json().reason_code, "submission_credential_invalid");

// The credential decides the review; a manifest for a different review is refused.
const foreign = structuredClone(bundle.bundle_manifest);
foreign.manifest_id = `sha256:${createHash("sha256").update("foreign").digest("hex")}`;
const mismatch = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: { bundle_manifest: foreign, signature_envelope: bundle.signature_envelope, customer_approval: bundle.customer_approval, approved_outbound_manifest: bundle.approved_outbound_manifest }
});
assert.equal(mismatch.statusCode, 409);
assert.equal(mismatch.json().reason_code, "submission_manifest_not_expected");

// Schema validation is Ajv against protocol/schemas, not hand-written checks.
const malformed = await server.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: { bundle_manifest: { protocol_version: "codeattest.v0" }, signature_envelope: bundle.signature_envelope, customer_approval: bundle.customer_approval, approved_outbound_manifest: bundle.approved_outbound_manifest }
});
assert.equal(malformed.statusCode, 400);
assert.equal(malformed.json().reason_code, "submission_schema_invalid");

const reference = bundle.bundle_manifest.artifact_references[0];
const bytes = bundle.artifact_bytes_by_digest[reference.digest];

// A digest that does not match the bytes is refused before anything is stored.
const corrupted = await server.inject({
  method: "PUT",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/${reference.digest}`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
  payload: Buffer.concat([Buffer.from(bytes), Buffer.from("tamper")])
});
assert.equal(corrupted.statusCode, 422);
assert.equal(corrupted.json().reason_code, "submission_artifact_digest_mismatch");

// A digest the manifest never declared is refused: the manifest is the allow-list.
const undeclared = await server.inject({
  method: "PUT",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/sha256:${"f".repeat(64)}`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
  payload: Buffer.from("unlisted")
});
assert.equal(undeclared.statusCode, 409);
assert.equal(undeclared.json().reason_code, "submission_artifact_not_in_manifest");

// The happy path stores, and the same PUT twice is a no-op, not an error.
for (const declared of bundle.bundle_manifest.artifact_references) {
  const stored = await server.inject({
    method: "PUT",
    url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/${declared.digest}`,
    headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
    payload: Buffer.from(bundle.artifact_bytes_by_digest[declared.digest])
  });
  assert.equal(stored.statusCode, 200, stored.body);
}
const replay = await server.inject({
  method: "PUT",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/${reference.digest}`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
  payload: Buffer.from(bytes)
});
assert.equal(replay.statusCode, 200);
assert.equal(replay.json().outcome, "already_present");
assert.deepEqual(replay.json().missing_digests, [], "every declared artifact has now been received");

// A credential for a different attempt cannot push bytes into this one.
const otherAttempt = await server.inject({
  method: "PUT",
  url: "/v0/submissions/submission_attempt:never-opened/artifacts/" + reference.digest,
  headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
  payload: Buffer.from(bytes)
});
assert.equal(otherAttempt.statusCode, 404);
assert.equal(otherAttempt.json().reason_code, "submission_attempt_not_found");

// A body over the size limit is refused with a claim-safe reason code.
const tooLarge = await server.inject({
  method: "PUT",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/${reference.digest}`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
  payload: Buffer.alloc(65 * 1024 * 1024)
});
assert.equal(tooLarge.statusCode, 413);
assert.equal(tooLarge.json().reason_code, "submission_artifact_too_large");

// Phase 3: finalize.
const finalized = await server.inject({
  method: "POST",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/finalize`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {}
});
assert.equal(finalized.statusCode, 200, finalized.body);
const outcome = finalized.json().submission_outcome;
assert.equal(outcome.outcome_state, "received_with_receipt");
assert.equal(outcome.next_path, "verify_receipt");
assert.equal(outcome.review_id, REVIEW_ID);
assert.ok(outcome.vendor_receipt_ref.startsWith("sha256:"));

// The review log now carries exactly one receipt_issued event for this attempt.
const events = await deps.reviewEventLog.loadLog(REVIEW_ID);
const issued = events.filter((event) => event.event_type === "receipt_issued");
assert.equal(issued.length, 1);

// Finalizing twice returns the identical stored outcome and appends nothing.
const replayFinalize = await server.inject({
  method: "POST",
  url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/finalize`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {}
});
assert.equal(replayFinalize.statusCode, 200);
assert.deepEqual(replayFinalize.json().submission_outcome, outcome, "a replayed finalize must not mint a second receipt");
assert.equal((await deps.reviewEventLog.loadLog(REVIEW_ID)).length, events.length);

// Finalizing before every artifact has arrived is refused. Artifact bytes
// are content-addressed and already stored under the finalized attempt
// above, so this manifest must declare a digest nothing has ever stored.
const incompleteManifest = structuredClone(bundle.bundle_manifest);
incompleteManifest.submission_attempt_id = "submission_attempt:incomplete-demo";
incompleteManifest.artifact_references[0].digest = `sha256:${"9".repeat(64)}`;
await deps.attempts.open({
  submission_attempt_id: incompleteManifest.submission_attempt_id,
  review_id: REVIEW_ID,
  tenant_id: "tenant-synthetic-demo",
  token_key_id: "demo-runner-key-1",
  manifest_id: incompleteManifest.manifest_id,
  evidence_bundle_id: incompleteManifest.evidence_bundle_id,
  bundle_manifest_body: JSON.stringify(incompleteManifest),
  signature_envelope_body: JSON.stringify(bundle.signature_envelope),
  customer_approval_body: JSON.stringify(bundle.customer_approval),
  approved_outbound_manifest_body: JSON.stringify(bundle.approved_outbound_manifest)
});
const incomplete = await server.inject({
  method: "POST",
  url: `/v0/submissions/${incompleteManifest.submission_attempt_id}/finalize`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {}
});
assert.equal(incomplete.statusCode, 409);
assert.equal(incomplete.json().reason_code, "submission_artifacts_incomplete");

// A rejected submission is a 200 outcome, not a transport error: the runner
// must receive the protocol artifact that explains what happened.
const tamperedManifest = structuredClone(bundle.bundle_manifest);
tamperedManifest.submission_attempt_id = "submission_attempt:tampered-demo";
tamperedManifest.runner.version = "9.9.9-tampered";
await deps.attempts.open({
  submission_attempt_id: tamperedManifest.submission_attempt_id,
  review_id: REVIEW_ID,
  tenant_id: "tenant-synthetic-demo",
  token_key_id: "demo-runner-key-1",
  manifest_id: tamperedManifest.manifest_id,
  evidence_bundle_id: tamperedManifest.evidence_bundle_id,
  bundle_manifest_body: JSON.stringify(tamperedManifest),
  signature_envelope_body: JSON.stringify(bundle.signature_envelope),
  customer_approval_body: JSON.stringify(bundle.customer_approval),
  approved_outbound_manifest_body: JSON.stringify(bundle.approved_outbound_manifest)
});
for (const declared of tamperedManifest.artifact_references) {
  const classification = {
    protocol_version: "codeattest.v0",
    stored_object_ref: `stored_object:${declared.digest.replace(/^sha256:/, "")}`,
    object_kind: "evidence_artifact",
    source_derived_class: declared.source_derived_class,
    environment_profile: "synthetic_demo"
  };
  await deps.artifacts.put({ digest: declared.digest, bytes: bundle.artifact_bytes_by_digest[declared.digest], classification, reviewId: REVIEW_ID });
  await deps.classifications.record(classification);
}
const rejected = await server.inject({
  method: "POST",
  url: `/v0/submissions/${tamperedManifest.submission_attempt_id}/finalize`,
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: {}
});
assert.equal(rejected.statusCode, 200, rejected.body);
assert.equal(rejected.json().submission_outcome.outcome_state, "rejected_no_receipt");
assert.ok(rejected.json().submission_outcome.failure_reason_codes.length >= 1);
assert.equal(rejected.json().submission_outcome.vendor_receipt_ref, undefined);

// The budget guard: at or above 95% intake is disabled regardless of validity.
const { server: broke } = await buildTestServer({ spendRatio: 0.96 });
const overBudget = await broke.inject({
  method: "POST",
  url: "/v0/submissions",
  headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
  payload: { bundle_manifest: bundle.bundle_manifest, signature_envelope: bundle.signature_envelope, customer_approval: bundle.customer_approval, approved_outbound_manifest: bundle.approved_outbound_manifest }
});
assert.equal(overBudget.statusCode, 503);
assert.equal(overBudget.json().reason_code, "submission_intake_disabled");
await broke.close();

await server.close();
console.log("Submissions route phase-1/phase-2/phase-3 test passed.");
