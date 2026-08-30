// Generated from protocol/schemas/*.schema.json. Do not edit by hand.
// Regenerate with: npm run generate --workspace @onevps/protocol-ts

export type NonEmptyArray<T> = [T, ...T[]];

export type ActorReference = {
  actor_type: "local_runner" | "customer_user" | "vendor_service" | "reviewer";
  actor_id: NonEmptyString;
};

export type AlgorithmPrefixedSha256Id = string;

export type ArtifactDigest = string;

export type CoverageMode = "metadata_only" | "finding_context_snippets" | "extended_approved_snippets_or_targeted_files";

export type MlDsa65PublicKey = string;

export type MlDsa65Signature = string;

export type NarrativeString = string;

export type NonEmptyString = string;

export type ProtocolVersion = "codeattest.v0";

export type Sha256Hex = string;

export type SnakeCaseFieldName = string;

export type UtcRfc3339Timestamp = string;

export type AcceptedRiskRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  accepted_risk_record_id: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
  customer_rationale?: NonEmptyString;
  customer_signoff_ref?: string;
  customer_signoff_summary?: NonEmptyString;
  customer_actor_ref?: string;
  risk_owner?: NonEmptyString;
  scope_of_acceptance?: NonEmptyString;
  review_by_date?: string;
  remediation_context_ref?: string;
  validation_path_ref?: string;
  recorded_at: UtcRfc3339Timestamp;
  actor: ActorReference;
  limitations: NonEmptyArray<NarrativeString>;
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
  field_export_policy?: {
    customer_rationale: "include" | "exclude";
    customer_signoff_summary: "include" | "exclude";
    risk_owner: "include" | "exclude";
    scope_of_acceptance: "include" | "exclude";
    limitations: "include" | "exclude";
    evidence_consumer_export: "include" | "exclude";
    evidence_basis: "include" | "exclude";
  };
};

export type ArtifactReference = {
  protocol_version: ProtocolVersion;
  artifact_ref: string;
  artifact_type: "review_scope" | "disclosure_policy" | "dependency_manifest" | "scanner_finding_set" | "scanner_raw_output" | "raw_snippet" | "targeted_file" | "outbound_manifest" | "customer_approval" | "bundle_manifest" | "signature_envelope";
  digest: ArtifactDigest;
  size_bytes: number;
  source_derived_class: RetentionSourceDerivedClass;
  manifest_entry_ref: string;
  media_type?: string;
  content_path?: string;
  content_path_anchor?: "manifest_artifacts" | "bundle_artifacts" | "bundle_source_derived_artifacts" | "fixture_root";
  synthetic_markers?: NonEmptyArray<"SYNTHETIC_DEMO_DATA" | "NOT_CUSTOMER_SOURCE">;
};

export type AttestationPackageFinalization = {
  protocol_version: ProtocolVersion;
  attestation_package_finalization_id: string;
  finalization_version: number;
  review_id: string;
  static_bundle_id: string;
  generated_manifest_ref: AlgorithmPrefixedSha256Id;
  finalized_manifest_ref: AlgorithmPrefixedSha256Id;
  finalized_manifest_version: number;
  customer_actor: {
    actor_type: "customer_user";
    actor_id: NonEmptyString;
  };
  visible_context: {
    attestation_id: string;
    static_bundle_id: string;
    generated_manifest_id: AlgorithmPrefixedSha256Id;
    limitations_visible: true;
    receipt_context_visible: true;
    export_consequence_visible: true;
  };
  receipt_verification_state: "verified";
  signature_verification_state: "verified";
  deletion_evidence_state: "resolved";
  portal_verification_state: "verified_offline";
  finalized_at: UtcRfc3339Timestamp;
  customer_control_after_export: NonEmptyString;
  export_state: "not_exported";
  exported_at?: UtcRfc3339Timestamp;
  visibility: "customer_facing";
  source_derived_class: "retained_review_artifact";
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["attestation_package_finalization_id" | "export_state" | "exported_at", "attestation_package_finalization_id" | "export_state" | "exported_at", "attestation_package_finalization_id" | "export_state" | "exported_at"];
} | {
  protocol_version: ProtocolVersion;
  attestation_package_finalization_id: string;
  finalization_version: number;
  review_id: string;
  static_bundle_id: string;
  generated_manifest_ref: AlgorithmPrefixedSha256Id;
  finalized_manifest_ref: AlgorithmPrefixedSha256Id;
  finalized_manifest_version: number;
  customer_actor: {
    actor_type: "customer_user";
    actor_id: NonEmptyString;
  };
  visible_context: {
    attestation_id: string;
    static_bundle_id: string;
    generated_manifest_id: AlgorithmPrefixedSha256Id;
    limitations_visible: true;
    receipt_context_visible: true;
    export_consequence_visible: true;
  };
  receipt_verification_state: "verified";
  signature_verification_state: "verified";
  deletion_evidence_state: "resolved";
  portal_verification_state: "verified_offline";
  finalized_at: UtcRfc3339Timestamp;
  customer_control_after_export: NonEmptyString;
  export_state: "exported";
  exported_at: UtcRfc3339Timestamp;
  visibility: "customer_facing";
  source_derived_class: "retained_review_artifact";
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["attestation_package_finalization_id" | "export_state" | "exported_at", "attestation_package_finalization_id" | "export_state" | "exported_at", "attestation_package_finalization_id" | "export_state" | "exported_at"];
};

export type BundleManifest = {
  protocol_version: ProtocolVersion;
  evidence_bundle_id: AlgorithmPrefixedSha256Id;
  manifest_id: AlgorithmPrefixedSha256Id;
  customer_approval_ref: string;
  customer_approval_decision: "approved";
  bundle_state: "not_submitted";
  review_scope_ref: AlgorithmPrefixedSha256Id;
  disclosure_policy_ref: AlgorithmPrefixedSha256Id;
  scanner_finding_set_ref?: AlgorithmPrefixedSha256Id;
  coverage_mode: CoverageMode;
  bundle_instance_id: string;
  submission_attempt_id: string;
  created_at: UtcRfc3339Timestamp;
  runner: {
    name: "codeattest-local-runner";
    version: NonEmptyString;
  };
  tool_versions: NonEmptyArray<{
    tool_name: NonEmptyString;
    tool_version: NonEmptyString;
  }>;
  artifact_references: Array<ArtifactReference>;
  verification_metadata: {
    identity_canonicalization: "rfc8785";
    identity_hash_algorithm: "sha256";
    identity_input_excludes: NonEmptyArray<"evidence_bundle_id">;
    signed_identity_type: "evidence_bundle";
    approved_manifest_id: AlgorithmPrefixedSha256Id;
    signature_envelope_path: NonEmptyString;
    bundle_signing_mode: "managed_key" | "enrolled_runner_key";
  };
  local_cleanup_intent: Array<{
    artifact_ref: string;
    source_derived_class: RetentionSourceDerivedClass;
    cleanup_state: "pending_local_cleanup" | "not_applicable";
    cleanup_required: boolean;
    deletion_evidence_state: "pending" | "not_applicable";
  }>;
};

export type CustomerApproval = {
  protocol_version: ProtocolVersion;
  approval_id: string;
  manifest_id: AlgorithmPrefixedSha256Id;
  decision: "approved" | "declined";
  decided_at: UtcRfc3339Timestamp;
  approving_actor?: ActorReference;
  displayed_context: {
    manifest_id: AlgorithmPrefixedSha256Id;
    selected_application: {
      application_id: NonEmptyString;
      display_name: NonEmptyString;
    };
    selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    repository_identity: AlgorithmPrefixedSha256Id;
    coverage_mode: CoverageMode;
    disclosure_policy_ref: AlgorithmPrefixedSha256Id;
    scanner_finding_set_ref?: AlgorithmPrefixedSha256Id;
    disclosure_warnings: NonEmptyArray<NarrativeString>;
    bundle_preview_summary: NonEmptyString;
  };
  warnings_acknowledged: Array<NarrativeString>;
  not_submitted_state?: {
    state: "not_submitted";
    evidence_bundle_created: false;
    evidence_sent: false;
    next_actions: Array<"revise policy" | "rerun scan" | "export manifest" | "exit">;
  };
};

