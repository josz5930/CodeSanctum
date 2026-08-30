import { canonicalizeProtocolJson, computeCanonicalSha256Id } from "./canonical-identity.js";
import { validateProtocolSchema } from "./validation.js";
import type { SignatureVerificationOutcome, VendorReceipt } from "./generated/protocol-v0.js";

export type VendorReceiptVerificationResult = {
  state: "receipt_verified" | "failed_verification";
  reason_codes: string[];
};

export type VendorReceiptVerificationOptions = {
  signature_verification_outcome: SignatureVerificationOutcome;
};

// D2-2: a receipt's own `receipt_signature` proves nothing by itself -- there
// is no local rule that can authenticate ML-DSA-65 bytes. What proves it is an
// independently produced `SignatureVerificationOutcome`. That outcome is
// untrusted *input* to this pure function, so every field it claims (identity,
// type, key, algorithm profile) is checked against the receipt's own signature
// rather than trusted wholesale -- a caller who could hand in any
// "verified"-looking outcome for any receipt would have replaced signature
// verification with an honour system.
function signatureTrusted(signature: Record<string, unknown>, vendorReceiptId: unknown, options: VendorReceiptVerificationOptions): boolean {
  // D3-2: the outcome is required by the type, but a JavaScript caller can
  // still omit it; read it defensively so an absent outcome fails closed
  // instead of throwing a TypeError.
  const outcome = options?.signature_verification_outcome;
  return (
    outcome !== undefined &&
    outcome !== null &&
    outcome.result === "verified" &&
    outcome.signed_identity === vendorReceiptId &&
    outcome.signed_identity_type === "vendor_receipt" &&
    outcome.key_id === signature.key_id &&
    outcome.key_version === signature.key_version &&
    outcome.algorithm_profile === signature.algorithm_profile
  );
}

const ARTIFACT_COUNT_CATEGORIES = [
  "metadata",
  "dependencies",
  "scanner_findings",
  "raw_snippets",
  "targeted_files",
  "derived_artifacts",
  "never_collected_items"
] as const;

/**
 * C4-24: a synchronous, pure port of `verifyVendorReceiptRecord` in
 * `services/intake/src/index.ts` -- the same rules (schema, receipt state,
 * recomputed identity excluding exactly `vendor_receipt_id`,
 * `receipt_signature`, and nested `public_verification_metadata.signed_identity`,
 * signed identity type/value, the supplied signature verification outcome,
 * canonicalization, key/version/rotation, signing time, and the approved-vs-
 * received comparison rows) but using the sync `computeCanonicalSha256Id`
 * (RFC 8785 + SHA-256) instead of intake's async WebCrypto path, so it can be
 * called from the control-plane finalization boundary without an async
 * public API. Intake's own `verifyVendorReceiptRecord` should become a thin
 * async wrapper around this for parity; this module never imports intake.
 */
export function verifyVendorReceiptRecordSync(receipt: unknown, options: VendorReceiptVerificationOptions): VendorReceiptVerificationResult {
  const issues: string[] = [];
  const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", receipt);
  if (schemaErrors.length > 0) {
    issues.push(...schemaErrors.map((error) => receiptReasonForSchemaError(error.code)));
  }
  if (!isRecord(receipt)) {
    return { state: "failed_verification", reason_codes: dedupe(issues.length > 0 ? issues : ["receipt_schema_validation_failed"]) };
  }

  const signature = receipt.receipt_signature;
  const metadata = receipt.public_verification_metadata;
  const keyRotation = receipt.key_rotation_readiness;
  if (!isRecord(signature) || !isRecord(metadata) || !isRecord(keyRotation)) {
    issues.push("receipt_schema_validation_failed");
    return { state: "failed_verification", reason_codes: dedupe(issues) };
  }

  if (receipt.verification_state !== "received_with_receipt") {
    issues.push("vendor_receipt_no_failed_receipt");
  }
  if (signature.signed_identity_type !== "vendor_receipt" || metadata.signed_identity_type !== "vendor_receipt") {
    issues.push("vendor_receipt_signature_identity_type");
  }
  if (signature.signed_identity !== receipt.vendor_receipt_id || metadata.signed_identity !== receipt.vendor_receipt_id) {
    issues.push("signature_signed_identity_mismatch");
  }
  if (!signatureTrusted(signature, receipt.vendor_receipt_id, options)) {
    issues.push("receipt_signature_unverified");
  }
  if (signature.canonicalization !== "rfc8785" || metadata.canonicalization !== "rfc8785") {
    issues.push("receipt_canonicalization_unsupported");
  }
  if (signature.signing_mode !== metadata.signing_mode || !sameCanonicalJson(signature.signing_limitations, metadata.signing_limitations)) {
    issues.push("receipt_key_metadata_required");
  }
  if (
    typeof signature.key_id !== "string" ||
    typeof signature.key_version !== "string" ||
    signature.key_id !== metadata.key_id ||
    signature.key_version !== metadata.key_version ||
    keyRotation.historical_key_id !== signature.key_id ||
    keyRotation.historical_key_version !== signature.key_version
  ) {
    issues.push("receipt_key_metadata_required");
  }
  if (signature.signing_time !== receipt.receipt_timestamp || metadata.signing_time !== receipt.receipt_timestamp) {
    issues.push("receipt_key_metadata_required");
  }
  try {
    const expectedReceiptId = computeVendorReceiptIdentity(receipt);
    if (receipt.vendor_receipt_id !== expectedReceiptId) {
      issues.push("vendor_receipt_identity_mismatch");
    }
  } catch {
    issues.push("vendor_receipt_identity_mismatch");
  }
  if (
    !isArtifactCountSummary(receipt.approved_artifact_count_summary) ||
    !isArtifactCountSummary(receipt.received_artifact_count_summary) ||
    !sameCanonicalJson(receipt.approved_artifact_count_summary, receipt.received_artifact_count_summary) ||
    !comparisonRowsMatchReceipt(receipt as VendorReceipt)
  ) {
    issues.push("receipt_approved_received_mismatch");
  }

  const reasonCodes = dedupe(issues);
  if (reasonCodes.length > 0) {
    return { state: "failed_verification", reason_codes: reasonCodes };
  }
  return { state: "receipt_verified", reason_codes: [] };
}

