use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::{
    RegexScannerRule, ScanRunInput, SemgrepJsonInput, SemgrepLocalCommandInput,
    default_scanner_findings_output_path, format_scan_summary, initialize_local_scan,
    load_scan_config, write_scanner_finding_set_metadata,
};

const REVIEW_SCOPE_REF: &str =
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Guards process-wide PATH mutation: `run_semgrep_local_command` resolves the
// literal `semgrep` name via PATH, so tests that stub a `semgrep` executable
// must not run concurrently with anything else that reads PATH.
static SEMGREP_PATH_MUTEX: Mutex<()> = Mutex::new(());

#[test]
fn local_scan_records_regex_and_semgrep_candidate_findings_without_raw_snippets() {
    let fixture = scanner_fixture("local_scan_records_regex_and_semgrep");
    write_synthetic_app(&fixture);
    let semgrep_output = fixture.join("semgrep-output.json");
    fs::write(&semgrep_output, semgrep_json_fixture()).expect("semgrep fixture output");

    let output = fixture.join(".codeattest/scanner-findings.json");
    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture.clone(),
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: output.clone(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
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
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: semgrep_output,
            ruleset_identifier: "local:semgrep-demo".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("local scan should produce candidate findings");

    assert_eq!(finding_set.protocol_version, "codeattest.v0");
    assert_eq!(finding_set.review_scope_ref, REVIEW_SCOPE_REF);
    assert!(finding_set.scanner_finding_set_id.starts_with("sha256:"));
    assert_eq!(finding_set.scanner_runs.len(), 2);
    assert_eq!(finding_set.candidate_findings.len(), 2);

    let regex = finding_set
        .candidate_findings
        .iter()
        .find(|finding| finding.source == "regex")
        .expect("regex finding should be present");
    assert_eq!(regex.scanner_rule_id, "demo.regex.eval");
    assert_eq!(regex.status, "candidate");
    assert_eq!(regex.severity.as_deref(), Some("warning"));
    assert_eq!(regex.confidence.as_deref(), Some("medium"));
    assert!(regex.affected_area.contains("src/app.ts:"));
    assert!(regex.original_reference.contains("demo.regex.eval"));

    let semgrep = finding_set
        .candidate_findings
        .iter()
        .find(|finding| finding.source == "semgrep")
        .expect("semgrep finding should be present");
    assert_eq!(semgrep.scanner_rule_id, "demo.semgrep.insecure-random");
    assert_eq!(semgrep.status, "candidate");
    assert_eq!(semgrep.severity.as_deref(), Some("warning"));
    assert_eq!(semgrep.confidence.as_deref(), Some("medium"));
    assert_eq!(semgrep.affected_area, "src/app.ts:2:18");

    let summary = format_scan_summary(&finding_set, &output);
    assert!(summary.contains("Local scan completed"));
    assert!(summary.contains("Scanner semgrep: succeeded version=1.168.0"));
    assert!(summary.contains("Candidate findings: 2"));
    assert!(summary.contains("Local-only boundary:"));
    assert!(!summary.contains("Math.random()"));
    assert!(!summary.to_ascii_lowercase().contains("confirmed"));
    assert!(!summary.to_ascii_lowercase().contains("no vulnerabilities"));

    write_scanner_finding_set_metadata(&finding_set, &output).expect("scanner metadata write");
    let json = fs::read_to_string(output).expect("scanner output json");
    assert!(json.contains(r#""scanner_finding_set_id": "sha256:"#));
    assert!(json.contains(r#""source_derived_class": "retained_review_artifact""#));
    assert!(!json.contains("Math.random()"));
    assert!(!json.contains("selectedApplication"));
}

#[test]
fn local_scan_reports_no_findings_without_claiming_absence_of_vulnerabilities() {
    let fixture = scanner_fixture("local_scan_reports_no_findings");
    fs::create_dir_all(fixture.join("src")).expect("src dir");
    fs::write(
        fixture.join("src/app.py"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nprint('hello')\n",
    )
    .expect("synthetic python source");

    let output = default_scanner_findings_output_path();
    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: output.clone(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.eval".to_string(),
            pattern: r"eval\(".to_string(),
            ruleset_identifier: "local:demo-regex".to_string(),
            severity: Some("warning".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "python".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should complete with no findings");

    assert!(finding_set.candidate_findings.is_empty());
    let summary = format_scan_summary(&finding_set, &output);
    assert!(summary.contains("No findings produced by configured inputs"));
    assert!(!summary.to_ascii_lowercase().contains("secure"));
    assert!(!summary.to_ascii_lowercase().contains("safe"));
    assert!(!summary.to_ascii_lowercase().contains("no vulnerabilities"));
}

#[test]
fn local_scan_records_semgrep_unavailable_as_coverage_limitation() {
    let fixture = scanner_fixture("local_scan_records_semgrep_unavailable");
    write_synthetic_app(&fixture);
    let output = fixture.join("scanner-findings.json");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: output.clone(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: vec![SemgrepLocalCommandInput {
            scanner_name: "semgrep".to_string(),
            command: "/path/to/missing/semgrep".to_string(),
            config_path: "semgrep.yml".to_string(),
            ruleset_identifier: "local:missing-semgrep".to_string(),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
    })
    .expect("missing semgrep should be reported, not fatal");

    let semgrep_run = finding_set
        .scanner_runs
        .iter()
        .find(|run| run.scanner_name == "semgrep")
        .expect("semgrep run should be recorded");
    assert_eq!(semgrep_run.status, "failed");
    assert_eq!(semgrep_run.scanner_version, "missing");
    assert!(semgrep_run.rerun_possible);
    assert!(
        semgrep_run
            .failure_reason
            .as_deref()
            .unwrap_or_default()
            .contains("literal semgrep")
    );
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|limitation| limitation.contains("semgrep") && limitation.contains("did not run"))
    );
}

#[test]
fn local_scan_records_semgrep_missing_version_without_claiming_coverage() {
    let fixture = scanner_fixture("local_scan_records_semgrep_missing_version");
    write_synthetic_app(&fixture);
    let semgrep_output = fixture.join("semgrep-output.json");
    fs::write(&semgrep_output, semgrep_json_fixture()).expect("semgrep fixture output");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: semgrep_output,
            ruleset_identifier: "local:semgrep-missing-version".to_string(),
            scanner_version: None,
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("missing Semgrep version should be reported, not fatal");

    let semgrep_run = finding_set
        .scanner_runs
        .iter()
        .find(|run| run.scanner_name == "semgrep")
        .expect("semgrep run should be recorded");
    assert_eq!(semgrep_run.status, "failed");
    assert_eq!(semgrep_run.scanner_version, "missing");
    assert!(semgrep_run.rerun_possible);
    assert!(
        semgrep_run
            .failure_reason
            .as_deref()
            .unwrap_or_default()
            .contains("version was not detected")
    );
    assert!(finding_set.candidate_findings.is_empty());
    assert!(finding_set.coverage_limitations.iter().any(|limitation| {
        limitation.contains("semgrep") && limitation.contains("version was not detected")
    }));
}

#[test]
fn local_scan_records_truncated_semgrep_command_stdout_as_not_scanned() {
    // [C2-06] Regression test: a truncated stdout prefix that happens to be
    // syntactically valid, complete JSON on its own (an empty `results` array
    // followed by padding past the runner's capture cap) must not be trusted
    // as coverage, since real findings/scanned paths beyond the cap were lost.
    let _guard = SEMGREP_PATH_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let fixture = scanner_fixture("truncated_semgrep_command_stdout");
    write_synthetic_app(&fixture);

    let stub_dir = fixture.join("stub-bin");
    fs::create_dir_all(&stub_dir).expect("stub bin dir");
    let script_path = stub_dir.join("semgrep");
    fs::write(
        &script_path,
        "#!/bin/sh\n\
         if [ \"$1\" = \"--version\" ]; then\n\
         \x20 echo \"1.99.0\"\n\
         else\n\
         \x20 printf '{\"results\":[]}'\n\
         \x20 head -c 70000 /dev/zero | tr '\\0' ' '\n\
         \x20 printf '\\n'\n\
         fi\n",
    )
    .expect("write stub semgrep script");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&script_path)
            .expect("stub metadata")
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&script_path, perms).expect("chmod stub script");
    }

    let original_path = std::env::var_os("PATH");
    let mut new_path = std::ffi::OsString::from(&stub_dir);
    if let Some(existing) = &original_path {
        new_path.push(":");
        new_path.push(existing);
    }
    // SAFETY: serialized by SEMGREP_PATH_MUTEX; no other test in this binary
    // resolves a bare `semgrep` command via PATH.
    unsafe {
        std::env::set_var("PATH", &new_path);
    }

    let result = initialize_local_scan(ScanRunInput {
        application_path: fixture.clone(),
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: vec![SemgrepLocalCommandInput {
            scanner_name: "semgrep".to_string(),
            command: "semgrep".to_string(),
            config_path: "semgrep.yml".to_string(),
            ruleset_identifier: "local:truncated-stdout".to_string(),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
    });

    // SAFETY: same justification as above; restore before any assertion can
    // panic and unwind out of this test.
    unsafe {
        match &original_path {
            Some(existing) => std::env::set_var("PATH", existing),
            None => std::env::remove_var("PATH"),
        }
    }

    let finding_set = result.expect("truncated semgrep stdout should be reported, not fatal");

    let semgrep_run = finding_set
        .scanner_runs
        .iter()
        .find(|run| run.scanner_name == "semgrep")
        .expect("semgrep run should be recorded");
    assert_eq!(semgrep_run.status, "invalid_output");
    assert!(
        semgrep_run
            .failure_reason
            .as_deref()
            .unwrap_or_default()
            .contains("truncated")
    );
    assert!(semgrep_run.scanned_files.is_empty());
    assert!(finding_set.candidate_findings.is_empty());
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|limitation| limitation.contains("truncated"))
    );
}

#[test]
fn local_scan_reports_supported_file_groups_left_unscanned() {
    let fixture = scanner_fixture("local_scan_reports_supported_file_groups_left_unscanned");
    write_synthetic_app(&fixture);
    let output = fixture.join("scanner-findings.json");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: output,
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.eval".to_string(),
            pattern: r"eval\(".to_string(),
            ruleset_identifier: "local:demo-regex".to_string(),
            severity: Some("warning".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should complete with an unscanned python limitation");

    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|limitation| limitation.contains("python") && limitation.contains("not scanned"))
    );
}

#[test]
fn local_regex_scan_honors_target_include_patterns() {
    let fixture = scanner_fixture("local_regex_scan_honors_target_include_patterns");
    fs::create_dir_all(fixture.join("src")).expect("src dir");
    fs::write(
        fixture.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const x = eval('1 + 1');\n",
    )
    .expect("included source");
    fs::write(
        fixture.join("src/ignored.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const y = eval('2 + 2');\n",
    )
    .expect("excluded source");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.eval".to_string(),
            pattern: r"eval\(".to_string(),
            ruleset_identifier: "local:demo-regex".to_string(),
            severity: Some("warning".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/app.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should honor include patterns");

    assert_eq!(finding_set.candidate_findings.len(), 1);
    assert!(
        finding_set.candidate_findings[0]
            .affected_area
            .starts_with("src/app.ts:")
    );
    assert!(
        !finding_set.candidate_findings[0]
            .affected_area
            .contains("ignored.ts")
    );
}

#[test]
fn semgrep_json_results_outside_scope_or_stale_locations_are_not_imported() {
    let fixture = scanner_fixture("semgrep_json_results_outside_scope_or_stale_locations");
    write_synthetic_app(&fixture);
    fs::write(
        fixture.join("semgrep-output.json"),
        r#"{
          "results": [
            {
              "check_id": "demo.semgrep.stale",
              "path": "src/app.ts",
              "start": { "line": 99, "col": 1 },
              "extra": { "severity": "WARNING" }
            },
            {
              "check_id": "demo.semgrep.outside",
              "path": "../outside.ts",
              "start": { "line": 1, "col": 1 },
              "extra": { "severity": "WARNING" }
            }
          ]
        }"#,
    )
    .expect("semgrep fixture output");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture.clone(),
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: fixture.join("semgrep-output.json"),
            ruleset_identifier: "local:semgrep-scope".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("scan should complete with invalid semgrep output recorded");

    assert!(finding_set.candidate_findings.is_empty());
    let semgrep_run = finding_set
        .scanner_runs
        .iter()
        .find(|run| run.scanner_name == "semgrep")
        .expect("semgrep run");
    assert_eq!(semgrep_run.status, "invalid_output");
    assert!(semgrep_run.failure_reason.is_some());
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|item| item.contains("stale location"))
    );
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|item| item.contains("outside configured scanner scope"))
    );
}

