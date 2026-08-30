import canonicalizeJson from "canonicalize";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mintVendorReceipt, passingReceiptRequest, receiptOutcomeFor, receiptTimestamp } from "./helpers/receipt-fixtures.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-vendor-receipt-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "intake-service-test-dist");

const FORBIDDEN_NO_RECEIPT_KEYS = new Set([
  "vendor_receipt_id",
  "vendor_receipt",
  "receipt_timestamp",
  "receipt_signature",
  "receipt_verification_metadata",
  "public_verification_metadata",
  "receipt_summary",
  "received_with_receipt"
]);

const FORBIDDEN_OUTPUT_PATTERNS = [
  /submission successful/i,
  /upload successful/i,
  /\baccepted\b/i,
  /\breviewed\b/i,
  /certified/i,
  /no vulnerabilities/i,
  /SUPER_SECRET_TOKEN_MATERIAL/,
  /SIMULATED_REAL_CUSTOMER_SOURCE/,
  /SENSITIVE_RAW_SNIPPET_MARKER/,
  /PRIVATE_KEY_MATERIAL/
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
    "prepareVendorReceipt",
    "completeVendorReceipt",
    "verifyVendorReceiptRecord",
    "verifyIntakeSubmission",
    "workspaceName"
  ];
  for (const exportName of requiredExports) {
    assert(exportName in intake, `missing public export: ${exportName}`);
  }

  await testAcceptedReceiptPath(intake);
  await testDeterministicReceiptIdentity(intake);
  await testArtifactCountsDerivedAndVerifiedInService(intake);
  await testUtcRfc3339AcceptedForms(intake);
  await testReceiptChronology(intake);
  await testAtomicVerificationReplacesTwoPhaseTrust(intake);
  await testAtomicVerificationCatchesTamperedIntakeContext(intake);
  await testRejectedAndQuarantinedInputsIssueNoReceipt(intake);
  await testSigningAndVerificationFailures(intake);
  await testVerifierFailsClosedOnSchemaInvalidReceipt(intake);
  await testGenerateFailsClosedOnMalformedCallerContext(intake);
  await testIdentityOnlyReceiptTamperIsRejected(intake);
  await testNoSideEffectsAndLeakSafety(intake);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

async function testAcceptedReceiptPath(intake) {
  const request = await passingReceiptRequest();
  const result = await mintVendorReceipt(intake, request);

  assert(result.state === "received_with_receipt", `accepted synthetic request must issue a received_with_receipt result, got ${JSON.stringify(result)}`);
  assert(result.vendor_receipt, "success result must include Vendor Receipt record");
  assert(result.vendor_receipt.vendor_receipt_id.startsWith("sha256:"), "receipt id must be algorithm-prefixed sha256");
  assert(result.vendor_receipt.evidence_bundle_id === request.intake_verification_request.submitted_bundle_manifest.evidence_bundle_id, "receipt must preserve evidence_bundle_id");
  assert(result.vendor_receipt.manifest_id === request.intake_verification_request.approved_outbound_manifest.manifest_id, "receipt must preserve manifest_id");
  assert(result.vendor_receipt.receipt_timestamp === receiptTimestamp, "receipt timestamp must use caller-provided UTC timestamp");
  assert(result.vendor_receipt.verification_state === "received_with_receipt", "receipt record must carry received_with_receipt state");
  assert(result.vendor_receipt.receiving_environment.environment_profile === "synthetic_demo", "receiving environment must be derived from the trusted gate, not a separate caller field");
  assert(result.receipt_signature.signed_identity_type === "vendor_receipt", "signature must sign typed Vendor Receipt identity");
  assert(result.receipt_signature.signed_identity === result.vendor_receipt.vendor_receipt_id, "signature signed identity must equal receipt id");
  assert(result.receipt_signature.key_id === request.signing.key_id, "signature key id must be explicit");
  assert(result.receipt_signature.key_version === request.signing.key_version, "signature key version must be explicit");
  assert(result.public_verification_metadata.key_id === request.signing.key_id, "public metadata must preserve key id");
  assert(result.public_verification_metadata.key_version === request.signing.key_version, "public metadata must preserve key version");
  assert(result.approved_vs_received_comparison.comparison_state === "matched", "comparison must be matched");
  assert(result.approved_vs_received_comparison.rows.length >= 7, "comparison rows must cover required fields");
  assert(result.receipt_summary.plain_language_summary === `CodeAttest received bundle ${result.vendor_receipt.evidence_bundle_id} at ${receiptTimestamp} under Vendor Receipt ${result.vendor_receipt.vendor_receipt_id}.`, "summary must state bounded receipt fact");
  assert(result.receipt_summary.copyable_identifiers.some((item) => item.label === "Vendor Receipt" && item.value === result.vendor_receipt.vendor_receipt_id), "summary must expose copyable receipt id");
  assert(result.receipt_summary.technical_details.some((item) => item.label === "Canonicalization" && item.value === "rfc8785"), "summary must expose canonicalization");
  assert(result.receipt_summary.accessibility.role === "status", "summary view must expose status role metadata");
  assert(result.receipt_summary.accessibility.min_target_size_px === 44, "summary view must preserve 44px target-size metadata");
  assertClaimSafe(result);

  const verification = await verifyReceipt(intake, result.vendor_receipt);
  assert(verification.state === "receipt_verified", `fresh generated receipt must verify; got ${JSON.stringify(verification)}`);
}

