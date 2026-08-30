import canonicalizeJson from "canonicalize";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bundleSignatureOutcomeFor, realBundleSignatureFor } from "./helpers/receipt-fixtures.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const validFixtureRoot = path.join(fixtureRoot, "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-intake-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "intake-service-test-dist");

const FORBIDDEN_RESULT_KEYS = new Set([
  "vendor_receipt_id",
  "receipt_timestamp",
  "receipt_signature",
  "receipt_verification_metadata",
  "received_with_receipt",
  "reviewer_classification",
  "reviewer_classifications",
  "finding_status",
  "finding_statuses",
  "attestation_state",
  "static_bundle_artifact",
  "worker_queue_payload",
  "event_log_record"
]);

const FORBIDDEN_COPY = [
  /submission successful/i,
  /upload successful/i,
  /\baccepted\b/i,
  /\breviewed\b/i,
  /certified/i,
  /no vulnerabilities/i,
  /vendor receipt/i,
  /SUPER_SECRET_TOKEN_MATERIAL/,
  /SIMULATED_REAL_CUSTOMER_SOURCE/,
  /SENSITIVE_RAW_SNIPPET_MARKER/
];

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "intake.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const intake = await import(pathToFileURL(path.join(outDir, "services", "intake", "src", "index.js")).href);
  const requiredExports = [
    "verifyIntakeSubmission",
    "workspaceName",
    "workspaceScope"
  ];
  for (const exportName of requiredExports) {
    assert(exportName in intake, `missing public export: ${exportName}`);
  }
  assert(intake.workspaceName === "@onevps/intake-service", "workspace marker must remain exported");

  await testAcceptedSyntheticFixture(intake);
  await testDemoBudgetEnforcement(intake);
  await testDecisionResolvedProtocolAuthority(intake);
  await testSchemaAndProtocolFailures(intake);
  await testIdentityApprovalAndSignatureFailures(intake);
  await testReviewScopedTokenFailures(intake);
  await testTokenComparisonBoundary(intake);
  await testArtifactAndEnvironmentFailures(intake);
  await testSourceSafetyAndInventoryBoundaries(intake);
  await testShippedControlArtifactFailures(intake);
  await testTraceMatrixSemanticFailures(intake);
  await testNoReviewSideEffectsOrNetworkCalls(intake);
  await testLeakSafeFailureOutput(intake);
  await testFocusedEdgeAndRepresentationMatrices(intake);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

async function testAcceptedSyntheticFixture(intake) {
  const request = await createAcceptedRequest();
  const result = await intake.verifyIntakeSubmission(request);

  assert(result.state === "verified_receipt_eligible", "accepted synthetic fixture must be receipt-eligible only");
  assert(result.intake_record, "accepted result must include an intake record projection");
  assert(result.intake_record.approved_outbound_manifest_ref === "artifact_ref:outbound_manifest", "projection must reference approved outbound manifest artifact");
  assert(result.intake_record.manifest_id === request.approved_outbound_manifest.manifest_id, "projection must preserve manifest_id");
  assert(result.intake_record.evidence_bundle_id === request.submitted_bundle_manifest.evidence_bundle_id, "projection must preserve evidence_bundle_id");
  assert(result.intake_record.selected_application.application_id === "synthetic-demo-app", "projection must include selected application");
  assert(result.intake_record.selected_commit.commit_sha === "0123456789abcdef0123456789abcdef01234567", "projection must include selected commit");
  assert(result.intake_record.repository_identity_hash === request.approved_outbound_manifest.selected_scope_summary.repository_identity, "projection must include repository identity hash");
  assert(result.intake_record.disclosure_policy_ref === request.approved_outbound_manifest.disclosure_policy_ref, "projection must include Disclosure Policy reference");
  assert(result.intake_record.coverage_mode === "finding_context_snippets", "projection must include Coverage Mode");
  assert(result.intake_record.runner.name === "codeattest-local-runner", "projection must include runner metadata");
  assert(result.intake_record.tool_versions.length >= 2, "projection must include tool versions");
  assert(result.intake_record.bundle_instance_id === "bundle_instance:synthetic_demo_001", "projection must include bundle_instance_id");
  assert(result.intake_record.submission_attempt_id === "submission_attempt:synthetic_demo_001", "projection must include submission_attempt_id");
  assert(!("repository_archive_required" in result.intake_record), "intake must not require a full repository archive");
  assertResultHasNoReceiptOrReviewSideEffects(result);
  assertClaimSafe(result);
}

