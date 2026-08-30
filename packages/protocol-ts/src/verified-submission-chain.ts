import { canonicalizeProtocolJson, computeCanonicalSha256Id, recomputeExcludedFieldIdentity } from "./canonical-identity.js";
import {
  bundleManifestCleanupSemanticIssues,
  outboundManifestSemanticIssues,
  scannerFindingSetSemanticIssues
} from "./submitted-artifact-semantics.js";
import { verifyVendorReceiptRecordSync } from "./vendor-receipt-verification.js";
import type { BundleManifest, OutboundManifest, ReviewScope, ScannerFindingSet, SignatureVerificationOutcome, VendorReceipt } from "./generated/protocol-v0.js";

/**
 * C5-27/C5-28/C5-29/C5-32: shared authority for the worker's (and any future
 * consumer's) verified-submission chain. Schema validity is a precondition --
 * callers must run `validateProtocolSchema` on every artifact first.
 *
 * Scope note (mirrors C5-04's documented deferral for the same reason):
 * `scanner_finding_set_id` self-identity is intentionally NOT recomputed
 * here. Unlike bundle-manifest/outbound-manifest/vendor-receipt, the fixture
 * corpus has no `canonical_identities` drift-check entry for it, and its
 * current fixtures (`scanner-finding-set*.json`) carry placeholder
 * `sha256:bbbb...`/`sha256:cccc...` ids referenced by ~70 other fixtures as
 * `scanner_finding_set_ref`. Recomputing and enforcing it here would require
 * regenerating that entire cross-referencing corpus, which is out of scope
 * for this shared helper; `bundle_manifest.scanner_finding_set_ref` /
 * `outbound_manifest.scanner_finding_set_ref` equality with
 * `scanner_finding_set.scanner_finding_set_id` is still enforced by callers
 * (worker's own `validateReceiptBoundary`), so a relabeled ref is caught --
 * only content-tampering-under-the-same-id is not.
 */

export type VerifiedSubmissionChainInput = {
  review_scope: ReviewScope;
  bundle_manifest: BundleManifest;
  outbound_manifest: OutboundManifest;
  scanner_finding_set: ScannerFindingSet;
  vendor_receipt: VendorReceipt;
  // D3-2: `verifyVendorReceiptRecordSync` can no longer authenticate a
  // receipt's signature from the receipt alone, so the caller must carry the
  // independently produced outcome for `vendor_receipt.receipt_signature` all
  // the way down to it.
  vendor_receipt_signature_outcome: SignatureVerificationOutcome;
};

export type VerifiedArtifactSemanticIssue =
  | "chain_review_scope_identity_mismatch"
  | "chain_bundle_manifest_identity_mismatch"
  | "chain_bundle_manifest_semantic_invalid"
  | "chain_outbound_manifest_semantic_invalid"
  | "chain_scanner_finding_set_semantic_invalid";

export type VerifiedSubmissionChainIssue =
  | "chain_receipt_unverified"
  | "chain_review_scope_mismatch"
  | "chain_disclosure_policy_mismatch"
  | "chain_selected_application_mismatch"
  | "chain_selected_commit_mismatch"
  | "chain_repository_identity_mismatch";

/**
 * Intrinsic, single-artifact checks: does each artifact's own declared
 * identity match its own content, and is its own content internally
 * semantically consistent. No cross-artifact binding here.
 */