export type CustomerFacingFindingRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  customer_facing_finding_record_id: string;
  review_finding_draft_ref: string;
  classification_record_ref?: string;
  remediation_guidance_ref?: string;
  customer_status_record_refs?: Array<string>;
  verification_record_ref?: string;
  accepted_risk_record_ref?: string;
  false_positive_record_ref?: string;
  expert_classification: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    classification_record_ref: string;
    rationale_summary: NonEmptyString;
    criteria_summary: NonEmptyString;
    limitations: NonEmptyArray<NarrativeString>;
  };
  evidence_basis: {
    evidence_refs: NonEmptyArray<string>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    limitations: NonEmptyArray<NarrativeString>;
  };
  reviewer_remediation_guidance: {
    guidance_status: "actionable_guidance_provided" | "limited_guidance_requires_validation" | "guidance_unavailable_from_submitted_evidence";
    remediation_guidance_ref?: string;
    exploitability_rationale_summary?: NonEmptyString;
    suggested_remediation_summary?: NonEmptyString;
    validation_step_summary?: NonEmptyString;
    next_step_summary?: NonEmptyString;
    validation_path_summary?: NonEmptyString;
    validation_path_ref?: string;
    insufficient_evidence_reason?: NonEmptyString;
    limitations: NonEmptyArray<NarrativeString>;
  };
  customer_remediation_status: {
    latest_status: "not_started" | "planned" | "in_progress" | "remediated_by_customer" | "validation_pending" | "deferred" | "not_applicable";
    latest_status_record_ref?: string;
    owner?: NonEmptyString;
    due_date?: string;
    target_state?: NonEmptyString;
    customer_notes_summary?: NonEmptyString;
    customer_notes_visible: boolean;
  };
  verification_state: {
    status: "not_verified" | "verification_pending" | "verification_complete" | "requires_customer_side_validation";
    verification_record_ref?: string;
    summary: NonEmptyString;
  };
  future_outcome_visibility: {
    accepted_risk_visible: boolean;
    accepted_risk_record_ref?: string;
    false_positive_visible: boolean;
    false_positive_record_ref?: string;
  };
  validation_paths?: Array<{
    validation_path_ref: string;
    path_type: "remote_dynamic_testing" | "customer_run_script" | "manual_steps";
    required_evidence: NonEmptyString;
    steps: NonEmptyString;
    expected_result: NonEmptyString;
    limitations: NonEmptyArray<NarrativeString>;
    included_pass_verifiability: "verifiable_within_included_pass" | "customer_provided_evidence_required" | "additional_agreement_required";
    reviewer_validation_script_refs?: NonEmptyArray<string>;
    output_attachment_instructions?: NonEmptyString;
    target?: NonEmptyString;
    authorization_assumption?: NonEmptyString;
    method?: NonEmptyString;
    safety_constraints?: NonEmptyString;
    evidence_artifacts_to_collect?: NonEmptyArray<string>;
  }>;
  reviewer_validation_scripts?: Array<{
    validation_script_ref: string;
    validation_path_ref: string;
    script_package_status: "included_base_package" | "additional_script_candidate_pricing_tbd";
    included_script_slot?: number;
    pricing_note?: NonEmptyString;
    purpose: NonEmptyString;
    prerequisites: NonEmptyString;
    execution_steps: NonEmptyString;
    expected_output: NonEmptyString;
    safety_notes: NonEmptyString;
    output_attachment_instructions: NonEmptyString;
    script_content: NonEmptyString;
  }>;
  evidence_consumer_export: "include" | "exclude";
  visibility: "customer_facing" | "internal_only";
  source_derived_class: "retained_review_artifact";
  accepted_risk_outcome?: {
    accepted_risk_record_ref: string;
    actor_category: "customer_user" | "reviewer" | "vendor_service";
    evidence_basis_summary: NonEmptyString;
    evidence_refs: Array<string>;
    customer_acceptance_summary: NonEmptyString;
    risk_owner?: NonEmptyString;
    scope_of_acceptance?: NonEmptyString;
    review_by_date?: string;
    remediation_context_ref?: string;
    validation_path_ref?: string;
    limitations: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    evidence_consumer_export: "include" | "exclude";
  };
  false_positive_outcome?: {
    false_positive_record_ref: string;
    actor_category: "reviewer";
    evidence_basis_summary: NonEmptyString;
    evidence_refs: Array<string>;
    rationale_summary: NonEmptyString;
    candidate_finding_refs?: NonEmptyArray<string>;
    limitations: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    evidence_consumer_export: "include" | "exclude";
  };
};

export type CustomerRemediationStatusRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  customer_status_record_id: string;
  finding_ref?: string;
  classification_record_ref?: string;
  remediation_guidance_ref?: string;
  customer_remediation_status: "not_started" | "planned" | "in_progress" | "remediated_by_customer" | "validation_pending" | "deferred" | "not_applicable";
  owner?: NonEmptyString;
  due_date?: string;
  target_state?: NonEmptyString;
  customer_notes?: NonEmptyString;
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "customer_user";
    actor_id: NonEmptyString;
  };
  field_export_policy?: {
    owner: "include" | "exclude";
    due_date: "include" | "exclude";
    target_state: "include" | "exclude";
    customer_notes: "include" | "exclude";
  };
  visibility: "customer_facing" | "internal_only";
  source_derived_class: "retained_review_artifact";
};

export type DeletionEvidence = {
  protocol_version: ProtocolVersion;
  deletion_evidence_id: string;
  deleted_artifact_digests: NonEmptyArray<ArtifactDigest>;
  deletion_method: "crypto_erase" | "secure_delete" | "key_destruction" | "expiry_purge";
  deletion_timestamp: UtcRfc3339Timestamp;
  actor: ActorReference;
  verification_status: "verified" | "unverified";
  supersedes_deletion_evidence_ref?: string;
};

export type DisclosurePolicy = {
  protocol_version: ProtocolVersion;
  disclosure_policy_id: AlgorithmPrefixedSha256Id;
  created_at: UtcRfc3339Timestamp;
  review_scope_ref: AlgorithmPrefixedSha256Id;
  scanner_finding_set_ref?: AlgorithmPrefixedSha256Id;
  coverage_mode: CoverageMode;
  include_metadata: boolean;
  include_dependency_information: boolean;
  include_scanner_findings: boolean;
  evidence_categories: Array<{
    category: "metadata" | "dependencies" | "scanner_findings" | "raw_snippets" | "targeted_files" | "derived_artifacts" | "never_collected_items";
    included: boolean;
    source_derived_class: RetentionSourceDerivedClass;
    retention_handling: NonEmptyString;
    limitation?: NonEmptyString;
  }>;
  snippet_policy: {
    allow_raw_snippets: boolean;
    max_snippet_chars: number;
    context_lines: number;
    redaction_profile: NonEmptyString;
    raw_snippet_default_class: "transient_source_derived";
    selection_behavior: "none" | "finding_context" | "extended_selected_files_or_areas";
    selected_files_or_areas: Array<NonEmptyString>;
  };
  redaction_policy: {
    enabled: boolean;
    profile: NonEmptyString;
    configuration_version: NonEmptyString;
    limitation: NonEmptyString;
  };
  retention_policy: {
    raw_snippet_class: RetentionSourceDerivedClass;
    targeted_file_class: RetentionSourceDerivedClass;
    retain_source_opt_in: boolean;
    retention_period: NonEmptyString;
  };
  warnings: NonEmptyArray<NarrativeString>;
  limitations: Array<NarrativeString>;
  synthetic_fixture_markers?: Array<"SYNTHETIC_DEMO_DATA" | "NOT_CUSTOMER_SOURCE">;
};

export type EnvironmentEvidenceGate = {
  protocol_version: ProtocolVersion;
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  allowed_source_derived_classes: NonEmptyArray<RetentionSourceDerivedClass>;
  real_raw_snippet_acceptance: boolean;
  real_targeted_file_acceptance: boolean;
  access_control_ready: boolean;
  access_logging_ready: boolean;
  encryption_at_rest_ready: boolean;
  retention_defaults_ready: boolean;
  deletion_controls_ready: boolean;
  demo_budget_gate_ready: boolean;
  signing_release_trust_ready: boolean;
  retention_period_required: boolean;
  evidence_boundary: NonEmptyString;
  readiness_decision_ref?: AlgorithmPrefixedSha256Id;
  notes?: Array<NarrativeString>;
};

export type EnvironmentReadinessDecision = {
  protocol_version: ProtocolVersion;
  readiness_decision_id: AlgorithmPrefixedSha256Id;
  previous_gate_version: number;
  proposed_gate_version: number;
  proposed_gate_approval_input_digest: AlgorithmPrefixedSha256Id;
  deployment_identity: "pilot";
  release_digest: AlgorithmPrefixedSha256Id;
  deployment_digest: AlgorithmPrefixedSha256Id;
  evidence_bindings: [{
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }];
  approvers: [{
    approval_role: "pilot_security_owner" | "pilot_operations_owner";
    actor: {
      actor_type: "reviewer";
      actor_id: NonEmptyString;
    };
  }, {
    approval_role: "pilot_security_owner" | "pilot_operations_owner";
    actor: {
      actor_type: "reviewer";
      actor_id: NonEmptyString;
    };
  }];
  decided_at: UtcRfc3339Timestamp;
  decision: "approved";
  limitations: NonEmptyArray<NarrativeString>;
  decision_signature: SignatureEnvelope;
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["readiness_decision_id" | "decision_signature", "readiness_decision_id" | "decision_signature"];
} | {
  protocol_version: ProtocolVersion;
  readiness_decision_id: AlgorithmPrefixedSha256Id;
  previous_gate_version: number;
  proposed_gate_version: number;
  proposed_gate_approval_input_digest: AlgorithmPrefixedSha256Id;
  deployment_identity: "pilot";
  release_digest: AlgorithmPrefixedSha256Id;
  deployment_digest: AlgorithmPrefixedSha256Id;
  evidence_bindings: [{
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }, {
    control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
    readiness_evidence_ref: AlgorithmPrefixedSha256Id;
  }];
  approvers: [{
    approval_role: "pilot_security_owner" | "pilot_operations_owner";
    actor: {
      actor_type: "reviewer";
      actor_id: NonEmptyString;
    };
  }, {
    approval_role: "pilot_security_owner" | "pilot_operations_owner";
    actor: {
      actor_type: "reviewer";
      actor_id: NonEmptyString;
    };
  }];
  decided_at: UtcRfc3339Timestamp;
  decision: "declined";
  limitations: NonEmptyArray<NarrativeString>;
  decision_signature?: SignatureEnvelope;
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["readiness_decision_id" | "decision_signature", "readiness_decision_id" | "decision_signature"];
};