// C5-01: the mandatory demo-budget stop. An otherwise-valid submission must
// never be receipt-eligible at or above the 95% disable threshold, and a
// missing/malformed enforcement state must fail closed rather than defaulting
// to enabled.
async function testDemoBudgetEnforcement(intake) {
  const belowThreshold = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.demo_budget_enforcement = { spend_ratio: 0.9499 };
  }));
  assert(belowThreshold.state === "verified_receipt_eligible", "0.9499 spend ratio must remain below the disable threshold");

  await expectRejected(intake, mutate(async (request) => {
    request.demo_budget_enforcement = { spend_ratio: 0.95 };
  }), "demo_budget_intake_disabled");

  const atThreshold = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.demo_budget_enforcement = { spend_ratio: 0.95 };
  }));
  assert(atThreshold.intake_record === undefined, "budget-disabled submission must carry no intake record projection");
  assert(atThreshold.next_path === "contact_support", "budget-disabled rejection must not suggest an immediate retry");

  await expectRejected(intake, mutate(async (request) => {
    request.demo_budget_enforcement = { spend_ratio: 1.5 };
  }), "demo_budget_intake_disabled");

  for (const malformed of [
    undefined,
    null,
    {},
    { spend_ratio: "0.10" },
    { spend_ratio: Number.NaN },
    { spend_ratio: -0.1 },
    { spend_ratio: Number.POSITIVE_INFINITY }
  ]) {
    await expectRejected(intake, mutate(async (request) => {
      request.demo_budget_enforcement = malformed;
    }), "demo_budget_enforcement_invalid");
  }
}

async function testDecisionResolvedProtocolAuthority(intake) {
  const protocolValidManifestRef = "manifest_entry:protocol_valid_custom_ref";
  const accepted = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    artifact.manifest_entry_ref = protocolValidManifestRef;
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }));
  assert(accepted.state === "verified_receipt_eligible", "protocol-valid manifest_entry_ref pattern must not be rejected by an intake-specific artifact type map");

  const missingOutbound = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.submitted_bundle_manifest.artifact_references = request.submitted_bundle_manifest.artifact_references.filter((entry) => entry.artifact_type !== "outbound_manifest");
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }));
  assert(missingOutbound.state === "rejected_no_receipt", "missing required outbound_manifest artifact must fail before projection");
  assert(missingOutbound.reason_codes.includes("bundle_required_artifact_missing"), "missing required artifact must use protocol-required reason code");

  // C5-26: warning-order semantics must agree with `scripts/lib/protocol-utils.mjs`
  // and the Rust runner, which both require exact array order for displayed
  // consent -- a reordered (but set-equal) acknowledgement must now be
  // rejected, not silently accepted as it was when intake compared warnings
  // as an order-insensitive set.
  const reorderedWarnings = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.customer_approval.warnings_acknowledged = request.customer_approval.warnings_acknowledged.toReversed();
  }));
  assert(reorderedWarnings.state === "rejected_no_receipt", "reordered warning acknowledgements must now be rejected");
  assert(reorderedWarnings.reason_codes.includes("customer_approval_warnings_mismatch"), "reordered warnings must fail with the warnings-mismatch reason");

  const canonicalOrderWarnings = await intake.verifyIntakeSubmission(await mutate(async () => {}));
  assert(canonicalOrderWarnings.state === "verified_receipt_eligible", "warnings acknowledged in canonical displayed order must still be accepted");
}

