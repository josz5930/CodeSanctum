import type { EnvironmentEvidenceGate } from "../../../../packages/protocol-ts/src/index.js";
import type { IntakeVerificationRequest } from "../../../../services/intake/src/index.js";
import type { KeyService } from "../signing/key-service.js";
import type { SubmissionAttemptRecord } from "./attempt-state.js";
import type { SubmissionCredential } from "./credential-store.js";

/**
 * The bundle signing convention `runner/crates/local-runner-scaffold/src/keys.rs`
 * uses for every real Evidence Bundle signature: a fixed identity-input path,
 * independent of the manifest's own content. The host must reconstruct this
 * exact signing input (byte for byte, since it is what was actually signed)
 * to verify a submitted bundle's signature.
 */
export const BUNDLE_IDENTITY_INPUT_PATH = "v0/valid/bundle-manifest.identity-input.json";

export type AssembleInput = {
  attempt: SubmissionAttemptRecord;
  credential: SubmissionCredential;
  /**
   * The secret the caller presented on this request. The route has already
   * verified it against the stored scrypt hash; intake re-compares presented
   * against expected in constant time as its own restatement of that
   * decision, so both sides of the comparison are this same verified value.
   * No plaintext secret is persisted anywhere.
   */
  presentedSecret: string;
  artifactBytesByRef: Record<string, Uint8Array>;
  gate: EnvironmentEvidenceGate;
  spendRatio: number;
  /** Verifies the submitted bundle's signature against the trust-anchor-signed key directory bound at boot. */
  keyService: KeyService;
  verifiedAt: string;
};

/**
 * Builds the `IntakeVerificationRequest` the pure intake tier consumes,
 * independently re-verifying the submitted bundle's signature rather than
 * trusting the manifest's own claim about it (D2-1/D2-2: the host verifies,
 * the pure tier consumes a signature-verification-outcome record).
 */
/**
 * B-6: the submission credential carries one `review:`-prefixed id, used
 * both as the evidence-store `review_id` (attempt/review-event-log scope)
 * and as intake's `review_request_id`. Those are different grammars,
 * though: `packages/protocol-ts/src/submission-identity-grammar.ts` requires
 * `submission_identities[].review_request_id` (populated on a scope-mismatch
 * failure) to match `^review_request:...`, not `^review:...`. This adapts
 * the prefix -- not a separate mapping table, the same credential-sourced
 * suffix -- so intake's own protocol-authority grammar is satisfied without
 * reopening B-6.
 */
function reviewRequestIdFor(reviewId: string): string {
  return `review_request:${reviewId.replace(/^review:/, "")}`;
}

export function assembleIntakeRequest(input: AssembleInput): IntakeVerificationRequest {
  const { attempt, credential } = input;
  const bundleManifest = JSON.parse(attempt.bundle_manifest_body) as IntakeVerificationRequest["submitted_bundle_manifest"];
  const signatureEnvelope = JSON.parse(attempt.signature_envelope_body) as IntakeVerificationRequest["signature_envelope"];
  const reviewRequestId = reviewRequestIdFor(credential.review_id);

  const signatureVerificationOutcome = input.keyService.verifier.verify({
    envelope: signatureEnvelope,
    signing_input: {
      protocol_version: "codeattest.v0",
      signing_input_type: "evidence_bundle_identity",
      algorithm_profile: "ml_dsa_65",
      signed_identity_type: "evidence_bundle",
      signed_identity: bundleManifest.evidence_bundle_id,
      canonicalization: "rfc8785",
      identity_input_path: BUNDLE_IDENTITY_INPUT_PATH
    },
    verified_at: input.verifiedAt
  });

  return {
    submitted_bundle_manifest: bundleManifest,
    signature_envelope: signatureEnvelope,
    signature_verification_outcome: signatureVerificationOutcome,
    artifact_bytes_by_ref: input.artifactBytesByRef,
    customer_approval: JSON.parse(attempt.customer_approval_body),
    approved_outbound_manifest: JSON.parse(attempt.approved_outbound_manifest_body),
    environment_evidence_gate: input.gate,
    authenticated_context: {
      customer_id: credential.customer_id,
      review_request_id: reviewRequestId,
      selected_application_id: credential.selected_application_id,
      selected_commit: credential.selected_commit,
      repository_identity_hash: credential.repository_identity_hash
    },
    submission_token: {
      token_key_id: credential.token_key_id,
      token_secret_material: input.presentedSecret
    },
    submission_token_expectation: {
      customer_id: credential.customer_id,
      review_request_id: reviewRequestId,
      selected_application_id: credential.selected_application_id,
      selected_commit: credential.selected_commit,
      repository_identity_hash: credential.repository_identity_hash,
      expected_manifest_id: credential.expected_manifest_id,
      ...(credential.expected_evidence_bundle_id === undefined
        ? {}
        : { expected_evidence_bundle_id: credential.expected_evidence_bundle_id }),
      token_key_id: credential.token_key_id,
      token_secret_material: input.presentedSecret
    },
    demo_budget_enforcement: { spend_ratio: input.spendRatio }
  };
}

/**
 * Intake's own `artifactCountSummaryFromOutboundManifest` derives this in a
 * fixed category order (not the manifest's own array order) and requires
 * every category to be present; a supplied summary that disagrees fails
 * `verifyIntakeSubmission`'s preflight with `receipt_artifact_count_mismatch`.
 * Mirrored here so a receipt request can supply a summary that already
 * matches what intake will independently derive.
 */
const ARTIFACT_COUNT_CATEGORIES = [
  "metadata",
  "dependencies",
  "scanner_findings",
  "raw_snippets",
  "targeted_files",
  "derived_artifacts",
  "never_collected_items"
] as const;

export function artifactCountSummaryFromManifest(manifest: { evidence_categories: { category: string; count: number }[] }) {
  const categories = ARTIFACT_COUNT_CATEGORIES.map((category) => {
    const found = manifest.evidence_categories.find((entry) => entry.category === category);
    return { category, count: found?.count ?? 0 };
  });
  return {
    count_domain: "evidence_category_counts" as const,
    total_count: categories.reduce((sum, entry) => sum + entry.count, 0),
    categories
  };
}

/** Derives a schema-valid `submission_outcome:...` id from the attempt id. */
export function submissionOutcomeIdFor(submissionAttemptId: string): string {
  return submissionAttemptId.replace(/^submission_attempt:/, "submission_outcome:");
}
