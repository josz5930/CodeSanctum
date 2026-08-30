# Runner

Home for the Rust Local Runner.

The runner executes in the customer environment and owns local scope capture, scanner input capture, disclosure policy configuration, outbound manifest preview, explicit customer approval, deterministic local Evidence Bundle construction, and real ML-DSA-65 signature metadata. Story 1.8 remains local and not submitted: network submission, receipt handling, and received-state reconciliation are later-story responsibilities. The runner depends on protocol contracts and must not redefine evidence semantics.

This area is intended public/open-source. Use only synthetic or public non-customer fixtures and avoid vendor-private service details.

## Bundled demo

A synthetic demo application lives at [`examples/demo-app/`](./examples/demo-app/), and `npm run demo` (from the repository root) drives the entire Story 1.4–1.8 workflow against it — scope capture, local scan, disclosure policy, manifest preview, explicit approval, and a signed local Evidence Bundle. It writes all runtime output under a gitignored `.codeattest/demo/` directory and transmits nothing. The per-command reference for what that demo runs is the rest of this document.

## Story 1.4 Scope Capture

Canonical local command:

```sh
cargo run -p onevps-local-runner-scaffold -- scope init \
  --application-path ./path/to/application \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --output .codeattest/review-scope.json
```

Inputs:

- `--application-path` must point to an existing readable local application directory or file.
- `--commit` must be a 40-character lowercase git SHA.
- `--output` is optional. If omitted, the runner writes `.codeattest/review-scope.json` relative to the current working directory.

The command writes a local `review-scope` protocol artifact with `snake_case` fields and a UTC RFC 3339 `generated_at` timestamp. It also prints a monochrome summary with the selected application, selected commit, repository identity hash, runner version, detected or not-detected technical context, dependency manifest statuses, limitations, and output path.

No source contents are transmitted by this command. The repository identity hash is computed locally from deterministic scope metadata such as the selected application identity/path and selected commit, not from full source-file contents.

## Dependency Manifest Context

Supported dependency-name extraction in Story 1.4:

- `package.json` for TypeScript/JavaScript dependency names from dependency sections.
- `requirements.txt` for Python dependency names from simple requirement lines.

Recorded but not parsed in Story 1.4:

- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `pyproject.toml`
- `Pipfile`
- `Pipfile.lock`

Unsupported or missing manifests are still recorded in metadata with `unsupported` or `not_found` status and a limitation when applicable. The runner records manifest paths and dependency counts in CLI output; dependency names are kept in machine-readable metadata where the protocol schema supports them.

## Story 1.5 Local Scanner Inputs

Canonical local command after `scope init` has produced a review scope:

```sh
cargo run -p onevps-local-runner-scaffold -- scan run \
  --application-path ./path/to/application \
  --scope .codeattest/review-scope.json \
  --scanner-config ./scanner-config.json \
  --output .codeattest/scanner-findings.json
```

Inputs:

- `--application-path` must point to the same readable local application directory or file captured by the review scope. The runner checks the scope's selected application id before writing scan metadata.
- `--scope` points to a local review-scope JSON artifact. The runner reads and validates `protocol_version`, `review_scope_id`, and selected application metadata, then records `review_scope_id` as `review_scope_ref` in the scanner finding set.
- `--scanner-config` is a local JSON file containing configured regex rules, Semgrep JSON inputs, and/or explicit local Semgrep commands.
- `--output` is optional. If omitted, the runner writes `.codeattest/scanner-findings.json` relative to the current working directory.

Example scanner config:

