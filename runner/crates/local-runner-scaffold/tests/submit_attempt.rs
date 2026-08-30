use onevps_local_runner_scaffold::{RunnerMetadata, SubmitAttemptContext, SubmitOutcome};

fn context() -> SubmitAttemptContext {
    SubmitAttemptContext {
        runner: RunnerMetadata {
            name: "codeattest-local-runner".to_string(),
            version: "0.0.0".to_string(),
        },
        runner_trust: onevps_local_runner_scaffold::runner_trust_metadata(),
        selected_commit: "a".repeat(40),
        repository_identity: format!("sha256:{}", "b".repeat(64)),
        manifest_id: format!("sha256:{}", "c".repeat(64)),
        approval_id: "approval:submit-attempt-test".to_string(),
        approval_decided_at: "2026-08-16T11:00:00Z".to_string(),
        evidence_bundle_id: format!("sha256:{}", "d".repeat(64)),
        bundle_instance_id: "bundle_instance:submit-attempt-test".to_string(),
        submission_attempt_id: "submission_attempt:submit-attempt-test".to_string(),
        occurred_at: "2026-08-16T12:00:00Z".to_string(),
    }
}

fn received_outcome() -> SubmitOutcome {
    SubmitOutcome::Received {
        submission_outcome: serde_json::json!({
            "outcome_state": "received_with_receipt",
            "vendor_receipt_ref": format!("sha256:{}", "e".repeat(64)),
            "submission_outcome_id": "submission_outcome:submit-attempt-test"
        }),
    }
}

#[test]
fn a_received_submit_attempt_records_the_remote_state_and_receipt_identity() {
    let attempt = onevps_local_runner_scaffold::submit_attempt(&received_outcome(), &context());
    assert_eq!(attempt.stage.as_str(), "submit");
    assert_eq!(attempt.remote_state, "received_with_receipt");
    assert_eq!(
        attempt.identities.vendor_receipt_id.as_deref(),
        Some(format!("sha256:{}", "e".repeat(64)).as_str())
    );
    assert_eq!(
        attempt.identities.submission_outcome_id.as_deref(),
        Some("submission_outcome:submit-attempt-test")
    );
    assert!(!attempt.diagnostics.raw_snippets_printed);
    assert!(attempt.diagnostics.sensitive_detail_omitted);
}

#[test]
fn a_transport_failure_records_an_attempt_with_no_remote_claim() {
    let attempt = onevps_local_runner_scaffold::submit_attempt(
        &SubmitOutcome::TransportFailed {
            failure_code: "submit_connection_refused".to_string(),
            retryable: true,
        },
        &context(),
    );
    assert_eq!(attempt.remote_state, "submit_attempted");
    assert_eq!(attempt.outcome.as_str(), "failed");
    assert!(attempt.identities.vendor_receipt_id.is_none());
    assert!(attempt.diagnostics.retryable);
    assert_eq!(
        attempt.diagnostics.failure_code.as_deref(),
        Some("submit_connection_refused")
    );
}

#[test]
fn a_rejected_submit_records_failed_outcome_with_no_receipt() {
    let outcome = SubmitOutcome::Refused {
        submission_outcome: serde_json::json!({
            "outcome_state": "rejected_no_receipt",
            "submission_outcome_id": "submission_outcome:submit-attempt-test"
        }),
    };
    let attempt = onevps_local_runner_scaffold::submit_attempt(&outcome, &context());
    assert_eq!(attempt.remote_state, "rejected_no_receipt");
    assert_eq!(attempt.outcome.as_str(), "failed");
    assert!(attempt.identities.vendor_receipt_id.is_none());
    assert_eq!(
        attempt.identities.submission_outcome_id.as_deref(),
        Some("submission_outcome:submit-attempt-test")
    );
}

#[test]
fn a_quarantined_submit_records_blocked_outcome_with_no_receipt() {
    let outcome = SubmitOutcome::Refused {
        submission_outcome: serde_json::json!({
            "outcome_state": "quarantined_no_receipt",
            "submission_outcome_id": "submission_outcome:submit-attempt-test"
        }),
    };
    let attempt = onevps_local_runner_scaffold::submit_attempt(&outcome, &context());
    assert_eq!(attempt.remote_state, "quarantined_no_receipt");
    assert_eq!(attempt.outcome.as_str(), "blocked");
    assert!(attempt.identities.vendor_receipt_id.is_none());
}

#[test]
fn assurance_language_is_still_forbidden_in_a_submit_attempt() {
    let mut attempt = onevps_local_runner_scaffold::submit_attempt(&received_outcome(), &context());
    attempt.diagnostics.message =
        "Your code is certified secure with no vulnerabilities.".to_string();
    assert!(
        onevps_local_runner_scaffold::validate_local_runner_attempt_for_test(&attempt).is_err(),
        "the claim-safety relaxation must be narrow: only the protocol's own remote states are newly allowed"
    );
}

#[test]
fn every_pre_existing_stage_still_rejects_remote_language() {
    // Regression guard for the relaxation in Step 3. The strip-before-scan must
    // apply only to stage == Submit; a local stage that says "received" is the
    // exact claim Epic 1 forbade and it must stay forbidden.
    let mut attempt = onevps_local_runner_scaffold::submit_attempt(&received_outcome(), &context());
    attempt.stage = onevps_local_runner_scaffold::LocalRunnerStage::BundlePrepare;
    attempt.remote_state = "not_submitted".to_string();
    attempt.diagnostics.message = "The bundle was received by the vendor.".to_string();
    assert!(
        onevps_local_runner_scaffold::validate_local_runner_attempt_for_test(&attempt).is_err(),
        "a non-submit stage must still reject remote receipt language"
    );

    // And the relaxation is token-exact: a submit attempt may say
    // received_with_receipt, but not "received" as free prose.
    let mut prose = onevps_local_runner_scaffold::submit_attempt(&received_outcome(), &context());
    prose.diagnostics.support_summary = "Your evidence was received and reviewed.".to_string();
    assert!(
        onevps_local_runner_scaffold::validate_local_runner_attempt_for_test(&prose).is_err(),
        "stripping the protocol tokens must not license free-form remote claims"
    );
}
