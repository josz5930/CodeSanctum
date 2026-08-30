use std::path::Path;

use serde::Deserialize;

use crate::ml_dsa;

/// A release build injects this value through Cargo at compile time. Runtime
/// configuration cannot replace it. An ordinary local build deliberately has
/// an empty anchor and therefore cannot report `trusted_release`.
pub const RELEASE_TRUST_ANCHOR_PUBLIC_KEY: &str =
    match option_env!("CODEATTEST_RELEASE_TRUST_ANCHOR_PUBLIC_KEY") {
        Some(value) => value,
        None => "",
    };

pub const COMPILED_BUILD_IDENTIFIER: &str = match option_env!("CODEATTEST_RUNNER_BUILD_IDENTIFIER")
{
    Some(value) => value,
    None => "",
};

pub const COMPILED_RELEASE_IDENTIFIER: &str =
    match option_env!("CODEATTEST_RUNNER_RELEASE_IDENTIFIER") {
        Some(value) => value,
        None => "",
    };

pub const SOFTWARE_CUSTODY_LIMITATION: &str = "Key custody is self-hosted software custody in a non-validated cryptographic module, not a hardware security module.";

#[derive(Debug)]
pub enum ReleaseTrust {
    Unsigned,
    Untrusted {
        reason: String,
    },
    Verified {
        release_identifier: String,
        build_identifier: String,
        artifact_ref: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseVerificationArtifact {
    release_record: RunnerReleaseRecord,
    signing_input: serde_json::Value,
    signature: ReleaseSignature,
}

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct RunnerReleaseRecord {
    protocol_version: String,
    release_identifier: String,
    build_identifier: String,
    artifact_digest: String,
    released_at: String,
    limitations: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReleaseSignature {
    protocol_version: String,
    algorithm_profile: String,
    key_id: String,
    key_version: String,
    signing_time: String,
    signed_identity_type: String,
    signed_identity: String,
    canonicalization: String,
    signing_mode: String,
    signing_limitations: Vec<String>,
    signature_bytes: String,
}

pub fn release_signing_input(release_identity: &str) -> serde_json::Value {
    serde_json::json!({
        "protocol_version": crate::PROTOCOL_VERSION,
        "signing_input_type": "runner_release_identity",
        "algorithm_profile": "ml_dsa_65",
        "signed_identity_type": "runner_release",
        "signed_identity": release_identity,
        "canonicalization": "rfc8785",
        "identity_input_path": "v0/valid/runner-release-record.identity-input.json"
    })
}

/// Verifies a release record against a compile-time trust anchor and binds the
/// signed `artifact_digest` to the exact runner binary being executed.
pub fn verify_release(
    anchor_base64url: &str,
    verification_artifact_path: Option<&Path>,
    released_artifact_path: Option<&Path>,
    build_identifier: &str,
) -> ReleaseTrust {
    if anchor_base64url.is_empty() {
        return ReleaseTrust::Unsigned;
    }
    let Some(verification_path) = verification_artifact_path else {
        return ReleaseTrust::Unsigned;
    };
    let untrusted = |reason: &str| ReleaseTrust::Untrusted {
        reason: reason.to_string(),
    };
    let Some(released_path) = released_artifact_path else {
        return untrusted("released runner artifact path is unavailable");
    };

    let Ok(bytes) = std::fs::read(verification_path) else {
        return untrusted("release verification artifact is unreadable");
    };
    let Ok(artifact) = serde_json::from_slice::<ReleaseVerificationArtifact>(&bytes) else {
        return untrusted("release verification artifact is not the closed expected shape");
    };
    let record = &artifact.release_record;
    let signature = &artifact.signature;

    if record.protocol_version != crate::PROTOCOL_VERSION
        || record.release_identifier.is_empty()
        || record.build_identifier.is_empty()
        || record.released_at.is_empty()
        || record.limitations.is_empty()
        || record.limitations.iter().any(String::is_empty)
        || !record
            .limitations
            .iter()
            .any(|limitation| limitation == SOFTWARE_CUSTODY_LIMITATION)
    {
        return untrusted("release record is malformed");
    }
    if record.build_identifier != build_identifier {
        return untrusted("release record describes a different build");
    }
    if !COMPILED_RELEASE_IDENTIFIER.is_empty()
        && record.release_identifier != COMPILED_RELEASE_IDENTIFIER
    {
        return untrusted("release record describes a different compiled release");
    }
    let Ok(released_bytes) = std::fs::read(released_path) else {
        return untrusted("released runner artifact is unreadable");
    };
    if record.artifact_digest != crate::sha256_id(&released_bytes) {
        return untrusted("released runner artifact digest does not match the signed record");
    }

    let Ok(record_value) = serde_json::to_value(record) else {
        return untrusted("release record is not serializable");
    };
    let identity =
        crate::sha256_id(crate::canonicalize_protocol_json_value(&record_value).as_bytes());
    let signing_input = release_signing_input(&identity);
    if crate::canonicalize_protocol_json_value(&artifact.signing_input)
        != crate::canonicalize_protocol_json_value(&signing_input)
    {
        return untrusted("release signing input does not match the release record");
    }
    if signature.protocol_version != crate::PROTOCOL_VERSION
        || signature.signed_identity != identity
        || signature.signed_identity_type != "runner_release"
        || signature.algorithm_profile != "ml_dsa_65"
        || signature.canonicalization != "rfc8785"
        || signature.signing_mode != "managed_key"
        || signature.key_id.is_empty()
        || signature.key_version.is_empty()
        || signature.signing_time.is_empty()
        || !signature
            .signing_limitations
            .iter()
            .any(|limitation| limitation == SOFTWARE_CUSTODY_LIMITATION)
    {
        return untrusted("release signature is not bound to this release record");
    }
    let Some(bytes_text) = signature.signature_bytes.strip_prefix("ml_dsa_65:") else {
        return untrusted("release signature is not an ml_dsa_65 signature");
    };
    let (Some(signature_bytes), Some(anchor)) = (
        ml_dsa::base64url_decode(bytes_text),
        ml_dsa::base64url_decode(anchor_base64url),
    ) else {
        return untrusted("release signature or trust anchor is not valid base64url");
    };
    let canonical = crate::canonicalize_protocol_json_value(&signing_input);
    if !ml_dsa::verify(
        &anchor,
        &ml_dsa::signed_message(&canonical),
        &signature_bytes,
    ) {
        return untrusted("release signature does not verify against the release trust anchor");
    }
    ReleaseTrust::Verified {
        release_identifier: record.release_identifier.clone(),
        build_identifier: record.build_identifier.clone(),
        artifact_ref: verification_path.display().to_string(),
    }
}
