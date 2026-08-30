use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::PROTOCOL_VERSION;
use crate::SignatureEnvelope;
use crate::ml_dsa;

pub const RUNNER_SIGNING_LIMITATIONS: [&str; 2] = [
    "Key custody is customer-held runner custody; the private key is generated on this machine and never transmitted.",
    "The runner is open source and runs on the customer's own machine, so this signature cannot attest that the runner code was unmodified.",
];

const SEED_FILE: &str = "signing-key.seed";
const PUBLIC_FILE: &str = "signing-key.pub";
const KEY_VERSION: &str = "v1";

#[derive(Debug)]
pub enum KeyError {
    Io { path: PathBuf, reason: String },
    MalformedSeed { path: PathBuf },
    NoEntropy { reason: String },
    InvalidReviewId { value: String },
}

pub struct RunnerSigningKey {
    pub key_id: String,
    pub key_version: String,
    pub seed: [u8; 32],
    pub public_key: [u8; 1952],
}

pub fn default_key_dir() -> PathBuf {
    PathBuf::from(".codeattest/keys")
}

fn read_os_entropy() -> Result<[u8; 32], KeyError> {
    let mut seed = [0u8; ml_dsa::SEED_BYTES];
    let mut source = fs::File::open("/dev/urandom").map_err(|error| KeyError::NoEntropy {
        reason: error.to_string(),
    })?;
    source
        .read_exact(&mut seed)
        .map_err(|error| KeyError::NoEntropy {
            reason: error.to_string(),
        })?;
    Ok(seed)
}

/// Creates (or truncates) `path` and writes `contents`, with `mode` applied
/// as part of the same `open()` syscall that creates the file -- never
/// create-then-chmod, which would leave a window where the file is
/// observable at the process's default create mode (umask-reduced 0o666)
/// before a follow-up `chmod` narrows it. `mode` only takes effect when the
/// file is newly created; it has no effect on an already-existing file's
/// permissions (matching Rust's `OpenOptionsExt::mode` semantics).
fn write_new_file_with_mode(path: &Path, contents: &[u8], mode: u32) -> Result<(), KeyError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(path)
        .map_err(|error| KeyError::Io {
            path: path.to_path_buf(),
            reason: error.to_string(),
        })?;
    file.write_all(contents).map_err(|error| KeyError::Io {
        path: path.to_path_buf(),
        reason: error.to_string(),
    })
}

pub fn load_or_create_signing_key(dir: &Path, key_id: &str) -> Result<RunnerSigningKey, KeyError> {
    let seed_path = dir.join(SEED_FILE);
    let seed = if seed_path.exists() {
        let bytes = fs::read(&seed_path).map_err(|error| KeyError::Io {
            path: seed_path.clone(),
            reason: error.to_string(),
        })?;
        if bytes.len() != ml_dsa::SEED_BYTES {
            return Err(KeyError::MalformedSeed { path: seed_path });
        }
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&bytes);
        seed
    } else {
        fs::create_dir_all(dir).map_err(|error| KeyError::Io {
            path: dir.to_path_buf(),
            reason: error.to_string(),
        })?;
        let seed = read_os_entropy()?;
        // Create the seed file with the target mode as part of the same
        // open() syscall that creates it, rather than create-then-chmod:
        // the latter leaves a window (until the chmod lands) where the
        // file exists at the process's default create mode (0o666 minus
        // umask -- e.g. 0o644 under a typical 022 umask), which is
        // group/world-readable private key material. Requesting 0o600
        // directly means the file is never observable at a wider mode --
        // this is the only place this file is ever created, and this is
        // the only `open()`/`write()` call in that path.
        write_new_file_with_mode(&seed_path, &seed, 0o600)?;
        seed
    };

    let public_key = ml_dsa::public_key_from_seed(&seed);
    let public_path = dir.join(PUBLIC_FILE);
    write_new_file_with_mode(
        &public_path,
        ml_dsa::base64url_encode(&public_key).as_bytes(),
        0o644,
    )?;

    Ok(RunnerSigningKey {
        key_id: key_id.to_string(),
        key_version: KEY_VERSION.to_string(),
        seed,
        public_key,
    })
}

