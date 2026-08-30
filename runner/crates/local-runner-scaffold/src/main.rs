use std::env;
use std::fs;
use std::io::{self, IsTerminal, Read};
use std::path::PathBuf;
use std::process;

use onevps_local_runner_scaffold::{
    ApprovalDecision, ApprovalState, BundlePrepareInput, BundleStatusInput,
    DisclosureConfigureInput, LocalAttemptDiagnostics, LocalAttemptIdentities, LocalBundleState,
    LocalRunnerAttempt, LocalRunnerOutcome, LocalRunnerStage, ManifestPreviewInput,
    RUNNER_SIGNING_KEY_ID, ReviewState, RunnerMetadata, ScanRunInput, ScopeInitInput,
    default_disclosure_policy_output_path, default_local_runner_attempt_log_path,
    default_outbound_manifest_output_path, default_review_scope_output_path,
    default_scanner_findings_output_path, default_signed_evidence_bundle_output_dir,
    disclosure_config_includes_scanner_findings, disclosure_review_scope_ref_from_file,
    failure_code_for_bundle_prepare_error, format_bundle_approval_context,
    format_disclosure_policy_summary, format_local_runner_attempt_summary,
    format_manifest_preview_summary, format_runner_trust_summary, format_scan_summary,
    format_scope_summary, format_signed_bundle_summary, initialize_and_write_disclosure_policy,
    initialize_and_write_local_scan, initialize_and_write_manifest_preview,
    initialize_and_write_review_scope, initialize_write_bundle_prepare_with_attempt,
    inspect_bundle_status, keys, load_bundle_approval_context, load_disclosure_policy_config,
    load_reusable_customer_approval, load_scan_config, local_attempt_id,
    pre_approval_failure_attempt, review_scope_ref_for_application, runner_trust_metadata,
    scanner_finding_set_ref_for_review_scope, stage_for_bundle_prepare_error, utc_rfc3339_now,
    write_local_runner_attempt,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{}", usage());
        return Ok(());
    }

    match args.as_slice() {
        [command, subcommand, rest @ ..] if command == "scope" && subcommand == "init" => {
            run_scope_init(rest)
        }
        [command, subcommand, rest @ ..] if command == "scan" && subcommand == "run" => {
            run_scan_run(rest)
        }
        [command, subcommand, rest @ ..]
            if command == "disclosure" && subcommand == "configure" =>
        {
            run_disclosure_configure(rest)
        }
        [command, subcommand, rest @ ..] if command == "manifest" && subcommand == "preview" => {
            run_manifest_preview(rest)
        }
        [command, subcommand, rest @ ..] if command == "bundle" && subcommand == "prepare" => {
            run_bundle_prepare(rest)
        }
        [command, subcommand, rest @ ..] if command == "bundle" && subcommand == "status" => {
            run_bundle_status(rest)
        }
        [command, subcommand, rest @ ..] if command == "runner" && subcommand == "trust" => {
            run_runner_trust(rest)
        }
        [command, subcommand, rest @ ..] if command == "keys" && subcommand == "init" => {
            run_keys_init(rest)
        }
        [command, subcommand, rest @ ..] if command == "keys" && subcommand == "enrollment" => {
            run_keys_enrollment(rest)
        }
        [command, subcommand, rest @ ..] if command == "submit" && subcommand == "send" => {
            run_submit_send(rest)
        }
        _ => Err(usage()),
    }
}

/// Wrap a command-level failure so the terminal names the failed stage and a
/// stage-aware attempt record lands in the local attempt log. Satisfies AC1
/// for the `scope init`, `scan run`, `disclosure configure`, and
/// `manifest preview` command paths in addition to `bundle prepare`.
///
/// The attempt-log write is best-effort: if the log itself cannot be written
/// (bad path, permissions, disk full) the caller still gets the original
/// error plus a "(also: attempt log write failed: …)" suffix — the primary
/// error is never masked.
fn emit_command_failure(stage: LocalRunnerStage, failure_code: &str, error: String) -> String {
    let occurred_at = match utc_rfc3339_now() {
        Ok(now) => now,
        // If we can't even get a timestamp, fall back to the plain error.
        Err(_) => return error,
    };
    let nonce = run_nonce();
    let attempt =
        pre_approval_failure_attempt(stage, &occurred_at, Some(&nonce), failure_code, &error);
    let attempt_log_path = default_local_runner_attempt_log_path();
    let log_note = match write_local_runner_attempt(&attempt_log_path, &attempt) {
        Ok(()) => String::new(),
        Err(log_error) => format!("(also: attempt log write failed: {log_error})\n"),
    };
    format!(
        "{}{}{}",
        format_local_runner_attempt_summary(&attempt),
        log_note,
        error
    )
}

fn run_scope_init(args: &[String]) -> Result<(), String> {
    run_scope_init_inner(args).map_err(|error| {
        emit_command_failure(LocalRunnerStage::ScopeInit, "scope_init_failed", error)
    })
}

