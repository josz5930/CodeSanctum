import path from "node:path";

import {
  loadSchemas,
  readJson,
  resolveProjectPath,
  resolveUnderRoot,
  validateAgainstSchema,
  validateFixtureSemantics,
  validateReviewerValidationScriptPackageSemantics,
  validateSchemaDocument,
  verifyCanonicalIdentity
} from "./lib/protocol-utils.mjs";

const projectRoot = resolveProjectPath(".");
const configPath = resolveProjectPath("protocol/gate.config.json");
const fixtureRoot = resolveProjectPath("protocol/fixtures");
const errors = [];

const config = await readJson(configPath);
const { schemas, schemaMap } = await loadSchemas();

expect(config.schemaVersion === 1, "protocol gate config schemaVersion must be 1");
expect(config.status === "active-story-1.3-protocol-v0", "protocol gate must be active for Story 1.3 protocol v0 content");
expect(config.ownerStory === "1.3", "protocol gate ownerStory must be 1.3");
expect(config.protocolVersion === "codeattest.v0", "protocol gate protocolVersion must be codeattest.v0");
expect(Array.isArray(config.syntheticFixtureMarkers), "syntheticFixtureMarkers must be an array");
expect(config.syntheticFixtureMarkers.includes("SYNTHETIC_DEMO_DATA"), "synthetic fixture marker SYNTHETIC_DEMO_DATA is required");
expect(config.syntheticFixtureMarkers.includes("NOT_CUSTOMER_SOURCE"), "synthetic fixture marker NOT_CUSTOMER_SOURCE is required");

for (const { relativePath, schema } of schemas) {
  collectErrors(validateSchemaDocument(schema, relativePath));
}

for (const schemaName of config.requiredSchemas ?? []) {
  const schemaId = `urn:codeattest:protocol:v0:${schemaName}`;
  expect(schemaMap.has(schemaId), `required schema is missing: ${schemaId}`);
}

const fixtureIndexPath = resolveUnderRoot(projectRoot, config.fixtureIndex ?? "protocol/fixtures/v0/fixture-index.json", "fixture index path");
const fixtureIndex = await readJson(fixtureIndexPath);
expect(fixtureIndex.schemaVersion === 1, "fixture index schemaVersion must be 1");
expect(fixtureIndex.protocol_version === config.protocolVersion, "fixture index protocol_version must match gate config");
expect(
  fixtureIndex.canonicalization_authority === "RFC 8785 JSON Canonicalization Scheme",
  "fixture index must name RFC 8785 JSON Canonicalization Scheme as authority"
);

const canonicalIdentities = fixtureIndex.canonical_identities ?? [];
for (const entry of canonicalIdentities) {
  collectErrors(await verifyCanonicalIdentity(entry, fixtureRoot));
}

const expectedIdentityByInputPath = new Map(
  canonicalIdentities.map((entry) => [
    entry.identity_input_path,
    typeof entry.identity_namespace === "string"
      ? `sha256:${entry.expected_identity.slice(`${entry.identity_namespace}:`.length)}`
      : entry.expected_identity
  ])
);
const validReviewerValidationScripts = await loadValidReviewerValidationScripts(fixtureIndex.valid_fixtures ?? []);

for (const entry of fixtureIndex.valid_fixtures ?? []) {
  await validateFixtureEntry(entry, false, expectedIdentityByInputPath, validReviewerValidationScripts);
}
collectErrors(validateReviewerValidationScriptPackage(validReviewerValidationScripts));

for (const entry of fixtureIndex.negative_fixtures ?? []) {
  await validateFixtureEntry(entry, true, expectedIdentityByInputPath, validReviewerValidationScripts);
}