```json
{
  "regex_rules": [
    {
      "scanner_name": "regex",
      "rule_id": "demo.regex.eval",
      "pattern": "eval\\(",
      "ruleset_identifier": "local:demo-regex",
      "severity": "warning",
      "confidence": "medium",
      "target_file_group": "typescript_javascript",
      "target_include_patterns": ["src/*.ts"],
      "retain_raw_output_locally": false
    }
  ],
  "semgrep_json_inputs": [
    {
      "scanner_name": "semgrep",
      "json_path": "semgrep-output.json",
      "ruleset_identifier": "local:semgrep-demo",
      "scanner_version": "1.168.0",
      "target_file_group": "typescript_javascript",
      "target_include_patterns": ["src/*.ts"],
      "retain_raw_output_locally": false
    }
  ],
  "semgrep_local_commands": [
    {
      "scanner_name": "semgrep",
      "command": "semgrep",
      "config_path": "semgrep.yml",
      "ruleset_identifier": "local:semgrep-demo",
      "target_file_group": "typescript_javascript",
      "target_include_patterns": ["src/*.ts"],
      "retain_raw_output_locally": false
    }
  ]
}
```

Semgrep local commands use explicit local configs only. The runner allows the command name `semgrep` or a path whose file name is `semgrep`, invokes `semgrep --version` first, then runs `semgrep scan --json --metrics off --config <config_path> <application_path>` with bounded process output and a timeout. The runner does not default to registry-backed `--config auto`.

Scanner traversal skips common external/generated directories such as `.git`, `node_modules`, `target`, `.venv`, `dist`, `build`, and `coverage`, and skips oversized files. Skipped paths are reported as coverage limitations. Include patterns are segment-aware: `src/*.ts` matches files directly under `src`, while `src/**/*.ts` intentionally matches nested files too.

The scan command writes a protocol `scanner_finding_set` artifact with scanner run metadata, file-level `scanned_files`, Candidate Findings, source-derived retention class tags, artifact references for explicitly retained raw scanner output, and coverage limitations such as supported files that were not scanned by a successful configured input. Scanner adapters are inputs only: Candidate Findings remain `status: "candidate"` and are not CodeAttest Review Findings or expert classifications.

By default, raw scanner output is not retained and raw scanner stderr/stdout is not printed in terminal diagnostics. If `retain_raw_output_locally` is set for a Semgrep input, retained raw output is referenced as a local `scanner_raw_output` artifact tagged `customer_opt_in_retained_source` in the scanner finding set. That tag is subject to the same environment evidence gate as Raw Snippets and targeted files: `manifest preview` and `bundle prepare` reject a scanner finding set carrying a `customer_opt_in_retained_source` reference under the default `synthetic_demo` gate, so retained raw scanner output cannot be chained into a manifest or Evidence Bundle outside partner-pilot readiness.

The terminal summary is monochrome and does not print raw source snippets or retained scanner context. If configured inputs produce no findings, the summary says no findings were produced by configured inputs and does not claim the application is free of vulnerabilities.

## Story 1.6 Disclosure Policy

Canonical local command after `scope init` and `scan run` have produced local artifacts:

```sh
cargo run -p onevps-local-runner-scaffold -- disclosure configure \
  --scope .codeattest/review-scope.json \
  --scanner-findings .codeattest/scanner-findings.json \
  --policy-config ./disclosure-policy-config.json \
  --output .codeattest/disclosure-policy.json
```

Inputs:

- `--scope` points to a local review-scope JSON artifact. The runner validates `protocol_version` and `review_scope_id`, then records `review_scope_id` as `review_scope_ref`.
- `--scanner-findings` points to a local scanner finding set. It is required when scanner findings are included. The runner validates `protocol_version`, `scanner_finding_set_id`, and matching `review_scope_ref`; Candidate Findings remain candidate-only.
- `--policy-config` is a local JSON file that selects disclosure mode, included evidence categories, snippet caps, redaction metadata, selected paths or areas, and retention preference.
- `--output` is optional. If omitted, the runner writes `.codeattest/disclosure-policy.json` relative to the current working directory.

Example balanced-default config:

```json
{
  "redaction": {
    "enabled": true,
    "profile": "local-demo-redaction",
    "configuration_version": "local-demo-redaction-v1"
  }
}
```

Example extended-mode config:

