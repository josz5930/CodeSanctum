// Generated from protocol/policies/claim-safety.v0.json. Do not edit by hand.
// Regenerate with: npm run generate --workspace @onevps/protocol-ts

export const CLAIM_SAFE_FORBIDDEN_PHRASES = [
  "received_with_receipt",
  "review complete",
  "codeattest reviewed",
  "vendor receipt",
  "auditor acceptance",
  "auditor accepted",
  "auditor approved",
  "regulator acceptance",
  "regulator accepted",
  "independent assurance",
  "no vulnerabilities",
  "absence of vulnerabilities",
  "verification accepted",
  "remediation complete",
  "control accepted",
  "control is satisfied",
  "control satisfied",
  "soc 2 acceptance",
  "soc 2 accepted",
  "soc 2 certified",
  "soc 2 certification",
  "soc 2 compliant",
  "soc2 acceptance",
  "soc2 accepted",
  "soc2 certified",
  "soc2 certification",
  "soc2 compliant",
  "regulator approval",
  "regulator approved",
  "regulatory approval",
  "regulatory accepted",
  "control effectiveness proven",
  "controls are effective",
  "security guaranteed",
  "secure by codeattest",
  "certification granted",
  "granted certification",
  "deployment certified",
  "is certified"
] as const;

export const CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES = [
  "fresh full review",
  "complete fresh review",
  "full secure-code review",
  "fixed",
  "verified",
  "remediated",
  "resolved",
  "verification complete",
  "regulator approved",
  "auditor accepted",
  "certified",
  "control satisfied",
  "independent assurance",
  "no vulnerabilities"
] as const;

export const CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES = [
  "accepted_risk",
  "artifact_ref",
  "attestation_finalization",
  "mapping_entry",
  "pilot_feedback",
  "pilot_metric",
  "portal_document",
  "static_bundle",
  "static_portal_projection",
  "supporting_evidence_mapping",
  "candidate_finding",
  "classification_record",
  "customer",
  "customer_facing_finding",
  "customer_selection",
  "customer_status",
  "false_positive",
  "remediation_guidance",
  "review",
  "review_finding_draft",
  "validation_path",
  "validation_script",
  "verification_pass"
] as const;

export const CLAIM_SAFE_TEXT_MAX_LENGTH = 65536;

export const PII_EMAIL_ADDRESS_PATTERN_SOURCE = "\\b[a-z0-9][a-z0-9._%+-]{0,63}@([a-z0-9.-]{1,253}\\.[a-z]{2,63})\\b";

export const SOURCE_TEXT_FORBIDDEN_PHRASES = [
  "eval('1 + 1')",
  "raw scanner output",
  "scanner stdout",
  "scanner stderr",
  "secret=",
  "secret:",
  "password=",
  "password:",
  "api_key=",
  "api_key:",
  "api-key=",
  "api-key:",
  "token=",
  "token:",
  "authorization: bearer"
] as const;
