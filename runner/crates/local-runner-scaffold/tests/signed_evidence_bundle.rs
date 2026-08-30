use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use onevps_local_runner_scaffold::{
    ApprovalDecision, ApprovalState, BundlePrepareInput, BundleStatusInput,
    DisclosureConfigureInput, DisclosurePolicyConfig, DisclosureRedactionConfig, LocalBundleState,
    LocalRunnerOutcome, LocalRunnerStage, ManifestPreviewInput, OutboundManifest, RegexScannerRule,
    ReviewScope, ReviewState, ScanRunInput, ScopeInitInput, SemgrepJsonInput,
    evidence_bundle_identity, format_local_runner_attempt_summary, format_runner_trust_summary,
    format_signed_bundle_summary, initialize_and_write_disclosure_policy,
    initialize_and_write_local_scan, initialize_and_write_manifest_preview,
    initialize_and_write_review_scope, initialize_and_write_signed_evidence_bundle,
    initialize_manifest_preview, initialize_write_bundle_prepare_with_attempt,
    inspect_bundle_status, load_bundle_approval_context, load_reusable_customer_approval,
    outbound_manifest_identity, runner_trust_metadata, validate_reused_approval_matches_context,
    verify_bundle_manifest_artifacts,
};

const VALID_COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn approved_metadata_only_bundle_records_approval_and_signature_chain() {
    let fixture = bundle_fixture("approved_metadata_only");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let prepared = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: None,
        disclosure_policy_path: policy_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        approving_actor: Some("maya@example.com".to_string()),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        reused_approval: None,
        run_nonce: Some("approved-metadata-only".to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    })
    .expect("approved metadata-only bundle should prepare");

    assert_eq!(prepared.approval.decision, "approved");
    assert_eq!(prepared.approval.manifest_id, manifest.manifest_id);
    assert_eq!(
        prepared
            .approval
            .approving_actor
            .as_ref()
            .expect("actor")
            .actor_id,
        "maya@example.com"
    );
    assert_eq!(
        prepared
            .approval
            .displayed_context
            .selected_commit
            .commit_sha,
        VALID_COMMIT
    );
    assert_eq!(
        prepared.approval.displayed_context.repository_identity,
        manifest.selected_scope_summary.repository_identity
    );
    assert!(
        prepared
            .approval
            .displayed_context
            .bundle_preview_summary
            .contains("not_submitted")
    );

    let bundle = prepared.bundle_manifest.as_ref().expect("bundle manifest");
    assert_eq!(bundle.bundle_state, "not_submitted");
    assert_eq!(bundle.manifest_id, manifest.manifest_id);
    assert_eq!(bundle.customer_approval_ref, prepared.approval.approval_id);
    assert_eq!(bundle.coverage_mode, "metadata_only");
    assert!(bundle.evidence_bundle_id.starts_with("sha256:"));
    assert_eq!(evidence_bundle_identity(bundle), bundle.evidence_bundle_id);

    let mut changed_id = bundle.clone();
    changed_id.evidence_bundle_id =
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string();
    assert_eq!(
        evidence_bundle_identity(&changed_id),
        bundle.evidence_bundle_id
    );

    let signature = prepared
        .signature_envelope
        .as_ref()
        .expect("signature envelope");
    assert_eq!(signature.signed_identity_type, "evidence_bundle");
    assert_eq!(signature.signed_identity, bundle.evidence_bundle_id);
    assert_eq!(
        signature.key_id,
        onevps_local_runner_scaffold::RUNNER_SIGNING_KEY_ID
    );
    assert_eq!(signature.algorithm_profile, "ml_dsa_65");
    assert_eq!(signature.signing_mode, "enrolled_runner_key");
    assert!(signature.signature_bytes.starts_with("ml_dsa_65:"));
    assert_eq!(signature.signature_bytes.len(), "ml_dsa_65:".len() + 4412);
    // The runner's own key directory is a single shared default path
    // (spec 5.4: one per-installation key), and this test binary runs many
    // `#[test]` functions concurrently against that same relative path, so
    // re-deriving/reloading the key here for a live crypto re-verify would
    // race the very first key-creation across threads. `tests/keys.rs` and
    // the CLI integration tests (each spawning an isolated subprocess with
    // its own `--current-dir`) already prove the signature verifies against
    // the generated key without that race; this test asserts shape only.
    // Mirrors the JS validateSignatureEnvelopeSemantics required-limitation set
    // (scripts/lib/protocol-utils.mjs) so the Rust and JS validators cannot drift.
    let joined_limitations = signature.signing_limitations.join(" ");
    for required in onevps_local_runner_scaffold::keys::RUNNER_SIGNING_LIMITATIONS {
        assert!(
            joined_limitations.contains(required),
            "signing_limitations must state '{required}': {joined_limitations}"
        );
    }

    assert!(output_dir.join("customer-approval.json").exists());
    assert!(output_dir.join("bundle_manifest.json").exists());
    assert!(output_dir.join("signature-envelope.bundle.json").exists());
    assert!(output_dir.join("artifacts/review-scope.json").exists());
    assert!(output_dir.join("artifacts/disclosure-policy.json").exists());
    assert!(output_dir.join("artifacts/outbound-manifest.json").exists());
    assert!(!output_dir.join("artifacts/source-derived").exists());

    let summary = format_signed_bundle_summary(&prepared, &output_dir);
    let lower = summary.to_ascii_lowercase();
    assert!(summary.contains("Signed local Evidence Bundle prepared"));
    assert!(summary.contains("manifest_id: sha256:"));
    assert!(summary.contains("evidence_bundle_id: sha256:"));
    assert!(summary.contains("bundle_instance_id:"));
    assert!(summary.contains("submission_attempt_id:"));
    assert!(summary.contains("Coverage Mode: Metadata-only (metadata_only)"));
    assert!(
        summary.contains("signed with a real ML-DSA-65 signature under runner-held key custody")
    );
    assert!(!summary.contains("eval('1 + 1')"));
    assert!(!summary.contains("\u{1b}["));
    assert!(!lower.contains("vendor receipt"));
    assert!(!lower.contains("received state"));
    assert!(!lower.contains("no vulnerabilities"));
    assert!(!lower.contains("certified"));
}