export type EnvironmentReadinessEvidence = {
  protocol_version: ProtocolVersion;
  readiness_evidence_id: AlgorithmPrefixedSha256Id;
  control: "access_control_ready" | "access_logging_ready" | "encryption_at_rest_ready" | "retention_defaults_ready" | "deletion_controls_ready" | "demo_budget_gate_ready" | "signing_release_trust_ready";
  deployment_identity: "pilot";
  release_digest: AlgorithmPrefixedSha256Id;
  deployment_digest: AlgorithmPrefixedSha256Id;
  observed_at: UtcRfc3339Timestamp;
  evidence_attachments: NonEmptyArray<{
    check_id: string;
    attachment_digest: AlgorithmPrefixedSha256Id;
    collected_at: UtcRfc3339Timestamp;
  }>;
  result: "passed" | "failed";
  evidence_producer: ActorReference;
  independent_reviewer: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  reviewed_at: UtcRfc3339Timestamp;
  limitations: NonEmptyArray<NarrativeString>;
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["readiness_evidence_id"];
};

export type EvidenceLifecycleEvent = {
  protocol_version: ProtocolVersion;
  event_id: string;
  review_id: string;
  sequence_number: number;
  idempotency_key: NonEmptyString;
  event_type: "evidence_accessed";
  actor: ActorReference;
  event_timestamp: UtcRfc3339Timestamp;
  artifact_refs: NonEmptyArray<string>;
  source_derived_class: RetentionSourceDerivedClass;
  purpose?: NonEmptyString;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  deletion_evidence_ref?: string;
  retention_record_ref?: string;
  supersedes_event_id?: string;
} | {
  protocol_version: ProtocolVersion;
  event_id: string;
  review_id: string;
  sequence_number: number;
  idempotency_key: NonEmptyString;
  event_type: "evidence_deleted";
  actor: ActorReference;
  event_timestamp: UtcRfc3339Timestamp;
  artifact_refs: NonEmptyArray<string>;
  source_derived_class: RetentionSourceDerivedClass;
  purpose?: NonEmptyString;
  access_scope?: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  deletion_evidence_ref: string;
  retention_record_ref?: string;
  supersedes_event_id?: string;
} | {
  protocol_version: ProtocolVersion;
  event_id: string;
  review_id: string;
  sequence_number: number;
  idempotency_key: NonEmptyString;
  event_type: "retention_status_changed";
  actor: ActorReference;
  event_timestamp: UtcRfc3339Timestamp;
  artifact_refs: NonEmptyArray<string>;
  source_derived_class: RetentionSourceDerivedClass;
  purpose?: NonEmptyString;
  access_scope?: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  deletion_evidence_ref?: string;
  retention_record_ref?: string;
  supersedes_event_id?: string;
};

export type EvidenceMinimizationProjection = {
  protocol_version: ProtocolVersion;
  review_id: string;
  entries: NonEmptyArray<{
    artifact_ref: string;
    minimization_category: "retained_finding" | "retained_metadata" | "retained_attestation" | "retained_customer_opt_in_snippet" | "deleted_transient" | "never_collected";
    source_derived_class: RetentionSourceDerivedClass;
    deletion_evidence_ref?: string;
  }>;
};

export type FalsePositiveRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  false_positive_record_id: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  candidate_finding_refs?: NonEmptyArray<string>;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
  rationale: NonEmptyString;
  limitations: NonEmptyArray<NarrativeString>;
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
  field_export_policy?: {
    rationale: "include" | "exclude";
    limitations: "include" | "exclude";
    evidence_basis: "include" | "exclude";
    candidate_finding_refs: "include" | "exclude";
    evidence_consumer_export: "include" | "exclude";
  };
};

