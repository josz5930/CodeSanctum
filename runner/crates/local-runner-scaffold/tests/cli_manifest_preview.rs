use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn cli_scope_scan_disclosure_and_manifest_preview_write_local_manifest() {
    let fixture = temp_fixture("cli_manifest_preview");
    let app = fixture.join("app");
    fs::create_dir_all(app.join("src")).expect("fixture app dir");
    fs::write(
        app.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" }, "devDependencies": { "typescript": "6.0.3" } }"#,
    )
    .expect("synthetic package manifest");
    fs::write(
        app.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const result = eval('1 + 1');\n",
    )
    .expect("synthetic ts source");

    let scanner_dir = fixture.join("scanner");
    fs::create_dir_all(&scanner_dir).expect("scanner dir");
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
    let outbound_manifest = fixture.join("nested/outbound-manifest.json");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    run_ok(
        &binary,
        &fixture,
        &[
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
        ],
    );
    run_ok(
        &binary,
        &fixture,
        &[
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
        ],
    );
    run_ok(
        &binary,
        &fixture,
        &[
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
        ],
    );

    let manifest_output = Command::new(&binary)
        .args([
            "manifest",
            "preview",
            "--scope",
            path_text(&review_scope).as_str(),
            "--scanner-findings",
            path_text(&scanner_findings).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--output",
            path_text(&outbound_manifest).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("manifest preview command should run");
    assert!(
        manifest_output.status.success(),
        "manifest stderr: {}",
        String::from_utf8_lossy(&manifest_output.stderr)
    );

    let stdout = String::from_utf8(manifest_output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("Outbound manifest preview generated"));
    assert!(stdout.contains("manifest_id: sha256:"));
    assert!(stdout.contains("Selected commit: 0123456789abcdef0123456789abcdef01234567"));
    assert!(stdout.contains("Repository identity hash: sha256:"));
    assert!(stdout.contains("Coverage Mode: Finding-context snippets (finding_context_snippets)"));
    assert!(
        stdout
            .contains("Package preview state: preview_generated send_ready=false local_only=true")
    );
    assert!(stdout.contains("source-code disclosure"));
    assert!(stdout.contains("secret detection cannot prove absence of secrets"));
    assert!(stdout.contains("complete repository archive"));
    assert!(stdout.contains("Local-only boundary:"));
    assert!(!stdout.contains("\u{1b}["));
    assert!(!stdout.contains("eval('1 + 1')"));
    assert!(!stdout.to_ascii_lowercase().contains("approved by"));
    assert!(!stdout.to_ascii_lowercase().contains("no vulnerabilities"));
    assert!(!stdout.to_ascii_lowercase().contains("submission"));
    assert!(!stdout.to_ascii_lowercase().contains("receipt"));

    let json = fs::read_to_string(outbound_manifest).expect("outbound manifest json");
    assert!(json.contains(r#""manifest_id": "sha256:"#));
    assert!(json.contains(r#""package_preview_state""#));
    assert!(json.contains(r#""approval_state": "not_requested""#));
    assert!(json.contains(r#""category": "never_collected_items""#));
    assert!(!json.contains("eval('1 + 1')"));
    assert!(!json.contains("selectedApplication"));
}

fn run_ok(binary: &str, dir: &Path, args: &[&str]) {
    let output = Command::new(binary)
        .args(args)
        .current_dir(dir)
        .output()
        .expect("command run");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-7-{name}-{nanos}"))
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
      "semgrep_json_inputs": [],
      "semgrep_local_commands": []
    }"#
}