#[test]
fn declined_or_mismatched_approval_creates_no_signed_bundle() {
    let fixture = bundle_fixture("declined");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("declined-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let declined = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: None,
        disclosure_policy_path: policy_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        approving_actor: None,
        approval_decision: ApprovalDecision::Decline,
        approval_confirmation: None,
        reused_approval: None,
        run_nonce: Some("declined".to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    })
    .expect("declined approval should be recorded as not submitted");

    assert_eq!(declined.approval.decision, "declined");
    assert!(declined.bundle_manifest.is_none());
    assert!(declined.signature_envelope.is_none());
    assert!(output_dir.join("customer-approval.json").exists());
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
    let declined_state = declined
        .approval
        .not_submitted_state
        .as_ref()
        .expect("declined state");
    assert!(!declined_state.evidence_bundle_created);
    assert!(!declined_state.evidence_sent);
    assert!(
        declined_state
            .next_actions
            .contains(&"revise policy".to_string())
    );

    let mismatch_dir = fixture.join("mismatch-bundle");
    let mismatch = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        output_dir: mismatch_dir.clone(),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
        ),
        decided_at: "2026-07-10T00:00:06Z".to_string(),
        created_at: "2026-07-10T00:00:07Z".to_string(),
        signing_time: "2026-07-10T00:00:08Z".to_string(),
        scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: policy_path,
        manifest_path,
        approving_actor: Some("maya@example.com".to_string()),
        reused_approval: None,
        run_nonce: Some("mismatch".to_string()),
    })
    .expect("confirmation mismatch should become a declined not-submitted decision");

    assert_eq!(mismatch.approval.manifest_id, manifest.manifest_id);
    assert_eq!(mismatch.approval.decision, "declined");
    assert!(mismatch.bundle_manifest.is_none());
    assert!(!mismatch_dir.join("bundle_manifest.json").exists());
}

#[test]
fn source_derived_modes_fail_without_materialized_artifacts_before_writing_bundle() {
    let fixture = bundle_fixture("source_mode_blocked");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );

    let err = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        scope_path,
        scanner_findings_path: Some(scanner_path),
        disclosure_policy_path: policy_path,
        manifest_path,
        output_dir: output_dir.clone(),
        approving_actor: Some("maya@example.com".to_string()),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        reused_approval: None,
        run_nonce: Some("source-mode-blocked".to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    })
    .expect_err(
        "finding-context source-derived mode should fail until materialized artifacts exist",
    );

    assert!(
        err.to_string()
            .contains("source-derived evidence artifacts")
    );
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
}