export type FindingClassificationRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  classification_record_id: string;
  review_finding_draft_ref: string;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  classification: "confirmed";
  classified_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
  confirmation_criteria: NonEmptyArray<NonEmptyString>;
  defensible_confirmation_criteria?: NonEmptyString;
  threshold_gaps: Array<NarrativeString>;
  limitations: NonEmptyArray<NarrativeString>;
  rationale: NonEmptyString;
  validation_path_summary?: NonEmptyString;
  validation_path_ref?: string;
  supersedes_classification_record_ref?: string;
  supersedes_event_id?: AlgorithmPrefixedSha256Id;
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  classification_record_id: string;
  review_finding_draft_ref: string;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  classification: "likely" | "inconclusive" | "requires_customer_side_validation";
  classified_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
  confirmation_criteria: Array<NonEmptyString>;
  defensible_confirmation_criteria?: NonEmptyString;
  threshold_gaps: Array<NarrativeString>;
  limitations: NonEmptyArray<NarrativeString>;
  rationale: NonEmptyString;
  validation_path_summary?: NonEmptyString;
  validation_path_ref?: string;
  supersedes_classification_record_ref?: string;
  supersedes_event_id?: AlgorithmPrefixedSha256Id;
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type FindingRemediationGuidance = {
  protocol_version: ProtocolVersion;
  review_id: string;
  remediation_guidance_id: string;
  classification_record_ref: string;
  review_finding_draft_ref: string;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  guidance_status: "actionable_guidance_provided" | "limited_guidance_requires_validation" | "guidance_unavailable_from_submitted_evidence";
  authored_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  classification_context: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    confirmation_criteria: Array<NarrativeString>;
    evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  };
  exploitability_rationale?: NonEmptyString;
  suggested_remediation?: NonEmptyString;
  validation_steps?: NonEmptyString;
  insufficient_evidence_reason?: NonEmptyString;
  next_step_summary?: NonEmptyString;
  validation_path_summary?: NonEmptyString;
  validation_path_ref?: string;
  limitations: NonEmptyArray<NarrativeString>;
  evidence_refs: NonEmptyArray<string>;
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type FindingValidationPath = {
  protocol_version: ProtocolVersion;
  review_id: string;
  validation_path_id: string;
  classification_record_ref: string;
  review_finding_draft_ref: string;
  review_finding_draft_evidence_refs: NonEmptyArray<{
    artifact_ref: string;
    availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    available_for_review: boolean;
    display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
    deletion_evidence_ref?: string;
    source_derived_class: RetentionSourceDerivedClass;
  }>;
  remediation_guidance_ref?: string;
  path_type: "remote_dynamic_testing" | "customer_run_script" | "manual_steps";
  required_evidence: NonEmptyString;
  steps: NonEmptyString;
  expected_result: NonEmptyString;
  limitations: NonEmptyArray<NarrativeString>;
  included_pass_verifiability: "verifiable_within_included_pass" | "customer_provided_evidence_required" | "additional_agreement_required";
  reviewer_validation_script_refs?: NonEmptyArray<string>;
  output_attachment_instructions?: NonEmptyString;
  target?: NonEmptyString;
  authorization_assumption?: NonEmptyString;
  method?: NonEmptyString;
  safety_constraints?: NonEmptyString;
  evidence_artifacts_to_collect?: NonEmptyArray<string>;
  authored_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type IdentitySigningInput = {
  protocol_version: ProtocolVersion;
  signing_input_type: "outbound_manifest_identity" | "bundle_manifest_identity" | "vendor_receipt_identity" | "static_bundle_manifest_identity" | "attestation_package_finalization_identity" | "disclosure_policy_identity" | "review_event_identity" | "security_review_attestation_identity" | "signing_key_directory_identity" | "evidence_bundle_identity" | "runner_release_identity" | "environment_readiness_decision_identity";
  algorithm_profile: "ml_dsa_65";
  signed_identity_type: "outbound_manifest" | "evidence_bundle" | "vendor_receipt" | "static_bundle_manifest" | "attestation_package_finalization" | "disclosure_policy" | "review_event" | "security_review_attestation" | "signing_key_directory" | "runner_release" | "environment_readiness_decision";
  signed_identity: AlgorithmPrefixedSha256Id;
  canonicalization: "rfc8785";
  identity_input_path: string;
};

export type LocalRunnerAttempt = {
  protocol_version: ProtocolVersion;
  attempt_id: string;
  stage: "scope_init" | "scan_run" | "disclosure_configure" | "manifest_preview" | "approval" | "bundle_packaging" | "bundle_signing" | "bundle_prepare" | "status_inspect" | "runner_trust" | "submit";
  outcome: "succeeded" | "failed" | "declined" | "blocked";
  review_state: "unapproved_not_submitted" | "approved_no_signed_bundle" | "signed_bundle_not_submitted";
  approval_state: "not_requested" | "approved" | "declined" | "not_applicable";
  bundle_state: "not_created" | "failed_before_ready" | "ready_not_submitted";
  remote_state: "not_submitted" | "submit_attempted" | "received_with_receipt" | "rejected_no_receipt" | "quarantined_no_receipt";
  occurred_at: UtcRfc3339Timestamp;
  runner: {
    name: "codeattest-local-runner";
    version: NonEmptyString;
  };
  runner_trust: {
    runner_name: "codeattest-local-runner";
    runner_version: NonEmptyString;
    build_identifier: NonEmptyString;
    release_identifier: NonEmptyString;
    release_signature_status: "unsigned_local_build" | "untrusted_local_build" | "verified_release_signature";
    bundle_signing_mode: "managed_key" | "enrolled_runner_key";
    trust_label: "demo_only_unsigned" | "untrusted_local_dev" | "trusted_release";
    evidence_boundary: "synthetic-demo-only";
    release_verification_artifact?: NonEmptyString;
    limitations: NonEmptyArray<NarrativeString>;
  };
  identities: {
    selected_commit?: string;
    repository_identity?: AlgorithmPrefixedSha256Id;
    manifest_id?: AlgorithmPrefixedSha256Id;
    approval_id?: string;
    evidence_bundle_id?: AlgorithmPrefixedSha256Id;
    bundle_instance_id?: string;
    submission_attempt_id?: string;
    vendor_receipt_id?: AlgorithmPrefixedSha256Id;
    submission_outcome_id?: string;
  };
  approval_metadata?: {
    decision: "approved" | "declined";
    decided_at: UtcRfc3339Timestamp;
    approving_actor?: ActorReference;
  };
  diagnostics: {
    stage_failed?: "scope_init" | "scan_run" | "disclosure_configure" | "manifest_preview" | "approval" | "bundle_packaging" | "bundle_signing" | "bundle_prepare" | "status_inspect" | "runner_trust" | "submit";
    failure_code?: string;
    message: NonEmptyString;
    retryable: boolean;
    sensitive_detail_omitted: boolean;
    raw_snippets_printed: false;
    support_summary: NonEmptyString;
    local_artifact_paths?: Array<NonEmptyString>;
  };
  next_actions: NonEmptyArray<NarrativeString>;
};

export type LogCheckpoint = {
  protocol_version: ProtocolVersion;
  checkpoint_id: AlgorithmPrefixedSha256Id;
  deployment_identity: "demo" | "pilot";
  checkpoint_timestamp: UtcRfc3339Timestamp;
  merkle_root: Sha256Hex;
  tree_size: number;
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["checkpoint_id"];
};

export type OutboundManifest = {
  protocol_version: ProtocolVersion;
  manifest_id: AlgorithmPrefixedSha256Id;
  generated_at: UtcRfc3339Timestamp;
  review_scope_ref: AlgorithmPrefixedSha256Id;
  disclosure_policy_ref: AlgorithmPrefixedSha256Id;
  scanner_finding_set_ref?: AlgorithmPrefixedSha256Id;
  selected_scope_summary: {
    selected_application: {
      application_id: NonEmptyString;
      display_name: NonEmptyString;
    };
    selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    repository_identity: AlgorithmPrefixedSha256Id;
    dependency_manifest_total_count: number;
    dependency_manifest_detected_count: number;
  };
  runner: {
    name: "codeattest-local-runner";
    version: NonEmptyString;
  };
  coverage_mode: CoverageMode;
  disclosure_policy_summary: {
    disclosure_policy_ref: AlgorithmPrefixedSha256Id;
    coverage_mode: CoverageMode;
    redaction_profile: NonEmptyString;
    redaction_configuration_version: NonEmptyString;
    retention_period: NonEmptyString;
  };
  evidence_categories: Array<{
    category: "metadata" | "dependencies" | "scanner_findings" | "raw_snippets" | "targeted_files" | "derived_artifacts" | "never_collected_items";
    included: boolean;
    inclusion_state: "included" | "excluded_by_policy" | "never_collected";
    count: number;
    reference: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    source_code_disclosure: boolean;
    redaction_state: "not_applicable" | "redaction_not_configured" | "redaction_configured";
    redaction_configuration_version: NonEmptyString;
    retention_handling: NonEmptyString;
    limitation: NonEmptyString;
    details: NonEmptyArray<NarrativeString>;
    snippet_controls?: {
      max_snippet_chars: number;
      context_lines: number;
      redaction_profile: NonEmptyString;
      redaction_configuration_version: NonEmptyString;
      retention_class: RetentionSourceDerivedClass;
      selected_files_or_areas: Array<NonEmptyString>;
    };
  }>;
  artifact_references: Array<ArtifactReference>;
  package_preview_state: {
    state: "preview_generated";
    send_ready: false;
    local_only: true;
  };
  approval: {
    approval_state: "not_requested";
  };
  warnings: NonEmptyArray<NarrativeString>;
  limitations: NonEmptyArray<NarrativeString>;
};

export type PilotFeedbackRecord = {
  protocol_version: ProtocolVersion;
  pilot_feedback_record_id: string;
  record_version: number;
  review_id: string;
  recorded_at: UtcRfc3339Timestamp;
  recorded_by: {
    actor_type: "reviewer" | "vendor_service";
    actor_id: NonEmptyString;
  };
  feedback_source: "customer_admin_aggregate" | "evidence_consumer_aggregate" | "reviewer_observation";
  usefulness_rating: number;
  repeat_intent: "yes" | "no" | "unsure" | "not_asked";
  pay_intent: "yes" | "no" | "unsure" | "not_asked";
  mapping_feedback: Array<{
    mapping_profile: "soc_2_supporting_evidence" | "generic_technology_risk" | "customer_security_review" | "not_used";
    usefulness_rating: number;
  }>;
  objection_codes: Array<"scope_too_narrow" | "evidence_too_limited" | "mapping_not_applicable" | "signature_profile_demo_only" | "offline_package_usability" | "pricing_uncertain" | "turnaround" | "other_content_free">;
  caveats: NonEmptyArray<NarrativeString>;
  content_free: true;
  pii_free: true;
  visibility: "internal_only";
  source_derived_class: "retained_review_artifact";
};

export type PilotMetricRecord = {
  protocol_version: ProtocolVersion;
  pilot_metric_record_id: string;
  record_version: number;
  review_id: string;
  recorded_at: UtcRfc3339Timestamp;
  recorded_by: {
    actor_type: "reviewer" | "vendor_service";
    actor_id: NonEmptyString;
  };
  measurement_window: {
    start_timestamp: UtcRfc3339Timestamp;
    end_timestamp: UtcRfc3339Timestamp;
  };
  metrics: {
    candidate_finding_count: number;
    classified_finding_count: number;
    actionable_classification_count: number;
    review_hours: number;
    validation_hours: number;
    turnaround_hours: number;
    disclosure_mode: CoverageMode;
    submission_rejection_count: number;
    repeat_intent_signal: "yes" | "no" | "unsure" | "not_asked";
    pay_intent_signal: "yes" | "no" | "unsure" | "not_asked";
  };
  caveats: NonEmptyArray<NarrativeString>;
  content_free: true;
  pii_free: true;
  visibility: "internal_only";
  source_derived_class: "retained_review_artifact";
};

export type RetentionOptInRecord = {
  protocol_version: ProtocolVersion;
  retention_record_id: string;
  source_derived_class: "customer_opt_in_retained_source";
  customer_approval_ref: string;
  retention_period: {
    start_timestamp: UtcRfc3339Timestamp;
    end_timestamp: UtcRfc3339Timestamp;
  };
  retained_artifact_refs: NonEmptyArray<string>;
  retention_status_event_ids?: NonEmptyArray<string>;
};

export type RetentionSourceDerivedClass = "never_collected" | "transient_source_derived" | "retained_review_artifact" | "customer_opt_in_retained_source";

export type ReviewEventCustomerProjection = {
  protocol_version: ProtocolVersion;
  review_id: string;
  entries: Array<{
    event_id: AlgorithmPrefixedSha256Id;
    event_type: "receipt_issued" | "submission_rejected" | "submission_quarantined" | "classification_recorded" | "remediation_guidance_recorded" | "validation_recorded" | "verification_scope_recorded" | "verification_evidence_recorded" | "verification_recorded" | "customer_remediation_recorded" | "false_positive_recorded" | "customer_accepted_risk_recorded" | "attestation_generated" | "static_bundle_generated" | "attestation_package_finalized" | "attestation_package_exported" | "evidence_deleted" | "retention_status_changed" | "evidence_accessed" | "key_rotation_recorded";
    event_timestamp: UtcRfc3339Timestamp;
    actor_category: "local_runner" | "customer_user" | "vendor_service" | "reviewer";
    artifact_refs: NonEmptyArray<string>;
    visibility: "customer_facing";
    reason?: NonEmptyString;
  }>;
};

export type ReviewEventLog = {
  protocol_version: ProtocolVersion;
  review_id: string;
  events: Array<ReviewEvent>;
};

export type ReviewEvent = {
  protocol_version: ProtocolVersion;
  event_id: AlgorithmPrefixedSha256Id;
  review_id: string;
  sequence_number: number;
  idempotency_key: NonEmptyString;
  event_type: "receipt_issued" | "submission_rejected" | "submission_quarantined" | "classification_recorded" | "remediation_guidance_recorded" | "validation_recorded" | "verification_scope_recorded" | "verification_evidence_recorded" | "verification_recorded" | "customer_remediation_recorded" | "false_positive_recorded" | "customer_accepted_risk_recorded" | "attestation_generated" | "static_bundle_generated" | "attestation_package_finalized" | "attestation_package_exported" | "pilot_metric_recorded" | "pilot_feedback_recorded" | "evidence_deleted" | "retention_status_changed" | "evidence_accessed" | "key_rotation_recorded";
  actor: ActorReference;
  event_timestamp: UtcRfc3339Timestamp;
  artifact_refs: NonEmptyArray<string>;
  visibility: "customer_facing" | "internal_only";
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["event_id"];
  source_derived_class?: RetentionSourceDerivedClass;
  reason?: NonEmptyString;
  customer_actor_ref?: string;
  customer_selection_evidence_ref?: string;
  internal_note?: NonEmptyString;
  supersedes_event_id?: AlgorithmPrefixedSha256Id;
  supersedes_classification_record_ref?: string;
};

export type ReviewFindingDraftSet = {
  protocol_version: ProtocolVersion;
  review_id: string;
  normalization_run_id: string;
  normalization_status: "drafts_created" | "no_findings_produced";
  created_at: UtcRfc3339Timestamp;
  vendor_receipt_ref: AlgorithmPrefixedSha256Id;
  evidence_bundle_id: AlgorithmPrefixedSha256Id;
  manifest_id: AlgorithmPrefixedSha256Id;
  source_scanner_finding_set_ref: AlgorithmPrefixedSha256Id;
  coverage_mode: CoverageMode;
  review_finding_drafts: Array<{
    review_finding_draft_id: string;
    candidate_finding_refs: NonEmptyArray<string>;
    group_key: NonEmptyString;
    sources: NonEmptyArray<"regex" | "semgrep">;
    affected_area: NonEmptyString;
    evidence_refs: Array<{
      artifact_ref: string;
      availability_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
      available_for_review: boolean;
      display_state: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
      deletion_evidence_ref?: string;
      source_derived_class: RetentionSourceDerivedClass;
    }>;
    severity?: NonEmptyString;
    confidence?: "low" | "medium" | "high" | "unknown";
    scanner_rule_ids: NonEmptyArray<NonEmptyString>;
    status: "draft";
    review_lifecycle_state: "under_review";
    coverage_mode: CoverageMode;
    evidence_basis: NonEmptyArray<"scanner_output" | "metadata_only" | "finding_context_snippet" | "extended_approved_source_context" | "retained_review_artifact" | "deleted_under_policy_reference" | "not_submitted_by_policy_reference" | "never_collected_reference" | "unresolved_reference">;
    threshold_gaps: Array<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    source_derived_class: "retained_review_artifact";
  }>;
  normalization_limitations: Array<NarrativeString>;
  no_findings_statement?: NonEmptyString;
  source_derived_class: "retained_review_artifact";
};

export type ReviewScope = {
  protocol_version: ProtocolVersion;
  review_scope_id: AlgorithmPrefixedSha256Id;
  review_id: string;
  generated_at: UtcRfc3339Timestamp;
  selected_application: {
    application_id: NonEmptyString;
    display_name: NonEmptyString;
  };
  selected_commit: {
    commit_sha: string;
    source_control_system: "git";
  };
  repository_identity: AlgorithmPrefixedSha256Id;
  runner: {
    name: "codeattest-local-runner";
    version: NonEmptyString;
  };
  technical_context: NonEmptyArray<{
    context_type: "language" | "framework" | "package_manager" | "scanner" | "ci_provider";
    status: "detected" | "not_detected" | "unsupported" | "not_collected";
    value?: string;
  }>;
  dependency_manifests: NonEmptyArray<{
    manifest_type: "package_json" | "package_lock" | "requirements_txt" | "pyproject_toml" | "pipfile" | "pipfile_lock" | "pnpm_lock" | "yarn_lock";
    status: "detected" | "not_found" | "unsupported" | "malformed";
    path?: NonEmptyString;
    package_manager: "npm" | "pnpm" | "yarn" | "pip" | "poetry" | "pipenv" | "unknown";
    dependency_count: number;
    dependencies: Array<NonEmptyString>;
    limitation?: NonEmptyString;
  }>;
};

export type ReviewerValidationScript = {
  protocol_version: ProtocolVersion;
  review_id: string;
  validation_script_id: string;
  validation_path_ref: string;
  classification_record_ref: string;
  remediation_guidance_ref?: string;
  script_package_status: "included_base_package" | "additional_script_candidate_pricing_tbd";
  included_script_slot?: number;
  purpose: NonEmptyString;
  prerequisites: NonEmptyString;
  execution_steps: NonEmptyString;
  expected_output: NonEmptyString;
  safety_notes: NonEmptyString;
  output_attachment_instructions: NonEmptyString;
  script_content: NonEmptyString;
  authored_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type RunnerKeyEnrollmentRecord = {
  protocol_version: ProtocolVersion;
  enrollment_id: string;
  review_id: string;
  runner_key_id: NonEmptyString;
  runner_key_version: NonEmptyString;
  algorithm_profile: "ml_dsa_65";
  public_key: MlDsa65PublicKey;
  enrollment_method: "operator_verified" | "trust_on_first_use";
  enrolled_at: UtcRfc3339Timestamp;
  limitations: NonEmptyArray<NarrativeString>;
};

export type RunnerReleaseRecord = {
  protocol_version: ProtocolVersion;
  release_identifier: NonEmptyString;
  build_identifier: NonEmptyString;
  artifact_digest: AlgorithmPrefixedSha256Id;
  released_at: UtcRfc3339Timestamp;
  limitations: NonEmptyArray<NarrativeString>;
};

export type ScannerFindingSet = {
  protocol_version: ProtocolVersion;
  scanner_finding_set_id: AlgorithmPrefixedSha256Id;
  generated_at: UtcRfc3339Timestamp;
  review_scope_ref: AlgorithmPrefixedSha256Id;
  runner: {
    name: "codeattest-local-runner";
    version: NonEmptyString;
  };
  source_derived_class: "retained_review_artifact";
  scanner_runs: NonEmptyArray<{
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "succeeded";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason?: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  } | {
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "no_findings";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason?: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  } | {
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "unavailable";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  } | {
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "failed";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  } | {
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "invalid_output";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  } | {
    scanner_name: "regex" | "semgrep";
    scanner_version: NonEmptyString;
    ruleset_identifier: NonEmptyString;
    executed_at: UtcRfc3339Timestamp;
    status: "skipped";
    covered_file_group: "typescript_javascript" | "python" | "mixed" | "unsupported";
    scanned_files: Array<NonEmptyString>;
    failure_reason: NonEmptyString;
    rerun_possible: boolean;
    source_derived_class: "retained_review_artifact";
  }>;
  candidate_findings: Array<{
    candidate_finding_id: string;
    source: "regex" | "semgrep";
    affected_area: NonEmptyString;
    severity?: NonEmptyString;
    confidence?: "low" | "medium" | "high" | "unknown";
    scanner_rule_id: NonEmptyString;
    original_reference: NonEmptyString;
    source_artifact_refs: Array<string>;
    status: "candidate";
    source_derived_class: "retained_review_artifact";
  }>;
  coverage_limitations: Array<NarrativeString>;
  artifact_references: Array<ArtifactReference>;
};

export type SecurityReviewAttestation = {
  protocol_version: ProtocolVersion;
  attestation_id: string;
  attestation_version: number;
  review_id: string;
  generated_at: UtcRfc3339Timestamp;
  generated_by: {
    actor_type: "reviewer" | "vendor_service";
    actor_id: NonEmptyString;
  };
  review_scope_ref: AlgorithmPrefixedSha256Id;
  selected_commit: {
    commit_sha: string;
    source_control_system: "git";
  };
  repository_identity: AlgorithmPrefixedSha256Id;
  method: {
    coverage_mode: CoverageMode;
    scanner_versions: NonEmptyArray<NonEmptyString>;
    tooling_summary: NonEmptyString;
    disclosure_summary: NonEmptyString;
    method_limitations: NonEmptyArray<NarrativeString>;
  };
  receipt_chain: {
    manifest_id: AlgorithmPrefixedSha256Id;
    evidence_bundle_id: AlgorithmPrefixedSha256Id;
    vendor_receipt_id: AlgorithmPrefixedSha256Id;
    receipt_timestamp: UtcRfc3339Timestamp;
    verification_state: "received_with_receipt";
  };
  sections: [{
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }, {
    section_id: string;
    section_type: "scope" | "method" | "receipt_chain" | "findings_and_classification" | "remediation_and_validation" | "verification_outcomes" | "evidence_lifecycle" | "limitations";
    title: NonEmptyString;
    summary: NonEmptyString;
    scope: NonEmptyString;
    evidence_basis: NonEmptyArray<NarrativeString>;
    limitations: NonEmptyArray<NarrativeString>;
    supporting_artifact_refs: NonEmptyArray<string>;
  }];
  verification_addendum_refs: Array<string>;
  evidence_minimization_ref: string;
  deletion_evidence_refs: Array<string>;
  supporting_evidence_mapping_ref?: string;
  limitations: NonEmptyArray<NarrativeString>;
  supporting_artifact_refs: NonEmptyArray<string>;
  customer_safe_projection: true;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing";
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["attestation_id"];
};

export type SignatureEnvelope = {
  protocol_version: ProtocolVersion;
  algorithm_profile: "ml_dsa_65";
  key_id: NonEmptyString;
  key_version: NonEmptyString;
  signing_time: UtcRfc3339Timestamp;
  signed_identity_type: "outbound_manifest" | "evidence_bundle" | "vendor_receipt" | "static_bundle_manifest" | "attestation_package_finalization" | "disclosure_policy" | "review_event" | "security_review_attestation" | "signing_key_directory" | "runner_release" | "environment_readiness_decision";
  signed_identity: AlgorithmPrefixedSha256Id;
  canonicalization: "rfc8785";
  signing_mode: "managed_key" | "enrolled_runner_key";
  signing_limitations: NonEmptyArray<NarrativeString>;
  signature_bytes: MlDsa65Signature;
};

export type SignatureVerificationOutcome = {
  protocol_version: ProtocolVersion;
  signed_identity_type: "outbound_manifest" | "evidence_bundle" | "vendor_receipt" | "static_bundle_manifest" | "attestation_package_finalization" | "disclosure_policy" | "review_event" | "security_review_attestation" | "signing_key_directory" | "environment_readiness_decision";
  signed_identity: AlgorithmPrefixedSha256Id;
  algorithm_profile: "ml_dsa_65";
  key_id: NonEmptyString;
  key_version: NonEmptyString;
  key_directory_version: number;
  verified_at: UtcRfc3339Timestamp;
  result: "verified" | "signature_bytes_untrusted" | "signature_key_unknown" | "signature_key_revoked" | "signature_key_outside_validity_window" | "signature_key_algorithm_mismatch" | "signature_key_directory_untrusted" | "signature_signing_input_mismatch";
};

export type SigningKeyDirectory = {
  protocol_version: ProtocolVersion;
  directory_version: number;
  trust_anchor_key_id: NonEmptyString;
  published_at: UtcRfc3339Timestamp;
  keys: NonEmptyArray<SigningKeyRecord>;
  directory_signature: SignatureEnvelope;
};

export type SigningKeyRecord = {
  protocol_version: ProtocolVersion;
  key_id: NonEmptyString;
  key_version: NonEmptyString;
  algorithm_profile: "ml_dsa_65";
  public_key: MlDsa65PublicKey;
  custody_mode: "offline_trust_anchor" | "self_hosted_software" | "customer_held_runner";
  valid_from: UtcRfc3339Timestamp;
  valid_until?: UtcRfc3339Timestamp;
  status: "active" | "retired" | "revoked";
  limitations: NonEmptyArray<NarrativeString>;
};

export type StaticBundleManifest = {
  protocol_version: ProtocolVersion;
  static_bundle_id: string;
  static_bundle_manifest_id: AlgorithmPrefixedSha256Id;
  manifest_version: number;
  package_state: "generated" | "finalized";
  review_id: string;
  created_at: UtcRfc3339Timestamp;
  supersedes_static_bundle_manifest_id?: AlgorithmPrefixedSha256Id;
  attestation_ref: string;
  vendor_receipt_ref: AlgorithmPrefixedSha256Id;
  evidence_bundle_representation: {
    evidence_bundle_id: AlgorithmPrefixedSha256Id;
    bundle_manifest_ref: string;
    signature_ref: string;
    identity_ref: string;
    retained_export_approved_payload_refs: Array<string>;
  };
  portal_projection_ref: string;
  files: Array<{
    relative_path: string;
    artifact_ref: string;
    media_type: NonEmptyString;
    digest: ArtifactDigest;
    size_bytes: number;
    artifact_role: "attestation" | "vendor_receipt" | "evidence_bundle_representation" | "supporting_evidence" | "portal" | "portal_asset" | "verification_metadata";
    source_derived_class: "never_collected" | "retained_review_artifact" | "customer_opt_in_retained_source";
    inclusion_reason: NonEmptyString;
  }>;
  minimization_disposition: {
    included_retained_refs: Array<string>;
    excluded_refs: Array<string>;
    deleted_refs: Array<string>;
    never_collected_refs: Array<string>;
  };
  verification_metadata: {
    manifest_signature_ref: string;
    signing_input_ref: string;
    verification_instructions_path: string;
    offline_verification_supported: true;
    all_file_digests_verified: true;
  };
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["static_bundle_manifest_id"];
};

export type StaticBundleVerificationPackage = {
  protocol_version: ProtocolVersion;
  attachment_index_id: AlgorithmPrefixedSha256Id;
  signed_payload_manifest_id: AlgorithmPrefixedSha256Id;
  signing_input_attachment: {
    relative_path: "verification/static-bundle-signing-input.json";
    artifact_ref: "artifact_ref:static_bundle_signing_input";
    media_type: "application/json";
    digest: ArtifactDigest;
    size_bytes: number;
    signing_input: IdentitySigningInput;
  };
  signature_attachment: {
    relative_path: "verification/static-bundle-signature.json";
    artifact_ref: "artifact_ref:static_bundle_signature";
    media_type: "application/json";
    digest: ArtifactDigest;
    size_bytes: number;
    signature_envelope: SignatureEnvelope;
  };
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["attachment_index_id"];
};

export type StaticPortalProjection = {
  protocol_version: ProtocolVersion;
  static_portal_projection_id: string;
  review_id: string;
  static_bundle_id: string;
  static_bundle_manifest_ref: AlgorithmPrefixedSha256Id;
  generated_at: UtcRfc3339Timestamp;
  navigation: [{
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }, {
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    label: NonEmptyString;
    relative_path: string;
    order: number;
  }];
  documents: [{
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }, {
    document_id: string;
    section_id: "overview" | "scope" | "receipt_chain" | "methods" | "findings" | "validation_remediation" | "limitations" | "appendices";
    title: NonEmptyString;
    summary: NonEmptyString;
    relative_path: string;
    source_artifact_refs: NonEmptyArray<string>;
    copyable_identity_values: Array<NonEmptyString>;
    phone_summary: NonEmptyString;
    print_included: true;
    search_included: true;
  }];
  capabilities: {
    offline_navigation: true;
    offline_search: true;
    print_export: true;
    copy_controls: true;
    phone_readable_summaries: true;
  };
  asset_policy: {
    remote_assets_allowed: false;
    analytics_allowed: false;
    live_api_calls_allowed: false;
    runtime_authorization_required: false;
    relative_links_only: true;
  };
  customer_safe_projection: true;
  visibility: "customer_facing";
};

export type StoredObjectClassification = {
  protocol_version: ProtocolVersion;
  stored_object_ref: string;
  object_kind: "evidence_artifact" | "queue_payload" | "worker_scratch" | "generated_export" | "support_attachment" | "log_or_trace" | "analytics_record" | "crash_report";
  source_derived_class: RetentionSourceDerivedClass;
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  artifact_ref?: string;
};

export type SubmissionOutcome = {
  protocol_version: ProtocolVersion;
  submission_outcome_id: string;
  review_id: string;
  outcome_state: "received_with_receipt";
  bundle_instance_id: string;
  submission_attempt_id: string;
  occurred_at: UtcRfc3339Timestamp;
  submission_identities: NonEmptyArray<{
    identity_type: "manifest_id" | "evidence_bundle_id" | "review_request_id" | "bundle_instance_id" | "submission_attempt_id";
    identity_value: string;
  }>;
  failure_reason_codes?: Array<string>;
  vendor_receipt_ref: AlgorithmPrefixedSha256Id;
  next_path: "retry" | "quarantine_support" | "contact_support" | "verify_receipt";
  customer_facing_summary: string;
} | {
  protocol_version: ProtocolVersion;
  submission_outcome_id: string;
  review_id: string;
  outcome_state: "rejected_no_receipt";
  bundle_instance_id: string;
  submission_attempt_id: string;
  occurred_at: UtcRfc3339Timestamp;
  submission_identities: NonEmptyArray<{
    identity_type: "manifest_id" | "evidence_bundle_id" | "review_request_id" | "bundle_instance_id" | "submission_attempt_id";
    identity_value: string;
  }>;
  failure_reason_codes: Array<string>;
  vendor_receipt_ref?: AlgorithmPrefixedSha256Id;
  next_path: "retry" | "quarantine_support" | "contact_support" | "verify_receipt";
  customer_facing_summary: string;
} | {
  protocol_version: ProtocolVersion;
  submission_outcome_id: string;
  review_id: string;
  outcome_state: "quarantined_no_receipt";
  bundle_instance_id: string;
  submission_attempt_id: string;
  occurred_at: UtcRfc3339Timestamp;
  submission_identities: NonEmptyArray<{
    identity_type: "manifest_id" | "evidence_bundle_id" | "review_request_id" | "bundle_instance_id" | "submission_attempt_id";
    identity_value: string;
  }>;
  failure_reason_codes: Array<string>;
  vendor_receipt_ref?: AlgorithmPrefixedSha256Id;
  next_path: "retry" | "quarantine_support" | "contact_support" | "verify_receipt";
  customer_facing_summary: string;
};

export type SupportingEvidenceMapping = {
  protocol_version: ProtocolVersion;
  supporting_evidence_mapping_id: string;
  mapping_version: number;
  review_id: string;
  attestation_ref: string;
  mapping_profile: "soc_2_supporting_evidence" | "generic_technology_risk" | "customer_security_review";
  approval_state: "approved";
  approved_at: UtcRfc3339Timestamp;
  approved_by: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  decision_authority: NonEmptyString;
  acceptance_disclaimer: NonEmptyString;
  entries: NonEmptyArray<{
    mapping_entry_id: string;
    topic: NonEmptyString;
    supporting_evidence_role: NonEmptyString;
    scope_summary: NonEmptyString;
    method_summary: NonEmptyString;
    receipt_context: NonEmptyString;
    evidence_refs: NonEmptyArray<string>;
    limitations: NonEmptyArray<NarrativeString>;
  }>;
  limitations: NonEmptyArray<NarrativeString>;
  visibility: "customer_facing";
  source_derived_class: "retained_review_artifact";
};

export type VendorReceipt = {
  protocol_version: ProtocolVersion;
  vendor_receipt_id: AlgorithmPrefixedSha256Id;
  evidence_bundle_id: AlgorithmPrefixedSha256Id;
  manifest_id: AlgorithmPrefixedSha256Id;
  receipt_timestamp: UtcRfc3339Timestamp;
  receiving_environment: {
    environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
    evidence_boundary: NonEmptyString;
  };
  verification_state: "received_with_receipt";
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: Array<"vendor_receipt_id" | "receipt_signature" | "public_verification_metadata.signed_identity">;
  source_derived_class: "retained_review_artifact";
  approved_outbound_manifest_ref: string;
  bundle_instance_id: string;
  submission_attempt_id: string;
  selected_application: {
    application_id: NonEmptyString;
    display_name: NonEmptyString;
  };
  selected_commit: {
    commit_sha: string;
    source_control_system: "git";
  };
  repository_identity_hash: AlgorithmPrefixedSha256Id;
  coverage_mode: CoverageMode;
  disclosure_policy_ref: AlgorithmPrefixedSha256Id;
  disclosure_policy_summary: {
    disclosure_policy_ref: AlgorithmPrefixedSha256Id;
    coverage_mode: CoverageMode;
    redaction_profile: NonEmptyString;
    redaction_configuration_version: NonEmptyString;
    retention_period: NonEmptyString;
  };
  approved_artifact_count_summary: {
    count_domain: "evidence_category_counts";
    total_count: number;
    categories: NonEmptyArray<{
      category: "metadata" | "dependencies" | "scanner_findings" | "raw_snippets" | "targeted_files" | "derived_artifacts" | "never_collected_items";
      count: number;
    }>;
  };
  received_artifact_count_summary: {
    count_domain: "evidence_category_counts";
    total_count: number;
    categories: NonEmptyArray<{
      category: "metadata" | "dependencies" | "scanner_findings" | "raw_snippets" | "targeted_files" | "derived_artifacts" | "never_collected_items";
      count: number;
    }>;
  };
  approved_vs_received_comparison: {
    comparison_state: "matched";
    rows: [{
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }, {
      field: NonEmptyString;
      approved_value: NonEmptyString;
      received_value: NonEmptyString;
      result: "matched";
    }];
  };
  receipt_signature: SignatureEnvelope;
  public_verification_metadata: {
    protocol_version: ProtocolVersion;
    algorithm_profile: "ml_dsa_65";
    canonicalization: "rfc8785";
    key_id: NonEmptyString;
    key_version: NonEmptyString;
    public_key_reference: NonEmptyString;
    signing_time: UtcRfc3339Timestamp;
    signed_identity_type: "vendor_receipt";
    signed_identity: AlgorithmPrefixedSha256Id;
    signing_mode: "managed_key" | "enrolled_runner_key";
    signing_limitations: NonEmptyArray<NarrativeString>;
  };
  key_rotation_readiness: {
    historical_key_id: NonEmptyString;
    historical_key_version: NonEmptyString;
    event_append_hint: NonEmptyString;
  };
};

export type VerificationAddendum = {
  protocol_version: ProtocolVersion;
  verification_addendum_id: string;
  review_id: string;
  verification_pass_id: string;
  review_scope_ref: AlgorithmPrefixedSha256Id;
  verification_pass_ref: string;
  selected_commit: {
    commit_sha: string;
    source_control_system: "git";
  };
  repository_identity: AlgorithmPrefixedSha256Id;
  generated_at: UtcRfc3339Timestamp;
  findings: NonEmptyArray<{
    review_finding_draft_ref: string;
    classification_record_ref: string;
    current_classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    verification_status: "verification_complete" | "verification_pending" | "not_verified" | "requires_customer_side_validation";
    reviewer_actor_category: "reviewer";
    verification_record_ref: string;
    verification_evidence_record_refs: NonEmptyArray<string>;
    remediation_guidance_ref?: string;
    validation_path_ref?: string;
    accepted_risk_record_ref?: string;
    false_positive_record_ref?: string;
    timestamp: UtcRfc3339Timestamp;
    summary: NonEmptyString;
    remaining_limitations: NonEmptyArray<NarrativeString>;
    next_step_summary?: NonEmptyString;
  }>;
  retained_evidence: Array<{
    artifact_ref: string;
    source_derived_class: "retained_review_artifact" | "customer_opt_in_retained_source";
    recorded_at: UtcRfc3339Timestamp;
  }>;
  deleted_evidence: Array<{
    artifact_ref: string;
    deletion_evidence_ref: string;
    deletion_timestamp: UtcRfc3339Timestamp;
    deletion_verification_status: "verified" | "pending" | "unavailable";
  }>;
  history_refs: NonEmptyArray<AlgorithmPrefixedSha256Id>;
  limitations: NonEmptyArray<NarrativeString>;
  next_step_summary?: NonEmptyString;
  finalization_state: "finalized" | "not_finalized";
  visibility: "customer_facing";
  source_derived_class: "retained_review_artifact";
};

export type VerificationEvidenceRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_evidence_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  scope_version: number;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  requested_verification_type: "follow_up_commit";
  intake_state: "accepted_for_review" | "verification_pending" | "broader_context_required";
  state_reason: NonEmptyString;
  next_step_summary?: NonEmptyString;
  actor: {
    actor_type: "customer_user" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  follow_up_commit: {
    original_selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    follow_up_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    original_repository_identity: AlgorithmPrefixedSha256Id;
    follow_up_repository_identity: AlgorithmPrefixedSha256Id;
    relationship_to_selected_commit: "customer_declared_related" | "customer_declared_descendant" | "relationship_unverified" | "same_commit_submitted" | "repository_mismatch";
    relationship_basis: NonEmptyString;
  };
  validation_path_ref?: string;
  reviewer_validation_script_ref?: string;
  validation_artifacts?: NonEmptyArray<{
    artifact_ref: string;
    digest: ArtifactDigest;
    size_bytes: number;
    media_type: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    retention_record_ref?: string;
  }>;
  recorded_at: UtcRfc3339Timestamp;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  disclosure_state: "metadata_only";
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_evidence_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  scope_version: number;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  requested_verification_type: "customer_validation_evidence";
  intake_state: "accepted_for_review" | "verification_pending" | "broader_context_required";
  state_reason: NonEmptyString;
  next_step_summary?: NonEmptyString;
  actor: {
    actor_type: "customer_user" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  follow_up_commit?: {
    original_selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    follow_up_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    original_repository_identity: AlgorithmPrefixedSha256Id;
    follow_up_repository_identity: AlgorithmPrefixedSha256Id;
    relationship_to_selected_commit: "customer_declared_related" | "customer_declared_descendant" | "relationship_unverified" | "same_commit_submitted" | "repository_mismatch";
    relationship_basis: NonEmptyString;
  };
  validation_path_ref: string;
  reviewer_validation_script_ref?: string;
  validation_artifacts: NonEmptyArray<{
    artifact_ref: string;
    digest: ArtifactDigest;
    size_bytes: number;
    media_type: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    retention_record_ref?: string;
  }>;
  recorded_at: UtcRfc3339Timestamp;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  disclosure_state: "metadata_only";
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_evidence_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  scope_version: number;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  requested_verification_type: "reviewer_authored_script_output";
  intake_state: "accepted_for_review" | "verification_pending" | "broader_context_required";
  state_reason: NonEmptyString;
  next_step_summary?: NonEmptyString;
  actor: {
    actor_type: "customer_user" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  follow_up_commit?: {
    original_selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    follow_up_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    original_repository_identity: AlgorithmPrefixedSha256Id;
    follow_up_repository_identity: AlgorithmPrefixedSha256Id;
    relationship_to_selected_commit: "customer_declared_related" | "customer_declared_descendant" | "relationship_unverified" | "same_commit_submitted" | "repository_mismatch";
    relationship_basis: NonEmptyString;
  };
  validation_path_ref: string;
  reviewer_validation_script_ref: string;
  validation_artifacts: NonEmptyArray<{
    artifact_ref: string;
    digest: ArtifactDigest;
    size_bytes: number;
    media_type: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    retention_record_ref?: string;
  }>;
  recorded_at: UtcRfc3339Timestamp;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  disclosure_state: "metadata_only";
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_evidence_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  scope_version: number;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  requested_verification_type: "manual_validation_record";
  intake_state: "accepted_for_review" | "verification_pending" | "broader_context_required";
  state_reason: NonEmptyString;
  next_step_summary?: NonEmptyString;
  actor: {
    actor_type: "customer_user" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  follow_up_commit?: {
    original_selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    follow_up_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    original_repository_identity: AlgorithmPrefixedSha256Id;
    follow_up_repository_identity: AlgorithmPrefixedSha256Id;
    relationship_to_selected_commit: "customer_declared_related" | "customer_declared_descendant" | "relationship_unverified" | "same_commit_submitted" | "repository_mismatch";
    relationship_basis: NonEmptyString;
  };
  validation_path_ref: string;
  reviewer_validation_script_ref?: string;
  validation_artifacts: NonEmptyArray<{
    artifact_ref: string;
    digest: ArtifactDigest;
    size_bytes: number;
    media_type: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    retention_record_ref?: string;
  }>;
  recorded_at: UtcRfc3339Timestamp;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  disclosure_state: "metadata_only";
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_evidence_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  scope_version: number;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  requested_verification_type: "remote_dynamic_testing_evidence";
  intake_state: "accepted_for_review" | "verification_pending" | "broader_context_required";
  state_reason: NonEmptyString;
  next_step_summary?: NonEmptyString;
  actor: {
    actor_type: "customer_user" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  follow_up_commit?: {
    original_selected_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    follow_up_commit: {
      commit_sha: string;
      source_control_system: "git";
    };
    original_repository_identity: AlgorithmPrefixedSha256Id;
    follow_up_repository_identity: AlgorithmPrefixedSha256Id;
    relationship_to_selected_commit: "customer_declared_related" | "customer_declared_descendant" | "relationship_unverified" | "same_commit_submitted" | "repository_mismatch";
    relationship_basis: NonEmptyString;
  };
  validation_path_ref: string;
  reviewer_validation_script_ref?: string;
  validation_artifacts: NonEmptyArray<{
    artifact_ref: string;
    digest: ArtifactDigest;
    size_bytes: number;
    media_type: NonEmptyString;
    source_derived_class: RetentionSourceDerivedClass;
    retention_record_ref?: string;
  }>;
  recorded_at: UtcRfc3339Timestamp;
  access_scope: {
    tenant_id: NonEmptyString;
    review_scope: string;
  };
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  disclosure_state: "metadata_only";
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type VerificationPassScope = {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_pass_id: string;
  scope_version: number;
  included_pass_started_at: UtcRfc3339Timestamp;
  included_pass_start_basis?: NonEmptyString;
  scope_recorded_at: UtcRfc3339Timestamp;
  pass_deadline: UtcRfc3339Timestamp;
  actor: {
    actor_type: "customer_user" | "reviewer" | "vendor_service";
    actor_id: NonEmptyString;
  };
  customer_actor_ref?: string;
  customer_selection_evidence_ref?: string;
  selected_findings: NonEmptyArray<{
    review_finding_draft_ref: string;
    classification_record_ref: string;
    current_classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    remediation_guidance_ref?: string;
    customer_status_record_ref?: string;
    current_customer_remediation_status?: "not_started" | "planned" | "in_progress" | "remediated_by_customer" | "validation_pending" | "deferred" | "not_applicable";
    validation_path_ref?: string;
    reviewer_validation_script_refs?: NonEmptyArray<string>;
    accepted_risk_record_ref?: string;
    false_positive_record_ref?: string;
    requested_verification_type: "follow_up_commit" | "customer_validation_evidence" | "reviewer_authored_script_output" | "manual_validation_record" | "remote_dynamic_testing_evidence";
    eligibility_state: "eligible" | "out_of_scope" | "requires_additional_agreement" | "blocked_pending_validation_path";
    eligibility_reason: NonEmptyString;
    limitations: NonEmptyArray<NarrativeString>;
  }>;
  included_script_allocation: {
    included_slots: Array<{
      slot: number;
      validation_script_ref: string;
      finding_ref: string;
    }>;
    additional_script_candidates: Array<{
      validation_script_ref: string;
      finding_ref: string;
      pricing_posture: "pricing_tbd";
      reason: NonEmptyString;
    }>;
  };
  limitations: NonEmptyArray<NarrativeString>;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};

export type VerificationRecord = {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  verification_evidence_record_refs: NonEmptyArray<string>;
  verification_status: "verification_complete";
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  before_state: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    review_finding_draft_evidence_refs: NonEmptyArray<string>;
    evidence_basis: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    confirmation_criteria: NonEmptyArray<NarrativeString>;
  };
  after_state: {
    summary: NonEmptyString;
    criteria_results: NonEmptyArray<{
      criterion: NonEmptyString;
      result: "satisfied" | "not_satisfied" | "not_evaluated" | "customer_validation_required";
    }>;
    evidence_refs: NonEmptyArray<string>;
  };
  rationale: NonEmptyString;
  remaining_limitations: NonEmptyArray<NarrativeString>;
  next_step_summary?: NonEmptyString;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  verification_evidence_record_refs: NonEmptyArray<string>;
  verification_status: "verification_pending";
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  before_state: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    review_finding_draft_evidence_refs: NonEmptyArray<string>;
    evidence_basis: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    confirmation_criteria: NonEmptyArray<NarrativeString>;
  };
  after_state: {
    summary: NonEmptyString;
    criteria_results: NonEmptyArray<{
      criterion: NonEmptyString;
      result: "satisfied" | "not_satisfied" | "not_evaluated" | "customer_validation_required";
    }>;
    evidence_refs: NonEmptyArray<string>;
  };
  rationale: NonEmptyString;
  remaining_limitations: NonEmptyArray<NarrativeString>;
  next_step_summary: NonEmptyString;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  verification_evidence_record_refs: NonEmptyArray<string>;
  verification_status: "not_verified";
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  before_state: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    review_finding_draft_evidence_refs: NonEmptyArray<string>;
    evidence_basis: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    confirmation_criteria: NonEmptyArray<NarrativeString>;
  };
  after_state: {
    summary: NonEmptyString;
    criteria_results: NonEmptyArray<{
      criterion: NonEmptyString;
      result: "satisfied" | "not_satisfied" | "not_evaluated" | "customer_validation_required";
    }>;
    evidence_refs: NonEmptyArray<string>;
  };
  rationale: NonEmptyString;
  remaining_limitations: NonEmptyArray<NarrativeString>;
  next_step_summary: NonEmptyString;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
} | {
  protocol_version: ProtocolVersion;
  review_id: string;
  verification_record_id: string;
  record_version: number;
  verification_pass_id: string;
  verification_pass_ref: string;
  review_finding_draft_ref: string;
  classification_record_ref: string;
  verification_evidence_record_refs: NonEmptyArray<string>;
  verification_status: "requires_customer_side_validation";
  recorded_at: UtcRfc3339Timestamp;
  actor: {
    actor_type: "reviewer";
    actor_id: NonEmptyString;
  };
  before_state: {
    classification: "likely" | "confirmed" | "inconclusive" | "requires_customer_side_validation";
    review_finding_draft_evidence_refs: NonEmptyArray<string>;
    evidence_basis: NonEmptyArray<NarrativeString>;
    source_reference_state: "retained_review_artifact" | "deleted_under_policy" | "never_collected" | "not_submitted_by_policy" | "unresolved_reference";
    confirmation_criteria: NonEmptyArray<NarrativeString>;
  };
  after_state: {
    summary: NonEmptyString;
    criteria_results: NonEmptyArray<{
      criterion: NonEmptyString;
      result: "satisfied" | "not_satisfied" | "not_evaluated" | "customer_validation_required";
    }>;
    evidence_refs: NonEmptyArray<string>;
  };
  rationale: NonEmptyString;
  remaining_limitations: NonEmptyArray<NarrativeString>;
  next_step_summary: NonEmptyString;
  source_derived_class: "retained_review_artifact";
  visibility: "customer_facing" | "internal_only";
};