fn run_scope_init_inner(args: &[String]) -> Result<(), String> {
    let mut application_path = None;
    let mut review_id = None;
    let mut selected_commit = None;
    let mut output_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        // Accept both `--flag value` and `--flag=value` (GNU long-option style).
        // Split on the first `=` when the arg begins with a recognised long
        // option followed immediately by `=`.
        let (flag, inline_value) = split_long_option(
            arg,
            &["--application-path", "--review-id", "--commit", "--output"],
        );

        match flag {
            "--application-path" | "--review-id" | "--commit" | "--output" => {
                let slot: &mut Option<String> = match flag {
                    "--application-path" => &mut application_path,
                    "--review-id" => &mut review_id,
                    "--commit" => &mut selected_commit,
                    _ => &mut output_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let application_path = application_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --application-path\n{}", usage()))?;
    let review_id =
        review_id.ok_or_else(|| format!("missing required argument: --review-id\n{}", usage()))?;
    let selected_commit = selected_commit
        .ok_or_else(|| format!("missing required argument: --commit\n{}", usage()))?;
    let output_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(default_review_scope_output_path);
    let generated_at = utc_rfc3339_now().map_err(|error| error.to_string())?;

    let scope = initialize_and_write_review_scope(ScopeInitInput {
        application_path,
        review_id,
        selected_commit,
        output_path: output_path.clone(),
        generated_at,
    })
    .map_err(|error| error.to_string())?;

    print!("{}", format_scope_summary(&scope, &output_path));
    Ok(())
}

fn run_scan_run(args: &[String]) -> Result<(), String> {
    run_scan_run_inner(args)
        .map_err(|error| emit_command_failure(LocalRunnerStage::ScanRun, "scan_run_failed", error))
}

fn run_scan_run_inner(args: &[String]) -> Result<(), String> {
    let mut application_path = None;
    let mut scope_path = None;
    let mut scanner_config_path = None;
    let mut output_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(
            arg,
            &[
                "--application-path",
                "--scope",
                "--scanner-config",
                "--output",
            ],
        );

        match flag {
            "--application-path" | "--scope" | "--scanner-config" | "--output" => {
                let slot: &mut Option<String> = match flag {
                    "--application-path" => &mut application_path,
                    "--scope" => &mut scope_path,
                    "--scanner-config" => &mut scanner_config_path,
                    _ => &mut output_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let application_path = application_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --application-path\n{}", usage()))?;
    let scope_path = scope_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scope\n{}", usage()))?;
    let scanner_config_path = scanner_config_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scanner-config\n{}", usage()))?;
    let output_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(default_scanner_findings_output_path);
    let generated_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let review_scope_ref = review_scope_ref_for_application(&scope_path, &application_path)
        .map_err(|error| error.to_string())?;
    let scan_config = load_scan_config(&scanner_config_path).map_err(|error| error.to_string())?;

    let finding_set = initialize_and_write_local_scan(ScanRunInput {
        application_path,
        review_scope_ref,
        output_path: output_path.clone(),
        generated_at,
        regex_rules: scan_config.regex_rules,
        semgrep_json_inputs: scan_config.semgrep_json_inputs,
        semgrep_local_commands: scan_config.semgrep_local_commands,
    })
    .map_err(|error| error.to_string())?;

    print!("{}", format_scan_summary(&finding_set, &output_path));
    Ok(())
}

fn run_disclosure_configure(args: &[String]) -> Result<(), String> {
    run_disclosure_configure_inner(args).map_err(|error| {
        emit_command_failure(
            LocalRunnerStage::DisclosureConfigure,
            "disclosure_configure_failed",
            error,
        )
    })
}

fn run_disclosure_configure_inner(args: &[String]) -> Result<(), String> {
    let mut scope_path = None;
    let mut scanner_findings_path = None;
    let mut policy_config_path = None;
    let mut output_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(
            arg,
            &[
                "--scope",
                "--scanner-findings",
                "--policy-config",
                "--output",
            ],
        );

        match flag {
            "--scope" | "--scanner-findings" | "--policy-config" | "--output" => {
                let slot: &mut Option<String> = match flag {
                    "--scope" => &mut scope_path,
                    "--scanner-findings" => &mut scanner_findings_path,
                    "--policy-config" => &mut policy_config_path,
                    _ => &mut output_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let scope_path = scope_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scope\n{}", usage()))?;
    let policy_config_path = policy_config_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --policy-config\n{}", usage()))?;
    let output_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(default_disclosure_policy_output_path);
    let created_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let review_scope_ref =
        disclosure_review_scope_ref_from_file(&scope_path).map_err(|error| error.to_string())?;
    let policy_config =
        load_disclosure_policy_config(&policy_config_path).map_err(|error| error.to_string())?;
    let include_scanner_findings = disclosure_config_includes_scanner_findings(&policy_config)
        .map_err(|error| error.to_string())?;
    let scanner_finding_set_ref = if include_scanner_findings {
        let scanner_findings_path = scanner_findings_path.map(PathBuf::from).ok_or_else(|| {
            "--scanner-findings is required when scanner findings are included".to_string()
        })?;
        Some(
            scanner_finding_set_ref_for_review_scope(&scanner_findings_path, &review_scope_ref)
                .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };

    let result = initialize_and_write_disclosure_policy(DisclosureConfigureInput {
        review_scope_ref,
        scanner_finding_set_ref,
        output_path: output_path.clone(),
        created_at,
        config: policy_config,
    })
    .map_err(|error| error.to_string())?;

    print!(
        "{}",
        format_disclosure_policy_summary(&result, &output_path)
    );
    Ok(())
}

fn run_manifest_preview(args: &[String]) -> Result<(), String> {
    run_manifest_preview_inner(args).map_err(|error| {
        emit_command_failure(
            LocalRunnerStage::ManifestPreview,
            "manifest_preview_failed",
            error,
        )
    })
}

fn run_manifest_preview_inner(args: &[String]) -> Result<(), String> {
    let mut scope_path = None;
    let mut scanner_findings_path = None;
    let mut disclosure_policy_path = None;
    let mut output_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(
            arg,
            &[
                "--scope",
                "--scanner-findings",
                "--disclosure-policy",
                "--output",
            ],
        );

        match flag {
            "--scope" | "--scanner-findings" | "--disclosure-policy" | "--output" => {
                let slot: &mut Option<String> = match flag {
                    "--scope" => &mut scope_path,
                    "--scanner-findings" => &mut scanner_findings_path,
                    "--disclosure-policy" => &mut disclosure_policy_path,
                    _ => &mut output_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let scope_path = scope_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scope\n{}", usage()))?;
    let disclosure_policy_path = disclosure_policy_path.map(PathBuf::from).ok_or_else(|| {
        format!(
            "missing required argument: --disclosure-policy\n{}",
            usage()
        )
    })?;
    let scanner_findings_path = scanner_findings_path.map(PathBuf::from);
    let output_path = output_path
        .map(PathBuf::from)
        .unwrap_or_else(default_outbound_manifest_output_path);
    let generated_at = utc_rfc3339_now().map_err(|error| error.to_string())?;

    let manifest = initialize_and_write_manifest_preview(ManifestPreviewInput {
        scope_path,
        scanner_findings_path,
        disclosure_policy_path,
        output_path: output_path.clone(),
        generated_at,
    })
    .map_err(|error| error.to_string())?;

    print!(
        "{}",
        format_manifest_preview_summary(&manifest, &output_path)
    );
    Ok(())
}

fn run_bundle_prepare(args: &[String]) -> Result<(), String> {
    let mut scope_path = None;
    let mut scanner_findings_path = None;
    let mut disclosure_policy_path = None;
    let mut manifest_path = None;
    let mut approving_actor = None;
    let mut approval_decision_arg = None;
    let mut approval_confirmation = None;
    let mut output_dir = None;
    let mut attempt_log_path = None;
    let mut reuse_approval_path = None;
    let mut approval_context_choice = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(
            arg,
            &[
                "--scope",
                "--scanner-findings",
                "--disclosure-policy",
                "--manifest",
                "--approving-actor",
                "--approval-decision",
                "--approval-confirmation",
                "--output-dir",
                "--attempt-log",
                "--reuse-approval",
                "--approval-context-choice",
            ],
        );

        match flag {
            "--scope"
            | "--scanner-findings"
            | "--disclosure-policy"
            | "--manifest"
            | "--approving-actor"
            | "--approval-decision"
            | "--approval-confirmation"
            | "--output-dir"
            | "--attempt-log"
            | "--reuse-approval"
            | "--approval-context-choice" => {
                let slot: &mut Option<String> = match flag {
                    "--scope" => &mut scope_path,
                    "--scanner-findings" => &mut scanner_findings_path,
                    "--disclosure-policy" => &mut disclosure_policy_path,
                    "--manifest" => &mut manifest_path,
                    "--approving-actor" => &mut approving_actor,
                    "--approval-decision" => &mut approval_decision_arg,
                    "--approval-confirmation" => &mut approval_confirmation,
                    "--output-dir" => &mut output_dir,
                    "--attempt-log" => &mut attempt_log_path,
                    "--reuse-approval" => &mut reuse_approval_path,
                    _ => &mut approval_context_choice,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let scope_path = scope_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scope\n{}", usage()))?;
    let disclosure_policy_path = disclosure_policy_path.map(PathBuf::from).ok_or_else(|| {
        format!(
            "missing required argument: --disclosure-policy\n{}",
            usage()
        )
    })?;
    let manifest_path = manifest_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --manifest\n{}", usage()))?;
    let scanner_findings_path = scanner_findings_path.map(PathBuf::from);
    let output_dir = output_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_signed_evidence_bundle_output_dir);
    let attempt_log_path = attempt_log_path
        .map(PathBuf::from)
        .unwrap_or_else(default_local_runner_attempt_log_path);

    let decided_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let created_at = decided_at.clone();
    let signing_time = decided_at.clone();
    let run_nonce = Some(run_nonce());

    // Argument-level validation runs BEFORE the preflight load so users see
    // "you cannot combine these flags" instead of a preflight parse error.
    if reuse_approval_path.is_some() {
        if approval_context_choice.as_deref() != Some("reuse-approved-manifest") {
            let choice = approval_context_choice.as_deref();
            return Err(match choice {
                None => "--approval-context-choice reuse-approved-manifest is required with --reuse-approval".to_string(),
                Some(other) => format!(
                    "invalid --approval-context-choice {other:?}; expected reuse-approved-manifest"
                ),
            });
        }
        if approval_decision_arg.is_some() || approval_confirmation.is_some() {
            return Err(
                "--reuse-approval cannot be combined with --approval-decision or --approval-confirmation; choose reuse or fresh approval explicitly"
                    .to_string(),
            );
        }
        // The reused approval carries its own approving_actor; accepting a
        // separate --approving-actor would silently ignore the caller's input.
        if approving_actor.is_some() {
            return Err(
                "--reuse-approval cannot be combined with --approving-actor; the reused approval already binds an approving actor"
                    .to_string(),
            );
        }
    } else if approval_context_choice.is_some() {
        return Err(
            "--approval-context-choice requires --reuse-approval for Story 1.9 reuse paths"
                .to_string(),
        );
    }

    let preflight_input = BundlePrepareInput {
        scope_path: scope_path.clone(),
        scanner_findings_path: scanner_findings_path.clone(),
        disclosure_policy_path: disclosure_policy_path.clone(),
        manifest_path: manifest_path.clone(),
        output_dir: output_dir.clone(),
        approving_actor: approving_actor.clone(),
        approval_decision: ApprovalDecision::Decline,
        approval_confirmation: None,
        reused_approval: None,
        run_nonce: run_nonce.clone(),
        decided_at: decided_at.clone(),
        created_at: created_at.clone(),
        signing_time: signing_time.clone(),
    };
    let context = match load_bundle_approval_context(&preflight_input) {
        Ok(context) => context,
        Err(error) => {
            // Route the failed stage from the actual underlying error so
            // upstream problems (scope/manifest/disclosure/scanner load)
            // don't get mislabeled as `bundle_prepare`.
            let stage = stage_for_bundle_prepare_error(&error);
            let failure_code = failure_code_for_bundle_prepare_error(&error);
            let attempt = pre_approval_failure_attempt(
                stage,
                &decided_at,
                run_nonce.as_deref(),
                failure_code,
                &error.to_string(),
            );
            // Note the attempt-log write outcome instead of silently dropping
            // it. Story 1.9's evidence trail depends on this log.
            let log_note = match write_local_runner_attempt(&attempt_log_path, &attempt) {
                Ok(()) => String::new(),
                Err(log_error) => {
                    format!("(also: attempt log write failed: {log_error})\n")
                }
            };
            return Err(format!(
                "{}{}{}",
                format_local_runner_attempt_summary(&attempt),
                log_note,
                error
            ));
        }
    };

    let (approval_decision, approval_confirmation, reused_approval) = if let Some(reuse_path) =
        reuse_approval_path
    {
        // Argument-level conflicts (missing choice, wrong choice, decision
        // arg, confirmation arg, approving actor) were already rejected
        // before preflight.
        let approval =
            match load_reusable_customer_approval(&PathBuf::from(reuse_path), &preflight_input) {
                Ok(approval) => approval,
                Err(error) => {
                    // Story 1.9 owns reuse-approval load semantics; emit a
                    // stage-aware attempt so failed reuse leaves an audit trail
                    // instead of a silent CLI error.
                    let attempt = pre_approval_failure_attempt(
                        LocalRunnerStage::BundlePrepare,
                        &decided_at,
                        run_nonce.as_deref(),
                        "reuse_approval_load_failed",
                        &error.to_string(),
                    );
                    let log_note = match write_local_runner_attempt(&attempt_log_path, &attempt) {
                        Ok(()) => String::new(),
                        Err(log_error) => {
                            format!("(also: attempt log write failed: {log_error})\n")
                        }
                    };
                    return Err(format!(
                        "{}{}{}",
                        format_local_runner_attempt_summary(&attempt),
                        log_note,
                        error
                    ));
                }
            };
        println!("Approval context reuse selected");
        print!("{}", format_bundle_approval_context(&context, &output_dir));
        println!("Reused approval_id: {}", approval.approval_id);
        let manifest_id = approval.manifest_id.clone();
        (ApprovalDecision::Approve, Some(manifest_id), Some(approval))
    } else {
        print!("{}", format_bundle_approval_context(&context, &output_dir));
        let (approval_decision, approval_confirmation) =
            approval_decision_from_cli(approval_decision_arg.as_deref(), approval_confirmation)?;
        if approval_decision == ApprovalDecision::Approve && approval_confirmation.is_none() {
            return Err(
                    "--approval-confirmation <manifest_id> is required when --approval-decision approve is used"
                        .to_string(),
                );
        }
        (approval_decision, approval_confirmation, None)
    };

    let result = initialize_write_bundle_prepare_with_attempt(
        BundlePrepareInput {
            scope_path,
            scanner_findings_path,
            disclosure_policy_path,
            manifest_path,
            output_dir: output_dir.clone(),
            approving_actor,
            approval_decision,
            approval_confirmation,
            reused_approval,
            run_nonce,
            decided_at,
            created_at,
            signing_time,
        },
        &attempt_log_path,
    );

    match result {
        Ok((output, attempt)) => {
            print!("{}", format_signed_bundle_summary(&output, &output_dir));
            print!("{}", format_local_runner_attempt_summary(&attempt));
            Ok(())
        }
        Err(error) => {
            if let Some(attempt) = error.attempt.as_deref() {
                Err(format!(
                    "{}{}",
                    format_local_runner_attempt_summary(attempt),
                    error.error
                ))
            } else {
                Err(error.error.to_string())
            }
        }
    }
}

fn run_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let process_id = std::process::id();
    format!("cli_run:{process_id}:{nanos}")
}

fn run_bundle_status(args: &[String]) -> Result<(), String> {
    let mut scope_path = None;
    let mut manifest_path = None;
    let mut output_dir = None;
    let mut attempt_log_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(
            arg,
            &["--scope", "--manifest", "--output-dir", "--attempt-log"],
        );
        match flag {
            "--scope" | "--manifest" | "--output-dir" | "--attempt-log" => {
                let slot: &mut Option<String> = match flag {
                    "--scope" => &mut scope_path,
                    "--manifest" => &mut manifest_path,
                    "--output-dir" => &mut output_dir,
                    _ => &mut attempt_log_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }

    let scope_path = scope_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --scope\n{}", usage()))?;
    let manifest_path = manifest_path
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing required argument: --manifest\n{}", usage()))?;
    let output_dir = output_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_signed_evidence_bundle_output_dir);
    let attempt_log_path = attempt_log_path
        .map(PathBuf::from)
        .unwrap_or_else(default_local_runner_attempt_log_path);
    let occurred_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let attempt = inspect_bundle_status(BundleStatusInput {
        scope_path,
        manifest_path,
        output_dir,
        occurred_at,
        run_nonce: Some(run_nonce()),
    })
    .map_err(|error| error.to_string())?;
    write_local_runner_attempt(&attempt_log_path, &attempt).map_err(|error| error.to_string())?;
    print!("{}", format_local_runner_attempt_summary(&attempt));
    Ok(())
}

fn run_runner_trust(args: &[String]) -> Result<(), String> {
    let mut attempt_log_path = None;
    let mut require_trusted_release = false;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--require-trusted-release" {
            if require_trusted_release {
                return Err("--require-trusted-release may only be supplied once".to_string());
            }
            require_trusted_release = true;
            index += 1;
            continue;
        }
        let (flag, inline_value) = split_long_option(arg, &["--attempt-log"]);
        match flag {
            "--attempt-log" => {
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(&mut attempt_log_path, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }
    let attempt_log_path = attempt_log_path
        .map(PathBuf::from)
        .unwrap_or_else(default_local_runner_attempt_log_path);
    let occurred_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let trust = runner_trust_metadata();
    if require_trusted_release && trust.trust_label != "trusted_release" {
        return Err(format!(
            "runner release is not trusted: {} ({})",
            trust.release_signature_status, trust.trust_label
        ));
    }
    let trusted = trust.trust_label == "trusted_release";
    let attempt = LocalRunnerAttempt {
        protocol_version: "codeattest.v0".to_string(),
        attempt_id: local_attempt_id(
            LocalRunnerStage::RunnerTrust,
            &occurred_at,
            Some(&run_nonce()),
        ),
        stage: LocalRunnerStage::RunnerTrust,
        outcome: LocalRunnerOutcome::Succeeded,
        review_state: ReviewState::UnapprovedNotSubmitted,
        approval_state: ApprovalState::NotApplicable,
        bundle_state: LocalBundleState::NotCreated,
        remote_state: "not_submitted".to_string(),
        occurred_at,
        runner: RunnerMetadata {
            name: "codeattest-local-runner".to_string(),
            version: onevps_local_runner_scaffold::runner_version().to_string(),
        },
        runner_trust: trust.clone(),
        identities: LocalAttemptIdentities::default(),
        approval_metadata: None,
        diagnostics: LocalAttemptDiagnostics {
            stage_failed: None,
            failure_code: None,
            message: if trusted {
                "Runner trust status inspected for a verified signed release.".to_string()
            } else {
                "Runner trust status inspected for a local build without verified release trust."
                    .to_string()
            },
            retryable: false,
            sensitive_detail_omitted: true,
            raw_snippets_printed: false,
            support_summary: if trusted {
                "The release record, runner artifact digest, and ML-DSA-65 signature verified against the compiled-in trust anchor."
                    .to_string()
            } else {
                "Use a verifiable release signature path before treating a runner build as partner-pilot ready."
                    .to_string()
            },
            local_artifact_paths: Vec::new(),
        },
        next_actions: if trusted {
            vec![
                "preserve the signed release verification artifact with this runner binary"
                    .to_string(),
            ]
        } else {
            vec![
                "keep local demo boundary visible".to_string(),
                "use signed release verification when available".to_string(),
            ]
        },
    };
    write_local_runner_attempt(&attempt_log_path, &attempt).map_err(|error| error.to_string())?;
    print!("{}", format_runner_trust_summary(&trust));
    print!("{}", format_local_runner_attempt_summary(&attempt));
    Ok(())
}

fn run_keys_init(args: &[String]) -> Result<(), String> {
    let mut key_dir = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(arg, &["--key-dir"]);
        match flag {
            "--key-dir" => {
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(&mut key_dir, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }
    let key_dir = key_dir
        .map(PathBuf::from)
        .unwrap_or_else(keys::default_key_dir);

    let key = keys::load_or_create_signing_key(&key_dir, RUNNER_SIGNING_KEY_ID)
        .map_err(|error| format!("could not load or create runner signing key: {error:?}"))?;

    // Never print the seed: only the key id, version, and public key.
    println!("key_id: {}", key.key_id);
    println!("key_version: {}", key.key_version);
    println!(
        "public_key: {}",
        onevps_local_runner_scaffold::ml_dsa::base64url_encode(&key.public_key)
    );
    Ok(())
}

fn run_keys_enrollment(args: &[String]) -> Result<(), String> {
    let mut review_id = None;
    let mut key_dir = None;
    let mut out_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        let (flag, inline_value) = split_long_option(arg, &["--review-id", "--key-dir", "--out"]);
        match flag {
            "--review-id" | "--key-dir" | "--out" => {
                let slot: &mut Option<String> = match flag {
                    "--review-id" => &mut review_id,
                    "--key-dir" => &mut key_dir,
                    _ => &mut out_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }
    let review_id =
        review_id.ok_or_else(|| format!("missing required argument: --review-id\n{}", usage()))?;
    let key_dir = key_dir
        .map(PathBuf::from)
        .unwrap_or_else(keys::default_key_dir);

    let key = keys::load_or_create_signing_key(&key_dir, RUNNER_SIGNING_KEY_ID)
        .map_err(|error| format!("could not load or create runner signing key: {error:?}"))?;
    let enrolled_at = utc_rfc3339_now().map_err(|error| error.to_string())?;
    let record = keys::enrollment_record(&key, &review_id, &enrolled_at)
        .map_err(|error| format!("could not build enrollment record: {error:?}"))?;
    let json = serde_json::to_string_pretty(&record)
        .map_err(|error| format!("could not serialize enrollment record: {error}"))?;

    match out_path {
        Some(path) => {
            fs::write(&path, format!("{json}\n"))
                .map_err(|error| format!("could not write enrollment record to {path}: {error}"))?;
        }
        None => println!("{json}"),
    }
    Ok(())
}

fn run_submit_send(args: &[String]) -> Result<(), String> {
    let mut endpoint = None;
    let mut bundle_dir = None;
    let mut token_key_id = None;
    let mut attempt_log_path = None;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--token-secret" || arg.starts_with("--token-secret=") {
            // A flag lands in the process table and shell history; the
            // secret must come from CODEATTEST_SUBMISSION_SECRET or stdin.
            return Err(
                "--token-secret is not accepted; set CODEATTEST_SUBMISSION_SECRET or pipe the secret on stdin"
                    .to_string(),
            );
        }
        let (flag, inline_value) = split_long_option(
            arg,
            &[
                "--endpoint",
                "--bundle-dir",
                "--token-key-id",
                "--attempt-log",
            ],
        );
        match flag {
            "--endpoint" | "--bundle-dir" | "--token-key-id" | "--attempt-log" => {
                let slot: &mut Option<String> = match flag {
                    "--endpoint" => &mut endpoint,
                    "--bundle-dir" => &mut bundle_dir,
                    "--token-key-id" => &mut token_key_id,
                    _ => &mut attempt_log_path,
                };
                let value = option_value(args, &mut index, flag, inline_value)?;
                assign_once(slot, flag, value)?;
            }
            unknown => return Err(format!("unknown argument: {unknown}\n{}", usage())),
        }
        index += 1;
    }
    let endpoint =
        endpoint.ok_or_else(|| format!("missing required argument: --endpoint\n{}", usage()))?;
    let bundle_dir = bundle_dir
        .map(PathBuf::from)
        .unwrap_or_else(default_signed_evidence_bundle_output_dir);
    let token_key_id = token_key_id
        .ok_or_else(|| format!("missing required argument: --token-key-id\n{}", usage()))?;
    let attempt_log_path = attempt_log_path
        .map(PathBuf::from)
        .unwrap_or_else(default_local_runner_attempt_log_path);

    let token_secret = submission_secret_from_env_or_stdin()?;

    let outcome =
        onevps_local_runner_scaffold::submit_bundle(&onevps_local_runner_scaffold::SubmitInput {
            endpoint,
            bundle_dir: bundle_dir.clone(),
            token_key_id,
            token_secret,
        });

    let context = submit_attempt_context(&bundle_dir)?;
    let attempt = onevps_local_runner_scaffold::submit_attempt(&outcome, &context);
    write_local_runner_attempt(&attempt_log_path, &attempt).map_err(|error| error.to_string())?;
    print!("{}", format_local_runner_attempt_summary(&attempt));

    match outcome {
        onevps_local_runner_scaffold::SubmitOutcome::Received { .. } => Ok(()),
        // A Refused outcome is a real answer from the server, not a failure
        // of the runner: the attempt log and the printed summary already
        // carry it, so this is not also an error exit.
        onevps_local_runner_scaffold::SubmitOutcome::Refused { .. } => Ok(()),
        onevps_local_runner_scaffold::SubmitOutcome::TransportFailed { failure_code, .. } => {
            Err(format!("submit failed: {failure_code}"))
        }
    }
}

/// Never accepted as a flag: reads from `CODEATTEST_SUBMISSION_SECRET` first,
/// then stdin when it is not a terminal (matching `approval_decision_from_cli`'s
/// existing stdin discipline for this crate).
fn submission_secret_from_env_or_stdin() -> Result<String, String> {
    if let Ok(secret) = env::var("CODEATTEST_SUBMISSION_SECRET")
        && !secret.trim().is_empty()
    {
        return Ok(secret);
    }
    if io::stdin().is_terminal() {
        return Err(
            "no submission secret provided; set CODEATTEST_SUBMISSION_SECRET or pipe the secret on stdin"
                .to_string(),
        );
    }
    let mut secret = String::new();
    io::stdin()
        .read_to_string(&mut secret)
        .map_err(|error| format!("could not read submission secret from stdin: {error}"))?;
    let secret = secret.trim().to_string();
    if secret.is_empty() {
        return Err("submission secret from stdin was empty".to_string());
    }
    Ok(secret)
}

/// Reads the identities a submit attempt record must carry from the bundle
/// this command is about to submit, mirroring the fields `bundle prepare`
/// itself records: the customer approval supplies `manifest_id`,
/// `approval_id`, `selected_commit`, and `repository_identity`; the bundle
/// manifest supplies the bundle-specific identities.
fn submit_attempt_context(
    bundle_dir: &std::path::Path,
) -> Result<onevps_local_runner_scaffold::SubmitAttemptContext, String> {
    let bundle_manifest: serde_json::Value = read_bundle_json(bundle_dir, "bundle_manifest.json")?;
    let customer_approval: serde_json::Value =
        read_bundle_json(bundle_dir, "customer-approval.json")?;
    let occurred_at = utc_rfc3339_now().map_err(|error| error.to_string())?;

    let field = |value: &serde_json::Value, path: &[&str], label: &str| -> Result<String, String> {
        let mut current = value;
        for key in path {
            current = current
                .get(key)
                .ok_or_else(|| format!("bundle is missing {label}"))?;
        }
        current
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("bundle field {label} is not a string"))
    };

    Ok(onevps_local_runner_scaffold::SubmitAttemptContext {
        runner: RunnerMetadata {
            name: onevps_local_runner_scaffold::RUNNER_NAME.to_string(),
            version: onevps_local_runner_scaffold::runner_version().to_string(),
        },
        runner_trust: onevps_local_runner_scaffold::runner_trust_metadata(),
        selected_commit: field(
            &customer_approval,
            &["displayed_context", "selected_commit", "commit_sha"],
            "displayed_context.selected_commit.commit_sha",
        )?,
        repository_identity: field(
            &customer_approval,
            &["displayed_context", "repository_identity"],
            "displayed_context.repository_identity",
        )?,
        manifest_id: field(&customer_approval, &["manifest_id"], "manifest_id")?,
        approval_id: field(&customer_approval, &["approval_id"], "approval_id")?,
        approval_decided_at: field(&customer_approval, &["decided_at"], "decided_at")?,
        evidence_bundle_id: field(
            &bundle_manifest,
            &["evidence_bundle_id"],
            "evidence_bundle_id",
        )?,
        bundle_instance_id: field(
            &bundle_manifest,
            &["bundle_instance_id"],
            "bundle_instance_id",
        )?,
        submission_attempt_id: field(
            &bundle_manifest,
            &["submission_attempt_id"],
            "submission_attempt_id",
        )?,
        occurred_at,
    })
}

fn read_bundle_json(bundle_dir: &std::path::Path, name: &str) -> Result<serde_json::Value, String> {
    let path = bundle_dir.join(name);
    let bytes = fs::read(&path).map_err(|error| format!("could not read {path:?}: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("could not parse {path:?}: {error}"))
}

fn approval_decision_from_cli(
    decision_arg: Option<&str>,
    confirmation: Option<String>,
) -> Result<(ApprovalDecision, Option<String>), String> {
    if let Some(decision) = decision_arg {
        return match decision.trim().to_ascii_lowercase().as_str() {
            "approve" | "approved" => Ok((ApprovalDecision::Approve, confirmation)),
            "decline" | "declined" | "cancel" | "cancelled" | "canceled" => {
                Ok((ApprovalDecision::Decline, None))
            }
            other => Err(format!(
                "invalid --approval-decision {other:?}; expected approve or decline"
            )),
        };
    }

    // When stdin is a TTY, refuse to block on an interactive read no CI
    // harness will ever satisfy. Require --approval-decision instead. When
    // stdin is a pipe/file, read to EOF and treat any non-APPROVE input
    // (including empty input from closed stdin) as decline — same semantics
    // as before, just no infinite hang.
    if io::stdin().is_terminal() {
        return Err(
            "no approval response provided; pass --approval-decision approve|decline (with --approval-confirmation <manifest_id> when approving) or pipe an APPROVE <manifest_id> line on stdin"
                .to_string(),
        );
    }

    let mut response = String::new();
    io::stdin()
        .read_to_string(&mut response)
        .map_err(|error| format!("could not read approval response from stdin: {error}"))?;
    let response = response.trim();
    if let Some(rest) = response.strip_prefix("APPROVE ") {
        let manifest_id = rest.trim();
        if !manifest_id.is_empty() {
            return Ok((ApprovalDecision::Approve, Some(manifest_id.to_string())));
        }
    }
    Ok((ApprovalDecision::Decline, None))
}

fn split_long_option<'a>(arg: &'a str, recognized: &[&str]) -> (&'a str, Option<&'a str>) {
    if let Some(eq) = arg.find('=') {
        let (name, rest) = arg.split_at(eq);
        if recognized.contains(&name) {
            return (name, Some(&rest[1..]));
        }
    }
    (arg, None)
}

fn option_value(
    args: &[String],
    index: &mut usize,
    flag: &str,
    inline_value: Option<&str>,
) -> Result<String, String> {
    if let Some(inline) = inline_value {
        if inline.trim().is_empty() {
            return Err(format!(
                "missing value for {flag}: inline value after '=' is empty or whitespace\n{}",
                usage()
            ));
        }
        return Ok(inline.to_string());
    }

    *index += 1;
    let next = args
        .get(*index)
        .ok_or_else(|| format!("missing value for {flag}\n{}", usage()))?;
    if next.starts_with("--") {
        return Err(format!(
            "missing value for {flag}: next token looks like a flag ({next})\n{}",
            usage()
        ));
    }
    if next.trim().is_empty() {
        return Err(format!(
            "missing value for {flag}: value is empty or whitespace\n{}",
            usage()
        ));
    }
    Ok(next.clone())
}

fn assign_once(slot: &mut Option<String>, flag: &str, value: String) -> Result<(), String> {
    if slot.is_some() {
        return Err(format!(
            "duplicate argument: {flag} was specified more than once\n{}",
            usage()
        ));
    }
    *slot = Some(value);
    Ok(())
}

fn usage() -> String {
    concat!(
        "usage:\n",
        "  onevps-local-runner-scaffold scope init --application-path <path> --review-id <review:id> --commit <40-char-sha> [--output <path>]\n",
        "  onevps-local-runner-scaffold scan run --application-path <path> --scope <review-scope.json> --scanner-config <scanner-config.json> [--output <path>]\n",
        "  onevps-local-runner-scaffold disclosure configure --scope <review-scope.json> [--scanner-findings <scanner-findings.json>] --policy-config <policy-config.json> [--output <path>]\n",
        "  onevps-local-runner-scaffold manifest preview --scope <review-scope.json> [--scanner-findings <scanner-findings.json>] --disclosure-policy <disclosure-policy.json> [--output <outbound-manifest.json>]\n",
        "  onevps-local-runner-scaffold bundle prepare --scope <review-scope.json> [--scanner-findings <scanner-findings.json>] --disclosure-policy <disclosure-policy.json> --manifest <outbound-manifest.json> [--approving-actor <id>] [--approval-decision approve|decline --approval-confirmation <manifest_id>] [--reuse-approval <customer-approval.json> --approval-context-choice reuse-approved-manifest] [--output-dir <dir>] [--attempt-log <jsonl>]\n",
        "  onevps-local-runner-scaffold bundle status --scope <review-scope.json> --manifest <outbound-manifest.json> [--output-dir <dir>] [--attempt-log <jsonl>]\n",
        "  onevps-local-runner-scaffold runner trust [--require-trusted-release] [--attempt-log <jsonl>]\n",
        "  onevps-local-runner-scaffold keys init [--key-dir <dir>]\n",
        "  onevps-local-runner-scaffold keys enrollment --review-id <review:id> [--key-dir <dir>] [--out <path>]\n",
        "  onevps-local-runner-scaffold submit send --endpoint <url> --bundle-dir <dir> --token-key-id <id> [--attempt-log <jsonl>] (secret from CODEATTEST_SUBMISSION_SECRET or stdin)",
    )
    .to_string()
}