#[test]
fn semgrep_json_errors_do_not_claim_successful_coverage() {
    let fixture = scanner_fixture("semgrep_json_errors_do_not_claim_successful_coverage");
    write_synthetic_app(&fixture);
    fs::write(
        fixture.join("semgrep-output.json"),
        r#"{
          "errors": [{ "type": "PartialScanError", "message": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE" }],
          "results": []
        }"#,
    )
    .expect("semgrep fixture output");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture.clone(),
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: fixture.join("semgrep-output.json"),
            ruleset_identifier: "local:semgrep-errors".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("semgrep errors should be metadata, not fatal");

    let semgrep_run = finding_set
        .scanner_runs
        .iter()
        .find(|run| run.scanner_name == "semgrep")
        .expect("semgrep run");
    assert_eq!(semgrep_run.status, "invalid_output");
    assert!(semgrep_run.scanned_files.is_empty());
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|item| item.contains("reported 1 error"))
    );
}

#[test]
fn partial_include_patterns_report_unscanned_file_group_members() {
    let fixture = scanner_fixture("partial_include_patterns_report_unscanned");
    fs::create_dir_all(fixture.join("src")).expect("src dir");
    fs::write(
        fixture.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const x = eval('1 + 1');\n",
    )
    .expect("included source");
    fs::write(
        fixture.join("src/other.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const y = 1;\n",
    )
    .expect("unscanned source");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.eval".to_string(),
            pattern: r"eval\(".to_string(),
            ruleset_identifier: "local:demo-regex".to_string(),
            severity: Some("warning".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/app.ts".to_string()],
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("partial scan should complete");

    assert!(finding_set.coverage_limitations.iter().any(|item| {
        item.contains("typescript_javascript") && item.contains("1 file(s) not scanned")
    }));
}

#[test]
fn mixed_file_group_credits_typescript_and_python_files_when_both_are_scanned() {
    let fixture = scanner_fixture("mixed_file_group_credits_both_groups");
    write_synthetic_app(&fixture);

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.marker".to_string(),
            pattern: r"SYNTHETIC_DEMO_DATA".to_string(),
            ruleset_identifier: "local:mixed-regex".to_string(),
            severity: Some("info".to_string()),
            confidence: Some("medium".to_string()),
            target_file_group: "mixed".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("mixed scan should complete");

    assert!(!finding_set.coverage_limitations.iter().any(|item| {
        (item.contains("typescript_javascript") || item.contains("python"))
            && item.contains("not scanned")
    }));
}

#[test]
fn zero_width_regex_rules_are_rejected_before_scanning() {
    let fixture = scanner_fixture("zero_width_regex_rules_are_rejected");
    write_synthetic_app(&fixture);

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: vec![RegexScannerRule {
            scanner_name: "regex".to_string(),
            rule_id: "demo.regex.empty".to_string(),
            pattern: r".*".to_string(),
            ruleset_identifier: "local:zero-width".to_string(),
            severity: None,
            confidence: None,
            target_file_group: "mixed".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: Vec::new(),
    })
    .expect("zero-width rule should be recorded as a failed scan input");

    assert!(finding_set.candidate_findings.is_empty());
    assert_eq!(finding_set.scanner_runs[0].status, "failed");
    assert!(
        finding_set
            .coverage_limitations
            .iter()
            .any(|item| item.contains("zero-width"))
    );
}

#[test]
fn semgrep_command_must_be_allowlisted() {
    let fixture = scanner_fixture("semgrep_command_must_be_allowlisted");
    write_synthetic_app(&fixture);

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture,
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: Vec::new(),
        semgrep_local_commands: vec![SemgrepLocalCommandInput {
            scanner_name: "semgrep".to_string(),
            command: "/tmp/attacker/semgrep".to_string(),
            config_path: "semgrep.yml".to_string(),
            ruleset_identifier: "local:bad-command".to_string(),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: Vec::new(),
            retain_raw_output_locally: false,
        }],
    })
    .expect("disallowed command should be recorded, not executed");

    assert_eq!(finding_set.scanner_runs[0].status, "failed");
    assert!(
        finding_set.scanner_runs[0]
            .failure_reason
            .as_deref()
            .unwrap_or_default()
            .contains("not allowed")
    );
}

