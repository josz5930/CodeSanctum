import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  IdentitySigningInput,
  SecurityReviewAttestation,
  SignatureEnvelope,
  StaticBundleManifest
} from "../../../../packages/protocol-ts/src/index.js";
import type { SignatureVerifier } from "../../../../packages/signing/src/index.js";

import type { SeedableReviewRecordStore } from "./record-store.js";

/**
 * The single review scope the shipped synthetic-demo fixtures describe. It
 * mirrors `SEEDED.reviewInScope` in the host test fixtures so a demo grant
 * scoped to this review resolves to seeded content.
 */
export const SYNTHETIC_DEMO_REVIEW_SCOPE = "review:synthetic-demo-0001";

export type SeedSyntheticDemoDeps = {
  /** Absolute path to `protocol/fixtures/v0` (resolved by the caller so this
   *  module is location-independent and works from a compiled test cache). */
  fixturesRoot: string;
  /** The host's real signature verifier. The static-bundle sub-view is seeded
   *  only when this actually verifies the shipped signature; it never fabricates
   *  a "verified" outcome. */
  verifier: SignatureVerifier;
  /** RFC 3339 verification timestamp recorded in a produced outcome. */
  verifiedAt: string;
};

function loadJson(root: string, ...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(root, ...segments), "utf8"));
}

/**
 * The pre-action confirmation payload the attestation-finalization view expects.
 * It is synthesized from the manifest and attestation (not a stored protocol
 * record), matching how `@onevps/ui`'s own Epic-5 test and the host test
 * fixtures build it.
 */
function finalizationContextFor(manifest: StaticBundleManifest, attestation: SecurityReviewAttestation): Record<string, unknown> {
  return {
    attestation_id: attestation.attestation_id,
    static_bundle_id: manifest.static_bundle_id,
    static_bundle_manifest_id: manifest.static_bundle_manifest_id,
    review_id: manifest.review_id,
    selected_application: "Synthetic payments API",
    selected_commit: attestation.selected_commit.commit_sha,
    disclosure_policy_summary: attestation.method.disclosure_summary,
    coverage_mode: attestation.method.coverage_mode,
    vendor_receipt_id: manifest.vendor_receipt_ref,
    included_artifact_refs: manifest.files.map((file) => file.artifact_ref),
    deleted_artifacts: manifest.minimization_disposition.deleted_refs.map((deletion_evidence_ref) => ({
      artifact_ref: "artifact_ref:deleted_transient",
      deletion_evidence_ref
    })),
    limitations: [...attestation.limitations],
    portal_entry_path: "portal/index.html",
    signature_verification_state: "verified_offline",
    recipient_notes: "Share with the approved evidence consumer.",
    sharing_notes: "Customer controls the exported copy."
  };
}

/**
 * Seeds the read-only web record store from the shipped synthetic protocol
 * fixtures (E's owner decision (a): synthetic_demo is served from fixtures, not
 * from a live review-lifecycle read model). Re-run on every boot, so a restart
 * re-seeds identical content — the store need not persist.
 *
 * The static-bundle sub-view carries a real ML-DSA-65 verification claim, so it
 * is seeded only when `deps.verifier` actually verifies the shipped signature
 * against the deployment's trusted key directory. In a real deployment the
 * shipped fixture directory is a retired test vector that is not trusted, so
 * that one sub-panel fail-closes to "unavailable" rather than asserting a
 * verification that did not happen; the detail, findings, and attestation
 * surfaces still render fully.
 */
export function seedSyntheticDemoReviewRecords(store: SeedableReviewRecordStore, deps: SeedSyntheticDemoDeps): void {
  const attestation = loadJson(deps.fixturesRoot, "valid", "security-review-attestation.json") as SecurityReviewAttestation;
  const manifest = loadJson(deps.fixturesRoot, "valid", "static-bundle-manifest.generated.json") as StaticBundleManifest;
  const signature = loadJson(deps.fixturesRoot, "valid", "signature-envelope.static-bundle.json") as SignatureEnvelope;
  const signingInput = loadJson(deps.fixturesRoot, "signing-inputs", "static-bundle-manifest-identity.json") as IdentitySigningInput;

  const outcome = deps.verifier.verify({ envelope: signature, signing_input: signingInput, verified_at: deps.verifiedAt });
  const staticBundle = outcome.result === "verified"
    ? { manifest, signingInput, signature, signatureOutcome: outcome }
    : undefined;

  store.seed(SYNTHETIC_DEMO_REVIEW_SCOPE, {
    vendorReceipt: loadJson(deps.fixturesRoot, "valid", "vendor-receipt.json"),
    findingRecords: [loadJson(deps.fixturesRoot, "valid", "customer-facing-finding-record.json")],
    verificationPassScope: loadJson(deps.fixturesRoot, "valid", "verification-pass-scope.customer-facing-projection.json"),
    attestation,
    attestationFinalization: finalizationContextFor(manifest, attestation),
    supportingEvidenceMapping: loadJson(deps.fixturesRoot, "valid", "supporting-evidence-mapping.soc2.json"),
    ...(staticBundle === undefined ? {} : { staticBundle })
  });
}