```json
{
  "coverage_mode": "extended_approved_snippets_or_targeted_files",
  "max_snippet_chars": 1200,
  "context_lines": 5,
  "selected_files_or_areas": ["src/app.ts", "area:auth-flow"],
  "redaction": {
    "enabled": true,
    "profile": "local-demo-redaction",
    "configuration_version": "local-demo-redaction-v1"
  }
}
```

Coverage modes:

- `metadata_only` (alias: `metadata`): excludes Raw Snippets and targeted files. The summary warns that expert confidence is lower without snippets and records that final downstream review materials must state snippets were not provided.
- `finding_context_snippets` (alias: `finding_context`): balanced default when `coverage_mode` is omitted. It records capped finding-context snippet policy metadata and warns that Raw Snippets are source-code disclosure even when capped or redacted.
- `extended_approved_snippets_or_targeted_files` (aliases: `extended`, `extended_approved`): records selected relative paths or `area:<name>` references. It warns that broader approved source context may improve review confidence but increases disclosure.

Mode values are case-insensitive and treat spaces and hyphens as underscores in local config. The emitted `disclosure-policy.json` always uses the canonical `snake_case` value.

Retention and source-derived handling:

- Raw Snippets and targeted files default to `transient_source_derived` when included.
- `customer_opt_in_retained_source` requires `retain_source_opt_in: true` plus a non-`not_applicable` `retention_period`.
- Metadata, dependency information, scanner findings, and derived policy metadata remain `retained_review_artifact` when included.

Redaction handling:

- When redaction is configured, the policy records the profile and configuration version where available.
- The summary and policy state that redaction reduces exposure but secret detection cannot prove absence of secrets.

The disclosure command records policy metadata only. It does not read, store, print, package, redact, or transmit Raw Snippet contents or targeted file contents. Extended mode validates selected relative paths and area references, rejects absolute paths, `..`, null bytes, and root escapes, and records only the selection intent.

The terminal summary is monochrome and distinguishes metadata, dependency information, scanner findings, Raw Snippets, targeted files, derived artifacts, and never-collected items. It avoids claims about approval, receipt, signing, submission, certification, or absence of vulnerabilities.

## Story 1.7 Outbound Manifest Preview

Canonical local command after `scope init`, `scan run`, and `disclosure configure` have produced local artifacts:

```sh
cargo run -p onevps-local-runner-scaffold -- manifest preview \
  --scope .codeattest/review-scope.json \
  --scanner-findings .codeattest/scanner-findings.json \
  --disclosure-policy .codeattest/disclosure-policy.json \
  --output .codeattest/outbound-manifest.json
```

Inputs:

- `--scope` points to a local review-scope JSON artifact. The runner validates protocol version, review scope id, selected commit, repository identity hash, selected application, and runner metadata.
- `--scanner-findings` points to a local scanner finding set. It is required when the Disclosure Policy includes scanner findings. The runner validates protocol version, scanner finding set id, matching review scope reference, and Candidate Finding-only status.
- `--disclosure-policy` points to a local Disclosure Policy JSON artifact. The runner validates protocol version, policy id, matching review scope reference, scanner finding set reference when applicable, Coverage Mode, redaction metadata, retention metadata, warnings, and limitations.
- `--output` is optional. If omitted, the runner writes `.codeattest/outbound-manifest.json` relative to the current working directory.

The command writes a local `outbound-manifest` protocol artifact and prints a monochrome preview summary. The summary includes copyable `manifest_id`, selected application, selected commit, repository identity hash, runner version, Disclosure Policy ref, scanner finding set ref when included, Coverage Mode label/value, package preview state, output path, and local-only boundary.

Evidence category rows are complete and not sparse:

- `metadata`: review-scope metadata such as selected application, commit, repository identity hash, runner metadata, and technical context.
- `dependencies`: dependency manifest metadata from review scope, represented by count/reference.
- `scanner_findings`: Candidate Findings and scanner run metadata only; not expert review findings.
- `raw_snippets`: planned source-code disclosure metadata when Coverage Mode allows capped finding-context snippets. The preview shows caps, context lines, redaction profile/version, retention class, and limitations without printing snippet contents.
- `targeted_files`: selected file or `area:` references for extended mode. The preview records references and controls without reading targeted file contents.
- `derived_artifacts`: review scope, scanner finding set when included, Disclosure Policy, and outbound manifest preview metadata.
- `never_collected_items`: complete repository archive, full Git history, unapproved source files, unapproved Raw Snippets, and local environment secrets.