async function testSchemaAndProtocolFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.runnerVersion = "camel-case field must fail schema validation";
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.protocol_version = "codeattest.v1";
  }), "protocol_version_invalid");

  await expectRejected(intake, mutate(async (request) => {
    delete request.submitted_bundle_manifest.artifact_references[0].source_derived_class;
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.artifact_references[0].content_path = "/tmp/host-local-source.json";
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    request.artifact_bytes_by_ref["artifact_ref:synthetic_raw_snippet"] = { bytes: "not a supported bytes input" };
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    const duplicate = structuredClone(request.submitted_bundle_manifest.artifact_references[0]);
    request.submitted_bundle_manifest.artifact_references.push(duplicate);
    request.artifact_bytes_by_ref[duplicate.artifact_ref] = request.artifact_bytes_by_ref[request.submitted_bundle_manifest.artifact_references[0].artifact_ref];
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "schema_validation_failed");
}

async function testIdentityApprovalAndSignatureFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.evidence_bundle_id = sha256Fixture("01");
    request.submission_token_expectation.expected_evidence_bundle_id = sha256Fixture("01");
  }), "evidence_bundle_identity_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.approved_outbound_manifest.manifest_id = sha256Fixture("02");
  }), "manifest_identity_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.decision = "declined";
  }), "customer_approval_not_approved");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.disclosure_warnings = ["same warning", "another warning"];
    request.customer_approval.warnings_acknowledged = ["same warning", "different warning"];
  }), "customer_approval_warnings_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.scanner_finding_set_ref = sha256Fixture("05");
  }), "scanner_finding_set_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    delete request.customer_approval;
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_envelope.signed_identity = sha256Fixture("03");
  }), "signature_signed_identity_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_envelope.key_id = "codeattest-local-runner-demo-key-other";
  }), "signature_key_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_envelope.key_version = "story-1.8-synthetic-demo-other";
  }), "signature_key_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_envelope.canonicalization = "not-rfc8785";
  }), "schema_validation_failed");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_envelope.signature_bytes = "tampered-signature-bytes";
  }), "signature_bytes_untrusted");

  // C5-03 / D3-2: signature bytes that are schema-shaped but wrong can no
  // longer be detected by intake itself -- it holds no key material. The
  // host-computed outcome is the only authority on the bytes, so the
  // equivalent failure is an outcome that says so, or one that is missing
  // entirely.
  await expectRejected(intake, mutate(async (request) => {
    request.signature_verification_outcome = { ...request.signature_verification_outcome, result: "signature_bytes_untrusted" };
  }), "signature_bytes_untrusted");

  await expectRejected(intake, mutate(async (request) => {
    delete request.signature_verification_outcome;
  }), "signature_bytes_untrusted");

  await expectRejected(intake, mutate(async (request) => {
    request.signature_verification_outcome = { ...request.signature_verification_outcome, signed_identity: sha256Fixture("ff") };
  }), "signature_bytes_untrusted");

  // D3-1: the manifest's declared `bundle_signing_mode` must equal the mode
  // the signature was actually made in.
  const unsupportedModeWithOtherDiagnostics = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.signature_envelope.signing_mode = "managed_key";
    request.signature_envelope.signed_identity = sha256Fixture("06");
  }));
  assert(unsupportedModeWithOtherDiagnostics.state === "quarantined_no_receipt", "unsupported signing mode must quarantine without receipt");
  assert(unsupportedModeWithOtherDiagnostics.reason_codes.includes("unsupported_signature_mode"), "unsupported signing mode reason must be preserved");
  assert(unsupportedModeWithOtherDiagnostics.reason_codes.includes("signature_signed_identity_mismatch"), "unsupported signing mode must not suppress remaining signature diagnostics");
}

async function testReviewScopedTokenFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    request.authenticated_context.customer_id = "customer:other";
  }), "review_scope_customer_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.authenticated_context.review_request_id = "review_request:other";
  }), "review_scope_request_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.authenticated_context.selected_application_id = "other-app";
  }), "review_scope_application_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.authenticated_context.selected_commit = "ffffffffffffffffffffffffffffffffffffffff";
  }), "review_scope_commit_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.authenticated_context.repository_identity_hash = sha256Fixture("04");
  }), "review_scope_repository_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submission_token.token_key_id = "runner-token:other";
  }), "review_scope_token_key_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submission_token.token_secret_material = "SUPER_SECRET_TOKEN_MATERIAL";
  }), "review_scope_token_material_mismatch");
}

// C5-25: `constantTimeStringEquals` used to force a mismatch for any token
// over a fixed 4096 UTF-16 unit window, so equal tokens longer than that
// were unconditionally rejected. Digest-based comparison must accept equal
// tokens of any length and still reject unequal ones.
async function testTokenComparisonBoundary(intake) {
  const oversizedToken = `${"token-material-".repeat(300)}shared-suffix`;
  assert(oversizedToken.length > 4096, "test token must exceed the old fixed comparison window");

  const acceptedWithOversizedEqualToken = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.submission_token.token_secret_material = oversizedToken;
    request.submission_token_expectation.token_secret_material = oversizedToken;
  }));
  assert(acceptedWithOversizedEqualToken.state === "verified_receipt_eligible", "equal tokens longer than 4096 units must still verify as matching");

  await expectRejected(intake, mutate(async (request) => {
    request.submission_token.token_secret_material = oversizedToken;
    request.submission_token_expectation.token_secret_material = `${oversizedToken}x`;
  }), "review_scope_token_material_mismatch");
}

async function testArtifactAndEnvironmentFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    request.artifact_bytes_by_ref["artifact_ref:synthetic_raw_snippet"] = "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE mutated bytes";
  }), "artifact_digest_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    artifact.size_bytes += 1;
  }), "artifact_size_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    artifact.artifact_type = "unsupported_artifact";
  }), "schema_validation_failed");

  await expectQuarantined(intake, mutate(async (request) => {
    request.environment_evidence_gate.allowed_source_derived_classes = ["never_collected", "retained_review_artifact"];
  }), "source_derived_class_not_allowed");


  await expectQuarantined(intake, mutate(async (request) => {
    request.environment_evidence_gate.environment_profile = "partner_pilot_candidate";
    request.environment_evidence_gate.evidence_boundary = "partner-pilot-candidate-no-real-source";
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    delete artifact.synthetic_markers;
    request.artifact_bytes_by_ref[artifact.artifact_ref] = "SIMULATED_REAL_CUSTOMER_SOURCE SENSITIVE_RAW_SNIPPET_MARKER";
  }), "synthetic_demo_source_marker_required");

  // C5-05: bundle cleanup semantics were never enforced at all -- a
  // source-derived artifact (transient_source_derived/customer_opt_in_retained_source)
  // with no matching `local_cleanup_intent` entry used to be receipt-eligible.
  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.local_cleanup_intent = [];
    resealBundleManifest(request);
  }), "source_derived_cleanup_intent_required");
}

function resealBundleManifest(request) {
  request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
  resealBundleSignature(request);
}

// D3-2: a real ML-DSA-65 signature cannot be recomputed from the identity it
// signs, so resealing means signing the new identity again with the test
// runner key and refreshing the outcome that authenticates those bytes.
function resealBundleSignature(request) {
  request.signature_envelope = realBundleSignatureFor(request.submitted_bundle_manifest.evidence_bundle_id);
  request.signature_verification_outcome = bundleSignatureOutcomeFor(request.signature_envelope);
  request.submission_token_expectation.expected_evidence_bundle_id = request.submitted_bundle_manifest.evidence_bundle_id;
}

// C5-04/C5-05: intake used to run identity/approval/semantic logic only over
// caller-supplied side-channel objects and never parsed the shipped control
// artifact bytes at all. Each case here reseals the evidence bundle (so the
// mutation isn't caught early by the pre-existing digest/identity checks)
// and proves the new parse/schema/semantic/equality layer is what actually
// rejects the request.
async function testShippedControlArtifactFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    replaceShippedArtifactBytes(request, "review_scope", Buffer.from("{not valid json"));
  }), "shipped_review_scope_invalid");

  await expectRejected(intake, mutate(async (request) => {
    replaceShippedArtifactBytes(request, "disclosure_policy", Buffer.from("{not valid json"));
  }), "shipped_disclosure_policy_invalid");

  await expectRejected(intake, mutate(async (request) => {
    replaceShippedArtifactBytes(request, "outbound_manifest", Buffer.from("{not valid json"));
  }), "shipped_outbound_manifest_invalid");

  await expectRejected(intake, mutate(async (request) => {
    // A self-consistent, independently valid outbound manifest (own identity
    // recomputed) that nonetheless is not byte-identical to the side-channel
    // `approved_outbound_manifest` intake was told was approved.
    const shipped = JSON.parse(JSON.stringify(request.approved_outbound_manifest));
    shipped.warnings = [...shipped.warnings, "an extra warning never shown to the approver"];
    shipped.manifest_id = canonicalIdentity(shipped, "manifest_id");
    replaceShippedArtifactBytes(request, "outbound_manifest", Buffer.from(JSON.stringify(shipped)));
  }), "shipped_outbound_manifest_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    replaceShippedArtifactBytes(request, "customer_approval", Buffer.from("{not valid json"));
  }), "shipped_customer_approval_invalid");

  await expectRejected(intake, mutate(async (request) => {
    // customer_approval has no content-derived identity (approval_id is an
    // opaque assigned string), so unlike outbound_manifest the shipped copy
    // stays schema/semantic-valid without recomputing anything -- it just
    // has to remain self-consistent while differing from the side channel.
    const shipped = JSON.parse(JSON.stringify(request.customer_approval));
    shipped.displayed_context.bundle_preview_summary = `${shipped.displayed_context.bundle_preview_summary} (resealed copy)`;
    replaceShippedArtifactBytes(request, "customer_approval", Buffer.from(JSON.stringify(shipped)));
  }), "shipped_customer_approval_mismatch");

  // C5-05: scanner_finding_set was schema-checked only -- a scanner run's
  // failure_reason contradicting its own status used to pass.
  await expectRejected(intake, mutate(async (request) => {
    const shipped = shippedScannerFindingSet(request);
    shipped.scanner_runs[0].status = "failed";
    replaceShippedArtifactBytes(request, "scanner_finding_set", Buffer.from(JSON.stringify(shipped)));
  }), "shipped_scanner_finding_set_invalid");

  // A candidate finding attributed to a scanner that never actually succeeded
  // used to pass too.
  await expectRejected(intake, mutate(async (request) => {
    const shipped = shippedScannerFindingSet(request);
    shipped.scanner_runs = shipped.scanner_runs.filter((run) => run.scanner_name !== "semgrep");
    shipped.candidate_findings = shipped.candidate_findings.filter((finding) => finding.source === "semgrep");
    assert(shipped.candidate_findings.length > 0, "fixture must still carry a semgrep candidate finding to prove the check is load-bearing");
    replaceShippedArtifactBytes(request, "scanner_finding_set", Buffer.from(JSON.stringify(shipped)));
  }), "shipped_scanner_finding_set_invalid");
}

