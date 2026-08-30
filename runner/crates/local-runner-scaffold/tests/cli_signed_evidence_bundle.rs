use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::{canonicalize_protocol_json_value, keys, ml_dsa};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn cli_prepares_signed_bundle_after_exact_manifest_confirmation() {
    let fixture = temp_fixture("cli_signed_bundle_approved");
    let app = write_synthetic_app(&fixture);
    let review_scope = fixture.join("review-scope.json");
    let disclosure_policy = fixture.join("disclosure-policy.json");
    let outbound_manifest = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");
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
    fs::write(
        fixture.join("policy-config.json"),
        metadata_only_policy_config(),
    )
    .expect("policy config fixture");
    run_ok(
        &binary,
        &fixture,
        &[
            "disclosure",
            "configure",
            "--scope",
            path_text(&review_scope).as_str(),
            "--policy-config",
            path_text(&fixture.join("policy-config.json")).as_str(),
            "--output",
            path_text(&disclosure_policy).as_str(),
        ],
    );
    run_ok(
        &binary,
        &fixture,
        &[
            "manifest",
            "preview",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--output",
            path_text(&outbound_manifest).as_str(),
        ],
    );

    let manifest_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&outbound_manifest).expect("manifest json"))
            .expect("manifest parses");
    let manifest_id = manifest_json["manifest_id"]
        .as_str()
        .expect("manifest_id")
        .to_string();

    let output = Command::new(&binary)
        .args([
            "bundle",
            "prepare",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--approving-actor",
            "maya@example.com",
            "--approval-decision",
            "approve",
            "--approval-confirmation",
            manifest_id.as_str(),
            "--output-dir",
            path_text(&output_dir).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("bundle prepare command should run");
    assert!(
        output.status.success(),
        "bundle stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    let lower = stdout.to_ascii_lowercase();
    assert!(stdout.contains("Approval context"));
    assert!(stdout.contains("manifest_id: sha256:"));
    assert!(stdout.contains("Selected commit: 0123456789abcdef0123456789abcdef01234567"));
    assert!(stdout.contains("Repository identity hash: sha256:"));
    assert!(stdout.contains("Coverage Mode: Metadata-only (metadata_only)"));
    assert!(stdout.contains("Bundle preview summary"));
    assert!(stdout.contains("Signed local Evidence Bundle prepared"));
    assert!(
        stdout.find("Approval context").expect("approval context")
            < stdout
                .find("Signed local Evidence Bundle prepared")
                .expect("signed summary")
    );
    assert!(stdout.contains("approval_id:"));
    assert!(stdout.contains("evidence_bundle_id: sha256:"));
    assert!(stdout.contains("bundle_instance_id:"));
    assert!(stdout.contains("submission_attempt_id:"));
    assert!(stdout.contains("signing key: codeattest-local-runner-key"));
    assert!(
        stdout.contains("signed with a real ML-DSA-65 signature under runner-held key custody")
    );
    assert!(stdout.contains("not_submitted"));
    assert!(!stdout.contains("\u{1b}["));
    assert!(!stdout.contains("eval('1 + 1')"));
    assert!(!lower.contains("vendor receipt"));
    assert!(!lower.contains("received state"));
    assert!(!lower.contains("certified"));
    assert!(!lower.contains("no vulnerabilities"));

    assert!(output_dir.join("customer-approval.json").exists());
    assert!(output_dir.join("bundle_manifest.json").exists());
    assert!(output_dir.join("signature-envelope.bundle.json").exists());

    let bundle: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(output_dir.join("bundle_manifest.json")).expect("bundle manifest json"),
    )
    .expect("bundle manifest parses");
    let signature: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(output_dir.join("signature-envelope.bundle.json"))
            .expect("signature envelope json"),
    )
    .expect("signature envelope parses");
    assert_eq!(signature["algorithm_profile"], "ml_dsa_65");
    assert_eq!(signature["signing_mode"], "enrolled_runner_key");
    assert_eq!(signature["key_id"], "codeattest-local-runner-key");
    let signature_bytes = signature["signature_bytes"]
        .as_str()
        .expect("signature_bytes string");
    assert!(signature_bytes.starts_with("ml_dsa_65:"));
    assert_eq!(signature_bytes.len(), "ml_dsa_65:".len() + 4412);

    // This CLI invocation ran with `--current-dir(&fixture)`, so the runner
    // generated its per-installation key under this fixture's own
    // `.codeattest/keys` — no shared-path race the way an in-process library
    // test sharing one process's cwd would have. Verify the real signature
    // against that key rather than asserting on exact bytes.
    let public_key_base64url = fs::read_to_string(fixture.join(".codeattest/keys/signing-key.pub"))
        .expect("runner public key");
    let public_key =
        ml_dsa::base64url_decode(public_key_base64url.trim()).expect("decode public key");
    let evidence_bundle_id = bundle["evidence_bundle_id"]
        .as_str()
        .expect("evidence_bundle_id");
    let signing_input = keys::bundle_signing_input(evidence_bundle_id);
    let canonical = canonicalize_protocol_json_value(&signing_input);
    let message = ml_dsa::signed_message(&canonical);
    let raw_signature =
        ml_dsa::base64url_decode(&signature_bytes["ml_dsa_65:".len()..]).expect("decode signature");
    assert!(ml_dsa::verify(&public_key, &message, &raw_signature));
}

