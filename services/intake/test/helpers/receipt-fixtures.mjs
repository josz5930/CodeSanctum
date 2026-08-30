import canonicalizeJson from "canonicalize";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MANAGED_KEY_LIMITATIONS, RUNNER_SIGNING_LIMITATIONS, createTestSigningKey, identitySigningInput, realSignatureEnvelope, verifiedOutcome } from "../../../../packages/protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const validFixtureRoot = path.join(fixtureRoot, "v0", "valid");
export const receiptTimestamp = "2026-07-10T00:20:00Z";

// D3-2: every signature these fixtures build is a real ML-DSA-65 signature.
// Two per-run keys stand in for the two surviving signing modes: the
// deployment's managed key (vendor receipts) and a customer-held runner key
// (evidence bundles).
const receiptSigningKey = createTestSigningKey({ key_id: "codeattest-vendor-receipt-test-key", key_version: "v1" });
const runnerSigningKey = createTestSigningKey({ key_id: "codeattest-runner-synthetic-demo", key_version: "v1" });

// Shared across every intake test that needs a passing
// `VendorReceiptGenerationRequest` -- kept here so no test builds its own
// second copy of this fixture.
export async function passingReceiptRequest() {
  const intakeRequest = await createAcceptedIntakeRequest();
  const approvedArtifactCountSummary = artifactCountSummaryFromManifest(intakeRequest.approved_outbound_manifest);
  return {
    intake_verification_request: intakeRequest,
    receipt_timestamp: receiptTimestamp,
    signing: {
      key_id: receiptSigningKey.key_id,
      key_version: receiptSigningKey.key_version,
      signing_mode: "managed_key",
      canonicalization: "rfc8785",
      public_key_reference: "fixture:vendor-receipt-managed-key-public-key",
      signing_limitations: [...MANAGED_KEY_LIMITATIONS]
    },
    approved_artifact_count_summary: approvedArtifactCountSummary,
    received_artifact_count_summary: structuredClone(approvedArtifactCountSummary)
  };
}

// D3-2: intake no longer signs anything, so a test that wants to exercise
// `completeVendorReceipt` plays the deployment's signer: it signs the
// prepared receipt's own `signing_input` with a per-run ML-DSA-65 key whose
// key_id/key_version are the ones `passingReceiptRequest()` declares.
export function receiptEnvelopeFor(prepared) {
  return realSignatureEnvelope({
    signing_input: prepared.signing_input,
    key: { key_id: prepared.unsigned_receipt.public_verification_metadata.key_id, key_version: prepared.unsigned_receipt.public_verification_metadata.key_version, privateKey: receiptSigningKey.privateKey },
    signing_time: prepared.unsigned_receipt.receipt_timestamp,
    signing_mode: prepared.unsigned_receipt.public_verification_metadata.signing_mode,
    signing_limitations: [...prepared.unsigned_receipt.public_verification_metadata.signing_limitations]
  });
}

// D3-2: the one-call `generateVendorReceipt` could only exist while intake
// could sign for itself. Tests that exercised the whole mint drive the
// prepare -> sign -> complete triple through this helper instead, playing the
// deployment's signer in the middle step.
export async function mintVendorReceipt(intake, request) {
  const prepared = await intake.prepareVendorReceipt(request);
  if (prepared.state !== "receipt_signing_required") {
    return prepared;
  }
  const envelope = receiptEnvelopeFor(prepared);
  return intake.completeVendorReceipt(prepared, envelope, receiptOutcomeFor(envelope));
}

// The independently produced outcome that authenticates a receipt envelope's
// bytes -- `completeVendorReceipt` requires it and binds every field back to
// the envelope, so it is derived from that envelope here.
export function receiptOutcomeFor(envelope, overrides = {}) {
  return { ...verifiedOutcome(envelope), ...overrides };
}

// Cached once so `passingIntakeRequest()` can stay synchronous for tests
// that build several small variations inline without awaiting each one.
const acceptedIntakeRequestTemplate = await createAcceptedIntakeRequest();

// Shared across every intake test that needs a passing
// `IntakeVerificationRequest` -- a fresh deep clone per call so no test's
// mutations leak into another's.
export function passingIntakeRequest() {
  return structuredClone(acceptedIntakeRequestTemplate);
}

// D2-7 / D3-2: builds a real `enrolled_runner_key` bundle signature -- a
// customer-held runner key, not the deployment's own key -- genuinely signed
// over the evidence bundle's identity signing input. Intake never inspects
// the bytes itself; the host-supplied `SignatureVerificationOutcome` is what
// it reasons about (spec S6.2). The `signing_limitations` text satisfies
// intake's two content checks: it names "runner custody" (one of the two
// accepted custody phrases, alongside "key custody"), and separately explains
// why the runner can never attest to the completeness of a review.
export function realBundleSignatureFor(bundleId) {
  return realSignatureEnvelope({
    signing_input: identitySigningInput({ signing_input_type: "bundle_manifest_identity", signed_identity_type: "evidence_bundle", signed_identity: bundleId, identity_input_path: "v0/valid/bundle-manifest.identity-input.json" }),
    key: runnerSigningKey,
    signing_time: "2026-06-01T00:00:00Z",
    signing_mode: "enrolled_runner_key",
    signing_limitations: [...RUNNER_SIGNING_LIMITATIONS]
  });
}