export function verifiedArtifactSemanticIssues(input: VerifiedSubmissionChainInput): VerifiedArtifactSemanticIssue[] {
  const issues: VerifiedArtifactSemanticIssue[] = [];
  const { review_scope: reviewScope, bundle_manifest: bundle, outbound_manifest: outbound, scanner_finding_set: scannerSet } = input;

  if (reviewScopeIdentity(reviewScope) !== reviewScope.review_scope_id) {
    issues.push("chain_review_scope_identity_mismatch");
  }

  if (recomputeExcludedFieldIdentity(bundle, "evidence_bundle_id") !== bundle.evidence_bundle_id) {
    issues.push("chain_bundle_manifest_identity_mismatch");
  }
  if (bundleManifestCleanupSemanticIssues(bundle).length > 0) {
    issues.push("chain_bundle_manifest_semantic_invalid");
  }
  if (outboundManifestSemanticIssues(outbound).length > 0) {
    issues.push("chain_outbound_manifest_semantic_invalid");
  }
  if (scannerFindingSetSemanticIssues(scannerSet).length > 0) {
    issues.push("chain_scanner_finding_set_semantic_invalid");
  }

  return issues;
}

/**
 * Contextual, cross-artifact checks: receipt authentication and binding of
 * review scope, disclosure policy, selected application/commit, and
 * repository identity across bundle manifest, outbound manifest, scanner
 * finding set, and vendor receipt.
 */
export function verifiedSubmissionChainIssues(input: VerifiedSubmissionChainInput): VerifiedSubmissionChainIssue[] {
  const issues: VerifiedSubmissionChainIssue[] = [];
  const {
    review_scope: reviewScope,
    bundle_manifest: bundle,
    outbound_manifest: outbound,
    scanner_finding_set: scannerSet,
    vendor_receipt: receipt
  } = input;

  const receiptResult = verifyVendorReceiptRecordSync(receipt, { signature_verification_outcome: input.vendor_receipt_signature_outcome });
  if (receiptResult.state !== "receipt_verified") {
    issues.push("chain_receipt_unverified");
  }

  if (
    bundle.review_scope_ref !== reviewScope.review_scope_id ||
    outbound.review_scope_ref !== reviewScope.review_scope_id ||
    scannerSet.review_scope_ref !== reviewScope.review_scope_id
  ) {
    issues.push("chain_review_scope_mismatch");
  }

  if (
    bundle.disclosure_policy_ref !== outbound.disclosure_policy_ref ||
    bundle.disclosure_policy_ref !== receipt.disclosure_policy_ref ||
    outbound.disclosure_policy_summary?.disclosure_policy_ref !== receipt.disclosure_policy_ref ||
    !sameCanonicalJson(outbound.disclosure_policy_summary, receipt.disclosure_policy_summary)
  ) {
    issues.push("chain_disclosure_policy_mismatch");
  }

  if (
    !sameCanonicalJson(outbound.selected_scope_summary?.selected_application, reviewScope.selected_application) ||
    !sameCanonicalJson(outbound.selected_scope_summary?.selected_application, receipt.selected_application)
  ) {
    issues.push("chain_selected_application_mismatch");
  }
  if (
    !sameCanonicalJson(outbound.selected_scope_summary?.selected_commit, reviewScope.selected_commit) ||
    !sameCanonicalJson(outbound.selected_scope_summary?.selected_commit, receipt.selected_commit)
  ) {
    issues.push("chain_selected_commit_mismatch");
  }
  if (
    outbound.selected_scope_summary?.repository_identity !== reviewScope.repository_identity ||
    outbound.selected_scope_summary?.repository_identity !== receipt.repository_identity_hash
  ) {
    issues.push("chain_repository_identity_mismatch");
  }

  return issues;
}

/** Matches the Rust local runner's review_scope_identity_hash input. */
export function reviewScopeIdentity(reviewScope: ReviewScope): string {
  return computeCanonicalSha256Id({
    generated_at: reviewScope.generated_at,
    protocol_version: reviewScope.protocol_version,
    repository_identity: reviewScope.repository_identity,
    review_id: reviewScope.review_id,
    runner_name: reviewScope.runner.name,
    runner_version: reviewScope.runner.version,
    selected_application_id: reviewScope.selected_application.application_id,
    selected_commit: reviewScope.selected_commit.commit_sha
  });
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeProtocolJson(left ?? null) === canonicalizeProtocolJson(right ?? null);
  } catch {
    return false;
  }
}
