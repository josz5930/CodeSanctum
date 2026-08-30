import { computeCanonicalSha256Id } from "./canonical-identity.js";
import type { BundleManifest, CustomerApproval, DisclosurePolicy, OutboundManifest, ScannerFindingSet } from "./generated/protocol-v0.js";

/**
 * C5-05/C5-32: faithful TypeScript ports of `validateOutboundManifestSemantics`,
 * `validateCustomerApprovalSemantics`, and `validateDisclosurePolicySemantics`
 * in `scripts/lib/protocol-utils.mjs` -- intake and the worker must not
 * import that script module (dependency-direction rule), so the same rules
 * live here as the single source both the runtime services and the script
 * adapter can be checked against via fixture-driven convergence tests.
 * These assume schema-valid input (a prior `validateProtocolSchema` call);
 * they degrade to "no issues" on structurally unrecognizable input rather
 * than throwing, matching the script validator's behavior.
 */

type EvidenceCategoryLike = {
  category?: unknown;
  included?: unknown;
  inclusion_state?: unknown;
  source_derived_class?: unknown;
  source_code_disclosure?: unknown;
  redaction_state?: unknown;
  redaction_configuration_version?: unknown;
  limitation?: unknown;
  details?: unknown;
  retention_handling?: unknown;
  snippet_controls?: unknown;
};

const REQUIRED_EVIDENCE_CATEGORIES = [
  "metadata",
  "dependencies",
  "scanner_findings",
  "raw_snippets",
  "targeted_files",
  "derived_artifacts",
  "never_collected_items"
] as const;

export type OutboundManifestSemanticIssue =
  | "outbound_manifest_identity_mismatch"
  | "outbound_manifest_missing_evidence_category"
  | "outbound_manifest_duplicate_evidence_category"
  | "outbound_manifest_policy_coverage_mode_mismatch"
  | "outbound_manifest_policy_ref_mismatch"
  | "preview_safe_package_state_required"
  | "preview_safe_approval_state_required"
  | "metadata_only_must_not_include_snippets"
  | "metadata_only_warning_required"
  | "finding_context_requires_caps_redaction"
  | "extended_requires_selected_files_or_areas"
  | "retained_review_artifact_class_required"
  | "source_code_disclosure_label_required"
  | "raw_snippet_wrong_source_class"
  | "targeted_file_wrong_source_class"
  | "source_code_disclosure_controls_required"
  | "outbound_manifest_inclusion_state_mismatch"
  | "redaction_limitation_required"
  | "outbound_manifest_data_minimization_required";