async function testDeterministicReceiptIdentity(intake) {
  const request = await passingReceiptRequest();
  const first = await mintVendorReceipt(intake, request);
  const second = await mintVendorReceipt(intake, structuredClone(request));
  assert(first.state === "received_with_receipt" && second.state === "received_with_receipt", "deterministic identity test requires two receipts");
  assert(first.vendor_receipt.vendor_receipt_id === second.vendor_receipt.vendor_receipt_id, "same request inputs must produce same receipt id");
  // D3-2: a real ML-DSA-65 signature is randomized, so the *identity* is what
  // has to be deterministic -- the bytes must not be, and must never be
  // recomputable from the receipt they sign.
  assert(first.receipt_signature.signature_bytes !== second.receipt_signature.signature_bytes, "real signature bytes must not be reproducible from the receipt alone");
  assert(/^ml_dsa_65:[A-Za-z0-9_-]{4412}$/u.test(first.receipt_signature.signature_bytes), "receipt signature must be a real ML-DSA-65 signature");
  assert(first.vendor_receipt.vendor_receipt_id === canonicalReceiptIdentity(first.vendor_receipt), "receipt id must equal canonical identity excluding self/signature/repeated signed identity");

  const changed = await passingReceiptRequest();
  changed.signing.key_version = "story-2.3-synthetic-demo-rotated";
  const changedResult = await mintVendorReceipt(intake, changed);
  assert(changedResult.state === "received_with_receipt", "changed key version should still be receipt-eligible");
  assert(changedResult.vendor_receipt.vendor_receipt_id !== first.vendor_receipt.vendor_receipt_id, "changing signed/key metadata must change receipt identity");
}