#[test]
fn post_approval_packaging_failure_preserves_approval_and_writes_attempt() {
    let fixture = bundle_fixture("post_approval_failure_attempt");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");
    let attempt_log = fixture.join("local-runner-attempts.jsonl");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );

    let err = initialize_write_bundle_prepare_with_attempt(
        BundlePrepareInput {
            scope_path,
            scanner_findings_path: Some(scanner_path),
            disclosure_policy_path: policy_path,
            manifest_path,
            output_dir: output_dir.clone(),
            approving_actor: Some("maya@example.com".to_string()),
            approval_decision: ApprovalDecision::Approve,
            approval_confirmation: Some(manifest.manifest_id.clone()),
            reused_approval: None,
            run_nonce: Some("post-approval-failure".to_string()),
            decided_at: "2026-07-10T00:00:03Z".to_string(),
            created_at: "2026-07-10T00:00:04Z".to_string(),
            signing_time: "2026-07-10T00:00:05Z".to_string(),
        },
        &attempt_log,
    )
    .expect_err("source-derived packaging failure should return attempt context");

    let attempt = *err.attempt.expect("attempt should be preserved");
    assert_eq!(attempt.stage, LocalRunnerStage::BundlePackaging);
    assert_eq!(attempt.outcome, LocalRunnerOutcome::Failed);
    assert_eq!(attempt.review_state, ReviewState::ApprovedNoSignedBundle);
    assert_eq!(attempt.approval_state, ApprovalState::Approved);
    assert_eq!(attempt.bundle_state, LocalBundleState::FailedBeforeReady);
    assert_eq!(attempt.remote_state, "not_submitted");
    assert_eq!(
        attempt.identities.manifest_id.as_deref(),
        Some(manifest.manifest_id.as_str())
    );
    assert!(attempt.identities.approval_id.is_some());
    assert!(attempt.identities.evidence_bundle_id.is_none());
    assert_eq!(
        attempt
            .approval_metadata
            .as_ref()
            .and_then(|metadata| metadata.approving_actor.as_ref())
            .map(|actor| actor.actor_id.as_str()),
        Some("maya@example.com")
    );
    assert!(
        attempt
            .diagnostics
            .message
            .contains("No signed Evidence Bundle is ready")
    );
    assert!(output_dir.join("customer-approval.json").exists());
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
    let log = fs::read_to_string(attempt_log).expect("attempt log");
    assert!(log.contains(r#""stage":"bundle_packaging""#));
    assert!(log.contains(r#""approval_state":"approved""#));
    assert!(!log.contains("eval('1 + 1')"));

    let summary = format_local_runner_attempt_summary(&attempt);
    assert!(summary.contains("Stage failed: bundle_packaging"));
    assert!(summary.contains("Review state: approved_no_signed_bundle"));
    assert!(summary.contains("No signed Evidence Bundle is ready."));
    assert!(!summary.to_ascii_lowercase().contains("vendor receipt"));
}

#[test]
fn bundle_status_distinguishes_unapproved_declined_ready_and_stale_states() {
    let fixture = bundle_fixture("bundle_status_states");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let unapproved = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:06Z".to_string(),
        run_nonce: Some("status-unapproved".to_string()),
    })
    .expect("unapproved status");
    assert_eq!(unapproved.review_state, ReviewState::UnapprovedNotSubmitted);
    assert_eq!(unapproved.approval_state, ApprovalState::NotRequested);
    assert_eq!(unapproved.bundle_state, LocalBundleState::NotCreated);

    let declined = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Decline,
        approval_confirmation: None,
        run_nonce: "status-declined",
    }))
    .expect("declined");
    assert_eq!(declined.approval.decision, "declined");
    let declined_status = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:07Z".to_string(),
        run_nonce: Some("status-declined".to_string()),
    })
    .expect("declined status");
    assert_eq!(declined_status.outcome, LocalRunnerOutcome::Declined);
    assert_eq!(declined_status.approval_state, ApprovalState::Declined);

    initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce: "status-approved",
    }))
    .expect("approved bundle");
    let ready_status = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:08Z".to_string(),
        run_nonce: Some("status-ready".to_string()),
    })
    .expect("ready status");
    assert_eq!(
        ready_status.review_state,
        ReviewState::SignedBundleNotSubmitted
    );
    assert_eq!(
        ready_status.bundle_state,
        LocalBundleState::ReadyNotSubmitted
    );
    assert!(ready_status.identities.evidence_bundle_id.is_some());

    let mut tampered_bundle: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(output_dir.join("bundle_manifest.json")).expect("bundle json"),
    )
    .expect("bundle json parses");
    tampered_bundle["artifact_references"][0]["digest"] = serde_json::Value::String(
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
    );
    fs::write(
        output_dir.join("bundle_manifest.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&tampered_bundle).expect("tampered bundle serializes")
        ),
    )
    .expect("write tampered bundle");
    let tampered_status = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:08Z".to_string(),
        run_nonce: Some("status-tampered".to_string()),
    })
    .expect("tampered status");
    assert_eq!(
        tampered_status.bundle_state,
        LocalBundleState::FailedBeforeReady
    );
    assert!(tampered_status.identities.evidence_bundle_id.is_none());

    initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce: "status-approved-again",
    }))
    .expect("approved bundle should rewrite stale output");

    fs::remove_file(output_dir.join("signature-envelope.bundle.json")).expect("remove signature");
    let stale_status = inspect_bundle_status(BundleStatusInput {
        scope_path,
        manifest_path,
        output_dir,
        occurred_at: "2026-07-10T00:00:09Z".to_string(),
        run_nonce: Some("status-stale".to_string()),
    })
    .expect("stale status");
    assert_eq!(
        stale_status.review_state,
        ReviewState::ApprovedNoSignedBundle
    );
    assert_eq!(
        stale_status.bundle_state,
        LocalBundleState::FailedBeforeReady
    );
    assert!(stale_status.identities.evidence_bundle_id.is_none());
    assert!(
        stale_status
            .diagnostics
            .message
            .contains("No signed Evidence Bundle is ready")
    );
}

#[test]
fn bundle_status_rejects_mismatched_signature_envelope() {
    let fixture = bundle_fixture("bundle_status_mismatched_signature");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce: "status-mismatched-signature",
    }))
    .expect("approved bundle");

    let signature_path = output_dir.join("signature-envelope.bundle.json");
    let mut tampered_signature: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&signature_path).expect("signature json"))
            .expect("signature json parses");
    tampered_signature["signed_identity"] = serde_json::Value::String(
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
    );
    fs::write(
        &signature_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&tampered_signature)
                .expect("tampered signature serializes")
        ),
    )
    .expect("write tampered signature");

    let mismatched_status = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:10Z".to_string(),
        run_nonce: Some("status-mismatched".to_string()),
    })
    .expect("mismatched signature status");
    assert_eq!(
        mismatched_status.bundle_state,
        LocalBundleState::FailedBeforeReady
    );
    assert!(mismatched_status.identities.evidence_bundle_id.is_none());

    let mut corrupt_signature = tampered_signature;
    corrupt_signature
        .as_object_mut()
        .expect("signature is object")
        .remove("signed_identity");
    fs::write(
        &signature_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&corrupt_signature).expect("corrupt signature serializes")
        ),
    )
    .expect("write corrupt signature");
    let corrupt_result = inspect_bundle_status(BundleStatusInput {
        scope_path,
        manifest_path,
        output_dir,
        occurred_at: "2026-07-10T00:00:11Z".to_string(),
        run_nonce: Some("status-corrupt".to_string()),
    });
    assert!(
        corrupt_result.is_err(),
        "a structurally invalid signature envelope must not be reported as ready"
    );
}

#[test]
fn bundle_status_rejects_mutated_copied_artifact_bytes() {
    let fixture = bundle_fixture("bundle_status_mutated_artifact");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce: "status-mutated-artifact",
    }))
    .expect("approved bundle");

    let ready_status = inspect_bundle_status(BundleStatusInput {
        scope_path: scope_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        occurred_at: "2026-07-10T00:00:12Z".to_string(),
        run_nonce: Some("status-ready-before-mutation".to_string()),
    })
    .expect("ready status before mutation");
    assert_eq!(
        ready_status.bundle_state,
        LocalBundleState::ReadyNotSubmitted
    );

    fs::write(
        output_dir.join("artifacts/outbound-manifest.json"),
        "{\"tampered\": true}",
    )
    .expect("mutate copied artifact bytes");

    let mutated_status = inspect_bundle_status(BundleStatusInput {
        scope_path,
        manifest_path,
        output_dir,
        occurred_at: "2026-07-10T00:00:13Z".to_string(),
        run_nonce: Some("status-mutated".to_string()),
    })
    .expect("mutated status");
    assert_eq!(
        mutated_status.bundle_state,
        LocalBundleState::FailedBeforeReady
    );
    assert!(mutated_status.identities.evidence_bundle_id.is_none());
}