export function outboundManifestSemanticIssues(value: unknown): OutboundManifestSemanticIssue[] {
  const issues: OutboundManifestSemanticIssue[] = [];
  if (!isOutboundManifestLike(value)) {
    return issues;
  }

  const validModes = new Set(["metadata_only", "finding_context_snippets", "extended_approved_snippets_or_targeted_files"]);
  if (!validModes.has(value.coverage_mode)) {
    return issues;
  }

  const categories = categoryMap(value.evidence_categories);
  const identityInput: Record<string, unknown> = { ...(value as unknown as Record<string, unknown>) };
  delete identityInput["manifest_id"];
  try {
    if (computeCanonicalSha256Id(identityInput) !== value.manifest_id) {
      issues.push("outbound_manifest_identity_mismatch");
    }
  } catch {
    issues.push("outbound_manifest_identity_mismatch");
  }

  for (const category of REQUIRED_EVIDENCE_CATEGORIES) {
    if (!categories.has(category)) {
      issues.push("outbound_manifest_missing_evidence_category");
    }
  }
  if (categories.size !== (value.evidence_categories ?? []).length) {
    issues.push("outbound_manifest_duplicate_evidence_category");
  }

  if (value.disclosure_policy_summary?.coverage_mode !== value.coverage_mode) {
    issues.push("outbound_manifest_policy_coverage_mode_mismatch");
  }
  if (value.disclosure_policy_summary?.disclosure_policy_ref !== value.disclosure_policy_ref) {
    issues.push("outbound_manifest_policy_ref_mismatch");
  }

  const packageState = value.package_preview_state;
  if (packageState?.state !== "preview_generated" || packageState?.send_ready !== false || packageState?.local_only !== true) {
    issues.push("preview_safe_package_state_required");
  }
  if (value.approval?.approval_state !== "not_requested") {
    issues.push("preview_safe_approval_state_required");
  }

  const warningsText = joinedLower(value.warnings);
  const limitationsText = joinedLower(value.limitations);
  const rawSnippets = categories.get("raw_snippets");
  const targetedFiles = categories.get("targeted_files");

  if (value.coverage_mode === "metadata_only") {
    if (rawSnippets?.included === true || targetedFiles?.included === true) {
      issues.push("metadata_only_must_not_include_snippets");
    }
    if (!warningsText.includes("expert confidence may be lower") || !warningsText.includes("snippets were not provided")) {
      issues.push("metadata_only_warning_required");
    }
  }

  if (value.coverage_mode === "finding_context_snippets") {
    if (rawSnippets?.included !== true || targetedFiles?.included === true) {
      issues.push("finding_context_requires_caps_redaction");
    }
  }

  if (value.coverage_mode === "extended_approved_snippets_or_targeted_files") {
    if (rawSnippets?.included !== true || targetedFiles?.included !== true) {
      issues.push("extended_requires_selected_files_or_areas");
    }
    const snippetControls = targetedFiles?.snippet_controls as { selected_files_or_areas?: unknown } | undefined;
    if (!Array.isArray(snippetControls?.selected_files_or_areas) || snippetControls.selected_files_or_areas.length === 0) {
      issues.push("extended_requires_selected_files_or_areas");
    }
  }

  for (const categoryName of ["metadata", "dependencies", "scanner_findings", "derived_artifacts"] as const) {
    const category = categories.get(categoryName);
    if (category?.included === true && category.source_derived_class !== "retained_review_artifact") {
      issues.push("retained_review_artifact_class_required");
    }
  }

  for (const categoryName of ["raw_snippets", "targeted_files"] as const) {
    const category = categories.get(categoryName);
    if (category?.included !== true) {
      continue;
    }
    if (category.source_code_disclosure !== true) {
      issues.push("source_code_disclosure_label_required");
    }
    if (!sourceRetentionClass(category.source_derived_class)) {
      issues.push(categoryName === "raw_snippets" ? "raw_snippet_wrong_source_class" : "targeted_file_wrong_source_class");
    }
    const controls = (category.snippet_controls as { max_snippet_chars?: unknown; context_lines?: unknown } | undefined) ?? {};
    if (!positiveNumber(controls.max_snippet_chars) || !Number.isInteger(controls.context_lines) || (controls.context_lines as number) < 0) {
      issues.push("source_code_disclosure_controls_required");
    }
    const categoryText = joinedLower([...(asStringArray(category.details)), category.limitation, category.retention_handling, warningsText]);
    if (!categoryText.includes("source-code disclosure")) {
      issues.push("source_code_disclosure_label_required");
    }
  }

  for (const category of value.evidence_categories ?? []) {
    if (category?.included === true && category.inclusion_state !== "included") {
      issues.push("outbound_manifest_inclusion_state_mismatch");
    }
    if (category?.redaction_state === "redaction_configured") {
      const version = typeof category.redaction_configuration_version === "string" ? category.redaction_configuration_version.trim() : "";
      const redactionText = joinedLower([category.limitation, ...asStringArray(category.details), warningsText, limitationsText]);
      if (version === "" || version === "not_configured" || version === "not_applicable") {
        issues.push("redaction_limitation_required");
      }
      if (!redactionText.includes("cannot prove absence") && !redactionText.includes("cannot prove the absence")) {
        issues.push("redaction_limitation_required");
      }
    }
  }

  const summaryProfile = typeof value.disclosure_policy_summary?.redaction_profile === "string" ? value.disclosure_policy_summary.redaction_profile.trim() : "";
  const summaryConfigVersion = typeof value.disclosure_policy_summary?.redaction_configuration_version === "string" ? value.disclosure_policy_summary.redaction_configuration_version.trim() : "";
  const redactionConfiguredAtPolicy = summaryProfile !== "" && summaryProfile !== "not_applicable" && summaryProfile !== "not_configured" && summaryConfigVersion !== "" && summaryConfigVersion !== "not_applicable" && summaryConfigVersion !== "not_configured";
  if (redactionConfiguredAtPolicy) {
    const topLevelRedactionText = joinedLower([warningsText, limitationsText]);
    if (!topLevelRedactionText.includes("cannot prove absence") && !topLevelRedactionText.includes("cannot prove the absence")) {
      issues.push("redaction_limitation_required");
    }
  }

  const neverCollectedText = joinedLower(asStringArray(categories.get("never_collected_items")?.details));
  for (const requiredText of ["complete repository archive", "full git history", "unapproved source files", "unapproved raw snippets", "local environment secrets"]) {
    if (!neverCollectedText.includes(requiredText)) {
      issues.push("outbound_manifest_data_minimization_required");
    }
  }

  return issues;
}

