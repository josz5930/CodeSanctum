use onevps_local_runner_scaffold::keys;
use onevps_local_runner_scaffold::ml_dsa;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn generates_a_key_once_and_reuses_it_afterwards() {
    let dir = tempdir();
    let first =
        keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("first load");
    let second =
        keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("second load");
    assert_eq!(
        first.seed, second.seed,
        "an existing key must be reused, never regenerated"
    );
    assert_eq!(first.public_key, second.public_key);
    assert_eq!(first.public_key, ml_dsa::public_key_from_seed(&first.seed));
}

#[test]
fn the_seed_file_is_owner_only() {
    // This checks the FINISHED file's mode, which by itself cannot prove
    // there was never a wider-mode window during creation -- a runtime test
    // can't observe an intermediate state inside a single `open()` syscall.
    // The actual guarantee is structural: `load_or_create_signing_key`'s
    // only file-creation call for the seed path is
    // `write_new_file_with_mode(&seed_path, &seed, 0o600)` in
    // `src/keys.rs`, which passes `.mode(0o600)` to `OpenOptions` so the
    // kernel creates the file at 0600 as part of the same syscall that
    // creates it -- there is no separate create-then-chmod step (and thus
    // no window) for a reviewer to introduce by mistake later, unlike the
    // previous `fs::write` + `fs::set_permissions` pattern this replaced.
    let dir = tempdir();
    keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("load");
    let mode = fs::metadata(dir.join("signing-key.seed"))
        .expect("seed metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(
        mode, 0o600,
        "the private seed must never be group- or world-readable"
    );
    let pub_mode = fs::metadata(dir.join("signing-key.pub"))
        .expect("public metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(pub_mode, 0o644);
}

#[test]
fn a_truncated_seed_file_is_an_error_not_a_weak_key() {
    let dir = tempdir();
    keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("load");
    fs::write(dir.join("signing-key.seed"), [0u8; 16]).expect("truncate");
    assert!(keys::load_or_create_signing_key(&dir, "codeattest-runner-test").is_err());
}

#[test]
fn signs_the_bundle_identity_verifiably() {
    let dir = tempdir();
    let key = keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("load");
    let bundle_id = format!("sha256:{}", "a".repeat(64));
    let envelope =
        keys::sign_bundle_identity(&key, &bundle_id, "2026-06-01T00:00:00Z").expect("sign");

    assert_eq!(envelope.algorithm_profile, "ml_dsa_65");
    assert_eq!(envelope.signing_mode, "enrolled_runner_key");
    assert_eq!(envelope.signed_identity, bundle_id);
    assert!(envelope.signature_bytes.starts_with("ml_dsa_65:"));
    assert_eq!(envelope.signature_bytes.len(), "ml_dsa_65:".len() + 4412);

    let signing_input = keys::bundle_signing_input(&bundle_id);
    let canonical = onevps_local_runner_scaffold::canonicalize_protocol_json_value(&signing_input);
    let message = ml_dsa::signed_message(&canonical);
    let signature =
        ml_dsa::base64url_decode(&envelope.signature_bytes["ml_dsa_65:".len()..]).expect("decode");
    assert!(ml_dsa::verify(&key.public_key, &message, &signature));

    // A signature over one bundle must not verify for another.
    let other = ml_dsa::signed_message(
        &onevps_local_runner_scaffold::canonicalize_protocol_json_value(
            &keys::bundle_signing_input(&format!("sha256:{}", "b".repeat(64))),
        ),
    );
    assert!(!ml_dsa::verify(&key.public_key, &other, &signature));
}

#[test]
fn the_enrollment_record_carries_only_the_public_key() {
    let dir = tempdir();
    let key = keys::load_or_create_signing_key(&dir, "codeattest-runner-test").expect("load");
    let record = keys::enrollment_record(&key, "review:pilot-partner-one", "2026-06-01T00:00:00Z")
        .expect("record");
    let text = serde_json::to_string(&record).expect("serialize");

    assert_eq!(
        record["public_key"].as_str().expect("public key").len(),
        2603
    );
    assert_eq!(record["algorithm_profile"], "ml_dsa_65");
    assert_eq!(record["review_id"], "review:pilot-partner-one");
    assert_eq!(record["enrollment_method"], "operator_verified");
    assert!(
        !text.contains(&ml_dsa::base64url_encode(&key.seed)),
        "the seed must never appear in an enrollment record"
    );
}

fn tempdir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-task-9-keys-{nanos}-{}", std::process::id()))
}
