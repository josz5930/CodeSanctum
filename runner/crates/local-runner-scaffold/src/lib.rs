//! Minimal Local Runner workspace target for local CodeAttest protocol gates.
//!
//! Story 1.8 adds explicit customer-side approval and a signed local Evidence
//! Bundle artifact chain. The bundle remains local and not submitted.
//!
//! Story 1.9 extends this crate with a local attempt/status log
//! (`.codeattest/local-runner-attempts.jsonl`), stage-aware failure output,
//! explicit approval reuse for reruns, `bundle status` inspection, and
//! `runner trust` release-trust reporting. All Story 1.9 surfaces remain
//! local-only: they never emit submitted/received/finalized state.

pub mod keys;
pub mod ml_dsa;
pub mod release_trust;
pub mod submit;

pub use submit::{SubmitAttemptContext, SubmitInput, SubmitOutcome, submit_attempt, submit_bundle};

use regex::Regex;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

pub const PROTOCOL_VERSION: &str = "codeattest.v0";
pub const RUNNER_NAME: &str = "codeattest-local-runner";
pub const RUNNER_SIGNING_KEY_ID: &str = "codeattest-local-runner-key";
const MAX_SCANNER_FILE_BYTES: u64 = 1024 * 1024;
const MAX_FINDINGS_PER_RULE: usize = 1000;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const COMMAND_OUTPUT_CAP_BYTES: usize = 64 * 1024;
const DEFAULT_SNIPPET_CHARS: u32 = 800;
const DEFAULT_CONTEXT_LINES: u32 = 2;
const EXTENDED_DEFAULT_SNIPPET_CHARS: u32 = 1200;
const EXTENDED_DEFAULT_CONTEXT_LINES: u32 = 5;

/// Describes the only evidence boundary this scaffold is allowed to claim.
pub fn evidence_boundary() -> &'static str {
    "synthetic-demo-only"
}

pub fn environment_evidence_gate() -> EnvironmentEvidenceGate {
    EnvironmentEvidenceGate {
        protocol_version: PROTOCOL_VERSION.to_string(),
        environment_profile: "synthetic_demo".to_string(),
        allowed_source_derived_classes: vec![
            "never_collected".to_string(),
            "retained_review_artifact".to_string(),
            "transient_source_derived".to_string(),
        ],
        real_raw_snippet_acceptance: false,
        real_targeted_file_acceptance: false,
        access_control_ready: false,
        access_logging_ready: false,
        encryption_at_rest_ready: false,
        retention_defaults_ready: false,
        deletion_controls_ready: false,
        demo_budget_gate_ready: true,
        signing_release_trust_ready: false,
        retention_period_required: false,
        evidence_boundary: evidence_boundary().to_string(),
        notes: vec![
            "Synthetic demo mode rejects real Raw Snippets and real targeted files.".to_string(),
        ],
    }
}

pub fn validate_environment_evidence_gate(gate: &EnvironmentEvidenceGate) -> Result<(), String> {
    if gate.protocol_version != PROTOCOL_VERSION {
        return Err(format!("protocol_version must be {PROTOCOL_VERSION}"));
    }
    let known_profile = matches!(
        gate.environment_profile.as_str(),
        "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready"
    );
    if !known_profile {
        return Err(
            "environment_profile must be synthetic_demo, partner_pilot_candidate, or partner_pilot_real_snippet_ready"
                .to_string(),
        );
    }
    let accepts_real = gate.real_raw_snippet_acceptance || gate.real_targeted_file_acceptance;
    if gate.environment_profile == "synthetic_demo" {
        if accepts_real {
            return Err(
                "synthetic_demo must reject real Raw Snippets and real targeted files".to_string(),
            );
        }
        if gate.evidence_boundary != evidence_boundary() {
            return Err(
                "synthetic_demo must use synthetic-demo-only evidence boundary".to_string(),
            );
        }
        if gate
            .allowed_source_derived_classes
            .iter()
            .any(|class| class == "customer_opt_in_retained_source")
        {
            return Err(
                "synthetic_demo must not allow customer_opt_in_retained_source".to_string(),
            );
        }
    }
    if gate.environment_profile != "partner_pilot_real_snippet_ready"
        && gate
            .allowed_source_derived_classes
            .iter()
            .any(|class| class == "customer_opt_in_retained_source")
    {
        return Err(
            "customer_opt_in_retained_source requires partner_pilot_real_snippet_ready".to_string(),
        );
    }
    if accepts_real {
        if gate.environment_profile != "partner_pilot_real_snippet_ready" {
            return Err(
                "real source-derived evidence requires partner_pilot_real_snippet_ready"
                    .to_string(),
            );
        }
        let all_ready = gate.access_control_ready
            && gate.access_logging_ready
            && gate.encryption_at_rest_ready
            && gate.retention_defaults_ready
            && gate.deletion_controls_ready
            && gate.demo_budget_gate_ready
            && gate.signing_release_trust_ready
            && gate.retention_period_required;
        if !all_ready {
            return Err(
                "real source-derived evidence requires every evidence-handling readiness gate"
                    .to_string(),
            );
        }
        if !gate
            .allowed_source_derived_classes
            .iter()
            .any(|class| class == "customer_opt_in_retained_source")
        {
            return Err("real source-derived evidence requires customer_opt_in_retained_source to be explicitly allowed".to_string());
        }
    }
    Ok(())
}

fn validate_environment_gate_for_manifest(
    gate: &EnvironmentEvidenceGate,
    artifacts: &[ArtifactReference],
) -> Result<(), String> {
    validate_environment_evidence_gate(gate)?;
    for artifact in artifacts {
        if !gate
            .allowed_source_derived_classes
            .iter()
            .any(|allowed| allowed == &artifact.source_derived_class)
        {
            return Err(format!(
                "{} uses source-derived class {} not allowed by environment profile {}",
                artifact.artifact_ref, artifact.source_derived_class, gate.environment_profile
            ));
        }
        if matches!(
            artifact.artifact_type.as_str(),
            "raw_snippet" | "targeted_file"
        ) {
            let markers = artifact.synthetic_markers.as_deref().unwrap_or(&[]);
            let has_synthetic_marker = markers.iter().any(|marker| marker == "SYNTHETIC_DEMO_DATA")
                && markers.iter().any(|marker| marker == "NOT_CUSTOMER_SOURCE");
            if gate.environment_profile == "synthetic_demo" && !has_synthetic_marker {
                return Err(format!(
                    "{} is real source-derived evidence; synthetic_demo requires SYNTHETIC_DEMO_DATA and NOT_CUSTOMER_SOURCE markers",
                    artifact.artifact_ref
                ));
            }
            if artifact.source_derived_class == "customer_opt_in_retained_source"
                && (!gate.real_raw_snippet_acceptance || !gate.real_targeted_file_acceptance)
            {
                return Err(format!(
                    "{} requires explicit real source-derived evidence acceptance",
                    artifact.artifact_ref
                ));
            }
        }
    }
    Ok(())
}

pub fn runner_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnvironmentEvidenceGate {
    pub protocol_version: String,
    pub environment_profile: String,
    pub allowed_source_derived_classes: Vec<String>,
    pub real_raw_snippet_acceptance: bool,
    pub real_targeted_file_acceptance: bool,
    pub access_control_ready: bool,
    pub access_logging_ready: bool,
    pub encryption_at_rest_ready: bool,
    pub retention_defaults_ready: bool,
    pub deletion_controls_ready: bool,
    pub demo_budget_gate_ready: bool,
    pub signing_release_trust_ready: bool,
    pub retention_period_required: bool,
    pub evidence_boundary: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalRunnerStage {
    ScopeInit,
    ScanRun,
    DisclosureConfigure,
    ManifestPreview,
    Approval,
    BundlePackaging,
    BundleSigning,
    BundlePrepare,
    StatusInspect,
    RunnerTrust,
    Submit,
}

impl LocalRunnerStage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ScopeInit => "scope_init",
            Self::ScanRun => "scan_run",
            Self::DisclosureConfigure => "disclosure_configure",
            Self::ManifestPreview => "manifest_preview",
            Self::Approval => "approval",
            Self::BundlePackaging => "bundle_packaging",
            Self::BundleSigning => "bundle_signing",
            Self::BundlePrepare => "bundle_prepare",
            Self::StatusInspect => "status_inspect",
            Self::RunnerTrust => "runner_trust",
            Self::Submit => "submit",
        }
    }
}

impl fmt::Display for LocalRunnerStage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalRunnerOutcome {
    Succeeded,
    Failed,
    Declined,
    Blocked,
}

impl LocalRunnerOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Declined => "declined",
            Self::Blocked => "blocked",
        }
    }
}

impl fmt::Display for LocalRunnerOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    UnapprovedNotSubmitted,
    ApprovedNoSignedBundle,
    SignedBundleNotSubmitted,
}

impl ReviewState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnapprovedNotSubmitted => "unapproved_not_submitted",
            Self::ApprovedNoSignedBundle => "approved_no_signed_bundle",
            Self::SignedBundleNotSubmitted => "signed_bundle_not_submitted",
        }
    }
}

impl fmt::Display for ReviewState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    NotRequested,
    Approved,
    Declined,
    NotApplicable,
}

impl ApprovalState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRequested => "not_requested",
            Self::Approved => "approved",
            Self::Declined => "declined",
            Self::NotApplicable => "not_applicable",
        }
    }
}

impl fmt::Display for ApprovalState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalBundleState {
    NotCreated,
    FailedBeforeReady,
    ReadyNotSubmitted,
}

impl LocalBundleState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotCreated => "not_created",
            Self::FailedBeforeReady => "failed_before_ready",
            Self::ReadyNotSubmitted => "ready_not_submitted",
        }
    }
}