function isOutboundManifestLike(value: unknown): value is OutboundManifest {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as OutboundManifest).manifest_id === "string" &&
      typeof (value as OutboundManifest).coverage_mode === "string" &&
      Array.isArray((value as OutboundManifest).evidence_categories) &&
      (value as OutboundManifest).package_preview_state &&
      (value as OutboundManifest).approval
  );
}

export type CustomerApprovalSemanticIssue =
  | "approval_manifest_context_mismatch"
  | "approval_displayed_context_required"
  | "approval_state_mismatch"
  | "approval_warnings_acknowledgement_mismatch"
  | "approval_not_submitted_state_required";

export function customerApprovalSemanticIssues(value: unknown): CustomerApprovalSemanticIssue[] {
  const issues: CustomerApprovalSemanticIssue[] = [];
  if (!isCustomerApprovalLike(value)) {
    return issues;
  }

  if (value.displayed_context?.manifest_id !== value.manifest_id) {
    issues.push("approval_manifest_context_mismatch");
  }

  const displayed = (value.displayed_context ?? {}) as Record<string, unknown>;
  for (const field of ["manifest_id", "selected_application", "selected_commit", "repository_identity", "coverage_mode", "disclosure_policy_ref", "disclosure_warnings", "bundle_preview_summary"]) {
    if (displayed[field] === undefined) {
      issues.push("approval_displayed_context_required");
    }
  }

  const summary = String(displayed["bundle_preview_summary"] ?? "").toLowerCase();
  if (!summary.includes("not_submitted") || !summary.includes("no evidence is sent")) {
    issues.push("approval_displayed_context_required");
  }

  if (value.decision === "approved" && (value as unknown as { not_submitted_state?: unknown }).not_submitted_state !== undefined) {
    issues.push("approval_state_mismatch");
  }
  if (value.decision === "approved" && Array.isArray(displayed["disclosure_warnings"])) {
    const displayedWarnings = JSON.stringify(displayed["disclosure_warnings"] ?? []);
    const acknowledgedWarnings = JSON.stringify(value.warnings_acknowledged ?? []);
    if (displayedWarnings !== acknowledgedWarnings) {
      issues.push("approval_warnings_acknowledgement_mismatch");
    }
  }
  if (value.decision === "declined") {
    const state = ((value as unknown as { not_submitted_state?: Record<string, unknown> }).not_submitted_state ?? {}) as Record<string, unknown>;
    if (state["state"] !== "not_submitted" || state["evidence_bundle_created"] !== false || state["evidence_sent"] !== false) {
      issues.push("approval_not_submitted_state_required");
    }
    const nextActions = new Set(Array.isArray(state["next_actions"]) ? (state["next_actions"] as unknown[]) : []);
    for (const action of ["revise policy", "rerun scan", "export manifest", "exit"]) {
      if (!nextActions.has(action)) {
        issues.push("approval_not_submitted_state_required");
      }
    }
  }

  return issues;
}

function isCustomerApprovalLike(value: unknown): value is CustomerApproval {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as CustomerApproval).approval_id === "string" &&
      typeof (value as CustomerApproval).manifest_id === "string" &&
      typeof (value as CustomerApproval).decision === "string"
  );
}