const REQUIRED_FIXTURE_PATHS = [
  "v0/valid/verification-pass-scope.eligible-guidance.json",
  "v0/valid/verification-pass-scope.requires-validation-path.json",
  "v0/valid/verification-pass-scope.three-included-scripts.json",
  "v0/valid/verification-pass-scope.additional-script-pricing-tbd.json",
  "v0/valid/verification-pass-scope.outcome-visible-out-of-scope.json",
  "v0/valid/verification-pass-scope.outcome-eligible-with-formal-path.json",
  "v0/valid/verification-pass-scope.customer-facing-projection.json",
  "v0/valid/verification-pass-scope.reviewer-customer-actor-ref.json",
  "v0/valid/verification-pass-scope.negated-disclaimer.json",
  "v0/invalid/verification-pass-scope.no-customer-backed-selection.json",
  "v0/invalid/verification-pass-scope.missing-classification-binding.json",
  "v0/invalid/verification-pass-scope.classification-binding-mismatch.json",
  "v0/invalid/verification-pass-scope.requires-validation-eligible-without-path.json",
  "v0/invalid/verification-pass-scope.more-than-three-included-scripts.json",
  "v0/invalid/verification-pass-scope.duplicate-included-script-slot.json",
  "v0/invalid/verification-pass-scope.additional-script-missing-pricing-tbd.json",
  "v0/invalid/verification-pass-scope.deadline-beyond-30-days.json",
  "v0/invalid/verification-pass-scope.deadline-plus-one-ns.json",
  "v0/invalid/verification-pass-scope.future-evidence-field.json",
  "v0/invalid/verification-pass-scope.outcome-hidden-or-rewritten.json",
  "v0/invalid/verification-pass-scope.claim-unsafe-copy.json",
  "v0/invalid/verification-pass-scope.namespaced-claim-unsafe-copy.json",
  "v0/invalid/verification-pass-scope.blocked-next-step-required.json",
  "v0/invalid/verification-pass-scope.next-step-no-validation-path.json",
  "v0/invalid/verification-pass-scope.next-step-do-not-record.json",
  "v0/invalid/verification-pass-scope.additional-agreement-next-step-required.json",
  "v0/invalid/verification-pass-scope.outcome-eligible-without-path.json",
  "v0/invalid/verification-pass-scope.eligibility-reason-too-weak.json",
  "v0/invalid/verification-pass-scope.finding-limitations-too-weak.json",
  "v0/invalid/verification-pass-scope.additional-script-as-included-slot.json",
  "v0/invalid/verification-pass-scope.included-script-as-additional-candidate.json",
  "v0/invalid/verification-pass-scope.selected-script-missing-allocation.json",
  "v0/valid/verification-evidence-record.follow-up-commit.json",
  "v0/valid/verification-evidence-record.customer-validation.json",
  "v0/valid/verification-record.pending.json",
  "v0/valid/verification-record.complete.json",
  "v0/valid/verification-record.requires-customer-side.json",
  "v0/valid/verification-addendum.pending.json",
  "v0/valid/verification-addendum.finalized.json",
  "v0/valid/review-event.verification-evidence.json",
  "v0/valid/review-event.verification-record.json",
  "v0/valid/review-event-log.verification-record-correction.json",
  "v0/valid/review-event-log.verification-completion.json",
  "v0/valid/review-event-customer-projection.verification-completion.json",
  "v0/invalid/verification-evidence-record.commit-missing-context.json",
  "v0/invalid/verification-evidence-record.validation-missing-path.json",
  "v0/invalid/verification-record.complete-criterion-unsatisfied.json",
  "v0/invalid/verification-addendum.duplicate-evidence-resolution.json",
  "v0/invalid/review-event-log.verification-record-stale.json",
  "v0/valid/security-review-attestation.json",
  "v0/valid/supporting-evidence-mapping.soc2.json",
  "v0/valid/static-bundle-manifest.generated.json",
  "v0/valid/static-portal-projection.json",
  "v0/valid/attestation-package-finalization.json",
  "v0/valid/pilot-metric-record.json",
  "v0/valid/pilot-feedback-record.json",
  "v0/valid/signature-envelope.static-bundle.json",
  "v0/invalid/supporting-evidence-mapping.acceptance-claim.json",
  "v0/invalid/supporting-evidence-mapping.duplicate-entry-id.json",
  "v0/invalid/static-bundle-manifest.internal-learning-file.json",
  "v0/invalid/attestation-package-finalization.vendor-actor.json",
  "v0/invalid/pilot-feedback-record.customer-facing.json"
];

const REQUIRED_INVARIANT_IDS = [
  "verification-scope-customer-backed-selection",
  "verification-scope-selected-finding-binding",
  "verification-scope-included-window-and-script-cap",
  "verification-scope-selection-not-decision",
  "verification-scope-events-append-only-boundary",
  "verification-evidence-metadata-only-chain",
  "verification-decision-reviewer-criteria-chain",
  "verification-addendum-lifecycle-history-closure",
  "attestation-retained-chain-claim-safety",
  "supporting-evidence-approved-mapping-boundary",
  "static-bundle-content-addressed-minimized-projection",
  "static-portal-offline-customer-safe-projection",
  "attestation-finalization-customer-new-version-boundary",
  "pilot-learning-internal-content-free-boundary"
];

assertRequiredFixtureRegistrations(fixtureIndex);
await assertRequiredInvariantCoverage();

async function loadValidReviewerValidationScripts(validFixtures) {
  const output = [];
  for (const entry of validFixtures) {
    if (entry.schema !== "urn:codeattest:protocol:v0:reviewer-validation-script") {
      continue;
    }
    output.push(await readJson(path.join(fixtureRoot, entry.path)));
  }
  return output;
}

function validateReviewerValidationScriptPackage(scripts) {
  const packageErrors = [];
  validateReviewerValidationScriptPackageSemantics(scripts, packageErrors);
  return packageErrors;
}

function assertRequiredFixtureRegistrations(fixtureIndex) {
  const registered = new Set([
    ...(fixtureIndex.valid_fixtures ?? []).map((entry) => entry.path),
    ...(fixtureIndex.negative_fixtures ?? []).map((entry) => entry.path)
  ]);
  for (const pathText of REQUIRED_FIXTURE_PATHS) {
    expect(registered.has(pathText), `required Story 4.1 fixture registration is missing: ${pathText}`);
  }
}

async function assertRequiredInvariantCoverage() {
  const invariantsPath = resolveProjectPath("protocol/fixtures/v0/invariants.json");
  const invariants = await readJson(invariantsPath);
  const coverageById = new Map((invariants.invariants ?? []).map((entry) => [entry.id, entry]));
  for (const invariantId of REQUIRED_INVARIANT_IDS) {
    const entry = coverageById.get(invariantId);
    expect(entry !== undefined, `required Story 4.1 invariant is missing: ${invariantId}`);
    if (entry === undefined) {
      continue;
    }
    expect(Array.isArray(entry.javascript_coverage) && entry.javascript_coverage.length > 0, `${invariantId} must declare javascript_coverage`);
    expect(entry.javascript_coverage.every((item) => typeof item === "string" && item.trim().length > 0), `${invariantId} javascript_coverage entries must be non-empty strings`);
    expect(entry.javascript_coverage.every((item) => typeof item === "string" && !/placeholder|todo|tbd|not_applicable/iu.test(item)), `${invariantId} javascript_coverage entries must be executable markers, not placeholders`);
  }
}