impl fmt::Display for LocalBundleState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalRunnerAttempt {
    pub protocol_version: String,
    pub attempt_id: String,
    pub stage: LocalRunnerStage,
    pub outcome: LocalRunnerOutcome,
    pub review_state: ReviewState,
    pub approval_state: ApprovalState,
    pub bundle_state: LocalBundleState,
    pub remote_state: String,
    pub occurred_at: String,
    pub runner: RunnerMetadata,
    pub runner_trust: RunnerTrustMetadata,
    pub identities: LocalAttemptIdentities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_metadata: Option<LocalApprovalMetadata>,
    pub diagnostics: LocalAttemptDiagnostics,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalAttemptIdentities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_receipt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submission_outcome_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalApprovalMetadata {
    pub decision: String,
    pub decided_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approving_actor: Option<ActorReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalAttemptDiagnostics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_failed: Option<LocalRunnerStage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<String>,
    pub message: String,
    pub retryable: bool,
    pub sensitive_detail_omitted: bool,
    pub raw_snippets_printed: bool,
    pub support_summary: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub local_artifact_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerTrustMetadata {
    pub runner_name: String,
    pub runner_version: String,
    pub build_identifier: String,
    pub release_identifier: String,
    pub release_signature_status: String,
    pub bundle_signing_mode: String,
    pub trust_label: String,
    pub evidence_boundary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_verification_artifact: Option<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeInitInput {
    pub application_path: PathBuf,
    pub review_id: String,
    pub selected_commit: String,
    pub output_path: PathBuf,
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewScope {
    pub protocol_version: String,
    pub review_scope_id: String,
    pub review_id: String,
    pub generated_at: String,
    pub selected_application: SelectedApplication,
    pub selected_commit: SelectedCommit,
    pub repository_identity: String,
    pub runner: RunnerMetadata,
    pub technical_context: Vec<TechnicalContext>,
    pub dependency_manifests: Vec<DependencyManifest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedApplication {
    pub application_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedCommit {
    pub commit_sha: String,
    pub source_control_system: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunnerMetadata {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TechnicalContext {
    pub context_type: String,
    pub status: String,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DependencyManifest {
    pub manifest_type: String,
    pub status: String,
    pub path: Option<String>,
    pub package_manager: String,
    pub dependency_count: usize,
    pub dependencies: Vec<String>,
    pub limitation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanRunInput {
    pub application_path: PathBuf,
    pub review_scope_ref: String,
    pub output_path: PathBuf,
    pub generated_at: String,
    pub regex_rules: Vec<RegexScannerRule>,
    pub semgrep_json_inputs: Vec<SemgrepJsonInput>,
    pub semgrep_local_commands: Vec<SemgrepLocalCommandInput>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisclosureConfigureInput {
    pub review_scope_ref: String,
    pub scanner_finding_set_ref: Option<String>,
    pub output_path: PathBuf,
    pub created_at: String,
    pub config: DisclosurePolicyConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestPreviewInput {
    pub scope_path: PathBuf,
    pub scanner_findings_path: Option<PathBuf>,
    pub disclosure_policy_path: PathBuf,
    pub output_path: PathBuf,
    pub generated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisclosurePolicyBuildResult {
    pub policy: DisclosurePolicy,
    pub coverage_mode_defaulted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosurePolicyConfig {
    pub coverage_mode: Option<String>,
    pub include_metadata: Option<bool>,
    pub include_dependency_information: Option<bool>,
    pub include_scanner_findings: Option<bool>,
    pub include_raw_snippets: Option<bool>,
    pub include_targeted_files: Option<bool>,
    pub max_snippet_chars: Option<u32>,
    pub context_lines: Option<u32>,
    #[serde(default)]
    pub selected_files_or_areas: Vec<String>,
    pub redaction: Option<DisclosureRedactionConfig>,
    pub retention: Option<DisclosureRetentionConfig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureRedactionConfig {
    #[serde(default)]
    pub enabled: bool,
    pub profile: Option<String>,
    pub configuration_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureRetentionConfig {
    pub raw_snippet_class: Option<String>,
    pub targeted_file_class: Option<String>,
    pub retain_source_opt_in: Option<bool>,
    pub retention_period: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosurePolicy {
    pub protocol_version: String,
    pub disclosure_policy_id: String,
    pub created_at: String,
    pub review_scope_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanner_finding_set_ref: Option<String>,
    pub coverage_mode: String,
    pub include_metadata: bool,
    pub include_dependency_information: bool,
    pub include_scanner_findings: bool,
    pub evidence_categories: Vec<DisclosureEvidenceCategory>,
    pub snippet_policy: DisclosureSnippetPolicy,
    pub redaction_policy: DisclosureRedactionPolicy,
    pub retention_policy: DisclosureRetentionPolicy,
    pub warnings: Vec<String>,
    pub limitations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_fixture_markers: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureEvidenceCategory {
    pub category: String,
    pub included: bool,
    pub source_derived_class: String,
    pub retention_handling: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limitation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureSnippetPolicy {
    pub allow_raw_snippets: bool,
    pub max_snippet_chars: u32,
    pub context_lines: u32,
    pub redaction_profile: String,
    pub raw_snippet_default_class: String,
    pub selection_behavior: String,
    pub selected_files_or_areas: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureRedactionPolicy {
    pub enabled: bool,
    pub profile: String,
    pub configuration_version: String,
    pub limitation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisclosureRetentionPolicy {
    pub raw_snippet_class: String,
    pub targeted_file_class: String,
    pub retain_source_opt_in: bool,
    pub retention_period: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScannerFindingSet {
    pub protocol_version: String,
    pub scanner_finding_set_id: String,
    pub generated_at: String,
    pub review_scope_ref: String,
    pub runner: RunnerMetadata,
    pub source_derived_class: String,
    pub scanner_runs: Vec<ScannerRun>,
    pub candidate_findings: Vec<CandidateFinding>,
    pub coverage_limitations: Vec<String>,
    pub artifact_references: Vec<ArtifactReference>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScannerRun {
    pub scanner_name: String,
    pub scanner_version: String,
    pub ruleset_identifier: String,
    pub executed_at: String,
    pub status: String,
    pub covered_file_group: String,
    pub scanned_files: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub rerun_possible: bool,
    pub source_derived_class: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateFinding {
    pub candidate_finding_id: String,
    pub source: String,
    pub affected_area: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<String>,
    pub scanner_rule_id: String,
    pub original_reference: String,
    pub source_artifact_refs: Vec<String>,
    pub status: String,
    pub source_derived_class: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArtifactReference {
    pub protocol_version: String,
    pub artifact_ref: String,
    pub artifact_type: String,
    pub digest: String,
    pub size_bytes: u64,
    pub source_derived_class: String,
    pub manifest_entry_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_path_anchor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_markers: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutboundManifest {
    pub protocol_version: String,
    pub manifest_id: String,
    pub generated_at: String,
    pub review_scope_ref: String,
    pub disclosure_policy_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanner_finding_set_ref: Option<String>,
    pub selected_scope_summary: SelectedScopeSummary,
    pub runner: RunnerMetadata,
    pub coverage_mode: String,
    pub disclosure_policy_summary: ManifestDisclosurePolicySummary,
    pub evidence_categories: Vec<ManifestEvidenceCategory>,
    pub artifact_references: Vec<ArtifactReference>,
    pub package_preview_state: PackagePreviewState,
    pub approval: ManifestApproval,
    pub warnings: Vec<String>,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectedScopeSummary {
    pub selected_application: SelectedApplication,
    pub selected_commit: SelectedCommit,
    pub repository_identity: String,
    pub dependency_manifest_total_count: usize,
    pub dependency_manifest_detected_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestDisclosurePolicySummary {
    pub disclosure_policy_ref: String,
    pub coverage_mode: String,
    pub redaction_profile: String,
    pub redaction_configuration_version: String,
    pub retention_period: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestEvidenceCategory {
    pub category: String,
    pub included: bool,
    pub inclusion_state: String,
    pub count: usize,
    pub reference: String,
    pub source_derived_class: String,
    pub source_code_disclosure: bool,
    pub redaction_state: String,
    pub redaction_configuration_version: String,
    pub retention_handling: String,
    pub limitation: String,
    pub details: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet_controls: Option<ManifestSnippetControls>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestSnippetControls {
    pub max_snippet_chars: u32,
    pub context_lines: u32,
    pub redaction_profile: String,
    pub redaction_configuration_version: String,
    pub retention_class: String,
    pub selected_files_or_areas: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackagePreviewState {
    pub state: String,
    pub send_ready: bool,
    pub local_only: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestApproval {
    pub approval_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approve,
    Decline,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundlePrepareInput {
    pub scope_path: PathBuf,
    pub scanner_findings_path: Option<PathBuf>,
    pub disclosure_policy_path: PathBuf,
    pub manifest_path: PathBuf,
    pub output_dir: PathBuf,
    pub approving_actor: Option<String>,
    pub approval_decision: ApprovalDecision,
    pub approval_confirmation: Option<String>,
    /// When set (via `--reuse-approval`), this exact validated approval is written and
    /// referenced by the rerun bundle instead of minting a fresh approval identity;
    /// only rerun-specific bundle/submission identifiers are still freshly generated.
    pub reused_approval: Option<CustomerApproval>,
    pub run_nonce: Option<String>,
    pub decided_at: String,
    pub created_at: String,
    pub signing_time: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleStatusInput {
    pub scope_path: PathBuf,
    pub manifest_path: PathBuf,
    pub output_dir: PathBuf,
    pub occurred_at: String,
    pub run_nonce: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleApprovalContext {
    pub approval: CustomerApproval,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundlePrepareOutput {
    pub approval: CustomerApproval,
    pub bundle_manifest: Option<BundleManifest>,
    pub signature_envelope: Option<SignatureEnvelope>,
    pub output_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActorReference {
    pub actor_type: String,
    pub actor_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CustomerApproval {
    pub protocol_version: String,
    pub approval_id: String,
    pub manifest_id: String,
    pub decision: String,
    pub decided_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approving_actor: Option<ActorReference>,
    pub displayed_context: ApprovalDisplayedContext,
    pub warnings_acknowledged: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_submitted_state: Option<NotSubmittedState>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalDisplayedContext {
    pub manifest_id: String,
    pub selected_application: SelectedApplication,
    pub selected_commit: SelectedCommit,
    pub repository_identity: String,
    pub coverage_mode: String,
    pub disclosure_policy_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanner_finding_set_ref: Option<String>,
    pub disclosure_warnings: Vec<String>,
    pub bundle_preview_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotSubmittedState {
    pub state: String,
    pub evidence_bundle_created: bool,
    pub evidence_sent: bool,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BundleManifest {
    pub protocol_version: String,
    pub evidence_bundle_id: String,
    pub manifest_id: String,
    pub customer_approval_ref: String,
    pub customer_approval_decision: String,
    pub bundle_state: String,
    pub review_scope_ref: String,
    pub disclosure_policy_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanner_finding_set_ref: Option<String>,
    pub coverage_mode: String,
    pub bundle_instance_id: String,
    pub submission_attempt_id: String,
    pub created_at: String,
    pub runner: RunnerMetadata,
    pub tool_versions: Vec<ToolVersion>,
    pub artifact_references: Vec<ArtifactReference>,
    pub verification_metadata: BundleVerificationMetadata,
    pub local_cleanup_intent: Vec<CleanupIntent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolVersion {
    pub tool_name: String,
    pub tool_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BundleVerificationMetadata {
    pub identity_canonicalization: String,
    pub identity_hash_algorithm: String,
    pub identity_input_excludes: Vec<String>,
    pub signed_identity_type: String,
    pub approved_manifest_id: String,
    pub signature_envelope_path: String,
    pub bundle_signing_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CleanupIntent {
    pub artifact_ref: String,
    pub source_derived_class: String,
    pub cleanup_state: String,
    pub cleanup_required: bool,
    pub deletion_evidence_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignatureEnvelope {
    pub protocol_version: String,
    pub algorithm_profile: String,
    pub key_id: String,
    pub key_version: String,
    pub signing_time: String,
    pub signed_identity_type: String,
    pub signed_identity: String,
    pub canonicalization: String,
    pub signing_mode: String,
    pub signing_limitations: Vec<String>,
    pub signature_bytes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocalScanConfig {
    #[serde(default)]
    pub regex_rules: Vec<RegexScannerRule>,
    #[serde(default)]
    pub semgrep_json_inputs: Vec<SemgrepJsonInput>,
    #[serde(default)]
    pub semgrep_local_commands: Vec<SemgrepLocalCommandInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegexScannerRule {
    #[serde(default = "regex_scanner_name")]
    pub scanner_name: String,
    pub rule_id: String,
    pub pattern: String,
    pub ruleset_identifier: String,
    pub severity: Option<String>,
    pub confidence: Option<String>,
    pub target_file_group: String,
    #[serde(default)]
    pub target_include_patterns: Vec<String>,
    #[serde(default)]
    pub retain_raw_output_locally: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemgrepJsonInput {
    #[serde(default = "semgrep_scanner_name")]
    pub scanner_name: String,
    pub json_path: PathBuf,
    pub ruleset_identifier: String,
    pub scanner_version: Option<String>,
    pub target_file_group: String,
    #[serde(default)]
    pub target_include_patterns: Vec<String>,
    #[serde(default)]
    pub retain_raw_output_locally: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SemgrepLocalCommandInput {
    #[serde(default = "semgrep_scanner_name")]
    pub scanner_name: String,
    pub command: String,
    pub config_path: String,
    pub ruleset_identifier: String,
    pub target_file_group: String,
    #[serde(default)]
    pub target_include_patterns: Vec<String>,
    #[serde(default)]
    pub retain_raw_output_locally: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScopeError {
    InvalidReviewId(String),
    InvalidCommitSha(String),
    ApplicationPathMissing(PathBuf),
    ApplicationPathUnreadable(PathBuf),
    MetadataWriteFailed { path: PathBuf, reason: String },
    SystemTimeBeforeUnixEpoch,
}

impl fmt::Display for ScopeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidReviewId(value) => write!(
                formatter,
                "review id must match review:[a-z0-9][a-z0-9_-]{{2,63}}, got {value:?}"
            ),
            Self::InvalidCommitSha(value) => write!(
                formatter,
                "selected commit must be a 40-character lowercase git SHA, got {value:?}"
            ),
            Self::ApplicationPathMissing(path) => {
                write!(
                    formatter,
                    "selected application path does not exist: {}",
                    path.display()
                )
            }
            Self::ApplicationPathUnreadable(path) => {
                write!(
                    formatter,
                    "selected application path is not readable: {}",
                    path.display()
                )
            }
            Self::MetadataWriteFailed { path, reason } => write!(
                formatter,
                "could not write review-scope metadata to {}: {reason}",
                path.display()
            ),
            Self::SystemTimeBeforeUnixEpoch => write!(
                formatter,
                "system clock is before the Unix epoch; cannot create UTC RFC 3339 timestamp"
            ),
        }
    }
}

impl std::error::Error for ScopeError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanError {
    Application(ScopeError),
    ConfigReadFailed { path: PathBuf, reason: String },
    ConfigParseFailed { path: PathBuf, reason: String },
    InvalidProtocolField { field: String, reason: String },
    MetadataWriteFailed { path: PathBuf, reason: String },
    ScopeReadFailed { path: PathBuf, reason: String },
    ScopeParseFailed { path: PathBuf, reason: String },
}

impl fmt::Display for ScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Application(error) => write!(formatter, "{error}"),
            Self::ConfigReadFailed { path, reason } => write!(
                formatter,
                "could not read scanner config from {}: {reason}",
                path.display()
            ),
            Self::ConfigParseFailed { path, reason } => write!(
                formatter,
                "could not parse scanner config from {}: {reason}",
                path.display()
            ),
            Self::InvalidProtocolField { field, reason } => {
                write!(
                    formatter,
                    "invalid scanner protocol field {field}: {reason}"
                )
            }
            Self::MetadataWriteFailed { path, reason } => write!(
                formatter,
                "could not write scanner finding set metadata to {}: {reason}",
                path.display()
            ),
            Self::ScopeReadFailed { path, reason } => write!(
                formatter,
                "could not read review scope from {}: {reason}",
                path.display()
            ),
            Self::ScopeParseFailed { path, reason } => write!(
                formatter,
                "could not parse review scope from {}: {reason}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for ScanError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DisclosureError {
    ConfigReadFailed { path: PathBuf, reason: String },
    ConfigParseFailed { path: PathBuf, reason: String },
    InvalidCoverageMode(String),
    InvalidPolicyConfig { field: String, reason: String },
    InvalidProtocolField { field: String, reason: String },
    MetadataWriteFailed { path: PathBuf, reason: String },
    ScopeReadFailed { path: PathBuf, reason: String },
    ScopeParseFailed { path: PathBuf, reason: String },
    ScannerFindingSetReadFailed { path: PathBuf, reason: String },
    ScannerFindingSetParseFailed { path: PathBuf, reason: String },
    ScannerFindingSetRequired,
}

impl fmt::Display for DisclosureError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ConfigReadFailed { path, reason } => write!(
                formatter,
                "could not read disclosure policy config from {}: {reason}",
                path.display()
            ),
            Self::ConfigParseFailed { path, reason } => write!(
                formatter,
                "could not parse disclosure policy config from {}: {reason}",
                path.display()
            ),
            Self::InvalidCoverageMode(value) => write!(
                formatter,
                "invalid coverage_mode {value:?}; expected metadata_only, finding_context_snippets, or extended_approved_snippets_or_targeted_files"
            ),
            Self::InvalidPolicyConfig { field, reason } => {
                write!(
                    formatter,
                    "invalid disclosure policy config {field}: {reason}"
                )
            }
            Self::InvalidProtocolField { field, reason } => {
                write!(
                    formatter,
                    "invalid disclosure policy field {field}: {reason}"
                )
            }
            Self::MetadataWriteFailed { path, reason } => write!(
                formatter,
                "could not write disclosure policy metadata to {}: {reason}",
                path.display()
            ),
            Self::ScopeReadFailed { path, reason } => write!(
                formatter,
                "could not read review scope from {}: {reason}",
                path.display()
            ),
            Self::ScopeParseFailed { path, reason } => write!(
                formatter,
                "could not parse review scope from {}: {reason}",
                path.display()
            ),
            Self::ScannerFindingSetReadFailed { path, reason } => write!(
                formatter,
                "could not read scanner finding set from {}: {reason}",
                path.display()
            ),
            Self::ScannerFindingSetParseFailed { path, reason } => write!(
                formatter,
                "could not parse scanner finding set from {}: {reason}",
                path.display()
            ),
            Self::ScannerFindingSetRequired => write!(
                formatter,
                "--scanner-findings is required when include_scanner_findings is true"
            ),
        }
    }
}

impl std::error::Error for DisclosureError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestPreviewError {
    ArtifactReadFailed {
        artifact: &'static str,
        path: PathBuf,
        reason: String,
    },
    ArtifactParseFailed {
        artifact: &'static str,
        path: PathBuf,
        reason: String,
    },
    InvalidProtocolField {
        field: String,
        reason: String,
    },
    ScannerFindingSetRequired,
    MetadataWriteFailed {
        path: PathBuf,
        reason: String,
    },
}

impl fmt::Display for ManifestPreviewError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ArtifactReadFailed {
                artifact,
                path,
                reason,
            } => write!(
                formatter,
                "could not read {artifact} from {}: {reason}",
                path.display()
            ),
            Self::ArtifactParseFailed {
                artifact,
                path,
                reason,
            } => write!(
                formatter,
                "could not parse {artifact} from {}: {reason}",
                path.display()
            ),
            Self::InvalidProtocolField { field, reason } => {
                write!(
                    formatter,
                    "invalid outbound manifest input field {field}: {reason}"
                )
            }
            Self::ScannerFindingSetRequired => write!(
                formatter,
                "--scanner-findings is required when the Disclosure Policy includes scanner findings"
            ),
            Self::MetadataWriteFailed { path, reason } => write!(
                formatter,
                "could not write outbound manifest preview to {}: {reason}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for ManifestPreviewError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundlePrepareError {
    ArtifactReadFailed {
        artifact: &'static str,
        path: PathBuf,
        reason: String,
    },
    ArtifactParseFailed {
        artifact: &'static str,
        path: PathBuf,
        reason: String,
    },
    InvalidProtocolField {
        field: String,
        reason: String,
    },
    MetadataWriteFailed {
        path: PathBuf,
        reason: String,
    },
}

impl fmt::Display for BundlePrepareError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ArtifactReadFailed {
                artifact,
                path,
                reason,
            } => write!(
                formatter,
                "could not read {artifact} from {}: {reason}",
                path.display()
            ),
            Self::ArtifactParseFailed {
                artifact,
                path,
                reason,
            } => write!(
                formatter,
                "could not parse {artifact} from {}: {reason}",
                path.display()
            ),
            Self::InvalidProtocolField { field, reason } => {
                write!(
                    formatter,
                    "invalid signed bundle input field {field}: {reason}"
                )
            }
            Self::MetadataWriteFailed { path, reason } => write!(
                formatter,
                "could not write signed bundle artifact to {}: {reason}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for BundlePrepareError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundlePrepareAttemptError {
    pub error: BundlePrepareError,
    pub attempt: Option<Box<LocalRunnerAttempt>>,
}

impl BundlePrepareAttemptError {
    fn without_attempt(error: BundlePrepareError) -> Self {
        Self {
            error,
            attempt: None,
        }
    }

    fn with_attempt(error: BundlePrepareError, attempt: LocalRunnerAttempt) -> Self {
        Self {
            error,
            attempt: Some(Box::new(attempt)),
        }
    }
}

pub fn validate_review_id(review_id: &str) -> Result<(), ScopeError> {
    let slug = review_id.strip_prefix("review:").unwrap_or_default();
    let mut bytes = slug.as_bytes().iter();
    let first_is_valid = bytes
        .next()
        .is_some_and(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'z'));
    let is_valid = (3..=64).contains(&slug.len())
        && first_is_valid
        && bytes.all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'z' | b'_' | b'-'));

    if is_valid {
        Ok(())
    } else {
        Err(ScopeError::InvalidReviewId(review_id.to_string()))
    }
}

pub fn validate_commit_sha(commit_sha: &str) -> Result<(), ScopeError> {
    let is_valid = commit_sha.len() == 40
        && commit_sha
            .as_bytes()
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));

    if is_valid {
        Ok(())
    } else {
        Err(ScopeError::InvalidCommitSha(commit_sha.to_string()))
    }
}

pub fn validate_application_path(path: &Path) -> Result<(), ScopeError> {
    // Accept both directories and regular files. Directories are the common
    // case (the "selected application" is a project tree); a single-file path
    // is also supported for narrow single-script audits, with the documented
    // limitation that manifest and language signals are scoped to that file
    // (e.g. no package.json resolution). See story 1.4 review decision DN-2 (B).
    let meta = path
        .symlink_metadata()
        .map_err(|_| ScopeError::ApplicationPathMissing(path.to_path_buf()))?;
    if meta.file_type().is_symlink() {
        // Reject symlinks at the root: the caller's intention about what
        // scope they are auditing becomes ambiguous, and symlink_metadata
        // alone can't tell us if the target exists without following.
        return Err(ScopeError::ApplicationPathUnreadable(path.to_path_buf()));
    }
    if !meta.is_dir() && !meta.is_file() {
        return Err(ScopeError::ApplicationPathUnreadable(path.to_path_buf()));
    }
    if meta.is_dir() {
        // Ensure readable by listing; swallow errors for files (we try to open
        // them later and will surface issues as malformed manifests).
        let _ = path
            .read_dir()
            .map_err(|_| ScopeError::ApplicationPathUnreadable(path.to_path_buf()))?;
    } else {
        // Quick readable check: open the file (drop the handle immediately).
        let _ = std::fs::File::open(path)
            .map_err(|_| ScopeError::ApplicationPathUnreadable(path.to_path_buf()))?;
    }
    Ok(())
}

pub fn initialize_review_scope(input: ScopeInitInput) -> Result<ReviewScope, ScopeError> {
    validate_application_path(&input.application_path)?;
    validate_review_id(&input.review_id)?;
    validate_commit_sha(&input.selected_commit)?;

    let display_name = display_name_for_path(&input.application_path);
    let application_id = slugify_identifier(&display_name);
    let repository_identity = repository_identity_hash(&application_id, &input.selected_commit);
    let review_scope_id = review_scope_identity_hash(
        &input.generated_at,
        &application_id,
        &input.selected_commit,
        &repository_identity,
        &input.review_id,
    );

    let technical_context = detect_technical_context(&input.application_path);
    let dependency_manifests = capture_dependency_manifests(&input.application_path);

    Ok(ReviewScope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        review_scope_id,
        review_id: input.review_id,
        generated_at: input.generated_at,
        selected_application: SelectedApplication {
            application_id,
            display_name,
        },
        selected_commit: SelectedCommit {
            commit_sha: input.selected_commit,
            source_control_system: "git".to_string(),
        },
        repository_identity,
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        technical_context,
        dependency_manifests,
    })
}

pub fn initialize_and_write_review_scope(input: ScopeInitInput) -> Result<ReviewScope, ScopeError> {
    let output_path = input.output_path.clone();
    let scope = initialize_review_scope(input)?;
    write_review_scope_metadata(&scope, &output_path)?;
    Ok(scope)
}

pub fn write_review_scope_metadata(
    scope: &ReviewScope,
    output_path: &Path,
) -> Result<(), ScopeError> {
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| ScopeError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }

    fs::write(output_path, review_scope_json(scope)).map_err(|error| {
        ScopeError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })
}

pub fn default_review_scope_output_path() -> PathBuf {
    PathBuf::from(".codeattest/review-scope.json")
}

pub fn utc_rfc3339_now() -> Result<String, ScopeError> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ScopeError::SystemTimeBeforeUnixEpoch)?
        .as_secs();
    Ok(utc_rfc3339_from_unix_seconds(seconds))
}

pub fn format_scope_summary(scope: &ReviewScope, output_path: &Path) -> String {
    let mut summary = String::new();
    summary.push_str("Review scope initialized\n");
    summary.push_str(&format!(
        "Selected application: {} ({})\n",
        scope.selected_application.display_name, scope.selected_application.application_id
    ));
    summary.push_str(&format!(
        "Selected commit: {}\n",
        scope.selected_commit.commit_sha
    ));
    summary.push_str(&format!(
        "Repository identity hash: {}\n",
        scope.repository_identity
    ));
    summary.push_str(&format!("Runner version: {}\n", scope.runner.version));

    summary.push_str("Technical context:\n");
    for context in &scope.technical_context {
        let value = context.value.as_deref().unwrap_or("unspecified");
        summary.push_str(&format!(
            "  - {} {}: {}\n",
            context.context_type, value, context.status
        ));
    }

    summary.push_str("Dependency manifests:\n");
    for manifest in &scope.dependency_manifests {
        let path = manifest.path.as_deref().unwrap_or("not_found");
        summary.push_str(&format!(
            "  - {}: {} path={} dependencies={}\n",
            manifest.manifest_type, manifest.status, path, manifest.dependency_count
        ));
    }

    let limitations = summary_limitations(scope);
    if !limitations.is_empty() {
        summary.push_str("Limitations:\n");
        for limitation in limitations {
            summary.push_str(&format!("  - {}\n", terminal_safe_text(&limitation)));
        }
    }

    summary.push_str(&format!(
        "Output path: {}\n",
        terminal_safe_text(&output_path.display().to_string())
    ));
    summary.push_str("Local-only boundary: review-scope metadata was written locally; source contents stay local.\n");
    summary
}

pub fn default_scanner_findings_output_path() -> PathBuf {
    PathBuf::from(".codeattest/scanner-findings.json")
}

pub fn load_scan_config(path: &Path) -> Result<LocalScanConfig, ScanError> {
    let content = fs::read_to_string(path).map_err(|error| ScanError::ConfigReadFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let mut config: LocalScanConfig =
        serde_json::from_str(&content).map_err(|error| ScanError::ConfigParseFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;

    if let Some(base) = path.parent() {
        config.resolve_relative_paths(base);
    }

    Ok(config)
}

impl LocalScanConfig {
    pub fn resolve_relative_paths(&mut self, base: &Path) {
        for input in &mut self.semgrep_json_inputs {
            if input.json_path.is_relative() {
                input.json_path = base.join(&input.json_path);
            }
        }
        for command in &mut self.semgrep_local_commands {
            let config_path = Path::new(&command.config_path);
            if config_path.is_relative() {
                command.config_path = base.join(config_path).to_string_lossy().into_owned();
            }
        }
    }
}

pub fn review_scope_ref_from_file(path: &Path) -> Result<String, ScanError> {
    let content = fs::read_to_string(path).map_err(|error| ScanError::ScopeReadFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| ScanError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    value
        .get("review_scope_id")
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| ScanError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: "missing review_scope_id".to_string(),
        })
}

pub fn review_scope_ref_for_application(
    scope_path: &Path,
    application_path: &Path,
) -> Result<String, ScanError> {
    let content = fs::read_to_string(scope_path).map_err(|error| ScanError::ScopeReadFailed {
        path: scope_path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: error.to_string(),
        })?;

    let protocol_version = value
        .get("protocol_version")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: "missing protocol_version".to_string(),
        })?;
    if protocol_version != PROTOCOL_VERSION {
        return Err(ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: format!("unsupported protocol_version {protocol_version}"),
        });
    }

    let review_scope_id = value
        .get("review_scope_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: "missing review_scope_id".to_string(),
        })?;
    validate_sha256_id("review_scope_id", review_scope_id)?;

    let selected_application = value
        .get("selected_application")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: "missing selected_application".to_string(),
        })?;
    let scope_application_id = selected_application
        .get("application_id")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: "missing selected_application.application_id".to_string(),
        })?;
    let expected_application_id = slugify_identifier(&display_name_for_path(application_path));
    if scope_application_id != expected_application_id {
        return Err(ScanError::ScopeParseFailed {
            path: scope_path.to_path_buf(),
            reason: format!(
                "review scope application_id {scope_application_id} does not match scan target {expected_application_id}"
            ),
        });
    }

    Ok(review_scope_id.to_string())
}

pub fn initialize_local_scan(input: ScanRunInput) -> Result<ScannerFindingSet, ScanError> {
    validate_application_path(&input.application_path).map_err(ScanError::Application)?;
    validate_sha256_id("review_scope_ref", &input.review_scope_ref)?;
    validate_utc_rfc3339_timestamp("generated_at", &input.generated_at)?;

    let inventory = list_scanner_files_sorted(&input.application_path);
    let files = inventory.files;
    let mut scanner_runs = Vec::new();
    let mut candidate_findings = Vec::new();
    let mut coverage_limitations = inventory.coverage_limitations;
    let mut artifact_references = Vec::new();

    for rule in &input.regex_rules {
        run_regex_rule(
            &input,
            rule,
            &files,
            &mut scanner_runs,
            &mut candidate_findings,
            &mut coverage_limitations,
            &mut artifact_references,
        );
    }

    for semgrep_input in &input.semgrep_json_inputs {
        run_semgrep_json_input(
            &input,
            semgrep_input,
            &files,
            &mut scanner_runs,
            &mut candidate_findings,
            &mut coverage_limitations,
            &mut artifact_references,
        );
    }

    for command in &input.semgrep_local_commands {
        run_semgrep_local_command(
            &input,
            command,
            &files,
            &mut scanner_runs,
            &mut candidate_findings,
            &mut coverage_limitations,
            &mut artifact_references,
        );
    }

    record_supported_file_group_coverage(
        &input.application_path,
        &files,
        &scanner_runs,
        &mut coverage_limitations,
    );

    if scanner_runs.is_empty() {
        scanner_runs.push(ScannerRun {
            scanner_name: "regex".to_string(),
            scanner_version: runner_version().to_string(),
            ruleset_identifier: "local:no-scanner-inputs".to_string(),
            executed_at: input.generated_at.clone(),
            status: "skipped".to_string(),
            covered_file_group: "unsupported".to_string(),
            scanned_files: Vec::new(),
            failure_reason: Some("no scanner inputs were configured".to_string()),
            rerun_possible: true,
            source_derived_class: "retained_review_artifact".to_string(),
        });
        coverage_limitations
            .push("No scanner inputs were configured; no coverage is claimed.".to_string());
    }

    if candidate_findings.is_empty()
        && !coverage_limitations
            .iter()
            .any(|limitation| limitation.starts_with("No findings produced"))
    {
        coverage_limitations.push(
            "No findings produced by configured inputs; this is not a security guarantee."
                .to_string(),
        );
    }

    let mut finding_set = ScannerFindingSet {
        protocol_version: PROTOCOL_VERSION.to_string(),
        scanner_finding_set_id: "sha256:pending".to_string(),
        generated_at: input.generated_at,
        review_scope_ref: input.review_scope_ref,
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        source_derived_class: "retained_review_artifact".to_string(),
        scanner_runs,
        candidate_findings,
        coverage_limitations,
        artifact_references,
    };
    finding_set.scanner_finding_set_id = scanner_finding_set_identity(&finding_set);
    Ok(finding_set)
}

pub fn initialize_and_write_local_scan(
    input: ScanRunInput,
) -> Result<ScannerFindingSet, ScanError> {
    let output_path = input.output_path.clone();
    let finding_set = initialize_local_scan(input)?;
    write_scanner_finding_set_metadata(&finding_set, &output_path)?;
    Ok(finding_set)
}

pub fn write_scanner_finding_set_metadata(
    finding_set: &ScannerFindingSet,
    output_path: &Path,
) -> Result<(), ScanError> {
    validate_scanner_finding_set_metadata(finding_set)?;

    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| ScanError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }

    let json = serde_json::to_string_pretty(finding_set).map_err(|error| {
        ScanError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    fs::write(output_path, format!("{json}\n")).map_err(|error| ScanError::MetadataWriteFailed {
        path: output_path.to_path_buf(),
        reason: error.to_string(),
    })
}

fn validate_scanner_finding_set_metadata(finding_set: &ScannerFindingSet) -> Result<(), ScanError> {
    if finding_set.protocol_version != PROTOCOL_VERSION {
        return Err(ScanError::InvalidProtocolField {
            field: "protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_sha256_id(
        "scanner_finding_set_id",
        &finding_set.scanner_finding_set_id,
    )?;
    validate_sha256_id("review_scope_ref", &finding_set.review_scope_ref)?;
    validate_utc_rfc3339_timestamp("generated_at", &finding_set.generated_at)?;

    for run in &finding_set.scanner_runs {
        if run.ruleset_identifier.trim().is_empty() || run.scanner_version.trim().is_empty() {
            return Err(ScanError::InvalidProtocolField {
                field: "scanner_runs".to_string(),
                reason: "scanner_version and ruleset_identifier must be non-empty".to_string(),
            });
        }
        match run.status.as_str() {
            "succeeded" | "no_findings" if run.failure_reason.is_some() => {
                return Err(ScanError::InvalidProtocolField {
                    field: "scanner_runs.failure_reason".to_string(),
                    reason: "successful/no_findings runs must not include failure_reason"
                        .to_string(),
                });
            }
            "failed" | "unavailable" | "invalid_output" | "skipped"
                if run.failure_reason.is_none() =>
            {
                return Err(ScanError::InvalidProtocolField {
                    field: "scanner_runs.failure_reason".to_string(),
                    reason: "non-successful runs must include failure_reason".to_string(),
                });
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn format_scan_summary(finding_set: &ScannerFindingSet, output_path: &Path) -> String {
    let mut summary = String::new();
    summary.push_str("Local scan completed\n");
    summary.push_str(&format!(
        "Scanner finding set id: {}\n",
        finding_set.scanner_finding_set_id
    ));
    summary.push_str(&format!(
        "Review scope ref: {}\n",
        finding_set.review_scope_ref
    ));
    summary.push_str(&format!("Runner version: {}\n", finding_set.runner.version));
    summary.push_str("Scanner runs:\n");
    for run in &finding_set.scanner_runs {
        summary.push_str(&format!(
            "  - Scanner {}: {} version={} ruleset={} covered={} rerun_possible={}\n",
            run.scanner_name,
            run.status,
            run.scanner_version,
            run.ruleset_identifier,
            run.covered_file_group,
            run.rerun_possible
        ));
        if let Some(reason) = &run.failure_reason {
            summary.push_str(&format!("    Failure reason: {reason}\n"));
        }
    }

    summary.push_str(&format!(
        "Candidate findings: {}\n",
        finding_set.candidate_findings.len()
    ));
    if finding_set.candidate_findings.is_empty() {
        summary.push_str(
            "No findings produced by configured inputs; this is not a security guarantee.\n",
        );
    }

    if !finding_set.coverage_limitations.is_empty() {
        summary.push_str("Coverage limitations:\n");
        for limitation in &finding_set.coverage_limitations {
            summary.push_str(&format!("  - {limitation}\n"));
        }
    }

    summary.push_str(&format!("Output path: {}\n", output_path.display()));
    summary.push_str("Local-only boundary: scanner metadata and Candidate Findings were written locally; source contents stay local.\n");
    summary
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CoverageMode {
    MetadataOnly,
    FindingContextSnippets,
    ExtendedApprovedSnippetsOrTargetedFiles,
}

impl CoverageMode {
    fn from_optional(value: Option<&str>) -> Result<(Self, bool), DisclosureError> {
        match value {
            Some(value) => Self::from_config_value(value).map(|mode| (mode, false)),
            None => Ok((Self::FindingContextSnippets, true)),
        }
    }

    fn from_config_value(value: &str) -> Result<Self, DisclosureError> {
        let normalized = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
        match normalized.as_str() {
            "metadata" | "metadata_only" => Ok(Self::MetadataOnly),
            "finding_context" | "finding_context_snippets" => Ok(Self::FindingContextSnippets),
            "extended" | "extended_approved" | "extended_approved_snippets_or_targeted_files" => {
                Ok(Self::ExtendedApprovedSnippetsOrTargetedFiles)
            }
            _ => Err(DisclosureError::InvalidCoverageMode(value.to_string())),
        }
    }

    fn canonical_value(self) -> &'static str {
        match self {
            Self::MetadataOnly => "metadata_only",
            Self::FindingContextSnippets => "finding_context_snippets",
            Self::ExtendedApprovedSnippetsOrTargetedFiles => {
                "extended_approved_snippets_or_targeted_files"
            }
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::MetadataOnly => "Metadata-only",
            Self::FindingContextSnippets => "Finding-context snippets",
            Self::ExtendedApprovedSnippetsOrTargetedFiles => {
                "Extended approved snippets or targeted files"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DisclosureModeSettings {
    allow_raw_snippets: bool,
    include_targeted_files: bool,
    max_snippet_chars: u32,
    context_lines: u32,
    selection_behavior: String,
    selected_files_or_areas: Vec<String>,
}

pub fn default_disclosure_policy_output_path() -> PathBuf {
    PathBuf::from(".codeattest/disclosure-policy.json")
}

pub fn load_disclosure_policy_config(
    path: &Path,
) -> Result<DisclosurePolicyConfig, DisclosureError> {
    let content = fs::read_to_string(path).map_err(|error| DisclosureError::ConfigReadFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    serde_json::from_str(&content).map_err(|error| DisclosureError::ConfigParseFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })
}

pub fn disclosure_config_includes_scanner_findings(
    config: &DisclosurePolicyConfig,
) -> Result<bool, DisclosureError> {
    let (mode, _) = CoverageMode::from_optional(config.coverage_mode.as_deref())?;
    Ok(config
        .include_scanner_findings
        .unwrap_or(!matches!(mode, CoverageMode::MetadataOnly)))
}

pub fn disclosure_review_scope_ref_from_file(path: &Path) -> Result<String, DisclosureError> {
    let content = fs::read_to_string(path).map_err(|error| DisclosureError::ScopeReadFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let value: serde_json::Value =
        serde_json::from_str(&content).map_err(|error| DisclosureError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;

    let protocol_version = required_json_string(&value, "protocol_version").ok_or_else(|| {
        DisclosureError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: "missing protocol_version".to_string(),
        }
    })?;
    if protocol_version != PROTOCOL_VERSION {
        return Err(DisclosureError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: format!("unsupported protocol_version {protocol_version}"),
        });
    }

    let review_scope_id = required_json_string(&value, "review_scope_id").ok_or_else(|| {
        DisclosureError::ScopeParseFailed {
            path: path.to_path_buf(),
            reason: "missing review_scope_id".to_string(),
        }
    })?;
    validate_disclosure_sha256_id("review_scope_id", review_scope_id)?;
    Ok(review_scope_id.to_string())
}

pub fn scanner_finding_set_ref_for_review_scope(
    path: &Path,
    expected_review_scope_ref: &str,
) -> Result<String, DisclosureError> {
    let content =
        fs::read_to_string(path).map_err(|error| DisclosureError::ScannerFindingSetReadFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|error| {
        DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;

    let protocol_version = required_json_string(&value, "protocol_version").ok_or_else(|| {
        DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: "missing protocol_version".to_string(),
        }
    })?;
    if protocol_version != PROTOCOL_VERSION {
        return Err(DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: format!("unsupported protocol_version {protocol_version}"),
        });
    }

    let scanner_finding_set_id = required_json_string(&value, "scanner_finding_set_id")
        .ok_or_else(|| DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: "missing scanner_finding_set_id".to_string(),
        })?;
    validate_disclosure_sha256_id("scanner_finding_set_id", scanner_finding_set_id)?;

    let review_scope_ref = required_json_string(&value, "review_scope_ref").ok_or_else(|| {
        DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: "missing review_scope_ref".to_string(),
        }
    })?;
    validate_disclosure_sha256_id("review_scope_ref", review_scope_ref)?;
    if review_scope_ref != expected_review_scope_ref {
        return Err(DisclosureError::ScannerFindingSetParseFailed {
            path: path.to_path_buf(),
            reason: format!(
                "review_scope_ref {review_scope_ref} does not match review scope {expected_review_scope_ref}"
            ),
        });
    }

    for finding in value
        .get("candidate_findings")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        if finding.get("status").and_then(serde_json::Value::as_str) != Some("candidate") {
            return Err(DisclosureError::ScannerFindingSetParseFailed {
                path: path.to_path_buf(),
                reason: "scanner findings must remain Candidate Findings only".to_string(),
            });
        }
    }

    Ok(scanner_finding_set_id.to_string())
}

pub fn initialize_disclosure_policy(
    input: DisclosureConfigureInput,
) -> Result<DisclosurePolicyBuildResult, DisclosureError> {
    validate_disclosure_sha256_id("review_scope_ref", &input.review_scope_ref)?;
    validate_disclosure_timestamp("created_at", &input.created_at)?;
    if let Some(scanner_ref) = &input.scanner_finding_set_ref {
        validate_disclosure_sha256_id("scanner_finding_set_ref", scanner_ref)?;
    }

    let (coverage_mode, coverage_mode_defaulted) =
        CoverageMode::from_optional(input.config.coverage_mode.as_deref())?;
    let include_metadata = input.config.include_metadata.unwrap_or(true);
    let include_dependency_information =
        input.config.include_dependency_information.unwrap_or(true);
    let include_scanner_findings = disclosure_config_includes_scanner_findings(&input.config)?;
    if include_scanner_findings && input.scanner_finding_set_ref.is_none() {
        return Err(DisclosureError::ScannerFindingSetRequired);
    }

    let mode_settings = disclosure_mode_settings(coverage_mode, &input.config)?;
    let redaction_policy = disclosure_redaction_policy(input.config.redaction.as_ref())?;
    let retention_policy = disclosure_retention_policy(input.config.retention.as_ref())?;
    validate_retention_for_mode(&mode_settings, &retention_policy)?;

    let warnings = disclosure_warnings(coverage_mode);
    let limitations = disclosure_limitations(include_scanner_findings, &redaction_policy);
    let evidence_categories = disclosure_evidence_categories(
        include_metadata,
        include_dependency_information,
        include_scanner_findings,
        &mode_settings,
        &retention_policy,
    );
    let mut policy = DisclosurePolicy {
        protocol_version: PROTOCOL_VERSION.to_string(),
        disclosure_policy_id: "sha256:pending".to_string(),
        created_at: input.created_at,
        review_scope_ref: input.review_scope_ref,
        scanner_finding_set_ref: if include_scanner_findings {
            input.scanner_finding_set_ref
        } else {
            None
        },
        coverage_mode: coverage_mode.canonical_value().to_string(),
        include_metadata,
        include_dependency_information,
        include_scanner_findings,
        evidence_categories,
        snippet_policy: DisclosureSnippetPolicy {
            allow_raw_snippets: mode_settings.allow_raw_snippets,
            max_snippet_chars: mode_settings.max_snippet_chars,
            context_lines: mode_settings.context_lines,
            redaction_profile: redaction_policy.profile.clone(),
            raw_snippet_default_class: "transient_source_derived".to_string(),
            selection_behavior: mode_settings.selection_behavior,
            selected_files_or_areas: mode_settings.selected_files_or_areas,
        },
        redaction_policy,
        retention_policy,
        warnings,
        limitations,
        synthetic_fixture_markers: None,
    };
    policy.disclosure_policy_id = disclosure_policy_identity(&policy);
    validate_disclosure_policy_metadata(&policy)?;

    Ok(DisclosurePolicyBuildResult {
        policy,
        coverage_mode_defaulted,
    })
}

pub fn initialize_and_write_disclosure_policy(
    input: DisclosureConfigureInput,
) -> Result<DisclosurePolicyBuildResult, DisclosureError> {
    let output_path = input.output_path.clone();
    let result = initialize_disclosure_policy(input)?;
    write_disclosure_policy_metadata(&result.policy, &output_path)?;
    Ok(result)
}

pub fn write_disclosure_policy_metadata(
    policy: &DisclosurePolicy,
    output_path: &Path,
) -> Result<(), DisclosureError> {
    validate_disclosure_policy_metadata(policy)?;
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| DisclosureError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }

    let json = serde_json::to_string_pretty(policy).map_err(|error| {
        DisclosureError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    fs::write(output_path, format!("{json}\n")).map_err(|error| {
        DisclosureError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })
}

pub fn format_disclosure_policy_summary(
    result: &DisclosurePolicyBuildResult,
    output_path: &Path,
) -> String {
    let policy = &result.policy;
    let mode_label = coverage_mode_label(&policy.coverage_mode);
    let mut summary = String::new();
    summary.push_str("Disclosure policy configured\n");
    summary.push_str(&format!(
        "Disclosure policy id: {}\n",
        policy.disclosure_policy_id
    ));
    summary.push_str(&format!("Review scope ref: {}\n", policy.review_scope_ref));
    match &policy.scanner_finding_set_ref {
        Some(scanner_ref) => summary.push_str(&format!(
            "Scanner finding set ref: {}\n",
            terminal_safe_text(scanner_ref)
        )),
        None => summary.push_str("Scanner finding set ref: not included\n"),
    }
    summary.push_str(&format!(
        "Coverage mode: {mode_label} ({})\n",
        policy.coverage_mode
    ));
    if result.coverage_mode_defaulted {
        summary.push_str(
            "Coverage mode default: Finding-context snippets balanced default was applied.\n",
        );
    }

    summary.push_str("Evidence categories:\n");
    for category in &policy.evidence_categories {
        let state = if category.included {
            "included"
        } else {
            "excluded"
        };
        summary.push_str(&format!(
            "  - {}: {} class={} handling={}\n",
            category.category, state, category.source_derived_class, category.retention_handling
        ));
    }

    summary.push_str(&format!(
        "Snippet policy: allow_raw_snippets={} max_snippet_chars={} context_lines={} selection={}\n",
        policy.snippet_policy.allow_raw_snippets,
        policy.snippet_policy.max_snippet_chars,
        policy.snippet_policy.context_lines,
        policy.snippet_policy.selection_behavior
    ));
    if !policy.snippet_policy.selected_files_or_areas.is_empty() {
        summary.push_str("Selected files or areas:\n");
        for selected in &policy.snippet_policy.selected_files_or_areas {
            summary.push_str(&format!("  - {selected}\n"));
        }
    }

    let redaction_state = if policy.redaction_policy.enabled {
        "enabled"
    } else {
        "not_configured"
    };
    summary.push_str(&format!(
        "Redaction: {} profile={} version={}\n",
        redaction_state,
        policy.redaction_policy.profile,
        policy.redaction_policy.configuration_version
    ));
    summary.push_str("Retention/source-derived classes:\n");
    summary.push_str(&format!(
        "  - raw_snippets: {} retention_period={}\n",
        policy.retention_policy.raw_snippet_class, policy.retention_policy.retention_period
    ));
    summary.push_str(&format!(
        "  - targeted_files: {} retention_period={}\n",
        policy.retention_policy.targeted_file_class, policy.retention_policy.retention_period
    ));

    summary.push_str("Warnings:\n");
    for warning in &policy.warnings {
        summary.push_str(&format!("  - {}\n", terminal_safe_text(warning)));
    }
    summary.push_str("Limitations:\n");
    for limitation in &policy.limitations {
        summary.push_str(&format!("  - {limitation}\n"));
    }
    summary.push_str(&format!("Output path: {}\n", output_path.display()));
    summary.push_str("Local-only boundary: disclosure policy metadata was written locally; no Raw Snippet or targeted file contents were read, printed, packaged, or transmitted.\n");
    summary
}

pub fn default_outbound_manifest_output_path() -> PathBuf {
    PathBuf::from(".codeattest/outbound-manifest.json")
}

pub fn initialize_manifest_preview(
    input: ManifestPreviewInput,
) -> Result<OutboundManifest, ManifestPreviewError> {
    validate_manifest_timestamp("generated_at", &input.generated_at)?;

    let scope_artifact: ParsedArtifact<ReviewScope> =
        read_json_artifact_with_bytes("review scope", &input.scope_path)?;
    let scope = scope_artifact.value;
    validate_review_scope_for_manifest(&scope)?;
    validate_review_scope_matches_identity(&scope)?;

    let policy_artifact: ParsedArtifact<DisclosurePolicy> =
        read_json_artifact_with_bytes("disclosure policy", &input.disclosure_policy_path)?;
    let policy = policy_artifact.value;
    validate_disclosure_policy_for_manifest(&policy, &scope.review_scope_id)?;
    validate_disclosure_policy_matches_identity(&policy)?;

    let (scanner, scanner_bytes) = if policy.include_scanner_findings {
        let Some(scanner_path) = &input.scanner_findings_path else {
            return Err(ManifestPreviewError::ScannerFindingSetRequired);
        };
        let scanner_artifact: ParsedArtifact<ScannerFindingSet> =
            read_json_artifact_with_bytes("scanner finding set", scanner_path)?;
        let scanner = scanner_artifact.value;
        validate_scanner_finding_set_for_manifest(&scanner, &scope.review_scope_id, &policy)?;
        validate_scanner_finding_set_matches_identity(&scanner)?;
        (Some(scanner), Some(scanner_artifact.bytes))
    } else if input.scanner_findings_path.is_some() {
        // Story 1.7 review-fix (Decision 3): hard-reject rather than silently
        // discarding the caller-supplied scanner findings. Preview surfaces
        // must tell the user what would leave; silent discard is a trust bug.
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "--scanner-findings".to_string(),
            reason:
                "supplied but disclosure policy excludes scanner findings (coverage_mode=metadata_only or include_scanner_findings=false); remove the argument or change the policy"
                    .to_string(),
        });
    } else {
        (None, None)
    };

    let scanner_finding_set_ref = if policy.include_scanner_findings {
        policy.scanner_finding_set_ref.clone()
    } else {
        None
    };
    let artifact_references = manifest_artifact_references(
        &input,
        &policy,
        &scope_artifact.bytes,
        scanner_bytes.as_deref(),
        &policy_artifact.bytes,
    )?;
    validate_environment_gate_for_manifest(&environment_evidence_gate(), &artifact_references)
        .map_err(|reason| ManifestPreviewError::InvalidProtocolField {
            field: "environment_evidence_gate".to_string(),
            reason,
        })?;
    // [C2-05] scanner_finding_set.artifact_references (e.g. retained raw Semgrep
    // output tagged customer_opt_in_retained_source) is nested inside the scanner
    // finding set and is never promoted into `artifact_references` above, so the
    // check above never inspected it. Apply the same environment-gate boundary here.
    if let Some(scanner) = &scanner {
        validate_environment_gate_for_manifest(
            &environment_evidence_gate(),
            &scanner.artifact_references,
        )
        .map_err(|reason| ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.artifact_references".to_string(),
            reason,
        })?;
    }
    let warnings = manifest_warnings(&policy);
    let limitations = manifest_limitations(&policy);
    let evidence_categories = manifest_evidence_categories(&scope, scanner.as_ref(), &policy)?;

    let mut manifest = OutboundManifest {
        protocol_version: PROTOCOL_VERSION.to_string(),
        manifest_id: "sha256:pending".to_string(),
        generated_at: input.generated_at,
        review_scope_ref: scope.review_scope_id.clone(),
        disclosure_policy_ref: policy.disclosure_policy_id.clone(),
        scanner_finding_set_ref,
        selected_scope_summary: SelectedScopeSummary {
            selected_application: scope.selected_application,
            selected_commit: scope.selected_commit,
            repository_identity: scope.repository_identity,
            dependency_manifest_total_count: scope.dependency_manifests.len(),
            dependency_manifest_detected_count: scope
                .dependency_manifests
                .iter()
                .filter(|manifest| manifest.status == "detected")
                .count(),
        },
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        coverage_mode: policy.coverage_mode.clone(),
        disclosure_policy_summary: ManifestDisclosurePolicySummary {
            disclosure_policy_ref: policy.disclosure_policy_id.clone(),
            coverage_mode: policy.coverage_mode.clone(),
            redaction_profile: policy.redaction_policy.profile.clone(),
            redaction_configuration_version: policy.redaction_policy.configuration_version.clone(),
            retention_period: policy.retention_policy.retention_period.clone(),
        },
        evidence_categories,
        artifact_references,
        package_preview_state: PackagePreviewState {
            state: "preview_generated".to_string(),
            send_ready: false,
            local_only: true,
        },
        approval: ManifestApproval {
            approval_state: "not_requested".to_string(),
        },
        warnings,
        limitations,
    };
    validate_outbound_manifest_body(&manifest)?;
    manifest.manifest_id = outbound_manifest_identity(&manifest);
    validate_outbound_manifest_identity(&manifest)?;
    Ok(manifest)
}

pub fn initialize_and_write_manifest_preview(
    input: ManifestPreviewInput,
) -> Result<OutboundManifest, ManifestPreviewError> {
    let output_path = input.output_path.clone();
    let manifest = initialize_manifest_preview(input)?;
    write_outbound_manifest_preview(&manifest, &output_path)?;
    Ok(manifest)
}

pub fn write_outbound_manifest_preview(
    manifest: &OutboundManifest,
    output_path: &Path,
) -> Result<(), ManifestPreviewError> {
    validate_outbound_manifest_metadata(manifest)?;
    if let Some(parent) = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| ManifestPreviewError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }

    let json = serde_json::to_string_pretty(manifest).map_err(|error| {
        ManifestPreviewError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    let mut tmp_path = output_path.to_path_buf();
    let tmp_name = match output_path.file_name() {
        Some(name) => format!(".{}.tmp", name.to_string_lossy()),
        None => ".outbound-manifest.tmp".to_string(),
    };
    tmp_path.set_file_name(tmp_name);
    fs::write(&tmp_path, format!("{json}\n")).map_err(|error| {
        ManifestPreviewError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    fs::rename(&tmp_path, output_path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        ManifestPreviewError::MetadataWriteFailed {
            path: output_path.to_path_buf(),
            reason: error.to_string(),
        }
    })
}

pub fn format_manifest_preview_summary(manifest: &OutboundManifest, output_path: &Path) -> String {
    let mut summary = String::new();
    summary.push_str("Outbound manifest preview generated\n");
    summary.push_str(&format!("manifest_id: {}\n", manifest.manifest_id));
    summary.push_str(&format!(
        "Selected application: {} ({})\n",
        terminal_safe_text(
            &manifest
                .selected_scope_summary
                .selected_application
                .display_name
        ),
        terminal_safe_text(
            &manifest
                .selected_scope_summary
                .selected_application
                .application_id
        )
    ));
    summary.push_str(&format!(
        "Selected commit: {}\n",
        manifest.selected_scope_summary.selected_commit.commit_sha
    ));
    summary.push_str(&format!(
        "Repository identity hash: {}\n",
        manifest.selected_scope_summary.repository_identity
    ));
    summary.push_str(&format!("Runner version: {}\n", manifest.runner.version));
    summary.push_str(&format!(
        "Disclosure Policy ref: {}\n",
        manifest.disclosure_policy_ref
    ));
    match &manifest.scanner_finding_set_ref {
        Some(scanner_ref) => summary.push_str(&format!(
            "Scanner finding set ref: {}\n",
            terminal_safe_text(scanner_ref)
        )),
        None => summary.push_str("Scanner finding set ref: not included\n"),
    }
    summary.push_str(&format!(
        "Coverage Mode: {} ({})\n",
        coverage_mode_label(&manifest.coverage_mode),
        terminal_safe_text(&manifest.coverage_mode)
    ));
    summary.push_str(&format!(
        "Package preview state: {} send_ready={} local_only={}\n",
        terminal_safe_text(&manifest.package_preview_state.state),
        manifest.package_preview_state.send_ready,
        manifest.package_preview_state.local_only
    ));
    summary.push_str(&format!(
        "Approval state: {}\n",
        terminal_safe_text(&manifest.approval.approval_state)
    ));
    summary.push_str(&format!(
        "Output path: {}\n",
        terminal_safe_text(&output_path.display().to_string())
    ));
    summary.push_str("Local-only boundary: manifest preview was written locally; no evidence leaves the local environment.\n");

    summary.push_str("Evidence categories:\n");
    summary.push_str("  Category | State | Count/Reference | Source class | Redaction | Retention | Limitation\n");
    for category in &manifest.evidence_categories {
        let disclosure = if category.source_code_disclosure {
            " source-code disclosure"
        } else {
            ""
        };
        summary.push_str(&format!(
            "  {} | {}{} | {} / {} | {} | {} (version={}) | {} | {}\n",
            terminal_safe_text(&category.category),
            terminal_safe_text(&category.inclusion_state),
            disclosure,
            category.count,
            terminal_safe_text(&category.reference),
            terminal_safe_text(&category.source_derived_class),
            terminal_safe_text(&category.redaction_state),
            terminal_safe_text(&category.redaction_configuration_version),
            terminal_safe_text(&category.retention_handling),
            terminal_safe_text(&category.limitation)
        ));
        if let Some(controls) = &category.snippet_controls {
            summary.push_str(&format!(
                "    controls: max_snippet_chars={} context_lines={} redaction_profile={} redaction_version={} retention_class={}\n",
                controls.max_snippet_chars,
                controls.context_lines,
                terminal_safe_text(&controls.redaction_profile),
                terminal_safe_text(&controls.redaction_configuration_version),
                terminal_safe_text(&controls.retention_class)
            ));
            if !controls.selected_files_or_areas.is_empty() {
                summary.push_str("    selected files or areas:\n");
                for selected in &controls.selected_files_or_areas {
                    summary.push_str(&format!("      - {}\n", terminal_safe_text(selected)));
                }
            }
        }
        for detail in &category.details {
            summary.push_str(&format!("    - {}\n", terminal_safe_text(detail)));
        }
    }

    summary.push_str("Warnings:\n");
    for warning in &manifest.warnings {
        summary.push_str(&format!("  - {}\n", terminal_safe_text(warning)));
    }
    summary.push_str("Limitations:\n");
    for limitation in &manifest.limitations {
        summary.push_str(&format!("  - {}\n", terminal_safe_text(limitation)));
    }
    summary
}

fn terminal_safe_text(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character == '\n'
                || character == '\r'
                || character == '\t'
                || character.is_control()
                || is_bidi_or_bom_code_point(character)
            {
                '?'
            } else {
                character
            }
        })
        .collect()
}

fn is_bidi_or_bom_code_point(character: char) -> bool {
    matches!(
        character as u32,
        0x200E | 0x200F | 0x202A..=0x202E | 0x2066..=0x2069 | 0xFEFF
    )
}

/// Sanitize `ONEVPS_RUNNER_*` environment-provided identifiers for use in
/// trust metadata and attempt-log summaries. Filters to printable ASCII,
/// trims surrounding whitespace, and caps length so injected ANSI, control
/// characters, or unbounded strings can't break the monochrome output
/// guarantee. Returns None when the sanitized result is empty.
fn sanitize_trust_env_value(value: String) -> Option<String> {
    const MAX_LEN: usize = 128;
    let sanitized: String = value
        .trim()
        .chars()
        .filter(|c| c.is_ascii_graphic() || *c == ' ')
        .take(MAX_LEN)
        .collect();
    let sanitized = sanitized.trim().to_string();
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

pub fn default_signed_evidence_bundle_output_dir() -> PathBuf {
    PathBuf::from(".codeattest/evidence-bundle")
}

pub fn default_local_runner_attempt_log_path() -> PathBuf {
    PathBuf::from(".codeattest/local-runner-attempts.jsonl")
}

/// Prefer the verification artifact packaged beside the current executable,
/// then fall back to `.codeattest/release-verification.json` in the working
/// directory for local development. An absent artifact is a normal unsigned
/// local-build state, not an error.
pub fn default_release_verification_artifact_path() -> Option<PathBuf> {
    if let Ok(executable) = env::current_exe()
        && let Some(parent) = executable.parent()
    {
        let packaged = parent.join(".codeattest/release-verification.json");
        if packaged.exists() {
            return Some(packaged);
        }
    }
    let path = PathBuf::from(".codeattest/release-verification.json");
    if path.exists() { Some(path) } else { None }
}

fn trust_env_identifiers() -> (String, String) {
    let build_identifier = env::var("ONEVPS_RUNNER_BUILD_IDENTIFIER")
        .ok()
        .and_then(sanitize_trust_env_value)
        .unwrap_or_else(|| "local-dev-build".to_string());
    let release_identifier = env::var("ONEVPS_RUNNER_RELEASE_IDENTIFIER")
        .ok()
        .and_then(sanitize_trust_env_value)
        .unwrap_or_else(|| "unreleased-local".to_string());
    (build_identifier, release_identifier)
}

fn effective_trust_identifiers() -> (String, String) {
    let (environment_build, environment_release) = trust_env_identifiers();
    let build_identifier = if release_trust::COMPILED_BUILD_IDENTIFIER.is_empty() {
        environment_build
    } else {
        release_trust::COMPILED_BUILD_IDENTIFIER.to_string()
    };
    let release_identifier = if release_trust::COMPILED_RELEASE_IDENTIFIER.is_empty() {
        environment_release
    } else {
        release_trust::COMPILED_RELEASE_IDENTIFIER.to_string()
    };
    (build_identifier, release_identifier)
}

pub fn runner_trust_metadata() -> RunnerTrustMetadata {
    let (build_identifier, _) = effective_trust_identifiers();
    let released_artifact = env::current_exe().ok();
    runner_trust_metadata_with_release(release_trust::verify_release(
        release_trust::RELEASE_TRUST_ANCHOR_PUBLIC_KEY,
        default_release_verification_artifact_path().as_deref(),
        released_artifact.as_deref(),
        &build_identifier,
    ))
}

pub fn runner_trust_metadata_with_release(
    trust: release_trust::ReleaseTrust,
) -> RunnerTrustMetadata {
    let (local_build_identifier, local_release_identifier) = effective_trust_identifiers();
    let (release_signature_status, trust_label, release_verification_artifact, limitations, release_identifier) =
        match &trust {
            release_trust::ReleaseTrust::Verified {
                release_identifier,
                artifact_ref,
                ..
            } => (
                "verified_release_signature",
                "trusted_release",
                Some(artifact_ref.clone()),
                vec![
                    "This build's release signature was verified against the compiled-in release trust anchor.".to_string(),
                    keys::RUNNER_SIGNING_LIMITATIONS[1].to_string(),
                ],
                release_identifier.clone(),
            ),
            release_trust::ReleaseTrust::Untrusted { reason } => (
                "untrusted_local_build",
                "untrusted_local_dev",
                None,
                vec![
                    format!("A release verification artifact was present but did not verify: {reason}."),
                    keys::RUNNER_SIGNING_LIMITATIONS[1].to_string(),
                    "No partner-pilot runner release signature has been verified.".to_string(),
                ],
                local_release_identifier.clone(),
            ),
            release_trust::ReleaseTrust::Unsigned => (
                "unsigned_local_build",
                "demo_only_unsigned",
                None,
                vec![
                    "This unsigned local build is for synthetic demo workflows only.".to_string(),
                    keys::RUNNER_SIGNING_LIMITATIONS[1].to_string(),
                    "No partner-pilot runner release signature has been verified.".to_string(),
                ],
                local_release_identifier,
            ),
        };
    let build_identifier = match &trust {
        release_trust::ReleaseTrust::Verified {
            build_identifier, ..
        } => build_identifier.clone(),
        _ => local_build_identifier,
    };
    RunnerTrustMetadata {
        runner_name: RUNNER_NAME.to_string(),
        runner_version: runner_version().to_string(),
        build_identifier,
        release_identifier,
        release_signature_status: release_signature_status.to_string(),
        bundle_signing_mode: "enrolled_runner_key".to_string(),
        trust_label: trust_label.to_string(),
        evidence_boundary: evidence_boundary().to_string(),
        release_verification_artifact,
        limitations,
    }
}

pub fn format_runner_trust_summary(trust: &RunnerTrustMetadata) -> String {
    let mut summary = String::new();
    summary.push_str("Runner trust status\n");
    summary.push_str(&format!("Runner name: {}\n", trust.runner_name));
    summary.push_str(&format!("Runner version: {}\n", trust.runner_version));
    summary.push_str(&format!("Build identifier: {}\n", trust.build_identifier));
    summary.push_str(&format!(
        "Release identifier: {}\n",
        trust.release_identifier
    ));
    summary.push_str(&format!(
        "Release signature status: {}\n",
        trust.release_signature_status
    ));
    summary.push_str(&format!(
        "Bundle signing mode: {}\n",
        trust.bundle_signing_mode
    ));
    summary.push_str(&format!("Trust label: {}\n", trust.trust_label));
    summary.push_str(&format!("Evidence boundary: {}\n", trust.evidence_boundary));
    summary.push_str("Limitations:\n");
    for limitation in &trust.limitations {
        summary.push_str(&format!("  - {limitation}\n"));
    }
    summary
}

pub fn local_attempt_id(
    stage: LocalRunnerStage,
    occurred_at: &str,
    run_nonce: Option<&str>,
) -> String {
    deterministic_local_id(
        "runner_attempt",
        &[stage.as_str(), occurred_at, &bundle_run_nonce(run_nonce)],
    )
}

pub fn write_local_runner_attempt(
    path: &Path,
    attempt: &LocalRunnerAttempt,
) -> Result<(), BundlePrepareError> {
    validate_local_runner_attempt(attempt)?;
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        if let Ok(meta) = fs::symlink_metadata(parent)
            && !meta.is_dir()
        {
            return Err(BundlePrepareError::MetadataWriteFailed {
                path: parent.to_path_buf(),
                reason: "attempt-log parent path exists but is not a directory".to_string(),
            });
        }
        fs::create_dir_all(parent).map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }
    let mut record =
        serde_json::to_vec(attempt).map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    record.push(b'\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    file.write_all(&record)
        .map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })
}

pub fn format_local_runner_attempt_summary(attempt: &LocalRunnerAttempt) -> String {
    let mut summary = String::new();
    if attempt.outcome == LocalRunnerOutcome::Failed {
        let stage = attempt.diagnostics.stage_failed.unwrap_or(attempt.stage);
        summary.push_str(&format!("Stage failed: {stage}\n"));
    } else {
        summary.push_str(&format!("Stage: {}\n", attempt.stage));
    }
    summary.push_str(&format!("Outcome: {}\n", attempt.outcome));
    summary.push_str(&format!("Review state: {}\n", attempt.review_state));
    summary.push_str(&format!("Approval state: {}\n", attempt.approval_state));
    summary.push_str(&format!("Bundle state: {}\n", attempt.bundle_state));
    summary.push_str(&format!("Remote state: {}\n", attempt.remote_state));
    summary.push_str(&format!("attempt_id: {}\n", attempt.attempt_id));
    if let Some(selected_commit) = &attempt.identities.selected_commit {
        summary.push_str(&format!("Selected commit: {selected_commit}\n"));
    }
    if let Some(repository_identity) = &attempt.identities.repository_identity {
        summary.push_str(&format!(
            "Repository identity hash: {repository_identity}\n"
        ));
    }
    if let Some(manifest_id) = &attempt.identities.manifest_id {
        summary.push_str(&format!("manifest_id: {manifest_id}\n"));
    }
    if let Some(approval_id) = &attempt.identities.approval_id {
        summary.push_str(&format!("approval_id: {approval_id}\n"));
    }
    if let Some(evidence_bundle_id) = &attempt.identities.evidence_bundle_id {
        summary.push_str(&format!("evidence_bundle_id: {evidence_bundle_id}\n"));
    }
    if let Some(bundle_instance_id) = &attempt.identities.bundle_instance_id {
        summary.push_str(&format!("bundle_instance_id: {bundle_instance_id}\n"));
    }
    if let Some(submission_attempt_id) = &attempt.identities.submission_attempt_id {
        summary.push_str(&format!("submission_attempt_id: {submission_attempt_id}\n"));
    }
    summary.push_str(&format!("Runner version: {}\n", attempt.runner.version));
    summary.push_str(&format!(
        "Runner trust: {}\n",
        attempt.runner_trust.trust_label
    ));
    summary.push_str(&format!("Diagnostics: {}\n", attempt.diagnostics.message));
    // Emit the "No signed Evidence Bundle is ready." sentence whenever the
    // attempt reports that state, whether via post-approval packaging failure
    // (bundle_state = failed_before_ready) or via `bundle status`
    // stale/inconsistent branches (review_state = approved_no_signed_bundle).
    let no_bundle_ready = attempt.bundle_state == LocalBundleState::FailedBeforeReady
        || attempt.review_state == ReviewState::ApprovedNoSignedBundle;
    if no_bundle_ready
        && !attempt
            .diagnostics
            .message
            .contains("No signed Evidence Bundle is ready")
    {
        summary.push_str("No signed Evidence Bundle is ready.\n");
    }
    if !attempt.next_actions.is_empty() {
        summary.push_str(&format!(
            "Next actions: {}\n",
            attempt.next_actions.join(", ")
        ));
    }
    summary
}

pub fn local_attempt_for_bundle_output(
    output: &BundlePrepareOutput,
    occurred_at: &str,
    run_nonce: Option<&str>,
) -> LocalRunnerAttempt {
    let approval = &output.approval;
    let identities = identities_from_approval_and_bundle(approval, output.bundle_manifest.as_ref());
    let (outcome, review_state, approval_state, bundle_state, message, next_actions) = if approval
        .decision
        == "declined"
    {
        (
                LocalRunnerOutcome::Declined,
                ReviewState::UnapprovedNotSubmitted,
                ApprovalState::Declined,
                LocalBundleState::NotCreated,
                "Customer declined approval; no signed Evidence Bundle was created and no evidence was sent.".to_string(),
                approval
                    .not_submitted_state
                    .as_ref()
                    .map(|state| state.next_actions.clone())
                    .unwrap_or_else(|| vec!["revise policy".to_string(), "rerun scan".to_string(), "export manifest".to_string(), "exit".to_string()]),
            )
    } else {
        (
            LocalRunnerOutcome::Succeeded,
            ReviewState::SignedBundleNotSubmitted,
            ApprovalState::Approved,
            LocalBundleState::ReadyNotSubmitted,
            "Signed local Evidence Bundle is ready locally; no evidence was sent.".to_string(),
            vec![
                "inspect local bundle".to_string(),
                "keep bundle local".to_string(),
                "wait for later submission workflow".to_string(),
            ],
        )
    };
    LocalRunnerAttempt {
        protocol_version: PROTOCOL_VERSION.to_string(),
        attempt_id: local_attempt_id(LocalRunnerStage::BundlePrepare, occurred_at, run_nonce),
        stage: LocalRunnerStage::BundlePrepare,
        outcome,
        review_state,
        approval_state,
        bundle_state,
        remote_state: "not_submitted".to_string(),
        occurred_at: occurred_at.to_string(),
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        runner_trust: runner_trust_metadata(),
        identities,
        approval_metadata: Some(LocalApprovalMetadata {
            decision: approval.decision.clone(),
            decided_at: approval.decided_at.clone(),
            approving_actor: approval.approving_actor.clone(),
        }),
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: None,
            failure_code: None,
            message,
            // A declined decision is terminal, not a transient failure; only
            // failed outcomes are retryable at the local attempt level. The
            // customer can still choose fresh approval, but that is a new
            // attempt, not a retry of this record.
            retryable: false,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: "Compare selected commit, repository identity, manifest identity, bundle identity when present, runner version, and attempt id.".to_string(),
            local_artifact_paths: Vec::new(),
        },
        next_actions,
    }
}

pub fn pre_approval_failure_attempt(
    stage: LocalRunnerStage,
    occurred_at: &str,
    run_nonce: Option<&str>,
    failure_code: &str,
    message: &str,
) -> LocalRunnerAttempt {
    LocalRunnerAttempt {
        protocol_version: PROTOCOL_VERSION.to_string(),
        attempt_id: local_attempt_id(stage, occurred_at, run_nonce),
        stage,
        outcome: LocalRunnerOutcome::Failed,
        review_state: ReviewState::UnapprovedNotSubmitted,
        approval_state: ApprovalState::NotRequested,
        bundle_state: LocalBundleState::NotCreated,
        remote_state: "not_submitted".to_string(),
        occurred_at: occurred_at.to_string(),
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        runner_trust: runner_trust_metadata(),
        identities: LocalAttemptIdentities::default(),
        approval_metadata: None,
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: Some(stage),
            failure_code: Some(failure_code.to_string()),
            message: privacy_safe_diagnostic_message(message),
            retryable: true,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: "Fix local protocol inputs and rerun the failed stage.".to_string(),
            local_artifact_paths: Vec::new(),
        },
        next_actions: vec![
            "fix local protocol inputs".to_string(),
            format!("rerun {stage}"),
            "request approval only after the local stage succeeds".to_string(),
        ],
    }
}

fn identities_from_approval_and_bundle(
    approval: &CustomerApproval,
    bundle: Option<&BundleManifest>,
) -> LocalAttemptIdentities {
    let context = &approval.displayed_context;
    LocalAttemptIdentities {
        selected_commit: Some(context.selected_commit.commit_sha.clone()),
        repository_identity: Some(context.repository_identity.clone()),
        manifest_id: Some(approval.manifest_id.clone()),
        approval_id: Some(approval.approval_id.clone()),
        evidence_bundle_id: bundle.map(|bundle| bundle.evidence_bundle_id.clone()),
        bundle_instance_id: bundle.map(|bundle| bundle.bundle_instance_id.clone()),
        submission_attempt_id: bundle.map(|bundle| bundle.submission_attempt_id.clone()),
        vendor_receipt_id: None,
        submission_outcome_id: None,
    }
}

const CLAIM_SAFE_FORBIDDEN_PHRASES: &[&str] = &[
    "submitted",
    "received",
    "received_with_receipt",
    "review complete",
    "finalized",
    "vendor receipt",
    "attestation",
    "certification",
    "certified",
    "auditor acceptance",
    "regulator acceptance",
    "independent assurance",
    "no vulnerabilities",
    "absence of vulnerabilities",
];

const SECRET_FORBIDDEN_PHRASES: &[&str] = &[
    "eval('1 + 1')",
    "raw scanner output",
    "scanner stdout",
    "scanner stderr",
    "password=",
    "secret=",
    "api_key=",
    "api-key=",
    "token=",
    "bearer ",
    "authorization: bearer",
];

/// Sub-project B: the local-runner-attempt schema's own protocol tokens for a
/// submit-stage remote_state. Stripped from a submit attempt's text before
/// the claim-safety scan below, exactly mirroring
/// `scripts/lib/protocol-utils.mjs`'s `SUBMIT_REMOTE_STATE_TOKENS` for the
/// same fixtures on the protocol-gate side.
const SUBMIT_REMOTE_STATE_TOKENS: &[&str] = &[
    "submit_attempted",
    "received_with_receipt",
    "rejected_no_receipt",
    "quarantined_no_receipt",
];

fn validate_local_runner_attempt(attempt: &LocalRunnerAttempt) -> Result<(), BundlePrepareError> {
    validate_bundle_timestamp("attempt.occurred_at", &attempt.occurred_at)?;
    let remote_state_ok = if attempt.stage == LocalRunnerStage::Submit {
        SUBMIT_REMOTE_STATE_TOKENS.contains(&attempt.remote_state.as_str())
    } else {
        attempt.remote_state == "not_submitted"
    };
    if attempt.protocol_version != PROTOCOL_VERSION || !remote_state_ok {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "local_runner_attempt".to_string(),
            reason: "must use codeattest.v0, and remote_state must stay not_submitted outside the submit stage".to_string(),
        });
    }
    let identities = &attempt.identities;
    let has_bundle_identity = identities.evidence_bundle_id.is_some()
        || identities.bundle_instance_id.is_some()
        || identities.submission_attempt_id.is_some();
    if attempt.bundle_state != LocalBundleState::ReadyNotSubmitted && has_bundle_identity {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "local_runner_attempt.identities".to_string(),
            reason: "bundle identities are allowed only when bundle_state is ready_not_submitted"
                .to_string(),
        });
    }
    if attempt.bundle_state == LocalBundleState::ReadyNotSubmitted
        && (identities.evidence_bundle_id.is_none()
            || identities.bundle_instance_id.is_none()
            || identities.submission_attempt_id.is_none())
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "local_runner_attempt.identities".to_string(),
            reason: "ready bundle attempts must include evidence_bundle_id, bundle_instance_id, and submission_attempt_id".to_string(),
        });
    }
    if attempt.diagnostics.raw_snippets_printed || !attempt.diagnostics.sensitive_detail_omitted {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "local_runner_attempt.diagnostics".to_string(),
            reason: "diagnostics must omit sensitive detail and not print Raw Snippets".to_string(),
        });
    }
    let mut attempt_text = serde_json::to_string(attempt)
        .unwrap_or_default()
        .to_ascii_lowercase();
    // The runner may state the protocol's own submit-stage transport state
    // verbatim, because that state is exactly what the server returned. It
    // still may not characterise what that state means for the customer's
    // security posture: every other forbidden phrase, and every non-submit
    // stage, stays fully in force.
    if attempt.stage == LocalRunnerStage::Submit {
        for token in SUBMIT_REMOTE_STATE_TOKENS {
            attempt_text = attempt_text.replace(token, "");
        }
    }
    for forbidden in CLAIM_SAFE_FORBIDDEN_PHRASES {
        if *forbidden == "submitted" {
            let without_allowed_state = attempt_text
                .replace("not_submitted", "")
                .replace("not submitted", "");
            if !without_allowed_state.contains("submitted") {
                continue;
            }
        }
        if attempt_text.contains(forbidden) {
            return Err(BundlePrepareError::InvalidProtocolField {
                field: "local_runner_attempt".to_string(),
                reason: "local attempts must not contain remote receipt, finalization, or assurance claim language".to_string(),
            });
        }
    }
    let diagnostics = format!(
        "{} {}",
        attempt.diagnostics.message, attempt.diagnostics.support_summary
    )
    .to_ascii_lowercase();
    for forbidden in SECRET_FORBIDDEN_PHRASES {
        if diagnostics.contains(forbidden) {
            return Err(BundlePrepareError::InvalidProtocolField {
                field: "local_runner_attempt.diagnostics".to_string(),
                reason: "diagnostics contain sensitive source, scanner, or credential detail"
                    .to_string(),
            });
        }
    }
    Ok(())
}

/// Test-only door to the private claim-safety validator, so `submit`'s own
/// integration tests can assert the relaxation in `validate_local_runner_attempt`
/// stays narrow without duplicating it.
#[doc(hidden)]
pub fn validate_local_runner_attempt_for_test(
    attempt: &LocalRunnerAttempt,
) -> Result<(), BundlePrepareError> {
    validate_local_runner_attempt(attempt)
}

fn privacy_safe_diagnostic_message(message: &str) -> String {
    let mut sanitized = message.replace("eval('1 + 1')", "[source detail omitted]");
    for marker in ["scanner stdout", "scanner stderr", "raw scanner output"] {
        sanitized = sanitized.replace(marker, "scanner diagnostic detail");
    }
    // Rewrite credential-looking substrings before they land in the JSONL log.
    for marker in [
        "password=",
        "secret=",
        "api_key=",
        "api-key=",
        "token=",
        "Bearer ",
        "Authorization: Bearer",
    ] {
        if sanitized.contains(marker) {
            sanitized = sanitized.replace(marker, "[credential redacted]");
        }
    }
    sanitized = strip_absolute_paths_for_diagnostic(&sanitized);
    sanitized
}

/// Strip absolute filesystem paths from diagnostic messages so full customer
/// paths never land in the local attempt log. Keeps the trailing filename so
/// operators still see which artifact failed, but hides the directory chain.
fn strip_absolute_paths_for_diagnostic(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let bytes = message.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let starts_posix_abs = bytes[i] == b'/'
            && (i == 0 || is_path_boundary(bytes[i - 1]))
            && i + 1 < bytes.len()
            && bytes[i + 1] != b' '
            && bytes[i + 1] != b'/';
        let starts_windows_abs = i + 2 < bytes.len()
            && (i == 0 || is_path_boundary(bytes[i - 1]))
            && bytes[i].is_ascii_alphabetic()
            && bytes[i + 1] == b':'
            && (bytes[i + 2] == b'/' || bytes[i + 2] == b'\\');
        if starts_posix_abs || starts_windows_abs {
            let mut end = i;
            while end < bytes.len() && !is_path_boundary(bytes[end]) {
                end += 1;
            }
            let segment = &message[i..end];
            let basename = segment.rsplit(['/', '\\']).next().unwrap_or("");
            if basename.is_empty() {
                out.push_str("[path omitted]");
            } else {
                out.push_str("[path omitted]/");
                out.push_str(basename);
            }
            i = end;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

fn is_path_boundary(byte: u8) -> bool {
    matches!(
        byte,
        b' ' | b'\t'
            | b'\n'
            | b'\r'
            | b'"'
            | b'\''
            | b'('
            | b')'
            | b'['
            | b']'
            | b'<'
            | b'>'
            | b','
    )
}

struct ValidatedBundleInputs {
    policy: DisclosurePolicy,
    manifest: OutboundManifest,
    scanner: Option<ScannerFindingSet>,
}

pub fn load_bundle_approval_context(
    input: &BundlePrepareInput,
) -> Result<BundleApprovalContext, BundlePrepareError> {
    validate_bundle_timestamp("decided_at", &input.decided_at)?;
    validate_bundle_timestamp("created_at", &input.created_at)?;
    validate_bundle_timestamp("signing_time", &input.signing_time)?;
    let manifest = load_validated_bundle_inputs(input)?.manifest;
    let approval = customer_approval_for_manifest(
        &manifest,
        "pending",
        input.approving_actor.as_deref(),
        &input.decided_at,
        None,
    )?;
    Ok(BundleApprovalContext { approval })
}

fn load_validated_bundle_inputs(
    input: &BundlePrepareInput,
) -> Result<ValidatedBundleInputs, BundlePrepareError> {
    let scope: ReviewScope = read_bundle_json_artifact("review scope", &input.scope_path)?;
    validate_review_scope_for_manifest(&scope).map_err(bundle_error_from_manifest)?;
    validate_review_scope_matches_identity(&scope).map_err(bundle_error_from_manifest)?;
    let policy: DisclosurePolicy =
        read_bundle_json_artifact("disclosure policy", &input.disclosure_policy_path)?;
    validate_disclosure_policy_for_manifest(&policy, &scope.review_scope_id)
        .map_err(bundle_error_from_manifest)?;
    validate_disclosure_policy_matches_identity(&policy).map_err(bundle_error_from_manifest)?;
    let manifest: OutboundManifest =
        read_bundle_json_artifact("outbound manifest", &input.manifest_path)?;
    validate_outbound_manifest_metadata(&manifest).map_err(bundle_error_from_manifest)?;
    validate_manifest_matches_identity(&manifest)?;
    validate_manifest_chain_for_bundle(&scope, &policy, &manifest)?;

    let gate = environment_evidence_gate();
    validate_environment_gate_for_manifest(&gate, &manifest.artifact_references).map_err(
        |reason| BundlePrepareError::InvalidProtocolField {
            field: "environment_evidence_gate".to_string(),
            reason,
        },
    )?;
    if gate.retention_period_required && policy.retention_policy.retention_period.trim().is_empty()
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "disclosure_policy.retention_policy.retention_period".to_string(),
            reason: "environment evidence gate requires an explicit retention period".to_string(),
        });
    }

    let scanner = if policy.include_scanner_findings {
        let scanner_path = input.scanner_findings_path.as_ref().ok_or_else(|| {
            BundlePrepareError::InvalidProtocolField {
                field: "--scanner-findings".to_string(),
                reason: "is required when the Disclosure Policy includes scanner findings"
                    .to_string(),
            }
        })?;
        let scanner: ScannerFindingSet =
            read_bundle_json_artifact("scanner finding set", scanner_path)?;
        validate_scanner_finding_set_for_manifest(&scanner, &scope.review_scope_id, &policy)
            .map_err(bundle_error_from_manifest)?;
        validate_scanner_finding_set_matches_identity(&scanner)
            .map_err(bundle_error_from_manifest)?;
        // [C2-05] scanner_finding_set.artifact_references (e.g. retained raw Semgrep
        // output tagged customer_opt_in_retained_source) is nested inside the scanner
        // finding set and is never promoted into the outbound manifest's top-level
        // artifact_references, so the gate check above never inspected it. Apply the
        // same environment-gate/disclosure-policy boundary to it explicitly.
        validate_environment_gate_for_manifest(&gate, &scanner.artifact_references).map_err(
            |reason| BundlePrepareError::InvalidProtocolField {
                field: "scanner_finding_set.artifact_references".to_string(),
                reason,
            },
        )?;
        Some(scanner)
    } else if input.scanner_findings_path.is_some() {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "--scanner-findings".to_string(),
            reason: "supplied but the Disclosure Policy excludes scanner findings".to_string(),
        });
    } else {
        None
    };

    Ok(ValidatedBundleInputs {
        policy,
        manifest,
        scanner,
    })
}

pub fn initialize_signed_evidence_bundle(
    input: BundlePrepareInput,
) -> Result<BundlePrepareOutput, BundlePrepareError> {
    validate_bundle_timestamp("decided_at", &input.decided_at)?;
    validate_bundle_timestamp("created_at", &input.created_at)?;
    validate_bundle_timestamp("signing_time", &input.signing_time)?;

    let ValidatedBundleInputs {
        policy,
        manifest,
        scanner,
    } = load_validated_bundle_inputs(&input)?;

    let approved = input.approval_decision == ApprovalDecision::Approve
        && input.approval_confirmation.as_deref() == Some(manifest.manifest_id.as_str());
    let decision = if approved { "approved" } else { "declined" };
    let run_nonce = bundle_run_nonce(input.run_nonce.as_deref());
    let approval = match &input.reused_approval {
        Some(reused) if approved && reused.manifest_id == manifest.manifest_id => reused.clone(),
        Some(_) => {
            return Err(BundlePrepareError::InvalidProtocolField {
                field: "reused_approval".to_string(),
                reason: "reused approval must be approved and match the current manifest_id"
                    .to_string(),
            });
        }
        None => customer_approval_for_manifest(
            &manifest,
            decision,
            input.approving_actor.as_deref(),
            &input.decided_at,
            Some(run_nonce.as_str()),
        )?,
    };

    if !approved {
        return Ok(BundlePrepareOutput {
            approval,
            bundle_manifest: None,
            signature_envelope: None,
            output_dir: input.output_dir,
        });
    }

    if manifest_requires_materialized_source_artifacts(&manifest)
        && !manifest_has_materialized_source_artifacts(&manifest)
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.artifact_references".to_string(),
            reason: "source-derived evidence artifacts are required before bundle construction for finding-context or extended coverage modes; metadata-only bundle preparation is supported without source contents".to_string(),
        });
    }

    let approval_json = json_bytes(&approval)?;
    let artifact_references =
        bundle_artifact_references(&input, &policy, &manifest, &approval_json)?;
    validate_candidate_source_artifact_bindings(scanner.as_ref(), &artifact_references)?;
    let cleanup_intent = cleanup_intent_for_artifacts(&artifact_references);
    let bundle_instance_id = deterministic_local_id(
        "bundle_instance",
        &[
            manifest.manifest_id.as_str(),
            approval.approval_id.as_str(),
            input.created_at.as_str(),
            run_nonce.as_str(),
        ],
    );
    let submission_attempt_id = deterministic_local_id(
        "submission_attempt",
        &[
            manifest.manifest_id.as_str(),
            approval.approval_id.as_str(),
            input.signing_time.as_str(),
            run_nonce.as_str(),
        ],
    );
    let mut bundle_manifest = BundleManifest {
        protocol_version: PROTOCOL_VERSION.to_string(),
        evidence_bundle_id: "sha256:pending".to_string(),
        manifest_id: manifest.manifest_id.clone(),
        customer_approval_ref: approval.approval_id.clone(),
        customer_approval_decision: "approved".to_string(),
        bundle_state: "not_submitted".to_string(),
        review_scope_ref: manifest.review_scope_ref.clone(),
        disclosure_policy_ref: manifest.disclosure_policy_ref.clone(),
        scanner_finding_set_ref: manifest.scanner_finding_set_ref.clone(),
        coverage_mode: manifest.coverage_mode.clone(),
        bundle_instance_id,
        submission_attempt_id,
        created_at: input.created_at,
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        tool_versions: vec![ToolVersion {
            tool_name: "local-runner-scaffold".to_string(),
            tool_version: runner_version().to_string(),
        }],
        artifact_references,
        verification_metadata: BundleVerificationMetadata {
            identity_canonicalization: "rfc8785".to_string(),
            identity_hash_algorithm: "sha256".to_string(),
            identity_input_excludes: vec!["evidence_bundle_id".to_string()],
            signed_identity_type: "evidence_bundle".to_string(),
            approved_manifest_id: manifest.manifest_id,
            signature_envelope_path: "signature-envelope.bundle.json".to_string(),
            bundle_signing_mode: "enrolled_runner_key".to_string(),
        },
        local_cleanup_intent: cleanup_intent,
    };
    bundle_manifest.evidence_bundle_id = evidence_bundle_identity(&bundle_manifest);
    validate_bundle_manifest_metadata(&bundle_manifest)?;

    let signing_key =
        keys::load_or_create_signing_key(&keys::default_key_dir(), RUNNER_SIGNING_KEY_ID).map_err(
            |error| BundlePrepareError::ArtifactReadFailed {
                artifact: "runner signing key",
                path: keys::default_key_dir(),
                reason: format!("{error:?}"),
            },
        )?;
    let signature_envelope = signature_envelope_for_bundle(
        &signing_key,
        &bundle_manifest.evidence_bundle_id,
        &input.signing_time,
    )?;

    Ok(BundlePrepareOutput {
        approval,
        bundle_manifest: Some(bundle_manifest),
        signature_envelope: Some(signature_envelope),
        output_dir: input.output_dir,
    })
}

pub fn initialize_and_write_signed_evidence_bundle(
    input: BundlePrepareInput,
) -> Result<BundlePrepareOutput, BundlePrepareError> {
    let scope_path = input.scope_path.clone();
    let scanner_path = input.scanner_findings_path.clone();
    let policy_path = input.disclosure_policy_path.clone();
    let manifest_path = input.manifest_path.clone();
    let output = initialize_signed_evidence_bundle(input)?;
    write_signed_evidence_bundle(
        &output,
        &scope_path,
        scanner_path.as_deref(),
        &policy_path,
        &manifest_path,
    )?;
    Ok(output)
}

pub fn initialize_write_bundle_prepare_with_attempt(
    input: BundlePrepareInput,
    attempt_log_path: &Path,
) -> Result<(BundlePrepareOutput, LocalRunnerAttempt), Box<BundlePrepareAttemptError>> {
    let scope_path = input.scope_path.clone();
    let scanner_path = input.scanner_findings_path.clone();
    let policy_path = input.disclosure_policy_path.clone();
    let manifest_path = input.manifest_path.clone();
    let output_dir = input.output_dir.clone();
    let occurred_at = input.signing_time.clone();
    let run_nonce = input.run_nonce.clone();
    let approving_actor = input.approving_actor.clone();
    let approval_decision = input.approval_decision.clone();
    let approval_confirmation = input.approval_confirmation.clone();

    let output = match initialize_signed_evidence_bundle(input) {
        Ok(output) => output,
        Err(error) => {
            let failure = PostApprovalFailureFromInputs {
                scope_path: &scope_path,
                scanner_path: scanner_path.as_deref(),
                policy_path: &policy_path,
                manifest_path: &manifest_path,
                output_dir: &output_dir,
                approving_actor,
                approval_decision,
                approval_confirmation,
                occurred_at: &occurred_at,
                run_nonce: run_nonce.as_deref(),
                error: &error,
                attempt_log_path,
            };
            return match post_approval_failure_attempt_from_inputs(failure) {
                Ok(attempt) => Err(Box::new(BundlePrepareAttemptError::with_attempt(
                    error, attempt,
                ))),
                Err(_write_error) => {
                    // The retry-load inside the failure-attempt builder itself
                    // failed (e.g. disk state changed between calls). Surface
                    // the ORIGINAL bundle-prepare error so callers see the
                    // real root cause; the retry error is not a substitute.
                    Err(Box::new(BundlePrepareAttemptError::without_attempt(error)))
                }
            };
        }
    };

    if let Err(error) = write_signed_evidence_bundle(
        &output,
        &scope_path,
        scanner_path.as_deref(),
        &policy_path,
        &manifest_path,
    ) {
        if output.approval.decision == "approved" {
            let failure = PostApprovalFailureFromApproval {
                approval: &output.approval,
                output_dir: &output_dir,
                occurred_at: &occurred_at,
                run_nonce: run_nonce.as_deref(),
                stage: LocalRunnerStage::BundlePackaging,
                failure_code: "bundle_artifact_write_failed",
                message: &error.to_string(),
                attempt_log_path,
            };
            return match post_approval_failure_attempt_from_approval(failure) {
                Ok(attempt) => Err(Box::new(BundlePrepareAttemptError::with_attempt(
                    error, attempt,
                ))),
                Err(write_error) => Err(Box::new(BundlePrepareAttemptError::without_attempt(
                    write_error,
                ))),
            };
        }
        return Err(Box::new(BundlePrepareAttemptError::without_attempt(error)));
    }

    let attempt = local_attempt_for_bundle_output(&output, &occurred_at, run_nonce.as_deref());
    if let Err(error) = write_local_runner_attempt(attempt_log_path, &attempt) {
        return Err(Box::new(BundlePrepareAttemptError::without_attempt(error)));
    }
    Ok((output, attempt))
}

pub fn write_signed_evidence_bundle(
    output: &BundlePrepareOutput,
    scope_path: &Path,
    scanner_path: Option<&Path>,
    disclosure_policy_path: &Path,
    manifest_path: &Path,
) -> Result<(), BundlePrepareError> {
    fs::create_dir_all(&output.output_dir).map_err(|error| {
        BundlePrepareError::MetadataWriteFailed {
            path: output.output_dir.clone(),
            reason: error.to_string(),
        }
    })?;
    write_json_file(
        &output.output_dir.join("customer-approval.json"),
        &output.approval,
    )?;

    let Some(bundle_manifest) = &output.bundle_manifest else {
        remove_stale_signed_bundle_artifacts(&output.output_dir)?;
        return Ok(());
    };
    let artifact_dir = output.output_dir.join("artifacts");
    fs::create_dir_all(&artifact_dir).map_err(|error| BundlePrepareError::MetadataWriteFailed {
        path: artifact_dir.clone(),
        reason: error.to_string(),
    })?;
    copy_bundle_artifact(scope_path, &artifact_dir.join("review-scope.json"))?;
    if let Some(scanner_path) = scanner_path {
        copy_bundle_artifact(scanner_path, &artifact_dir.join("scanner-findings.json"))?;
    }
    copy_bundle_artifact(
        disclosure_policy_path,
        &artifact_dir.join("disclosure-policy.json"),
    )?;
    copy_bundle_artifact(manifest_path, &artifact_dir.join("outbound-manifest.json"))?;
    copy_manifest_source_derived_artifacts(bundle_manifest, manifest_path, &artifact_dir)?;
    verify_bundle_artifact_copies(bundle_manifest, &output.output_dir, &artifact_dir)?;

    write_json_file(
        &output.output_dir.join("bundle_manifest.json"),
        bundle_manifest,
    )?;
    if let Some(signature) = &output.signature_envelope {
        write_json_file(
            &output.output_dir.join("signature-envelope.bundle.json"),
            signature,
        )?;
    }
    Ok(())
}

pub fn inspect_bundle_status(
    input: BundleStatusInput,
) -> Result<LocalRunnerAttempt, BundlePrepareError> {
    validate_bundle_timestamp("status.occurred_at", &input.occurred_at)?;
    let manifest: OutboundManifest =
        read_bundle_json_artifact("outbound manifest", &input.manifest_path)?;
    validate_outbound_manifest_metadata(&manifest).map_err(bundle_error_from_manifest)?;
    validate_manifest_matches_identity(&manifest)?;
    let scope: ReviewScope = read_bundle_json_artifact("review scope", &input.scope_path)?;
    validate_review_scope_for_manifest(&scope).map_err(bundle_error_from_manifest)?;

    let approval_path = input.output_dir.join("customer-approval.json");
    let bundle_path = input.output_dir.join("bundle_manifest.json");
    let signature_path = input.output_dir.join("signature-envelope.bundle.json");
    let approval = if approval_path.exists() {
        Some(read_bundle_json_artifact::<CustomerApproval>(
            "customer approval",
            &approval_path,
        )?)
    } else {
        None
    };
    let bundle = if bundle_path.exists() {
        Some(read_bundle_json_artifact::<BundleManifest>(
            "bundle manifest",
            &bundle_path,
        )?)
    } else {
        None
    };
    let signature_exists = signature_path.exists();
    let signature = if signature_exists {
        Some(read_bundle_json_artifact::<SignatureEnvelope>(
            "signature envelope",
            &signature_path,
        )?)
    } else {
        None
    };
    let bundle_ready = matches!(
        (bundle.as_ref(), signature.as_ref()),
        (Some(bundle), Some(signature))
            if signature_envelope_matches_bundle(signature, bundle)
                && verify_bundle_manifest_artifacts(bundle, &input.output_dir).is_ok()
    );

    let (outcome, review_state, approval_state, bundle_state, identities, approval_metadata, message, next_actions) =
        match (approval.as_ref(), bundle.as_ref(), bundle_ready) {
            (None, _, _) => (
                LocalRunnerOutcome::Succeeded,
                ReviewState::UnapprovedNotSubmitted,
                ApprovalState::NotRequested,
                LocalBundleState::NotCreated,
                LocalAttemptIdentities {
                    selected_commit: Some(scope.selected_commit.commit_sha.clone()),
                    repository_identity: Some(scope.repository_identity.clone()),
                    manifest_id: Some(manifest.manifest_id.clone()),
                    ..LocalAttemptIdentities::default()
                },
                None,
                "No customer approval has been recorded; review remains unapproved and not submitted.".to_string(),
                vec!["request explicit approval".to_string(), "revise policy".to_string()],
            ),
            (Some(approval), _, _) if approval.decision == "declined" => (
                LocalRunnerOutcome::Declined,
                ReviewState::UnapprovedNotSubmitted,
                ApprovalState::Declined,
                LocalBundleState::NotCreated,
                identities_from_approval_and_bundle(approval, None),
                Some(LocalApprovalMetadata {
                    decision: approval.decision.clone(),
                    decided_at: approval.decided_at.clone(),
                    approving_actor: approval.approving_actor.clone(),
                }),
                "Customer declined approval; no signed Evidence Bundle was created and no evidence was sent.".to_string(),
                vec![
                    "revise policy".to_string(),
                    "rerun scan".to_string(),
                    "export manifest".to_string(),
                    "exit".to_string(),
                ],
            ),
            (Some(approval), Some(bundle), true)
                if approval.decision == "approved"
                    && bundle.manifest_id == manifest.manifest_id
                    && bundle.customer_approval_ref == approval.approval_id
                    && bundle_status_manifest_ready(bundle) =>
            {
                (
                    LocalRunnerOutcome::Succeeded,
                    ReviewState::SignedBundleNotSubmitted,
                    ApprovalState::Approved,
                    LocalBundleState::ReadyNotSubmitted,
                    identities_from_approval_and_bundle(approval, Some(bundle)),
                    Some(LocalApprovalMetadata {
                        decision: approval.decision.clone(),
                        decided_at: approval.decided_at.clone(),
                        approving_actor: approval.approving_actor.clone(),
                    }),
                    "Signed local Evidence Bundle is ready locally; no evidence was sent.".to_string(),
                    vec![
                        "inspect local bundle".to_string(),
                        "keep bundle local".to_string(),
                        "wait for later submission workflow".to_string(),
                    ],
                )
            }
            (Some(approval), _, _) if approval.decision == "approved" => (
                LocalRunnerOutcome::Blocked,
                ReviewState::ApprovedNoSignedBundle,
                ApprovalState::Approved,
                LocalBundleState::FailedBeforeReady,
                identities_from_approval_and_bundle(approval, None),
                Some(LocalApprovalMetadata {
                    decision: approval.decision.clone(),
                    decided_at: approval.decided_at.clone(),
                    approving_actor: approval.approving_actor.clone(),
                }),
                "Customer approval is preserved. No signed Evidence Bundle is ready.".to_string(),
                vec![
                    "rerun with explicit approval reuse".to_string(),
                    "choose fresh approval".to_string(),
                    "revise policy".to_string(),
                    "export manifest".to_string(),
                ],
            ),
            _ => (
                LocalRunnerOutcome::Blocked,
                ReviewState::UnapprovedNotSubmitted,
                ApprovalState::NotRequested,
                LocalBundleState::NotCreated,
                LocalAttemptIdentities {
                    selected_commit: Some(scope.selected_commit.commit_sha.clone()),
                    repository_identity: Some(scope.repository_identity.clone()),
                    manifest_id: Some(manifest.manifest_id.clone()),
                    ..LocalAttemptIdentities::default()
                },
                None,
                "Local bundle directory is stale or inconsistent. No signed Evidence Bundle is ready.".to_string(),
                vec!["remove stale bundle artifacts".to_string(), "choose fresh approval".to_string()],
            ),
        };

    let attempt = LocalRunnerAttempt {
        protocol_version: PROTOCOL_VERSION.to_string(),
        attempt_id: local_attempt_id(
            LocalRunnerStage::StatusInspect,
            &input.occurred_at,
            input.run_nonce.as_deref(),
        ),
        stage: LocalRunnerStage::StatusInspect,
        outcome,
        review_state,
        approval_state,
        bundle_state,
        remote_state: "not_submitted".to_string(),
        occurred_at: input.occurred_at,
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        runner_trust: runner_trust_metadata(),
        identities,
        approval_metadata,
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: if bundle_state == LocalBundleState::FailedBeforeReady
                || (bundle_state == LocalBundleState::NotCreated
                    && outcome == LocalRunnerOutcome::Blocked)
            {
                Some(LocalRunnerStage::StatusInspect)
            } else {
                None
            },
            failure_code: if bundle_state == LocalBundleState::FailedBeforeReady {
                Some("signed_bundle_not_ready".to_string())
            } else if bundle_state == LocalBundleState::NotCreated
                && outcome == LocalRunnerOutcome::Blocked
                && (bundle_path.exists() || signature_exists)
            {
                // Stale/inconsistent output_dir: bundle artifacts remain but
                // don't match the current manifest/approval. Give programmatic
                // triage an actionable code.
                Some("bundle_output_dir_stale".to_string())
            } else {
                None
            },
            message,
            retryable: bundle_state != LocalBundleState::ReadyNotSubmitted,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: "Status inspection uses local protocol artifacts only and does not infer remote receipt or final states.".to_string(),
            local_artifact_paths: Vec::new(),
        },
        next_actions,
    };
    validate_local_runner_attempt(&attempt)?;
    Ok(attempt)
}

fn bundle_status_manifest_ready(bundle: &BundleManifest) -> bool {
    validate_bundle_manifest_metadata(bundle).is_ok()
}

fn signature_envelope_matches_bundle(
    signature: &SignatureEnvelope,
    bundle: &BundleManifest,
) -> bool {
    signature.signed_identity_type == "evidence_bundle"
        && signature.signed_identity == bundle.evidence_bundle_id
}

pub fn evidence_bundle_identity(bundle: &BundleManifest) -> String {
    let value = serde_json::to_value(bundle).unwrap_or(serde_json::Value::Null);
    let identity_input = match value {
        serde_json::Value::Object(mut map) => {
            map.remove("evidence_bundle_id");
            serde_json::Value::Object(map)
        }
        other => other,
    };
    let canonical = canonicalize_json_value(&identity_input);
    sha256_id(canonical.as_bytes())
}

pub fn format_signed_bundle_summary(output: &BundlePrepareOutput, output_dir: &Path) -> String {
    let approval = &output.approval;
    let mut summary = format_bundle_approval_summary(approval, output_dir);

    if approval.decision == "declined" {
        summary.push_str("Decision: declined\n");
        summary.push_str("State: not_submitted\n");
        summary.push_str("No signed Evidence Bundle was created.\n");
        summary.push_str("No evidence was sent.\n");
        if let Some(state) = &approval.not_submitted_state {
            summary.push_str(&format!(
                "Next actions: {}\n",
                state.next_actions.join(", ")
            ));
        }
        return summary;
    }

    summary.push_str("Signed local Evidence Bundle prepared\n");
    summary.push_str(&format!("approval_id: {}\n", approval.approval_id));
    if let Some(bundle) = &output.bundle_manifest {
        summary.push_str(&format!("manifest_id: {}\n", bundle.manifest_id));
        summary.push_str(&format!(
            "evidence_bundle_id: {}\n",
            bundle.evidence_bundle_id
        ));
        summary.push_str(&format!(
            "bundle_instance_id: {}\n",
            bundle.bundle_instance_id
        ));
        summary.push_str(&format!(
            "submission_attempt_id: {}\n",
            bundle.submission_attempt_id
        ));
        summary.push_str(&format!("bundle_state: {}\n", bundle.bundle_state));
        summary.push_str("Verification metadata: identity_canonicalization=rfc8785 identity_hash_algorithm=sha256 signed_identity_type=evidence_bundle\n");
    }
    if let Some(signature) = &output.signature_envelope {
        summary.push_str(&format!(
            "signing key: {} version={}\n",
            signature.key_id, signature.key_version
        ));
        summary.push_str(&format!(
            "algorithm/profile: {} signing_mode={} canonicalization={}\n",
            signature.algorithm_profile, signature.signing_mode, signature.canonicalization
        ));
        if signature.signing_mode == "enrolled_runner_key" {
            summary.push_str("Demo boundary: this bundle is signed with a real ML-DSA-65 signature under runner-held key custody; see the signature envelope's signing_limitations for what this signature does and does not attest to.\n");
        } else {
            summary.push_str("Demo boundary: this bundle is signed with a real ML-DSA-65 signature under vendor-managed key custody; see the signature envelope's signing_limitations for what this signature does and does not attest to.\n");
        }
    }
    summary.push_str(
        "Local-only boundary: no evidence was sent and no remote intake result is created.\n",
    );
    summary
}

pub fn format_bundle_approval_context(
    context: &BundleApprovalContext,
    output_dir: &Path,
) -> String {
    format_bundle_approval_summary(&context.approval, output_dir)
}

pub fn load_reusable_customer_approval(
    approval_path: &Path,
    input: &BundlePrepareInput,
) -> Result<CustomerApproval, BundlePrepareError> {
    let approval: CustomerApproval =
        read_bundle_json_artifact("reusable customer approval", approval_path)?;
    let context = load_bundle_approval_context(input)?;
    validate_reused_approval_matches_context(&approval, &context.approval)?;
    Ok(approval)
}

pub fn validate_reused_approval_matches_context(
    approval: &CustomerApproval,
    expected: &CustomerApproval,
) -> Result<(), BundlePrepareError> {
    if approval.decision != "approved" {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "reuse_approval.decision".to_string(),
            reason: "must be approved for explicit approval reuse".to_string(),
        });
    }
    if approval.manifest_id != expected.manifest_id
        || approval.displayed_context.manifest_id != expected.displayed_context.manifest_id
        || approval.displayed_context.selected_application
            != expected.displayed_context.selected_application
        || approval.displayed_context.selected_commit != expected.displayed_context.selected_commit
        || approval.displayed_context.repository_identity
            != expected.displayed_context.repository_identity
        || approval.displayed_context.coverage_mode != expected.displayed_context.coverage_mode
        || approval.displayed_context.disclosure_policy_ref
            != expected.displayed_context.disclosure_policy_ref
        || approval.displayed_context.scanner_finding_set_ref
            != expected.displayed_context.scanner_finding_set_ref
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "reuse_approval.displayed_context".to_string(),
            reason: "must match the current manifest id, selected application, selected commit, repository identity hash, Coverage Mode, Disclosure Policy reference, and scanner finding set reference; choose fresh approval if context changed".to_string(),
        });
    }
    Ok(())
}

fn format_bundle_approval_summary(approval: &CustomerApproval, output_dir: &Path) -> String {
    let context = &approval.displayed_context;
    let mut summary = String::new();
    summary.push_str("Approval context\n");
    summary.push_str(&format!("manifest_id: {}\n", approval.manifest_id));
    summary.push_str(&format!(
        "Selected application: {} ({})\n",
        context.selected_application.display_name, context.selected_application.application_id
    ));
    summary.push_str(&format!(
        "Selected commit: {}\n",
        context.selected_commit.commit_sha
    ));
    summary.push_str(&format!(
        "Repository identity hash: {}\n",
        context.repository_identity
    ));
    summary.push_str(&format!(
        "Disclosure Policy ref: {}\n",
        context.disclosure_policy_ref
    ));
    match &context.scanner_finding_set_ref {
        Some(scanner_ref) => summary.push_str(&format!("Scanner finding set ref: {scanner_ref}\n")),
        None => summary.push_str("Scanner finding set ref: not included\n"),
    }
    summary.push_str(&format!(
        "Coverage Mode: {} ({})\n",
        coverage_mode_label(&context.coverage_mode),
        context.coverage_mode
    ));
    summary.push_str(&format!(
        "Bundle preview summary: {}\n",
        context.bundle_preview_summary
    ));
    summary.push_str("Warnings displayed before decision:\n");
    for warning in &context.disclosure_warnings {
        summary.push_str(&format!("  - {warning}\n"));
    }
    summary.push_str(&format!("Output directory: {}\n", output_dir.display()));
    summary
}

fn read_bundle_json_artifact<T: DeserializeOwned>(
    artifact: &'static str,
    path: &Path,
) -> Result<T, BundlePrepareError> {
    let content =
        fs::read_to_string(path).map_err(|error| BundlePrepareError::ArtifactReadFailed {
            artifact,
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    serde_json::from_str(&content).map_err(|error| BundlePrepareError::ArtifactParseFailed {
        artifact,
        path: path.to_path_buf(),
        reason: error.to_string(),
    })
}

fn validate_manifest_matches_identity(
    manifest: &OutboundManifest,
) -> Result<(), BundlePrepareError> {
    let expected = outbound_manifest_identity(manifest);
    if expected != manifest.manifest_id {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest_id".to_string(),
            reason: format!(
                "manifest_id does not match canonical outbound manifest content excluding manifest_id (expected {expected}, got {})",
                manifest.manifest_id
            ),
        });
    }
    Ok(())
}

fn validate_manifest_chain_for_bundle(
    scope: &ReviewScope,
    policy: &DisclosurePolicy,
    manifest: &OutboundManifest,
) -> Result<(), BundlePrepareError> {
    if manifest.review_scope_ref != scope.review_scope_id {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.review_scope_ref".to_string(),
            reason: "does not match review_scope.review_scope_id".to_string(),
        });
    }
    if manifest.disclosure_policy_ref != policy.disclosure_policy_id {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.disclosure_policy_ref".to_string(),
            reason: "does not match disclosure_policy.disclosure_policy_id".to_string(),
        });
    }
    if manifest.coverage_mode != policy.coverage_mode {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.coverage_mode".to_string(),
            reason: "does not match disclosure_policy.coverage_mode".to_string(),
        });
    }
    if manifest.selected_scope_summary.selected_commit != scope.selected_commit
        || manifest.selected_scope_summary.repository_identity != scope.repository_identity
        || manifest.selected_scope_summary.selected_application != scope.selected_application
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.selected_scope_summary".to_string(),
            reason:
                "does not match review scope selected application, commit, and repository identity"
                    .to_string(),
        });
    }
    Ok(())
}

fn customer_approval_for_manifest(
    manifest: &OutboundManifest,
    decision: &str,
    approving_actor: Option<&str>,
    decided_at: &str,
    run_nonce: Option<&str>,
) -> Result<CustomerApproval, BundlePrepareError> {
    let run_nonce = bundle_run_nonce(run_nonce);
    let approval_id = deterministic_local_id(
        "approval",
        &[
            manifest.manifest_id.as_str(),
            decision,
            decided_at,
            run_nonce.as_str(),
        ],
    );
    let approving_actor = approving_actor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|actor_id| ActorReference {
            actor_type: "customer_user".to_string(),
            actor_id: actor_id.to_string(),
        });
    let displayed_context = ApprovalDisplayedContext {
        manifest_id: manifest.manifest_id.clone(),
        selected_application: manifest.selected_scope_summary.selected_application.clone(),
        selected_commit: manifest.selected_scope_summary.selected_commit.clone(),
        repository_identity: manifest.selected_scope_summary.repository_identity.clone(),
        coverage_mode: manifest.coverage_mode.clone(),
        disclosure_policy_ref: manifest.disclosure_policy_ref.clone(),
        scanner_finding_set_ref: manifest.scanner_finding_set_ref.clone(),
        disclosure_warnings: manifest.warnings.clone(),
        bundle_preview_summary: bundle_preview_summary(manifest),
    };
    let not_submitted_state = if decision == "declined" {
        Some(NotSubmittedState {
            state: "not_submitted".to_string(),
            evidence_bundle_created: false,
            evidence_sent: false,
            next_actions: vec![
                "revise policy".to_string(),
                "rerun scan".to_string(),
                "export manifest".to_string(),
                "exit".to_string(),
            ],
        })
    } else {
        None
    };
    let warnings_acknowledged = if decision == "approved" {
        manifest.warnings.clone()
    } else {
        Vec::new()
    };
    let approval = CustomerApproval {
        protocol_version: PROTOCOL_VERSION.to_string(),
        approval_id,
        manifest_id: manifest.manifest_id.clone(),
        decision: decision.to_string(),
        decided_at: decided_at.to_string(),
        approving_actor,
        displayed_context,
        warnings_acknowledged,
        not_submitted_state,
    };
    validate_customer_approval_metadata(&approval)?;
    Ok(approval)
}