async function testArtifactCountsDerivedAndVerifiedInService(intake) {
  const callerSuppliedLie = await passingReceiptRequest();
  callerSuppliedLie.approved_artifact_count_summary = structuredClone(callerSuppliedLie.approved_artifact_count_summary);
  callerSuppliedLie.approved_artifact_count_summary.categories = callerSuppliedLie.approved_artifact_count_summary.categories.map((category) => ({
    category: category.category,
    count: 0
  }));
  callerSuppliedLie.approved_artifact_count_summary.total_count = 0;
  callerSuppliedLie.received_artifact_count_summary = structuredClone(callerSuppliedLie.approved_artifact_count_summary);
  const lieResult = await mintVendorReceipt(intake, callerSuppliedLie);
  assert(lieResult.state === "rejected_no_receipt", "caller-supplied artifact summaries that do not match the approved manifest must be rejected");
  assert(lieResult.reason_codes.includes("receipt_artifact_count_mismatch"), `derived artifact mismatch must be explicit; got ${lieResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(lieResult);

  const missingSummaries = await passingReceiptRequest();
  delete missingSummaries.approved_artifact_count_summary;
  delete missingSummaries.received_artifact_count_summary;
  const derivedResult = await mintVendorReceipt(intake, missingSummaries);
  assert(derivedResult.state === "received_with_receipt", "service must derive the artifact count summary from the approved manifest when caller summaries are omitted");
  assert(derivedResult.vendor_receipt.approved_artifact_count_summary.total_count === 16, "derived approved summary must use manifest evidence category counts");
  assert(derivedResult.vendor_receipt.received_artifact_count_summary.total_count === 16, "derived received summary must equal the same authoritative count, by construction");

  for (const [expectedReason, mutate] of [
    ["artifact_count_not_provable", (request) => { request.approved_artifact_count_summary = null; request.received_artifact_count_summary = null; }],
    ["artifact_count_not_provable", (request) => { request.approved_artifact_count_summary = { total_count: 16, categories: [] }; }],
    ["artifact_count_not_provable", (request) => { request.approved_artifact_count_summary.total_count = 999; request.received_artifact_count_summary.total_count = 999; }],
    ["artifact_count_not_provable", (request) => { request.approved_artifact_count_summary.categories.push({ category: "metadata", count: 0 }); request.received_artifact_count_summary.categories.push({ category: "metadata", count: 0 }); }]
  ]) {
    const request = await passingReceiptRequest();
    mutate(request);
    const result = await mintVendorReceipt(intake, request);
    assert(result.state === "rejected_no_receipt", `${expectedReason} artifact summary case must reject without receipt`);
    assert(result.reason_codes.includes(expectedReason), `${expectedReason} must be present; got ${result.reason_codes.join(", ")}`);
    assertNoReceiptFields(result);
  }
}

async function testUtcRfc3339AcceptedForms(intake) {
  for (const timestamp of ["2026-07-10T00:20:00.123Z", "2026-07-10T00:20:00.123456789Z", "2026-07-10T00:20:00+00:00"]) {
    const request = await passingReceiptRequest();
    request.receipt_timestamp = timestamp;
    const result = await mintVendorReceipt(intake, request);
    assert(result.state === "received_with_receipt", `UTC RFC 3339 timestamp ${timestamp} must issue a receipt; got ${JSON.stringify(result)}`);
    assert(result.vendor_receipt.receipt_timestamp === timestamp, "receipt must preserve caller timestamp text");
    assert(result.receipt_signature.signing_time === timestamp, "signing time must preserve caller timestamp text");
  }
}

// C5-15: a receipt must not predate the manifest it receipts, the approval
// that authorized it, or the bundle it was minted from -- only lexical/shape
// timestamp validity was checked before.
async function testReceiptChronology(intake) {
  const beforeManifest = await passingReceiptRequest();
  beforeManifest.receipt_timestamp = "2020-01-01T00:00:00Z";
  const beforeManifestResult = await mintVendorReceipt(intake, beforeManifest);
  assert(beforeManifestResult.state === "rejected_no_receipt", "a receipt timestamp far before every prerequisite must reject");
  assert(beforeManifestResult.reason_codes.includes("receipt_timestamp_precedes_prerequisite"), `expected receipt_timestamp_precedes_prerequisite; got ${beforeManifestResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(beforeManifestResult);

  const beforeBundle = await passingReceiptRequest();
  // bundle-manifest.json created_at is 2026-07-10T00:15:00Z; the approved
  // outbound manifest and customer approval both precede that, so this is
  // exactly one nanosecond before only the latest prerequisite.
  beforeBundle.receipt_timestamp = "2026-07-10T00:14:59.999999999Z";
  const beforeBundleResult = await mintVendorReceipt(intake, beforeBundle);
  assert(beforeBundleResult.state === "rejected_no_receipt", "a receipt timestamp one nanosecond before the latest prerequisite must reject");
  assert(beforeBundleResult.reason_codes.includes("receipt_timestamp_precedes_prerequisite"), `expected receipt_timestamp_precedes_prerequisite; got ${beforeBundleResult.reason_codes.join(", ")}`);

  const exactlyAtBundle = await passingReceiptRequest();
  exactlyAtBundle.receipt_timestamp = "2026-07-10T00:15:00Z";
  const exactlyAtBundleResult = await mintVendorReceipt(intake, exactlyAtBundle);
  assert(exactlyAtBundleResult.state === "received_with_receipt", "a receipt timestamp exactly equal to the latest prerequisite must be accepted");
}

// C5-02: `mintVendorReceipt` now performs its own full intake
// verification from the untrusted request on every call -- there is no
// longer a `verified_intake_result` field a caller can forge, and no window
// between a legitimate verification and minting for caller-owned objects to
// be mutated, because both now happen inside one call over one clone.
async function testAtomicVerificationReplacesTwoPhaseTrust(intake) {
  // A caller cannot smuggle a self-consistent "already verified" claim
  // alongside a request whose real intake data would fail verification --
  // there is no `verified_intake_result` field for `mintVendorReceipt`
  // to trust in the first place; real verification runs unconditionally.
  const forged = await passingReceiptRequest();
  forged.intake_verification_request.demo_budget_enforcement = { spend_ratio: 0.99 };
  forged.verified_intake_result = {
    state: "verified_receipt_eligible",
    reason_codes: [],
    verification_summary: "verification_passed_receipt_eligible",
    intake_record: {
      projection_state: "verified_receipt_eligible",
      approved_outbound_manifest_ref: "artifact_ref:outbound_manifest",
      manifest_id: forged.intake_verification_request.approved_outbound_manifest.manifest_id,
      evidence_bundle_id: forged.intake_verification_request.submitted_bundle_manifest.evidence_bundle_id
    },
    next_path: "generate_receipt_in_story_2_3"
  };
  const forgedResult = await mintVendorReceipt(intake, forged);
  assert(forgedResult.state === "rejected_no_receipt", "a forged verified_intake_result alongside a budget-disabled request must not bypass real verification");
  assert(forgedResult.reason_codes.includes("demo_budget_intake_disabled"), `real verification must still run and reject; got ${forgedResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(forgedResult);

  // The clone happens synchronously before the first `await`, so mutating
  // the caller's own object immediately after invocation (before the
  // returned promise settles) must not affect the in-flight result.
  const request = await passingReceiptRequest();
  const resultPromise = mintVendorReceipt(intake, request);
  request.intake_verification_request.approved_outbound_manifest.manifest_id = `sha256:${"f".repeat(64)}`;
  request.receipt_timestamp = "1970-01-01T00:00:00Z";
  const result = await resultPromise;
  assert(result.state === "received_with_receipt", "post-invocation mutation of the caller's own object must not affect an in-flight receipt generation");
  assert(result.vendor_receipt.manifest_id !== `sha256:${"f".repeat(64)}`, "the post-invocation mutation must not have leaked into the minted receipt");
}

// C5-02: every one of these mutations used to be checked a second time,
// redundantly, inside receipt generation's own preflight -- now that
// `mintVendorReceipt` re-runs full intake verification on every call,
// they are caught there first (earlier, with intake's own more specific
// reason codes) and receipt generation never even reaches its old
// duplicate checks.
async function testAtomicVerificationCatchesTamperedIntakeContext(intake) {
  const cases = [
    ["manifest_identity_mismatch", (request) => {
      request.intake_verification_request.approved_outbound_manifest.manifest_id = sha256Fixture("01");
    }],
    ["evidence_bundle_identity_mismatch", (request) => {
      request.intake_verification_request.submitted_bundle_manifest.evidence_bundle_id = sha256Fixture("02");
    }],
    ["manifest_identity_mismatch", (request) => {
      request.intake_verification_request.approved_outbound_manifest.selected_scope_summary.selected_commit.commit_sha = "ffffffffffffffffffffffffffffffffffffffff";
    }],
    ["manifest_identity_mismatch", (request) => {
      request.intake_verification_request.approved_outbound_manifest.selected_scope_summary.repository_identity = sha256Fixture("03");
    }],
    ["manifest_identity_mismatch", (request) => {
      request.intake_verification_request.approved_outbound_manifest.coverage_mode = "metadata_only";
    }],
    ["manifest_identity_mismatch", (request) => {
      request.intake_verification_request.approved_outbound_manifest.disclosure_policy_summary.redaction_configuration_version = "other-redaction-v0";
    }],
    ["artifact_bytes_missing", (request) => {
      const outboundArtifact = request.intake_verification_request.submitted_bundle_manifest.artifact_references.find((artifact) => artifact.artifact_type === "outbound_manifest");
      assert(outboundArtifact, "fixture must include outbound manifest artifact reference");
      delete request.intake_verification_request.artifact_bytes_by_ref[outboundArtifact.artifact_ref];
    }]
  ];

  for (const [expectedReason, mutate] of cases) {
    const request = await passingReceiptRequest();
    mutate(request);
    const result = await mintVendorReceipt(intake, request);
    assert(result.state === "rejected_no_receipt" || result.state === "quarantined_no_receipt", `${expectedReason} must not issue a receipt; got ${result.state}`);
    assert(result.reason_codes.includes("intake_not_receipt_eligible"), `${expectedReason} must be caught by real intake verification; got ${result.reason_codes.join(", ")}`);
    assert(result.reason_codes.includes(expectedReason), `${expectedReason} must be present; got ${result.reason_codes.join(", ")}`);
    assertNoReceiptFields(result);
    assertClaimSafe(result);
  }

  // The one receipt-level (not intake-level) mismatch that still applies:
  // a caller-supplied received_artifact_count_summary that disagrees with
  // the authoritative one derived from the (now verification-guaranteed
  // authentic) approved manifest.
  const receiptLevelMismatch = await passingReceiptRequest();
  receiptLevelMismatch.received_artifact_count_summary.total_count += 1;
  receiptLevelMismatch.received_artifact_count_summary.categories[0].count += 1;
  const receiptLevelResult = await mintVendorReceipt(intake, receiptLevelMismatch);
  assert(receiptLevelResult.state === "rejected_no_receipt", "receipt-level artifact count mismatch must reject without receipt");
  assert(receiptLevelResult.reason_codes.includes("receipt_artifact_count_mismatch"), `expected receipt_artifact_count_mismatch; got ${receiptLevelResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(receiptLevelResult);
}

// C5-02: there is no longer a `verified_intake_result` field to set directly
// to a failed state -- the only way to reach `rejected_no_receipt`/
// `quarantined_no_receipt` now is for real intake verification to actually
// produce that state from the underlying request.
async function testRejectedAndQuarantinedInputsIssueNoReceipt(intake) {
  const rejectedRequest = await passingReceiptRequest();
  rejectedRequest.intake_verification_request.demo_budget_enforcement = { spend_ratio: 0.99 };
  const rejectedResult = await mintVendorReceipt(intake, rejectedRequest);
  assert(rejectedResult.state === "rejected_no_receipt", `budget-disabled intake must preserve rejected_no_receipt; got ${rejectedResult.state}`);
  assert(rejectedResult.reason_codes.includes("intake_not_receipt_eligible"), "non-eligible intake must be explicit");
  assert(rejectedResult.reason_codes.includes("demo_budget_intake_disabled"), `expected demo_budget_intake_disabled; got ${rejectedResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(rejectedResult);
  assertClaimSafe(rejectedResult);

  const quarantinedRequest = await passingReceiptRequest();
  const artifact = quarantinedRequest.intake_verification_request.submitted_bundle_manifest.artifact_references.find((entry) => entry.artifact_ref === "artifact_ref:synthetic_raw_snippet");
  delete artifact.synthetic_markers;
  quarantinedRequest.intake_verification_request.artifact_bytes_by_ref[artifact.artifact_ref] = "SIMULATED_REAL_CUSTOMER_SOURCE SENSITIVE_RAW_SNIPPET_MARKER";
  const quarantinedResult = await mintVendorReceipt(intake, quarantinedRequest);
  assert(quarantinedResult.state === "quarantined_no_receipt", `markerless source must preserve quarantined_no_receipt; got ${quarantinedResult.state}`);
  assert(quarantinedResult.reason_codes.includes("intake_not_receipt_eligible"), "non-eligible intake must be explicit");
  assert(quarantinedResult.reason_codes.includes("synthetic_demo_source_marker_required"), `expected synthetic_demo_source_marker_required; got ${quarantinedResult.reason_codes.join(", ")}`);
  assertNoReceiptFields(quarantinedResult);
  assertClaimSafe(quarantinedResult);
}

async function testSigningAndVerificationFailures(intake) {
  for (const [expectedReason, mutate] of [
    ["receipt_signing_key_metadata_missing", (request) => { request.signing.key_id = ""; }],
    ["receipt_signing_key_metadata_missing", (request) => { request.signing.key_id = null; }],
    ["receipt_signing_key_metadata_missing", (request) => { delete request.signing; }],
    ["receipt_signing_key_metadata_missing", (request) => { delete request.signing.key_version; }],
    ["receipt_signing_mode_unsupported", (request) => { request.signing.signing_mode = "production_kms"; }],
    ["receipt_timestamp_invalid", (request) => { request.receipt_timestamp = "2026-13-10T00:20:00Z"; }],
    ["receipt_timestamp_invalid", (request) => { request.receipt_timestamp = "2026-07-10T00:20:00+10:00"; }],
    ["receipt_canonicalization_unsupported", (request) => { request.signing.canonicalization = "not-rfc8785"; }]
  ]) {
    const request = await passingReceiptRequest();
    mutate(request);
    const result = await mintVendorReceipt(intake, request);
    assert(result.state === "rejected_no_receipt", `${expectedReason} must reject without receipt`);
    assert(result.reason_codes.includes(expectedReason), `${expectedReason} must be present; got ${result.reason_codes.join(", ")}`);
    assertNoReceiptFields(result);
  }

  const valid = await mintVendorReceipt(intake, await passingReceiptRequest());
  assert(valid.state === "received_with_receipt", "tamper tests need a valid receipt");

  for (const [expectedReason, mutate] of [
    ["vendor_receipt_signature_identity_type", (receipt) => { receipt.receipt_signature.signed_identity_type = "evidence_bundle"; }],
    ["signature_signed_identity_mismatch", (receipt) => { receipt.receipt_signature.signed_identity = sha256Fixture("04"); }],
    // D3-1: signature bytes that are not a real ML-DSA-65 signature no
    // longer merely fail a bespoke trust rule -- the schema rejects the shape.
    ["receipt_schema_validation_failed", (receipt) => { receipt.receipt_signature.signature_bytes = "tampered-signature"; }],
    ["receipt_key_metadata_required", (receipt) => { delete receipt.public_verification_metadata.key_version; }],
    ["receipt_canonicalization_unsupported", (receipt) => { receipt.receipt_signature.canonicalization = "not-rfc8785"; }],
    // C5-14: signature and public metadata must agree on signing_mode and
    // signing_limitations, not just key_id/key_version/signing_time.
    ["receipt_key_metadata_required", (receipt) => { receipt.public_verification_metadata.signing_mode = "enrolled_runner_key"; }],
    ["receipt_key_metadata_required", (receipt) => { receipt.public_verification_metadata.signing_limitations = [...receipt.public_verification_metadata.signing_limitations, "an additional unacknowledged limitation"]; }],
    ["receipt_approved_received_mismatch", (receipt) => {
      const row = receipt.approved_vs_received_comparison.rows.find((entry) => entry.field === "manifest_id");
      assert(row, "fixture receipt must include manifest_id comparison row");
      row.received_value = sha256Fixture("05");
    }],
    ["receipt_approved_received_mismatch", (receipt) => {
      const row = receipt.approved_vs_received_comparison.rows.find((entry) => entry.field === "disclosure_policy_summary");
      assert(row, "fixture receipt must include disclosure policy comparison row");
      row.approved_value = `${receipt.disclosure_policy_ref}:${receipt.coverage_mode}:other-redaction-v0`;
      row.received_value = `${receipt.disclosure_policy_ref}:${receipt.coverage_mode}:other-redaction-v0`;
    }],
    // C5-14: the top-level disclosure_policy_ref must agree with the nested
    // disclosure_policy_summary.disclosure_policy_ref it summarizes -- a
    // receipt cannot report one policy at the top level and describe another
    // in its summary/comparison row.
    ["receipt_approved_received_mismatch", (receipt) => { receipt.disclosure_policy_ref = sha256Fixture("07"); }],
    // C5-14: the comparison row set must be exactly the seven known fields,
    // each once -- a resealed receipt that keeps all seven required rows but
    // *adds* a duplicate or unknown eighth row must still fail. The schema's
    // `maxItems: 7` rejects this shape on its own, but the semantic check
    // must independently reject it too (verified by disabling each layer in
    // isolation): a last-write-wins map read only the seven known keys back
    // and never noticed the extra row.
    ["receipt_approved_received_mismatch", (receipt) => {
      const rows = receipt.approved_vs_received_comparison.rows;
      const manifestRow = rows.find((entry) => entry.field === "manifest_id");
      assert(manifestRow, "fixture receipt must include a manifest_id comparison row");
      rows.push({ ...manifestRow });
    }],
    ["receipt_approved_received_mismatch", (receipt) => {
      const rows = receipt.approved_vs_received_comparison.rows;
      rows.push({ field: "unexpected_field", approved_value: "same-value", received_value: "same-value", result: "matched" });
    }]
  ]) {
    const receipt = structuredClone(valid.vendor_receipt);
    mutate(receipt);
    const verification = await verifyReceipt(intake, receipt);
    assert(verification.state === "failed_verification", `${expectedReason} tamper must fail verification`);
    assert(verification.reason_codes.includes(expectedReason), `${expectedReason} must be present; got ${verification.reason_codes.join(", ")}`);
  }

  // D3-2: bytes that verify are no longer something this function can decide,
  // so the outcome is the only thing that can say a receipt's signature is
  // untrusted -- and an outcome that describes a different receipt, a
  // different key, or a non-verified result must each fail it.
  for (const outcomeOverrides of [
    { result: "signature_bytes_untrusted" },
    { signed_identity: sha256Fixture("08") },
    { key_version: "some-other-key-version" }
  ]) {
    const verification = await intake.verifyVendorReceiptRecord(structuredClone(valid.vendor_receipt), {
      signature_verification_outcome: receiptOutcomeFor(valid.vendor_receipt.receipt_signature, outcomeOverrides)
    });
    assert(verification.state === "failed_verification", `${JSON.stringify(outcomeOverrides)} must fail verification`);
    assert(verification.reason_codes.includes("receipt_signature_unverified"), `expected receipt_signature_unverified; got ${verification.reason_codes.join(", ")}`);
  }

  for (const mutate of [
    (receipt) => { delete receipt.receipt_signature; },
    (receipt) => { delete receipt.public_verification_metadata; },
    (receipt) => { delete receipt.key_rotation_readiness; }
  ]) {
    const malformedReceipt = structuredClone(valid.vendor_receipt);
    mutate(malformedReceipt);
    const verification = await verifyReceipt(intake, malformedReceipt);
    assert(verification.state === "failed_verification", "schema-invalid receipt must fail verification without throwing");
    assert(verification.reason_codes.length > 0, "schema-invalid receipt must include a failure reason");
  }
}

async function testVerifierFailsClosedOnSchemaInvalidReceipt(intake) {
  const valid = await mintVendorReceipt(intake, await passingReceiptRequest());
  assert(valid.state === "received_with_receipt", "fail-closed verifier tests need a valid receipt");

  // Regression: a schema-invalid receipt that is still an object with valid
  // signature/metadata/keyRotation and valid+equal artifact summaries must fail
  // verification WITHOUT throwing, even when required non-signature fields are
  // missing or null. Previously verifyVendorReceiptRecord threw a TypeError when
  // it reached comparisonRowsMatchReceipt / disclosureSummaryComparisonValue.
  for (const mutate of [
    (receipt) => { delete receipt.selected_commit; },
    (receipt) => { receipt.selected_commit = null; },
    (receipt) => { delete receipt.disclosure_policy_summary; },
    (receipt) => { receipt.disclosure_policy_summary = null; }
  ]) {
    const malformedReceipt = structuredClone(valid.vendor_receipt);
    mutate(malformedReceipt);
    let verification;
    try {
      verification = await verifyReceipt(intake, malformedReceipt);
    } catch (error) {
      assert(false, `verifyVendorReceiptRecord must not throw on schema-invalid receipt; threw ${error}`);
    }
    assert(verification.state === "failed_verification", "schema-invalid receipt (missing/null required field) must fail verification without throwing");
    assert(verification.reason_codes.length > 0, "schema-invalid receipt must include a failure reason");
  }
}

async function testGenerateFailsClosedOnMalformedCallerContext(intake) {
  // Regression: mintVendorReceipt must return rejected_no_receipt (not throw)
  // when caller-supplied protocol context is structurally malformed. Previously
  // the preflight cross-checks dereferenced nested fields unguarded and crashed;
  // now these are all caught by full intake verification's own schema checks.
  for (const mutate of [
    (request) => { delete request.intake_verification_request.approved_outbound_manifest.selected_scope_summary; },
    (request) => { request.intake_verification_request.approved_outbound_manifest.selected_scope_summary = null; },
    (request) => { delete request.intake_verification_request.approved_outbound_manifest.disclosure_policy_summary; },
    (request) => { delete request.intake_verification_request.customer_approval.displayed_context; },
    (request) => { request.intake_verification_request.customer_approval = null; },
    (request) => { delete request.intake_verification_request.submitted_bundle_manifest.artifact_references; },
    (request) => { request.intake_verification_request.submitted_bundle_manifest = null; },
    (request) => { request.intake_verification_request.approved_outbound_manifest = null; }
  ]) {
    const request = await passingReceiptRequest();
    mutate(request);
    let result;
    try {
      result = await mintVendorReceipt(intake, request);
    } catch (error) {
      assert(false, `mintVendorReceipt must not throw on malformed caller context; threw ${error}`);
    }
    assert(result.state === "rejected_no_receipt", "malformed caller context must reject without receipt");
    assert(result.reason_codes.includes("intake_not_receipt_eligible"), `malformed intake context must be caught by real verification; got ${result.reason_codes.join(", ")}`);
    assert(result.reason_codes.includes("schema_validation_failed"), `malformed caller context must be explicit; got ${result.reason_codes.join(", ")}`);
    assertNoReceiptFields(result);
    assertClaimSafe(result);
  }

  // The request shape itself (not the nested intake request) can still be
  // malformed in ways intake verification never sees.
  for (const malformed of [undefined, null, "not-json-object", [], 42, {}, { intake_verification_request: null }]) {
    let result;
    try {
      result = await mintVendorReceipt(intake, malformed);
    } catch (error) {
      assert(false, `mintVendorReceipt must not throw on a malformed top-level request; threw ${error}`);
    }
    assert(result.state === "rejected_no_receipt", "malformed top-level request must reject without receipt");
    assert(result.reason_codes.includes("receipt_schema_validation_failed"), `expected receipt_schema_validation_failed; got ${result.reason_codes.join(", ")}`);
    assertNoReceiptFields(result);
  }
}

// C5-46: isolates the receipt identity check from the signature check --
// re-target the id to a value that is *not* the canonical content hash, but
// reseal the signature/metadata to that same (wrong) id, so the signature
// layer itself sees nothing wrong and only the identity mismatch fires.
async function testIdentityOnlyReceiptTamperIsRejected(intake) {
  const valid = await mintVendorReceipt(intake, await passingReceiptRequest());
  assert(valid.state === "received_with_receipt", "identity-tamper test needs a valid receipt");

  const tampered = structuredClone(valid.vendor_receipt);
  const fakeId = sha256Fixture("06");
  tampered.vendor_receipt_id = fakeId;
  tampered.receipt_signature.signed_identity = fakeId;
  tampered.public_verification_metadata.signed_identity = fakeId;

  const verification = await verifyReceipt(intake, tampered);
  assert(verification.state === "failed_verification", "a receipt id retargeted away from its canonical content hash must fail verification");
  assert(
    verification.reason_codes.includes("vendor_receipt_identity_mismatch") &&
      !verification.reason_codes.includes("signature_signed_identity_mismatch") &&
      !verification.reason_codes.includes("receipt_signature_untrusted"),
    `identity-only tamper must isolate the identity check specifically; got ${verification.reason_codes.join(", ")}`
  );
}

async function testNoSideEffectsAndLeakSafety(intake) {
  const source = await readFile(path.join(workspacePath, "src", "index.ts"), "utf8");
  const forbiddenImportPatterns = [
    /from\s+["']node:fs["']/,
    /from\s+["']node:child_process["']/,
    /from\s+["']node:net["']/,
    /from\s+["']node:http["']/,
    /from\s+["']node:https["']/,
    /from\s+["']express["']/,
    /from\s+["']fastify["']/,
    /from\s+["']next(?:\/[^"']*)?["']/,
    /from\s+["']@google-cloud\//,
    /from\s+["']pg["']/,
    /from\s+["']postgres["']/,
    /from\s+["']bullmq["']/,
    /from\s+["']cloudtasks["']/
  ];
  for (const pattern of forbiddenImportPatterns) {
    assert(!pattern.test(source), `Story 2.3 receipt generation must not import forbidden module matching ${pattern}`);
  }

  const request = await passingReceiptRequest();
  const originalFetch = globalThis.fetch;
  let networkCalled = false;
  globalThis.fetch = () => {
    networkCalled = true;
    throw new Error("network call is out of scope for Story 2.3 receipt generation");
  };
  try {
    const result = await mintVendorReceipt(intake, request);
    assert(result.state === "received_with_receipt", "receipt generation must remain pure when network calls are blocked");
    assert(networkCalled === false, "receipt generation must not create network calls");
    assertClaimSafe(result);
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }
  }
}

function canonicalReceiptIdentity(receipt) {
  const identityInput = structuredClone(receipt);
  delete identityInput.vendor_receipt_id;
  delete identityInput.receipt_signature;
  delete identityInput.public_verification_metadata.signed_identity;
  return digestBytes(canonicalizeJson(identityInput));
}

function sha256Fixture(hexByte) {
  return `sha256:${hexByte.repeat(64).slice(0, 64)}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertNoReceiptFields(result) {
  const keys = [];
  visit(result, (key) => keys.push(key));
  for (const key of keys) {
    assert(!FORBIDDEN_NO_RECEIPT_KEYS.has(key), `no-receipt result must not contain receipt key: ${key}`);
  }
}

function assertClaimSafe(result) {
  const serialized = JSON.stringify(result);
  for (const pattern of FORBIDDEN_OUTPUT_PATTERNS) {
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

// D3-2: `verifyVendorReceiptRecord` can no longer authenticate a receipt's
// signature from the receipt alone, so every call must supply the
// independently produced outcome. Deriving it from the receipt's own
// signature envelope keeps each tamper case isolated to the field it
// actually tampers with, exactly as the retired synthetic recomputation did.
function verifyReceipt(intake, receipt) {
  const signature = receipt === null || typeof receipt !== "object" ? {} : receipt.receipt_signature ?? {};
  return intake.verifyVendorReceiptRecord(receipt, { signature_verification_outcome: receiptOutcomeFor(signature) });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
