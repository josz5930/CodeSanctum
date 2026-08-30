// C7-02: compile-time contract proving the protocol-types generator renders
// allOf/if/then conditional requirements as real discriminated unions
// instead of silently dropping them. Each "invalid" literal below is exactly
// the shape the schema's `then.required` forbids; if the generator ever
// regresses to ignoring the conditional again, the object literal becomes
// assignable, the `@ts-expect-error` directive becomes unused, and `tsc`
// fails with "Unused '@ts-expect-error' directive" -- turning a silent type
// hole back into a loud typecheck failure.
import type { AttestationPackageFinalization, VerificationEvidenceRecord, VerificationRecord } from "../src/generated/protocol-v0.js";

export const validReviewerScriptEvidenceRecord: VerificationEvidenceRecord = {
  protocol_version: "codeattest.v0",
  review_id: "review:abc",
  verification_evidence_record_id: "verification_evidence:abc",
  record_version: 1,
  verification_pass_id: "verification_pass:abc",
  verification_pass_ref: "verification_pass:abc",
  scope_version: 1,
  review_finding_draft_ref: "review_finding_draft:abc",
  classification_record_ref: "classification_record:abc",
  requested_verification_type: "reviewer_authored_script_output",
  intake_state: "accepted_for_review",
  state_reason: "reason",
  actor: { actor_type: "vendor_service", actor_id: "actor" },
  recorded_at: "2026-01-01T00:00:00Z",
  access_scope: { tenant_id: "tenant", review_scope: "review:abc" },
  environment_profile: "synthetic_demo",
  disclosure_state: "metadata_only",
  limitations: ["limitation"],
  source_derived_class: "retained_review_artifact",
  visibility: "customer_facing",
  validation_path_ref: "validation_path:abc",
  reviewer_validation_script_ref: "validation_script:abc",
  validation_artifacts: [
    {
      artifact_ref: "artifact_ref:abc",
      digest: "sha256:abc",
      size_bytes: 1,
      media_type: "text/plain",
      source_derived_class: "retained_review_artifact"
    }
  ]
};

// @ts-expect-error requested_verification_type "reviewer_authored_script_output" requires reviewer_validation_script_ref (and validation_path_ref/validation_artifacts)
export const invalidReviewerScriptEvidenceRecordMissingScriptRef: VerificationEvidenceRecord = {
  protocol_version: "codeattest.v0",
  review_id: "review:abc",
  verification_evidence_record_id: "verification_evidence:abc",
  record_version: 1,
  verification_pass_id: "verification_pass:abc",
  verification_pass_ref: "verification_pass:abc",
  scope_version: 1,
  review_finding_draft_ref: "review_finding_draft:abc",
  classification_record_ref: "classification_record:abc",
  requested_verification_type: "reviewer_authored_script_output",
  intake_state: "accepted_for_review",
  state_reason: "reason",
  actor: { actor_type: "vendor_service", actor_id: "actor" },
  recorded_at: "2026-01-01T00:00:00Z",
  access_scope: { tenant_id: "tenant", review_scope: "review:abc" },
  environment_profile: "synthetic_demo",
  disclosure_state: "metadata_only",
  limitations: ["limitation"],
  source_derived_class: "retained_review_artifact",
  visibility: "customer_facing"
};

export const validExportedAttestation: AttestationPackageFinalization = {
  protocol_version: "codeattest.v0",
  attestation_package_finalization_id: `attestation_finalization:${"a".repeat(64)}`,
  finalization_version: 1,
  review_id: "review:abc",
  static_bundle_id: "static_bundle:abc",
  generated_manifest_ref: "sha256:abc",
  finalized_manifest_ref: "sha256:abc",
  finalized_manifest_version: 2,
  customer_actor: { actor_type: "customer_user", actor_id: "actor" },
  visible_context: {
    attestation_id: `attestation:${"a".repeat(64)}`,
    static_bundle_id: "static_bundle:abc",
    generated_manifest_id: "sha256:abc",
    limitations_visible: true,
    receipt_context_visible: true,
    export_consequence_visible: true
  },
  receipt_verification_state: "verified",
  signature_verification_state: "verified",
  deletion_evidence_state: "resolved",
  portal_verification_state: "verified_offline",
  finalized_at: "2026-01-01T00:00:00Z",
  customer_control_after_export: "control",
  export_state: "exported",
  exported_at: "2026-01-01T00:00:00Z",
  visibility: "customer_facing",
  source_derived_class: "retained_review_artifact",
  canonicalization: "rfc8785",
  identity_hash_algorithm: "sha256",
  identity_input_excludes: ["attestation_package_finalization_id", "export_state", "exported_at"]
};