fn bundle_preview_summary(manifest: &OutboundManifest) -> String {
    let scanner = if manifest.scanner_finding_set_ref.is_some() {
        "scanner finding set, "
    } else {
        ""
    };
    let source = if manifest_has_materialized_source_artifacts(manifest) {
        "source-derived artifact copies, "
    } else {
        ""
    };
    format!(
        "not_submitted local Evidence Bundle preview for manifest {} with review scope, {}{}Disclosure Policy, outbound manifest, customer approval, bundle identity, and real ML-DSA-65 signature metadata; no evidence is sent and no remote intake result is produced.",
        manifest.manifest_id, scanner, source
    )
}

fn manifest_requires_materialized_source_artifacts(manifest: &OutboundManifest) -> bool {
    manifest.evidence_categories.iter().any(|category| {
        category.included
            && matches!(
                category.category.as_str(),
                "raw_snippets" | "targeted_files"
            )
            && matches!(
                category.source_derived_class.as_str(),
                "transient_source_derived" | "customer_opt_in_retained_source"
            )
    })
}

fn manifest_has_materialized_source_artifacts(manifest: &OutboundManifest) -> bool {
    manifest.artifact_references.iter().any(|artifact| {
        matches!(
            artifact.artifact_type.as_str(),
            "raw_snippet" | "targeted_file"
        )
    })
}

