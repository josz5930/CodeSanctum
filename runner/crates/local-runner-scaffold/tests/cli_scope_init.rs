use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn cli_scope_init_writes_metadata_and_prints_copyable_summary() {
    let fixture = temp_fixture("cli_scope_init_writes_metadata_and_prints_copyable_summary");
    fs::create_dir_all(&fixture).expect("fixture directory should be created");
    fs::write(
        fixture.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" } }"#,
    )
    .expect("synthetic package manifest should be written");
    fs::write(
        fixture.join("requirements.txt"),
        "# SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nfastapi==0.1.0\n",
    )
    .expect("synthetic requirements should be written");

    let output_path = fixture.join("nested/review-scope.json");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");
    let command_output = Command::new(binary)
        .args([
            "scope",
            "init",
            "--application-path",
            path_text(&fixture).as_str(),
            "--review-id",
            "review:synthetic-demo-001",
            "--commit",
            VALID_COMMIT,
            "--output",
            path_text(&output_path).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scope init command should run");

    assert!(
        command_output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&command_output.stderr)
    );

    let stdout = String::from_utf8(command_output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("Selected application:"));
    assert!(stdout.contains("Selected commit: 0123456789abcdef0123456789abcdef01234567"));
    assert!(stdout.contains("Repository identity hash: sha256:"));
    assert!(stdout.contains("Runner version: 0.0.0"));
    assert!(stdout.contains("package_json: detected path=package.json dependencies=1"));
    assert!(stdout.contains("requirements_txt: detected path=requirements.txt dependencies=1"));
    assert!(stdout.contains("Output path:"));
    assert!(!stdout.contains("\u{1b}["));

    let metadata = fs::read_to_string(&output_path).expect("metadata file should be written");
    assert!(metadata.contains(r#""protocol_version": "codeattest.v0""#));
    assert!(metadata.contains(r#""generated_at":"#) || metadata.contains(r#""generated_at": "#));
    assert!(metadata.contains(r#""dependency_manifests""#));
    assert!(metadata.contains(r#""dependencies": ["fastapi"]"#));
}

#[test]
fn cli_accepts_equals_form_for_flag_values() {
    let fixture = temp_fixture("cli_accepts_equals_form");
    fs::create_dir_all(&fixture).expect("fixture dir");
    fs::write(
        fixture.join("package.json"),
        "{ \"_synthetic_marker\": \"SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\" }\n",
    )
    .expect("package.json");
    let output_path = fixture.join("out.json");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold").expect("binary path");
    let command_output = Command::new(binary)
        .args([
            "scope",
            "init",
            &format!("--application-path={}", path_text(&fixture)),
            "--review-id=review:synthetic-demo-001",
            &format!("--commit={VALID_COMMIT}"),
            &format!("--output={}", path_text(&output_path)),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scope init with equals form");
    assert!(
        command_output.status.success(),
        "equals-form should succeed, stderr={}",
        String::from_utf8_lossy(&command_output.stderr)
    );
    assert!(output_path.exists());
}

#[test]
fn cli_reports_missing_flag_value_instead_of_eating_next_flag() {
    let fixture = temp_fixture("cli_eats_flag");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold").expect("binary path");
    // Omit the path value: `--application-path --commit abc...`.
    let command_output = Command::new(binary)
        .args([
            "scope",
            "init",
            "--application-path",
            "--commit",
            VALID_COMMIT,
        ])
        .current_dir(&fixture)
        .output()
        .expect("scope init with missing value");
    assert!(
        !command_output.status.success(),
        "expected failure for missing path value"
    );
    let stderr = String::from_utf8_lossy(&command_output.stderr).to_string();
    assert!(
        stderr.contains("missing value for --application-path"),
        "stderr should name the missing flag, got: {stderr}"
    );
    assert!(
        stderr.contains("--commit"),
        "error message should surface that the next token was a flag: {stderr}"
    );
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-4-{name}-{nanos}"))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