export type DisclosurePolicySemanticIssue =
  | "disclosure_policy_missing_evidence_category"
  | "disclosure_policy_duplicate_evidence_category"
  | "scanner_finding_set_ref_required"
  | "metadata_category_mismatch"
  | "dependency_category_mismatch"
  | "scanner_findings_category_mismatch"
  | "retained_review_artifact_class_required"
  | "metadata_only_must_not_include_snippets"
  | "metadata_only_warning_required"
  | "finding_context_requires_caps_redaction"
  | "finding_context_warning_required"
  | "extended_requires_selected_files_or_areas"
  | "extended_warning_required"
  | "raw_snippet_wrong_source_class"
  | "targeted_file_wrong_source_class"
  | "retained_source_requires_opt_in_and_period"
  | "redaction_limitation_required";

export function disclosurePolicySemanticIssues(value: unknown): DisclosurePolicySemanticIssue[] {
  const issues: DisclosurePolicySemanticIssue[] = [];
  if (!isDisclosurePolicyLike(value)) {
    return issues;
  }

  const validModes = new Set(["metadata_only", "finding_context_snippets", "extended_approved_snippets_or_targeted_files"]);
  if (!validModes.has(value.coverage_mode)) {
    return issues;
  }

  const categories = categoryMap(value.evidence_categories);
  for (const category of REQUIRED_EVIDENCE_CATEGORIES) {
    if (!categories.has(category)) {
      issues.push("disclosure_policy_missing_evidence_category");
    }
  }
  if (categories.size !== (value.evidence_categories ?? []).length) {
    issues.push("disclosure_policy_duplicate_evidence_category");
  }

  if (value.include_scanner_findings === true && typeof value.scanner_finding_set_ref !== "string") {
    issues.push("scanner_finding_set_ref_required");
  }

  if (!includedCategory(categories, "metadata", value.include_metadata)) {
    issues.push("metadata_category_mismatch");
  }
  if (!includedCategory(categories, "dependencies", value.include_dependency_information)) {
    issues.push("dependency_category_mismatch");
  }
  if (!includedCategory(categories, "scanner_findings", value.include_scanner_findings)) {
    issues.push("scanner_findings_category_mismatch");
  }

  for (const categoryName of ["metadata", "dependencies", "scanner_findings", "derived_artifacts"] as const) {
    const category = categories.get(categoryName);
    if (category?.included === true && category.source_derived_class !== "retained_review_artifact") {
      issues.push("retained_review_artifact_class_required");
    }
  }

  const snippetPolicy = (value.snippet_policy ?? {}) as Record<string, unknown>;
  const redactionPolicy = (value.redaction_policy ?? {}) as Record<string, unknown>;
  const retentionPolicy = (value.retention_policy ?? {}) as Record<string, unknown>;
  const warningsText = joinedLower(value.warnings);
  const limitationsText = joinedLower(value.limitations);

  if (value.coverage_mode === "metadata_only") {
    if (
      snippetPolicy["allow_raw_snippets"] !== false ||
      snippetPolicy["max_snippet_chars"] !== 0 ||
      snippetPolicy["context_lines"] !== 0 ||
      snippetPolicy["selection_behavior"] !== "none" ||
      (Array.isArray(snippetPolicy["selected_files_or_areas"]) ? snippetPolicy["selected_files_or_areas"].length : 0) !== 0 ||
      categories.get("raw_snippets")?.included === true ||
      categories.get("targeted_files")?.included === true
    ) {
      issues.push("metadata_only_must_not_include_snippets");
    }
    if (!warningsText.includes("expert confidence may be lower") || !warningsText.includes("snippets were not provided")) {
      issues.push("metadata_only_warning_required");
    }
  }

  if (value.coverage_mode === "finding_context_snippets") {
    if (
      snippetPolicy["allow_raw_snippets"] !== true ||
      snippetPolicy["selection_behavior"] !== "finding_context" ||
      !positiveNumber(snippetPolicy["max_snippet_chars"]) ||
      !Number.isInteger(snippetPolicy["context_lines"]) ||
      (snippetPolicy["context_lines"] as number) < 0 ||
      (Array.isArray(snippetPolicy["selected_files_or_areas"]) ? snippetPolicy["selected_files_or_areas"].length : 0) !== 0
    ) {
      issues.push("finding_context_requires_caps_redaction");
    }
    if (!warningsText.includes("source-code disclosure") || !warningsText.includes("capped") || !warningsText.includes("redacted")) {
      issues.push("finding_context_warning_required");
    }
  }

  if (value.coverage_mode === "extended_approved_snippets_or_targeted_files") {
    if (
      snippetPolicy["allow_raw_snippets"] !== true ||
      snippetPolicy["selection_behavior"] !== "extended_selected_files_or_areas" ||
      !Array.isArray(snippetPolicy["selected_files_or_areas"]) ||
      snippetPolicy["selected_files_or_areas"].length === 0 ||
      categories.get("targeted_files")?.included !== true
    ) {
      issues.push("extended_requires_selected_files_or_areas");
    }
    if (!warningsText.includes("improve review confidence") || !warningsText.includes("increases disclosure")) {
      issues.push("extended_warning_required");
    }
  }

  if (snippetPolicy["raw_snippet_default_class"] !== "transient_source_derived") {
    issues.push("raw_snippet_wrong_source_class");
  }

  if (categories.get("raw_snippets")?.included === true && retentionPolicy["raw_snippet_class"] !== "transient_source_derived" && retentionPolicy["raw_snippet_class"] !== "customer_opt_in_retained_source") {
    issues.push("raw_snippet_wrong_source_class");
  }
  if (categories.get("targeted_files")?.included === true && retentionPolicy["targeted_file_class"] !== "transient_source_derived" && retentionPolicy["targeted_file_class"] !== "customer_opt_in_retained_source") {
    issues.push("targeted_file_wrong_source_class");
  }

  if (retentionPolicy["raw_snippet_class"] === "customer_opt_in_retained_source" || retentionPolicy["targeted_file_class"] === "customer_opt_in_retained_source") {
    const period = typeof retentionPolicy["retention_period"] === "string" ? retentionPolicy["retention_period"].trim() : "";
    if (retentionPolicy["retain_source_opt_in"] !== true || period === "" || period === "not_applicable") {
      issues.push("retained_source_requires_opt_in_and_period");
    }
  }

  if (redactionPolicy["enabled"] === true) {
    const redactionText = `${String(redactionPolicy["limitation"] ?? "").toLowerCase()} ${warningsText} ${limitationsText}`;
    if (!redactionText.includes("cannot prove absence") && !redactionText.includes("cannot prove the absence")) {
      issues.push("redaction_limitation_required");
    }
  }

  return issues;
}