fn bundle_artifact_references(
    input: &BundlePrepareInput,
    policy: &DisclosurePolicy,
    manifest: &OutboundManifest,
    approval_json: &[u8],
) -> Result<Vec<ArtifactReference>, BundlePrepareError> {
    let mut references = vec![bundle_artifact_reference_for_file(
        &input.scope_path,
        "review_scope",
        "review_scope",
        "manifest_entry:metadata",
        "artifacts/review-scope.json",
    )?];
    if policy.include_scanner_findings {
        let scanner_path = input.scanner_findings_path.as_ref().ok_or_else(|| {
            BundlePrepareError::InvalidProtocolField {
                field: "--scanner-findings".to_string(),
                reason: "is required when scanner findings are included".to_string(),
            }
        })?;
        references.push(bundle_artifact_reference_for_file(
            scanner_path,
            "scanner_finding_set",
            "scanner_finding_set",
            "manifest_entry:scanner_findings",
            "artifacts/scanner-findings.json",
        )?);
    }
    references.push(bundle_artifact_reference_for_file(
        &input.disclosure_policy_path,
        "disclosure_policy",
        "disclosure_policy",
        "manifest_entry:derived_artifacts",
        "artifacts/disclosure-policy.json",
    )?);
    references.push(bundle_artifact_reference_for_file(
        &input.manifest_path,
        "outbound_manifest",
        "outbound_manifest",
        "manifest_entry:derived_artifacts",
        "artifacts/outbound-manifest.json",
    )?);
    references.push(bundle_manifest_artifact_reference_for_bytes(
        approval_json,
        "customer_approval",
        "customer_approval",
        "manifest_entry:derived_artifacts",
        "customer-approval.json",
        "retained_review_artifact",
    )?);
    references.extend(source_derived_bundle_artifact_references(manifest)?);
    Ok(references)
}

fn validate_candidate_source_artifact_bindings(
    scanner: Option<&ScannerFindingSet>,
    bundle_artifacts: &[ArtifactReference],
) -> Result<(), BundlePrepareError> {
    let Some(scanner) = scanner else {
        return Ok(());
    };

    for candidate in &scanner.candidate_findings {
        let mut seen = BTreeSet::new();
        for source_ref in &candidate.source_artifact_refs {
            if !seen.insert(source_ref) {
                return Err(BundlePrepareError::InvalidProtocolField {
                    field: "scanner_finding_set.candidate_findings.source_artifact_refs"
                        .to_string(),
                    reason: format!(
                        "candidate {} repeats source artifact reference {source_ref}",
                        candidate.candidate_finding_id
                    ),
                });
            }
            let matches = bundle_artifacts
                .iter()
                .filter(|artifact| artifact.artifact_ref == *source_ref)
                .collect::<Vec<_>>();
            if matches.len() != 1
                || !matches!(
                    matches[0].artifact_type.as_str(),
                    "raw_snippet" | "targeted_file"
                )
            {
                return Err(BundlePrepareError::InvalidProtocolField {
                    field: "scanner_finding_set.candidate_findings.source_artifact_refs"
                        .to_string(),
                    reason: format!(
                        "candidate {} source artifact reference {source_ref} must resolve exactly once to a shipped raw_snippet or targeted_file",
                        candidate.candidate_finding_id
                    ),
                });
            }
        }
    }
    Ok(())
}

fn source_derived_bundle_artifact_references(
    manifest: &OutboundManifest,
) -> Result<Vec<ArtifactReference>, BundlePrepareError> {
    let source_artifacts = manifest
        .artifact_references
        .iter()
        .filter(|artifact| source_derived_manifest_artifact(artifact))
        .cloned()
        .collect::<Vec<_>>();

    if manifest_requires_materialized_source_artifacts(manifest) && source_artifacts.is_empty() {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.artifact_references".to_string(),
            reason: "source-derived evidence artifacts are required before bundle construction for finding-context or extended coverage modes; metadata-only bundle preparation is supported without source contents".to_string(),
        });
    }

    for artifact in &source_artifacts {
        validate_source_derived_artifact_reference(artifact)?;
    }

    Ok(source_artifacts
        .into_iter()
        .map(|mut artifact| {
            if let Some(content_path) = artifact.content_path.clone() {
                let file_name = source_artifact_file_name(&content_path)
                    .unwrap_or_else(|| slugify_identifier(&artifact.artifact_ref));
                artifact.content_path = Some(format!("artifacts/source-derived/{file_name}"));
                artifact.content_path_anchor = Some("bundle_source_derived_artifacts".to_string());
            }
            artifact
        })
        .collect())
}

fn bundle_artifact_reference_for_file(
    path: &Path,
    artifact_ref_suffix: &str,
    artifact_type: &str,
    manifest_entry_ref: &str,
    content_path: &str,
) -> Result<ArtifactReference, BundlePrepareError> {
    let bytes = fs::read(path).map_err(|error| BundlePrepareError::ArtifactReadFailed {
        artifact: "bundle artifact source",
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    bundle_manifest_artifact_reference_for_bytes(
        &bytes,
        artifact_ref_suffix,
        artifact_type,
        manifest_entry_ref,
        content_path,
        "retained_review_artifact",
    )
}

fn bundle_manifest_artifact_reference_for_bytes(
    bytes: &[u8],
    artifact_ref_suffix: &str,
    artifact_type: &str,
    manifest_entry_ref: &str,
    content_path: &str,
    source_derived_class: &str,
) -> Result<ArtifactReference, BundlePrepareError> {
    let size_bytes = bytes.len() as u64;
    validate_size_bytes_js_safe(size_bytes).map_err(|reason| {
        BundlePrepareError::InvalidProtocolField {
            field: format!("artifact_ref:{artifact_ref_suffix}.size_bytes"),
            reason,
        }
    })?;
    Ok(ArtifactReference {
        protocol_version: PROTOCOL_VERSION.to_string(),
        artifact_ref: format!("artifact_ref:{artifact_ref_suffix}"),
        artifact_type: artifact_type.to_string(),
        digest: sha256_id(bytes),
        size_bytes,
        source_derived_class: source_derived_class.to_string(),
        manifest_entry_ref: manifest_entry_ref.to_string(),
        media_type: Some("application/json".to_string()),
        content_path: Some(content_path.to_string()),
        content_path_anchor: Some("bundle_artifacts".to_string()),
        synthetic_markers: None,
    })
}

fn cleanup_intent_for_artifacts(artifacts: &[ArtifactReference]) -> Vec<CleanupIntent> {
    artifacts
        .iter()
        .filter(|artifact| {
            matches!(
                artifact.source_derived_class.as_str(),
                "transient_source_derived" | "customer_opt_in_retained_source"
            )
        })
        .map(|artifact| CleanupIntent {
            artifact_ref: artifact.artifact_ref.clone(),
            source_derived_class: artifact.source_derived_class.clone(),
            cleanup_state: "pending_local_cleanup".to_string(),
            cleanup_required: true,
            deletion_evidence_state: "pending".to_string(),
        })
        .collect()
}

fn source_derived_manifest_artifact(artifact: &ArtifactReference) -> bool {
    matches!(
        artifact.artifact_type.as_str(),
        "raw_snippet" | "targeted_file"
    ) && matches!(
        artifact.source_derived_class.as_str(),
        "transient_source_derived" | "customer_opt_in_retained_source"
    )
}

fn validate_source_derived_artifact_reference(
    artifact: &ArtifactReference,
) -> Result<(), BundlePrepareError> {
    let Some(content_path) = artifact.content_path.as_deref() else {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.artifact_references.content_path".to_string(),
            reason: format!(
                "{} must include content_path for source-derived bundle packaging",
                artifact.artifact_ref
            ),
        });
    };
    validate_relative_content_path(content_path)?;
    if artifact.digest.trim().is_empty() || artifact.size_bytes == 0 {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "manifest.artifact_references.digest".to_string(),
            reason: format!(
                "{} must include non-empty digest and size for source-derived bundle packaging",
                artifact.artifact_ref
            ),
        });
    }
    Ok(())
}

fn copy_manifest_source_derived_artifacts(
    bundle: &BundleManifest,
    manifest_path: &Path,
    artifact_dir: &Path,
) -> Result<(), BundlePrepareError> {
    let manifest: OutboundManifest = read_bundle_json_artifact("outbound manifest", manifest_path)?;
    let manifest_base = manifest_path.parent().unwrap_or_else(|| Path::new("."));
    let output_dir = artifact_dir.join("source-derived");
    let source_refs = manifest
        .artifact_references
        .iter()
        .filter(|artifact| source_derived_manifest_artifact(artifact))
        .collect::<Vec<_>>();
    let bundle_refs = bundle
        .artifact_references
        .iter()
        .filter(|artifact| source_derived_manifest_artifact(artifact))
        .collect::<Vec<_>>();

    if source_refs.len() != bundle_refs.len() {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "bundle.artifact_references".to_string(),
            reason: "source-derived bundle references must match outbound manifest references"
                .to_string(),
        });
    }

    for source_ref in source_refs {
        validate_source_derived_artifact_reference(source_ref)?;
        let content_path = source_ref.content_path.as_deref().ok_or_else(|| {
            BundlePrepareError::InvalidProtocolField {
                field: "manifest.artifact_references.content_path".to_string(),
                reason: format!("{} must include content_path", source_ref.artifact_ref),
            }
        })?;
        let source_path = resolve_content_path_under(manifest_base, content_path)?;
        let file_name = source_artifact_file_name(content_path)
            .unwrap_or_else(|| slugify_identifier(&source_ref.artifact_ref));
        let destination = output_dir.join(file_name);
        copy_bundle_artifact(&source_path, &destination)?;
        verify_artifact_file_matches(source_ref, &destination)?;
    }

    Ok(())
}

pub fn verify_bundle_manifest_artifacts(
    bundle: &BundleManifest,
    output_dir: &Path,
) -> Result<(), BundlePrepareError> {
    verify_bundle_artifact_copies(bundle, output_dir, &output_dir.join("artifacts"))
}

fn verify_bundle_artifact_copies(
    bundle: &BundleManifest,
    output_dir: &Path,
    artifact_dir: &Path,
) -> Result<(), BundlePrepareError> {
    for artifact in &bundle.artifact_references {
        let Some(content_path) = artifact.content_path.as_deref() else {
            continue;
        };
        let path = if let Some(relative) = content_path.strip_prefix("artifacts/") {
            resolve_content_path_under(artifact_dir, relative)?
        } else {
            resolve_content_path_under(output_dir, content_path)?
        };
        verify_artifact_file_matches(artifact, &path)?;
    }
    Ok(())
}

fn verify_artifact_file_matches(
    artifact: &ArtifactReference,
    path: &Path,
) -> Result<(), BundlePrepareError> {
    let bytes = fs::read(path).map_err(|error| BundlePrepareError::ArtifactReadFailed {
        artifact: "bundle artifact copy",
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let digest = sha256_id(&bytes);
    if digest != artifact.digest || bytes.len() as u64 != artifact.size_bytes {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "bundle.artifact_references".to_string(),
            reason: format!(
                "{} copied bytes do not match declared digest/size",
                artifact.artifact_ref
            ),
        });
    }
    Ok(())
}

fn remove_stale_signed_bundle_artifacts(output_dir: &Path) -> Result<(), BundlePrepareError> {
    for relative in [
        "bundle_manifest.json",
        "signature-envelope.bundle.json",
        "artifacts",
    ] {
        let path = output_dir.join(relative);
        // Use symlink_metadata so we can decide before following any symlink.
        // remove_dir_all follows symlinks and could delete files outside
        // output_dir if `artifacts/` were a symlink to another directory.
        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(BundlePrepareError::MetadataWriteFailed {
                    path: path.clone(),
                    reason: error.to_string(),
                });
            }
        };
        let file_type = meta.file_type();
        let result = if file_type.is_symlink() || file_type.is_file() {
            // Unlink symlink itself; do not follow.
            fs::remove_file(&path)
        } else if file_type.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            Ok(())
        };
        result.map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.clone(),
            reason: error.to_string(),
        })?;
    }
    Ok(())
}

struct PostApprovalFailureFromInputs<'a> {
    scope_path: &'a Path,
    scanner_path: Option<&'a Path>,
    policy_path: &'a Path,
    manifest_path: &'a Path,
    output_dir: &'a Path,
    approving_actor: Option<String>,
    approval_decision: ApprovalDecision,
    approval_confirmation: Option<String>,
    occurred_at: &'a str,
    run_nonce: Option<&'a str>,
    error: &'a BundlePrepareError,
    attempt_log_path: &'a Path,
}

struct PostApprovalFailureFromApproval<'a> {
    approval: &'a CustomerApproval,
    output_dir: &'a Path,
    occurred_at: &'a str,
    run_nonce: Option<&'a str>,
    stage: LocalRunnerStage,
    failure_code: &'a str,
    message: &'a str,
    attempt_log_path: &'a Path,
}

fn post_approval_failure_attempt_from_inputs(
    failure: PostApprovalFailureFromInputs<'_>,
) -> Result<LocalRunnerAttempt, BundlePrepareError> {
    let input = BundlePrepareInput {
        scope_path: failure.scope_path.to_path_buf(),
        scanner_findings_path: failure.scanner_path.map(Path::to_path_buf),
        disclosure_policy_path: failure.policy_path.to_path_buf(),
        manifest_path: failure.manifest_path.to_path_buf(),
        output_dir: failure.output_dir.to_path_buf(),
        approving_actor: failure.approving_actor,
        approval_decision: failure.approval_decision.clone(),
        approval_confirmation: failure.approval_confirmation.clone(),
        reused_approval: None,
        run_nonce: failure.run_nonce.map(ToOwned::to_owned),
        decided_at: failure.occurred_at.to_string(),
        created_at: failure.occurred_at.to_string(),
        signing_time: failure.occurred_at.to_string(),
    };
    let prepared_inputs = load_validated_bundle_inputs(&input)?;
    let manifest = prepared_inputs.manifest;
    let approved = failure.approval_decision == ApprovalDecision::Approve
        && failure.approval_confirmation.as_deref() == Some(manifest.manifest_id.as_str());
    if !approved {
        return Err(failure.error.clone());
    }
    let approval = customer_approval_for_manifest(
        &manifest,
        "approved",
        input.approving_actor.as_deref(),
        failure.occurred_at,
        failure.run_nonce,
    )?;
    let message = failure.error.to_string();
    let failure = PostApprovalFailureFromApproval {
        approval: &approval,
        output_dir: failure.output_dir,
        occurred_at: failure.occurred_at,
        run_nonce: failure.run_nonce,
        stage: stage_for_bundle_prepare_error(failure.error),
        failure_code: failure_code_for_bundle_prepare_error(failure.error),
        message: &message,
        attempt_log_path: failure.attempt_log_path,
    };
    post_approval_failure_attempt_from_approval(failure)
}

fn post_approval_failure_attempt_from_approval(
    failure: PostApprovalFailureFromApproval<'_>,
) -> Result<LocalRunnerAttempt, BundlePrepareError> {
    fs::create_dir_all(failure.output_dir).map_err(|error| {
        BundlePrepareError::MetadataWriteFailed {
            path: failure.output_dir.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    write_json_file(
        &failure.output_dir.join("customer-approval.json"),
        failure.approval,
    )?;
    remove_stale_signed_bundle_artifacts(failure.output_dir)?;
    let attempt = LocalRunnerAttempt {
        protocol_version: PROTOCOL_VERSION.to_string(),
        attempt_id: local_attempt_id(failure.stage, failure.occurred_at, failure.run_nonce),
        stage: failure.stage,
        outcome: LocalRunnerOutcome::Failed,
        review_state: ReviewState::ApprovedNoSignedBundle,
        approval_state: ApprovalState::Approved,
        bundle_state: LocalBundleState::FailedBeforeReady,
        remote_state: "not_submitted".to_string(),
        occurred_at: failure.occurred_at.to_string(),
        runner: RunnerMetadata {
            name: RUNNER_NAME.to_string(),
            version: runner_version().to_string(),
        },
        runner_trust: runner_trust_metadata(),
        identities: identities_from_approval_and_bundle(failure.approval, None),
        approval_metadata: Some(LocalApprovalMetadata {
            decision: failure.approval.decision.clone(),
            decided_at: failure.approval.decided_at.clone(),
            approving_actor: failure.approval.approving_actor.clone(),
        }),
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: Some(failure.stage),
            failure_code: Some(failure.failure_code.to_string()),
            message: format!(
                "{} No signed Evidence Bundle is ready.",
                privacy_safe_diagnostic_message(failure.message)
            ),
            retryable: true,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: "Preserved customer approval locally; rerun with explicit approval reuse or choose fresh approval after fixing the packaging/signing issue.".to_string(),
            local_artifact_paths: vec!["customer-approval.json".to_string()],
        },
        next_actions: vec![
            "rerun with explicit approval reuse".to_string(),
            "choose fresh approval".to_string(),
            "revise policy".to_string(),
            "export manifest".to_string(),
        ],
    };
    write_local_runner_attempt(failure.attempt_log_path, &attempt)?;
    Ok(attempt)
}

pub fn stage_for_bundle_prepare_error(error: &BundlePrepareError) -> LocalRunnerStage {
    match error {
        // Signing-envelope failures surface as InvalidProtocolField over the
        // signed_identity field emitted by signature_envelope_for_bundle.
        BundlePrepareError::InvalidProtocolField { field, .. }
            if field == "signed_identity"
                || field == "signature_envelope"
                || field.starts_with("signature") =>
        {
            LocalRunnerStage::BundleSigning
        }
        BundlePrepareError::InvalidProtocolField { field, reason }
            if field == "manifest.artifact_references"
                || field == "bundle.artifact_references"
                || reason.contains("source-derived evidence artifacts")
                || reason.contains("source-derived bundle") =>
        {
            LocalRunnerStage::BundlePackaging
        }
        BundlePrepareError::MetadataWriteFailed { .. } => LocalRunnerStage::BundlePackaging,
        _ => LocalRunnerStage::BundlePrepare,
    }
}

pub fn failure_code_for_bundle_prepare_error(error: &BundlePrepareError) -> &'static str {
    match error {
        BundlePrepareError::InvalidProtocolField { field, .. }
            if field == "signed_identity"
                || field == "signature_envelope"
                || field.starts_with("signature") =>
        {
            "bundle_signature_failed"
        }
        BundlePrepareError::InvalidProtocolField { field, reason }
            if field == "manifest.artifact_references"
                || field == "bundle.artifact_references"
                || reason.contains("source-derived evidence artifacts")
                || reason.contains("source-derived bundle") =>
        {
            "source_derived_artifact_missing"
        }
        BundlePrepareError::MetadataWriteFailed { .. } => "bundle_artifact_write_failed",
        BundlePrepareError::ArtifactReadFailed { .. } => "local_artifact_read_failed",
        BundlePrepareError::ArtifactParseFailed { .. } => "local_artifact_parse_failed",
        BundlePrepareError::InvalidProtocolField { .. } => "invalid_protocol_field",
    }
}

fn resolve_content_path_under(
    base: &Path,
    content_path: &str,
) -> Result<PathBuf, BundlePrepareError> {
    validate_relative_content_path(content_path)?;
    let candidate = base.join(content_path);
    let normalized_base = normalized_existing_path(base)?;
    let normalized_candidate = normalized_existing_path(&candidate)?;
    if !normalized_candidate.starts_with(&normalized_base) {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "artifact.content_path".to_string(),
            reason: format!("{content_path} escapes the expected artifact root"),
        });
    }
    Ok(normalized_candidate)
}