// The outcome intake requires for a bundle signature, bound to that envelope.
export function bundleSignatureOutcomeFor(envelope, overrides = {}) {
  return { ...verifiedOutcome(envelope), ...overrides };
}

async function createAcceptedIntakeRequest() {
  const submittedBundleManifest = await readFixtureJson("bundle-manifest.json");
  const approvedOutboundManifest = await readFixtureJson("outbound-manifest.json");
  const customerApproval = await readFixtureJson("customer-approval.approved.json");
  const environmentEvidenceGate = await readFixtureJson("environment-evidence-gate.synthetic-demo.json");
  submittedBundleManifest.runner.version = approvedOutboundManifest.runner.version;
  const expectedManifestId = canonicalIdentity(approvedOutboundManifest, "manifest_id");
  assert(approvedOutboundManifest.manifest_id === expectedManifestId, "accepted fixture outbound manifest_id must match canonical identity");
  customerApproval.manifest_id = approvedOutboundManifest.manifest_id;
  customerApproval.displayed_context.manifest_id = approvedOutboundManifest.manifest_id;
  submittedBundleManifest.manifest_id = approvedOutboundManifest.manifest_id;
  submittedBundleManifest.verification_metadata.approved_manifest_id = approvedOutboundManifest.manifest_id;
  const artifactBytesByRef = {};

  for (const artifact of submittedBundleManifest.artifact_references) {
    if (typeof artifact.content_path === "string") {
      const bytes = await readFile(path.join(fixtureRoot, artifact.content_path));
      artifactBytesByRef[artifact.artifact_ref] = bytes;
      artifact.digest = digestBytes(bytes);
      artifact.size_bytes = bytes.byteLength;
    }
  }
  submittedBundleManifest.evidence_bundle_id = canonicalIdentity(submittedBundleManifest, "evidence_bundle_id");
  // D3-2: the committed `signature-envelope.bundle.json` signs the committed
  // bundle manifest; this request recomputes the bundle identity from the
  // fixture bytes on disk, so the envelope has to be re-signed over that
  // recomputed identity rather than reused.
  const signatureEnvelope = realBundleSignatureFor(submittedBundleManifest.evidence_bundle_id);

  return {
    submitted_bundle_manifest: submittedBundleManifest,
    signature_envelope: signatureEnvelope,
    signature_verification_outcome: bundleSignatureOutcomeFor(signatureEnvelope),
    artifact_bytes_by_ref: artifactBytesByRef,
    customer_approval: customerApproval,
    approved_outbound_manifest: approvedOutboundManifest,
    environment_evidence_gate: environmentEvidenceGate,
    demo_budget_enforcement: { spend_ratio: 0.1 },
    authenticated_context: {
      customer_id: "customer:synthetic-demo",
      review_request_id: "review_request:synthetic-demo",
      selected_application_id: approvedOutboundManifest.selected_scope_summary.selected_application.application_id,
      selected_commit: approvedOutboundManifest.selected_scope_summary.selected_commit.commit_sha,
      repository_identity_hash: approvedOutboundManifest.selected_scope_summary.repository_identity
    },
    submission_token: {
      token_key_id: "runner-token:synthetic-demo",
      token_secret_material: "synthetic-token-secret"
    },
    submission_token_expectation: {
      customer_id: "customer:synthetic-demo",
      review_request_id: "review_request:synthetic-demo",
      selected_application_id: approvedOutboundManifest.selected_scope_summary.selected_application.application_id,
      selected_commit: approvedOutboundManifest.selected_scope_summary.selected_commit.commit_sha,
      repository_identity_hash: approvedOutboundManifest.selected_scope_summary.repository_identity,
      expected_manifest_id: approvedOutboundManifest.manifest_id,
      expected_evidence_bundle_id: submittedBundleManifest.evidence_bundle_id,
      token_key_id: "runner-token:synthetic-demo",
      token_secret_material: "synthetic-token-secret"
    }
  };
}

async function readFixtureJson(fileName) {
  return JSON.parse(await readFile(path.join(validFixtureRoot, fileName), "utf8"));
}

function artifactCountSummaryFromManifest(manifest) {
  const categories = manifest.evidence_categories.map((category) => ({
    category: category.category,
    count: category.count
  }));
  return {
    count_domain: "evidence_category_counts",
    total_count: categories.reduce((sum, category) => sum + category.count, 0),
    categories
  };
}

function canonicalIdentity(value, excludedField) {
  const identityInput = JSON.parse(JSON.stringify(value));
  delete identityInput[excludedField];
  const canonical = canonicalizeJson(identityInput);
  return digestBytes(canonical);
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