function shippedScannerFindingSet(request) {
  const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_type === "scanner_finding_set");
  assert(artifact, "fixture bundle must reference a scanner_finding_set artifact");
  return JSON.parse(request.artifact_bytes_by_ref[artifact.artifact_ref].toString("utf8"));
}

function replaceShippedArtifactBytes(request, artifactType, bytes) {
  const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_type === artifactType);
  assert(artifact, `fixture bundle must reference a ${artifactType} artifact`);
  request.artifact_bytes_by_ref[artifact.artifact_ref] = bytes;
  artifact.digest = digestBytes(bytes);
  artifact.size_bytes = bytes.byteLength;
  resealBundleManifest(request);
}

async function testTraceMatrixSemanticFailures(intake) {
  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.selected_application.application_id = "other-app";
  }), "selected_application_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.selected_commit.commit_sha = "ffffffffffffffffffffffffffffffffffffffff";
  }), "selected_commit_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.repository_identity = sha256Fixture("07");
  }), "repository_identity_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.coverage_mode = "metadata_only";
  }), "coverage_mode_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.disclosure_policy_ref = sha256Fixture("08");
  }), "disclosure_policy_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.review_scope_ref = sha256Fixture("09");
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "bundle_review_scope_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.disclosure_policy_ref = sha256Fixture("0a");
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "bundle_disclosure_policy_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.coverage_mode = "metadata_only";
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "bundle_coverage_mode_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.scanner_finding_set_ref = sha256Fixture("0b");
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "bundle_scanner_finding_set_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.verification_metadata.approved_manifest_id = sha256Fixture("0c");
    request.submitted_bundle_manifest.evidence_bundle_id = canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
    resealBundleSignature(request);
  }), "bundle_approved_manifest_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submission_token_expectation.expected_manifest_id = sha256Fixture("0d");
  }), "review_scope_manifest_mismatch");

  await expectRejected(intake, mutate(async (request) => {
    request.submission_token_expectation.expected_evidence_bundle_id = sha256Fixture("0e");
  }), "review_scope_bundle_mismatch");

  // C5-13: approval-side application name is a separate required field from
  // application_id -- matching only the id let the accepted intake record
  // (sourced from the manifest, not the approval) silently diverge from the
  // name actually shown to the approver.
  await expectRejected(intake, mutate(async (request) => {
    request.customer_approval.displayed_context.selected_application.display_name = "A Different Displayed Name";
  }), "selected_application_mismatch");

  // C5-12: the displayed/acknowledged warning pair used to be bound only to
  // each other, never to the canonical manifest warnings they summarize -- a
  // caller could replace both arrays with harmless text while the manifest
  // retained materially different warnings and stay eligible.
  await expectRejected(intake, mutate(async (request) => {
    request.approved_outbound_manifest.warnings = [...request.approved_outbound_manifest.warnings, "a warning never shown to the approver"];
  }), "customer_approval_manifest_warnings_mismatch");
}