fn validate_relative_content_path(content_path: &str) -> Result<(), BundlePrepareError> {
    if content_path.trim().is_empty()
        || content_path.contains('\0')
        || content_path.contains('\\')
        || content_path.contains(':')
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "artifact.content_path".to_string(),
            reason:
                "must be a non-empty relative path without nulls, backslashes, or drive prefixes"
                    .to_string(),
        });
    }
    let path = Path::new(content_path);
    if path.is_absolute() {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "artifact.content_path".to_string(),
            reason: "must be relative".to_string(),
        });
    }
    for component in path.components() {
        match component {
            Component::Normal(_) => {}
            _ => {
                return Err(BundlePrepareError::InvalidProtocolField {
                    field: "artifact.content_path".to_string(),
                    reason: "must not contain root escapes, current-directory, or parent-directory components".to_string(),
                });
            }
        }
    }
    Ok(())
}

fn normalized_existing_path(path: &Path) -> Result<PathBuf, BundlePrepareError> {
    path.canonicalize()
        .map_err(|error| BundlePrepareError::ArtifactReadFailed {
            artifact: "artifact content path",
            path: path.to_path_buf(),
            reason: error.to_string(),
        })
}

fn source_artifact_file_name(content_path: &str) -> Option<String> {
    Path::new(content_path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
}

fn bundle_run_nonce(run_nonce: Option<&str>) -> String {
    run_nonce
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0);
            format!("local_run:{nanos}")
        })
}

fn signature_envelope_for_bundle(
    key: &keys::RunnerSigningKey,
    evidence_bundle_id: &str,
    signing_time: &str,
) -> Result<SignatureEnvelope, BundlePrepareError> {
    validate_bundle_sha256_id("signed_identity", evidence_bundle_id)?;
    keys::sign_bundle_identity(key, evidence_bundle_id, signing_time).map_err(|error| {
        BundlePrepareError::InvalidProtocolField {
            field: "signature_envelope".to_string(),
            reason: format!("runner signing failed: {error:?}"),
        }
    })
}

fn validate_customer_approval_metadata(
    approval: &CustomerApproval,
) -> Result<(), BundlePrepareError> {
    if approval.protocol_version != PROTOCOL_VERSION {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "approval.protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_bundle_sha256_id("approval.manifest_id", &approval.manifest_id)?;
    validate_bundle_timestamp("approval.decided_at", &approval.decided_at)?;
    if approval.displayed_context.manifest_id != approval.manifest_id {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "approval.displayed_context.manifest_id".to_string(),
            reason: "must match approval.manifest_id".to_string(),
        });
    }
    if approval.displayed_context.disclosure_warnings.is_empty() {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "approval.displayed_context.disclosure_warnings".to_string(),
            reason: "must include warnings shown before approval".to_string(),
        });
    }
    if approval.decision == "approved"
        && approval.warnings_acknowledged != approval.displayed_context.disclosure_warnings
    {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "approval.warnings_acknowledged".to_string(),
            reason: "approved decisions must acknowledge every warning displayed before approval"
                .to_string(),
        });
    }
    Ok(())
}

fn validate_bundle_manifest_metadata(bundle: &BundleManifest) -> Result<(), BundlePrepareError> {
    if bundle.protocol_version != PROTOCOL_VERSION {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "bundle.protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_bundle_sha256_id("evidence_bundle_id", &bundle.evidence_bundle_id)?;
    validate_bundle_sha256_id("manifest_id", &bundle.manifest_id)?;
    validate_bundle_timestamp("created_at", &bundle.created_at)?;
    if bundle.customer_approval_decision != "approved" || bundle.bundle_state != "not_submitted" {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "bundle_state".to_string(),
            reason: "must require approved customer approval and remain not_submitted".to_string(),
        });
    }
    if evidence_bundle_identity(bundle) != bundle.evidence_bundle_id {
        return Err(BundlePrepareError::InvalidProtocolField {
            field: "evidence_bundle_id".to_string(),
            reason: "must match canonical bundle manifest content excluding evidence_bundle_id"
                .to_string(),
        });
    }
    Ok(())
}

fn copy_bundle_artifact(source: &Path, destination: &Path) -> Result<(), BundlePrepareError> {
    if let Some(parent) = destination
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: destination.to_path_buf(),
            reason: error.to_string(),
        })?;
    }
    fs::copy(source, destination).map_err(|error| BundlePrepareError::MetadataWriteFailed {
        path: destination.to_path_buf(),
        reason: error.to_string(),
    })?;
    Ok(())
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), BundlePrepareError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).map_err(|error| BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|error| {
        BundlePrepareError::MetadataWriteFailed {
            path: path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    fs::write(path, format!("{json}\n")).map_err(|error| BundlePrepareError::MetadataWriteFailed {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })
}

fn json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, BundlePrepareError> {
    let json = serde_json::to_string_pretty(value).map_err(|error| {
        BundlePrepareError::InvalidProtocolField {
            field: "json".to_string(),
            reason: error.to_string(),
        }
    })?;
    Ok(format!("{json}\n").into_bytes())
}

fn deterministic_local_id(prefix: &str, parts: &[&str]) -> String {
    let input = parts.join("|");
    let digest = sha256_hex(input.as_bytes());
    format!("{prefix}:{}", &digest[..24])
}

fn bundle_error_from_manifest(error: ManifestPreviewError) -> BundlePrepareError {
    BundlePrepareError::InvalidProtocolField {
        field: "manifest_chain".to_string(),
        reason: error.to_string(),
    }
}

fn validate_bundle_sha256_id(field: &str, value: &str) -> Result<(), BundlePrepareError> {
    if is_sha256_id(value) {
        Ok(())
    } else {
        Err(BundlePrepareError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be sha256:<64 lowercase hex characters>".to_string(),
        })
    }
}

fn validate_bundle_timestamp(field: &str, value: &str) -> Result<(), BundlePrepareError> {
    if is_utc_rfc3339_timestamp(value) {
        Ok(())
    } else {
        Err(BundlePrepareError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00), e.g. 2026-07-10T00:00:00Z or 2026-07-10T00:00:00.123+00:00".to_string(),
        })
    }
}

#[derive(Debug, Clone)]
struct ParsedArtifact<T> {
    value: T,
    bytes: Vec<u8>,
}

fn read_json_artifact_with_bytes<T: DeserializeOwned>(
    artifact: &'static str,
    path: &Path,
) -> Result<ParsedArtifact<T>, ManifestPreviewError> {
    let bytes = fs::read(path).map_err(|error| ManifestPreviewError::ArtifactReadFailed {
        artifact,
        path: path.to_path_buf(),
        reason: error.to_string(),
    })?;
    let value = serde_json::from_slice(&bytes).map_err(|error| {
        ManifestPreviewError::ArtifactParseFailed {
            artifact,
            path: path.to_path_buf(),
            reason: error.to_string(),
        }
    })?;
    Ok(ParsedArtifact { value, bytes })
}

fn validate_review_scope_for_manifest(scope: &ReviewScope) -> Result<(), ManifestPreviewError> {
    if scope.protocol_version != PROTOCOL_VERSION {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_manifest_sha256_id("review_scope_id", &scope.review_scope_id)?;
    validate_review_id(&scope.review_id).map_err(|error| {
        ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.review_id".to_string(),
            reason: error.to_string(),
        }
    })?;
    validate_manifest_sha256_id("repository_identity", &scope.repository_identity)?;
    validate_commit_sha(&scope.selected_commit.commit_sha).map_err(|error| {
        ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.selected_commit.commit_sha".to_string(),
            reason: error.to_string(),
        }
    })?;
    if scope.selected_commit.source_control_system != "git" {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.selected_commit.source_control_system".to_string(),
            reason: "must be git".to_string(),
        });
    }
    if scope.runner.name != RUNNER_NAME || scope.runner.version.trim().is_empty() {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.runner".to_string(),
            reason: "runner name/version must identify the local runner".to_string(),
        });
    }
    // C8-03: caller-supplied review-scope JSON was previously chained into
    // manifest preview / bundle prepare / bundle status without checking these
    // schema-required fields, so a structurally-invalid (but syntactically
    // valid) review scope could still become a signed-bundle prerequisite.
    if !is_utc_rfc3339_timestamp(&scope.generated_at) {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.generated_at".to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00)".to_string(),
        });
    }
    if scope.technical_context.is_empty() {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.technical_context".to_string(),
            reason: "must contain at least one entry".to_string(),
        });
    }
    if scope.dependency_manifests.is_empty() {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.dependency_manifests".to_string(),
            reason: "must contain at least one entry".to_string(),
        });
    }
    Ok(())
}

// [C2-04] Loaded first-party artifacts (review scope, disclosure policy, scanner
// finding set) were previously trusted syntactically: only shape/cross-reference
// checks ran, never a recompute of the artifact's own id from its loaded content.
// A tampered artifact with a stale-but-syntactically-valid id could be accepted and
// chained into a new manifest/bundle that then looks internally consistent around a
// compromised upstream identity. These checks close that gap at the load boundary,
// mirroring the recompute-and-compare pattern already used for manifest_id/
// evidence_bundle_id.
fn validate_review_scope_matches_identity(scope: &ReviewScope) -> Result<(), ManifestPreviewError> {
    let expected = review_scope_identity_hash(
        &scope.generated_at,
        &scope.selected_application.application_id,
        &scope.selected_commit.commit_sha,
        &scope.repository_identity,
        &scope.review_id,
    );
    if expected != scope.review_scope_id {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "review_scope.review_scope_id".to_string(),
            reason: format!(
                "does not match canonical review scope identity input (expected {expected}, got {})",
                scope.review_scope_id
            ),
        });
    }
    Ok(())
}

fn validate_disclosure_policy_matches_identity(
    policy: &DisclosurePolicy,
) -> Result<(), ManifestPreviewError> {
    let expected = disclosure_policy_identity(policy);
    if expected != policy.disclosure_policy_id {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.disclosure_policy_id".to_string(),
            reason: format!(
                "does not match canonical disclosure policy content excluding disclosure_policy_id (expected {expected}, got {})",
                policy.disclosure_policy_id
            ),
        });
    }
    Ok(())
}

fn validate_scanner_finding_set_matches_identity(
    finding_set: &ScannerFindingSet,
) -> Result<(), ManifestPreviewError> {
    let expected = scanner_finding_set_identity(finding_set);
    if expected != finding_set.scanner_finding_set_id {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.scanner_finding_set_id".to_string(),
            reason: format!(
                "does not match canonical scanner finding set content (expected {expected}, got {})",
                finding_set.scanner_finding_set_id
            ),
        });
    }
    Ok(())
}

fn validate_disclosure_policy_for_manifest(
    policy: &DisclosurePolicy,
    expected_review_scope_ref: &str,
) -> Result<(), ManifestPreviewError> {
    let coverage_mode =
        CoverageMode::from_config_value(&policy.coverage_mode).map_err(|error| {
            ManifestPreviewError::InvalidProtocolField {
                field: "disclosure_policy.coverage_mode".to_string(),
                reason: error.to_string(),
            }
        })?;
    if coverage_mode.canonical_value() != policy.coverage_mode {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.coverage_mode".to_string(),
            reason: format!("{} is not a canonical coverage mode", policy.coverage_mode),
        });
    }
    validate_disclosure_policy_snippet_controls_for_manifest(policy, coverage_mode)?;
    validate_disclosure_policy_retention_for_manifest(policy)?;
    if policy.protocol_version != PROTOCOL_VERSION {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_manifest_sha256_id("disclosure_policy_id", &policy.disclosure_policy_id)?;
    validate_manifest_timestamp("disclosure_policy.created_at", &policy.created_at)?;
    validate_manifest_sha256_id(
        "disclosure_policy.review_scope_ref",
        &policy.review_scope_ref,
    )?;
    if policy.review_scope_ref != expected_review_scope_ref {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.review_scope_ref".to_string(),
            reason: format!(
                "{} does not match review scope {}",
                policy.review_scope_ref, expected_review_scope_ref
            ),
        });
    }
    if policy.include_scanner_findings {
        let Some(scanner_ref) = &policy.scanner_finding_set_ref else {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "disclosure_policy.scanner_finding_set_ref".to_string(),
                reason: "is required when scanner findings are included".to_string(),
            });
        };
        validate_manifest_sha256_id("disclosure_policy.scanner_finding_set_ref", scanner_ref)?;
    } else if policy.scanner_finding_set_ref.is_some() {
        // Story 1.7 review-fix (Decision 4): reject stale scanner_finding_set_ref
        // when the policy explicitly excludes scanner findings. Prior version
        // silently dropped the ref.
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.scanner_finding_set_ref".to_string(),
            reason:
                "must be null when include_scanner_findings is false; remove the stale ref or set include_scanner_findings to true"
                    .to_string(),
        });
    }
    if policy.redaction_policy.enabled {
        if policy.redaction_policy.profile.trim().is_empty()
            || policy
                .redaction_policy
                .configuration_version
                .trim()
                .is_empty()
            || policy.redaction_policy.configuration_version == "not_configured"
        {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "disclosure_policy.redaction_policy".to_string(),
                reason:
                    "configured redaction must include non-empty profile and configuration_version"
                        .to_string(),
            });
        }
        let limitation = policy.redaction_policy.limitation.to_ascii_lowercase();
        if !limitation.contains("cannot prove absence")
            && !limitation.contains("cannot prove the absence")
        {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "disclosure_policy.redaction_policy.limitation".to_string(),
                reason: "must state that secret detection cannot prove absence of secrets"
                    .to_string(),
            });
        }
    }
    if policy_category(policy, "metadata").is_err()
        || policy_category(policy, "dependencies").is_err()
        || policy_category(policy, "scanner_findings").is_err()
        || policy_category(policy, "raw_snippets").is_err()
        || policy_category(policy, "targeted_files").is_err()
        || policy_category(policy, "derived_artifacts").is_err()
        || policy_category(policy, "never_collected_items").is_err()
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.evidence_categories".to_string(),
            reason: "must include all required evidence categories".to_string(),
        });
    }
    let raw_snippets_included = policy_category(policy, "raw_snippets")
        .map(|category| category.included)
        .unwrap_or(false);
    if policy.snippet_policy.allow_raw_snippets != raw_snippets_included {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.snippet_policy.allow_raw_snippets".to_string(),
            reason:
                "must match evidence_categories.raw_snippets.included; policy is internally inconsistent"
                    .to_string(),
        });
    }
    let targeted_files_included = policy_category(policy, "targeted_files")
        .map(|category| category.included)
        .unwrap_or(false);
    let has_selected_areas = !policy.snippet_policy.selected_files_or_areas.is_empty();
    if has_selected_areas != targeted_files_included {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.snippet_policy.selected_files_or_areas".to_string(),
            reason:
                "must match evidence_categories.targeted_files.included; policy is internally inconsistent"
                    .to_string(),
        });
    }
    Ok(())
}

fn validate_disclosure_policy_snippet_controls_for_manifest(
    policy: &DisclosurePolicy,
    coverage_mode: CoverageMode,
) -> Result<(), ManifestPreviewError> {
    match coverage_mode {
        CoverageMode::MetadataOnly => {
            if policy.snippet_policy.allow_raw_snippets
                || policy.snippet_policy.max_snippet_chars != 0
                || policy.snippet_policy.context_lines != 0
                || !policy.snippet_policy.selected_files_or_areas.is_empty()
            {
                return Err(ManifestPreviewError::InvalidProtocolField {
                    field: "disclosure_policy.snippet_policy".to_string(),
                    reason: "metadata_only must not include Raw Snippets, snippet caps, context lines, or selected files".to_string(),
                });
            }
        }
        CoverageMode::FindingContextSnippets => {
            validate_manifest_snippet_bounds(policy)?;
            if !policy.snippet_policy.allow_raw_snippets {
                return Err(ManifestPreviewError::InvalidProtocolField {
                    field: "disclosure_policy.snippet_policy.allow_raw_snippets".to_string(),
                    reason: "finding_context_snippets requires capped Raw Snippets".to_string(),
                });
            }
            if !policy.snippet_policy.selected_files_or_areas.is_empty() {
                return Err(ManifestPreviewError::InvalidProtocolField {
                    field: "disclosure_policy.snippet_policy.selected_files_or_areas".to_string(),
                    reason: "selected files or areas require extended_approved_snippets_or_targeted_files".to_string(),
                });
            }
        }
        CoverageMode::ExtendedApprovedSnippetsOrTargetedFiles => {
            validate_manifest_snippet_bounds(policy)?;
            if !policy.snippet_policy.allow_raw_snippets {
                return Err(ManifestPreviewError::InvalidProtocolField {
                    field: "disclosure_policy.snippet_policy.allow_raw_snippets".to_string(),
                    reason: "extended mode requires Raw Snippet disclosure policy metadata"
                        .to_string(),
                });
            }
            if policy.snippet_policy.selected_files_or_areas.is_empty() {
                return Err(ManifestPreviewError::InvalidProtocolField {
                    field: "disclosure_policy.snippet_policy.selected_files_or_areas".to_string(),
                    reason: "extended mode requires at least one selected relative path or area reference".to_string(),
                });
            }
            for selected in &policy.snippet_policy.selected_files_or_areas {
                validate_selected_file_or_area(selected).map_err(|error| {
                    ManifestPreviewError::InvalidProtocolField {
                        field: "disclosure_policy.snippet_policy.selected_files_or_areas"
                            .to_string(),
                        reason: error.to_string(),
                    }
                })?;
            }
        }
    }
    Ok(())
}

fn validate_manifest_snippet_bounds(policy: &DisclosurePolicy) -> Result<(), ManifestPreviewError> {
    if policy.snippet_policy.max_snippet_chars == 0
        || policy.snippet_policy.max_snippet_chars > 2000
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.snippet_policy.max_snippet_chars".to_string(),
            reason: "must be between 1 and 2000 for snippet modes".to_string(),
        });
    }
    if policy.snippet_policy.context_lines > 10 {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.snippet_policy.context_lines".to_string(),
            reason: "must be at most 10".to_string(),
        });
    }
    Ok(())
}

fn validate_disclosure_policy_retention_for_manifest(
    policy: &DisclosurePolicy,
) -> Result<(), ManifestPreviewError> {
    let retained_source_requested = policy.retention_policy.raw_snippet_class
        == "customer_opt_in_retained_source"
        || policy.retention_policy.targeted_file_class == "customer_opt_in_retained_source";
    if retained_source_requested
        && (!policy.retention_policy.retain_source_opt_in
            || policy.retention_policy.retention_period == "not_applicable"
            || policy.retention_policy.retention_period.trim().is_empty())
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.retention_policy".to_string(),
            reason: "customer_opt_in_retained_source requires retain_source_opt_in=true and a defined retention_period".to_string(),
        });
    }
    Ok(())
}

fn validate_scanner_finding_set_for_manifest(
    scanner: &ScannerFindingSet,
    expected_review_scope_ref: &str,
    policy: &DisclosurePolicy,
) -> Result<(), ManifestPreviewError> {
    if scanner.protocol_version != PROTOCOL_VERSION {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_manifest_sha256_id("scanner_finding_set_id", &scanner.scanner_finding_set_id)?;
    validate_manifest_sha256_id(
        "scanner_finding_set.review_scope_ref",
        &scanner.review_scope_ref,
    )?;
    if scanner.review_scope_ref != expected_review_scope_ref {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.review_scope_ref".to_string(),
            reason: format!(
                "{} does not match review scope {}",
                scanner.review_scope_ref, expected_review_scope_ref
            ),
        });
    }
    if policy.include_scanner_findings
        && policy.scanner_finding_set_ref.as_deref() != Some(&scanner.scanner_finding_set_id)
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.scanner_finding_set_id".to_string(),
            reason: "does not match disclosure_policy.scanner_finding_set_ref".to_string(),
        });
    }
    for finding in &scanner.candidate_findings {
        if finding.status != "candidate" {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "scanner_finding_set.candidate_findings.status".to_string(),
                reason: "scanner findings must remain Candidate Findings only".to_string(),
            });
        }
    }
    // C8-03: see the matching comment on validate_review_scope_for_manifest —
    // these schema-required fields were not checked at the load boundary.
    if !is_utc_rfc3339_timestamp(&scanner.generated_at) {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.generated_at".to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00)".to_string(),
        });
    }
    if scanner.source_derived_class != "retained_review_artifact" {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.source_derived_class".to_string(),
            reason: "must be retained_review_artifact".to_string(),
        });
    }
    if scanner.scanner_runs.is_empty() {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "scanner_finding_set.scanner_runs".to_string(),
            reason: "must contain at least one entry".to_string(),
        });
    }
    for run in &scanner.scanner_runs {
        if !is_utc_rfc3339_timestamp(&run.executed_at) {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "scanner_finding_set.scanner_runs.executed_at".to_string(),
                reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00)"
                    .to_string(),
            });
        }
        if !matches!(run.scanner_name.as_str(), "regex" | "semgrep") {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "scanner_finding_set.scanner_runs.scanner_name".to_string(),
                reason: "must be regex or semgrep".to_string(),
            });
        }
        if !matches!(
            run.status.as_str(),
            "succeeded" | "no_findings" | "unavailable" | "failed" | "invalid_output" | "skipped"
        ) {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "scanner_finding_set.scanner_runs.status".to_string(),
                reason: "must be a known scanner run status".to_string(),
            });
        }
    }
    Ok(())
}

fn validate_outbound_manifest_metadata(
    manifest: &OutboundManifest,
) -> Result<(), ManifestPreviewError> {
    validate_outbound_manifest_body(manifest)?;
    validate_outbound_manifest_identity(manifest)
}

fn validate_outbound_manifest_body(
    manifest: &OutboundManifest,
) -> Result<(), ManifestPreviewError> {
    if manifest.protocol_version != PROTOCOL_VERSION {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    // Story 1.7 review-fix: enforce coverage_mode is canonical at manifest emit.
    if CoverageMode::from_config_value(&manifest.coverage_mode)
        .map(|mode| mode.canonical_value() != manifest.coverage_mode)
        .unwrap_or(true)
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "coverage_mode".to_string(),
            reason: format!(
                "{} is not a canonical coverage mode",
                manifest.coverage_mode
            ),
        });
    }
    validate_manifest_timestamp("generated_at", &manifest.generated_at)?;
    validate_manifest_sha256_id("review_scope_ref", &manifest.review_scope_ref)?;
    validate_manifest_sha256_id("disclosure_policy_ref", &manifest.disclosure_policy_ref)?;
    if let Some(scanner_ref) = &manifest.scanner_finding_set_ref {
        validate_manifest_sha256_id("scanner_finding_set_ref", scanner_ref)?;
    }
    if manifest
        .disclosure_policy_summary
        .redaction_profile
        .trim()
        .is_empty()
        || manifest
            .disclosure_policy_summary
            .redaction_configuration_version
            .trim()
            .is_empty()
        || manifest
            .disclosure_policy_summary
            .retention_period
            .trim()
            .is_empty()
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy_summary".to_string(),
            reason: "redaction and retention summary fields must be non-empty".to_string(),
        });
    }
    if manifest.disclosure_policy_summary.disclosure_policy_ref != manifest.disclosure_policy_ref {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy_summary.disclosure_policy_ref".to_string(),
            reason: "must match manifest.disclosure_policy_ref".to_string(),
        });
    }
    if manifest.disclosure_policy_summary.coverage_mode != manifest.coverage_mode {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy_summary.coverage_mode".to_string(),
            reason: "must match manifest.coverage_mode".to_string(),
        });
    }
    for category in &manifest.evidence_categories {
        if let Some(controls) = &category.snippet_controls
            && (controls.redaction_profile != manifest.disclosure_policy_summary.redaction_profile
                || controls.redaction_configuration_version
                    != manifest
                        .disclosure_policy_summary
                        .redaction_configuration_version)
        {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: "disclosure_policy_summary".to_string(),
                reason: "redaction summary must match source-disclosure snippet controls"
                    .to_string(),
            });
        }
    }
    for (label, entries) in [
        ("warnings", &manifest.warnings),
        ("limitations", &manifest.limitations),
    ] {
        if entries.iter().any(|entry| entry.trim().is_empty()) {
            return Err(ManifestPreviewError::InvalidProtocolField {
                field: label.to_string(),
                reason: format!("{label} entries must be non-empty"),
            });
        }
    }
    if manifest.package_preview_state.state != "preview_generated"
        || manifest.package_preview_state.send_ready
        || !manifest.package_preview_state.local_only
        || manifest.approval.approval_state != "not_requested"
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "package_preview_state".to_string(),
            reason: "must remain preview-only and not approved or send-ready".to_string(),
        });
    }
    let mut categories = BTreeSet::new();
    for category in &manifest.evidence_categories {
        categories.insert(category.category.as_str());
    }
    let required = [
        "metadata",
        "dependencies",
        "scanner_findings",
        "raw_snippets",
        "targeted_files",
        "derived_artifacts",
        "never_collected_items",
    ];
    if manifest.evidence_categories.len() != required.len()
        || required
            .iter()
            .any(|category| !categories.contains(category))
    {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "evidence_categories".to_string(),
            reason: "must contain each required category exactly once".to_string(),
        });
    }
    Ok(())
}

fn validate_outbound_manifest_identity(
    manifest: &OutboundManifest,
) -> Result<(), ManifestPreviewError> {
    validate_manifest_sha256_id("manifest_id", &manifest.manifest_id)?;
    let expected = outbound_manifest_identity(manifest);
    if manifest.manifest_id != expected {
        return Err(ManifestPreviewError::InvalidProtocolField {
            field: "manifest_id".to_string(),
            reason: format!(
                "must match canonical content excluding manifest_id: expected {expected}"
            ),
        });
    }
    Ok(())
}

fn manifest_artifact_references(
    input: &ManifestPreviewInput,
    policy: &DisclosurePolicy,
    scope_bytes: &[u8],
    scanner_bytes: Option<&[u8]>,
    policy_bytes: &[u8],
) -> Result<Vec<ArtifactReference>, ManifestPreviewError> {
    let mut references = vec![manifest_artifact_reference_for_bytes(
        &input.scope_path,
        scope_bytes,
        "review_scope",
        "review_scope",
        "manifest_entry:metadata",
    )?];
    if policy.include_scanner_findings {
        let Some(scanner_path) = &input.scanner_findings_path else {
            return Err(ManifestPreviewError::ScannerFindingSetRequired);
        };
        let Some(scanner_bytes) = scanner_bytes else {
            return Err(ManifestPreviewError::ScannerFindingSetRequired);
        };
        references.push(manifest_artifact_reference_for_bytes(
            scanner_path,
            scanner_bytes,
            "scanner_finding_set",
            "scanner_finding_set",
            "manifest_entry:scanner_findings",
        )?);
    }
    references.push(manifest_artifact_reference_for_bytes(
        &input.disclosure_policy_path,
        policy_bytes,
        "disclosure_policy",
        "disclosure_policy",
        "manifest_entry:derived_artifacts",
    )?);
    Ok(references)
}

fn manifest_content_path_for_artifact(artifact_type: &str) -> &'static str {
    match artifact_type {
        "review_scope" => "artifacts/review-scope.json",
        "scanner_finding_set" => "artifacts/scanner-findings.json",
        "disclosure_policy" => "artifacts/disclosure-policy.json",
        "outbound_manifest" => "artifacts/outbound-manifest.json",
        "customer_approval" => "artifacts/customer-approval.json",
        _ => "artifacts/protocol-artifact.json",
    }
}

fn manifest_artifact_reference_for_bytes(
    _path: &Path,
    bytes: &[u8],
    artifact_ref_suffix: &str,
    artifact_type: &str,
    manifest_entry_ref: &str,
) -> Result<ArtifactReference, ManifestPreviewError> {
    let size_bytes = bytes.len() as u64;
    validate_size_bytes_js_safe(size_bytes).map_err(|reason| {
        ManifestPreviewError::InvalidProtocolField {
            field: format!("artifact_ref:{artifact_ref_suffix}.size_bytes"),
            reason,
        }
    })?;
    Ok(ArtifactReference {
        protocol_version: PROTOCOL_VERSION.to_string(),
        artifact_ref: format!("artifact_ref:{artifact_ref_suffix}"),
        artifact_type: artifact_type.to_string(),
        digest: sha256_id(bytes),
        size_bytes,
        source_derived_class: "retained_review_artifact".to_string(),
        manifest_entry_ref: manifest_entry_ref.to_string(),
        media_type: Some("application/json".to_string()),
        content_path: Some(manifest_content_path_for_artifact(artifact_type).to_string()),
        content_path_anchor: Some("manifest_artifacts".to_string()),
        synthetic_markers: None,
    })
}

fn manifest_evidence_categories(
    scope: &ReviewScope,
    scanner: Option<&ScannerFindingSet>,
    policy: &DisclosurePolicy,
) -> Result<Vec<ManifestEvidenceCategory>, ManifestPreviewError> {
    let dependency_count = scope
        .dependency_manifests
        .iter()
        .filter(|manifest| manifest.status == "detected")
        .count();
    let candidate_count = scanner
        .map(|scanner| scanner.candidate_findings.len())
        .unwrap_or(0);
    let selected_files_or_areas = policy.snippet_policy.selected_files_or_areas.clone();
    let raw_count = if policy.snippet_policy.allow_raw_snippets {
        candidate_count
    } else {
        0
    };
    let targeted_count = if policy_category(policy, "targeted_files")?.included {
        selected_files_or_areas.len()
    } else {
        0
    };

    Ok(vec![
        manifest_category_from_policy(ManifestCategoryBuild {
            policy_category: policy_category(policy, "metadata")?,
            count: 1,
            reference: "review_scope_ref",
            source_code_disclosure: false,
            limitation: "Review scope metadata is included; source contents are not included by this category.",
            details: vec!["Selected application, selected commit, repository identity hash, runner metadata, and technical context are included.".to_string()],
            snippet_controls: None,
        }, policy),
        manifest_category_from_policy(ManifestCategoryBuild {
            policy_category: policy_category(policy, "dependencies")?,
            count: dependency_count,
            reference: "review_scope.dependency_manifests",
            source_code_disclosure: false,
            limitation: "Dependency names and manifest metadata are included; lockfile expansion may be unsupported.",
            details: vec![format!("Detected dependency manifest metadata is represented by count and reference: {dependency_count} detected of {} total dependency manifest slots.", scope.dependency_manifests.len())],
            snippet_controls: None,
        }, policy),
        manifest_category_from_policy(ManifestCategoryBuild {
            policy_category: policy_category(policy, "scanner_findings")?,
            count: candidate_count,
            reference: "scanner_finding_set_ref",
            source_code_disclosure: false,
            limitation: "Candidate Findings are scanner output only and are not expert review findings.",
            details: vec!["Candidate Finding identifiers, affected areas, rules, severity, confidence, and scanner run metadata are included.".to_string()],
            snippet_controls: None,
        }, policy),
        manifest_category_from_policy(ManifestCategoryBuild {
            policy_category: policy_category(policy, "raw_snippets")?,
            count: raw_count,
            reference: if policy.snippet_policy.allow_raw_snippets {
                "planned_finding_context_snippets"
            } else {
                "not_included_by_policy"
            },
            source_code_disclosure: policy.snippet_policy.allow_raw_snippets,
            limitation: &raw_snippet_limitation(policy),
            details: raw_snippet_details(policy),
            snippet_controls: if policy.snippet_policy.allow_raw_snippets {
                Some(snippet_controls(
                    policy,
                    policy.retention_policy.raw_snippet_class.clone(),
                    Vec::new(),
                ))
            } else {
                None
            },
        }, policy),
        manifest_category_from_policy(ManifestCategoryBuild {
            policy_category: policy_category(policy, "targeted_files")?,
            count: targeted_count,
            reference: if targeted_count > 0 {
                "selected_files_or_areas"
            } else {
                "not_included_by_policy"
            },
            source_code_disclosure: targeted_count > 0,
            limitation: &targeted_files_limitation(policy),
            details: targeted_files_details(policy),
            snippet_controls: if targeted_count > 0 {
                Some(snippet_controls(
                    policy,
                    policy.retention_policy.targeted_file_class.clone(),
                    selected_files_or_areas,
                ))
            } else {
                None
            },
        }, policy),
        {
            let derived_reference: &str = if policy.include_scanner_findings {
                "review_scope_ref, scanner_finding_set_ref, disclosure_policy_ref, outbound_manifest_preview"
            } else {
                "review_scope_ref, disclosure_policy_ref, outbound_manifest_preview"
            };
            let derived_count = derived_reference.split(',').count();
            manifest_category_from_policy(ManifestCategoryBuild {
                policy_category: policy_category(policy, "derived_artifacts")?,
                count: derived_count,
                reference: derived_reference,
                source_code_disclosure: false,
                limitation: "Derived artifacts describe local protocol metadata and preview state, not a final evidence bundle.",
                details: vec!["Review scope, scanner finding set when included, Disclosure Policy, and outbound manifest metadata are represented.".to_string()],
                snippet_controls: None,
            }, policy)
        },
        ManifestEvidenceCategory {
            category: "never_collected_items".to_string(),
            included: false,
            inclusion_state: "never_collected".to_string(),
            count: 5,
            reference: "data_minimization_boundary".to_string(),
            source_derived_class: "never_collected".to_string(),
            source_code_disclosure: false,
            redaction_state: "not_applicable".to_string(),
            redaction_configuration_version: "not_applicable".to_string(),
            retention_handling: "complete repository archives and non-selected files are not collected".to_string(),
            limitation: "Data minimization boundary is explicit before approval or transmission.".to_string(),
            details: vec![
                "complete repository archive".to_string(),
                "full Git history".to_string(),
                "unapproved source files".to_string(),
                "unapproved Raw Snippets".to_string(),
                "local environment secrets".to_string(),
            ],
            snippet_controls: None,
        },
    ])
}

struct ManifestCategoryBuild<'a> {
    policy_category: &'a DisclosureEvidenceCategory,
    count: usize,
    reference: &'a str,
    source_code_disclosure: bool,
    limitation: &'a str,
    details: Vec<String>,
    snippet_controls: Option<ManifestSnippetControls>,
}

fn manifest_category_from_policy(
    build: ManifestCategoryBuild<'_>,
    policy: &DisclosurePolicy,
) -> ManifestEvidenceCategory {
    let policy_category = build.policy_category;
    let (redaction_state, redaction_configuration_version) = redaction_state_for_manifest(
        build.source_code_disclosure && policy_category.included,
        policy,
    );
    ManifestEvidenceCategory {
        category: policy_category.category.clone(),
        included: policy_category.included,
        inclusion_state: if policy_category.included {
            "included".to_string()
        } else {
            "excluded_by_policy".to_string()
        },
        count: if policy_category.included {
            build.count
        } else {
            0
        },
        reference: build.reference.to_string(),
        source_derived_class: policy_category.source_derived_class.clone(),
        source_code_disclosure: build.source_code_disclosure && policy_category.included,
        redaction_state,
        redaction_configuration_version,
        retention_handling: policy_category.retention_handling.clone(),
        limitation: build.limitation.to_string(),
        details: build.details,
        snippet_controls: build.snippet_controls,
    }
}

