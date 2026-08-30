import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifiedOutcome as receiptOutcomeFor } from "../../../packages/protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-attestation-finalization-outcome-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-attestation-finalization-outcome-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const cp = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);

  const [
    attestation,
    receipt,
    deletion,
    portal,
    finalizationBase,
    generatedManifest,
    generatedSigningInput,
    generatedSignature,
    finalizedManifest,
    finalizedSigningInput,
    finalizedSignature
  ] = await Promise.all([
    fixture("security-review-attestation.json"),
    fixture("vendor-receipt.json"),
    fixture("deletion-evidence.json"),
    fixture("static-portal-projection.json"),
    fixture("attestation-package-finalization.json"),
    fixture("static-bundle-manifest.generated.json"),
    signingFixture("static-bundle-manifest-identity.json"),
    fixture("signature-envelope.static-bundle.json"),
    fixture("static-bundle-manifest.finalized.json"),
    signingFixture("static-bundle-manifest-finalized-identity.json"),
    fixture("signature-envelope.static-bundle-finalized.json")
  ]);

  // D2-8: a hand-built `attestation_generated` history event, matching
  // exactly what `buildAttestationGeneratedEvent` would emit for this
  // attestation fixture -- built directly (bypassing the full addendum/
  // classification/validation context `buildSecurityReviewAttestation`
  // requires) since finalization's own reference check
  // (`rejectionForAttestationPackageFinalization`) only needs a schema-valid,
  // correctly identified history event, not a record of how it was produced.
  const attestationEventDraft = {
    protocol_version: "codeattest.v0",
    event_id: zeroId(),
    review_id: attestation.review_id,
    sequence_number: 20,
    idempotency_key: `attestation:${attestation.review_id}:${attestation.attestation_id}:attestation_version:${attestation.attestation_version}`,
    event_type: "attestation_generated",
    actor: attestation.generated_by,
    event_timestamp: attestation.generated_at,
    artifact_refs: [`artifact_ref:${attestation.attestation_id.slice("attestation:".length)}`],
    visibility: "customer_facing",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    source_derived_class: "retained_review_artifact",
    reason: "Security Review Attestation generated from retained protocol records and append-only review history."
  };
  const sealedAttestationEvent = { ...attestationEventDraft, event_id: await cp.computeReviewEventId(attestationEventDraft) };

  const baseContext = {
    attestation,
    vendor_receipt: receipt,
    generated_manifest: generatedManifest,
    generated_manifest_signing_input: generatedSigningInput,
    generated_manifest_signature: generatedSignature,
    finalized_manifest: finalizedManifest,
    finalized_manifest_signing_input: finalizedSigningInput,
    finalized_manifest_signature: finalizedSignature,
    portal_projection: portal,
    deletion_evidence: [deletion],
    history_events: [sealedAttestationEvent]
  };

  // D3-2: every signature here is a real ML-DSA-65 signature the control
  // plane cannot verify for itself, so an outcome is required for each.
  const receiptOutcome = receiptOutcomeFor(receipt.receipt_signature);
  const managedKeyContext = baseContext;

  // Case 1: no `signature_verification_outcomes` at all must fail closed --
  // this pure module holds no key material and must never fall back to
  // trusting the raw signature bytes.
  assertRejected(cp.buildAttestationPackageFinalization(finalizationBase, baseContext), "attestation_finalization_receipt_invalid");

  // Case 2: a receipt outcome alone is not enough; the two manifest
  // signatures need their own.
  assertRejected(
    cp.buildAttestationPackageFinalization(finalizationBase, { ...managedKeyContext, signature_verification_outcomes: { vendor_receipt: receiptOutcome } }),
    "attestation_finalization_signature_invalid"
  );

  const verifiedGeneratedOutcome = outcomeFor(generatedManifest.static_bundle_manifest_id, generatedSignature);
  const verifiedFinalizedOutcome = outcomeFor(finalizedManifest.static_bundle_manifest_id, finalizedSignature);

  // Case 3: an outcome naming a different manifest identity than the one
  // actually signed must be rejected, not trusted because `result` says
  // "verified".
  const wrongManifestOutcome = { ...verifiedGeneratedOutcome, signed_identity: `sha256:${"7".repeat(64)}` };
  assertRejected(
    cp.buildAttestationPackageFinalization(finalizationBase, {
      ...managedKeyContext,
      signature_verification_outcomes: { generated_manifest: wrongManifestOutcome, finalized_manifest: verifiedFinalizedOutcome, vendor_receipt: receiptOutcome }
    }),
    "attestation_finalization_signature_invalid"
  );

  // Case 4: an outcome that is correctly bound but reports a revoked key
  // must be rejected -- `result !== "verified"` must fail closed regardless
  // of how well-bound the rest of the outcome is.
  const revokedOutcome = { ...verifiedGeneratedOutcome, result: "signature_key_revoked" };
  assertRejected(
    cp.buildAttestationPackageFinalization(finalizationBase, {
      ...managedKeyContext,
      signature_verification_outcomes: { generated_manifest: revokedOutcome, finalized_manifest: verifiedFinalizedOutcome, vendor_receipt: receiptOutcome }
    }),
    "attestation_finalization_signature_invalid"
  );

  // Case 5: matching, correctly bound, verified outcomes for all three
  // signatures let finalization succeed.
  const verified = cp.buildAttestationPackageFinalization(finalizationBase, {
    ...managedKeyContext,
    signature_verification_outcomes: { generated_manifest: verifiedGeneratedOutcome, finalized_manifest: verifiedFinalizedOutcome, vendor_receipt: receiptOutcome }
  });
  assert(verified.outcome === "projected", `finalization with matching verified outcomes must project: ${JSON.stringify(verified)}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
console.log("attestation finalization outcome tests passed.");

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs", name), "utf8")); }
function zeroId() { return `sha256:${"0".repeat(64)}`; }

function outcomeFor(manifestId, signature) {
  return {
    protocol_version: "codeattest.v0",
    signed_identity_type: "static_bundle_manifest",
    signed_identity: manifestId,
    algorithm_profile: signature.algorithm_profile,
    key_id: signature.key_id,
    key_version: signature.key_version,
    key_directory_version: 1,
    verified_at: signature.signing_time,
    result: "verified"
  };
}

function assertRejected(result, reason) {
  assert(result.outcome === "rejected", `expected rejected/${reason}, got ${JSON.stringify(result)}`);
  assert(result.reason === reason, `expected ${reason}, got ${result.reason}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