// C5-06/C5-07/C5-08/C5-09/C5-10/C5-11: the environment gate is no longer
// trusted as submitted, source-marker/readiness enforcement can no longer be
// waived by profile name alone, the artifact byte map must be exactly
// explained by declared refs, evidence-category inclusion must match the
// physical bundle for the four unambiguous categories, required control
// artifact types must be singletons, and every content-unsafe artifact type
// (not only raw_snippet/targeted_file) must pass the source-marker boundary.
async function testSourceSafetyAndInventoryBoundaries(intake) {
  // C5-07: a caller can no longer self-elevate by asserting the real-snippet
  // profile while quietly leaving readiness/acceptance flags at their
  // synthetic-demo values -- the gate must canonically match one of the two
  // published trusted configurations or the whole gate is untrusted.
  await expectQuarantined(intake, mutate(async (request) => {
    request.environment_evidence_gate.environment_profile = "partner_pilot_real_snippet_ready";
    request.environment_evidence_gate.readiness_decision_ref = sha256Fixture("0f");
  }), "environment_gate_untrusted");

  // C5-06: even for the untrusted gate above, the marker-enforcement layer
  // must independently keep firing -- it must never be the only thing
  // standing between a markerless real snippet and acceptance.
  await expectQuarantined(intake, mutate(async (request) => {
    request.environment_evidence_gate.environment_profile = "partner_pilot_real_snippet_ready";
    request.environment_evidence_gate.readiness_decision_ref = sha256Fixture("0f");
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    delete artifact.synthetic_markers;
    request.artifact_bytes_by_ref[artifact.artifact_ref] = "SIMULATED_REAL_CUSTOMER_SOURCE SENSITIVE_RAW_SNIPPET_MARKER";
  }), "synthetic_demo_source_marker_required");

  // Positive control: the fully trusted, fully-ready published gate must
  // still accept a real, markerless snippet whose per-type acceptance flag
  // is true -- readiness must reject bad states, not just any real content.
  {
    const request = await mutate(async (submissionRequest) => {
      submissionRequest.environment_evidence_gate = JSON.parse(await readFile(path.join(validFixtureRoot, "environment-evidence-gate.real-snippet-ready.json"), "utf8"));
      const artifact = submissionRequest.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
      delete artifact.synthetic_markers;
      const bytes = Buffer.from("real snippet bytes with no synthetic markers");
      submissionRequest.artifact_bytes_by_ref[artifact.artifact_ref] = bytes;
      artifact.digest = digestBytes(bytes);
      artifact.size_bytes = bytes.byteLength;
      resealBundleManifest(submissionRequest);
    });
    const result = await intake.verifyIntakeSubmission(request);
    assert(result.state === "verified_receipt_eligible", `trusted real-snippet-ready gate with an accepted real snippet must verify, got ${JSON.stringify(result)}`);
  }

  // C5-08: an unexplained extra byte-map key (never declared by any artifact
  // reference) must be rejected rather than silently ignored.
  await expectRejected(intake, mutate(async (request) => {
    request.artifact_bytes_by_ref["artifact_ref:undeclared_extra"] = "unexplained bytes";
  }), "artifact_bytes_unexplained_key");

  // C5-09: evidence-category inclusion must be reconciled against the
  // physical bundle, not merely agree with a second manifest that could
  // carry the same false claim.
  await expectRejected(intake, mutate(async (request) => {
    const category = request.approved_outbound_manifest.evidence_categories.find((entry) => entry.category === "raw_snippets");
    category.included = false;
  }), "evidence_category_unapproved_physical_artifact");

  await expectRejected(intake, mutate(async (request) => {
    request.submitted_bundle_manifest.artifact_references = request.submitted_bundle_manifest.artifact_references.filter(
      (entry) => entry.artifact_ref !== "artifact_ref:synthetic_raw_snippet"
    );
    request.submitted_bundle_manifest.local_cleanup_intent = request.submitted_bundle_manifest.local_cleanup_intent.filter(
      (entry) => entry.artifact_ref !== "artifact_ref:synthetic_raw_snippet"
    );
    resealBundleManifest(request);
  }), "evidence_category_physical_artifact_missing");

  // C5-10: a required control artifact type must appear exactly once --
  // distinct refs sharing the same required type used to pass a
  // presence-only check.
  await expectRejected(intake, mutate(async (request) => {
    const reviewScope = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_type === "review_scope");
    const duplicate = { ...reviewScope, artifact_ref: "artifact_ref:duplicate_review_scope" };
    request.submitted_bundle_manifest.artifact_references = [...request.submitted_bundle_manifest.artifact_references, duplicate];
    resealBundleManifest(request);
  }), "bundle_required_artifact_duplicated");

  // C5-11: source-safety enforcement is keyed on `artifact_type`, so every
  // content-unsafe type (not only raw_snippet/targeted_file) must be forced
  // through the same marker boundary -- real source bytes relabeled under
  // an artifact_type the old code never inspected must still be rejected.
  await expectQuarantined(intake, mutate(async (request) => {
    const artifact = request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
    artifact.artifact_type = "dependency_manifest";
    delete artifact.synthetic_markers;
    const bytes = Buffer.from("SIMULATED_REAL_CUSTOMER_SOURCE relabeled as a dependency manifest");
    request.artifact_bytes_by_ref[artifact.artifact_ref] = bytes;
    artifact.digest = digestBytes(bytes);
    artifact.size_bytes = bytes.byteLength;
    resealBundleManifest(request);
  }), "synthetic_demo_source_marker_required");
}

async function testNoReviewSideEffectsOrNetworkCalls(intake) {
  const source = await readFile(path.join(workspacePath, "src", "index.ts"), "utf8");
  for (const forbiddenModule of ["node:fs", "node:child_process", "node:net", "node:http", "node:https"]) {
    assert(!source.includes(forbiddenModule), `Story 2.2 intake verification must not import ${forbiddenModule}`);
  }

  const request = await createAcceptedRequest();
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = () => {
    networkCalled = true;
    throw new Error("network call is out of scope for Story 2.2 intake verification");
  };
  try {
    const result = await intake.verifyIntakeSubmission(request);
    assert(result.state === "verified_receipt_eligible", "verification must remain pure when network calls are blocked");
    assert(networkCalled === false, "intake verification must not create network calls");
    assertResultHasNoReceiptOrReviewSideEffects(result);
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }
}