export function protocolCheckRequiredStory41CoverageErrors({ fixtureIndex, invariants }) {
  const localErrors = [];
  const registered = new Set([
    ...(fixtureIndex.valid_fixtures ?? []).map((entry) => entry.path),
    ...(fixtureIndex.negative_fixtures ?? []).map((entry) => entry.path)
  ]);
  for (const pathText of REQUIRED_FIXTURE_PATHS) {
    if (!registered.has(pathText)) {
      localErrors.push(`required Story 4.1 fixture registration is missing: ${pathText}`);
    }
  }
  const coverageById = new Map((invariants.invariants ?? []).map((entry) => [entry.id, entry]));
  for (const invariantId of REQUIRED_INVARIANT_IDS) {
    const entry = coverageById.get(invariantId);
    if (entry === undefined) {
      localErrors.push(`required Story 4.1 invariant is missing: ${invariantId}`);
      continue;
    }
    if (!Array.isArray(entry.javascript_coverage) || entry.javascript_coverage.length === 0) {
      localErrors.push(`${invariantId} must declare javascript_coverage`);
      continue;
    }
    if (!entry.javascript_coverage.every((item) => typeof item === "string" && item.trim().length > 0 && !/placeholder|todo|tbd|not_applicable/iu.test(item))) {
      localErrors.push(`${invariantId} javascript_coverage entries must be executable markers, not placeholders`);
    }
  }
  return localErrors;
}

async function validateFixtureEntry(entry, shouldFail, expectedIdentityByInputPath, validReviewerValidationScripts = []) {
  if (entry.expected_failure === "malformed_json") {
    if (!shouldFail) {
      errors.push(`${entry.path} declares expected_failure malformed_json but is registered as a valid fixture`);
      return;
    }
    try {
      await readJson(resolveUnderRoot(fixtureRoot, entry.path, "fixture index path"));
      errors.push(`${entry.path} is listed as a negative fixture for malformed_json but parsed as valid JSON`);
    } catch (error) {
      if (!error.message.startsWith("Invalid JSON in")) {
        errors.push(`${entry.path} failed for an unexpected reason instead of malformed_json: ${error.message}`);
      }
    }
    return;
  }

  let fixture;
  try {
    fixture = await readJson(resolveUnderRoot(fixtureRoot, entry.path, "fixture index path"));
  } catch (error) {
    errors.push(`${entry.path}: ${error.message}`);
    return;
  }
  const schema = schemaMap.get(entry.schema);
  if (!schema) {
    errors.push(`${entry.path} references unknown schema ${entry.schema}`);
    return;
  }

  const schemaErrors = entry.expected_failure === "self_referential_identity"
    ? []
    : validateAgainstSchema(fixture, schema, schemaMap);
  const fixtureErrors = [
    ...schemaErrors,
    ...await validateFixtureSemantics(fixture, {
      fixtureRoot,
      fixturePath: entry.path,
      expectedFailure: entry.expected_failure,
      companionLogPath: entry.companion_log_path,
      syntheticMarkers: config.syntheticFixtureMarkers
    })
  ];

  if (entry.expected_failure === "validation_script_included_cap_exceeded") {
    fixtureErrors.push(...validateReviewerValidationScriptPackage([...validReviewerValidationScripts, fixture]));
  }

  if (isSigningInput(entry.schema)) {
    const expectedIdentity = expectedIdentityByInputPath.get(fixture.identity_input_path);
    if (!expectedIdentity) {
      fixtureErrors.push({ code: "unknown_identity_input", message: `${entry.path} points to unknown identity input ${fixture.identity_input_path}` });
    } else if (fixture.signed_identity !== expectedIdentity) {
      fixtureErrors.push({ code: "signing_identity_mismatch", message: `${entry.path} signed_identity must equal ${expectedIdentity}` });
    }
  }

  // C7-16: this used to run only after the shouldFail branch's early return,
  // so negative fixtures never had their source_safety declaration checked.
  if (entry.source_safety !== "synthetic_non_customer") {
    errors.push(`${entry.path} must declare source_safety synthetic_non_customer`);
  }

  if (shouldFail) {
    if (fixtureErrors.length === 0) {
      errors.push(`${entry.path} is listed as a negative fixture but passed validation`);
      return;
    }

    const expectedCodes = expectedFailureCodes(entry.expected_failure);
    const actualCodes = fixtureErrors.map((error) => error.code);
    const hasExpected = actualCodes.some((code) => expectedCodes.includes(code));
    const ignoredUnexpectedCodes = ignoredUnexpectedFailureCodes(entry.expected_failure);
    const unexpected = actualCodes.filter((code) => !expectedCodes.includes(code) && !ignoredUnexpectedCodes.includes(code));
    if (!hasExpected) {
      errors.push(`${entry.path} failed for [${actualCodes.join(", ")}] instead of expected ${entry.expected_failure}`);
    } else if (unexpected.length > 0) {
      errors.push(`${entry.path} failed for expected ${entry.expected_failure} but also produced unexpected codes: [${unexpected.join(", ")}]`);
    }
    return;
  }

  for (const fixtureError of fixtureErrors) {
    errors.push(`${entry.path}: ${fixtureError.message}`);
  }
}

