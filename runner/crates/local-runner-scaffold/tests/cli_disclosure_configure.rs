use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn cli_scope_scan_and_disclosure_configure_write_policy() {
    let fixture = temp_fixture("cli_scope_scan_and_disclosure_configure");
    let app = fixture.join("app");
    fs::create_dir_all(app.join("src")).expect("fixture app dir");
    fs::write(
        app.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" } }"#,
    )
    .expect("synthetic package manifest");
    fs::write(
        app.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const result = eval('1 + 1');\n",
    )
    .expect("synthetic ts source");
    fs::write(
        app.join("src/app.py"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nprint('hello')\n",
    )
    .expect("synthetic python source");

    let scanner_dir = fixture.join("scanner");
    fs::create_dir_all(&scanner_dir).expect("scanner dir");
    fs::write(
        scanner_dir.join("semgrep-output.json"),
        semgrep_json_fixture(),
    )
    .expect("semgrep json fixture");
    fs::write(
        scanner_dir.join("scanner-config.json"),
        scanner_config_fixture(),
    )
    .expect("scanner config fixture");
    fs::write(fixture.join("policy-config.json"), policy_config_fixture())
        .expect("policy config fixture");

    let review_scope = fixture.join("review-scope.json");
    let scanner_findings = fixture.join("scanner-findings.json");
    let disclosure_policy = fixture.join("disclosure-policy.json");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let scope_output = Command::new(&binary)
        .args([
            "scope",
            "init",
            "--application-path",
            path_text(&app).as_str(),
            "--review-id",
            "review:synthetic-demo-001",
            "--commit",
            VALID_COMMIT,
            "--output",
            path_text(&review_scope).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scope init command should run");
    assert!(
        scope_output.status.success(),
        "scope stderr: {}",
        String::from_utf8_lossy(&scope_output.stderr)
    );

    let scan_output = Command::new(&binary)
        .args([
            "scan",
            "run",
            "--application-path",
            path_text(&app).as_str(),
            "--scope",
            path_text(&review_scope).as_str(),
            "--scanner-config",
            path_text(&scanner_dir.join("scanner-config.json")).as_str(),
            "--output",
            path_text(&scanner_findings).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scan run command should run");
    assert!(
        scan_output.status.success(),
        "scan stderr: {}",
        String::from_utf8_lossy(&scan_output.stderr)
    );

    let policy_output = Command::new(&binary)
        .args([
            "disclosure",
            "configure",
            "--scope",
            path_text(&review_scope).as_str(),
            "--scanner-findings",
            path_text(&scanner_findings).as_str(),
            "--policy-config",
            path_text(&fixture.join("policy-config.json")).as_str(),
            "--output",
            path_text(&disclosure_policy).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("disclosure configure command should run");
    assert!(
        policy_output.status.success(),
        "policy stderr: {}",
        String::from_utf8_lossy(&policy_output.stderr)
    );

    let stdout = String::from_utf8(policy_output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("Disclosure policy configured"));
    assert!(stdout.contains("Finding-context snippets balanced default was applied"));
    assert!(stdout.contains("source-code disclosure"));
    assert!(stdout.contains("secret detection cannot prove absence of secrets"));
    assert!(stdout.contains("Local-only boundary:"));
    assert!(!stdout.contains("\u{1b}["));
    assert!(!stdout.contains("Math.random()"));
    assert!(!stdout.to_ascii_lowercase().contains("no vulnerabilities"));
    assert!(!stdout.to_ascii_lowercase().contains("receipt"));

    let json = fs::read_to_string(disclosure_policy).expect("disclosure policy json");
    assert!(json.contains(r#""protocol_version": "codeattest.v0""#));
    assert!(json.contains(r#""coverage_mode": "finding_context_snippets""#));
    assert!(json.contains(r#""scanner_finding_set_ref": "sha256:"#));
    assert!(json.contains(r#""raw_snippet_default_class": "transient_source_derived""#));
    assert!(json.contains("secret detection cannot prove absence of secrets"));
    assert!(!json.contains("Math.random()"));
    assert!(!json.contains("selectedApplication"));
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-6-{name}-{nanos}"))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn policy_config_fixture() -> &'static str {
    r#"{
      "redaction": {
        "enabled": true,
        "profile": "local-demo-redaction",
        "configuration_version": "local-demo-redaction-v1"
      }
    }"#
}

fn scanner_config_fixture() -> &'static str {
    r#"{
      "regex_rules": [
        {
          "scanner_name": "regex",
          "rule_id": "demo.regex.eval",
          "pattern": "eval\\(",
          "ruleset_identifier": "local:demo-regex",
          "severity": "warning",
          "confidence": "medium",
          "target_file_group": "typescript_javascript",
          "target_include_patterns": ["src/*.ts"],
          "retain_raw_output_locally": false
        }
      ],
      "semgrep_json_inputs": [
        {
          "scanner_name": "semgrep",
          "json_path": "semgrep-output.json",
          "ruleset_identifier": "local:semgrep-demo",
          "scanner_version": "1.168.0",
          "target_file_group": "typescript_javascript",
          "target_include_patterns": ["src/*.ts"],
          "retain_raw_output_locally": false
        }
      ],
      "semgrep_local_commands": []
    }"#
}

fn semgrep_json_fixture() -> &'static str {
    r#"{
      "results": [
        {
          "check_id": "demo.semgrep.insecure-random",
          "path": "src/app.ts",
          "start": { "line": 2, "col": 23 },
          "end": { "line": 2, "col": 36 },
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