async function testLeakSafeFailureOutput(intake) {
  const result = await intake.verifyIntakeSubmission(await mutate(async (request) => {
    request.submission_token.token_secret_material = "SUPER_SECRET_TOKEN_MATERIAL";
    request.artifact_bytes_by_ref["artifact_ref:synthetic_raw_snippet"] = "SIMULATED_REAL_CUSTOMER_SOURCE SENSITIVE_RAW_SNIPPET_MARKER";
  }));
  assert(result.state !== "verified_receipt_eligible", "sensitive marker mutation must fail verification");
  assertResultHasNoReceiptOrReviewSideEffects(result);
  assertClaimSafe(result);
}

// C5-46: focused representation, signature-limitation, and malformed-input
// matrices the happy-path Buffer-shaped fixtures never exercised.
async function testFocusedEdgeAndRepresentationMatrices(intake) {
  // Representation equivalence: ArrayBuffer and a nonzero-offset Uint8Array
  // view over the same bytes must digest identically to a plain Buffer.
  for (const [label, transform] of [
    ["ArrayBuffer", (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
    ["nonzero-offset Uint8Array", (bytes) => {
      const padded = new Uint8Array(bytes.byteLength + 5);
      padded.set(bytes, 5);
      return padded.subarray(5);
    }]
  ]) {
    const request = await mutate(async (nextRequest) => {
      const artifact = nextRequest.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
      nextRequest.artifact_bytes_by_ref[artifact.artifact_ref] = transform(nextRequest.artifact_bytes_by_ref[artifact.artifact_ref]);
    });
    const result = await intake.verifyIntakeSubmission(request);
    assert(result.state === "verified_receipt_eligible", `${label} artifact bytes must digest identically to the canonical Buffer representation; got ${JSON.stringify(result)}`);
  }

  // Each required signing_limitations substring, removed independently.
  // D3-1: the two things a real signature's limitations must still state --
  // whose custody the key is under, and what the signature cannot attest to.
  for (const requiredSubstring of ["runner custody", "cannot attest"]) {
    const request = await mutate(async (nextRequest) => {
      nextRequest.signature_envelope.signing_limitations = nextRequest.signature_envelope.signing_limitations.filter(
        (limitation) => !limitation.toLowerCase().includes(requiredSubstring)
      );
    });
    assert(
      (await intake.verifyIntakeSubmission(request)).reason_codes.includes("signature_limitations_missing"),
      `removing the required "${requiredSubstring}" signature limitation must be rejected`
    );
  }

  // Malformed top-level verifyIntakeSubmission input must not throw.
  for (const malformed of [undefined, null, "not-json-object", [], 42, {}]) {
    let result;
    try {
      result = await intake.verifyIntakeSubmission(malformed);
    } catch (error) {
      assert(false, `verifyIntakeSubmission must not throw on malformed top-level input; threw ${error}`);
    }
    assert(result.state !== "verified_receipt_eligible", "malformed top-level input must never verify");
  }
}

async function expectRejected(intake, request, expectedReason) {
  const result = await intake.verifyIntakeSubmission(await request);
  assert(result.state === "rejected_no_receipt", `expected rejected_no_receipt for ${expectedReason}, got ${result.state}`);
  assert(result.reason_codes.includes(expectedReason), `expected reason code ${expectedReason}; got ${result.reason_codes.join(", ")}`);
  assert(result.intake_record === undefined, "failed verification must not include intake record projection");
  assertResultHasNoReceiptOrReviewSideEffects(result);
  assertClaimSafe(result);
}

async function expectQuarantined(intake, request, expectedReason) {
  const result = await intake.verifyIntakeSubmission(await request);
  assert(result.state === "quarantined_no_receipt", `expected quarantined_no_receipt for ${expectedReason}, got ${result.state}`);
  assert(result.reason_codes.includes(expectedReason), `expected reason code ${expectedReason}; got ${result.reason_codes.join(", ")}`);
  assert(result.intake_record === undefined, "quarantined verification must not include intake record projection");
  assertResultHasNoReceiptOrReviewSideEffects(result);
  assertClaimSafe(result);
}

function assertResultHasNoReceiptOrReviewSideEffects(result) {
  const keys = [];
  visit(result, (key) => keys.push(key));
  for (const key of keys) {
    assert(!FORBIDDEN_RESULT_KEYS.has(key), `Story 2.2 result must not contain out-of-scope key: ${key}`);
  }
}

function assertClaimSafe(result) {
  const serialized = JSON.stringify(result);
  for (const pattern of FORBIDDEN_COPY) {
    assert(!pattern.test(serialized), `result leaks forbidden or overclaiming copy: ${pattern}`);
  }
}

function visit(value, callback) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, callback);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    callback(key);
    visit(child, callback);
  }
}

