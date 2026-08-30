use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::{
    DisclosureConfigureInput, DisclosurePolicyConfig, DisclosureRedactionConfig,
    DisclosureRetentionConfig, ManifestPreviewInput, RegexScannerRule, ScanRunInput,
    ScopeInitInput, SemgrepJsonInput, format_manifest_preview_summary,
    initialize_and_write_disclosure_policy, initialize_and_write_local_scan,
    initialize_and_write_manifest_preview, initialize_and_write_review_scope,
    initialize_manifest_preview,
};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn manifest_preview_builds_complete_local_preview_without_source_contents() {
    let fixture = manifest_fixture("complete_local_preview");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let output_path = fixture.join("out/outbound-manifest.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let input = ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: Some(scanner_path.clone()),
        disclosure_policy_path: policy_path.clone(),
        output_path: output_path.clone(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    };
    let manifest = initialize_and_write_manifest_preview(input.clone())
        .expect("manifest preview should build from local protocol artifacts");
    let repeat = initialize_manifest_preview(input).expect("same manifest input should rebuild");

    assert_eq!(manifest.manifest_id, repeat.manifest_id);
    assert!(manifest.manifest_id.starts_with("sha256:"));
    assert_eq!(manifest.coverage_mode, "finding_context_snippets");
    assert_eq!(manifest.package_preview_state.state, "preview_generated");
    assert!(!manifest.package_preview_state.send_ready);
    assert!(manifest.package_preview_state.local_only);
    assert_eq!(manifest.approval.approval_state, "not_requested");
    assert_eq!(manifest.evidence_categories.len(), 7);
    assert_eq!(
        manifest
            .selected_scope_summary
            .dependency_manifest_total_count,
        8
    );
    assert_eq!(
        manifest
            .selected_scope_summary
            .dependency_manifest_detected_count,
        1
    );

    let dependencies = category(&manifest, "dependencies");
    assert_eq!(dependencies.count, 1);
    assert!(
        dependencies
            .details
            .join(" ")
            .contains("1 detected of 8 total")
    );

    let raw = category(&manifest, "raw_snippets");
    assert!(raw.included);
    assert!(raw.source_code_disclosure);
    assert_eq!(raw.source_derived_class, "transient_source_derived");
    assert_eq!(
        raw.snippet_controls.as_ref().unwrap().max_snippet_chars,
        800
    );
    assert!(
        raw.limitation
            .contains("secret detection cannot prove absence of secrets")
    );

    let never_collected = category(&manifest, "never_collected_items");
    let never_collected_text = never_collected.details.join(" ").to_ascii_lowercase();
    assert!(never_collected_text.contains("complete repository archive"));
    assert!(never_collected_text.contains("full git history"));
    assert!(never_collected_text.contains("local environment secrets"));

    let summary = format_manifest_preview_summary(&manifest, &output_path);
    assert!(summary.contains("Outbound manifest preview generated"));
    assert!(summary.contains("manifest_id: sha256:"));
    assert!(summary.contains("Coverage Mode: Finding-context snippets (finding_context_snippets)"));
    assert!(summary.contains("Local-only boundary:"));
    assert!(summary.contains("source-code disclosure"));
    assert!(summary.contains("secret detection cannot prove absence of secrets"));
    assert!(!summary.contains("eval('1 + 1')"));
    assert!(!summary.contains("\u{1b}["));
    assert!(!summary.to_ascii_lowercase().contains("no vulnerabilities"));
    assert!(!summary.to_ascii_lowercase().contains("approved by"));
    assert!(!summary.to_ascii_lowercase().contains("submitted"));

    let json = fs::read_to_string(output_path).expect("manifest json should be written");
    assert!(json.contains(r#""manifest_id": "sha256:"#));
    assert!(json.contains(r#""package_preview_state""#));
    assert!(json.contains(r#""approval_state": "not_requested""#));
    assert!(!json.contains("eval('1 + 1')"));
    assert!(!json.contains("selectedApplication"));
}

#[test]
fn metadata_only_manifest_excludes_snippets_and_records_lower_confidence_warning() {
    let fixture = manifest_fixture("metadata_only_preview");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let output_path = fixture.join("outbound-manifest.json");

    let mut config = base_config();
    config.coverage_mode = Some("metadata_only".to_string());
    config.include_scanner_findings = Some(false);
    write_scope_and_policy(&app, &scope_path, &policy_path, config);

    let manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: policy_path,
        output_path,
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("metadata-only manifest should not require scanner findings");

    assert_eq!(manifest.coverage_mode, "metadata_only");
    assert!(!category(&manifest, "raw_snippets").included);
    assert!(!category(&manifest, "targeted_files").included);
    let warning_text = manifest.warnings.join(" ");
    assert!(warning_text.contains("expert confidence may be lower"));
    assert!(warning_text.contains("snippets were not provided"));
}

#[test]
fn extended_manifest_records_selected_files_and_areas_without_reading_contents() {
    let fixture = manifest_fixture("extended_preview");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    let mut config = base_config();
    config.coverage_mode = Some("extended".to_string());
    config.selected_files_or_areas = vec!["src/app.ts".to_string(), "area:auth-flow".to_string()];
    config.max_snippet_chars = Some(1200);
    config.context_lines = Some(5);
    write_scope_scan_and_policy(&app, &scope_path, &scanner_path, &policy_path, config);

    let manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("extended preview should build");

    let targeted = category(&manifest, "targeted_files");
    assert!(targeted.included);
    assert!(targeted.source_code_disclosure);
    let controls = targeted
        .snippet_controls
        .as_ref()
        .expect("targeted controls");
    assert_eq!(controls.max_snippet_chars, 1200);
    assert_eq!(controls.context_lines, 5);
    assert_eq!(
        controls.selected_files_or_areas,
        vec!["src/app.ts", "area:auth-flow"]
    );
    let manifest_json = serde_json::to_string(&manifest).expect("manifest serializes");
    assert!(!manifest_json.contains("eval('1 + 1')"));
}

#[test]
fn retained_source_opt_in_is_visible_in_manifest_controls() {
    let fixture = manifest_fixture("retained_source_preview");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    let mut config = base_config();
    config.retention = Some(DisclosureRetentionConfig {
        raw_snippet_class: Some("customer_opt_in_retained_source".to_string()),
        targeted_file_class: None,
        retain_source_opt_in: Some(true),
        retention_period: Some("30_days".to_string()),
    });
    write_scope_scan_and_policy(&app, &scope_path, &scanner_path, &policy_path, config);

    let manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("retained-source preview should build with explicit opt-in");

    let raw = category(&manifest, "raw_snippets");
    assert_eq!(raw.source_derived_class, "customer_opt_in_retained_source");
    assert_eq!(
        raw.snippet_controls.as_ref().unwrap().retention_class,
        "customer_opt_in_retained_source"
    );
    assert_eq!(
        manifest.disclosure_policy_summary.retention_period,
        "30_days"
    );
}

#[test]
fn manifest_preview_rejects_unknown_fields_and_empty_redaction_metadata() {
    let fixture = manifest_fixture("unknown_and_empty_redaction");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );
    let mut policy_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&policy_path).expect("policy json"))
            .expect("policy json parses");
    policy_json["unexpectedField"] = serde_json::Value::Bool(true);
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write policy with unknown field");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: Some(scanner_path.clone()),
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("unknown-field-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("unknown policy field should fail");
    assert!(
        err.to_string().contains("unexpectedField") || err.to_string().contains("unknown field")
    );

    policy_json
        .as_object_mut()
        .unwrap()
        .remove("unexpectedField");
    policy_json["redaction_policy"]["configuration_version"] =
        serde_json::Value::String("".to_string());
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write policy with empty redaction version");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("empty-redaction-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("empty redaction version should fail");
    assert!(err.to_string().contains("redaction_policy"));
}

#[test]
fn manifest_preview_rejects_mismatched_scanner_references_before_writing() {
    let fixture = manifest_fixture("mismatched_scanner_reference");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let output_path = fixture.join("outbound-manifest.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );
    let mut scanner_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scanner_path).expect("scanner json"))
            .expect("scanner json parses");
    scanner_json["review_scope_ref"] = serde_json::Value::String(
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
    );
    fs::write(
        &scanner_path,
        format!("{}\n", serde_json::to_string_pretty(&scanner_json).unwrap()),
    )
    .expect("write mismatched scanner json");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: output_path.clone(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("mismatched scanner ref should fail before writing");

    assert!(err.to_string().contains("review_scope_ref"));
    assert!(!output_path.exists());
}

#[test]
fn manifest_preview_revalidates_loaded_policy_snippet_bounds_and_retention() {
    let fixture = manifest_fixture("loaded_policy_revalidation");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let mut policy_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&policy_path).expect("policy json"))
            .expect("policy parses");
    policy_json["snippet_policy"]["max_snippet_chars"] = serde_json::Value::from(2001);
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write invalid snippet caps");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: Some(scanner_path.clone()),
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("invalid-caps-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("manifest preview should revalidate loaded snippet caps");
    assert!(err.to_string().contains("max_snippet_chars"));

    policy_json["snippet_policy"]["max_snippet_chars"] = serde_json::Value::from(800);
    policy_json["retention_policy"]["raw_snippet_class"] =
        serde_json::Value::String("customer_opt_in_retained_source".to_string());
    policy_json["retention_policy"]["retain_source_opt_in"] = serde_json::Value::Bool(false);
    policy_json["retention_policy"]["retention_period"] =
        serde_json::Value::String("30_days".to_string());
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write invalid retention pair");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("invalid-retention-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("manifest preview should revalidate loaded retention pair");
    assert!(err.to_string().contains("retention_policy"));
}

#[test]
fn manifest_preview_revalidates_selected_file_references_and_coverage_mode() {
    let fixture = manifest_fixture("selected_file_and_mode_revalidation");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    let mut config = base_config();
    config.coverage_mode = Some("extended".to_string());
    config.selected_files_or_areas = vec!["src/app.ts".to_string()];
    write_scope_scan_and_policy(&app, &scope_path, &scanner_path, &policy_path, config);

    let mut policy_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&policy_path).expect("policy json"))
            .expect("policy parses");
    policy_json["snippet_policy"]["selected_files_or_areas"] =
        serde_json::Value::Array(vec![serde_json::Value::String("C:/secret.rs".to_string())]);
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write invalid selected file ref");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: Some(scanner_path.clone()),
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("invalid-selected-path-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("manifest preview should revalidate selected files or areas");
    assert!(err.to_string().contains("Windows drive prefixes"));

    policy_json["snippet_policy"]["selected_files_or_areas"] =
        serde_json::Value::Array(vec![serde_json::Value::String("src/app.ts".to_string())]);
    policy_json["coverage_mode"] = serde_json::Value::String("metadata_only".to_string());
    fs::write(
        &policy_path,
        format!("{}\n", serde_json::to_string_pretty(&policy_json).unwrap()),
    )
    .expect("write inconsistent coverage mode");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("coverage-mismatch-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect_err("manifest preview should reject inconsistent coverage mode policy state");
    assert!(err.to_string().contains("metadata_only"));
}

#[test]
fn manifest_preview_records_redaction_not_configured_branch() {
    let fixture = manifest_fixture("redaction_not_configured");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    let mut config = base_config();
    config.redaction = Some(DisclosureRedactionConfig {
        enabled: false,
        profile: None,
        configuration_version: None,
    });
    write_scope_scan_and_policy(&app, &scope_path, &scanner_path, &policy_path, config);

    let manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("manifest preview should allow explicit no-redaction policy");

    let raw = category(&manifest, "raw_snippets");
    assert_eq!(raw.redaction_state, "redaction_not_configured");
    assert_eq!(raw.redaction_configuration_version, "not_configured");
}

#[test]
fn extended_manifest_asserts_no_source_content_for_entire_fixture_file() {
    let fixture = manifest_fixture("extended_no_source_file_content");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    let mut config = base_config();
    config.coverage_mode = Some("extended".to_string());
    config.selected_files_or_areas = vec!["src/app.ts".to_string()];
    write_scope_scan_and_policy(&app, &scope_path, &scanner_path, &policy_path, config);

    let manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("extended preview should build");

    let source_file_content = fs::read_to_string(app.join("src/app.ts")).expect("source fixture");
    let manifest_json = serde_json::to_string_pretty(&manifest).expect("manifest serializes");
    assert!(!manifest_json.contains(source_file_content.trim()));
    for line in source_file_content
        .lines()
        .filter(|line| !line.trim().is_empty())
    {
        assert!(!manifest_json.contains(line));
    }
}

#[test]
fn manifest_preview_summary_sanitizes_control_characters() {
    let fixture = manifest_fixture("summary_sanitizes_controls");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );
    let mut manifest = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("manifest preview should build");

    manifest
        .selected_scope_summary
        .selected_application
        .display_name = "Synthetic\u{1b}[31m App".to_string();
    category_mut(&mut manifest, "metadata")
        .details
        .push("detail with \u{1b}[32m control".to_string());
    manifest.warnings.push("warning\u{1b}[33mtext".to_string());

    let summary =
        format_manifest_preview_summary(&manifest, &fixture.join("outbound-manifest.json"));
    assert!(!summary.contains('\u{1b}'));
    assert!(summary.contains("Synthetic?[31m App"));
}

#[test]
fn manifest_preview_rejects_retained_scanner_raw_output_under_synthetic_demo() {
    let fixture = manifest_fixture("retained_scanner_raw_output_gate");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let semgrep_output_path = fixture.join("semgrep-output.json");

    fs::write(&semgrep_output_path, semgrep_json_fixture()).expect("semgrep fixture output");

    let scope = initialize_and_write_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: app.to_path_buf(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: scope_path.clone(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("scope should write");

    // [C2-05] retain_raw_output_locally is allowed at scan time (it only tags the
    // artifact for later gate enforcement); the gate must bite when this scanner
    // finding set is later chained into a manifest/bundle under synthetic_demo.
    let scanner = initialize_and_write_local_scan(ScanRunInput {
        application_path: app.to_path_buf(),
        review_scope_ref: scope.review_scope_id.clone(),
        output_path: scanner_path.clone(),
        generated_at: "2026-07-10T00:00:01Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: semgrep_output_path,
            ruleset_identifier: "local:semgrep-retained".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: true,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should write");
    assert_eq!(
        scanner.artifact_references[0].source_derived_class,
        "customer_opt_in_retained_source"
    );

    initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref: scope.review_scope_id,
        scanner_finding_set_ref: Some(scanner.scanner_finding_set_id),
        output_path: policy_path.clone(),
        created_at: "2026-07-10T00:00:02Z".to_string(),
        config: base_config(),
    })
    .expect("policy should write");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("outbound-manifest.json"),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect_err("retained scanner raw output must be rejected under the synthetic_demo gate");
    assert!(
        err.to_string()
            .contains("scanner_finding_set.artifact_references")
    );
    assert!(err.to_string().contains("customer_opt_in_retained_source"));
}

// C8-03: manifest preview must revalidate schema-required review-scope
// metadata at the load boundary, not just IDs/commit/runner.
#[test]
fn manifest_preview_rejects_review_scope_with_invalid_generated_at() {
    let fixture = manifest_fixture("scope_invalid_generated_at");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let mut scope_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scope_path).expect("scope json"))
            .expect("scope parses");
    scope_json["generated_at"] = serde_json::Value::String("not-a-date".to_string());
    fs::write(
        &scope_path,
        format!("{}\n", serde_json::to_string_pretty(&scope_json).unwrap()),
    )
    .expect("write invalid generated_at");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("invalid-generated-at-manifest.json"),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect_err("manifest preview should reject an invalid review_scope.generated_at");
    assert!(err.to_string().contains("review_scope.generated_at"));
}

#[test]
fn manifest_preview_rejects_review_scope_with_empty_technical_context() {
    let fixture = manifest_fixture("scope_empty_technical_context");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let mut scope_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scope_path).expect("scope json"))
            .expect("scope parses");
    scope_json["technical_context"] = serde_json::Value::Array(vec![]);
    fs::write(
        &scope_path,
        format!("{}\n", serde_json::to_string_pretty(&scope_json).unwrap()),
    )
    .expect("write empty technical_context");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("empty-technical-context-manifest.json"),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect_err("manifest preview should reject empty review_scope.technical_context");
    assert!(err.to_string().contains("review_scope.technical_context"));
}

// C8-03: manifest preview must revalidate schema-required scanner-finding-set
// metadata at the load boundary, not just IDs/refs/candidate-only status.
#[test]
fn manifest_preview_rejects_scanner_finding_set_with_empty_scanner_runs() {
    let fixture = manifest_fixture("scanner_empty_runs");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let mut scanner_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scanner_path).expect("scanner json"))
            .expect("scanner parses");
    scanner_json["scanner_runs"] = serde_json::Value::Array(vec![]);
    fs::write(
        &scanner_path,
        format!("{}\n", serde_json::to_string_pretty(&scanner_json).unwrap()),
    )
    .expect("write empty scanner_runs");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("empty-scanner-runs-manifest.json"),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect_err("manifest preview should reject an empty scanner_finding_set.scanner_runs");
    assert!(err.to_string().contains("scanner_finding_set.scanner_runs"));
}

