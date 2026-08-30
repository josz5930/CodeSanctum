/**
 * C5-22: `submission-outcome.schema.json`'s `submission_identities[].identity_value`
 * is an untyped `minLength: 1, maxLength: 512` string regardless of
 * `identity_type` -- `manifest_id:"secret=..."`, `evidence_bundle_id:"alice@example.com"`,
 * or a noncanonical attempt id are all schema-valid. This is the shared
 * per-type grammar every producer (intake) and consumer (control plane)
 * must apply; producers must reject a present-but-malformed value rather
 * than silently omitting the row.
 */
export type SubmissionIdentityType = "manifest_id" | "evidence_bundle_id" | "review_request_id" | "bundle_instance_id" | "submission_attempt_id";

const SHA256_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;

const SUBMISSION_IDENTITY_PATTERNS: Readonly<Record<SubmissionIdentityType, RegExp>> = {
  manifest_id: SHA256_ID_PATTERN,
  evidence_bundle_id: SHA256_ID_PATTERN,
  review_request_id: /^review_request:[a-z0-9][a-z0-9_-]{2,63}$/,
  bundle_instance_id: /^bundle_instance:[a-z0-9][a-z0-9_-]{2,63}$/,
  submission_attempt_id: /^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$/
};

export function submissionIdentityValueMatchesGrammar(identityType: string, identityValue: unknown): identityValue is string {
  const pattern = (SUBMISSION_IDENTITY_PATTERNS as Record<string, RegExp | undefined>)[identityType];
  return pattern !== undefined && typeof identityValue === "string" && pattern.test(identityValue);
}
