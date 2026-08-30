use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn cli_keys_init_creates_key_files_and_prints_only_the_public_key() {
    let fixture = temp_fixture("cli_keys_init");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let first = Command::new(&binary)
        .args(["keys", "init"])
        .current_dir(&fixture)
        .output()
        .expect("keys init should run");
    assert!(
        first.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&first.stderr)
    );
    let first_stdout = String::from_utf8(first.stdout).expect("stdout should be UTF-8");
    assert!(first_stdout.contains("key_id: codeattest-local-runner-key"));
    assert!(first_stdout.contains("key_version: v1"));
    assert!(first_stdout.contains("public_key:"));

    let seed_path = fixture.join(".codeattest/keys/signing-key.seed");
    let public_path = fixture.join(".codeattest/keys/signing-key.pub");
    assert!(seed_path.exists());
    assert!(public_path.exists());
    let seed_base64url = fs::read(&seed_path).expect("seed bytes");
    assert!(
        !first_stdout.contains(&base64url_encode(&seed_base64url)),
        "the seed must never appear in keys init stdout"
    );
    for line in first_stdout.lines() {
        assert!(
            !line.starts_with("seed:") && !line.to_ascii_lowercase().contains("seed"),
            "keys init stdout must never mention the seed: {line}"
        );
    }

    // Running it again must reuse the same key, not regenerate it.
    let second = Command::new(&binary)
        .args(["keys", "init"])
        .current_dir(&fixture)
        .output()
        .expect("keys init rerun should run");
    assert!(second.status.success());
    let second_stdout = String::from_utf8(second.stdout).expect("stdout should be UTF-8");
    assert_eq!(
        public_key_line(&first_stdout),
        public_key_line(&second_stdout),
        "rerunning keys init must print the same public key"
    );
}

#[test]
fn cli_keys_enrollment_emits_a_record_matching_the_initialized_key() {
    let fixture = temp_fixture("cli_keys_enrollment");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let init = Command::new(&binary)
        .args(["keys", "init"])
        .current_dir(&fixture)
        .output()
        .expect("keys init should run");
    assert!(init.status.success());
    let init_stdout = String::from_utf8(init.stdout).expect("init stdout should be UTF-8");
    let expected_public_key = public_key_line(&init_stdout);

    let enrollment = Command::new(&binary)
        .args(["keys", "enrollment", "--review-id", "review:demo-partner"])
        .current_dir(&fixture)
        .output()
        .expect("keys enrollment should run");
    assert!(
        enrollment.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&enrollment.stderr)
    );
    let enrollment_stdout =
        String::from_utf8(enrollment.stdout).expect("enrollment stdout should be UTF-8");
    let record: serde_json::Value =
        serde_json::from_str(&enrollment_stdout).expect("enrollment stdout is JSON");
    assert_eq!(record["review_id"], "review:demo-partner");
    assert_eq!(record["public_key"], expected_public_key);
    assert_eq!(record["algorithm_profile"], "ml_dsa_65");
    assert_eq!(record["enrollment_method"], "operator_verified");
    assert!(
        !enrollment_stdout.to_ascii_lowercase().contains("seed"),
        "enrollment stdout must never mention the seed"
    );
}

#[test]
fn cli_keys_enrollment_rejects_an_invalid_review_id() {
    let fixture = temp_fixture("cli_keys_enrollment_invalid");
    fs::create_dir_all(&fixture).expect("fixture dir");
    let binary = std::env::var("CARGO_BIN_EXE_onevps-local-runner-scaffold")
        .expect("Cargo should expose the local runner binary path to integration tests");

    let enrollment = Command::new(&binary)
        .args(["keys", "enrollment", "--review-id", "nope"])
        .current_dir(&fixture)
        .output()
        .expect("keys enrollment should run");
    assert!(
        !enrollment.status.success(),
        "expected failure for an invalid --review-id"
    );
}

fn public_key_line(stdout: &str) -> String {
    stdout
        .lines()
        .find_map(|line| line.strip_prefix("public_key: "))
        .expect("stdout should contain a public_key line")
        .to_string()
}

/// Minimal unpadded base64url encode used only to build the negative
/// assertion in `cli_keys_init_creates_key_files_and_prints_only_the_public_key`
/// (does the seed's own encoding ever leak into stdout).
fn base64url_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        let indices = [
            (triple >> 18) & 0x3F,
            (triple >> 12) & 0x3F,
            (triple >> 6) & 0x3F,
            triple & 0x3F,
        ];
        for index in indices.iter().take(chunk.len() + 1) {
            out.push(ALPHABET[*index as usize] as char);
        }
    }
    out
}

fn temp_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-task-9-cli-keys-{name}-{nanos}"))
}