#[test]
fn cli_declined_bundle_prepare_records_not_submitted_without_bundle() {
    let fixture = temp_fixture("cli_signed_bundle_declined");
    let app = write_synthetic_app(&fixture);
    let review_scope = fixture.join("review-scope.json");
    let disclosure_policy = fixture.join("disclosure-policy.json");
    let outbound_manifest = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("declined-bundle");
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
    fs::write(
        fixture.join("policy-config.json"),
        metadata_only_policy_config(),
    )
    .expect("policy config fixture");
    run_ok(
        &binary,
        &fixture,
        &[
            "disclosure",
            "configure",
            "--scope",
            path_text(&review_scope).as_str(),
            "--policy-config",
            path_text(&fixture.join("policy-config.json")).as_str(),
            "--output",
            path_text(&disclosure_policy).as_str(),
        ],
    );
    run_ok(
        &binary,
        &fixture,
        &[
            "manifest",
            "preview",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--output",
            path_text(&outbound_manifest).as_str(),
        ],
    );

    let output = Command::new(&binary)
        .args([
            "bundle",
            "prepare",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--approval-decision",
            "decline",
            "--output-dir",
            path_text(&output_dir).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("declined bundle prepare should run");
    assert!(
        output.status.success(),
        "decline stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8(output.stdout).expect("stdout should be UTF-8");
    assert!(stdout.contains("Approval context"));
    assert!(stdout.contains("not_submitted"));
    assert!(stdout.contains("No signed Evidence Bundle was created"));
    assert!(stdout.contains("No evidence was sent"));
    assert!(stdout.contains("revise policy"));
    assert!(stdout.contains("rerun scan"));
    assert!(stdout.contains("export manifest"));
    assert!(stdout.contains("exit"));
    assert!(output_dir.join("customer-approval.json").exists());
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
}

#[test]
fn cli_post_approval_packaging_failure_writes_attempt_and_preserves_approval() {
    let fixture = temp_fixture("cli_story_1_9_failure");
    let app = write_synthetic_app(&fixture);
    let review_scope = fixture.join("review-scope.json");
    let scanner_findings = fixture.join("scanner-findings.json");
    let disclosure_policy = fixture.join("disclosure-policy.json");
    let outbound_manifest = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");
    let attempt_log = fixture.join("attempts.jsonl");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let manifest_id = setup_finding_context_flow(
        &binary,
        &fixture,
        &app,
        &review_scope,
        &scanner_findings,
        &disclosure_policy,
        &outbound_manifest,
    );

    let output = Command::new(&binary)
        .args([
            "bundle",
            "prepare",
            "--scope",
            path_text(&review_scope).as_str(),
            "--scanner-findings",
            path_text(&scanner_findings).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--approving-actor",
            "maya@example.com",
            "--approval-decision",
            "approve",
            "--approval-confirmation",
            manifest_id.as_str(),
            "--output-dir",
            path_text(&output_dir).as_str(),
            "--attempt-log",
            path_text(&attempt_log).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("bundle prepare failure should run");
    assert!(!output.status.success());
    let stderr = String::from_utf8(output.stderr).expect("stderr utf8");
    assert!(stderr.contains("Stage failed: bundle_packaging"));
    assert!(stderr.contains("Review state: approved_no_signed_bundle"));
    assert!(stderr.contains("No signed Evidence Bundle is ready."));
    assert!(stderr.contains("Remote state: not_submitted"));
    assert!(!stderr.contains("eval('1 + 1')"));
    assert!(!stderr.to_ascii_lowercase().contains("vendor receipt"));

    assert!(output_dir.join("customer-approval.json").exists());
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
    let attempt_log = fs::read_to_string(attempt_log).expect("attempt log");
    assert!(attempt_log.contains(r#""stage":"bundle_packaging""#));
    assert!(attempt_log.contains(r#""approval_state":"approved""#));
    assert!(!attempt_log.contains(r#""evidence_bundle_id""#));
}

#[test]
fn cli_reuses_approval_explicitly_and_status_reports_ready_bundle() {
    let fixture = temp_fixture("cli_story_1_9_reuse_status");
    let app = write_synthetic_app(&fixture);
    let review_scope = fixture.join("review-scope.json");
    let disclosure_policy = fixture.join("disclosure-policy.json");
    let outbound_manifest = fixture.join("outbound-manifest.json");
    let first_dir = fixture.join("evidence-bundle-a");
    let rerun_dir = fixture.join("evidence-bundle-rerun");
    let attempt_log = fixture.join("attempts.jsonl");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let manifest_id = setup_metadata_only_flow(
        &binary,
        &fixture,
        &app,
        &review_scope,
        &disclosure_policy,
        &outbound_manifest,
    );

    run_ok(
        &binary,
        &fixture,
        &[
            "bundle",
            "prepare",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--approval-decision",
            "approve",
            "--approval-confirmation",
            manifest_id.as_str(),
            "--output-dir",
            path_text(&first_dir).as_str(),
            "--attempt-log",
            path_text(&attempt_log).as_str(),
        ],
    );
    let first_bundle: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(first_dir.join("bundle_manifest.json")).expect("first bundle"),
    )
    .expect("first bundle json");

    let reuse = Command::new(&binary)
        .args([
            "bundle",
            "prepare",
            "--scope",
            path_text(&review_scope).as_str(),
            "--disclosure-policy",
            path_text(&disclosure_policy).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--reuse-approval",
            path_text(&first_dir.join("customer-approval.json")).as_str(),
            "--approval-context-choice",
            "reuse-approved-manifest",
            "--output-dir",
            path_text(&rerun_dir).as_str(),
            "--attempt-log",
            path_text(&attempt_log).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("reuse command");
    assert!(
        reuse.status.success(),
        "reuse stderr: {}",
        String::from_utf8_lossy(&reuse.stderr)
    );
    let stdout = String::from_utf8(reuse.stdout).expect("reuse stdout");
    assert!(stdout.contains("Approval context reuse selected"));
    assert!(stdout.contains("attempt_id:"));
    assert!(stdout.contains("evidence_bundle_id: sha256:"));
    assert!(!stdout.contains("\u{1b}["));
    let rerun_bundle: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(rerun_dir.join("bundle_manifest.json")).expect("rerun bundle"),
    )
    .expect("rerun bundle json");
    assert_ne!(
        first_bundle["bundle_instance_id"],
        rerun_bundle["bundle_instance_id"]
    );
    assert_ne!(
        first_bundle["submission_attempt_id"],
        rerun_bundle["submission_attempt_id"]
    );

    // [C2-02] The reused approval's identity, actor, and decided timestamp must be
    // preserved verbatim in the rerun bundle rather than a freshly minted approval.
    let original_approval: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(first_dir.join("customer-approval.json")).expect("first approval"),
    )
    .expect("first approval json");
    let reused_approval: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(rerun_dir.join("customer-approval.json")).expect("rerun approval"),
    )
    .expect("rerun approval json");
    assert_eq!(
        original_approval["approval_id"], reused_approval["approval_id"],
        "reuse must preserve the original approval_id"
    );
    assert_eq!(
        original_approval["approving_actor"], reused_approval["approving_actor"],
        "reuse must preserve the original approving actor"
    );
    assert_eq!(
        original_approval["decided_at"], reused_approval["decided_at"],
        "reuse must preserve the original decided_at timestamp"
    );
    assert_eq!(
        original_approval["warnings_acknowledged"], reused_approval["warnings_acknowledged"],
        "reuse must preserve the original acknowledged warnings"
    );
    assert_eq!(
        rerun_bundle["customer_approval_ref"], reused_approval["approval_id"],
        "rerun bundle must reference the reused approval id"
    );
    assert_eq!(
        rerun_bundle["customer_approval_ref"], original_approval["approval_id"],
        "rerun bundle must reference the original approval id, not a freshly minted one"
    );

    let status = Command::new(&binary)
        .args([
            "bundle",
            "status",
            "--scope",
            path_text(&review_scope).as_str(),
            "--manifest",
            path_text(&outbound_manifest).as_str(),
            "--output-dir",
            path_text(&rerun_dir).as_str(),
            "--attempt-log",
            path_text(&attempt_log).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("status command");
    assert!(
        status.status.success(),
        "status stderr: {}",
        String::from_utf8_lossy(&status.stderr)
    );
    let stdout = String::from_utf8(status.stdout).expect("status stdout");
    assert!(stdout.contains("Review state: signed_bundle_not_submitted"));
    assert!(stdout.contains("Bundle state: ready_not_submitted"));
    assert!(stdout.contains("Remote state: not_submitted"));
    assert!(stdout.contains("Runner trust: demo_only_unsigned"));
    assert!(!stdout.to_ascii_lowercase().contains("vendor receipt"));
}

#[test]
fn cli_runner_trust_reports_unsigned_demo_state() {
    let fixture = temp_fixture("cli_story_1_9_trust");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let attempt_log = fixture.join("attempts.jsonl");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let output = Command::new(&binary)
        .args([
            "runner",
            "trust",
            "--attempt-log",
            path_text(&attempt_log).as_str(),
        ])
        .current_dir(&fixture)
        .output()
        .expect("runner trust command");
    assert!(
        output.status.success(),
        "trust stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).expect("trust stdout");
    assert!(stdout.contains("Runner trust status"));
    assert!(stdout.contains("Release signature status: unsigned_local_build"));
    assert!(stdout.contains("Bundle signing mode: enrolled_runner_key"));
    assert!(stdout.contains("Trust label: demo_only_unsigned"));
    assert!(!stdout.contains("\u{1b}["));
    let log = fs::read_to_string(attempt_log).expect("trust attempt log");
    assert!(log.contains(r#""stage":"runner_trust""#));
    assert!(log.contains(r#""trust_label":"demo_only_unsigned""#));
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

fn setup_metadata_only_flow(
    binary: &str,
    fixture: &Path,
    app: &Path,
    review_scope: &Path,
    disclosure_policy: &Path,
    outbound_manifest: &Path,
) -> String {
    run_ok(
        binary,
        fixture,
        &[
            "scope",
            "init",
            "--application-path",
            path_text(app).as_str(),
            "--review-id",
            "review:synthetic-demo-001",
            "--commit",
            VALID_COMMIT,
            "--output",
            path_text(review_scope).as_str(),
        ],
    );
    fs::write(
        fixture.join("policy-config.json"),
        metadata_only_policy_config(),
    )
    .expect("policy config");
    run_ok(
        binary,
        fixture,
        &[
            "disclosure",
            "configure",
            "--scope",
            path_text(review_scope).as_str(),
            "--policy-config",
            path_text(&fixture.join("policy-config.json")).as_str(),
            "--output",
            path_text(disclosure_policy).as_str(),
        ],
    );
    run_ok(
        binary,
        fixture,
        &[
            "manifest",
            "preview",
            "--scope",
            path_text(review_scope).as_str(),
            "--disclosure-policy",
            path_text(disclosure_policy).as_str(),
            "--output",
            path_text(outbound_manifest).as_str(),
        ],
    );
    manifest_id(outbound_manifest)
}

fn setup_finding_context_flow(
    binary: &str,
    fixture: &Path,
    app: &Path,
    review_scope: &Path,
    scanner_findings: &Path,
    disclosure_policy: &Path,
    outbound_manifest: &Path,
) -> String {
    run_ok(
        binary,
        fixture,
        &[
            "scope",
            "init",
            "--application-path",
            path_text(app).as_str(),
            "--review-id",
            "review:synthetic-demo-001",
            "--commit",
            VALID_COMMIT,
            "--output",
            path_text(review_scope).as_str(),
        ],
    );
    let scanner_dir = fixture.join("scanner");
    fs::create_dir_all(&scanner_dir).expect("scanner dir");
    fs::write(
        scanner_dir.join("scanner-config.json"),
        scanner_config_fixture(),
    )
    .expect("scanner config");
    fs::write(
        fixture.join("policy-config.json"),
        finding_context_policy_config(),
    )
    .expect("policy config");
    run_ok(
        binary,
        fixture,
        &[
            "scan",
            "run",
            "--application-path",
            path_text(app).as_str(),
            "--scope",
            path_text(review_scope).as_str(),
            "--scanner-config",
            path_text(&scanner_dir.join("scanner-config.json")).as_str(),
            "--output",
            path_text(scanner_findings).as_str(),
        ],
    );
    run_ok(
        binary,
        fixture,
        &[
            "disclosure",
            "configure",
            "--scope",
            path_text(review_scope).as_str(),
            "--scanner-findings",
            path_text(scanner_findings).as_str(),
            "--policy-config",
            path_text(&fixture.join("policy-config.json")).as_str(),
            "--output",
            path_text(disclosure_policy).as_str(),
        ],
    );
    run_ok(
        binary,
        fixture,
        &[
            "manifest",
            "preview",
            "--scope",
            path_text(review_scope).as_str(),
            "--scanner-findings",
            path_text(scanner_findings).as_str(),
            "--disclosure-policy",
            path_text(disclosure_policy).as_str(),
            "--output",
            path_text(outbound_manifest).as_str(),
        ],
    );
    manifest_id(outbound_manifest)
}

fn manifest_id(path: &Path) -> String {
    let manifest_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path).expect("manifest json"))
            .expect("manifest parses");
    manifest_json["manifest_id"]
        .as_str()
        .expect("manifest_id")
        .to_string()
}

fn write_synthetic_app(root: &Path) -> PathBuf {
    let app = root.join("app");
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
    app
}

fn finding_context_policy_config() -> &'static str {
    r#"{
      "coverage_mode": "finding_context_snippets",
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

fn metadata_only_policy_config() -> &'static str {
    r#"{
      "coverage_mode": "metadata_only",
      "include_scanner_findings": false,
      "redaction": {
        "enabled": true,
        "profile": "local-demo-redaction",
        "configuration_version": "local-demo-redaction-v1"
      }
    }"#
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-8-{name}-{nanos}"))
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
