use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const REVIEW_SCOPE_REF: &str =
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[test]
fn cli_scan_run_writes_candidate_findings_and_privacy_safe_summary() {
    let fixture = temp_fixture("cli_scan_run_writes_candidate_findings");
    let app = fixture.join("app");
    fs::create_dir_all(app.join("src")).expect("fixture app dir");
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

    let review_scope = fixture.join("review-scope.json");
    fs::write(
        &review_scope,
        format!(
            "{{\n  \"protocol_version\": \"codeattest.v0\",\n  \"review_scope_id\": \"{REVIEW_SCOPE_REF}\",\n  \"selected_application\": {{\n    \"application_id\": \"app\",\n    \"display_name\": \"app\"\n  }},\n  \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\"\n}}\n"
        ),
    )
    .expect("synthetic review scope");

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

    let output_path = fixture.join("out/scanner-findings.json");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");
    let command_output = Command::new(binary)
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
            path_text(&output_path).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scan run command should run");

    assert!(
        command_output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&command_output.stderr)
    );

    let stdout = String::from_utf8(command_output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("Local scan completed"));
    assert!(stdout.contains("Scanner regex: succeeded"));
    assert!(stdout.contains("Scanner semgrep: succeeded version=1.168.0"));
    assert!(stdout.contains("Candidate findings: 2"));
    assert!(stdout.contains("Output path:"));
    assert!(stdout.contains("Local-only boundary:"));
    assert!(!stdout.contains("\u{1b}["));
    assert!(!stdout.contains("Math.random()"));
    assert!(!stdout.to_ascii_lowercase().contains("confirmed"));
    assert!(!stdout.to_ascii_lowercase().contains("no vulnerabilities"));

    let json = fs::read_to_string(output_path).expect("scanner finding set json");
    assert!(json.contains(r#""protocol_version": "codeattest.v0""#));
    assert!(json.contains(r#""review_scope_ref": "sha256:"#));
    assert!(json.contains(r#""source": "regex""#));
    assert!(json.contains(r#""source": "semgrep""#));
    assert!(json.contains(r#""source_derived_class": "retained_review_artifact""#));
    assert!(!json.contains("Math.random()"));
    assert!(!json.contains("selectedApplication"));
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-5-{name}-{nanos}"))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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
