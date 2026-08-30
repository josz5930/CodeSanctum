//! Sub-project B: the three-phase HTTP client that walks a prepared,
//! signed Evidence Bundle through `POST /v0/submissions` ->
//! `PUT /v0/submissions/{id}/artifacts/{digest}` (one per missing artifact)
//! -> `POST /v0/submissions/{id}/finalize`.
//!
//! `ureq` with `rustls` and no default features (spec B-3): blocking, no
//! async runtime, minimal transitive dependency tree for the repository's
//! first network dependency in any language.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use ureq::Agent;

use crate::{
    LocalApprovalMetadata, LocalAttemptDiagnostics, LocalAttemptIdentities, LocalBundleState,
    LocalRunnerAttempt, LocalRunnerOutcome, LocalRunnerStage, ReviewState, RunnerMetadata,
    RunnerTrustMetadata, sha256_id,
};

pub struct SubmitInput {
    pub endpoint: String,
    pub bundle_dir: PathBuf,
    pub token_key_id: String,
    pub token_secret: String,
}

/// The identities and runner metadata `submit_attempt` needs to build a
/// schema-valid record. Sourced from the same bundle and customer approval
/// `submit send` is about to (or already did) submit -- a submit attempt's
/// bundle identities are unchanged by what the server decided.
pub struct SubmitAttemptContext {
    pub runner: RunnerMetadata,
    pub runner_trust: RunnerTrustMetadata,
    pub selected_commit: String,
    pub repository_identity: String,
    pub manifest_id: String,
    pub approval_id: String,
    pub approval_decided_at: String,
    pub evidence_bundle_id: String,
    pub bundle_instance_id: String,
    pub submission_attempt_id: String,
    pub occurred_at: String,
}