function isDisclosurePolicyLike(value: unknown): value is DisclosurePolicy {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as DisclosurePolicy).disclosure_policy_id === "string" &&
      typeof (value as DisclosurePolicy).coverage_mode === "string" &&
      (value as DisclosurePolicy).snippet_policy &&
      (value as DisclosurePolicy).retention_policy
  );
}

function categoryMap(categories: readonly EvidenceCategoryLike[] | undefined): Map<string, EvidenceCategoryLike> {
  const map = new Map<string, EvidenceCategoryLike>();
  if (!Array.isArray(categories)) {
    return map;
  }
  for (const category of categories) {
    const name = category?.category;
    if (typeof name === "string" && !map.has(name)) {
      map.set(name, category);
    }
  }
  return map;
}

function includedCategory(categories: Map<string, EvidenceCategoryLike>, category: string, expected: unknown): boolean {
  return categories.get(category)?.included === expected;
}

function joinedLower(values: readonly unknown[] | undefined): string {
  return Array.isArray(values) ? values.join(" ").toLowerCase() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function positiveNumber(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) > 0;
}

function sourceRetentionClass(value: unknown): boolean {
  return value === "transient_source_derived" || value === "customer_opt_in_retained_source";
}

const BUNDLE_CLAIM_FORBIDDEN_PHRASES = ["vendor receipt", "received state", "attestation", "review findings", "no vulnerabilities", "certified"] as const;

export type BundleManifestCleanupSemanticIssue = "source_derived_cleanup_intent_required" | "bundle_claim_safe_language_required";