#[test]
fn manifest_preview_rejects_scanner_finding_set_with_invalid_run_executed_at() {
    let fixture = manifest_fixture("scanner_invalid_executed_at");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");

    write_scope_scan_and_policy(
        &app,
        &scope_path,
        &scanner_path,
        &policy_path,
        base_config(),
    );

    let mut scanner_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scanner_path).expect("scanner json"))
            .expect("scanner parses");
    scanner_json["scanner_runs"][0]["executed_at"] =
        serde_json::Value::String("not-a-date".to_string());
    fs::write(
        &scanner_path,
        format!("{}\n", serde_json::to_string_pretty(&scanner_json).unwrap()),
    )
    .expect("write invalid executed_at");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        output_path: fixture.join("invalid-executed-at-manifest.json"),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect_err("manifest preview should reject an invalid scanner_runs[].executed_at");
    assert!(
        err.to_string()
            .contains("scanner_finding_set.scanner_runs.executed_at")
    );
}

fn semgrep_json_fixture() -> &'static str {
    r#"{
      "results": [
        {
          "check_id": "demo.semgrep.insecure-random",
          "path": "src/app.ts",
          "start": { "line": 2, "col": 18 },
          "end": { "line": 2, "col": 31 },
          "extra": {
            "message": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE demo finding around Math.random()",
            "severity": "WARNING",
            "metadata": { "confidence": "MEDIUM" },
            "fingerprint": "synthetic-fingerprint-001"
          }
        }
      ]
    }"#
}