fn redaction_state_for_manifest(
    source_code_category_included: bool,
    policy: &DisclosurePolicy,
) -> (String, String) {
    if !source_code_category_included {
        return ("not_applicable".to_string(), "not_applicable".to_string());
    }
    if policy.redaction_policy.enabled {
        (
            "redaction_configured".to_string(),
            policy.redaction_policy.configuration_version.clone(),
        )
    } else {
        (
            "redaction_not_configured".to_string(),
            "not_configured".to_string(),
        )
    }
}

fn snippet_controls(
    policy: &DisclosurePolicy,
    retention_class: String,
    selected_files_or_areas: Vec<String>,
) -> ManifestSnippetControls {
    ManifestSnippetControls {
        max_snippet_chars: policy.snippet_policy.max_snippet_chars,
        context_lines: policy.snippet_policy.context_lines,
        redaction_profile: policy.redaction_policy.profile.clone(),
        redaction_configuration_version: policy.redaction_policy.configuration_version.clone(),
        retention_class,
        selected_files_or_areas,
    }
}

fn raw_snippet_limitation(policy: &DisclosurePolicy) -> String {
    if !policy.snippet_policy.allow_raw_snippets {
        return "Raw Snippets are not included by the Disclosure Policy.".to_string();
    }
    if policy.redaction_policy.enabled {
        "Raw Snippets are source-code disclosure; redaction configuration is recorded, and secret detection cannot prove absence of secrets.".to_string()
    } else {
        "Raw Snippets are source-code disclosure; no redaction is configured and source contents are not read by manifest preview.".to_string()
    }
}

fn raw_snippet_details(policy: &DisclosurePolicy) -> Vec<String> {
    if !policy.snippet_policy.allow_raw_snippets {
        return vec!["Raw Snippets are not provided.".to_string()];
    }
    vec![
        "Source-code disclosure label: Raw Snippets.".to_string(),
        "Preview records planned snippet metadata only; no snippet source contents are included."
            .to_string(),
        format!(
            "Snippet cap is {} characters with {} context lines.",
            policy.snippet_policy.max_snippet_chars, policy.snippet_policy.context_lines
        ),
        format!(
            "Redaction profile {} version {} is recorded; secret detection cannot prove absence of secrets.",
            policy.redaction_policy.profile, policy.redaction_policy.configuration_version
        ),
    ]
}

fn targeted_files_limitation(policy: &DisclosurePolicy) -> String {
    if policy.snippet_policy.selected_files_or_areas.is_empty() {
        return "Targeted files are excluded by this Coverage Mode or Disclosure Policy."
            .to_string();
    }
    if policy.redaction_policy.enabled {
        "Targeted files or areas are source-code disclosure; selected references and redaction configuration are recorded, and secret detection cannot prove absence of secrets.".to_string()
    } else {
        "Targeted files or areas are source-code disclosure; selected references are recorded without reading file contents.".to_string()
    }
}

fn targeted_files_details(policy: &DisclosurePolicy) -> Vec<String> {
    if policy.snippet_policy.selected_files_or_areas.is_empty() {
        return vec!["No selected files or area references are included.".to_string()];
    }
    let mut details = vec![
        "Source-code disclosure label: targeted files or areas.".to_string(),
        "Preview records selected references only; file contents are not read.".to_string(),
        format!(
            "Snippet cap is {} characters with {} context lines.",
            policy.snippet_policy.max_snippet_chars, policy.snippet_policy.context_lines
        ),
    ];
    details.extend(
        policy
            .snippet_policy
            .selected_files_or_areas
            .iter()
            .map(|selected| format!("selected: {selected}")),
    );
    details
}

fn manifest_warnings(policy: &DisclosurePolicy) -> Vec<String> {
    let mut warnings =
        vec!["Manifest preview is local-only and does not transmit evidence.".to_string()];
    for warning in &policy.warnings {
        if !warning.trim().is_empty() {
            insert_unique(&mut warnings, warning.clone());
        }
    }
    if policy.coverage_mode == "metadata_only" {
        insert_unique(
            &mut warnings,
            "Metadata-only mode may mean expert confidence may be lower.".to_string(),
        );
        insert_unique(
            &mut warnings,
            "Manifest records that snippets were not provided.".to_string(),
        );
    }
    if policy.coverage_mode == "extended_approved_snippets_or_targeted_files" {
        insert_unique(
            &mut warnings,
            "Extended mode broadens source-code disclosure beyond finding context; review approved snippets and selected files carefully."
                .to_string(),
        );
    }
    if policy.snippet_policy.allow_raw_snippets {
        insert_unique(
            &mut warnings,
            "Raw Snippets are source-code disclosure even when capped or redaction is configured."
                .to_string(),
        );
    }
    if !policy.snippet_policy.selected_files_or_areas.is_empty() {
        insert_unique(
            &mut warnings,
            "Targeted files or areas are source-code disclosure when included.".to_string(),
        );
    }
    if policy.redaction_policy.enabled {
        let limitation = policy.redaction_policy.limitation.clone();
        if !limitation.trim().is_empty() {
            insert_unique(&mut warnings, limitation);
        }
    }
    warnings
}

fn manifest_limitations(policy: &DisclosurePolicy) -> Vec<String> {
    let mut limitations = vec![
        "Preview records manifest metadata only; it is not a final evidence bundle.".to_string(),
        "No complete repository archive is collected or represented.".to_string(),
    ];
    for limitation in &policy.limitations {
        if !limitation.trim().is_empty() {
            insert_unique(&mut limitations, limitation.clone());
        }
    }
    if policy.include_scanner_findings {
        insert_unique(
            &mut limitations,
            "Candidate Findings are scanner output only, not review findings.".to_string(),
        );
    }
    if policy.coverage_mode == "metadata_only" {
        insert_unique(
            &mut limitations,
            "Raw Snippets and targeted files were not provided.".to_string(),
        );
    }
    limitations
}

fn policy_category<'a>(
    policy: &'a DisclosurePolicy,
    name: &str,
) -> Result<&'a DisclosureEvidenceCategory, ManifestPreviewError> {
    policy
        .evidence_categories
        .iter()
        .find(|category| category.category == name)
        .ok_or_else(|| ManifestPreviewError::InvalidProtocolField {
            field: "disclosure_policy.evidence_categories".to_string(),
            reason: format!("missing category {name}"),
        })
}

pub fn outbound_manifest_identity(manifest: &OutboundManifest) -> String {
    let value = serde_json::to_value(manifest).unwrap_or(serde_json::Value::Null);
    let identity_input = match value {
        serde_json::Value::Object(mut map) => {
            map.remove("manifest_id");
            serde_json::Value::Object(map)
        }
        other => other,
    };
    let canonical = canonicalize_json_value(&identity_input);
    sha256_id(canonical.as_bytes())
}

fn validate_manifest_sha256_id(field: &str, value: &str) -> Result<(), ManifestPreviewError> {
    if is_sha256_id(value) {
        Ok(())
    } else {
        Err(ManifestPreviewError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be sha256:<64 lowercase hex characters>".to_string(),
        })
    }
}

fn validate_manifest_timestamp(field: &str, value: &str) -> Result<(), ManifestPreviewError> {
    if is_utc_rfc3339_timestamp(value) {
        Ok(())
    } else {
        Err(ManifestPreviewError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00), e.g. 2026-07-08T00:00:00Z or 2026-07-08T00:00:00.123+00:00".to_string(),
        })
    }
}

fn disclosure_mode_settings(
    coverage_mode: CoverageMode,
    config: &DisclosurePolicyConfig,
) -> Result<DisclosureModeSettings, DisclosureError> {
    match coverage_mode {
        CoverageMode::MetadataOnly => {
            if config.include_raw_snippets.unwrap_or(false)
                || config.include_targeted_files.unwrap_or(false)
                || config.max_snippet_chars.unwrap_or(0) > 0
                || config.context_lines.unwrap_or(0) > 0
                || !config.selected_files_or_areas.is_empty()
            {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "coverage_mode".to_string(),
                    reason: "metadata_only must not include Raw Snippets, targeted files, snippet caps, or selected files".to_string(),
                });
            }
            Ok(DisclosureModeSettings {
                allow_raw_snippets: false,
                include_targeted_files: false,
                max_snippet_chars: 0,
                context_lines: 0,
                selection_behavior: "none".to_string(),
                selected_files_or_areas: Vec::new(),
            })
        }
        CoverageMode::FindingContextSnippets => {
            if config.include_raw_snippets == Some(false) {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "include_raw_snippets".to_string(),
                    reason: "finding_context_snippets requires capped Raw Snippets".to_string(),
                });
            }
            if config.include_targeted_files.unwrap_or(false)
                || !config.selected_files_or_areas.is_empty()
            {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "selected_files_or_areas".to_string(),
                    reason: "finding_context_snippets records finding context only; selected files or areas require extended mode".to_string(),
                });
            }
            Ok(DisclosureModeSettings {
                allow_raw_snippets: true,
                include_targeted_files: false,
                max_snippet_chars: positive_snippet_chars(
                    config.max_snippet_chars,
                    DEFAULT_SNIPPET_CHARS,
                )?,
                context_lines: bounded_context_lines(config.context_lines, DEFAULT_CONTEXT_LINES)?,
                selection_behavior: "finding_context".to_string(),
                selected_files_or_areas: Vec::new(),
            })
        }
        CoverageMode::ExtendedApprovedSnippetsOrTargetedFiles => {
            if config.include_raw_snippets == Some(false) {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "include_raw_snippets".to_string(),
                    reason: "extended mode requires Raw Snippet disclosure policy metadata"
                        .to_string(),
                });
            }
            if config.include_targeted_files == Some(false) {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "include_targeted_files".to_string(),
                    reason: "extended mode requires selected targeted files or areas".to_string(),
                });
            }
            if config.selected_files_or_areas.is_empty() {
                return Err(DisclosureError::InvalidPolicyConfig {
                    field: "selected_files_or_areas".to_string(),
                    reason: "extended mode requires at least one selected relative path or area reference".to_string(),
                });
            }
            let selected_files_or_areas = config
                .selected_files_or_areas
                .iter()
                .map(|value| validate_selected_file_or_area(value))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(DisclosureModeSettings {
                allow_raw_snippets: true,
                include_targeted_files: true,
                max_snippet_chars: positive_snippet_chars(
                    config.max_snippet_chars,
                    EXTENDED_DEFAULT_SNIPPET_CHARS,
                )?,
                context_lines: bounded_context_lines(
                    config.context_lines,
                    EXTENDED_DEFAULT_CONTEXT_LINES,
                )?,
                selection_behavior: "extended_selected_files_or_areas".to_string(),
                selected_files_or_areas,
            })
        }
    }
}

fn disclosure_redaction_policy(
    config: Option<&DisclosureRedactionConfig>,
) -> Result<DisclosureRedactionPolicy, DisclosureError> {
    let enabled = config.map(|config| config.enabled).unwrap_or(false);
    let profile = match config.and_then(|config| config.profile.as_deref()) {
        Some(value) => non_empty_config_value("redaction.profile", value)?,
        None if enabled => "default-local-redaction".to_string(),
        None => "not_configured".to_string(),
    };
    let configuration_version =
        match config.and_then(|config| config.configuration_version.as_deref()) {
            Some(value) => non_empty_config_value("redaction.configuration_version", value)?,
            None if enabled => format!("default-local-redaction-{}", runner_version()),
            None => "not_configured".to_string(),
        };
    let limitation = if enabled {
        "Redaction reduces exposure but secret detection cannot prove absence of secrets."
            .to_string()
    } else {
        "Redaction is not configured for source-derived evidence.".to_string()
    };
    Ok(DisclosureRedactionPolicy {
        enabled,
        profile,
        configuration_version,
        limitation,
    })
}

fn disclosure_retention_policy(
    config: Option<&DisclosureRetentionConfig>,
) -> Result<DisclosureRetentionPolicy, DisclosureError> {
    let raw_snippet_class = retention_class(
        "retention.raw_snippet_class",
        config.and_then(|config| config.raw_snippet_class.as_deref()),
    )?;
    let targeted_file_class = retention_class(
        "retention.targeted_file_class",
        config.and_then(|config| config.targeted_file_class.as_deref()),
    )?;
    let retain_source_opt_in = config
        .and_then(|config| config.retain_source_opt_in)
        .unwrap_or(false);
    let retention_period = match config.and_then(|config| config.retention_period.as_deref()) {
        Some(value) => non_empty_config_value("retention.retention_period", value)?,
        None => "not_applicable".to_string(),
    };
    if [raw_snippet_class.as_str(), targeted_file_class.as_str()]
        .contains(&"customer_opt_in_retained_source")
        && (!retain_source_opt_in || retention_period == "not_applicable")
    {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "retention".to_string(),
            reason: "customer_opt_in_retained_source requires retain_source_opt_in=true and a defined retention_period".to_string(),
        });
    }
    Ok(DisclosureRetentionPolicy {
        raw_snippet_class,
        targeted_file_class,
        retain_source_opt_in,
        retention_period,
    })
}

fn validate_retention_for_mode(
    mode_settings: &DisclosureModeSettings,
    retention_policy: &DisclosureRetentionPolicy,
) -> Result<(), DisclosureError> {
    if mode_settings.allow_raw_snippets
        && !allowed_source_retention_class(&retention_policy.raw_snippet_class)
    {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "retention.raw_snippet_class".to_string(),
            reason: "Raw Snippets default to transient_source_derived; retained source requires explicit customer opt-in".to_string(),
        });
    }
    if mode_settings.include_targeted_files
        && !allowed_source_retention_class(&retention_policy.targeted_file_class)
    {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "retention.targeted_file_class".to_string(),
            reason: "targeted files default to transient_source_derived; retained source requires explicit customer opt-in".to_string(),
        });
    }
    Ok(())
}

fn disclosure_evidence_categories(
    include_metadata: bool,
    include_dependency_information: bool,
    include_scanner_findings: bool,
    mode_settings: &DisclosureModeSettings,
    retention_policy: &DisclosureRetentionPolicy,
) -> Vec<DisclosureEvidenceCategory> {
    vec![
        evidence_category(
            "metadata",
            include_metadata,
            included_class(include_metadata),
            if include_metadata {
                "retained review metadata"
            } else {
                "metadata is not included"
            },
            None,
        ),
        evidence_category(
            "dependencies",
            include_dependency_information,
            included_class(include_dependency_information),
            if include_dependency_information {
                "retained dependency metadata"
            } else {
                "dependency metadata is not included"
            },
            None,
        ),
        evidence_category(
            "scanner_findings",
            include_scanner_findings,
            included_class(include_scanner_findings),
            if include_scanner_findings {
                "retained Candidate Findings only"
            } else {
                "scanner findings are not included"
            },
            None,
        ),
        evidence_category(
            "raw_snippets",
            mode_settings.allow_raw_snippets,
            if mode_settings.allow_raw_snippets {
                &retention_policy.raw_snippet_class
            } else {
                "never_collected"
            },
            if mode_settings.allow_raw_snippets {
                "source-derived Raw Snippet metadata only; content is not read by this command"
            } else {
                "Raw Snippets are not collected"
            },
            None,
        ),
        evidence_category(
            "targeted_files",
            mode_settings.include_targeted_files,
            if mode_settings.include_targeted_files {
                &retention_policy.targeted_file_class
            } else {
                "never_collected"
            },
            if mode_settings.include_targeted_files {
                "selected file or area references only; file contents are not read by this command"
            } else {
                "targeted files are not collected"
            },
            None,
        ),
        evidence_category(
            "derived_artifacts",
            true,
            "retained_review_artifact",
            "retained derived policy metadata",
            None,
        ),
        evidence_category(
            "never_collected_items",
            false,
            "never_collected",
            "complete repository archives and non-selected files are not collected",
            Some("Disclosure configure records policy metadata only."),
        ),
    ]
}

fn disclosure_warnings(coverage_mode: CoverageMode) -> Vec<String> {
    match coverage_mode {
        CoverageMode::MetadataOnly => vec![
            "Metadata-only mode may mean expert confidence may be lower.".to_string(),
            "Final downstream review materials must state snippets were not provided.".to_string(),
        ],
        CoverageMode::FindingContextSnippets => vec![
            "Finding-context snippets are Raw Snippets and remain source-code disclosure even when capped or redacted.".to_string(),
        ],
        CoverageMode::ExtendedApprovedSnippetsOrTargetedFiles => vec![
            "Extended approved snippets or targeted files may improve review confidence but increases disclosure.".to_string(),
        ],
    }
}

fn disclosure_limitations(
    include_scanner_findings: bool,
    redaction_policy: &DisclosureRedactionPolicy,
) -> Vec<String> {
    let mut limitations = vec![
        "No complete repository archive is collected by disclosure configure.".to_string(),
        "Disclosure configure records policy metadata only; it does not read Raw Snippet or targeted file contents.".to_string(),
    ];
    if include_scanner_findings {
        limitations.push(
            "Scanner findings remain Candidate Findings only; this policy does not create review findings."
                .to_string(),
        );
    }
    if redaction_policy.enabled {
        limitations.push(redaction_policy.limitation.clone());
    }
    limitations
}

fn evidence_category(
    category: &str,
    included: bool,
    source_derived_class: &str,
    retention_handling: &str,
    limitation: Option<&str>,
) -> DisclosureEvidenceCategory {
    DisclosureEvidenceCategory {
        category: category.to_string(),
        included,
        source_derived_class: source_derived_class.to_string(),
        retention_handling: retention_handling.to_string(),
        limitation: limitation.map(ToOwned::to_owned),
    }
}

fn included_class(included: bool) -> &'static str {
    if included {
        "retained_review_artifact"
    } else {
        "never_collected"
    }
}

fn positive_snippet_chars(value: Option<u32>, default: u32) -> Result<u32, DisclosureError> {
    let value = value.unwrap_or(default);
    if value == 0 || value > 2000 {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "max_snippet_chars".to_string(),
            reason: "must be between 1 and 2000 for snippet modes".to_string(),
        });
    }
    Ok(value)
}

fn bounded_context_lines(value: Option<u32>, default: u32) -> Result<u32, DisclosureError> {
    let value = value.unwrap_or(default);
    if value > 10 {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "context_lines".to_string(),
            reason: "must be at most 10".to_string(),
        });
    }
    Ok(value)
}

fn validate_selected_file_or_area(value: &str) -> Result<String, DisclosureError> {
    let trimmed = non_empty_config_value("selected_files_or_areas", value)?;
    if trimmed.contains('\0') {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "selected_files_or_areas".to_string(),
            reason: "must not contain null bytes".to_string(),
        });
    }
    if let Some(area) = trimmed.strip_prefix("area:") {
        let area = area.trim();
        if area.is_empty() || area.contains("..") || area.contains('\0') {
            return Err(DisclosureError::InvalidPolicyConfig {
                field: "selected_files_or_areas".to_string(),
                reason: "area references must be non-empty and must not contain traversal markers"
                    .to_string(),
            });
        }
        return Ok(format!("area:{area}"));
    }

    let normalized = trimmed.replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = normalized.as_bytes()[0];
        if drive.is_ascii_alphabetic() {
            return Err(DisclosureError::InvalidPolicyConfig {
                field: "selected_files_or_areas".to_string(),
                reason: "selected paths must not use Windows drive prefixes".to_string(),
            });
        }
    }
    let path = Path::new(&normalized);
    if path.is_absolute()
        || normalized.starts_with('/')
        || normalized.split('/').any(|segment| {
            segment.is_empty() || segment == "." || segment == ".." || segment.contains('\0')
        })
    {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: "selected_files_or_areas".to_string(),
            reason:
                "selected paths must be relative and must not contain root escapes or traversal"
                    .to_string(),
        });
    }
    Ok(normalized)
}

fn retention_class(field: &str, value: Option<&str>) -> Result<String, DisclosureError> {
    let value = match value {
        Some(value) => non_empty_config_value(field, value)?,
        None => "transient_source_derived".to_string(),
    };
    match value.as_str() {
        "never_collected"
        | "transient_source_derived"
        | "retained_review_artifact"
        | "customer_opt_in_retained_source" => Ok(value),
        _ => Err(DisclosureError::InvalidPolicyConfig {
            field: field.to_string(),
            reason: "must be a protocol retention/source-derived class".to_string(),
        }),
    }
}

fn allowed_source_retention_class(value: &str) -> bool {
    matches!(
        value,
        "transient_source_derived" | "customer_opt_in_retained_source"
    )
}

fn non_empty_config_value(field: &str, value: &str) -> Result<String, DisclosureError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(DisclosureError::InvalidPolicyConfig {
            field: field.to_string(),
            reason: "must be non-empty".to_string(),
        });
    }
    Ok(trimmed.to_string())
}

fn required_json_string<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(serde_json::Value::as_str)
}

fn validate_disclosure_policy_metadata(policy: &DisclosurePolicy) -> Result<(), DisclosureError> {
    if policy.protocol_version != PROTOCOL_VERSION {
        return Err(DisclosureError::InvalidProtocolField {
            field: "protocol_version".to_string(),
            reason: format!("must be {PROTOCOL_VERSION}"),
        });
    }
    validate_disclosure_sha256_id("disclosure_policy_id", &policy.disclosure_policy_id)?;
    validate_disclosure_sha256_id("review_scope_ref", &policy.review_scope_ref)?;
    if policy.include_scanner_findings {
        let Some(scanner_ref) = &policy.scanner_finding_set_ref else {
            return Err(DisclosureError::InvalidProtocolField {
                field: "scanner_finding_set_ref".to_string(),
                reason: "is required when scanner findings are included".to_string(),
            });
        };
        validate_disclosure_sha256_id("scanner_finding_set_ref", scanner_ref)?;
    }
    validate_disclosure_timestamp("created_at", &policy.created_at)?;
    if policy.warnings.is_empty() {
        return Err(DisclosureError::InvalidProtocolField {
            field: "warnings".to_string(),
            reason: "must include mode-specific warnings".to_string(),
        });
    }
    Ok(())
}

fn disclosure_policy_identity(policy: &DisclosurePolicy) -> String {
    // RFC 8785 JCS canonicalization over the policy with `disclosure_policy_id`
    // removed entirely (identity input excludes the id field), matching the
    // manifest-identity convention and the JS canonicalizer used by protocol
    // fixture identities.
    let value = serde_json::to_value(policy).unwrap_or(serde_json::Value::Null);
    let identity_input = match value {
        serde_json::Value::Object(mut map) => {
            map.remove("disclosure_policy_id");
            serde_json::Value::Object(map)
        }
        other => other,
    };
    let canonical = canonicalize_json_value(&identity_input);
    sha256_id(canonical.as_bytes())
}

pub fn canonicalize_protocol_json_value(value: &serde_json::Value) -> String {
    serde_json_canonicalizer::to_string(value)
        .expect("protocol identity input must be serializable as RFC 8785 canonical JSON")
}

fn canonicalize_json_value(value: &serde_json::Value) -> String {
    canonicalize_protocol_json_value(value)
}

fn coverage_mode_label(canonical_value: &str) -> &'static str {
    match canonical_value {
        "metadata_only" => CoverageMode::MetadataOnly.label(),
        "finding_context_snippets" => CoverageMode::FindingContextSnippets.label(),
        "extended_approved_snippets_or_targeted_files" => {
            CoverageMode::ExtendedApprovedSnippetsOrTargetedFiles.label()
        }
        _ => "Unknown coverage mode",
    }
}

fn record_supported_file_group_coverage(
    application_path: &Path,
    files: &[PathBuf],
    scanner_runs: &[ScannerRun],
    coverage_limitations: &mut Vec<String>,
) {
    let mut present_by_group: BTreeMap<&'static str, BTreeSet<String>> = BTreeMap::new();
    for file in files {
        if file_matches_group(file, "typescript_javascript") {
            present_by_group
                .entry("typescript_javascript")
                .or_default()
                .insert(scanner_relative_path_string(application_path, file));
        }
        if file_matches_group(file, "python") {
            present_by_group
                .entry("python")
                .or_default()
                .insert(scanner_relative_path_string(application_path, file));
        }
    }

    let mut covered_by_group: BTreeMap<&'static str, BTreeSet<String>> = BTreeMap::new();
    for run in scanner_runs.iter().filter(|run| {
        matches!(run.status.as_str(), "succeeded" | "no_findings")
            && run.failure_reason.is_none()
            && !run.scanned_files.is_empty()
    }) {
        for file in &run.scanned_files {
            if file_matches_group(Path::new(file), "typescript_javascript") {
                covered_by_group
                    .entry("typescript_javascript")
                    .or_default()
                    .insert(file.clone());
            }
            if file_matches_group(Path::new(file), "python") {
                covered_by_group
                    .entry("python")
                    .or_default()
                    .insert(file.clone());
            }
        }
    }

    for (group, present_files) in present_by_group {
        let covered_files = covered_by_group.remove(group).unwrap_or_default();
        let missing_count = present_files.difference(&covered_files).count();
        if missing_count > 0 {
            coverage_limitations.push(format!(
                "{group} file group has {missing_count} file(s) not scanned by successful configured scanner inputs; no coverage is claimed for those files."
            ));
        }
    }
}

fn run_regex_rule(
    input: &ScanRunInput,
    rule: &RegexScannerRule,
    files: &[PathBuf],
    scanner_runs: &mut Vec<ScannerRun>,
    candidate_findings: &mut Vec<CandidateFinding>,
    coverage_limitations: &mut Vec<String>,
    _artifact_references: &mut Vec<ArtifactReference>,
) {
    if rule.scanner_name != "regex" {
        push_regex_failed_run(
            input,
            rule,
            "configured scanner_name must be regex".to_string(),
            Vec::new(),
            scanner_runs,
        );
        coverage_limitations.push(format!(
            "regex ruleset {} did not run: configured scanner_name was not regex",
            safe_ruleset_identifier(&rule.ruleset_identifier)
        ));
        return;
    }

    if rule.rule_id.trim().is_empty() || rule.ruleset_identifier.trim().is_empty() {
        push_regex_failed_run(
            input,
            rule,
            "regex rule_id and ruleset_identifier must be non-empty".to_string(),
            Vec::new(),
            scanner_runs,
        );
        coverage_limitations.push(
            "regex input did not run: rule_id and ruleset_identifier are required".to_string(),
        );
        return;
    }

    if rule.retain_raw_output_locally {
        coverage_limitations.push(format!(
            "regex ruleset {} requested raw-output retention, but regex raw snippets are not retained by default; no raw regex artifact was written.",
            rule.ruleset_identifier
        ));
    }

    let regex = match Regex::new(&rule.pattern) {
        Ok(regex) => regex,
        Err(error) => {
            push_regex_failed_run(
                input,
                rule,
                format!("invalid regex rule {}: {error}", rule.rule_id),
                Vec::new(),
                scanner_runs,
            );
            coverage_limitations.push(format!(
                "regex ruleset {} did not run: invalid rule {}",
                rule.ruleset_identifier, rule.rule_id
            ));
            return;
        }
    };

    if regex.is_match("") {
        push_regex_failed_run(
            input,
            rule,
            format!("regex rule {} can match empty input", rule.rule_id),
            Vec::new(),
            scanner_runs,
        );
        coverage_limitations.push(format!(
            "regex ruleset {} did not run: rule {} can produce zero-width matches",
            rule.ruleset_identifier, rule.rule_id
        ));
        return;
    }

    let target_files = files
        .iter()
        .filter(|path| {
            file_matches_group(path, &rule.target_file_group)
                && path_matches_include_patterns(
                    &input.application_path,
                    path,
                    &rule.target_include_patterns,
                )
        })
        .collect::<Vec<_>>();

    if target_files.is_empty() {
        scanner_runs.push(ScannerRun {
            scanner_name: "regex".to_string(),
            scanner_version: runner_version().to_string(),
            ruleset_identifier: rule.ruleset_identifier.clone(),
            executed_at: input.generated_at.clone(),
            status: "skipped".to_string(),
            covered_file_group: normalize_file_group(&rule.target_file_group),
            scanned_files: Vec::new(),
            failure_reason: Some(format!(
                "no files matched target group {}",
                rule.target_file_group
            )),
            rerun_possible: true,
            source_derived_class: "retained_review_artifact".to_string(),
        });
        coverage_limitations.push(format!(
            "regex ruleset {} did not scan {}: no matching files were found",
            rule.ruleset_identifier, rule.target_file_group
        ));
        return;
    }

    let before = candidate_findings.len();
    let mut scanned_files = Vec::new();
    let mut zero_width_matches = 0usize;
    let mut capped = false;
    for path in target_files {
        let Ok(content) = fs::read_to_string(path) else {
            coverage_limitations.push(format!(
                "regex ruleset {} skipped unreadable file {}",
                rule.ruleset_identifier,
                scanner_relative_path_string(&input.application_path, path)
            ));
            continue;
        };
        scanned_files.push(scanner_relative_path_string(&input.application_path, path));
        for (line_index, line) in content.lines().enumerate() {
            for found in regex.find_iter(line) {
                if found.is_empty() {
                    zero_width_matches += 1;
                    continue;
                }
                if candidate_findings.len() - before >= MAX_FINDINGS_PER_RULE {
                    capped = true;
                    break;
                }
                let affected_area = format!(
                    "{}:{}:{}",
                    scanner_relative_path_string(&input.application_path, path),
                    line_index + 1,
                    found.start() + 1
                );
                let original_reference = format!("regex:{}:{affected_area}", rule.rule_id);
                candidate_findings.push(CandidateFinding {
                    candidate_finding_id: candidate_finding_id(
                        "regex",
                        &rule.rule_id,
                        candidate_findings.len() + 1,
                    ),
                    source: "regex".to_string(),
                    affected_area,
                    severity: rule.severity.as_deref().and_then(normalize_optional_label),
                    confidence: rule
                        .confidence
                        .as_deref()
                        .and_then(normalize_optional_confidence),
                    scanner_rule_id: rule.rule_id.clone(),
                    original_reference,
                    source_artifact_refs: Vec::new(),
                    status: "candidate".to_string(),
                    source_derived_class: "retained_review_artifact".to_string(),
                });
            }
            if capped {
                break;
            }
        }
        if capped {
            break;
        }
    }

    if zero_width_matches > 0 {
        coverage_limitations.push(format!(
            "regex ruleset {} skipped {zero_width_matches} zero-width match(es)",
            rule.ruleset_identifier
        ));
    }
    if capped {
        coverage_limitations.push(format!(
            "regex ruleset {} stopped after {MAX_FINDINGS_PER_RULE} findings to keep scanner output bounded",
            rule.ruleset_identifier
        ));
    }

    if scanned_files.is_empty() {
        scanner_runs.push(ScannerRun {
            scanner_name: "regex".to_string(),
            scanner_version: runner_version().to_string(),
            ruleset_identifier: rule.ruleset_identifier.clone(),
            executed_at: input.generated_at.clone(),
            status: "skipped".to_string(),
            covered_file_group: normalize_file_group(&rule.target_file_group),
            scanned_files,
            failure_reason: Some("all matching files were unreadable or skipped".to_string()),
            rerun_possible: true,
            source_derived_class: "retained_review_artifact".to_string(),
        });
        coverage_limitations.push(format!(
            "regex ruleset {} did not scan readable target files; no coverage is claimed",
            rule.ruleset_identifier
        ));
        return;
    }

    scanner_runs.push(ScannerRun {
        scanner_name: "regex".to_string(),
        scanner_version: runner_version().to_string(),
        ruleset_identifier: rule.ruleset_identifier.clone(),
        executed_at: input.generated_at.clone(),
        status: if candidate_findings.len() > before {
            "succeeded"
        } else {
            "no_findings"
        }
        .to_string(),
        covered_file_group: normalize_file_group(&rule.target_file_group),
        scanned_files,
        failure_reason: None,
        rerun_possible: true,
        source_derived_class: "retained_review_artifact".to_string(),
    });
}

fn push_regex_failed_run(
    input: &ScanRunInput,
    rule: &RegexScannerRule,
    failure_reason: String,
    scanned_files: Vec<String>,
    scanner_runs: &mut Vec<ScannerRun>,
) {
    scanner_runs.push(ScannerRun {
        scanner_name: "regex".to_string(),
        scanner_version: runner_version().to_string(),
        ruleset_identifier: safe_ruleset_identifier(&rule.ruleset_identifier),
        executed_at: input.generated_at.clone(),
        status: "failed".to_string(),
        covered_file_group: normalize_file_group(&rule.target_file_group),
        scanned_files,
        failure_reason: Some(failure_reason),
        rerun_possible: true,
        source_derived_class: "retained_review_artifact".to_string(),
    });
}

fn run_semgrep_json_input(
    input: &ScanRunInput,
    semgrep_input: &SemgrepJsonInput,
    files: &[PathBuf],
    scanner_runs: &mut Vec<ScannerRun>,
    candidate_findings: &mut Vec<CandidateFinding>,
    coverage_limitations: &mut Vec<String>,
    artifact_references: &mut Vec<ArtifactReference>,
) {
    if semgrep_input.scanner_name != "semgrep" {
        scanner_runs.push(semgrep_run(
            semgrep_input,
            &input.generated_at,
            "failed",
            Some("configured scanner_name must be semgrep".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} did not run: configured scanner_name was not semgrep",
            safe_ruleset_identifier(&semgrep_input.ruleset_identifier)
        ));
        return;
    }

    if semgrep_input.ruleset_identifier.trim().is_empty() {
        scanner_runs.push(semgrep_run(
            semgrep_input,
            &input.generated_at,
            "failed",
            Some("ruleset_identifier must be non-empty".to_string()),
            Vec::new(),
        ));
        coverage_limitations
            .push("semgrep input did not run: ruleset_identifier is required".to_string());
        return;
    }

    let scanner_version = semgrep_input
        .scanner_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if scanner_version.is_none() {
        scanner_runs.push(semgrep_run(
            semgrep_input,
            &input.generated_at,
            "failed",
            Some("Semgrep version was not detected".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} was not accepted as successful coverage: scanner version was not detected",
            semgrep_input.ruleset_identifier
        ));
        return;
    }

    let content = match fs::read_to_string(&semgrep_input.json_path) {
        Ok(content) => content,
        Err(error) => {
            scanner_runs.push(semgrep_run(
                semgrep_input,
                &input.generated_at,
                "failed",
                Some("could not read Semgrep JSON output".to_string()),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} did not run: JSON output was unreadable ({error})",
                semgrep_input.ruleset_identifier
            ));
            return;
        }
    };

    let parsed: SemgrepOutput = match serde_json::from_str(&content) {
        Ok(parsed) => parsed,
        Err(error) => {
            scanner_runs.push(semgrep_run(
                semgrep_input,
                &input.generated_at,
                "invalid_output",
                Some(format!("could not parse Semgrep JSON output: {error}")),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} produced invalid JSON output",
                semgrep_input.ruleset_identifier
            ));
            return;
        }
    };

    if semgrep_input.retain_raw_output_locally {
        add_file_artifact_reference(
            &semgrep_input.json_path,
            "semgrep_raw_output",
            &semgrep_input.ruleset_identifier,
            "application/json",
            "customer_opt_in_retained_source",
            artifact_references,
            coverage_limitations,
        );
    }

    let before = candidate_findings.len();
    let import = append_semgrep_results(
        &parsed,
        &input.application_path,
        files,
        &semgrep_input.target_file_group,
        &semgrep_input.target_include_patterns,
        candidate_findings,
        coverage_limitations,
    );

    let run = semgrep_run(
        semgrep_input,
        &input.generated_at,
        if import.has_errors || (import.invalid_results > 0 && import.valid_results == 0) {
            "invalid_output"
        } else if candidate_findings.len() > before {
            "succeeded"
        } else {
            "no_findings"
        },
        if import.has_errors {
            Some("Semgrep output reported scan errors; coverage is not claimed".to_string())
        } else if import.invalid_results > 0 && import.valid_results == 0 {
            Some(
                "Semgrep output did not contain valid in-scope findings or scanned paths"
                    .to_string(),
            )
        } else {
            None
        },
        import.scanned_files,
    );
    scanner_runs.push(run);
}

