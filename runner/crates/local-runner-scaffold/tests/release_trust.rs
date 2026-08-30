use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::ml_dsa;
use onevps_local_runner_scaffold::release_trust::{self, ReleaseTrust};

const SEED: [u8; 32] = [0x2A; 32];

fn signed_release_artifact(
    build_identifier: &str,
    dir: &std::path::Path,
) -> (std::path::PathBuf, std::path::PathBuf) {
    let released_binary = dir.join("onevps-local-runner-scaffold");
    std::fs::write(
        &released_binary,
        b"SYNTHETIC_DEMO_DATA runner NOT_CUSTOMER_SOURCE",
    )
    .expect("write runner artifact");
    let artifact_digest = onevps_local_runner_scaffold::sha256_id(
        &std::fs::read(&released_binary).expect("read runner artifact"),
    );
    let record = serde_json::json!({
        "protocol_version": "codeattest.v0",
        "release_identifier": "codeattest-local-runner-v0.1.0",
        "build_identifier": build_identifier,
        "artifact_digest": artifact_digest,
        "released_at": "2026-08-16T00:00:00Z",
        "limitations": [
            release_trust::SOFTWARE_CUSTODY_LIMITATION,
            "SYNTHETIC_DEMO_DATA Test release record. NOT_CUSTOMER_SOURCE."
        ]
    });
    let identity = onevps_local_runner_scaffold::sha256_id(
        onevps_local_runner_scaffold::canonicalize_protocol_json_value(&record).as_bytes(),
    );
    let signing_input = release_trust::release_signing_input(&identity);
    let canonical = onevps_local_runner_scaffold::canonicalize_protocol_json_value(&signing_input);
    let signature =
        ml_dsa::sign_deterministic_from_seed(&SEED, &ml_dsa::signed_message(&canonical));
    let artifact = serde_json::json!({
        "release_record": record,
        "signing_input": signing_input,
        "signature": {
            "protocol_version": "codeattest.v0",
            "algorithm_profile": "ml_dsa_65",
            "key_id": "codeattest-release-signing-key",
            "key_version": "v1",
            "signing_time": "2026-08-16T00:00:00Z",
            "signed_identity_type": "runner_release",
            "signed_identity": identity,
            "canonicalization": "rfc8785",
            "signing_mode": "managed_key",
            "signing_limitations": [release_trust::SOFTWARE_CUSTODY_LIMITATION],
            "signature_bytes": format!("ml_dsa_65:{}", ml_dsa::base64url_encode(&signature))
        }
    });
    let path = dir.join("release-verification.json");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&artifact).expect("serialize"),
    )
    .expect("write");
    (path, released_binary)
}

#[test]
fn no_anchor_means_unsigned_not_trusted() {
    let dir = tempdir();
    let (artifact, released_binary) = signed_release_artifact("ci-build-0001", &dir);
    assert!(matches!(
        release_trust::verify_release("", Some(&artifact), Some(&released_binary), "ci-build-0001"),
        ReleaseTrust::Unsigned
    ));
}

#[test]
fn an_anchor_with_no_artifact_is_unsigned() {
    let anchor = ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&SEED));
    assert!(matches!(
        release_trust::verify_release(&anchor, None, None, "ci-build-0001"),
        ReleaseTrust::Unsigned
    ));
}

#[test]
fn a_verifying_release_reaches_the_trusted_state() {
    let dir = tempdir();
    let (artifact, released_binary) = signed_release_artifact("ci-build-0001", &dir);
    let anchor = ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&SEED));
    match release_trust::verify_release(
        &anchor,
        Some(&artifact),
        Some(&released_binary),
        "ci-build-0001",
    ) {
        ReleaseTrust::Verified {
            release_identifier, ..
        } => {
            assert_eq!(release_identifier, "codeattest-local-runner-v0.1.0");
        }
        other => panic!("expected Verified, got {other:?}"),
    }

    let trust = onevps_local_runner_scaffold::runner_trust_metadata_with_release(
        release_trust::verify_release(
            &anchor,
            Some(&artifact),
            Some(&released_binary),
            "ci-build-0001",
        ),
    );
    assert_eq!(trust.release_signature_status, "verified_release_signature");
    assert_eq!(trust.trust_label, "trusted_release");
    assert!(trust.release_verification_artifact.is_some());
    // The reported release identifier must come from the trust-anchor-verified
    // record, not from the unauthenticated ONEVPS_RUNNER_RELEASE_IDENTIFIER
    // env var default -- an operator who forgot to set it must not see a
    // trusted-release build reported under an unrelated identifier.
    assert_eq!(trust.release_identifier, "codeattest-local-runner-v0.1.0");
}

#[test]
fn a_release_for_a_different_build_is_untrusted() {
    let dir = tempdir();
    let (artifact, released_binary) = signed_release_artifact("ci-build-0001", &dir);
    let anchor = ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&SEED));
    assert!(matches!(
        release_trust::verify_release(
            &anchor,
            Some(&artifact),
            Some(&released_binary),
            "ci-build-0002"
        ),
        ReleaseTrust::Untrusted { .. }
    ));
}

#[test]
fn a_tampered_release_record_is_untrusted() {
    let dir = tempdir();
    let (artifact, released_binary) = signed_release_artifact("ci-build-0001", &dir);
    let mut parsed: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&artifact).expect("read")).expect("parse");
    parsed["release_record"]["release_identifier"] =
        serde_json::json!("codeattest-local-runner-v9.9.9");
    std::fs::write(
        &artifact,
        serde_json::to_vec_pretty(&parsed).expect("serialize"),
    )
    .expect("write");
    let anchor = ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&SEED));
    assert!(matches!(
        release_trust::verify_release(
            &anchor,
            Some(&artifact),
            Some(&released_binary),
            "ci-build-0001",
        ),
        ReleaseTrust::Untrusted { .. }
    ));

    let trust = onevps_local_runner_scaffold::runner_trust_metadata_with_release(
        release_trust::verify_release(
            &anchor,
            Some(&artifact),
            Some(&released_binary),
            "ci-build-0001",
        ),
    );
    assert_eq!(trust.release_signature_status, "untrusted_local_build");
    assert_eq!(trust.trust_label, "untrusted_local_dev");
}

#[test]
fn a_digest_mismatched_runner_binary_is_untrusted() {
    let dir = tempdir();
    let (artifact, released_binary) = signed_release_artifact("ci-build-0001", &dir);
    std::fs::write(&released_binary, b"tampered runner").expect("tamper runner artifact");
    let anchor = ml_dsa::base64url_encode(&ml_dsa::public_key_from_seed(&SEED));
    assert!(matches!(
        release_trust::verify_release(
            &anchor,
            Some(&artifact),
            Some(&released_binary),
            "ci-build-0001"
        ),
        ReleaseTrust::Untrusted { .. }
    ));
}

#[test]
fn trust_command_can_require_a_verified_release() {
    let dir = tempdir();
    let attempt_path = dir.join("attempts.jsonl");
    let output = Command::new(env!("CARGO_BIN_EXE_onevps-local-runner-scaffold"))
        .args([
            "runner",
            "trust",
            "--require-trusted-release",
            "--attempt-log",
            attempt_path.to_str().expect("scratch path must be utf-8"),
        ])
        .current_dir(&dir)
        .output()
        .expect("run trust command");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("runner release is not trusted"));
    assert!(!attempt_path.exists());
}

fn tempdir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "onevps-release-trust-{nanos}-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("create tempdir");
    dir
}