#[test]
fn bundle_prepare_rejects_review_scope_body_mutated_with_id_preserved() {
    let fixture = bundle_fixture("scope_body_mutated_id_preserved");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    // Mutate content that feeds review_scope_id (selected_application.application_id)
    // while leaving review_scope_id itself untouched, simulating a tampered but
    // syntactically-valid-id artifact.
    let mut scope_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scope_path).expect("scope json"))
            .expect("scope json parses");
    scope_json["selected_application"]["application_id"] =
        serde_json::Value::String("tampered-application-id".to_string());
    fs::write(
        &scope_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&scope_json).expect("tampered scope serializes")
        ),
    )
    .expect("write tampered scope");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: None,
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("preview-manifest.json"),
        generated_at: "2026-07-10T00:00:02Z".to_string(),
    })
    .expect_err("manifest preview must reject a review scope body mutated under a preserved id");
    assert!(err.to_string().contains("review_scope_id"));

    let bundle_err =
        initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
            scope_path: &scope_path,
            scanner_findings_path: None,
            disclosure_policy_path: &policy_path,
            manifest_path: &manifest_path,
            output_dir: &output_dir,
            approval_decision: ApprovalDecision::Approve,
            approval_confirmation: None,
            run_nonce: "scope-body-mutated",
        }))
        .expect_err("bundle prepare must reject a review scope body mutated under a preserved id");
    assert!(bundle_err.to_string().contains("review_scope_id"));
}

// C8-03: bundle prepare (not just manifest preview) must revalidate
// schema-required review-scope metadata at the load boundary.
#[test]
fn bundle_prepare_rejects_review_scope_with_invalid_generated_at() {
    let fixture = bundle_fixture("scope_invalid_generated_at");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let mut scope_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scope_path).expect("scope json"))
            .expect("scope json parses");
    scope_json["generated_at"] = serde_json::Value::String("not-a-date".to_string());
    fs::write(
        &scope_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&scope_json).expect("tampered scope serializes")
        ),
    )
    .expect("write tampered scope");

    let preview_err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: None,
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("preview-manifest.json"),
        generated_at: "2026-07-10T00:00:02Z".to_string(),
    })
    .expect_err("manifest preview must reject an invalid review_scope.generated_at");
    assert!(
        preview_err
            .to_string()
            .contains("review_scope.generated_at")
    );

    let bundle_err =
        initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
            scope_path: &scope_path,
            scanner_findings_path: None,
            disclosure_policy_path: &policy_path,
            manifest_path: &manifest_path,
            output_dir: &output_dir,
            approval_decision: ApprovalDecision::Approve,
            approval_confirmation: None,
            run_nonce: "scope-invalid-generated-at",
        }))
        .expect_err("bundle prepare must reject an invalid review_scope.generated_at");
    assert!(bundle_err.to_string().contains("review_scope.generated_at"));
}

#[test]
fn bundle_prepare_rejects_disclosure_policy_body_mutated_with_id_preserved() {
    let fixture = bundle_fixture("policy_body_mutated_id_preserved");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let mut policy_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&policy_path).expect("policy json"))
            .expect("policy json parses");
    policy_json["limitations"]
        .as_array_mut()
        .expect("limitations array")
        .push(serde_json::Value::String(
            "tampered limitation not present at creation".to_string(),
        ));
    fs::write(
        &policy_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&policy_json).expect("tampered policy serializes")
        ),
    )
    .expect("write tampered policy");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: None,
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("preview-manifest.json"),
        generated_at: "2026-07-10T00:00:02Z".to_string(),
    })
    .expect_err(
        "manifest preview must reject a disclosure policy body mutated under a preserved id",
    );
    assert!(err.to_string().contains("disclosure_policy_id"));

    let bundle_err =
        initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
            scope_path: &scope_path,
            scanner_findings_path: None,
            disclosure_policy_path: &policy_path,
            manifest_path: &manifest_path,
            output_dir: &output_dir,
            approval_decision: ApprovalDecision::Approve,
            approval_confirmation: None,
            run_nonce: "policy-body-mutated",
        }))
        .expect_err(
            "bundle prepare must reject a disclosure policy body mutated under a preserved id",
        );
    assert!(bundle_err.to_string().contains("disclosure_policy_id"));
}

#[test]
fn bundle_prepare_rejects_scanner_finding_set_body_mutated_with_id_preserved() {
    let fixture = bundle_fixture("scanner_body_mutated_id_preserved");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );

    let mut scanner_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&scanner_path).expect("scanner json"))
            .expect("scanner json parses");
    scanner_json["coverage_limitations"]
        .as_array_mut()
        .expect("coverage_limitations array")
        .push(serde_json::Value::String(
            "tampered coverage limitation not present at creation".to_string(),
        ));
    fs::write(
        &scanner_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&scanner_json).expect("tampered scanner serializes")
        ),
    )
    .expect("write tampered scanner findings");

    let err = initialize_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: Some(scanner_path.clone()),
        disclosure_policy_path: policy_path.clone(),
        output_path: fixture.join("preview-manifest.json"),
        generated_at: "2026-07-10T00:00:02Z".to_string(),
    })
    .expect_err(
        "manifest preview must reject a scanner finding set body mutated under a preserved id",
    );
    assert!(err.to_string().contains("scanner_finding_set_id"));

    let bundle_err =
        initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
            scope_path: &scope_path,
            scanner_findings_path: Some(&scanner_path),
            disclosure_policy_path: &policy_path,
            manifest_path: &manifest_path,
            output_dir: &output_dir,
            approval_decision: ApprovalDecision::Approve,
            approval_confirmation: None,
            run_nonce: "scanner-body-mutated",
        }))
        .expect_err(
            "bundle prepare must reject a scanner finding set body mutated under a preserved id",
        );
    assert!(bundle_err.to_string().contains("scanner_finding_set_id"));
}