// @ts-expect-error export_state "exported" requires exported_at
export const invalidExportedAttestationMissingExportedAt: AttestationPackageFinalization = {
  protocol_version: "codeattest.v0",
  attestation_package_finalization_id: `attestation_finalization:${"a".repeat(64)}`,
  finalization_version: 1,
  review_id: "review:abc",
  static_bundle_id: "static_bundle:abc",
  generated_manifest_ref: "sha256:abc",
  finalized_manifest_ref: "sha256:abc",
  finalized_manifest_version: 2,
  customer_actor: { actor_type: "customer_user", actor_id: "actor" },
  visible_context: {
    attestation_id: `attestation:${"a".repeat(64)}`,
    static_bundle_id: "static_bundle:abc",
    generated_manifest_id: "sha256:abc",
    limitations_visible: true,
    receipt_context_visible: true,
    export_consequence_visible: true
  },
  receipt_verification_state: "verified",
  signature_verification_state: "verified",
  deletion_evidence_state: "resolved",
  portal_verification_state: "verified_offline",
  finalized_at: "2026-01-01T00:00:00Z",
  customer_control_after_export: "control",
  export_state: "exported",
  visibility: "customer_facing",
  source_derived_class: "retained_review_artifact",
  canonicalization: "rfc8785",
  identity_hash_algorithm: "sha256",
  identity_input_excludes: ["attestation_package_finalization_id", "export_state", "exported_at"]
};

export const validNotVerifiedRecord: VerificationRecord = {
  protocol_version: "codeattest.v0",
  review_id: "review:abc",
  verification_record_id: "verification_record:abc",
  record_version: 1,
  verification_pass_id: "verification_pass:abc",
  verification_pass_ref: "verification_pass:abc",
  review_finding_draft_ref: "review_finding_draft:abc",
  classification_record_ref: "classification_record:abc",
  verification_evidence_record_refs: ["verification_evidence:abc"],
  verification_status: "not_verified",
  recorded_at: "2026-01-01T00:00:00Z",
  actor: { actor_type: "reviewer", actor_id: "actor" },
  before_state: {
    classification: "likely",
    review_finding_draft_evidence_refs: ["artifact_ref:abc"],
    evidence_basis: ["basis"],
    source_reference_state: "retained_review_artifact",
    confirmation_criteria: ["criteria"]
  },
  after_state: {
    summary: "summary",
    criteria_results: [{ criterion: "criterion", result: "not_evaluated" }],
    evidence_refs: ["artifact_ref:abc"]
  },
  rationale: "rationale",
  remaining_limitations: ["limitation"],
  next_step_summary: "next step",
  source_derived_class: "retained_review_artifact",
  visibility: "customer_facing"
};

// @ts-expect-error verification_status "not_verified" requires next_step_summary
export const invalidNotVerifiedRecordMissingNextStep: VerificationRecord = {
  protocol_version: "codeattest.v0",
  review_id: "review:abc",
  verification_record_id: "verification_record:abc",
  record_version: 1,
  verification_pass_id: "verification_pass:abc",
  verification_pass_ref: "verification_pass:abc",
  review_finding_draft_ref: "review_finding_draft:abc",
  classification_record_ref: "classification_record:abc",
  verification_evidence_record_refs: ["verification_evidence:abc"],
  verification_status: "not_verified",
  recorded_at: "2026-01-01T00:00:00Z",
  actor: { actor_type: "reviewer", actor_id: "actor" },
  before_state: {
    classification: "likely",
    review_finding_draft_evidence_refs: ["artifact_ref:abc"],
    evidence_basis: ["basis"],
    source_reference_state: "retained_review_artifact",
    confirmation_criteria: ["criteria"]
  },
  after_state: {
    summary: "summary",
    criteria_results: [{ criterion: "criterion", result: "not_evaluated" }],
    evidence_refs: ["artifact_ref:abc"]
  },
  rationale: "rationale",
  remaining_limitations: ["limitation"],
  source_derived_class: "retained_review_artifact",
  visibility: "customer_facing"
};