#[test]
fn retained_semgrep_json_input_is_tagged_as_local_raw_artifact() {
    let fixture = scanner_fixture("retained_semgrep_json_input_is_tagged");
    write_synthetic_app(&fixture);
    fs::write(fixture.join("semgrep-output.json"), semgrep_json_fixture())
        .expect("semgrep fixture output");

    let finding_set = initialize_local_scan(ScanRunInput {
        application_path: fixture.clone(),
        review_scope_ref: REVIEW_SCOPE_REF.to_string(),
        output_path: default_scanner_findings_output_path(),
        generated_at: "2026-07-08T00:00:00Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: fixture.join("semgrep-output.json"),
            ruleset_identifier: "local:semgrep-retained".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: true,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("retained semgrep input should complete");

    assert_eq!(finding_set.artifact_references.len(), 1);
    assert_eq!(
        finding_set.artifact_references[0].artifact_type,
        "scanner_raw_output"
    );
    assert_eq!(
        finding_set.artifact_references[0].source_derived_class,
        "customer_opt_in_retained_source"
    );
}

#[test]
fn scanner_config_rejects_unknown_fields() {
    let fixture = scanner_fixture("scanner_config_rejects_unknown_fields");
    fs::create_dir_all(&fixture).expect("fixture dir");
    fs::write(
        fixture.join("scanner-config.json"),
        r#"{
          "regex_rules": [],
          "unexpectedField": true
        }"#,
    )
    .expect("scanner config fixture");

    let err = load_scan_config(&fixture.join("scanner-config.json"))
        .expect_err("unknown config fields should fail parsing");
    assert!(err.to_string().contains("unknown field"));
}

fn scanner_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-5-{name}-{nanos}"))
}

fn write_synthetic_app(root: &Path) {
    fs::create_dir_all(root.join("src")).expect("src dir");
    fs::write(
        root.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const x = eval('1 + 1');\n",
    )
    .expect("synthetic ts source");
    fs::write(
        root.join("src/app.py"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nprint('hello')\n",
    )
    .expect("synthetic python source");
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