#[test]
fn bundle_prepare_rejects_retained_scanner_raw_output_under_synthetic_demo() {
    let fixture = bundle_fixture("bundle_retained_scanner_raw_output_gate");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let retained_scanner_path = fixture.join("scanner-findings-retained.json");
    let semgrep_output_path = fixture.join("semgrep-output.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    // Valid template chain: scope + non-retaining scanner + policy + manifest,
    // all self-consistent and cross-referenced.
    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );
    let scope: ReviewScope =
        serde_json::from_str(&fs::read_to_string(&scope_path).expect("scope json"))
            .expect("scope json parses");

    fs::write(&semgrep_output_path, semgrep_json_fixture()).expect("semgrep fixture output");

    // A second, independently-generated scanner finding set that retained raw
    // Semgrep output locally (self-consistent id, real retained artifact ref).
    let retained_scanner = initialize_and_write_local_scan(ScanRunInput {
        application_path: app.clone(),
        review_scope_ref: scope.review_scope_id.clone(),
        output_path: retained_scanner_path.clone(),
        generated_at: "2026-07-10T00:00:01Z".to_string(),
        regex_rules: Vec::new(),
        semgrep_json_inputs: vec![SemgrepJsonInput {
            scanner_name: "semgrep".to_string(),
            json_path: semgrep_output_path,
            ruleset_identifier: "local:semgrep-retained".to_string(),
            scanner_version: Some("1.168.0".to_string()),
            target_file_group: "typescript_javascript".to_string(),
            target_include_patterns: vec!["src/*.ts".to_string()],
            retain_raw_output_locally: true,
        }],
        semgrep_local_commands: Vec::new(),
    })
    .expect("retained scan should write");
    assert_eq!(
        retained_scanner.artifact_references[0].source_derived_class,
        "customer_opt_in_retained_source"
    );

    // Re-point the policy at the retained scanner finding set (disclosure_policy_id
    // is recomputed correctly by the real function; disclosure_configure has no
    // scanner-content gate of its own, matching real CLI ordering where policy is
    // configured before the eventual bundle-prepare scanner file is finalized).
    let policy = initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref: scope.review_scope_id.clone(),
        scanner_finding_set_ref: Some(retained_scanner.scanner_finding_set_id.clone()),
        output_path: policy_path.clone(),
        created_at: "2026-07-10T00:00:02Z".to_string(),
        config: finding_context_config(),
    })
    .expect("policy should write");

    // Carry the new disclosure_policy_id into the manifest and recompute
    // manifest_id; nothing else about the manifest needs to change (bundle
    // prepare never cross-checks manifest.scanner_finding_set_ref against the
    // policy or scanner, only disclosure_policy_ref, review_scope_ref, and
    // selected_scope_summary).
    let mut manifest: OutboundManifest =
        serde_json::from_str(&fs::read_to_string(&manifest_path).expect("manifest json"))
            .expect("manifest json parses");
    manifest.disclosure_policy_ref = policy.policy.disclosure_policy_id.clone();
    manifest.disclosure_policy_summary.disclosure_policy_ref =
        policy.policy.disclosure_policy_id.clone();
    manifest.manifest_id = outbound_manifest_identity(&manifest);
    fs::write(
        &manifest_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).expect("manifest serializes")
        ),
    )
    .expect("write re-pointed manifest");

    let err = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        scope_path,
        scanner_findings_path: Some(retained_scanner_path),
        disclosure_policy_path: policy_path,
        manifest_path,
        output_dir: output_dir.clone(),
        approving_actor: Some("maya@example.com".to_string()),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        reused_approval: None,
        run_nonce: Some("retained-scanner-raw-output".to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    })
    .expect_err("retained scanner raw output must be rejected under the synthetic_demo gate");
    assert!(
        err.to_string()
            .contains("scanner_finding_set.artifact_references")
    );
    assert!(err.to_string().contains("customer_opt_in_retained_source"));
    assert!(!output_dir.join("bundle_manifest.json").exists());
}

#[test]
fn runner_trust_defaults_are_unsigned_demo_and_monochrome() {
    let trust = runner_trust_metadata();
    assert_eq!(trust.runner_name, "codeattest-local-runner");
    assert_eq!(trust.release_signature_status, "unsigned_local_build");
    assert_eq!(trust.bundle_signing_mode, "enrolled_runner_key");
    assert_eq!(trust.trust_label, "demo_only_unsigned");
    assert_eq!(trust.evidence_boundary, "synthetic-demo-only");
    let summary = format_runner_trust_summary(&trust);
    assert!(summary.contains("Runner trust status"));
    assert!(summary.contains("unsigned_local_build"));
    assert!(summary.contains("demo_only_unsigned"));
    assert!(!summary.contains("\u{1b}["));
}