async function mutate(mutator) {
  const request = await createAcceptedRequest();
  await mutator(request);
  return request;
}

async function createAcceptedRequest() {
  const submittedBundleManifest = await readFixtureJson("bundle-manifest.json");
  const approvedOutboundManifest = await readFixtureJson("outbound-manifest.json");
  const customerApproval = await readFixtureJson("customer-approval.approved.json");
  const environmentEvidenceGate = await readFixtureJson("environment-evidence-gate.synthetic-demo.json");
  submittedBundleManifest.runner.version = approvedOutboundManifest.runner.version;
  const expectedManifestId = canonicalIdentity(approvedOutboundManifest, "manifest_id");
  assert(approvedOutboundManifest.manifest_id === expectedManifestId, "accepted fixture outbound manifest_id must match canonical identity");
  customerApproval.manifest_id = approvedOutboundManifest.manifest_id;
  customerApproval.displayed_context.manifest_id = approvedOutboundManifest.manifest_id;
  submittedBundleManifest.manifest_id = approvedOutboundManifest.manifest_id;
  submittedBundleManifest.verification_metadata.approved_manifest_id = approvedOutboundManifest.manifest_id;
  const artifactBytesByRef = {};

  for (const artifact of submittedBundleManifest.artifact_references) {
    if (typeof artifact.content_path === "string") {
      const bytes = await readFile(path.join(fixtureRoot, artifact.content_path));
      artifactBytesByRef[artifact.artifact_ref] = bytes;
      artifact.digest = digestBytes(bytes);
      artifact.size_bytes = bytes.byteLength;
    }
  }
  submittedBundleManifest.evidence_bundle_id = canonicalIdentity(submittedBundleManifest, "evidence_bundle_id");
  // D3-2: the committed bundle signature signs the committed manifest; this
  // request recomputes the bundle identity from the fixture bytes on disk, so
  // the envelope is re-signed over that recomputed identity and paired with
  // the outcome that authenticates its bytes.
  const signatureEnvelope = realBundleSignatureFor(submittedBundleManifest.evidence_bundle_id);

  return {
    submitted_bundle_manifest: submittedBundleManifest,
    signature_envelope: signatureEnvelope,
    signature_verification_outcome: bundleSignatureOutcomeFor(signatureEnvelope),
    artifact_bytes_by_ref: artifactBytesByRef,
    customer_approval: customerApproval,
    approved_outbound_manifest: approvedOutboundManifest,
    environment_evidence_gate: environmentEvidenceGate,
    demo_budget_enforcement: { spend_ratio: 0.1 },
    authenticated_context: {
      customer_id: "customer:synthetic-demo",
      review_request_id: "review_request:synthetic-demo",
      selected_application_id: approvedOutboundManifest.selected_scope_summary.selected_application.application_id,
      selected_commit: approvedOutboundManifest.selected_scope_summary.selected_commit.commit_sha,
      repository_identity_hash: approvedOutboundManifest.selected_scope_summary.repository_identity
    },
    submission_token: {
      token_key_id: "runner-token:synthetic-demo",
      token_secret_material: "synthetic-token-secret"
    },
    submission_token_expectation: {
      customer_id: "customer:synthetic-demo",
      review_request_id: "review_request:synthetic-demo",
      selected_application_id: approvedOutboundManifest.selected_scope_summary.selected_application.application_id,
      selected_commit: approvedOutboundManifest.selected_scope_summary.selected_commit.commit_sha,
      repository_identity_hash: approvedOutboundManifest.selected_scope_summary.repository_identity,
      expected_manifest_id: approvedOutboundManifest.manifest_id,
      expected_evidence_bundle_id: submittedBundleManifest.evidence_bundle_id,
      token_key_id: "runner-token:synthetic-demo",
      token_secret_material: "synthetic-token-secret"
    }
  };
}

async function readFixtureJson(fileName) {
  return JSON.parse(await readFile(path.join(validFixtureRoot, fileName), "utf8"));
}

function sha256Fixture(hexByte) {
  return `sha256:${hexByte.repeat(64).slice(0, 64)}`;
}

function canonicalIdentity(value, excludedField) {
  const identityInput = JSON.parse(JSON.stringify(value));
  delete identityInput[excludedField];
  const canonical = canonicalizeJson(identityInput);
  return digestBytes(canonical);
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
