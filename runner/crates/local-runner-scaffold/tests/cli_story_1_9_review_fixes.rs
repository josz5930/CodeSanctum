//! Story 1.9 code-review follow-ups: stage-aware CLI failure output for
//! non-`bundle prepare` commands, `--reuse-approval` conflict rejection,
//! and reuse-approval load-failure attempt logging.
//!
//! These tests were added during the Story 1.9 review pass to close the AC1
//! gap where `scope init` / `scan run` / `disclosure configure` /
//! `manifest preview` failures did not name the failed stage.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("onevps-story-1-9-review-{name}-{nanos}"));
    fs::create_dir_all(&dir).expect("fixture dir");
    dir
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn binary() -> String {
    std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests")
}

#[test]
fn scope_init_failure_names_stage_and_writes_attempt_log() {
    let fixture = temp_fixture("scope_init");
    // Missing application path: force a validation failure early.
    let missing_app = fixture.join("does-not-exist");
    let output_path = fixture.join("review-scope.json");
    let attempt_log = fixture.join("attempts.jsonl");

    let output = Command::new(binary())
        .args([
            "scope",
            "init",
            "--application-path",
            path_text(&missing_app).as_str(),
            "--review-id",
            "review:synthetic-demo-001",
            "--commit",
            "0123456789abcdef0123456789abcdef01234567",
            "--output",
            path_text(&output_path).as_str(),
        ])
        // Redirect attempt log to a per-test path via cwd — the runner
        // defaults to `.codeattest/local-runner-attempts.jsonl` under the
        // process cwd. Copy afterwards.
        .current_dir(&fixture)
        .output()
        .expect("scope init should run");

    assert!(
        !output.status.success(),
        "expected non-zero exit for missing application path"
    );
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.contains("Stage failed: scope_init"),
        "expected stage-aware failure banner, got:\n{stderr}"
    );
    assert!(!stderr.contains("\u{1b}["), "monochrome output only");

    // Attempt log was written under the process cwd's default location.
    let expected_log = fixture
        .join(".codeattest")
        .join("local-runner-attempts.jsonl");
    assert!(
        expected_log.exists(),
        "attempt log should exist at {}",
        expected_log.display()
    );
    let log = fs::read_to_string(&expected_log).expect("attempt log utf8");
    assert!(log.contains("\"stage\":\"scope_init\""));
    assert!(log.contains("\"stage_failed\":\"scope_init\""));
    assert!(log.contains("\"failure_code\":\"scope_init_failed\""));
    // Story 1.9 core invariant.
    assert!(log.contains("\"remote_state\":\"not_submitted\""));
    let _ = attempt_log;
}

#[test]
fn scan_run_failure_names_stage_and_writes_attempt_log() {
    let fixture = temp_fixture("scan_run");
    let missing_app = fixture.join("does-not-exist");
    let missing_scope = fixture.join("missing-scope.json");
    let missing_config = fixture.join("missing-config.json");

    let output = Command::new(binary())
        .args([
            "scan",
            "run",
            "--application-path",
            path_text(&missing_app).as_str(),
            "--scope",
            path_text(&missing_scope).as_str(),
            "--scanner-config",
            path_text(&missing_config).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("scan run should run");

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.contains("Stage failed: scan_run"),
        "expected stage-aware failure banner, got:\n{stderr}"
    );

    let log_path = fixture
        .join(".codeattest")
        .join("local-runner-attempts.jsonl");
    assert!(log_path.exists());
    let log = fs::read_to_string(&log_path).expect("attempt log utf8");
    assert!(log.contains("\"stage\":\"scan_run\""));
    assert!(log.contains("\"failure_code\":\"scan_run_failed\""));
}

#[test]
fn manifest_preview_failure_names_stage_and_writes_attempt_log() {
    let fixture = temp_fixture("manifest_preview");
    let missing_scope = fixture.join("scope.json");
    let missing_policy = fixture.join("policy.json");

    let output = Command::new(binary())
        .args([
            "manifest",
            "preview",
            "--scope",
            path_text(&missing_scope).as_str(),
            "--disclosure-policy",
            path_text(&missing_policy).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("manifest preview should run");

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.contains("Stage failed: manifest_preview"),
        "expected stage-aware failure banner, got:\n{stderr}"
    );

    let log_path = fixture
        .join(".codeattest")
        .join("local-runner-attempts.jsonl");
    assert!(log_path.exists());
    let log = fs::read_to_string(&log_path).expect("attempt log utf8");
    assert!(log.contains("\"stage\":\"manifest_preview\""));
    assert!(log.contains("\"failure_code\":\"manifest_preview_failed\""));
}

#[test]
fn disclosure_configure_failure_names_stage_and_writes_attempt_log() {
    let fixture = temp_fixture("disclosure_configure");
    let missing_scope = fixture.join("scope.json");
    let missing_config = fixture.join("policy-config.json");

    let output = Command::new(binary())
        .args([
            "disclosure",
            "configure",
            "--scope",
            path_text(&missing_scope).as_str(),
            "--policy-config",
            path_text(&missing_config).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("disclosure configure should run");

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.contains("Stage failed: disclosure_configure"),
        "expected stage-aware failure banner, got:\n{stderr}"
    );

    let log_path = fixture
        .join(".codeattest")
        .join("local-runner-attempts.jsonl");
    assert!(log_path.exists());
    let log = fs::read_to_string(&log_path).expect("attempt log utf8");
    assert!(log.contains("\"stage\":\"disclosure_configure\""));
    assert!(log.contains("\"failure_code\":\"disclosure_configure_failed\""));
}

#[test]
fn bundle_prepare_rejects_reuse_approval_combined_with_approving_actor() {
    let fixture = temp_fixture("reuse_with_actor");
    // We don't need valid input files — arg parsing rejects the combination
    // before any file is read.
    let scope = fixture.join("scope.json");
    let policy = fixture.join("policy.json");
    let manifest = fixture.join("manifest.json");
    let approval = fixture.join("approval.json");
    fs::write(&scope, "{}").unwrap();
    fs::write(&policy, "{}").unwrap();
    fs::write(&manifest, "{}").unwrap();
    fs::write(&approval, "{}").unwrap();

    let output = Command::new(binary())
        .args([
            "bundle",
            "prepare",
            "--scope",
            path_text(&scope).as_str(),
            "--disclosure-policy",
            path_text(&policy).as_str(),
            "--manifest",
            path_text(&manifest).as_str(),
            "--reuse-approval",
            path_text(&approval).as_str(),
            "--approval-context-choice",
            "reuse-approved-manifest",
            "--approving-actor",
            "customer_lead@example.com",
        ])
        .current_dir(&fixture)
        .output()
        .expect("bundle prepare should run");

    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(
        stderr.contains("--reuse-approval cannot be combined with --approving-actor"),
        "expected explicit rejection, got:\n{stderr}"
    );
}