Manifest preview does not rescan, make network calls, approve, sign, package, send, receive, or certify evidence. It does not read, store, print, or package Raw Snippet or targeted file contents. Redaction output records configured redaction metadata when available and states that secret detection cannot prove absence of secrets; it does not claim that source contents were processed or proven secret-free.

`manifest_id` is computed from canonical manifest content excluding `manifest_id` itself using the protocol fixture canonicalization rules. The emitted JSON and CLI summary expose the manifest id, selected commit, repository identity hash, Coverage Mode, and runner version so later approved-vs-received comparison can use the same identity chain.

## Story 1.8 Customer Approval and Signed Local Bundle

Canonical local command after `manifest preview` has produced an outbound manifest:

```sh
cargo run -p onevps-local-runner-scaffold -- bundle prepare \
  --scope .codeattest/review-scope.json \
  --scanner-findings .codeattest/scanner-findings.json \
  --disclosure-policy .codeattest/disclosure-policy.json \
  --manifest .codeattest/outbound-manifest.json \
  --approving-actor "maya@example.com" \
  --approval-decision approve \
  --approval-confirmation <manifest_id> \
  --output-dir .codeattest/evidence-bundle
```

Inputs:

- `--scope` points to the local review-scope artifact used by the manifest preview.
- `--scanner-findings` is required only when the Disclosure Policy includes scanner findings.
- `--disclosure-policy` points to the exact local Disclosure Policy used by the manifest preview.
- `--manifest` points to a Story 1.7 preview-safe outbound manifest. The runner recomputes `manifest_id` from canonical content excluding `manifest_id` and rejects modified manifests.
- `--approving-actor` is optional. If present, it records the local customer-side approving actor identifier.
- `--approval-decision approve` requires `--approval-confirmation <manifest_id>`. A missing or mismatched confirmation is treated as declined/not-submitted by the library; the CLI rejects noninteractive approve without a confirmation.
- `--approval-decision decline` records a declined customer decision and creates no bundle or signature.
- If `--approval-decision` is omitted, stdin may contain `APPROVE <manifest_id>` or `DECLINE`. Empty input, EOF, cancellation text, or mismatch is treated as declined/not-submitted.
- `--output-dir` is optional. If omitted, the runner writes `.codeattest/evidence-bundle` relative to the current working directory.

Before an approval decision is accepted, the summary displays the manifest identity, selected application, selected commit, repository identity hash, Disclosure Policy ref, scanner finding set ref when included, Coverage Mode label/value, disclosure warnings, bundle preview summary, and output directory.

Approved output writes:

```text
.codeattest/evidence-bundle/
  customer-approval.json
  bundle_manifest.json
  signature-envelope.bundle.json
  artifacts/
    review-scope.json
    disclosure-policy.json
    scanner-findings.json       # only when policy includes scanner findings
    outbound-manifest.json
```

Declined output writes only `customer-approval.json` with `decision: declined`, `state: not_submitted`, no bundle, no signature, no send action, and next actions to revise policy, rerun scan, export manifest, or exit.

`evidence_bundle_id` is computed from canonical `bundle_manifest.json` content excluding `evidence_bundle_id`. It is not computed from terminal output, archive bytes, zip metadata, transport payloads, or signature bytes. The bundle remains `bundle_state: not_submitted` and includes `bundle_instance_id` plus `submission_attempt_id` for later rerun/resubmission workflows.

Signing uses `algorithm_profile: ml_dsa_65` with `signing_mode: enrolled_runner_key`. Signature envelopes sign the typed `evidence_bundle` identity and record key id/version, signing time, canonicalization, signed identity type, signed identity, real ML-DSA-65 signature bytes, and limitations. Key custody is customer-held runner custody in a non-validated cryptographic module, not a hardware security module.

