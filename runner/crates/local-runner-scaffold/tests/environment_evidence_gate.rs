use onevps_local_runner_scaffold::{environment_evidence_gate, validate_environment_evidence_gate};

#[test]
fn default_environment_gate_is_synthetic_demo_only() {
    let gate = environment_evidence_gate();
    assert_eq!(gate.environment_profile, "synthetic_demo");
    assert_eq!(gate.evidence_boundary, "synthetic-demo-only");
    assert!(!gate.real_raw_snippet_acceptance);
    assert!(!gate.real_targeted_file_acceptance);
    assert!(gate.demo_budget_gate_ready);
    assert!(!gate.access_control_ready);
    assert!(!gate.signing_release_trust_ready);
    assert!(
        !gate
            .allowed_source_derived_classes
            .contains(&"customer_opt_in_retained_source".to_string())
    );
    validate_environment_evidence_gate(&gate).expect("default demo gate should be valid");
}

#[test]
fn unknown_environment_profile_is_rejected() {
    let mut gate = environment_evidence_gate();
    gate.environment_profile = "unknown_profile".to_string();

    let err = validate_environment_evidence_gate(&gate)
        .expect_err("unknown environment profiles must not bypass readiness checks");
    assert!(err.contains("environment_profile"));
}

#[test]
fn partner_pilot_candidate_cannot_allow_retained_customer_source() {
    let mut gate = environment_evidence_gate();
    gate.environment_profile = "partner_pilot_candidate".to_string();
    gate.evidence_boundary = "partner-pilot-candidate".to_string();
    gate.allowed_source_derived_classes
        .push("customer_opt_in_retained_source".to_string());

    let err = validate_environment_evidence_gate(&gate)
        .expect_err("candidate profile must not opt into retained customer source");
    assert!(err.contains("customer_opt_in_retained_source"));
}

#[test]
fn real_snippet_acceptance_requires_all_readiness_fields() {
    let mut gate = environment_evidence_gate();
    gate.environment_profile = "partner_pilot_real_snippet_ready".to_string();
    gate.evidence_boundary = "partner-pilot-real-snippet-ready".to_string();
    gate.real_raw_snippet_acceptance = true;
    gate.real_targeted_file_acceptance = true;
    gate.allowed_source_derived_classes
        .push("customer_opt_in_retained_source".to_string());

    assert!(validate_environment_evidence_gate(&gate).is_err());

    gate.access_control_ready = true;
    gate.access_logging_ready = true;
    gate.encryption_at_rest_ready = true;
    gate.retention_defaults_ready = true;
    gate.deletion_controls_ready = true;
    gate.signing_release_trust_ready = true;
    gate.retention_period_required = true;

    validate_environment_evidence_gate(&gate)
        .expect("all readiness fields should allow real source-derived evidence");
}