fn write_scope_scan_and_policy(
    app: &Path,
    scope_path: &Path,
    scanner_path: &Path,
    policy_path: &Path,
    config: DisclosurePolicyConfig,
) {
    let scope = initialize_and_write_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: app.to_path_buf(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: scope_path.to_path_buf(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("scope should write");

    let scanner = initialize_and_write_local_scan(ScanRunInput {
        application_path: app.to_path_buf(),
        review_scope_ref: scope.review_scope_id.clone(),
        output_path: scanner_path.to_path_buf(),
        generated_at: "2026-07-10T00:00:01Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.eval".to_string(),
            pattern: r"eval\(".to_string(),
            ruleset_identifier: "local:demo-regex".to_string(),
            severity: Some("warning".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should write");

    initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref: scope.review_scope_id,
        scanner_finding_set_ref: Some(scanner.scanner_finding_set_id),
        output_path: policy_path.to_path_buf(),
        created_at: "2026-07-10T00:00:02Z".to_string(),
        config,
    })
    .expect("policy should write");
}

fn write_scope_and_policy(
    app: &Path,
    scope_path: &Path,
    policy_path: &Path,
    config: DisclosurePolicyConfig,
) {
    let scope = initialize_and_write_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: app.to_path_buf(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: scope_path.to_path_buf(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("scope should write");

    initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref: scope.review_scope_id,
        scanner_finding_set_ref: None,
        output_path: policy_path.to_path_buf(),
        created_at: "2026-07-10T00:00:02Z".to_string(),
        config,
    })
    .expect("policy should write");
}

fn category<'a>(
    manifest: &'a onevps_local_runner_scaffold::OutboundManifest,
    name: &str,
) -> &'a onevps_local_runner_scaffold::ManifestEvidenceCategory {
    manifest
        .evidence_categories
        .iter()
        .find(|category| category.category == name)
        .expect("category exists")
}

fn category_mut<'a>(
    manifest: &'a mut onevps_local_runner_scaffold::OutboundManifest,
    name: &str,
) -> &'a mut onevps_local_runner_scaffold::ManifestEvidenceCategory {
    manifest
        .evidence_categories
        .iter_mut()
        .find(|category| category.category == name)
        .expect("category exists")
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
        redaction: Some(DisclosureRedactionConfig {
            enabled: true,
            profile: Some("local-demo-redaction".to_string()),
            configuration_version: Some("local-demo-redaction-v1".to_string()),
        }),
        retention: None,
    }
}

fn write_synthetic_app(root: &Path) -> PathBuf {
    let app = root.join("app");
    fs::create_dir_all(app.join("src")).expect("app src dir");
    fs::write(
        app.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" }, "devDependencies": { "typescript": "6.0.3" } }"#,
    )
    .expect("package json");
    fs::write(
        app.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const result = eval('1 + 1');\n",
    )
    .expect("synthetic ts source");
    app
}

fn manifest_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-7-{name}-{nanos}"))
}