Metadata-only bundles are supported without source-derived files. Finding-context and extended modes are blocked until approved source-derived artifacts are materialized under the selected application scope. When transient source-derived artifacts are included in future, bundle manifests must tag them as `transient_source_derived` by default and record pending local cleanup intent; Story 1.8 does not claim final deletion evidence or vendor-side deletion.

The terminal summary is monochrome and claim-safe. It does not print raw snippets, targeted file contents, raw scanner output, secrets, certification claims, independent assurance claims, absence-of-vulnerabilities claims, or remote intake outcomes.

## Story 1.9 Failure, Rerun, Status, and Trust States

Story 1.9 adds local attempt/status records around bundle preparation without changing the no-submit/no-receipt boundary. The default attempt log is append-only JSONL at `.codeattest/local-runner-attempts.jsonl`; each line conforms to `protocol/schemas/local-runner-attempt.schema.json`.

Ordinary local builds have an empty compile-time release anchor and report
`unsigned_local_build` / `demo_only_unsigned`. The controlled G Task 6 release
pipeline compiles a non-empty release anchor and immutable build/release
identifiers into the binary, signs a `runner-release-record`, and binds its
`artifact_digest` to that exact binary. From the release directory,
`runner trust --require-trusted-release` exits non-zero unless the record,
digest, signing input, and ML-DSA-65 signature all verify. Runtime environment
variables cannot replace the compiled anchor. Build and deployment instructions
are in [`../infra/deploy/PROVISIONING.md`](../infra/deploy/PROVISIONING.md).

Every attempt record includes:

- `stage` and `outcome`
- `review_state`, `approval_state`, `bundle_state`, and `remote_state: not_submitted`
- selected commit, repository identity hash, manifest identity, approval id, and bundle identities when they actually exist
- runner version and runner trust metadata
- privacy-safe diagnostics with `raw_snippets_printed: false`
- next actions for local rerun or troubleshooting

Failure stages use explicit vocabulary such as `manifest_preview`, `approval`, `bundle_packaging`, `bundle_signing`, `bundle_prepare`, `status_inspect`, and `runner_trust`. CLI output starts with the failed stage when a command fails, for example:

```text
Stage failed: bundle_packaging
Review state: approved_no_signed_bundle
Remote state: not_submitted
No signed Evidence Bundle is ready.
```

Pre-approval failures remain `unapproved_not_submitted` and do not print or store an approved Evidence Bundle identity. If packaging or signing fails after explicit customer approval, the runner preserves `customer-approval.json`, removes stale signed-bundle artifacts, writes an attempt record, and states that no signed Evidence Bundle is ready.

### Explicit Approval Reuse

Recoverable reruns can reuse a previous approved manifest only when the user chooses that path explicitly:

```sh
cargo run -p onevps-local-runner-scaffold -- bundle prepare \
  --scope .codeattest/review-scope.json \
  --disclosure-policy .codeattest/disclosure-policy.json \
  --manifest .codeattest/outbound-manifest.json \
  --reuse-approval .codeattest/evidence-bundle/customer-approval.json \
  --approval-context-choice reuse-approved-manifest \
  --output-dir .codeattest/evidence-bundle-rerun
```

The reused approval must be `decision: approved` and must match the current manifest id, selected application, selected commit, repository identity hash, Coverage Mode, and Disclosure Policy reference. If any of that context changed, choose fresh approval with the normal Story 1.8 approval confirmation path. Successful reruns receive a new local `attempt_id` and a distinct `bundle_instance_id` / `submission_attempt_id`.

### Status Inspection

Inspect local state without creating a new approval or bundle:

```sh
cargo run -p onevps-local-runner-scaffold -- bundle status \
  --scope .codeattest/review-scope.json \
  --manifest .codeattest/outbound-manifest.json \
  --output-dir .codeattest/evidence-bundle \
  --attempt-log .codeattest/local-runner-attempts.jsonl
```