fn run_semgrep_local_command(
    input: &ScanRunInput,
    command_input: &SemgrepLocalCommandInput,
    files: &[PathBuf],
    scanner_runs: &mut Vec<ScannerRun>,
    candidate_findings: &mut Vec<CandidateFinding>,
    coverage_limitations: &mut Vec<String>,
    artifact_references: &mut Vec<ArtifactReference>,
) {
    if command_input.scanner_name != "semgrep" {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            "missing".to_string(),
            "failed",
            Some("configured scanner_name must be semgrep".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} did not run: configured scanner_name was not semgrep",
            safe_ruleset_identifier(&command_input.ruleset_identifier)
        ));
        return;
    }

    if command_input.ruleset_identifier.trim().is_empty() {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            "missing".to_string(),
            "failed",
            Some("ruleset_identifier must be non-empty".to_string()),
            Vec::new(),
        ));
        coverage_limitations
            .push("semgrep input did not run: ruleset_identifier is required".to_string());
        return;
    }

    if !is_allowed_semgrep_command(&command_input.command) {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            "missing".to_string(),
            "failed",
            Some("Semgrep command must be the literal semgrep resolved from PATH; absolute or relative semgrep paths are not allowed".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} did not run: command path is not allowed",
            command_input.ruleset_identifier
        ));
        return;
    }

    let version_output = run_command_bounded(&command_input.command, &["--version"]);
    let scanner_version = match version_output {
        Ok(output) if output.timed_out => {
            scanner_runs.push(semgrep_command_run(
                input,
                command_input,
                "missing".to_string(),
                "failed",
                Some("semgrep --version timed out".to_string()),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} did not run: scanner version check timed out",
                command_input.ruleset_identifier
            ));
            return;
        }
        Ok(output) if output.status_success => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if version.is_empty() {
                scanner_runs.push(semgrep_command_run(
                    input,
                    command_input,
                    "missing".to_string(),
                    "failed",
                    Some("semgrep version was not detected".to_string()),
                    Vec::new(),
                ));
                coverage_limitations.push(format!(
                    "semgrep ruleset {} did not run: scanner version was not detected",
                    command_input.ruleset_identifier
                ));
                return;
            } else {
                version
            }
        }
        Ok(_output) => {
            scanner_runs.push(semgrep_command_run(
                input,
                command_input,
                "missing".to_string(),
                "failed",
                Some("semgrep --version failed; raw diagnostics were not retained".to_string()),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} did not run: scanner version check failed",
                command_input.ruleset_identifier
            ));
            return;
        }
        Err(error) => {
            scanner_runs.push(semgrep_command_run(
                input,
                command_input,
                "missing".to_string(),
                "unavailable",
                Some("semgrep command not available".to_string()),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} did not run: scanner not available ({error})",
                command_input.ruleset_identifier
            ));
            return;
        }
    };

    let application_arg = input.application_path.to_string_lossy().into_owned();
    let output = match run_command_bounded(
        &command_input.command,
        &[
            "scan",
            "--json",
            "--metrics",
            "off",
            "--config",
            &command_input.config_path,
            &application_arg,
        ],
    ) {
        Ok(output) => output,
        Err(error) => {
            scanner_runs.push(semgrep_command_run(
                input,
                command_input,
                scanner_version,
                "failed",
                Some("semgrep scan failed to start".to_string()),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} did not run: scanner process failed to start ({error})",
                command_input.ruleset_identifier
            ));
            return;
        }
    };

    if output.timed_out {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            scanner_version,
            "failed",
            Some("semgrep scan timed out".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} did not run: scanner process timed out",
            command_input.ruleset_identifier
        ));
        return;
    }

    if !output.status_success {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            scanner_version,
            "failed",
            Some("semgrep scan failed; raw diagnostics were not retained".to_string()),
            Vec::new(),
        ));
        coverage_limitations.push(format!(
            "semgrep ruleset {} did not run successfully",
            command_input.ruleset_identifier
        ));
        return;
    }

    if output.stdout_truncated || output.stderr_truncated {
        coverage_limitations.push(format!(
            "semgrep ruleset {} produced output beyond the runner capture limit; output was truncated before parsing",
            command_input.ruleset_identifier
        ));
    }

    if command_input.retain_raw_output_locally {
        add_command_output_artifact_reference(
            input,
            &command_input.ruleset_identifier,
            &output.stdout,
            artifact_references,
            coverage_limitations,
        );
    }

    // [C2-06] A truncated stdout prefix can still be syntactically valid JSON (e.g.
    // truncation lands on a complete-looking results array), which would otherwise
    // let record_supported_file_group_coverage credit files as scanned from a payload
    // known to be incomplete. Stop before parsing/importing rather than trusting it.
    // Stderr-only truncation does not affect stdout parsing, so it stays a warning.
    if output.stdout_truncated {
        scanner_runs.push(semgrep_command_run(
            input,
            command_input,
            scanner_version,
            "invalid_output",
            Some("semgrep stdout was truncated at the runner capture limit; findings and scanned paths were not imported from a possibly incomplete payload".to_string()),
            Vec::new(),
        ));
        return;
    }

    let parsed: SemgrepOutput = match serde_json::from_slice(&output.stdout) {
        Ok(parsed) => parsed,
        Err(error) => {
            scanner_runs.push(semgrep_command_run(
                input,
                command_input,
                scanner_version,
                "invalid_output",
                Some(format!("could not parse Semgrep JSON output: {error}")),
                Vec::new(),
            ));
            coverage_limitations.push(format!(
                "semgrep ruleset {} produced invalid JSON output",
                command_input.ruleset_identifier
            ));
            return;
        }
    };

    let before = candidate_findings.len();
    let import = append_semgrep_results(
        &parsed,
        &input.application_path,
        files,
        &command_input.target_file_group,
        &command_input.target_include_patterns,
        candidate_findings,
        coverage_limitations,
    );
    scanner_runs.push(semgrep_command_run(
        input,
        command_input,
        scanner_version,
        if import.has_errors || (import.invalid_results > 0 && import.valid_results == 0) {
            "invalid_output"
        } else if candidate_findings.len() > before {
            "succeeded"
        } else {
            "no_findings"
        },
        if import.has_errors {
            Some("Semgrep output reported scan errors; coverage is not claimed".to_string())
        } else if import.invalid_results > 0 && import.valid_results == 0 {
            Some(
                "Semgrep output did not contain valid in-scope findings or scanned paths"
                    .to_string(),
            )
        } else {
            None
        },
        import.scanned_files,
    ));
}

fn semgrep_run(
    input: &SemgrepJsonInput,
    generated_at: &str,
    status: &str,
    failure_reason: Option<String>,
    scanned_files: Vec<String>,
) -> ScannerRun {
    ScannerRun {
        scanner_name: "semgrep".to_string(),
        scanner_version: input
            .scanner_version
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "missing".to_string()),
        ruleset_identifier: safe_ruleset_identifier(&input.ruleset_identifier),
        executed_at: generated_at.to_string(),
        status: status.to_string(),
        covered_file_group: normalize_file_group(&input.target_file_group),
        scanned_files,
        failure_reason,
        rerun_possible: true,
        source_derived_class: "retained_review_artifact".to_string(),
    }
}

fn semgrep_command_run(
    input: &ScanRunInput,
    command_input: &SemgrepLocalCommandInput,
    scanner_version: String,
    status: &str,
    failure_reason: Option<String>,
    scanned_files: Vec<String>,
) -> ScannerRun {
    ScannerRun {
        scanner_name: "semgrep".to_string(),
        scanner_version,
        ruleset_identifier: safe_ruleset_identifier(&command_input.ruleset_identifier),
        executed_at: input.generated_at.clone(),
        status: status.to_string(),
        covered_file_group: normalize_file_group(&command_input.target_file_group),
        scanned_files,
        failure_reason,
        rerun_possible: true,
        source_derived_class: "retained_review_artifact".to_string(),
    }
}

#[derive(Debug, Default)]
struct SemgrepImportOutcome {
    valid_results: usize,
    invalid_results: usize,
    has_errors: bool,
    scanned_files: Vec<String>,
}

fn append_semgrep_results(
    output: &SemgrepOutput,
    application_path: &Path,
    files: &[PathBuf],
    target_file_group: &str,
    target_include_patterns: &[String],
    candidate_findings: &mut Vec<CandidateFinding>,
    coverage_limitations: &mut Vec<String>,
) -> SemgrepImportOutcome {
    let mut outcome = SemgrepImportOutcome::default();
    let known_files = known_scanner_files(application_path, files);

    if !output.errors.is_empty() {
        outcome.has_errors = true;
        coverage_limitations.push(format!(
            "Semgrep output reported {} error(s); no Semgrep coverage is claimed for this run.",
            output.errors.len()
        ));
    }

    if let Some(paths) = &output.paths {
        for path in &paths.scanned {
            match resolve_scanner_result_path(application_path, &known_files, path) {
                Some((absolute, relative))
                    if file_matches_group(&absolute, target_file_group)
                        && path_matches_include_patterns(
                            application_path,
                            &absolute,
                            target_include_patterns,
                        ) =>
                {
                    insert_unique(&mut outcome.scanned_files, relative);
                }
                _ => {
                    coverage_limitations.push(format!(
                        "Semgrep reported scanned path outside configured scope and it was not credited: {}",
                        privacy_safe_path_label(path)
                    ));
                }
            }
        }
        if !paths.skipped.is_empty() {
            coverage_limitations.push(format!(
                "Semgrep reported {} skipped path/rule record(s); coverage may be incomplete.",
                paths.skipped.len()
            ));
        }
    }

    for result in &output.results {
        let Some(rule_id) = result
            .check_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            outcome.invalid_results += 1;
            coverage_limitations.push(
                "Semgrep result was skipped because it did not include a rule identifier."
                    .to_string(),
            );
            continue;
        };

        let Some(path) = result
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} was skipped because it did not include a path."
            ));
            continue;
        };

        let Some((absolute_path, relative_path)) =
            resolve_scanner_result_path(application_path, &known_files, path)
        else {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} referenced a path outside configured scanner scope and was skipped: {}",
                privacy_safe_path_label(path)
            ));
            continue;
        };

        if !file_matches_group(&absolute_path, target_file_group)
            || !path_matches_include_patterns(
                application_path,
                &absolute_path,
                target_include_patterns,
            )
        {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} referenced {} outside configured include patterns/file group and was skipped.",
                relative_path
            ));
            continue;
        }

        let Some(start) = &result.start else {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} in {} was skipped because it had no location.",
                relative_path
            ));
            continue;
        };
        let Some(line) = start.line.filter(|value| *value > 0) else {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} in {} was skipped because it had no valid line.",
                relative_path
            ));
            continue;
        };
        let Some(column) = start.col.filter(|value| *value > 0) else {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} in {} was skipped because it had no valid column.",
                relative_path
            ));
            continue;
        };
        if !source_location_exists(&absolute_path, line, column) {
            outcome.invalid_results += 1;
            coverage_limitations.push(format!(
                "Semgrep result for rule {rule_id} referenced a stale location and was skipped: {}:{line}:{column}",
                relative_path
            ));
            continue;
        }

        insert_unique(&mut outcome.scanned_files, relative_path.clone());
        let affected_area = format!("{relative_path}:{line}:{column}");
        let original_reference = format!("semgrep:{rule_id}:{affected_area}");
        let extra = result.extra.as_ref();
        candidate_findings.push(CandidateFinding {
            candidate_finding_id: candidate_finding_id(
                "semgrep",
                rule_id,
                candidate_findings.len() + 1,
            ),
            source: "semgrep".to_string(),
            affected_area,
            severity: extra
                .and_then(|extra| extra.severity.as_ref())
                .and_then(|value| normalize_optional_label(value)),
            confidence: extra.and_then(confidence_from_semgrep_extra),
            scanner_rule_id: rule_id.to_string(),
            original_reference,
            source_artifact_refs: Vec::new(),
            status: "candidate".to_string(),
            source_derived_class: "retained_review_artifact".to_string(),
        });
        outcome.valid_results += 1;
    }

    outcome.scanned_files.sort();
    outcome
}

#[derive(Debug, Deserialize)]
struct SemgrepOutput {
    #[serde(default)]
    results: Vec<SemgrepResult>,
    #[serde(default)]
    errors: Vec<serde_json::Value>,
    paths: Option<SemgrepPaths>,
}

#[derive(Debug, Deserialize)]
struct SemgrepPaths {
    #[serde(default)]
    scanned: Vec<String>,
    #[serde(default)]
    skipped: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SemgrepResult {
    check_id: Option<String>,
    path: Option<String>,
    start: Option<SemgrepLocation>,
    extra: Option<SemgrepExtra>,
}

#[derive(Debug, Deserialize)]
struct SemgrepLocation {
    line: Option<usize>,
    col: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct SemgrepExtra {
    severity: Option<String>,
    #[serde(default)]
    metadata: BTreeMap<String, serde_json::Value>,
}

fn confidence_from_semgrep_extra(extra: &SemgrepExtra) -> Option<String> {
    extra
        .metadata
        .get("confidence")
        .and_then(serde_json::Value::as_str)
        .and_then(normalize_optional_confidence)
}

fn known_scanner_files(root: &Path, files: &[PathBuf]) -> BTreeMap<String, (PathBuf, String)> {
    let mut known = BTreeMap::new();
    for file in files {
        let relative = scanner_relative_path_string(root, file);
        known.insert(relative.clone(), (file.clone(), relative.clone()));
        known.insert(normalized_path_string(file), (file.clone(), relative));
    }
    known
}

fn resolve_scanner_result_path(
    root: &Path,
    known_files: &BTreeMap<String, (PathBuf, String)>,
    scanner_path: &str,
) -> Option<(PathBuf, String)> {
    let normalized = scanner_path.trim().replace('\\', "/");
    if normalized.is_empty() || normalized.contains('\0') {
        return None;
    }
    if let Some(found) = known_files.get(&normalized) {
        return Some(found.clone());
    }

    let path = Path::new(&normalized);
    if path.is_absolute() {
        return known_files.get(&normalized_path_string(path)).cloned();
    }

    let joined = root.join(path);
    known_files.get(&normalized_path_string(&joined)).cloned()
}

fn source_location_exists(path: &Path, line: usize, column: usize) -> bool {
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    let Some(text_line) = content.lines().nth(line.saturating_sub(1)) else {
        return false;
    };
    let max_column = text_line.chars().count() + 1;
    column <= max_column
}

fn insert_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn privacy_safe_path_label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "scanner-reported-path".to_string())
}

fn is_allowed_semgrep_command(command: &str) -> bool {
    command.trim() == "semgrep"
}

#[derive(Debug)]
struct BoundedCommandOutput {
    status_success: bool,
    stdout: Vec<u8>,
    timed_out: bool,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

fn run_command_bounded(
    command: &str,
    args: &[&str],
) -> Result<BoundedCommandOutput, std::io::Error> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = stdout.map(read_limited_in_background);
    let stderr_reader = stderr.map(read_limited_in_background);

    let start = std::time::Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() >= COMMAND_TIMEOUT {
            timed_out = true;
            let _ = child.kill();
            break child.wait()?;
        }
        thread::sleep(Duration::from_millis(25));
    };

    let (stdout, stdout_truncated) = join_reader(stdout_reader);
    let (_stderr, stderr_truncated) = join_reader(stderr_reader);
    Ok(BoundedCommandOutput {
        status_success: status.success(),
        stdout,
        timed_out,
        stdout_truncated,
        stderr_truncated,
    })
}

fn read_limited_in_background<R>(mut reader: R) -> thread::JoinHandle<(Vec<u8>, bool)>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        let mut truncated = false;
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let remaining = COMMAND_OUTPUT_CAP_BYTES.saturating_sub(output.len());
                    if remaining > 0 {
                        output.extend_from_slice(&buffer[..count.min(remaining)]);
                    }
                    if count > remaining {
                        truncated = true;
                    }
                }
                Err(_) => break,
            }
        }
        (output, truncated)
    })
}

fn join_reader(reader: Option<thread::JoinHandle<(Vec<u8>, bool)>>) -> (Vec<u8>, bool) {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_else(|| (Vec::new(), false))
}

fn scanner_artifact_content_path(path: &Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "scanner-output.json".to_string());
    format!("scanner-artifacts/{file_name}")
}

fn add_file_artifact_reference(
    path: &Path,
    artifact_ref_prefix: &str,
    ruleset_identifier: &str,
    media_type: &str,
    source_derived_class: &str,
    artifact_references: &mut Vec<ArtifactReference>,
    coverage_limitations: &mut Vec<String>,
) {
    match fs::read(path) {
        Ok(bytes) => match artifact_reference_for_bytes(
            artifact_ref_prefix,
            ruleset_identifier,
            &bytes,
            Some(scanner_artifact_content_path(path)),
            media_type,
            source_derived_class,
            artifact_references.len() + 1,
        ) {
            Ok(reference) => artifact_references.push(reference),
            Err(reason) => coverage_limitations.push(format!(
                "requested retention artifact for ruleset {ruleset_identifier} could not be referenced ({reason})"
            )),
        },
        Err(error) => coverage_limitations.push(format!(
            "requested retention artifact for ruleset {} could not be referenced ({error})",
            ruleset_identifier
        )),
    }
}

fn add_command_output_artifact_reference(
    input: &ScanRunInput,
    ruleset_identifier: &str,
    bytes: &[u8],
    artifact_references: &mut Vec<ArtifactReference>,
    coverage_limitations: &mut Vec<String>,
) {
    let artifact_dir = input
        .output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("scanner-artifacts");
    if let Err(error) = fs::create_dir_all(&artifact_dir) {
        coverage_limitations.push(format!(
            "requested Semgrep raw-output retention could not create artifact directory ({error})"
        ));
        return;
    }
    let file_name = format!(
        "{}-semgrep-output.json",
        slugify_identifier(ruleset_identifier).replace('-', "_")
    );
    let artifact_path = artifact_dir.join(file_name);
    if let Err(error) = fs::write(&artifact_path, bytes) {
        coverage_limitations.push(format!(
            "requested Semgrep raw-output retention could not write artifact ({error})"
        ));
        return;
    }
    match artifact_reference_for_bytes(
        "semgrep_raw_output",
        ruleset_identifier,
        bytes,
        Some(scanner_artifact_content_path(&artifact_path)),
        "application/json",
        "customer_opt_in_retained_source",
        artifact_references.len() + 1,
    ) {
        Ok(reference) => artifact_references.push(reference),
        Err(reason) => coverage_limitations.push(format!(
            "requested Semgrep raw-output retention could not be referenced ({reason})"
        )),
    }
}

fn artifact_reference_for_bytes(
    artifact_ref_prefix: &str,
    ruleset_identifier: &str,
    bytes: &[u8],
    content_path: Option<String>,
    media_type: &str,
    source_derived_class: &str,
    index: usize,
) -> Result<ArtifactReference, String> {
    let slug = slugify_identifier(&format!(
        "{artifact_ref_prefix}-{ruleset_identifier}-{index}"
    ))
    .replace('-', "_");
    let size_bytes = bytes.len() as u64;
    validate_size_bytes_js_safe(size_bytes)
        .map_err(|reason| format!("artifact_ref:{slug}.size_bytes {reason}"))?;
    Ok(ArtifactReference {
        protocol_version: PROTOCOL_VERSION.to_string(),
        artifact_ref: format!("artifact_ref:{slug}"),
        artifact_type: "scanner_raw_output".to_string(),
        digest: sha256_id(bytes),
        size_bytes,
        source_derived_class: source_derived_class.to_string(),
        manifest_entry_ref: format!("manifest_entry:{slug}"),
        media_type: Some(media_type.to_string()),
        content_path,
        content_path_anchor: Some("manifest_artifacts".to_string()),
        synthetic_markers: None,
    })
}

fn regex_scanner_name() -> String {
    "regex".to_string()
}

fn semgrep_scanner_name() -> String {
    "semgrep".to_string()
}

fn file_matches_group(path: &Path, group: &str) -> bool {
    match normalize_file_group(group).as_str() {
        "typescript_javascript" => extension_is(path, &["ts", "tsx", "js", "jsx"]),
        "python" => extension_is(path, &["py"]),
        "mixed" => extension_is(path, &["ts", "tsx", "js", "jsx", "py"]),
        _ => false,
    }
}

fn path_matches_include_patterns(root: &Path, path: &Path, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return true;
    }
    let relative = scanner_relative_path_string(root, path);
    patterns
        .iter()
        .any(|pattern| simple_glob_match(&relative, pattern))
}

fn simple_glob_match(value: &str, pattern: &str) -> bool {
    let pattern = pattern.trim().replace('\\', "/");
    if pattern.is_empty() {
        return false;
    }
    let value = value.replace('\\', "/");
    if pattern == "*" {
        return !value.contains('/');
    }
    if pattern == "**" || pattern == "**/*" {
        return true;
    }
    if !pattern.contains('*') {
        return value == pattern || (!pattern.contains('/') && path_file_name_eq(&value, &pattern));
    }

    let pattern_segments = pattern.split('/').collect::<Vec<_>>();
    let value_segments = value.split('/').collect::<Vec<_>>();
    glob_segments_match(&pattern_segments, &value_segments)
}

fn path_file_name_eq(value: &str, expected: &str) -> bool {
    value
        .rsplit('/')
        .next()
        .map(|name| name == expected)
        .unwrap_or(false)
}

fn glob_segments_match(pattern: &[&str], value: &[&str]) -> bool {
    if pattern.is_empty() {
        return value.is_empty();
    }
    if pattern[0] == "**" {
        for skip in 0..=value.len() {
            if glob_segments_match(&pattern[1..], &value[skip..]) {
                return true;
            }
        }
        return false;
    }
    if value.is_empty() {
        return false;
    }
    segment_glob_match(value[0], pattern[0]) && glob_segments_match(&pattern[1..], &value[1..])
}

fn segment_glob_match(value: &str, pattern: &str) -> bool {
    let value = value.as_bytes();
    let pattern = pattern.as_bytes();
    let mut vi = 0usize;
    let mut pi = 0usize;
    let mut star: Option<usize> = None;
    let mut star_match = 0usize;

    while vi < value.len() {
        if pi < pattern.len() && (pattern[pi] == value[vi] || pattern[pi] == b'?') {
            vi += 1;
            pi += 1;
        } else if pi < pattern.len() && pattern[pi] == b'*' {
            star = Some(pi);
            star_match = vi;
            pi += 1;
        } else if let Some(star_index) = star {
            pi = star_index + 1;
            star_match += 1;
            vi = star_match;
        } else {
            return false;
        }
    }

    while pi < pattern.len() && pattern[pi] == b'*' {
        pi += 1;
    }
    pi == pattern.len()
}

fn normalize_file_group(group: &str) -> String {
    match group {
        "typescript_javascript" | "python" | "mixed" => group.to_string(),
        _ => "unsupported".to_string(),
    }
}

fn normalize_label(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(' ', "_")
}

fn normalize_optional_label(value: &str) -> Option<String> {
    let normalized = normalize_label(value);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_confidence(value: &str) -> String {
    match normalize_label(value).as_str() {
        "low" => "low".to_string(),
        "medium" => "medium".to_string(),
        "high" => "high".to_string(),
        _ => "unknown".to_string(),
    }
}

fn normalize_optional_confidence(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(normalize_confidence(trimmed))
    }
}

fn safe_ruleset_identifier(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "local:unspecified-ruleset".to_string()
    } else {
        trimmed.to_string()
    }
}

fn validate_sha256_id(field: &str, value: &str) -> Result<(), ScanError> {
    if is_sha256_id(value) {
        Ok(())
    } else {
        Err(ScanError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be sha256:<64 lowercase hex characters>".to_string(),
        })
    }
}

fn validate_disclosure_sha256_id(field: &str, value: &str) -> Result<(), DisclosureError> {
    if is_sha256_id(value) {
        Ok(())
    } else {
        Err(DisclosureError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be sha256:<64 lowercase hex characters>".to_string(),
        })
    }
}

fn is_sha256_id(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value.as_bytes()[7..]
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn validate_utc_rfc3339_timestamp(field: &str, value: &str) -> Result<(), ScanError> {
    if is_utc_rfc3339_timestamp(value) {
        Ok(())
    } else {
        Err(ScanError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00), e.g. 2026-07-08T00:00:00Z or 2026-07-08T00:00:00.123+00:00".to_string(),
        })
    }
}

fn validate_disclosure_timestamp(field: &str, value: &str) -> Result<(), DisclosureError> {
    if is_utc_rfc3339_timestamp(value) {
        Ok(())
    } else {
        Err(DisclosureError::InvalidProtocolField {
            field: field.to_string(),
            reason: "must be UTC RFC 3339 (optional fractional seconds, Z or +00:00), e.g. 2026-07-08T00:00:00Z or 2026-07-08T00:00:00.123+00:00".to_string(),
        })
    }
}

// protocol/schemas/artifact-reference.schema.json#/properties/size_bytes caps at
// Number.MAX_SAFE_INTEGER so every JSON-number authority (schema, JS, protocol-ts)
// can represent size_bytes exactly; Rust models it as u64, which can exceed that
// cap. This guard keeps Rust from ever constructing an ArtifactReference the
// other authorities would reject — see Code_Review_2026Aug3.md C8-07.
const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn validate_size_bytes_js_safe(size_bytes: u64) -> Result<(), String> {
    if size_bytes > MAX_JS_SAFE_INTEGER {
        return Err(format!(
            "size_bytes {size_bytes} exceeds the JS-safe integer maximum {MAX_JS_SAFE_INTEGER}"
        ));
    }
    Ok(())
}

// Accepts the protocol-wide contract in protocol/schemas/shared-definitions.schema.json:
// YYYY-MM-DDTHH:MM:SS, an optional `.` followed by 1-9 fractional-second digits,
// and either `Z` or `+00:00`. This must stay convergent with the JS/protocol-ts
// UTC_RFC3339_PATTERN (see packages/protocol-ts/src/validation.ts and
// scripts/lib/protocol-utils.mjs) — see Code_Review_2026Aug3.md C8-02.
fn is_utc_rfc3339_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return false;
    }
    if ![0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
        .iter()
        .all(|index| bytes[*index].is_ascii_digit())
    {
        return false;
    }

    let mut cursor = 19usize;
    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            cursor += 1;
        }
        let fraction_len = cursor - fraction_start;
        if !(1..=9).contains(&fraction_len) {
            return false;
        }
    }
    let suffix = &value[cursor..];
    if suffix != "Z" && suffix != "+00:00" {
        return false;
    }

    // Story 1.7 review-fix: reject semantically-impossible calendar values.
    // Prior version accepted 2026-13-32T25:70:99Z because only positional/digit
    // checks ran. This does not do full leap-year day-of-month validation, but
    // it rejects the clearly-impossible cases that were folded into manifest_id.
    let two = |a: u8, b: u8| ((a - b'0') * 10 + (b - b'0')) as u32;
    let year = (bytes[0] - b'0') as u32 * 1000
        + (bytes[1] - b'0') as u32 * 100
        + (bytes[2] - b'0') as u32 * 10
        + (bytes[3] - b'0') as u32;
    let month = two(bytes[5], bytes[6]);
    let day = two(bytes[8], bytes[9]);
    let hour = two(bytes[11], bytes[12]);
    let minute = two(bytes[14], bytes[15]);
    let second = two(bytes[17], bytes[18]);
    // No year floor: the protocol schema places none (see C8-02); JS/protocol-ts
    // accept any 4-digit year.
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return false;
    }
    // Per-month day cap with Gregorian leap-year rule so 2025-02-29Z, 2100-02-29Z,
    // and similar non-leap-year Feb 29 values are rejected.
    let is_leap_year =
        (year.is_multiple_of(4) && !year.is_multiple_of(100)) || year.is_multiple_of(400);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    if day > max_day {
        return false;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    true
}

fn scanner_relative_path_string(root: &Path, path: &Path) -> String {
    if root.is_file() && root == path {
        return path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| path.display().to_string());
    }
    let relative = relative_path_string(root, path);
    if relative.is_empty() {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| path.display().to_string())
    } else {
        relative
    }
}

fn candidate_finding_id(source: &str, rule_id: &str, index: usize) -> String {
    let mut slug = slugify_identifier(&format!("{source}-{rule_id}")).replace('-', "_");
    if slug.len() > 48 {
        slug.truncate(48);
        while slug.ends_with('_') {
            slug.pop();
        }
    }
    if slug.is_empty() {
        slug = "scanner_finding".to_string();
    }
    format!("candidate_finding:{slug}_{index:03}")
}

fn scanner_finding_set_identity(finding_set: &ScannerFindingSet) -> String {
    let mut value = serde_json::to_value(finding_set).unwrap_or(serde_json::Value::Null);
    if let serde_json::Value::Object(map) = &mut value {
        map.insert(
            "scanner_finding_set_id".to_string(),
            serde_json::Value::String(String::new()),
        );
    }
    let canonical = canonicalize_json_value(&value);
    sha256_id(canonical.as_bytes())
}

pub fn detect_technical_context(application_path: &Path) -> Vec<TechnicalContext> {
    let files = list_files_sorted(application_path);
    let file_names: BTreeSet<String> = files
        .iter()
        .filter_map(|path| path.file_name())
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .collect();

    // Aggregate dependencies from ALL package.json manifests in the tree
    // (monorepo support). Python's requirements.txt aggregation already
    // iterated all matches; keep JS/Python symmetric.
    let mut package_dependencies = BTreeSet::new();
    for package_json in files
        .iter()
        .filter(|path| file_name_eq(path, "package.json"))
    {
        if let Ok(content) = fs::read_to_string(package_json) {
            package_dependencies.extend(parse_package_json_dependency_names(&content));
        }
    }

    // Matches `requirements/*.txt` (convention for split dev/prod/base
    // requirements) in addition to the root-level `requirements.txt`.
    fn is_requirements_txt_family(path: &Path) -> bool {
        if file_name_eq(path, "requirements.txt") {
            return true;
        }
        let Some(parent_name) = path.parent().and_then(|p| p.file_name()) else {
            return false;
        };
        parent_name == "requirements" && extension_is(path, &["txt"])
    }

    let mut python_dependencies = BTreeSet::new();
    for requirements in files.iter().filter(|p| is_requirements_txt_family(p)) {
        if let Ok(content) = fs::read_to_string(requirements) {
            python_dependencies.extend(parse_requirements_dependency_names(&content));
        }
    }

    // Language signals.
    // TypeScript: require an explicit TS signal — tsconfig.json, .ts/.tsx
    // files, or a `typescript` entry in package.json dependencies. The mere
    // presence of package.json or package-lock.json does NOT make a project
    // TypeScript; that would mislabel every plain Node.js project.
    let has_typescript_file_ext = files.iter().any(|path| extension_is(path, &["ts", "tsx"]));
    let has_typescript_dep = package_dependencies.contains("typescript");
    let has_typescript =
        file_names.contains("tsconfig.json") || has_typescript_file_ext || has_typescript_dep;

    let has_javascript_file_ext = files.iter().any(|path| extension_is(path, &["js", "jsx"]));
    let has_javascript = file_names.contains("package.json")
        || file_names.contains("package-lock.json")
        || has_javascript_file_ext;

    let has_requirements_subdir_txt = files.iter().any(|path| {
        path.parent()
            .and_then(|p| p.file_name())
            .map(|name| name == "requirements")
            .unwrap_or(false)
            && extension_is(path, &["txt"])
    });
    let has_python = file_names.contains("requirements.txt")
        || has_requirements_subdir_txt
        || file_names.contains("pyproject.toml")
        || file_names.contains("pipfile")
        || file_names.contains("pipfile.lock")
        || files.iter().any(|path| extension_is(path, &["py"]));

    let mut contexts = Vec::new();
    push_detected_or_not(&mut contexts, "language", "typescript", has_typescript);
    push_detected_or_not(&mut contexts, "language", "javascript", has_javascript);
    push_detected_or_not(&mut contexts, "language", "python", has_python);

    for package_manager in ["npm", "pip"] {
        let detected = match package_manager {
            "npm" => file_names.contains("package.json"),
            "pip" => file_names.contains("requirements.txt"),
            _ => false,
        };
        push_detected_or_not(&mut contexts, "package_manager", package_manager, detected);
    }

    for framework in [
        "django", "express", "fastapi", "flask", "next", "react", "svelte", "vue",
    ] {
        let detected =
            package_dependencies.contains(framework) || python_dependencies.contains(framework);
        push_detected_or_not(&mut contexts, "framework", framework, detected);
    }

    contexts.push(TechnicalContext {
        context_type: "scanner".to_string(),
        status: "unsupported".to_string(),
        value: Some("scanner behavior begins in Story 1.5".to_string()),
    });

    contexts
}

pub fn capture_dependency_manifests(application_path: &Path) -> Vec<DependencyManifest> {
    let files = list_files_sorted(application_path);
    vec![
        package_json_manifest(application_path, &files),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "package-lock.json",
            "package_lock",
            "npm",
            "package-lock.json detected but lockfile dependency extraction is deferred for Story 1.4",
        ),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "pnpm-lock.yaml",
            "pnpm_lock",
            "pnpm",
            "pnpm-lock.yaml detected but lockfile dependency extraction is deferred for Story 1.4",
        ),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "yarn.lock",
            "yarn_lock",
            "yarn",
            "yarn.lock detected but lockfile dependency extraction is deferred for Story 1.4",
        ),
        requirements_manifest(application_path, &files),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "pyproject.toml",
            "pyproject_toml",
            "unknown",
            "pyproject.toml detected but dependency extraction is deferred for Story 1.4; package manager is not identified (supports pip, poetry, hatch, pdm, flit, setuptools, and others)",
        ),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "Pipfile",
            "pipfile",
            "pipenv",
            "Pipfile detected but dependency extraction is deferred for Story 1.4",
        ),
        unsupported_or_missing_manifest(
            application_path,
            &files,
            "Pipfile.lock",
            "pipfile_lock",
            "pipenv",
            "Pipfile.lock detected but lockfile dependency extraction is deferred for Story 1.4",
        ),
    ]
}

fn review_scope_json(scope: &ReviewScope) -> String {
    let mut json = String::new();
    json.push_str("{\n");
    json.push_str(&format!(
        "  \"protocol_version\": \"{}\",\n",
        json_escape(&scope.protocol_version)
    ));
    json.push_str(&format!(
        "  \"review_scope_id\": \"{}\",\n",
        json_escape(&scope.review_scope_id)
    ));
    json.push_str(&format!(
        "  \"review_id\": \"{}\",\n",
        json_escape(&scope.review_id)
    ));
    json.push_str(&format!(
        "  \"generated_at\": \"{}\",\n",
        json_escape(&scope.generated_at)
    ));
    json.push_str("  \"selected_application\": {\n");
    json.push_str(&format!(
        "    \"application_id\": \"{}\",\n",
        json_escape(&scope.selected_application.application_id)
    ));
    json.push_str(&format!(
        "    \"display_name\": \"{}\"\n",
        json_escape(&scope.selected_application.display_name)
    ));
    json.push_str("  },\n");
    json.push_str("  \"selected_commit\": {\n");
    json.push_str(&format!(
        "    \"commit_sha\": \"{}\",\n",
        json_escape(&scope.selected_commit.commit_sha)
    ));
    json.push_str(&format!(
        "    \"source_control_system\": \"{}\"\n",
        json_escape(&scope.selected_commit.source_control_system)
    ));
    json.push_str("  },\n");
    json.push_str(&format!(
        "  \"repository_identity\": \"{}\",\n",
        json_escape(&scope.repository_identity)
    ));
    json.push_str("  \"runner\": {\n");
    json.push_str(&format!(
        "    \"name\": \"{}\",\n",
        json_escape(&scope.runner.name)
    ));
    json.push_str(&format!(
        "    \"version\": \"{}\"\n",
        json_escape(&scope.runner.version)
    ));
    json.push_str("  },\n");
    json.push_str("  \"technical_context\": [\n");
    for (index, context) in scope.technical_context.iter().enumerate() {
        json.push_str("    {");
        json.push_str(&format!(
            "\"context_type\": \"{}\", \"status\": \"{}\"",
            json_escape(&context.context_type),
            json_escape(&context.status)
        ));
        if let Some(value) = &context.value {
            json.push_str(&format!(", \"value\": \"{}\"", json_escape(value)));
        }
        json.push('}');
        if index + 1 != scope.technical_context.len() {
            json.push(',');
        }
        json.push('\n');
    }
    json.push_str("  ],\n");
    json.push_str("  \"dependency_manifests\": [\n");
    for (index, manifest) in scope.dependency_manifests.iter().enumerate() {
        json.push_str("    {");
        json.push_str(&format!(
            "\"manifest_type\": \"{}\", \"status\": \"{}\"",
            json_escape(&manifest.manifest_type),
            json_escape(&manifest.status)
        ));
        if let Some(path) = &manifest.path {
            json.push_str(&format!(", \"path\": \"{}\"", json_escape(path)));
        }
        json.push_str(&format!(
            ", \"package_manager\": \"{}\", \"dependency_count\": {}, \"dependencies\": {}",
            json_escape(&manifest.package_manager),
            manifest.dependency_count,
            json_string_array(&manifest.dependencies)
        ));
        if let Some(limitation) = &manifest.limitation {
            json.push_str(&format!(
                ", \"limitation\": \"{}\"",
                json_escape(limitation)
            ));
        }
        json.push('}');
        if index + 1 != scope.dependency_manifests.len() {
            json.push(',');
        }
        json.push('\n');
    }
    json.push_str("  ]\n");
    json.push_str("}\n");
    json
}