function computeVendorReceiptIdentity(receipt: Record<string, unknown>): string {
  const identityInput: Record<string, unknown> = { ...receipt };
  delete identityInput["vendor_receipt_id"];
  delete identityInput["receipt_signature"];
  const metadata = identityInput["public_verification_metadata"];
  if (isRecord(metadata)) {
    const metadataWithoutIdentity: Record<string, unknown> = { ...metadata };
    delete metadataWithoutIdentity["signed_identity"];
    identityInput["public_verification_metadata"] = metadataWithoutIdentity;
  }
  return computeCanonicalSha256Id(identityInput);
}

function comparisonRowsMatchReceipt(receipt: VendorReceipt): boolean {
  if (!isRecord(receipt.approved_vs_received_comparison) || !Array.isArray((receipt.approved_vs_received_comparison as { rows?: unknown }).rows)) {
    return false;
  }
  if (!isRecord(receipt.selected_commit) || !isRecord(receipt.disclosure_policy_summary)) {
    return false;
  }
  // C5-14: the top-level `disclosure_policy_ref`/`coverage_mode` fields must
  // agree with the nested `disclosure_policy_summary` they are meant to
  // summarize -- otherwise a receipt could report one disclosure policy at
  // the top level while its summary (and comparison row) describes another.
  if (receipt.disclosure_policy_ref !== receipt.disclosure_policy_summary.disclosure_policy_ref || receipt.coverage_mode !== receipt.disclosure_policy_summary.coverage_mode) {
    return false;
  }
  const rows = (receipt.approved_vs_received_comparison as { rows: unknown[] }).rows;
  const expectedRows: ReadonlyArray<readonly [string, string]> = [
    ["manifest_id", receipt.manifest_id],
    ["evidence_bundle_id", receipt.evidence_bundle_id],
    ["selected_commit", receipt.selected_commit.commit_sha],
    ["repository_identity_hash", receipt.repository_identity_hash],
    ["coverage_mode", receipt.coverage_mode],
    ["artifact_count_summary", `evidence_category_counts:${receipt.approved_artifact_count_summary.total_count}`],
    ["disclosure_policy_summary", disclosureSummaryComparisonValue(receipt.disclosure_policy_summary)]
  ];
  // C5-14: the comparison row set must be exactly the seven known fields,
  // each appearing once -- a `Map` keyed by field silently tolerated
  // duplicate/unknown rows because only the last write for a given key was
  // ever read back.
  if (rows.length !== expectedRows.length) {
    return false;
  }
  const expectedByField = new Map(expectedRows);
  const seenFields = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row) || typeof row.field !== "string" || seenFields.has(row.field) || !expectedByField.has(row.field)) {
      return false;
    }
    seenFields.add(row.field);
    const expectedValue = expectedByField.get(row.field);
    if (row.result !== "matched" || row.approved_value !== expectedValue || row.received_value !== expectedValue) {
      return false;
    }
  }
  return seenFields.size === expectedByField.size;
}

function disclosureSummaryComparisonValue(summary: VendorReceipt["disclosure_policy_summary"]): string {
  return `${summary.disclosure_policy_ref}:${summary.coverage_mode}:${summary.redaction_configuration_version}`;
}

function isArtifactCountSummary(value: unknown): value is VendorReceipt["approved_artifact_count_summary"] {
  if (!isRecord(value) || value.count_domain !== "evidence_category_counts" || !Number.isInteger(value.total_count) || !Array.isArray(value.categories)) {
    return false;
  }
  const totalCount = value.total_count;
  if (typeof totalCount !== "number" || totalCount < 0) {
    return false;
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const category of value.categories) {
    if (
      !isRecord(category) ||
      typeof category.category !== "string" ||
      !(ARTIFACT_COUNT_CATEGORIES as readonly string[]).includes(category.category) ||
      !Number.isInteger(category.count) ||
      typeof category.count !== "number" ||
      category.count < 0 ||
      seen.has(category.category)
    ) {
      return false;
    }
    seen.add(category.category);
    sum += category.count;
  }
  return seen.size === ARTIFACT_COUNT_CATEGORIES.length && sum === totalCount;
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeProtocolJson(left) === canonicalizeProtocolJson(right);
  } catch {
    return false;
  }
}

function receiptReasonForSchemaError(code: string): string {
  if (code === "required") {
    return "receipt_key_metadata_required";
  }
  if (code === "utc_rfc3339_timestamp") {
    return "receipt_timestamp_invalid";
  }
  if (code === "const") {
    return "receipt_schema_validation_failed";
  }
  return "receipt_schema_validation_failed";
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