#[derive(Debug)]
pub enum SubmitOutcome {
    Received {
        submission_outcome: Value,
    },
    Refused {
        submission_outcome: Value,
    },
    TransportFailed {
        failure_code: String,
        retryable: bool,
    },
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// The exact prefix `write_signed_evidence_bundle` writes an approved
/// outbound manifest under, inside the bundle's own artifact tree -- there
/// is no separate top-level copy.
const OUTBOUND_MANIFEST_RELATIVE_PATH: &str = "artifacts/outbound-manifest.json";

fn authorization(input: &SubmitInput) -> String {
    format!("Bearer {}:{}", input.token_key_id, input.token_secret)
}

fn build_agent() -> Agent {
    let config = Agent::config_builder()
        // Business outcomes (received/rejected/quarantined) are always a 200
        // body; only genuine transport/auth failures are non-2xx. Reading the
        // status ourselves, rather than letting ureq turn 4xx/5xx into an
        // Err with no body, lets a claim-safe reason_code survive into the
        // attempt record instead of being discarded.
        .http_status_as_error(false)
        .timeout_global(Some(REQUEST_TIMEOUT))
        .build();
    config.into()
}

fn read_json_part(bundle_dir: &Path, relative_path: &str) -> Result<Value, SubmitOutcome> {
    let unreadable = || SubmitOutcome::TransportFailed {
        failure_code: "submit_local_bundle_unreadable".to_string(),
        retryable: false,
    };
    let bytes = fs::read(bundle_dir.join(relative_path)).map_err(|_| unreadable())?;
    serde_json::from_slice(&bytes).map_err(|_| unreadable())
}

fn transport_failed_from_status(status: u16, body: &[u8]) -> SubmitOutcome {
    // The server's own reason_code is already a stable, claim-safe token
    // (services/host/src/error-envelope.ts); anything else in the body is
    // never propagated, so a server that returns arbitrary text cannot put
    // arbitrary text in the runner's local attempt log.
    let reason_code = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("reason_code")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .filter(|code| is_valid_failure_code(code));
    let failure_code = reason_code.unwrap_or_else(|| "submit_request_refused".to_string());
    SubmitOutcome::TransportFailed {
        failure_code,
        retryable: status >= 500,
    }
}

fn is_valid_failure_code(code: &str) -> bool {
    let mut chars = code.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    code.len() >= 3
        && code.len() <= 64
        && code
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn submit_bundle(input: &SubmitInput) -> SubmitOutcome {
    let agent = build_agent();
    let auth = authorization(input);

    let bundle_manifest = match read_json_part(&input.bundle_dir, "bundle_manifest.json") {
        Ok(value) => value,
        Err(outcome) => return outcome,
    };
    let signature_envelope =
        match read_json_part(&input.bundle_dir, "signature-envelope.bundle.json") {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };
    let customer_approval = match read_json_part(&input.bundle_dir, "customer-approval.json") {
        Ok(value) => value,
        Err(outcome) => return outcome,
    };
    let approved_outbound_manifest =
        match read_json_part(&input.bundle_dir, OUTBOUND_MANIFEST_RELATIVE_PATH) {
            Ok(value) => value,
            Err(outcome) => return outcome,
        };

    // Phase 1: open.
    let open_body = serde_json::json!({
        "bundle_manifest": bundle_manifest,
        "signature_envelope": signature_envelope,
        "customer_approval": customer_approval,
        "approved_outbound_manifest": approved_outbound_manifest,
    });
    let open_url = format!("{}/v0/submissions", input.endpoint);
    let open_bytes = match serde_json::to_vec(&open_body) {
        Ok(bytes) => bytes,
        Err(_) => {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_local_bundle_unreadable".to_string(),
                retryable: false,
            };
        }
    };
    let open_response = agent
        .post(&open_url)
        .header("authorization", &auth)
        .content_type("application/json")
        .send(open_bytes.as_slice());
    let (open_status, open_body_bytes) = match read_response(open_response) {
        Ok(pair) => pair,
        Err(outcome) => return outcome,
    };
    if open_status != 200 && open_status != 201 {
        return transport_failed_from_status(open_status, &open_body_bytes);
    }
    let opened: Value = match serde_json::from_slice(&open_body_bytes) {
        Ok(value) => value,
        Err(_) => {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_response_malformed".to_string(),
                retryable: true,
            };
        }
    };
    let Some(submission_attempt_id) = opened.get("submission_attempt_id").and_then(|v| v.as_str())
    else {
        return SubmitOutcome::TransportFailed {
            failure_code: "submit_response_malformed".to_string(),
            retryable: true,
        };
    };
    let missing_digests: Vec<String> = opened
        .get("missing_digests")
        .and_then(|v| v.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    // Phase 2: PUT every artifact the server reported missing. A dropped
    // connection mid-bundle only ever resumes what is still missing.
    let artifact_references = bundle_manifest
        .get("artifact_references")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for digest in &missing_digests {
        let Some(reference) = artifact_references
            .iter()
            .find(|entry| entry.get("digest").and_then(|v| v.as_str()) == Some(digest.as_str()))
        else {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_local_bundle_unreadable".to_string(),
                retryable: false,
            };
        };
        let Some(content_path) = reference.get("content_path").and_then(|v| v.as_str()) else {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_local_bundle_unreadable".to_string(),
                retryable: false,
            };
        };
        let bytes = match fs::read(input.bundle_dir.join(content_path)) {
            Ok(bytes) => bytes,
            Err(_) => {
                return SubmitOutcome::TransportFailed {
                    failure_code: "submit_local_bundle_unreadable".to_string(),
                    retryable: false,
                };
            }
        };
        // Re-derive the digest locally before sending: a corrupt local file
        // must be reported as a local problem, never as a server rejection.
        if sha256_id(&bytes) != *digest {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_local_digest_mismatch".to_string(),
                retryable: false,
            };
        }
        let put_url = format!(
            "{}/v0/submissions/{}/artifacts/{}",
            input.endpoint, submission_attempt_id, digest
        );
        let put_response = agent
            .put(&put_url)
            .header("authorization", &auth)
            .content_type("application/octet-stream")
            .send(bytes.as_slice());
        let (put_status, put_body_bytes) = match read_response(put_response) {
            Ok(pair) => pair,
            Err(outcome) => return outcome,
        };
        if put_status != 200 {
            return transport_failed_from_status(put_status, &put_body_bytes);
        }
    }

    // Phase 3: finalize.
    let finalize_url = format!(
        "{}/v0/submissions/{}/finalize",
        input.endpoint, submission_attempt_id
    );
    let finalize_response = agent
        .post(&finalize_url)
        .header("authorization", &auth)
        .content_type("application/json")
        .send(b"{}".as_slice());
    let (finalize_status, finalize_body_bytes) = match read_response(finalize_response) {
        Ok(pair) => pair,
        Err(outcome) => return outcome,
    };
    if finalize_status != 200 {
        return transport_failed_from_status(finalize_status, &finalize_body_bytes);
    }
    let finalized: Value = match serde_json::from_slice(&finalize_body_bytes) {
        Ok(value) => value,
        Err(_) => {
            return SubmitOutcome::TransportFailed {
                failure_code: "submit_response_malformed".to_string(),
                retryable: true,
            };
        }
    };
    let Some(submission_outcome) = finalized.get("submission_outcome").cloned() else {
        return SubmitOutcome::TransportFailed {
            failure_code: "submit_response_malformed".to_string(),
            retryable: true,
        };
    };
    match submission_outcome
        .get("outcome_state")
        .and_then(|v| v.as_str())
    {
        Some("received_with_receipt") => SubmitOutcome::Received { submission_outcome },
        Some(_) => SubmitOutcome::Refused { submission_outcome },
        None => SubmitOutcome::TransportFailed {
            failure_code: "submit_response_malformed".to_string(),
            retryable: true,
        },
    }
}