#[test]
fn explicit_reuse_requires_matching_approved_context() {
    let fixture = bundle_fixture("reuse_approval_context");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );
    let approved = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        run_nonce: "reuse-approved",
    }))
    .expect("approved bundle");

    let current_context = load_bundle_approval_context(&bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Decline,
        approval_confirmation: None,
        run_nonce: "reuse-context",
    }))
    .expect("current approval context");
    validate_reused_approval_matches_context(&approved.approval, &current_context.approval)
        .expect("matching approval can be reused explicitly");

    let loaded = load_reusable_customer_approval(
        &output_dir.join("customer-approval.json"),
        &bundle_input(BundleInputFixture {
            scope_path: &scope_path,
            scanner_findings_path: None,
            disclosure_policy_path: &policy_path,
            manifest_path: &manifest_path,
            output_dir: &output_dir,
            approval_decision: ApprovalDecision::Decline,
            approval_confirmation: None,
            run_nonce: "reuse-load",
        }),
    )
    .expect("load reusable approval");
    assert_eq!(loaded.approval_id, approved.approval.approval_id);

    let mut drifted = approved.approval.clone();
    drifted.displayed_context.selected_commit.commit_sha =
        "ffffffffffffffffffffffffffffffffffffffff".to_string();
    let err = validate_reused_approval_matches_context(&drifted, &current_context.approval)
        .expect_err("drifted selected commit must require fresh approval");
    assert!(err.to_string().contains("choose fresh approval"));
}

#[test]
fn bundle_prepare_rejects_modified_manifest_identity_and_cross_references() {
    let fixture = bundle_fixture("manifest_mismatch");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );
    let mut manifest_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&manifest_path).expect("manifest json"))
            .expect("manifest parses");
    manifest_json["selected_scope_summary"]["selected_commit"]["commit_sha"] =
        serde_json::Value::String("ffffffffffffffffffffffffffffffffffffffff".to_string());
    fs::write(
        &manifest_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest_json).unwrap()
        ),
    )
    .expect("write modified manifest");

    let err = initialize_and_write_signed_evidence_bundle(BundlePrepareInput {
        scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: policy_path,
        manifest_path,
        output_dir,
        approving_actor: Some("maya@example.com".to_string()),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        reused_approval: None,
        run_nonce: Some("manifest-mismatch".to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    })
    .expect_err("modified manifest identity should fail before bundle write");

    assert!(err.to_string().contains("manifest_id"));
}

#[test]
fn same_second_approved_reruns_create_distinct_bundle_identities() {
    let fixture = bundle_fixture("same_second_reruns");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    let first = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &fixture.join("bundle-a"),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce: "same-timestamp-a",
    }))
    .expect("first approved run");
    let second = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &fixture.join("bundle-b"),
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        run_nonce: "same-timestamp-b",
    }))
    .expect("second approved run");

    let first_bundle = first.bundle_manifest.as_ref().expect("first bundle");
    let second_bundle = second.bundle_manifest.as_ref().expect("second bundle");
    assert_ne!(first.approval.approval_id, second.approval.approval_id);
    assert_ne!(
        first_bundle.bundle_instance_id,
        second_bundle.bundle_instance_id
    );
    assert_ne!(
        first_bundle.submission_attempt_id,
        second_bundle.submission_attempt_id
    );
    assert_ne!(
        first_bundle.evidence_bundle_id,
        second_bundle.evidence_bundle_id
    );
}

#[test]
fn declined_approval_removes_stale_signed_bundle_artifacts_from_reused_output_dir() {
    let fixture = bundle_fixture("decline_reused_dir");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );

    initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        run_nonce: "stale-approved",
    }))
    .expect("approved bundle should write");
    assert!(output_dir.join("bundle_manifest.json").exists());
    assert!(output_dir.join("signature-envelope.bundle.json").exists());
    assert!(output_dir.join("artifacts").exists());

    let declined = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Decline,
        approval_confirmation: None,
        run_nonce: "declined-reuse",
    }))
    .expect("declined bundle should record local not-submitted state");

    assert_eq!(declined.approval.decision, "declined");
    assert!(output_dir.join("customer-approval.json").exists());
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
    assert!(!output_dir.join("artifacts").exists());
}

#[test]
fn approved_materialized_source_artifacts_are_copied_referenced_and_cleanup_tracked() {
    let fixture = bundle_fixture("materialized_source");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");
    let source_dir = fixture.join("source-artifacts");
    let source_path = source_dir.join("snippet.txt");
    fs::create_dir_all(&source_dir).expect("source artifact dir");
    fs::write(
        &source_path,
        "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE redacted snippet\n",
    )
    .expect("source artifact");

    let _manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );
    let manifest_id =
        add_source_artifact_reference_to_manifest(&manifest_path, "source-artifacts/snippet.txt");

    let prepared = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: Some(&scanner_path),
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest_id),
        run_nonce: "materialized-source",
    }))
    .expect("materialized source-derived artifact should be bundled");

    let bundle = prepared.bundle_manifest.as_ref().expect("bundle manifest");
    let source_ref = bundle
        .artifact_references
        .iter()
        .find(|artifact| artifact.artifact_type == "raw_snippet")
        .expect("raw snippet reference");
    assert_eq!(source_ref.source_derived_class, "transient_source_derived");
    assert_eq!(
        source_ref.content_path.as_deref(),
        Some("artifacts/source-derived/snippet.txt")
    );
    assert!(
        bundle
            .local_cleanup_intent
            .iter()
            .any(|intent| intent.artifact_ref == source_ref.artifact_ref
                && intent.cleanup_required
                && intent.deletion_evidence_state == "pending")
    );
    let copied = output_dir.join("artifacts/source-derived/snippet.txt");
    assert_eq!(
        fs::read_to_string(copied).expect("copied source artifact"),
        "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE redacted snippet\n"
    );
}