fn json_string_array(values: &[String]) -> String {
    let escaped = values
        .iter()
        .map(|value| format!("\"{}\"", json_escape(value)))
        .collect::<Vec<_>>();
    format!("[{}]", escaped.join(", "))
}

fn summary_limitations(scope: &ReviewScope) -> Vec<String> {
    let mut limitations = Vec::new();
    for context in &scope.technical_context {
        if context.status == "unsupported" {
            let value = context.value.as_deref().unwrap_or("unspecified");
            limitations.push(format!("{}: {value}", context.context_type));
        }
    }
    for manifest in &scope.dependency_manifests {
        if let Some(limitation) = &manifest.limitation {
            limitations.push(format!("{}: {limitation}", manifest.manifest_type));
        }
    }
    limitations
}

fn package_json_manifest(application_path: &Path, files: &[PathBuf]) -> DependencyManifest {
    let package_json_matches: Vec<&PathBuf> = files
        .iter()
        .filter(|path| file_name_eq(path, "package.json"))
        .collect();
    if package_json_matches.is_empty() {
        return manifest_not_found("package_json", "npm");
    }

    // Canonical path is the lexicographically first match (root-most, since the
    // sorted file list is ordered by normalized path string). Monorepos may have
    // dozens of package.jsons in subpackages; we union their dependency keys
    // and document the aggregation in the `limitation` field so the reader knows
    // the count spans multiple manifests.
    let primary = package_json_matches[0];
    let relative_path = relative_path_string(application_path, primary);

    let mut dependencies: BTreeSet<String> = BTreeSet::new();
    let mut malformed_count = 0usize;
    for path in &package_json_matches {
        let Ok(content) = fs::read_to_string(path) else {
            malformed_count += 1;
            continue;
        };
        if !looks_like_balanced_json_object(&content) {
            malformed_count += 1;
            continue;
        }
        dependencies.extend(parse_package_json_dependency_names(&content));
    }

    let deps_vec: Vec<String> = dependencies.into_iter().collect();

    let limitation = if package_json_matches.len() > 1 || malformed_count > 0 {
        let mut parts = Vec::new();
        if package_json_matches.len() > 1 {
            parts.push(format!(
                "aggregated {} package.json manifests across tree; canonical path is first (monorepo support)",
                package_json_matches.len()
            ));
        }
        if malformed_count > 0 {
            parts.push(format!(
                "{} unreadable or malformed package.json manifests skipped",
                malformed_count
            ));
        }
        Some(parts.join("; "))
    } else {
        None
    };

    DependencyManifest {
        manifest_type: "package_json".to_string(),
        status: if malformed_count == package_json_matches.len() {
            // If every single match failed to parse, report malformed.
            "malformed"
        } else {
            // At least one parsed successfully. Union deps from successful
            // parses; skipped malformed manifests are called out in
            // `limitation`.
            "detected"
        }
        .to_string(),
        path: Some(relative_path),
        package_manager: "npm".to_string(),
        dependency_count: deps_vec.len(),
        dependencies: deps_vec,
        limitation,
    }
}

fn requirements_manifest(application_path: &Path, files: &[PathBuf]) -> DependencyManifest {
    fn is_requirements_txt_family(path: &Path) -> bool {
        if file_name_eq(path, "requirements.txt") {
            return true;
        }
        let Some(parent_name) = path.parent().and_then(|p| p.file_name()) else {
            return false;
        };
        parent_name == "requirements" && extension_is(path, &["txt"])
    }

    let matches: Vec<&PathBuf> = files
        .iter()
        .filter(|p| is_requirements_txt_family(p))
        .collect();
    if matches.is_empty() {
        return manifest_not_found("requirements_txt", "pip");
    }

    // Canonical path: lexicographically first (root `requirements.txt` wins
    // when present, otherwise the `requirements/*.txt` sort winner). Dependencies
    // are the union across all matched files to support split dev/base/prod
    // conventions. Aggregation is called out in `limitation` when more than
    // one file participates.
    let primary = matches[0];
    let relative_path = relative_path_string(application_path, primary);

    let mut dependencies: BTreeSet<String> = BTreeSet::new();
    let mut unreadable_count = 0usize;
    for path in &matches {
        let Ok(content) = fs::read_to_string(path) else {
            unreadable_count += 1;
            continue;
        };
        dependencies.extend(parse_requirements_dependency_names(&content));
    }

    let deps_vec: Vec<String> = dependencies.into_iter().collect();

    let limitation = if matches.len() > 1 || unreadable_count > 0 {
        let mut parts = Vec::new();
        if matches.len() > 1 {
            parts.push(format!(
                "aggregated {} requirements files (requirements.txt + requirements/*.txt); canonical path is first",
                matches.len()
            ));
        }
        if unreadable_count > 0 {
            parts.push(format!(
                "{} unreadable requirements files skipped",
                unreadable_count
            ));
        }
        Some(parts.join("; "))
    } else {
        None
    };

    let status = if unreadable_count == matches.len() {
        "malformed"
    } else {
        "detected"
    };

    DependencyManifest {
        manifest_type: "requirements_txt".to_string(),
        status: status.to_string(),
        path: Some(relative_path),
        package_manager: "pip".to_string(),
        dependency_count: deps_vec.len(),
        dependencies: deps_vec,
        limitation,
    }
}

fn unsupported_or_missing_manifest(
    application_path: &Path,
    files: &[PathBuf],
    file_name: &str,
    manifest_type: &str,
    package_manager: &str,
    limitation: &str,
) -> DependencyManifest {
    if let Some(path) = files.iter().find(|path| file_name_eq(path, file_name)) {
        DependencyManifest {
            manifest_type: manifest_type.to_string(),
            status: "unsupported".to_string(),
            path: Some(relative_path_string(application_path, path)),
            package_manager: package_manager.to_string(),
            dependency_count: 0,
            dependencies: Vec::new(),
            limitation: Some(limitation.to_string()),
        }
    } else {
        manifest_not_found(manifest_type, package_manager)
    }
}

fn manifest_not_found(manifest_type: &str, package_manager: &str) -> DependencyManifest {
    DependencyManifest {
        manifest_type: manifest_type.to_string(),
        status: "not_found".to_string(),
        path: None,
        package_manager: package_manager.to_string(),
        dependency_count: 0,
        dependencies: Vec::new(),
        limitation: None,
    }
}

fn relative_path_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn push_detected_or_not(
    contexts: &mut Vec<TechnicalContext>,
    context_type: &str,
    value: &str,
    detected: bool,
) {
    contexts.push(TechnicalContext {
        context_type: context_type.to_string(),
        status: if detected { "detected" } else { "not_detected" }.to_string(),
        value: Some(value.to_string()),
    });
}

fn list_files_sorted(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    collect_files(root, &mut files);
    files.sort_by_key(|path| normalized_path_string(path));
    files
}

#[derive(Debug, Default)]
struct ScannerFileInventory {
    files: Vec<PathBuf>,
    coverage_limitations: Vec<String>,
}

fn list_scanner_files_sorted(root: &Path) -> ScannerFileInventory {
    let mut inventory = ScannerFileInventory::default();
    collect_scanner_files(root, root, &mut inventory);
    inventory
        .files
        .sort_by_key(|path| normalized_path_string(path));
    inventory.coverage_limitations.sort();
    inventory.coverage_limitations.dedup();
    inventory
}

fn collect_scanner_files(root: &Path, path: &Path, inventory: &mut ScannerFileInventory) {
    let Ok(metadata) = path.symlink_metadata() else {
        return;
    };

    if metadata.file_type().is_symlink() {
        return;
    }

    if metadata.is_file() {
        if metadata.len() > MAX_SCANNER_FILE_BYTES {
            inventory.coverage_limitations.push(format!(
                "Scanner traversal skipped oversized file {} ({} bytes); no coverage is claimed for it.",
                scanner_relative_path_string(root, path),
                metadata.len()
            ));
            return;
        }
        inventory.files.push(path.to_path_buf());
        return;
    }

    if !metadata.is_dir() {
        return;
    }

    if path != root
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(scanner_default_excluded_dir)
    {
        inventory.coverage_limitations.push(format!(
            "Scanner traversal skipped default-excluded directory {}; no coverage is claimed for it.",
            scanner_relative_path_string(root, path)
        ));
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| normalized_path_string(path));
    for child in paths {
        collect_scanner_files(root, &child, inventory);
    }
}

fn scanner_default_excluded_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | ".venv"
            | "venv"
            | "dist"
            | "build"
            | "coverage"
            | "__pycache__"
    )
}

fn collect_files(path: &Path, files: &mut Vec<PathBuf>) {
    // Use symlink_metadata so we can detect and skip symlinks. Symlinks are
    // deliberately not followed:
    //   (a) a symlink loop would otherwise cause unbounded recursion / OOM;
    //   (b) a directory symlink pointing outside the application root would
    //       pull in files from beyond the scope boundary and skew both signal
    //       detection and the review-scope identity hash.
    // Claim-safe posture: only physical files under the application root
    // contribute to scope identity and context detection.
    let Ok(metadata) = path.symlink_metadata() else {
        return;
    };

    if metadata.file_type().is_symlink() {
        return;
    }

    if metadata.is_file() {
        files.push(path.to_path_buf());
        return;
    }

    if !metadata.is_dir() {
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort_by_key(|path| normalized_path_string(path));

    for child in paths {
        collect_files(&child, files);
    }
}

fn file_name_eq(path: &Path, expected: &str) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn extension_is(path: &Path, expected: &[&str]) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            expected
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .unwrap_or(false)
}

fn parse_package_json_dependency_names(content: &str) -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    for section in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        if let Some(object) = json_object_section(content, section) {
            names.extend(
                quoted_object_keys(object)
                    .into_iter()
                    .map(|name| name.to_ascii_lowercase()),
            );
        }
    }
    names
}

fn looks_like_balanced_json_object(content: &str) -> bool {
    // Strip a UTF-8 byte order mark (U+FEFF) that Windows editors sometimes
    // prepend. Rust's str::trim() does NOT consider U+FEFF whitespace.
    let trimmed = content.trim_start_matches('\u{FEFF}').trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return false;
    }

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    let mut balanced_end: Option<usize> = None;
    for (offset, character) in trimmed.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }

        match character {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                if depth == 0 {
                    return false;
                }
                depth -= 1;
                if depth == 0 {
                    balanced_end = Some(offset + character.len_utf8());
                    // Do not break: any later non-whitespace means the outer
                    // object does NOT span the whole input → malformed.
                }
            }
            _ => {}
        }
    }

    // The balanced root object must span every byte of the trimmed input
    // (trailing whitespace only is tolerated). `{valid} + garbage` fails.
    match balanced_end {
        Some(end) if end == trimmed.len() => !in_string,
        _ => false,
    }
}

/// Search for a JSON object key `"name"` in `content`, honouring string-literal
/// and escape context. Returns the byte offset of the key's closing quote if
/// the marker is found as an actual object key (i.e. outside any string).
/// This avoids false positives when the marker text appears inside a JSON
/// string value (e.g. `{"description": "mentions \"dependencies\""}`).
fn find_json_object_key(content: &str, key: &str) -> Option<usize> {
    let marker = key.as_bytes();
    let bytes = content.as_bytes();
    let mut in_string = false;
    let mut escaped = false;
    let mut key_start: Option<usize> = None; // byte offset after opening " of a key

    let mut i = 0usize;
    while i < bytes.len() {
        if in_string {
            if escaped {
                escaped = false;
                i += 1;
                continue;
            }
            match bytes[i] {
                b'\\' => {
                    escaped = true;
                    i += 1;
                    continue;
                }
                b'"' => {
                    in_string = false;
                    // End of a string: if we were tracking a candidate key
                    // match and the length matches, verify the bytes.
                    if let Some(start) = key_start.take() {
                        let len = i - start;
                        if len == marker.len() && &bytes[start..i] == marker {
                            // Return byte position of the closing quote.
                            return Some(i);
                        }
                    }
                    i += 1;
                    continue;
                }
                _ => {
                    // Still inside a string; if we were tracking a key
                    // candidate and this byte doesn't match the marker, drop.
                    if let Some(start) = key_start {
                        let idx = i - start;
                        if idx >= marker.len() || bytes[i] != marker[idx] {
                            key_start = None;
                        }
                    }
                    i += 1;
                    continue;
                }
            }
        }

        match bytes[i] {
            b'"' => {
                in_string = true;
                key_start = Some(i + 1); // potential new key; we check on close
                i += 1;
            }
            _ => {
                // Outside a string: still could have stale key_start from a
                // non-key string, but `take()` on close already consumed it
                // if the string ended. Reset defensively.
                key_start = None;
                i += 1;
            }
        }
    }

    None
}

/// Advance a byte cursor past JSON whitespace (space / tab / newline / CR).
fn skip_ws(bytes: &[u8], mut pos: usize) -> usize {
    while pos < bytes.len() && matches!(bytes[pos], b' ' | b'\t' | b'\n' | b'\r') {
        pos += 1;
    }
    pos
}

fn json_object_section<'a>(content: &'a str, section: &str) -> Option<&'a str> {
    // Find the section key as a genuine JSON object key (not inside a string).
    // `key_close` points at the closing `"` of the matched `"section"` key.
    let key_close = find_json_object_key(content, section)?;
    let bytes = content.as_bytes();
    let mut cursor = key_close + 1;
    cursor = skip_ws(bytes, cursor);
    // Key must be followed by `:`.
    if cursor >= bytes.len() || bytes[cursor] != b':' {
        return None;
    }
    cursor += 1;
    cursor = skip_ws(bytes, cursor);
    // Value must be a JSON object: the next non-whitespace byte must be `{`.
    // This ensures we do not silently grab the next unrelated object further
    // down the document when the key's actual value is a string / array /
    // number / null / boolean.
    if cursor >= bytes.len() || bytes[cursor] != b'{' {
        return None;
    }
    let object_start = cursor;

    // Walk bytes from `object_start` with string/escape-aware depth tracking
    // to find the matching closing `}` and the byte range of the object's
    // *interior* (excluding the surrounding braces).
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            cursor += 1;
            continue;
        }

        match byte {
            b'"' => {
                in_string = true;
                cursor += 1;
            }
            b'{' => {
                depth += 1;
                cursor += 1;
            }
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    // Interior lives between the opening `{` (object_start)
                    // and this closing `}` (cursor).
                    let interior_start = object_start + 1;
                    let interior_end = cursor;
                    return Some(&content[interior_start..interior_end]);
                }
                cursor += 1;
            }
            _ => {
                cursor += 1;
            }
        }
    }

    None
}

fn quoted_object_keys(section: &str) -> Vec<String> {
    let mut keys = Vec::new();
    let mut index = 0usize;
    let bytes = section.as_bytes();

    while index < bytes.len() {
        if bytes[index] != b'"' {
            index += 1;
            continue;
        }

        let start = index + 1;
        let mut end = start;
        let mut escaped = false;
        // Track whether this string contains any escapes. If it does, we run
        // an unescape pass before storing the key; otherwise we slice
        // directly from `&section[start..end]`.
        let mut has_escapes = false;
        while end < bytes.len() {
            if escaped {
                escaped = false;
            } else if bytes[end] == b'\\' {
                escaped = true;
                has_escapes = true;
            } else if bytes[end] == b'"' {
                break;
            }
            end += 1;
        }

        if end >= bytes.len() {
            break;
        }

        // Confirm the closing quote is followed by optional whitespace and a `:`
        // before we treat the string as a key.
        let cursor = end + 1;
        let after_colon = skip_ws(bytes, cursor);
        if after_colon >= bytes.len() || bytes[after_colon] != b':' {
            index = end + 1;
            continue;
        }

        let raw = &section[start..end];
        if has_escapes {
            if let Some(decoded) = unescape_json_string(raw) {
                keys.push(decoded);
            }
        } else {
            keys.push(raw.to_string());
        }

        index = end + 1;
    }

    keys
}

/// Decode the body of a JSON string (excluding surrounding quotes).
/// Handles `\" \\ \/ \b \f \n \r \t` plus `\uXXXX` (including
/// surrogate pairs for non-BMP code points). Returns `None` if the
/// escape sequences are malformed (e.g. truncated `\u`).
fn unescape_json_string(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    // Pending low surrogate from a previous \uD800..\uDBFF. Per JSON
    // spec an unpaired high surrogate is decoded as the replacement character.
    let mut pending_high: Option<u16> = None;

    fn push_code_unit(out: &mut String, pending_high: &mut Option<u16>, unit: u16) {
        match (*pending_high, unit) {
            (Some(high), low @ 0xDC00..=0xDFFF) => {
                // Combine into a non-BMP code point.
                let code = 0x1_0000 + (((high - 0xD800) as u32) * 0x400 + ((low - 0xDC00) as u32));
                if let Some(ch) = char::from_u32(code) {
                    out.push(ch);
                } else {
                    out.push('\u{FFFD}');
                }
                *pending_high = None;
            }
            (Some(_unpaired_high), other_unit) => {
                // Previous high surrogate went unpaired: emit replacement,
                // then handle `other_unit` normally.
                out.push('\u{FFFD}');
                *pending_high = None;
                push_code_unit(out, pending_high, other_unit);
            }
            (None, unit @ 0xD800..=0xDBFF) => {
                *pending_high = Some(unit);
            }
            (None, _unit @ 0xDC00..=0xDFFF) => {
                // Lone low surrogate.
                out.push('\u{FFFD}');
            }
            (None, unit) => {
                // BMP code point.
                if let Some(ch) = char::from_u32(unit as u32) {
                    out.push(ch);
                } else {
                    out.push('\u{FFFD}');
                }
            }
        }
    }

    /// Push a `char` into the output, flushing any pending unpaired high
    /// surrogate first with a replacement character. Used for raw UTF-8
    /// characters from the source string (already decoded to code points).
    fn push_char(out: &mut String, pending_high: &mut Option<u16>, ch: char) {
        if pending_high.is_some() {
            out.push('\u{FFFD}');
            *pending_high = None;
        }
        let code = ch as u32;
        if code >= 0x1_0000 {
            // Non-BMP: encode as a UTF-16 surrogate pair so that any
            // subsequent `\uXXXX` low-surrogate in the stream (unusual in
            // raw UTF-8, but reachable e.g. via a mixed source) pairs
            // consistently.
            let reduced = code - 0x1_0000;
            let high = 0xD800 | ((reduced >> 10) as u16);
            let low = 0xDC00 | ((reduced & 0x3FF) as u16);
            push_code_unit(out, pending_high, high);
            push_code_unit(out, pending_high, low);
        } else {
            push_code_unit(out, pending_high, code as u16);
        }
    }

    fn parse_hex4(bytes: &[u8], at: usize) -> Option<u16> {
        if at + 4 > bytes.len() {
            return None;
        }
        let mut value: u16 = 0;
        for shift in [12u32, 8, 4, 0] {
            let digit = bytes[at + ((12 - shift as usize) / 4)];
            let digit_value = match digit {
                b'0'..=b'9' => digit - b'0',
                b'a'..=b'f' => digit - b'a' + 10,
                b'A'..=b'F' => digit - b'A' + 10,
                _ => return None,
            } as u16;
            value |= digit_value << shift;
        }
        Some(value)
    }

    while i < bytes.len() {
        let b = bytes[i];
        if b != b'\\' {
            // Regular byte. Note: raw is a valid str, so non-escaped bytes are
            // valid UTF-8; push the original `char` so multi-byte
            // characters pass through unchanged.
            let ch = raw[i..].chars().next()?;
            push_char(&mut out, &mut pending_high, ch);
            i += ch.len_utf8();
            continue;
        }

        // Escape sequence.
        i += 1;
        if i >= bytes.len() {
            return None;
        }
        match bytes[i] {
            b'"' => {
                push_char(&mut out, &mut pending_high, '"');
                i += 1;
            }
            b'\\' => {
                push_char(&mut out, &mut pending_high, '\\');
                i += 1;
            }
            b'/' => {
                push_char(&mut out, &mut pending_high, '/');
                i += 1;
            }
            b'b' => {
                push_code_unit(&mut out, &mut pending_high, 0x08);
                i += 1;
            }
            b'f' => {
                push_code_unit(&mut out, &mut pending_high, 0x0C);
                i += 1;
            }
            b'n' => {
                push_char(&mut out, &mut pending_high, '\n');
                i += 1;
            }
            b'r' => {
                push_char(&mut out, &mut pending_high, '\r');
                i += 1;
            }
            b't' => {
                push_char(&mut out, &mut pending_high, '\t');
                i += 1;
            }
            b'u' => {
                i += 1;
                let unit = parse_hex4(bytes, i)?;
                i += 4;
                push_code_unit(&mut out, &mut pending_high, unit);
            }
            _ => return None,
        }
    }

    // Trailing unpaired high surrogate.
    if pending_high.is_some() {
        out.push('\u{FFFD}');
    }

    Some(out)
}

fn parse_requirements_dependency_names(content: &str) -> BTreeSet<String> {
    content
        .lines()
        .filter_map(requirement_name)
        .map(normalize_pypi_name)
        .collect()
}

/// PEP 503 normalization: lowercase then collapse every run of `[._-]` to a
/// single `-`. Ensures `zope.interface`, `Zope_Interface`, and `zope-interface`
/// are stored and compared as the same canonical dependency name.
fn normalize_pypi_name(raw: String) -> String {
    let lower = raw.to_ascii_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_dash_run = false;
    for ch in lower.chars() {
        match ch {
            '.' | '_' | '-' => {
                if !in_dash_run && !out.is_empty() {
                    out.push('-');
                    in_dash_run = true;
                }
            }
            other => {
                out.push(other);
                in_dash_run = false;
            }
        }
    }
    // Trim trailing dashes introduced by the loop (e.g. trailing `.`).
    while out.ends_with('-') {
        out.pop();
    }
    out
}

fn requirement_name(line: &str) -> Option<String> {
    // Strip a trailing `# comment` (but NOT an in-line `#egg=...` fragment,
    // which we want to extract later).
    let (body, trailing_comment) = split_requirements_comment(line);
    let trimmed = body.trim();

    // `-r other.txt`, `-c constraints.txt`, `-e .` / `-e git+https://...` etc.
    // are include/constraint/editable directives. We deliberately do NOT
    // recurse into `-r` targets (avoids FS trust boundary from an attacker
    // controlling the file list); the sibling `requirements/*.txt` aggregation
    // already covers the common convention.
    let first_byte = trimmed.as_bytes().first().copied();
    if first_byte == Some(b'-') {
        // But `-e` with an `#egg=name` fragment names the project. Try to
        // salvage the egg name before bailing.
        if let Some(egg) = extract_egg_fragment(trimmed, trailing_comment) {
            return Some(egg);
        }
        return None;
    }

    if trimmed.is_empty() {
        return None;
    }

    // PEP 508 `name @ url` form: split on `@` before any version specifiers or
    // extras, with or without surrounding whitespace.
    let at_split = trimmed.split_at_shorthand().or_else(|| {
        // Fallback: byte-wise find on `@` that is not inside an `[extras]` block.
        split_on_unquoted_at(trimmed)
    });

    let before_spec = match at_split {
        Some((name_part, _url)) => name_part,
        None => trimmed,
    };

    // Strip `[extras]` suffix before looking for version separators.
    let pre_extras = match before_spec.find('[') {
        Some(bracket) => &before_spec[..bracket],
        None => before_spec,
    };

    // Standard separators: `< > = ! ~ ; [ ]` and whitespace.
    let end = pre_extras
        .find(|character: char| {
            character == '='
                || character == '<'
                || character == '>'
                || character == '~'
                || character == '!'
                || character == '['
                || character == ';'
                || character.is_whitespace()
        })
        .unwrap_or(pre_extras.len());
    let mut name = pre_extras[..end].trim().to_string();

    // If we found no `@` split AND no version specifier, the line might be a
    // URL form like `git+https://github.com/psf/requests.git` with no `name @`.
    // Fall back to `#egg=name` from the original line / trailing comment.
    if name.is_empty() || name.contains("://") {
        if let Some(egg) = extract_egg_fragment(trimmed, trailing_comment) {
            return Some(egg);
        }
        // A pure URL with no egg fragment cannot be attributed to a project
        // name; drop it rather than storing the URL as a fake dependency.
        return None;
    }

    // Inline `#egg=name` on a line that already names a package wins — it's
    // the intended project name (e.g. VCS references with an explicit name
    // followed by `#egg=canonical-name`).
    if let Some(egg) = extract_egg_fragment(trimmed, trailing_comment) {
        name = egg;
    }

    Some(name).filter(|n| !n.is_empty())
}

/// Split a requirements.txt line into (body, trailing_comment) where
/// `trailing_comment` is everything after the FIRST `#` that does not appear
/// inside a URL scheme (heuristic: `#` is preceded by whitespace or start of
/// line, or follows a non-URL token).
///
/// This keeps URL fragments like `git+https://...#egg=requests` intact in the
/// body while stripping pure comments like `# vendored copy`.
fn split_requirements_comment(line: &str) -> (&str, &str) {
    let bytes = line.as_bytes();
    let mut hash_at: Option<usize> = None;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            // `#` counts as a comment start only if:
            //   - it is at the start of the line, or
            //   - the previous byte is whitespace.
            // Otherwise (e.g. `://...#egg=...`) the `#` is a URL fragment and
            // belongs to the body.
            let is_comment_start = i == 0 || bytes[i - 1].is_ascii_whitespace();
            if is_comment_start {
                hash_at = Some(i);
                break;
            }
        }
        i += 1;
    }
    match hash_at {
        Some(idx) => (&line[..idx], &line[idx..]),
        None => (line, ""),
    }
}

/// Extract the value of `#egg=NAME` from a requirements line. The egg marker
/// may appear in the body portion (as a URL fragment) or in the trailing
/// comment. Returns the project name with trailing separators/version stripped.
fn extract_egg_fragment(body: &str, trailing_comment: &str) -> Option<String> {
    let needles = ["#egg=", "&egg=", "#egg%3D", "%23egg%3D"];
    for haystack in [body, trailing_comment] {
        for needle in needles {
            if let Some(at) = haystack.find(needle) {
                let rest = &haystack[at + needle.len()..];
                let end = rest
                    .find(|ch: char| {
                        ch == '&' || ch == '#' || ch == ';' || ch == '=' || ch.is_whitespace()
                    })
                    .unwrap_or(rest.len());
                let name = rest[..end].trim().to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    None
}

/// Returns `(name, url)` when `line` matches `NAME [@] URL` with the `@`
/// surrounded by any amount of whitespace.
trait ShorthandAtSplit {
    fn split_at_shorthand(&self) -> Option<(&str, &str)>;
}

impl<'a> ShorthandAtSplit for &'a str {
    fn split_at_shorthand(&self) -> Option<(&'a str, &'a str)> {
        // Find the first `@` that is preceded by whitespace (so `name@url`
        // without whitespace falls through to byte-level split; but
        // `name  @ url` is unambiguous). Without whitespace a bare `name@url`
        // could be either (a) a direct URL or (b) a name with a stray `@`; we
        // use split_on_unquoted_at for that case and let it disambiguate by
        // checking the suffix for `://`.
        let bytes = self.as_bytes();
        for (i, byte) in bytes.iter().copied().enumerate() {
            if byte == b'@' && i > 0 && bytes[i - 1].is_ascii_whitespace() {
                let after = i + 1;
                // Skip trailing whitespace on the LHS.
                let name_end = self[..i].trim_end().len();
                let url_start = self[after..]
                    .find(|c: char| !c.is_whitespace())
                    .unwrap_or(self[after..].len())
                    + after;
                return Some((&self[..name_end], &self[url_start..]));
            }
        }
        None
    }
}

fn split_on_unquoted_at(s: &str) -> Option<(&str, &str)> {
    // Only split on `@` if the suffix looks like a URL (contains `://`).
    let bytes = s.as_bytes();
    for (i, _) in bytes
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, b)| *b == b'@')
    {
        let after = &s[i + 1..];
        if after.contains("://") {
            return Some((s[..i].trim_end(), after.trim_start()));
        }
    }
    None
}

fn display_name_for_path(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.display().to_string())
}

fn slugify_identifier(value: &str) -> String {
    let mut output = String::new();
    let mut last_was_dash = false;

    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            output.push(character);
            last_was_dash = false;
        } else if !last_was_dash && !output.is_empty() {
            output.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "selected-application".to_string()
    } else {
        trimmed.to_string()
    }
}

fn repository_identity_hash(application_id: &str, selected_commit: &str) -> String {
    // Identity is a function of (application_id, selected_commit) only, so the
    // same physical repo at different mount points / local paths produces an
    // identical repository identity. See story 1.4 review decision DN-1 (B).
    let value = json!({
        "application_id": application_id,
        "selected_commit": selected_commit,
        "source_control_system": "git"
    });
    let canonical_input = canonicalize_json_value(&value);
    sha256_id(canonical_input.as_bytes())
}

fn review_scope_identity_hash(
    generated_at: &str,
    application_id: &str,
    selected_commit: &str,
    repository_identity: &str,
    review_id: &str,
) -> String {
    let value = json!({
        "generated_at": generated_at,
        "protocol_version": PROTOCOL_VERSION,
        "repository_identity": repository_identity,
        "review_id": review_id,
        "runner_name": RUNNER_NAME,
        "runner_version": runner_version(),
        "selected_application_id": application_id,
        "selected_commit": selected_commit
    });
    let canonical_input = canonicalize_json_value(&value);
    sha256_id(canonical_input.as_bytes())
}

fn normalized_path_string(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn utc_rfc3339_from_unix_seconds(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i64, i64, i64) {
    // Howard Hinnant's `days_from_civil` inverse, public domain.
    // Reference: https://howardhinnant.github.io/date_algorithms.html
    let shifted_days = days_since_unix_epoch + 719_468;
    // Explicit parentheses around the if-expr below: era = (if-expr) / 146_097.
    // A naive mental parse of the unparenthesised form can incorrectly bind
    // the division inside the else branch, which would shift years by ~400.
    let era = (if shifted_days >= 0 {
        shifted_days
    } else {
        shifted_days - 146_096
    }) / 146_097;
    let day_of_era = shifted_days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    let adjusted_year = year + if month <= 2 { 1 } else { 0 };
    (adjusted_year, month, day)
}

fn json_escape(value: &str) -> String {
    let mut output = String::new();
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            // U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR: valid in
            // RFC 8259 JSON strings, but older JS parsers treat them as line
            // terminators. Emit explicit \u escapes for interop.
            '\u{2028}' => output.push_str("\\u2028"),
            '\u{2029}' => output.push_str("\\u2029"),
            character if character.is_control() => {
                output.push_str("\\u");
                output.push_str(&hex_u16(character as u16));
            }
            // Non-BMP code points (U+10000 and above): `char as u16` truncates.
            // JSON requires UTF-16 surrogate pairs \uXXXX\uXXXX.
            character if (character as u32) >= 0x1_0000 => {
                let code = character as u32 - 0x1_0000;
                let high = 0xD800 | ((code >> 10) as u16);
                let low = 0xDC00 | ((code & 0x3FF) as u16);
                output.push_str("\\u");
                output.push_str(&hex_u16(high));
                output.push_str("\\u");
                output.push_str(&hex_u16(low));
            }
            character => output.push(character),
        }
    }
    output
}

fn hex_u16(value: u16) -> String {
    let digits = b"0123456789abcdef";
    let mut output = String::with_capacity(4);
    for shift in [12, 8, 4, 0] {
        let index = ((value >> shift) & 0x0f) as usize;
        output.push(char::from(digits[index]));
    }
    output
}

pub fn sha256_id(input: &[u8]) -> String {
    format!("sha256:{}", sha256_hex(input))
}

fn sha256_hex(input: &[u8]) -> String {
    format!("{:x}", Sha256::digest(input))
}

#[cfg(test)]
mod tests {
    use super::{
        RUNNER_NAME, evidence_boundary, is_utc_rfc3339_timestamp, runner_version, sha256_id,
        validate_size_bytes_js_safe,
    };

    #[test]
    fn scaffold_keeps_demo_boundary_visible() {
        assert_eq!(evidence_boundary(), "synthetic-demo-only");
    }

    #[test]
    fn exposes_runner_identity_from_package_metadata() {
        assert_eq!(RUNNER_NAME, "codeattest-local-runner");
        assert_eq!(runner_version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn sha256_matches_known_test_vector() {
        assert_eq!(
            sha256_id(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    // C8-02: Rust must accept the same UTC RFC 3339 contract as the schema
    // and JS/protocol-ts validators (protocol/schemas/shared-definitions.schema.json,
    // packages/protocol-ts/src/validation.ts).
    #[test]
    fn utc_rfc3339_timestamp_accepts_seconds_precision_z() {
        assert!(is_utc_rfc3339_timestamp("2026-07-10T00:20:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_millisecond_fraction() {
        assert!(is_utc_rfc3339_timestamp("2026-07-10T00:20:00.123Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_nanosecond_fraction() {
        assert!(is_utc_rfc3339_timestamp("2026-07-10T00:20:00.123456789Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_explicit_utc_offset() {
        assert!(is_utc_rfc3339_timestamp("2026-07-10T00:20:00+00:00"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_fraction_with_explicit_utc_offset() {
        assert!(is_utc_rfc3339_timestamp("2026-07-10T00:20:00.5+00:00"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_pre_1970_year() {
        // No year floor in the schema (see C8-02); the Rust-only year < 1970
        // guard was removed so all three runtimes agree.
        assert!(is_utc_rfc3339_timestamp("1969-07-10T00:20:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_invalid_month() {
        assert!(!is_utc_rfc3339_timestamp("2026-13-10T00:20:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_invalid_leap_day() {
        assert!(!is_utc_rfc3339_timestamp("2026-02-29T00:20:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_accepts_leap_day_in_leap_year() {
        assert!(is_utc_rfc3339_timestamp("2028-02-29T00:20:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_hour_out_of_range() {
        assert!(!is_utc_rfc3339_timestamp("2026-07-10T24:00:00Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_too_many_fractional_digits() {
        assert!(!is_utc_rfc3339_timestamp("2026-07-10T00:20:00.1234567890Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_empty_fraction() {
        assert!(!is_utc_rfc3339_timestamp("2026-07-10T00:20:00.Z"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_unknown_local_offset() {
        // -00:00 is RFC 3339 "unknown local offset", not UTC; the schema
        // pattern only allows Z or +00:00 (see scripts/protocol-check.mjs
        // unknown_local_utc_offset expectations).
        assert!(!is_utc_rfc3339_timestamp("2026-07-10T00:20:00-00:00"));
    }

    #[test]
    fn utc_rfc3339_timestamp_rejects_non_utc_offset() {
        assert!(!is_utc_rfc3339_timestamp("2026-07-10T00:20:00+01:00"));
    }

    // C8-07: Rust must accept/reject size_bytes at the exact same boundary as
    // the schema/JS/protocol-ts Number.MAX_SAFE_INTEGER cap.
    #[test]
    fn size_bytes_js_safe_accepts_max_safe_integer() {
        assert!(validate_size_bytes_js_safe(9_007_199_254_740_991).is_ok());
    }

    #[test]
    fn size_bytes_js_safe_rejects_one_past_max_safe_integer() {
        assert!(validate_size_bytes_js_safe(9_007_199_254_740_992).is_err());
    }

    #[test]
    fn size_bytes_js_safe_accepts_zero() {
        assert!(validate_size_bytes_js_safe(0).is_ok());
    }
}
