use std::path::PathBuf;

use onevps_local_runner_scaffold::{
    DisclosureConfigureInput, DisclosurePolicyConfig, DisclosureRedactionConfig,
    DisclosureRetentionConfig, format_disclosure_policy_summary, initialize_disclosure_policy,
};

const REVIEW_SCOPE_REF: &str =
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SCANNER_FINDING_SET_REF: &str =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

#[test]
fn disclosure_policy_defaults_to_balanced_finding_context_mode() {
    let result = initialize_disclosure_policy(input(base_config()))
        .expect("default disclosure config should build");

    assert!(result.coverage_mode_defaulted);
    assert_eq!(result.policy.coverage_mode, "finding_context_snippets");
    assert_eq!(
        result.policy.scanner_finding_set_ref.as_deref(),
        Some(SCANNER_FINDING_SET_REF)
    );
    assert!(result.policy.snippet_policy.allow_raw_snippets);
    assert_eq!(result.policy.snippet_policy.max_snippet_chars, 800);
    assert_eq!(result.policy.snippet_policy.context_lines, 2);
    assert_eq!(
        result.policy.snippet_policy.raw_snippet_default_class,
        "transient_source_derived"
    );
    assert!(
        result
            .policy
            .warnings
            .iter()
            .any(|warning| warning.contains("source-code disclosure"))
    );

    let repeat =
        initialize_disclosure_policy(input(base_config())).expect("same config should build again");
    assert_eq!(
        result.policy.disclosure_policy_id,
        repeat.policy.disclosure_policy_id
    );
}

#[test]
fn metadata_only_policy_excludes_snippets_and_records_attestation_warning() {
    let mut config = base_config();
    config.coverage_mode = Some("metadata-only".to_string());
    config.include_scanner_findings = Some(false);

    let result = initialize_disclosure_policy(DisclosureConfigureInput {
        scanner_finding_set_ref: None,
        ..input(config)
    })
    .expect("metadata-only config should build without scanner findings");

    assert_eq!(result.policy.coverage_mode, "metadata_only");
    assert!(!result.policy.snippet_policy.allow_raw_snippets);
    assert_eq!(result.policy.snippet_policy.max_snippet_chars, 0);
    assert_eq!(result.policy.snippet_policy.context_lines, 0);
    assert!(result.policy.scanner_finding_set_ref.is_none());
    assert!(
        result
            .policy
            .warnings
            .iter()
            .any(|warning| warning.contains("expert confidence may be lower"))
    );
    assert!(
        result
            .policy
            .warnings
            .iter()
            .any(|warning| warning.contains("snippets were not provided"))
    );
}

#[test]
fn extended_mode_records_selected_files_and_areas_without_contents() {
    let mut config = base_config();
    config.coverage_mode = Some("extended".to_string());
    config.selected_files_or_areas = vec!["src/app.ts".to_string(), "area:auth-flow".to_string()];
    config.max_snippet_chars = Some(1200);
    config.context_lines = Some(5);

    let result = initialize_disclosure_policy(input(config)).expect("extended config should build");

    assert_eq!(
        result.policy.coverage_mode,
        "extended_approved_snippets_or_targeted_files"
    );
    assert_eq!(
        result.policy.snippet_policy.selection_behavior,
        "extended_selected_files_or_areas"
    );
    assert_eq!(
        result.policy.snippet_policy.selected_files_or_areas,
        vec!["src/app.ts", "area:auth-flow"]
    );
    assert!(
        result
            .policy
            .warnings
            .iter()
            .any(|warning| warning.contains("increases disclosure"))
    );
}