#[test]
fn bundle_prepare_rejects_source_artifact_drift_after_manifest_preview() {
    let fixture = bundle_fixture("source_artifact_drift");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let scanner_path = fixture.join("scanner-findings.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");
    let source_dir = fixture.join("source-artifacts");
    let source_path = source_dir.join("snippet.txt");
    fs::create_dir_all(&source_dir).expect("source artifact dir");
    fs::write(
        &source_path,
        "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE redacted snippet\n",
    )
    .expect("source artifact");

    write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        Some(&scanner_path),
        &policy_path,
        &manifest_path,
        finding_context_config(),
    );
    let manifest_id =
        add_source_artifact_reference_to_manifest(&manifest_path, "source-artifacts/snippet.txt");
    fs::write(
        &source_path,
        "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE changed snippet bytes\n",
    )
    .expect("mutate source artifact after manifest preview");

    let err = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: Some(&scanner_path),
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest_id),
        run_nonce: "source-drift",
    }))
    .expect_err("source artifact drift must fail before signing stale metadata");

    assert!(err.to_string().contains("digest/size"));
    assert!(!output_dir.join("bundle_manifest.json").exists());
    assert!(!output_dir.join("signature-envelope.bundle.json").exists());
}

#[test]
fn copied_bundle_artifact_verification_rejects_mutated_copy() {
    let fixture = bundle_fixture("copied_artifact_drift");
    let app = write_synthetic_app(&fixture);
    let scope_path = fixture.join("review-scope.json");
    let policy_path = fixture.join("disclosure-policy.json");
    let manifest_path = fixture.join("outbound-manifest.json");
    let output_dir = fixture.join("evidence-bundle");

    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );
    let prepared = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id),
        run_nonce: "copied-artifact-drift",
    }))
    .expect("approved bundle should prepare before copy mutation");
    let bundle = prepared.bundle_manifest.as_ref().expect("bundle manifest");

    fs::write(
        output_dir.join("artifacts/disclosure-policy.json"),
        "{\"changed\":true}\n",
    )
    .expect("mutate copied bundle artifact");
    let err = verify_bundle_manifest_artifacts(bundle, &output_dir)
        .expect_err("post-copy mutation must be detected by reusable verification helper");
    assert!(err.to_string().contains("digest/size"));
}

#[test]
fn identical_logical_inputs_across_temp_roots_have_portable_identities() {
    let first = bundle_fixture("portable_identity_a");
    let second = bundle_fixture("portable_identity_b");
    let first_ids = prepare_metadata_only_identity_pair(&first, "portable-identity");
    let second_ids = prepare_metadata_only_identity_pair(&second, "portable-identity");

    assert_eq!(first_ids.0, second_ids.0);
    assert_eq!(first_ids.1, second_ids.1);
}

fn prepare_metadata_only_identity_pair(root: &Path, run_nonce: &str) -> (String, String) {
    let app = write_synthetic_app(root);
    let scope_path = root.join("review-scope.json");
    let policy_path = root.join("disclosure-policy.json");
    let manifest_path = root.join("outbound-manifest.json");
    let output_dir = root.join("evidence-bundle");
    let manifest = write_scope_scan_policy_and_manifest(
        &app,
        &scope_path,
        None,
        &policy_path,
        &manifest_path,
        metadata_only_config(),
    );
    let prepared = initialize_and_write_signed_evidence_bundle(bundle_input(BundleInputFixture {
        scope_path: &scope_path,
        scanner_findings_path: None,
        disclosure_policy_path: &policy_path,
        manifest_path: &manifest_path,
        output_dir: &output_dir,
        approval_decision: ApprovalDecision::Approve,
        approval_confirmation: Some(manifest.manifest_id.clone()),
        run_nonce,
    }))
    .expect("metadata-only bundle should prepare");
    (
        manifest.manifest_id,
        prepared
            .bundle_manifest
            .as_ref()
            .expect("bundle manifest")
            .evidence_bundle_id
            .clone(),
    )
}

fn write_scope_scan_policy_and_manifest(
    app: &Path,
    scope_path: &Path,
    scanner_path: Option<&Path>,
    policy_path: &Path,
    manifest_path: &Path,
    config: DisclosurePolicyConfig,
) -> onevps_local_runner_scaffold::OutboundManifest {
    let scope = initialize_and_write_review_scope(ScopeInitInput {
        review_id: "review:synthetic-demo-001".to_string(),
        application_path: app.to_path_buf(),
        selected_commit: VALID_COMMIT.to_string(),
        output_path: scope_path.to_path_buf(),
        generated_at: "2026-07-10T00:00:00Z".to_string(),
    })
    .expect("scope should write");

    let scanner = scanner_path.map(|path| {
        initialize_and_write_local_scan(ScanRunInput {
            application_path: app.to_path_buf(),
            review_scope_ref: scope.review_scope_id.clone(),
            output_path: path.to_path_buf(),
            generated_at: "2026-07-10T00:00:01Z".to_string(),
            regex_rules: vec![RegexScannerRule {
                scanner_name: "regex".to_string(),
                rule_id: "demo.regex.eval".to_string(),
                pattern: r"eval\(".to_string(),
                ruleset_identifier: "local:demo-regex".to_string(),
                severity: Some("warning".to_string()),
                confidence: Some("medium".to_string()),
                target_file_group: "typescript_javascript".to_string(),
                target_include_patterns: vec!["src/*.ts".to_string()],
                retain_raw_output_locally: false,
            }],
            semgrep_json_inputs: Vec::new(),
            semgrep_local_commands: Vec::new(),
        })
        .expect("scan should write")
    });

    initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref: scope.review_scope_id,
        scanner_finding_set_ref: scanner
            .as_ref()
            .map(|set| set.scanner_finding_set_id.clone()),
        output_path: policy_path.to_path_buf(),
        created_at: "2026-07-10T00:00:02Z".to_string(),
        config,
    })
    .expect("policy should write");

    initialize_and_write_manifest_preview(ManifestPreviewInput {
        scope_path: scope_path.to_path_buf(),
        scanner_findings_path: scanner_path.map(Path::to_path_buf),
        disclosure_policy_path: policy_path.to_path_buf(),
        output_path: manifest_path.to_path_buf(),
        generated_at: "2026-07-10T00:00:03Z".to_string(),
    })
    .expect("manifest should write")
}