/// Every connection-level failure (refused connection, DNS failure, timeout,
/// protocol error) collapses to one retryable transport failure: none of
/// ureq's specific error variants change what the runner or the customer
/// should do next, and only the reason_code from a real HTTP response is
/// ever trusted for anything more specific.
fn read_response(
    result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
) -> Result<(u16, Vec<u8>), SubmitOutcome> {
    match result {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.into_body().read_to_vec().unwrap_or_default();
            Ok((status, body))
        }
        Err(_) => Err(SubmitOutcome::TransportFailed {
            failure_code: "submit_connection_refused".to_string(),
            retryable: true,
        }),
    }
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

/// Maps a `SubmitOutcome` to the local attempt record Task 8 appends to
/// `.codeattest/local-runner-attempts.jsonl`. `review_state` stays
/// `signed_bundle_not_submitted` and `bundle_state` stays `ready_not_submitted`
/// in every row: the local bundle is unchanged by what the server decided,
/// and inventing a local state to mirror a remote one would be protocol
/// invention outside this sub-project's scope.
pub fn submit_attempt(
    outcome: &SubmitOutcome,
    context: &SubmitAttemptContext,
) -> LocalRunnerAttempt {
    let base_identities = LocalAttemptIdentities {
        selected_commit: Some(context.selected_commit.clone()),
        repository_identity: Some(context.repository_identity.clone()),
        manifest_id: Some(context.manifest_id.clone()),
        approval_id: Some(context.approval_id.clone()),
        evidence_bundle_id: Some(context.evidence_bundle_id.clone()),
        bundle_instance_id: Some(context.bundle_instance_id.clone()),
        submission_attempt_id: Some(context.submission_attempt_id.clone()),
        vendor_receipt_id: None,
        submission_outcome_id: None,
    };

    let (runner_outcome, remote_state, identities, message, retryable, failure_code, next_actions) =
        match outcome {
            SubmitOutcome::Received { submission_outcome } => (
                LocalRunnerOutcome::Succeeded,
                "received_with_receipt",
                LocalAttemptIdentities {
                    vendor_receipt_id: string_field(submission_outcome, "vendor_receipt_ref"),
                    submission_outcome_id: string_field(
                        submission_outcome,
                        "submission_outcome_id",
                    ),
                    ..base_identities
                },
                "SYNTHETIC_DEMO_DATA submit completed with a receipt. NOT_CUSTOMER_SOURCE."
                    .to_string(),
                false,
                None,
                vec!["verify the receipt".to_string()],
            ),
            SubmitOutcome::Refused { submission_outcome } => {
                let quarantined = submission_outcome
                    .get("outcome_state")
                    .and_then(|v| v.as_str())
                    == Some("quarantined_no_receipt");
                (
                    if quarantined {
                        LocalRunnerOutcome::Blocked
                    } else {
                        LocalRunnerOutcome::Failed
                    },
                    if quarantined {
                        "quarantined_no_receipt"
                    } else {
                        "rejected_no_receipt"
                    },
                    LocalAttemptIdentities {
                        submission_outcome_id: string_field(
                            submission_outcome,
                            "submission_outcome_id",
                        ),
                        ..base_identities
                    },
                    "SYNTHETIC_DEMO_DATA submit completed without a receipt. NOT_CUSTOMER_SOURCE."
                        .to_string(),
                    !quarantined,
                    None,
                    vec![
                        "review the returned reason codes".to_string(),
                        "rerun submit".to_string(),
                    ],
                )
            }
            SubmitOutcome::TransportFailed {
                failure_code,
                retryable,
            } => (
                LocalRunnerOutcome::Failed,
                "submit_attempted",
                base_identities,
                "SYNTHETIC_DEMO_DATA submit did not reach a server answer. NOT_CUSTOMER_SOURCE."
                    .to_string(),
                *retryable,
                Some(failure_code.clone()),
                vec![
                    "check connectivity to the submission endpoint".to_string(),
                    "rerun submit".to_string(),
                ],
            ),
        };

    LocalRunnerAttempt {
        protocol_version: "codeattest.v0".to_string(),
        attempt_id: crate::local_attempt_id(LocalRunnerStage::Submit, &context.occurred_at, None),
        stage: LocalRunnerStage::Submit,
        outcome: runner_outcome,
        review_state: ReviewState::SignedBundleNotSubmitted,
        approval_state: crate::ApprovalState::Approved,
        bundle_state: LocalBundleState::ReadyNotSubmitted,
        remote_state: remote_state.to_string(),
        occurred_at: context.occurred_at.clone(),
        runner: context.runner.clone(),
        runner_trust: context.runner_trust.clone(),
        identities,
        approval_metadata: Some(LocalApprovalMetadata {
            decision: "approved".to_string(),
            decided_at: context.approval_decided_at.clone(),
            approving_actor: None,
        }),
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: None,
            failure_code,
            message,
            retryable,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: "Verify the returned outcome locally.".to_string(),
            local_artifact_paths: Vec::new(),
        },
        next_actions,
    }
}