function ignoredUnexpectedFailureCodes(expectedFailure) {
  // C1-01 makes expressible semantic invariants schema-authoritative while
  // retaining the semantic checks as defense in depth. A negative fixture must
  // still emit its registered semantic code, but parallel schema-keyword
  // failures are now expected and do not replace that semantic authority.
  const schemaKeywordCodes = [
    "accessor_property",
    "additional_property",
    "any_of",
    "const",
    "contains",
    "dependent_required",
    "enum",
    "max_contains",
    "max_items",
    "max_length",
    "maximum",
    "min_items",
    "min_length",
    "minimum",
    "not",
    "one_of",
    "pattern",
    "required",
    "type",
    "unique_items",
    "unresolved_ref"
  ];
  return expectedFailure.startsWith("verification_scope_")
    ? [...schemaKeywordCodes, "utc_rfc3339_timestamp"]
    : schemaKeywordCodes;
}

function expectedFailureCodes(expectedFailure) {
  const mapping = {
    camel_case_protocol_field: ["camel_case_protocol_field", "additional_property", "required"],
    extended_requires_selected_files_or_areas: ["extended_requires_selected_files_or_areas"],
    finding_context_requires_caps_redaction: ["finding_context_requires_caps_redaction"],
    invalid_coverage_mode: ["enum"],
    invalid_outcome_state: ["enum"],
    invalid_environment_profile: ["enum", "environment_gate_profile_required"],
    readiness_evidence_self_review: ["readiness_evidence_self_review"],
    readiness_decision_stale_evidence: ["readiness_decision_stale_evidence"],
    readiness_decision_controls_invalid: ["readiness_decision_controls_invalid"],
    readiness_decision_failed_control: ["readiness_decision_failed_control"],
    readiness_decision_self_approval: ["readiness_decision_self_approval"],
    readiness_decision_release_mismatch: ["readiness_decision_release_mismatch"],
    environment_gate_readiness_decision_mismatch: ["environment_gate_readiness_decision_mismatch"],
    environment_gate_readiness_decision_required: ["environment_gate_readiness_decision_required"],
    invalid_artifact_type: ["enum"],
    invalid_local_runner_stage: ["enum"],
    invalid_review_event_type: ["enum"],
    invalid_enum_value: ["enum"],
    invalid_identity_signing_input_type: [
      "enum",
      "signing_input_identity_type_mismatch",
      "signing_input_identity_path_mismatch"
    ],
    malformed_algorithm_prefixed_digest: ["pattern"],
    // `-00:00` is RFC 3339 "unknown local offset", not UTC. It trips both the
    // schema pattern and the semantic timestamp guard, so both codes are expected.
    unknown_local_utc_offset: ["pattern", "utc_rfc3339_timestamp"],
    metadata_only_must_not_include_snippets: ["metadata_only_must_not_include_snippets", "metadata_only_warning_required"],
    missing_retention_source_derived_class: ["required", "raw_snippet_wrong_source_class"],
    raw_snippet_wrong_source_class: ["raw_snippet_wrong_source_class"],
    raw_snippet_missing_synthetic_markers: ["raw_snippet_missing_synthetic_markers"],
    redaction_limitation_required: ["redaction_limitation_required"],
    retained_source_requires_opt_in_and_period: ["retained_source_requires_opt_in_and_period"],
    missing_scanner_retention_source_derived_class: ["required"],
    reviewer_classification_in_candidate_finding: ["enum"],
    missing_scanner_rule_id: ["required"],
    malformed_scanner_finding_set_id: ["pattern"],
    outbound_manifest_duplicate_evidence_category: ["outbound_manifest_duplicate_evidence_category", "outbound_manifest_missing_evidence_category"],
    outbound_manifest_missing_evidence_category: ["outbound_manifest_missing_evidence_category", "min_items"],
    outbound_manifest_policy_coverage_mode_mismatch: ["outbound_manifest_policy_coverage_mode_mismatch"],
    outbound_manifest_policy_ref_mismatch: ["outbound_manifest_policy_ref_mismatch"],
    outbound_manifest_data_minimization_required: ["outbound_manifest_data_minimization_required"],
    source_code_disclosure_controls_required: ["source_code_disclosure_controls_required"],
    outbound_manifest_inclusion_state_mismatch: ["outbound_manifest_inclusion_state_mismatch"],
    outbound_manifest_identity_mismatch: ["outbound_manifest_identity_mismatch", "identity_mismatch"],
    source_code_disclosure_label_required: ["source_code_disclosure_label_required", "source_code_disclosure_controls_required", "minimum"],
    preview_safe_approval_state_required: ["preview_safe_approval_state_required", "preview_safe_package_state_required", "enum", "const"],
    preview_safe_package_state_required: ["preview_safe_package_state_required", "const"],
    approval_displayed_context_required: ["approval_displayed_context_required", "required"],
    approval_warnings_acknowledgement_mismatch: ["approval_warnings_acknowledgement_mismatch"],
    approval_not_submitted_state_required: ["approval_not_submitted_state_required", "required", "const"],
    bundle_requires_approved_customer_approval: ["bundle_requires_approved_customer_approval", "bundle_customer_approval_ref_mismatch", "const"],
    bundle_manifest_id_mismatch: ["bundle_manifest_id_mismatch"],
    bundle_manifest_scope_ref_mismatch: ["bundle_manifest_scope_ref_mismatch"],
    bundle_manifest_policy_ref_mismatch: ["bundle_manifest_policy_ref_mismatch"],
    bundle_manifest_coverage_mode_mismatch: ["bundle_manifest_coverage_mode_mismatch"],
    source_derived_cleanup_intent_required: ["source_derived_cleanup_intent_required"],
    bundle_referenced_artifact_parse_failed: ["bundle_referenced_artifact_parse_failed"],
    signature_signed_identity_mismatch: ["signature_signed_identity_mismatch"],
    signature_bytes_untrusted: ["pattern"],
    receipt_signature_bytes_invalid: ["receipt_signature_bytes_invalid", "required"],
    static_bundle_verification_signature_invalid: ["static_bundle_verification_signature_invalid", "static_bundle_verification_attachment_invalid", "static_bundle_verification_index_identity_mismatch"],
    self_referential_identity: ["self_referential_identity"],
    local_attempt_bundle_identity_state_mismatch: ["local_attempt_bundle_identity_state_mismatch"],
    local_attempt_approval_metadata_required: ["local_attempt_approval_metadata_required"],
    local_attempt_remote_claim_language: ["local_attempt_remote_claim_language"],
    local_attempt_runner_trust_label_required: ["local_attempt_runner_trust_label_required"],
    local_attempt_sensitive_diagnostic: ["local_attempt_sensitive_diagnostic", "const"],
    local_attempt_no_signed_bundle_statement_required: ["local_attempt_no_signed_bundle_statement_required"],
    local_attempt_submit_stage_required: ["const", "local_attempt_remote_state_required", "local_attempt_remote_claim_language"],
    // Out-of-range digit positions (month 13, day 32, hour 25, ...) now also trip
    // the tightened schema pattern (C1-08), in addition to the semantic calendar guard.
    utc_rfc3339_timestamp: ["utc_rfc3339_timestamp", "pattern"],
    artifact_content_path_portable_required: ["artifact_content_path_portable_required", "pattern"],
    artifact_content_path_anchor_required: ["artifact_content_path_anchor_required", "dependent_required", "required"],
    // C7-06: readiness is now checked whenever real evidence is accepted OR
    // retained-source classes are allowed, even on a profile that isn't
    // entitled to either -- so this fixture legitimately trips both codes now.
    environment_gate_real_evidence_not_allowed: ["environment_gate_real_evidence_not_allowed", "environment_gate_readiness_required"],
    environment_gate_readiness_required: ["environment_gate_readiness_required", "environment_gate_readiness_decision_required"],
    receipt_key_metadata_required: ["receipt_key_metadata_required", "required"],
    vendor_receipt_signature_identity_type: ["vendor_receipt_signature_identity_type"],
    receipt_approved_received_mismatch: ["receipt_approved_received_mismatch", "const"],
    vendor_receipt_no_failed_receipt: ["vendor_receipt_no_failed_receipt", "const"],
    vendor_receipt_identity_mismatch: ["vendor_receipt_identity_mismatch", "identity_mismatch"],
    log_checkpoint_merkle_root_invalid: ["pattern"],
    log_checkpoint_tree_size_mismatch: ["const"],
    log_checkpoint_identity_mismatch: ["log_checkpoint_identity_mismatch"],
    log_checkpoint_cross_deployment_mix: ["enum"],
    review_event_identity_mismatch: ["review_event_identity_mismatch"],
    review_event_identity_excludes_invalid: ["review_event_identity_excludes_invalid", "enum"],
    review_event_internal_note_requires_internal_only: ["review_event_internal_note_requires_internal_only"],
    review_event_reason_raw_source_text_forbidden: ["review_event_reason_raw_source_text_forbidden"],
    review_event_reason_claim_unsafe_text_forbidden: ["review_event_reason_claim_unsafe_text_forbidden"],
    review_event_missing_source_derived_class: ["review_event_missing_source_derived_class"],
    review_event_log_sequence_not_monotonic: ["review_event_log_sequence_not_monotonic"],
    review_event_log_duplicate_event_id: ["review_event_log_duplicate_event_id", "review_event_identity_mismatch"],
    review_event_log_duplicate_idempotency_key: ["review_event_log_duplicate_idempotency_key"],
    review_event_log_review_id_mismatch: ["review_event_log_review_id_mismatch"],
    review_event_log_supersedes_unknown_event: ["review_event_log_supersedes_unknown_event"],
    review_event_typed_artifact_ref_mismatch: ["review_event_typed_artifact_ref_mismatch"],
    customer_event_cannot_supersede_classification: ["customer_event_cannot_supersede_classification"],
    customer_projection_internal_only_entry: ["customer_projection_internal_only_entry", "const"],
    customer_projection_duplicate_event_id: ["customer_projection_duplicate_event_id"],
    stored_object_forbidden_source_class: ["stored_object_forbidden_source_class"],
    stored_object_opt_in_not_allowed: ["stored_object_opt_in_not_allowed"],
    deletion_event_missing_deletion_evidence: ["deletion_event_missing_deletion_evidence"],
    access_event_missing_scope: ["access_event_missing_scope"],
    evidence_event_missing_source_derived_class: ["evidence_event_missing_source_derived_class"],
    retention_period_invalid: ["retention_period_invalid"],
    deletion_evidence_self_supersede: ["deletion_evidence_self_supersede"],
    retention_opt_in_class_required: ["const"],
    minimization_category_class_mismatch: ["minimization_category_class_mismatch"],
    minimization_deleted_without_evidence: ["minimization_deleted_without_evidence"],
    minimization_artifact_category_conflict: ["minimization_artifact_category_conflict"],
    submission_outcome_receipt_required: ["submission_outcome_receipt_required"],
    submission_outcome_failure_must_not_reference_receipt: ["submission_outcome_failure_must_not_reference_receipt"],
    submission_outcome_failure_requires_reason_codes: ["submission_outcome_failure_requires_reason_codes"],
    submission_outcome_received_must_not_carry_reason_codes: ["submission_outcome_received_must_not_carry_reason_codes"],
    submission_outcome_next_path_state_mismatch: ["submission_outcome_next_path_state_mismatch"],
    submission_outcome_summary_implies_review: ["submission_outcome_summary_implies_review"],
    submission_event_state_not_a_failure: ["submission_event_state_not_a_failure"],
    submission_event_type_state_mismatch: ["submission_event_type_state_mismatch"],
    submission_event_missing_outcome_ref: ["submission_event_missing_outcome_ref"],
    submission_event_idempotency_key_not_derived: ["submission_event_idempotency_key_not_derived"],
    review_finding_draft_expert_field_forbidden: ["review_finding_draft_expert_field_forbidden", "additional_property", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_set_receipt_required: ["required", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_set_receipt_identity_mismatch: ["review_finding_draft_set_receipt_identity_mismatch", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_deleted_evidence_shown_available: ["review_finding_draft_deleted_evidence_shown_available", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_threshold_gaps_required: ["review_finding_draft_threshold_gaps_required", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_duplicate_id: ["review_finding_draft_duplicate_id", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_deleted_evidence_missing_proof: ["review_finding_draft_deleted_evidence_missing_proof", "review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_set_no_findings_statement_required: [
      "review_finding_draft_set_no_findings_statement_required",
      "review_finding_draft_set_no_findings_limitation_required"
    ],
    review_finding_draft_set_source_class_required: ["review_finding_draft_set_source_class_required", "const"],
    review_finding_draft_text_first_state_required: ["review_finding_draft_text_first_state_required", "const"],
    review_finding_draft_candidate_refs_required: ["review_finding_draft_candidate_refs_required", "min_items"],
    review_finding_draft_evidence_basis_not_bound_to_refs: ["review_finding_draft_evidence_basis_not_bound_to_refs"],
    review_finding_draft_retained_evidence_display_inconsistent: ["review_finding_draft_retained_evidence_display_inconsistent"],
    finding_classification_allowed_taxonomy_required: ["finding_classification_allowed_taxonomy_required", "enum"],
    finding_classification_draft_ref_required: ["finding_classification_draft_ref_required", "required"],
    finding_classification_confirmed_criteria_required: ["finding_classification_confirmed_criteria_required", "min_items"],
    finding_classification_confirmed_defensible_criteria_required: ["finding_classification_confirmed_defensible_criteria_required"],
    finding_classification_validation_path_required: ["finding_classification_validation_path_required"],
    finding_classification_evidence_basis_required: ["finding_classification_evidence_basis_required", "required"],
    finding_classification_evidence_basis_not_bound_to_draft: ["finding_classification_evidence_basis_not_bound_to_draft", "required"],
    finding_classification_source_reference_state_mismatch: ["finding_classification_source_reference_state_mismatch"],
    finding_classification_limitations_required: ["finding_classification_limitations_required", "required"],
    finding_classification_forbidden_field: ["finding_classification_forbidden_field", "additional_property"],
    finding_classification_raw_source_text_forbidden: ["finding_classification_raw_source_text_forbidden"],
    finding_classification_claim_unsafe_text_forbidden: ["finding_classification_claim_unsafe_text_forbidden"],
    finding_classification_reviewer_actor_required: ["finding_classification_reviewer_actor_required", "const"],
    remediation_guidance_classification_ref_required: ["remediation_guidance_classification_ref_required", "required"],
    remediation_guidance_inconclusive_not_actionable: ["remediation_guidance_inconclusive_not_actionable"],
    remediation_guidance_actionable_details_required: ["remediation_guidance_actionable_details_required"],
    remediation_guidance_exploitability_rationale_required: ["remediation_guidance_exploitability_rationale_required"],
    remediation_guidance_confirmed_criteria_context_required: ["remediation_guidance_confirmed_criteria_context_required"],
    remediation_guidance_source_reference_state_mismatch: ["remediation_guidance_source_reference_state_mismatch"],
    remediation_guidance_evidence_ref_unbound: ["remediation_guidance_evidence_ref_unbound"],
    remediation_guidance_evidence_ref_required: ["remediation_guidance_evidence_ref_required", "min_items"],
    remediation_guidance_insufficient_evidence_reason_required: ["remediation_guidance_insufficient_evidence_reason_required", "required"],
    remediation_guidance_next_step_required: ["remediation_guidance_next_step_required"],
    remediation_guidance_raw_source_text_forbidden: ["remediation_guidance_raw_source_text_forbidden"],
    remediation_guidance_claim_unsafe_text_forbidden: ["remediation_guidance_claim_unsafe_text_forbidden"],
    customer_remediation_status_rewrite_forbidden: ["customer_remediation_status_rewrite_forbidden", "additional_property"],
    customer_remediation_status_finding_ref_required: ["customer_remediation_status_finding_ref_required"],
    customer_remediation_status_due_date_invalid: ["customer_remediation_status_due_date_invalid"],
    customer_remediation_status_raw_source_text_forbidden: ["customer_remediation_status_raw_source_text_forbidden"],
    customer_remediation_status_claim_unsafe_text_forbidden: ["customer_remediation_status_claim_unsafe_text_forbidden"],
    customer_facing_finding_status_separation_required: ["customer_facing_finding_status_separation_required", "additional_property"],
    customer_facing_finding_visibility_required: ["customer_facing_finding_visibility_required"],
    customer_facing_finding_verification_reference_required: ["customer_facing_finding_verification_reference_required"],
    customer_facing_finding_due_date_invalid: ["customer_facing_finding_due_date_invalid"],
    customer_facing_finding_reference_mismatch: ["customer_facing_finding_reference_mismatch"],
    customer_facing_finding_guidance_actionable_details_required: ["customer_facing_finding_guidance_actionable_details_required"],
    customer_facing_finding_guidance_insufficient_evidence_reason_required: ["customer_facing_finding_guidance_insufficient_evidence_reason_required"],
    customer_facing_finding_guidance_next_step_required: ["customer_facing_finding_guidance_next_step_required"],
    customer_facing_finding_evidence_ref_required: ["customer_facing_finding_evidence_ref_required", "min_items"],
    customer_facing_finding_customer_notes_export_forbidden: ["customer_facing_finding_customer_notes_export_forbidden"],
    customer_facing_finding_future_outcome_reference_required: ["customer_facing_finding_future_outcome_reference_required"],
    customer_facing_finding_claim_unsafe_text_forbidden: ["customer_facing_finding_claim_unsafe_text_forbidden"],
    customer_facing_finding_script_pricing_tbd_required: ["customer_facing_finding_script_pricing_tbd_required"],
    validation_path_remote_authorization_required: ["validation_path_remote_authorization_required", "required"],
    validation_path_script_ref_required: ["validation_path_script_ref_required", "required", "min_items"],
    validation_path_branch_field_forbidden: ["validation_path_branch_field_forbidden"],
    validation_path_evidence_ref_unbound: ["validation_path_evidence_ref_unbound"],
    validation_path_source_reference_state_mismatch: ["validation_path_source_reference_state_mismatch"],
    validation_path_manual_attachment_instructions_required: ["validation_path_manual_attachment_instructions_required"],
    validation_path_raw_source_text_forbidden: ["validation_path_raw_source_text_forbidden"],
    validation_path_claim_unsafe_text_forbidden: ["validation_path_claim_unsafe_text_forbidden"],
    validation_script_included_slot_required: ["validation_script_included_slot_required", "required", "minimum", "maximum"],
    validation_script_additional_slot_forbidden: ["validation_script_additional_slot_forbidden"],
    validation_script_pricing_tbd_required: ["validation_script_pricing_tbd_required"],
    validation_script_included_cap_exceeded: ["validation_script_included_cap_exceeded"],
    validation_script_raw_source_text_forbidden: ["validation_script_raw_source_text_forbidden"],
    validation_script_claim_unsafe_text_forbidden: ["validation_script_claim_unsafe_text_forbidden"],
    verification_evidence_commit_context_invalid: ["verification_evidence_commit_context_invalid", "required"],
    verification_evidence_validation_context_invalid: ["verification_evidence_validation_context_invalid", "required"],
    verification_evidence_access_scope_mismatch: ["verification_evidence_access_scope_mismatch"],
    verification_record_criteria_mismatch: ["verification_record_criteria_mismatch"],
    verification_record_next_step_required: ["verification_record_next_step_required", "required"],
    verification_addendum_evidence_resolution_invalid: ["verification_addendum_evidence_resolution_invalid"],
    verification_addendum_finalization_invalid: ["verification_addendum_finalization_invalid"],
    review_event_verification_evidence_actor_required: ["review_event_verification_evidence_actor_required"],
    review_event_verification_record_version_invalid: ["review_event_verification_record_version_invalid"],
    supporting_evidence_mapping_claim_unsafe_text_forbidden: ["supporting_evidence_mapping_claim_unsafe_text_forbidden"],
    static_bundle_internal_learning_forbidden: ["static_bundle_internal_learning_forbidden"],
    attestation_finalization_customer_actor_required: ["attestation_finalization_customer_actor_required", "const"],
    attestation_export_timestamp_required: ["attestation_export_timestamp_required", "required"],
    pilot_feedback_internal_content_free_required: ["pilot_feedback_internal_content_free_required", "const"],
    // The dedicated PII scan and the shared customerVisibleTextForbidden scan
    // (which now also covers PII, see C8-05) both inspect pilot feedback
    // caveats, so a PII-shaped caveat can legitimately trip both codes.
    pilot_feedback_pii_forbidden: ["pilot_feedback_pii_forbidden", "pilot_feedback_claim_unsafe_text_forbidden"],
    verification_scope_customer_backing_required: ["verification_scope_customer_backing_required"],
    verification_scope_selected_findings_required: ["verification_scope_selected_findings_required"],
    verification_scope_actor_authority_required: ["verification_scope_actor_authority_required"],
    verification_scope_classification_binding_required: ["verification_scope_classification_binding_required", "verification_scope_classification_binding_mismatch"],
    verification_scope_classification_binding_mismatch: ["verification_scope_classification_binding_mismatch", "verification_scope_reference_mismatch", "verification_scope_draft_binding_mismatch"],
    verification_scope_reference_mismatch: ["verification_scope_reference_mismatch", "verification_scope_classification_binding_mismatch", "verification_scope_validation_path_ref_mismatch", "verification_scope_script_ref_mismatch"],
    verification_scope_validation_path_required_for_eligible: ["verification_scope_validation_path_required_for_eligible"],
    verification_scope_draft_binding_mismatch: ["verification_scope_draft_binding_mismatch"],
    verification_scope_deadline_basis_limitation_required: ["verification_scope_deadline_basis_limitation_required"],
    verification_scope_blocked_next_step_required: ["verification_scope_blocked_next_step_required"],
    verification_scope_additional_agreement_next_step_required: ["verification_scope_additional_agreement_next_step_required"],
    verification_scope_included_script_cap_exceeded: ["verification_scope_included_script_cap_exceeded"],
    verification_scope_included_script_slot_duplicate: ["verification_scope_included_script_slot_duplicate", "verification_scope_script_allocation_ref_mismatch"],
    verification_scope_additional_script_pricing_tbd_required: ["verification_scope_additional_script_pricing_tbd_required"],
    verification_scope_deadline_outside_included_window: ["verification_scope_deadline_outside_included_window", "utc_rfc3339_timestamp"],
    verification_scope_story_4_1_field_forbidden: ["verification_scope_story_4_1_field_forbidden"],
    verification_scope_outcome_default_out_of_scope_required: ["verification_scope_outcome_default_out_of_scope_required"],
    verification_scope_claim_unsafe_text_forbidden: ["verification_scope_claim_unsafe_text_forbidden"],
    review_event_verification_scope_actor_required: ["review_event_verification_scope_actor_required"],
    review_event_verification_scope_customer_backing_required: ["review_event_verification_scope_customer_backing_required"],
    review_event_verification_scope_reason_claim_unsafe_text_forbidden: ["review_event_verification_scope_reason_claim_unsafe_text_forbidden"],
    review_event_verification_scope_supersedes_family_mismatch: ["review_event_verification_scope_supersedes_family_mismatch", "review_event_expert_supersedes_family_mismatch", "review_event_verification_scope_version_invalid"],
    review_event_verification_scope_version_invalid: ["review_event_verification_scope_version_invalid"],
    false_positive_record_reviewer_actor_required: ["false_positive_record_reviewer_actor_required", "const"],
    false_positive_record_evidence_basis_required: ["false_positive_record_evidence_basis_required", "false_positive_record_reference_mismatch", "required", "min_items"],
    false_positive_record_source_reference_state_mismatch: ["false_positive_record_source_reference_state_mismatch"],
    false_positive_record_reference_mismatch: ["false_positive_record_reference_mismatch"],
    false_positive_record_rationale_required: ["false_positive_record_rationale_required", "required"],
    false_positive_record_limitations_required: ["false_positive_record_limitations_required", "required", "min_items"],
    false_positive_record_finding_ref_required: ["false_positive_record_finding_ref_required", "false_positive_record_reference_mismatch", "required"],
    false_positive_record_raw_source_text_forbidden: ["false_positive_record_raw_source_text_forbidden"],
    false_positive_record_claim_unsafe_text_forbidden: ["false_positive_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_customer_acceptance_required: ["accepted_risk_record_customer_acceptance_required", "accepted_risk_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_actor_required: ["accepted_risk_record_actor_required"],
    accepted_risk_record_rewrite_forbidden: ["accepted_risk_record_rewrite_forbidden", "accepted_risk_record_claim_unsafe_text_forbidden", "additional_property"],
    accepted_risk_record_evidence_basis_unbound: ["accepted_risk_record_evidence_basis_unbound", "accepted_risk_record_claim_unsafe_text_forbidden", "accepted_risk_record_reference_mismatch"],
    accepted_risk_record_source_reference_state_mismatch: ["accepted_risk_record_source_reference_state_mismatch", "accepted_risk_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_reference_mismatch: ["accepted_risk_record_reference_mismatch", "accepted_risk_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_review_by_date_invalid: ["accepted_risk_record_review_by_date_invalid", "accepted_risk_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_limitations_required: ["accepted_risk_record_limitations_required", "required", "min_items"],
    accepted_risk_record_raw_source_text_forbidden: ["accepted_risk_record_raw_source_text_forbidden", "accepted_risk_record_claim_unsafe_text_forbidden"],
    accepted_risk_record_claim_unsafe_text_forbidden: ["accepted_risk_record_claim_unsafe_text_forbidden"],
    customer_facing_finding_outcome_section_required: ["customer_facing_finding_outcome_section_required", "customer_facing_finding_claim_unsafe_text_forbidden", "required"],
    customer_facing_finding_outcome_details_required: ["customer_facing_finding_outcome_details_required", "customer_facing_finding_claim_unsafe_text_forbidden", "required", "min_items", "const"],
    customer_facing_finding_outcome_export_required: ["customer_facing_finding_outcome_export_required", "required", "enum"],
    review_event_false_positive_reviewer_actor_required: ["review_event_false_positive_reviewer_actor_required"],
    review_event_accepted_risk_customer_evidence_required: ["review_event_accepted_risk_customer_evidence_required"],
    review_event_outcome_supersedes_family_mismatch: ["review_event_outcome_supersedes_family_mismatch", "review_event_expert_supersedes_family_mismatch"],
    review_event_expert_supersedes_family_mismatch: ["review_event_expert_supersedes_family_mismatch"],
    customer_event_cannot_supersede_expert_record: ["customer_event_cannot_supersede_expert_record", "review_event_identity_mismatch"],
    review_event_classification_reviewer_actor_required: ["review_event_classification_reviewer_actor_required"],
    review_event_remediation_guidance_reviewer_actor_required: ["review_event_remediation_guidance_reviewer_actor_required"],
    review_event_customer_remediation_actor_required: ["review_event_customer_remediation_actor_required"],
    review_event_validation_reviewer_actor_required: ["review_event_validation_reviewer_actor_required"]
  };
  return mapping[expectedFailure] ?? [expectedFailure];
}

if (errors.length > 0) {
  console.error("Protocol gate failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Protocol gate passed: schemas, fixtures, negative cases, canonical identities, signing inputs, source-safety markers, and required Story 4.1 registrations are valid.");

function isSigningInput(schemaId) {
  return schemaId === "urn:codeattest:protocol:v0:identity-signing-input";
}

function collectErrors(nextErrors) {
  for (const error of nextErrors) {
    errors.push(error.message);
  }
}

function expect(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}