struct BundleInputFixture<'a> {
    scope_path: &'a Path,
    scanner_findings_path: Option<&'a Path>,
    disclosure_policy_path: &'a Path,
    manifest_path: &'a Path,
    output_dir: &'a Path,
    approval_decision: ApprovalDecision,
    approval_confirmation: Option<String>,
    run_nonce: &'a str,
}

fn bundle_input(fixture: BundleInputFixture<'_>) -> BundlePrepareInput {
    BundlePrepareInput {
        scope_path: fixture.scope_path.to_path_buf(),
        scanner_findings_path: fixture.scanner_findings_path.map(Path::to_path_buf),
        disclosure_policy_path: fixture.disclosure_policy_path.to_path_buf(),
        manifest_path: fixture.manifest_path.to_path_buf(),
        output_dir: fixture.output_dir.to_path_buf(),
        approving_actor: Some("maya@example.com".to_string()),
        approval_decision: fixture.approval_decision,
        approval_confirmation: fixture.approval_confirmation,
        reused_approval: None,
        run_nonce: Some(fixture.run_nonce.to_string()),
        decided_at: "2026-07-10T00:00:03Z".to_string(),
        created_at: "2026-07-10T00:00:04Z".to_string(),
        signing_time: "2026-07-10T00:00:05Z".to_string(),
    }
}

fn add_source_artifact_reference_to_manifest(manifest_path: &Path, content_path: &str) -> String {
    let mut manifest: onevps_local_runner_scaffold::OutboundManifest =
        serde_json::from_str(&fs::read_to_string(manifest_path).expect("manifest json"))
            .expect("manifest parses");
    let mut manifest_json = serde_json::to_value(&manifest).expect("manifest value");
    manifest_json["artifact_references"]
        .as_array_mut()
        .expect("artifact references")
        .push(serde_json::json!({
            "protocol_version": "codeattest.v0",
            "artifact_ref": "artifact_ref:materialized_raw_snippet",
            "artifact_type": "raw_snippet",
            "digest": "sha256:9e8534d44dc128cdc0059b5b0bb0341af9764db7a29d6dee087289adc3efbaae",
            "size_bytes": 57,
            "source_derived_class": "transient_source_derived",
            "manifest_entry_ref": "manifest_entry:raw_snippets",
            "media_type": "text/plain",
            "content_path": content_path,
            "content_path_anchor": "fixture_root",
            "synthetic_markers": ["SYNTHETIC_DEMO_DATA", "NOT_CUSTOMER_SOURCE"]
        }));
    manifest = serde_json::from_value(manifest_json).expect("manifest with source artifact");
    manifest.manifest_id = outbound_manifest_identity(&manifest);
    let manifest_id = manifest.manifest_id.clone();
    fs::write(
        manifest_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).expect("manifest serializes")
        ),
    )
    .expect("write manifest with source artifact");
    manifest_id
}

fn metadata_only_config() -> DisclosurePolicyConfig {
    DisclosurePolicyConfig {
        coverage_mode: Some("metadata_only".to_string()),
        include_metadata: None,
        include_dependency_information: None,
        include_scanner_findings: Some(false),
        include_raw_snippets: None,
        include_targeted_files: None,
        max_snippet_chars: None,
        context_lines: None,
        selected_files_or_areas: Vec::new(),
        redaction: Some(redaction_config()),
        retention: None,
    }
}

fn finding_context_config() -> DisclosurePolicyConfig {
    DisclosurePolicyConfig {
        coverage_mode: Some("finding_context_snippets".to_string()),
        include_metadata: None,
        include_dependency_information: None,
        include_scanner_findings: None,
        include_raw_snippets: None,
        include_targeted_files: None,
        max_snippet_chars: None,
        context_lines: None,
        selected_files_or_areas: Vec::new(),
        redaction: Some(redaction_config()),
        retention: None,
    }
}

fn redaction_config() -> DisclosureRedactionConfig {
    DisclosureRedactionConfig {
        enabled: true,
        profile: Some("local-demo-redaction".to_string()),
        configuration_version: Some("local-demo-redaction-v1".to_string()),
    }
}

fn semgrep_json_fixture() -> &'static str {
    r#"{
      "results": [
        {
          "check_id": "demo.semgrep.insecure-random",
          "path": "src/app.ts",
          "start": { "line": 2, "col": 18 },
          "end": { "line": 2, "col": 31 },
          "extra": {
            "message": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE demo finding around Math.random()",
            "severity": "WARNING",
            "metadata": { "confidence": "MEDIUM" },
            "fingerprint": "synthetic-fingerprint-001"
          }
        }
      ]
    }"#
}

fn write_synthetic_app(root: &Path) -> PathBuf {
    let app = root.join("app");
    fs::create_dir_all(app.join("src")).expect("app src dir");
    fs::write(
        app.join("package.json"),
        r#"{ "_synthetic_marker": "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE", "dependencies": { "react": "19.2.7" }, "devDependencies": { "typescript": "6.0.3" } }"#,
    )
    .expect("package json");
    fs::write(
        app.join("src/app.ts"),
        "// SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE\nexport const result = eval('1 + 1');\n",
    )
    .expect("synthetic ts source");
    app
}

fn bundle_fixture(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("onevps-story-1-8-{name}-{nanos}"))
}