pub fn bundle_signing_input(evidence_bundle_id: &str) -> serde_json::Value {
    serde_json::json!({
        "protocol_version": PROTOCOL_VERSION,
        "signing_input_type": "evidence_bundle_identity",
        "algorithm_profile": "ml_dsa_65",
        "signed_identity_type": "evidence_bundle",
        "signed_identity": evidence_bundle_id,
        "canonicalization": "rfc8785",
        "identity_input_path": "v0/valid/bundle-manifest.identity-input.json"
    })
}

/// Signs the evidence bundle identity for real: canonicalizes
/// `bundle_signing_input` with the crate's RFC 8785 canonicalizer, signs the
/// domain-separated message deterministically from the key's seed, and wraps
/// the result as a `SignatureEnvelope` with `signing_mode:
/// "enrolled_runner_key"`. The seed itself never appears in the envelope.
pub fn sign_bundle_identity(
    key: &RunnerSigningKey,
    evidence_bundle_id: &str,
    signing_time: &str,
) -> Result<SignatureEnvelope, KeyError> {
    let signing_input = bundle_signing_input(evidence_bundle_id);
    let canonical = crate::canonicalize_protocol_json_value(&signing_input);
    let message = ml_dsa::signed_message(&canonical);
    let signature = ml_dsa::sign_deterministic_from_seed(&key.seed, &message);

    Ok(SignatureEnvelope {
        protocol_version: PROTOCOL_VERSION.to_string(),
        algorithm_profile: "ml_dsa_65".to_string(),
        key_id: key.key_id.clone(),
        key_version: key.key_version.clone(),
        signing_time: signing_time.to_string(),
        signed_identity_type: "evidence_bundle".to_string(),
        signed_identity: evidence_bundle_id.to_string(),
        canonicalization: "rfc8785".to_string(),
        signing_mode: "enrolled_runner_key".to_string(),
        signing_limitations: RUNNER_SIGNING_LIMITATIONS
            .iter()
            .map(|limitation| limitation.to_string())
            .collect(),
        signature_bytes: format!("ml_dsa_65:{}", ml_dsa::base64url_encode(&signature)),
    })
}

fn validate_review_id(review_id: &str) -> Result<(), KeyError> {
    let pattern = Regex::new(r"^review:[a-z0-9][a-z0-9_-]{2,63}$")
        .expect("review id pattern is a fixed valid regex literal");
    if pattern.is_match(review_id) {
        Ok(())
    } else {
        Err(KeyError::InvalidReviewId {
            value: review_id.to_string(),
        })
    }
}

/// Builds the `runner-key-enrollment-record` protocol document (D1 Task 6)
/// that carries the runner's public key to a reviewer for operator-verified
/// enrollment. Carries only the public key; the seed never appears here.
pub fn enrollment_record(
    key: &RunnerSigningKey,
    review_id: &str,
    enrolled_at: &str,
) -> Result<serde_json::Value, KeyError> {
    validate_review_id(review_id)?;
    let enrollment_id = format!(
        "runner_enrollment:{}",
        review_id.trim_start_matches("review:")
    );
    Ok(serde_json::json!({
        "protocol_version": PROTOCOL_VERSION,
        "enrollment_id": enrollment_id,
        "review_id": review_id,
        "runner_key_id": key.key_id,
        "runner_key_version": key.key_version,
        "algorithm_profile": "ml_dsa_65",
        "public_key": ml_dsa::base64url_encode(&key.public_key),
        "enrollment_method": "operator_verified",
        "enrolled_at": enrolled_at,
        "limitations": RUNNER_SIGNING_LIMITATIONS,
    }))
}
