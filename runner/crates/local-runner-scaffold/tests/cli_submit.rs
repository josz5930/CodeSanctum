use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;

use sha2::{Digest, Sha256};

fn sha256_id(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

/// Writes the exact file layout `write_signed_evidence_bundle` produces
/// (`bundle_manifest.json`, `signature-envelope.bundle.json`,
/// `customer-approval.json`, `artifacts/outbound-manifest.json`, plus the
/// content-addressed artifact files under `artifacts/`), with two artifact
/// references whose digests are derived from the actual file bytes with
/// `sha2` rather than hard-coded, so the fixture cannot drift from itself.
fn synthetic_bundle_dir_with_two_artifacts() -> (PathBuf, [String; 2]) {
    let dir = std::env::temp_dir().join(format!(
        "onevps-cli-submit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    let artifacts_dir = dir.join("artifacts");
    fs::create_dir_all(&artifacts_dir).expect("create artifacts dir");

    let first_bytes = b"SYNTHETIC_DEMO_DATA review scope. NOT_CUSTOMER_SOURCE.".to_vec();
    let second_bytes = b"SYNTHETIC_DEMO_DATA disclosure policy. NOT_CUSTOMER_SOURCE.".to_vec();
    fs::write(artifacts_dir.join("review-scope.json"), &first_bytes).expect("write review-scope");
    fs::write(artifacts_dir.join("disclosure-policy.json"), &second_bytes)
        .expect("write disclosure-policy");
    let first_digest = sha256_id(&first_bytes);
    let second_digest = sha256_id(&second_bytes);

    let bundle_manifest = serde_json::json!({
        "protocol_version": "codeattest.v0",
        "evidence_bundle_id": format!("sha256:{}", "0".repeat(64)),
        "manifest_id": format!("sha256:{}", "1".repeat(64)),
        "bundle_instance_id": "bundle_instance:cli-submit-test",
        "submission_attempt_id": "submission_attempt:synthetic-demo-0001",
        "artifact_references": [
            {
                "digest": first_digest,
                "content_path": "artifacts/review-scope.json",
                "artifact_type": "review_scope"
            },
            {
                "digest": second_digest,
                "content_path": "artifacts/disclosure-policy.json",
                "artifact_type": "disclosure_policy"
            }
        ]
    });
    fs::write(
        dir.join("bundle_manifest.json"),
        serde_json::to_vec(&bundle_manifest).expect("serialize bundle manifest"),
    )
    .expect("write bundle manifest");

    let signature_envelope = serde_json::json!({
        "protocol_version": "codeattest.v0",
        "algorithm_profile": "ml_dsa_65",
        "signing_mode": "enrolled_runner_key",
        "signed_identity_type": "evidence_bundle",
        "signed_identity": bundle_manifest["evidence_bundle_id"]
    });
    fs::write(
        dir.join("signature-envelope.bundle.json"),
        serde_json::to_vec(&signature_envelope).expect("serialize signature envelope"),
    )
    .expect("write signature envelope");

    let customer_approval = serde_json::json!({
        "protocol_version": "codeattest.v0",
        "approval_id": "approval:cli-submit-test",
        "manifest_id": bundle_manifest["manifest_id"],
        "decision": "approved"
    });
    fs::write(
        dir.join("customer-approval.json"),
        serde_json::to_vec(&customer_approval).expect("serialize approval"),
    )
    .expect("write customer approval");

    let outbound_manifest = serde_json::json!({
        "protocol_version": "codeattest.v0",
        "manifest_id": bundle_manifest["manifest_id"]
    });
    fs::write(
        artifacts_dir.join("outbound-manifest.json"),
        serde_json::to_vec(&outbound_manifest).expect("serialize outbound manifest"),
    )
    .expect("write outbound manifest");

    (dir, [first_digest, second_digest])
}

/// A three-phase stub: 201 with the given missing digests, 200 for each PUT,
/// then a received_with_receipt outcome. It asserts the client's request
/// shape, which is the thing under test. `expected_requests` bounds how many
/// connections it accepts before returning the collected request lines.
fn spawn_stub_reporting_missing(
    missing: Vec<String>,
    expected_requests: usize,
) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stub");
    let endpoint = format!("http://{}", listener.local_addr().expect("addr"));
    let handle = thread::spawn(move || {
        let mut request_lines = Vec::new();
        let missing_json = serde_json::to_string(&missing).expect("serialize missing digests");
        for _ in 0..expected_requests {
            let (stream, _) = listener.accept().expect("accept");
            let mut reader = BufReader::new(stream.try_clone().expect("clone"));
            let mut start_line = String::new();
            reader.read_line(&mut start_line).expect("start line");
            request_lines.push(start_line.trim_end().to_string());

            let mut content_length = 0usize;
            let mut has_auth = false;
            loop {
                let mut header = String::new();
                reader.read_line(&mut header).expect("header");
                let header = header.trim_end();
                if header.is_empty() {
                    break;
                }
                let lower = header.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("content-length:") {
                    content_length = value.trim().parse().expect("length");
                }
                if lower.starts_with("authorization: bearer ") {
                    has_auth = true;
                }
            }
            assert!(has_auth, "every phase must carry the submission credential");
            let mut body = vec![0u8; content_length];
            reader.read_exact(&mut body).expect("body");

            let payload = if request_lines.len() == 1 {
                format!(
                    r#"{{"submission_attempt_id":"submission_attempt:synthetic-demo-0001","review_id":"review:synthetic-demo-0001","missing_digests":{missing_json}}}"#
                )
            } else if request_lines.len() == expected_requests {
                r#"{"submission_outcome":{"outcome_state":"received_with_receipt","next_path":"verify_receipt"}}"#.to_string()
            } else {
                r#"{"outcome":"stored","missing_digests":[]}"#.to_string()
            };
            let status = if request_lines.len() == 1 {
                "201 Created"
            } else {
                "200 OK"
            };
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
                payload.len()
            )
            .expect("respond");
        }
        request_lines
    });
    (endpoint, handle)
}

fn spawn_stub(digests: &[String; 2]) -> (String, thread::JoinHandle<Vec<String>>) {
    spawn_stub_reporting_missing(digests.to_vec(), 4)
}

#[test]
fn submit_walks_all_three_phases_in_order() {
    let (bundle_dir, digests) = synthetic_bundle_dir_with_two_artifacts();
    let (endpoint, handle) = spawn_stub(&digests);

    let outcome =
        onevps_local_runner_scaffold::submit_bundle(&onevps_local_runner_scaffold::SubmitInput {
            endpoint,
            bundle_dir,
            token_key_id: "demo-runner-key-1".to_string(),
            token_secret: "synthetic-demo-submission-secret".to_string(),
        });

    match outcome {
        onevps_local_runner_scaffold::SubmitOutcome::Received { .. } => {}
        other => panic!("expected a received outcome, got {other:?}"),
    }

    let requests = handle.join().expect("stub thread");
    assert_eq!(requests.len(), 4);
    assert!(requests[0].starts_with("POST /v0/submissions "));
    assert!(
        requests[1]
            .starts_with("PUT /v0/submissions/submission_attempt:synthetic-demo-0001/artifacts/")
    );
    assert!(
        requests[2]
            .starts_with("PUT /v0/submissions/submission_attempt:synthetic-demo-0001/artifacts/")
    );
    assert!(
        requests[3]
            .starts_with("POST /v0/submissions/submission_attempt:synthetic-demo-0001/finalize ")
    );
}

#[test]
fn submit_uploads_only_the_digests_the_server_asked_for() {
    // Phase 1 reports one missing digest even though the bundle declares two,
    // so exactly one PUT must follow: the client resumes rather than
    // re-uploading everything after a dropped connection.
    let (bundle_dir, digests) = synthetic_bundle_dir_with_two_artifacts();
    let (endpoint, handle) = spawn_stub_reporting_missing(vec![digests[1].clone()], 3);

    let outcome =
        onevps_local_runner_scaffold::submit_bundle(&onevps_local_runner_scaffold::SubmitInput {
            endpoint,
            bundle_dir,
            token_key_id: "demo-runner-key-1".to_string(),
            token_secret: "synthetic-demo-submission-secret".to_string(),
        });
    assert!(matches!(
        outcome,
        onevps_local_runner_scaffold::SubmitOutcome::Received { .. }
    ));

    let requests = handle.join().expect("stub thread");
    assert_eq!(requests.len(), 3, "one open, one PUT, one finalize");
    assert!(requests[1].contains(&format!("/artifacts/{}", digests[1])));
}

#[test]
fn submit_reports_transport_failure_without_a_receipt_claim() {
    // Bind and immediately drop the listener so the port is closed: the client
    // must produce a transport failure, not a hang and not a receipt claim.
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("addr").port()
    };
    let (bundle_dir, _digests) = synthetic_bundle_dir_with_two_artifacts();

    let outcome =
        onevps_local_runner_scaffold::submit_bundle(&onevps_local_runner_scaffold::SubmitInput {
            endpoint: format!("http://127.0.0.1:{port}"),
            bundle_dir,
            token_key_id: "demo-runner-key-1".to_string(),
            token_secret: "synthetic-demo-submission-secret".to_string(),
        });

    match outcome {
        onevps_local_runner_scaffold::SubmitOutcome::TransportFailed {
            failure_code,
            retryable,
        } => {
            assert!(retryable, "a refused connection is retryable");
            // Task 8 puts this straight into diagnostics.failure_code, whose
            // schema pattern is ^[a-z][a-z0-9_]{2,63}$.
            let valid = failure_code.len() >= 3
                && failure_code.len() <= 64
                && failure_code.starts_with(|c: char| c.is_ascii_lowercase())
                && failure_code
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            assert!(
                valid,
                "failure_code {failure_code} must match the protocol grammar"
            );
        }
        other => panic!("expected a transport failure, got {other:?}"),
    }
}