/**
 * A scoped port of `validateBundleManifestSemantics` in
 * `scripts/lib/protocol-utils.mjs`, covering only the portion that is a
 * genuine protocol invariant checkable from the bundle manifest object
 * alone. The script version also (a) re-derives checks intake already runs
 * elsewhere against its own trusted objects (`approved_manifest_id`,
 * `identity_input_excludes` -- schema-constrained to a single valid value
 * already, and `customer_approval_decision`/required-artifact-type presence,
 * all duplicated in `services/intake/src/index.ts`), and (b) reads referenced
 * fixture files from disk (`validateBundleFixtureChain`), which only makes
 * sense for the offline fixture/gate tooling, not a runtime service with no
 * filesystem access to a "fixture root". Neither is repeated here.
 */
export function bundleManifestCleanupSemanticIssues(value: unknown): BundleManifestCleanupSemanticIssue[] {
  const issues: BundleManifestCleanupSemanticIssue[] = [];
  if (!isBundleManifestLike(value)) {
    return issues;
  }

  const cleanupRefs = new Set((value.local_cleanup_intent ?? []).map((item) => item.artifact_ref));
  for (const artifact of value.artifact_references ?? []) {
    const sourceDerived = artifact.source_derived_class === "transient_source_derived" || artifact.source_derived_class === "customer_opt_in_retained_source";
    if (sourceDerived && !cleanupRefs.has(artifact.artifact_ref)) {
      issues.push("source_derived_cleanup_intent_required");
    }
  }

  for (const intent of value.local_cleanup_intent ?? []) {
    if (intent.source_derived_class === "transient_source_derived" && (intent.cleanup_required !== true || intent.deletion_evidence_state !== "pending")) {
      issues.push("source_derived_cleanup_intent_required");
    }
  }

  const lower = JSON.stringify(value).toLowerCase();
  for (const forbidden of BUNDLE_CLAIM_FORBIDDEN_PHRASES) {
    if (lower.includes(forbidden)) {
      issues.push("bundle_claim_safe_language_required");
    }
  }

  return issues;
}

function isBundleManifestLike(value: unknown): value is BundleManifest {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as BundleManifest).evidence_bundle_id === "string" &&
      typeof (value as BundleManifest).manifest_id === "string" &&
      Array.isArray((value as BundleManifest).artifact_references) &&
      (value as BundleManifest).verification_metadata
  );
}

export type ScannerFindingSetSemanticIssue = "scanner_run_failure_reason_contradiction" | "candidate_finding_source_run_unresolved";

/**
 * C5-05: no existing offline (`scripts/lib`) precedent to port -- these two
 * checks are derived directly from the Rust runner's own generation-time
 * invariants (`validate_scanner_finding_set_metadata` in
 * `runner/crates/local-runner-scaffold/src/lib.rs`), not invented here: a
 * scanner run's `failure_reason` must be present exactly when its `status`
 * says the run did not succeed, and a candidate finding's `source` must
 * resolve to a scanner run that actually succeeded -- neither is expressible
 * in JSON Schema alone.
 */
export function scannerFindingSetSemanticIssues(value: unknown): ScannerFindingSetSemanticIssue[] {
  const issues: ScannerFindingSetSemanticIssue[] = [];
  if (!isScannerFindingSetLike(value)) {
    return issues;
  }

  const succeededSources = new Set<string>();
  for (const run of value.scanner_runs ?? []) {
    const unsuccessful = run.status === "failed" || run.status === "unavailable" || run.status === "invalid_output" || run.status === "skipped";
    const successful = run.status === "succeeded" || run.status === "no_findings";
    if (unsuccessful && (typeof run.failure_reason !== "string" || run.failure_reason.trim().length === 0)) {
      issues.push("scanner_run_failure_reason_contradiction");
    }
    if (successful && run.failure_reason !== undefined) {
      issues.push("scanner_run_failure_reason_contradiction");
    }
    if (run.status === "succeeded") {
      succeededSources.add(run.scanner_name);
    }
  }

  for (const finding of value.candidate_findings ?? []) {
    if (!succeededSources.has(finding.source)) {
      issues.push("candidate_finding_source_run_unresolved");
    }
  }

  return issues;
}

function isScannerFindingSetLike(value: unknown): value is ScannerFindingSet {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as ScannerFindingSet).scanner_finding_set_id === "string" &&
      Array.isArray((value as ScannerFindingSet).scanner_runs) &&
      Array.isArray((value as ScannerFindingSet).candidate_findings)
  );
}