Status output distinguishes no approval yet, declined approval, approved but no signed bundle ready, signed local bundle ready but not submitted, and stale or inconsistent output directories. It never infers submitted, received, under-review, review-complete, verification-pending, finalized, or Vendor Receipt states.

### Runner Trust

Inspect runner version and trust metadata:

```sh
cargo run -p onevps-local-runner-scaffold -- runner trust
```


Default local development output is labeled `unsigned_local_build` (release signature status) and `demo_only_unsigned` (trust label). Optional environment variables `ONEVPS_RUNNER_BUILD_IDENTIFIER` and `ONEVPS_RUNNER_RELEASE_IDENTIFIER` can add build/release labels, but the runner still reports unsigned local trust unless a future release-verification path exists.

## Story 2.0 Protocol Trust Prerequisites

Story 2.0 hardens the protocol boundary before Epic 2 intake, receipt, and approved-vs-received comparison work.

Key runner-facing rules:

- Manifest, Disclosure Policy, and Evidence Bundle identities use library-backed RFC 8785 / JCS canonicalization (`canonicalize` in Node gates and `serde_json_canonicalizer` in Rust runner code).
- Artifact `content_path` values are portable protocol paths, not local machine paths. They are relative, slash-separated, anchored by `content_path_anchor`, and reject absolute paths, drive prefixes, backslashes, traversal, null bytes, and anchor escapes.
- Bundle preparation verifies copied artifact bytes against declared digest and size before final bundle manifest and signature-envelope output are accepted.
- `environment_evidence_gate()` defaults to `synthetic_demo` and rejects real Raw Snippets or targeted files. Real source-derived evidence requires `partner_pilot_real_snippet_ready` plus access control, access logging, encryption at rest, retention defaults, deletion controls, demo budget gate, signing/release trust, and retention-period readiness.
- The runner still does not implement vendor intake, Vendor Receipt, received states, production storage, Cloud KMS signing, access logs, encryption, retention jobs, or deletion evidence.

Run the prerequisite gate with:

```sh
npm run runner:story-2.0-prereq-check
```

## Sub-project B: Submission Transport

`submit send` walks a prepared, signed Evidence Bundle through the host's three submission phases — open, content-addressed artifact PUTs, finalize — and appends the result to the local attempt log as `stage: submit`.

```sh
CODEATTEST_SUBMISSION_SECRET=<secret> \
cargo run -p onevps-local-runner-scaffold -- submit send \
  --endpoint https://<host>:<port> \
  --bundle-dir .codeattest/evidence-bundle \
  --token-key-id <token-key-id> \
  --attempt-log .codeattest/local-runner-attempts.jsonl
```

The submission secret is never accepted as a `--token-secret` flag — a flag lands in the process table and shell history. Pass it via `CODEATTEST_SUBMISSION_SECRET`, or pipe it on stdin when that variable is unset and stdin is not a terminal.

`submit send` re-derives each artifact's SHA-256 digest locally before uploading it and refuses to send bytes that do not match what the bundle manifest declares. It uploads only the digests the server reports missing, so a dropped connection mid-bundle resumes rather than starting over.

The command's exit status reflects transport, not the business decision: a `Refused` outcome (rejected or quarantined) is a real, successful answer from the server, not a failure of the runner, and exits `0` with the outcome recorded in the attempt log. Only a transport-level failure (the server unreachable, an unexpected status, a malformed response) is a non-zero exit.

`submit`-stage attempt records may state the protocol's own transport state verbatim (`submit_attempted`, `received_with_receipt`, `rejected_no_receipt`, `quarantined_no_receipt`) because that is exactly what the server returned — the claim-safety scan strips those four tokens before scanning a submit attempt's own text. Every other forbidden phrase (`certified`, `no vulnerabilities`, `attestation`, and the rest) stays forbidden on every stage including submit, and no other stage may use remote-state language at all.