#[test]
fn rejects_obsolete_coverage_modes_and_unsafe_extended_paths() {
    let mut obsolete = base_config();
    obsolete.coverage_mode = Some("targeted_snippets".to_string());
    let error = initialize_disclosure_policy(input(obsolete)).expect_err("old mode should fail");
    assert!(error.to_string().contains("invalid coverage_mode"));

    let mut traversal = base_config();
    traversal.coverage_mode = Some("extended_approved_snippets_or_targeted_files".to_string());
    traversal.selected_files_or_areas = vec!["../secrets.rs".to_string()];
    let error = initialize_disclosure_policy(input(traversal)).expect_err("traversal should fail");
    assert!(error.to_string().contains("root escapes or traversal"));

    let mut empty_area = base_config();
    empty_area.coverage_mode = Some("extended_approved_snippets_or_targeted_files".to_string());
    empty_area.selected_files_or_areas = vec!["area:".to_string()];
    let error =
        initialize_disclosure_policy(input(empty_area)).expect_err("empty area should fail");
    assert!(
        error
            .to_string()
            .contains("area references must be non-empty")
    );

    let mut windows_drive = base_config();
    windows_drive.coverage_mode = Some("extended_approved_snippets_or_targeted_files".to_string());
    windows_drive.selected_files_or_areas = vec!["C:\\temp\\secrets.rs".to_string()];
    let error =
        initialize_disclosure_policy(input(windows_drive)).expect_err("drive path should fail");
    assert!(error.to_string().contains("Windows drive prefixes"));
}

#[test]
fn retained_source_requires_explicit_opt_in_and_period() {
    let mut missing_period = base_config();
    missing_period.retention = Some(DisclosureRetentionConfig {
        raw_snippet_class: Some("customer_opt_in_retained_source".to_string()),
        targeted_file_class: None,
        retain_source_opt_in: Some(true),
        retention_period: None,
    });
    let error = initialize_disclosure_policy(input(missing_period))
        .expect_err("retained source without a period should fail");
    assert!(error.to_string().contains("defined retention_period"));

    let mut retained = base_config();
    retained.retention = Some(DisclosureRetentionConfig {
        raw_snippet_class: Some("customer_opt_in_retained_source".to_string()),
        targeted_file_class: None,
        retain_source_opt_in: Some(true),
        retention_period: Some("30_days".to_string()),
    });
    let result = initialize_disclosure_policy(input(retained))
        .expect("explicit retained-source opt-in should build");
    assert_eq!(
        result.policy.retention_policy.raw_snippet_class,
        "customer_opt_in_retained_source"
    );
    assert_eq!(result.policy.retention_policy.retention_period, "30_days");
}

#[test]
fn summary_is_monochrome_claim_safe_and_redaction_limited() {
    let mut config = base_config();
    config.redaction = Some(DisclosureRedactionConfig {
        enabled: true,
        profile: Some("local-demo-redaction".to_string()),
        configuration_version: Some("local-demo-redaction-v1".to_string()),
    });
    let result =
        initialize_disclosure_policy(input(config)).expect("redaction config should build");
    let summary = format_disclosure_policy_summary(
        &result,
        &PathBuf::from(".codeattest/disclosure-policy.json"),
    );
    let lower = summary.to_ascii_lowercase();

    assert!(summary.contains("Disclosure policy configured"));
    assert!(summary.contains("Finding-context snippets balanced default was applied"));
    assert!(summary.contains("secret detection cannot prove absence of secrets"));
    assert!(summary.contains("Local-only boundary:"));
    assert!(!summary.contains("\u{1b}["));
    assert!(!summary.contains("Math.random()"));
    assert!(!lower.contains("no vulnerabilities"));
    assert!(!lower.contains("receipt"));
    assert!(!lower.contains("submission"));
}

fn input(config: DisclosurePolicyConfig) -> DisclosureConfigureInput {
    DisclosureConfigureInput {
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        scanner_finding_set_ref: Some(SCANNER_FINDING_SET_REF.to_string()),
        output_path: PathBuf::from(".codeattest/disclosure-policy.json"),
        created_at: "2026-07-09T00:00:00Z".to_string(),
        config,
    }
}

fn base_config() -> DisclosurePolicyConfig {
    DisclosurePolicyConfig {
        coverage_mode: None,
        include_metadata: None,
        include_dependency_information: None,
        include_scanner_findings: None,
        include_raw_snippets: None,
        include_targeted_files: None,
        max_snippet_chars: None,
        context_lines: None,
        selected_files_or_areas: Vec::new(),
        redaction: None,
        retention: None,
    }
}
