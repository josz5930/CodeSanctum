import canonicalizeJson from "canonicalize";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-worker-normalization-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "worker-normalization-test-dist");

const FORBIDDEN_IMPORTS = [
  "node:fs",
  "node:net",
  "node:http",
  "node:https",
  "node:child_process",
  "express",
  "fastify",
  "@aws-sdk/",
  "pg",
  "sqlite"
];

const FORBIDDEN_RESULT_COPY = [
  /"classification"/i,
  /"expert_classification"/i,
  /"reviewer_classification"/i,
  /"confirmed"/i,
  /attestation/i,
  /great job/i,
  /leaderboard/i,
  /scanner dashboard/i,
  /no vulnerabilities/i,
  /absence of vulnerabilities/i,
  /scanner stdout/i,
  /scanner stderr/i,
  /SUPER_SECRET_TOKEN_MATERIAL/i,
  /SIMULATED_REAL_CUSTOMER_SOURCE/i
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
    path.join(tempDir, "worker.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const workerSource = await readFile(path.join(workspacePath, "src", "index.ts"), "utf8");
  for (const forbiddenImport of FORBIDDEN_IMPORTS) {
    assert(!workerSource.includes(forbiddenImport), `worker normalization must not import ${forbiddenImport}`);
  }

  const worker = await import(pathToFileURL(path.join(outDir, "services", "worker", "src", "index.js")).href);
  assert(worker.workspaceName === "@onevps/worker-service", "workspaceName export must be preserved");
  assert(worker.workspaceScope === "private-capable-worker-scaffold", "workspaceScope export must be preserved");
  assert(typeof worker.normalizeCandidateFindings === "function", "normalizeCandidateFindings must be exported");

  await testGroupsRelatedCandidateFindings(worker);
  await testReceiptBoundaryRejections(worker);
  await testSchemaInvalidRejections(worker);
  await testScannerFindingSetSemanticRejections(worker);
  await testReviewScopeAuthority(worker);
  await testChronologyProvenanceAndPollutionSafety(worker);
  await testCoverageModesAndEvidenceAvailability(worker);
  await testNoFindingsClaimSafeOutput(worker);
  await testMalformedInputDoesNotThrow(worker);
  await testDraftIdStability(worker);
  await testProtocolFixtureConvergence(worker);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("worker finding normalization tests passed.");

async function testGroupsRelatedCandidateFindings(worker) {
  const input = await createNormalizationInput();
  const result = worker.normalizeCandidateFindings(input);
  assert(result.outcome === "normalized", `normalization must succeed, got ${JSON.stringify(result)}`);
  const draftSet = result.draft_set;
  assert(draftSet.normalization_status === "drafts_created", "findings input produces drafts_created status");
  assert(draftSet.vendor_receipt_ref === input.vendor_receipt.vendor_receipt_id, "draft set references received receipt identity");
  assert(draftSet.evidence_bundle_id === input.bundle_manifest.evidence_bundle_id, "draft set preserves bundle identity");
  assert(draftSet.manifest_id === input.outbound_manifest.manifest_id, "draft set preserves manifest identity");
  assert(draftSet.review_finding_drafts.length === 1, "related same-file scanner outputs are grouped for review");

  const draft = draftSet.review_finding_drafts[0];
  assert(draft.status === "draft", "normalization emits drafts, not expert outcomes");
  assert(draft.review_lifecycle_state === "under_review", "draft exposes text-first under_review state");
  assert(draft.source_derived_class === "retained_review_artifact", "draft is a retained review artifact");
  assert(draft.evidence_basis.includes("scanner_output"), "scanner output is preserved as evidence basis");
  assert(draft.threshold_gaps.length > 0, "scanner evidence carries threshold gaps");
  assert(draft.candidate_finding_refs.every((ref) => ref.startsWith("candidate_finding:")), "candidate provenance is preserved");
  assert(draft.candidate_finding_refs.length === 2, "grouping preserves every source candidate id");
  assert(JSON.stringify(draft.sources) === JSON.stringify(["regex", "semgrep"]), "cross-source related outputs preserve all sources");
  assert(JSON.stringify(draft.scanner_rule_ids) === JSON.stringify(["demo.regex.eval", "demo.semgrep.insecure-random"]), "grouping preserves all scanner rule ids");
  assert(draft.affected_area === "src/app.ts:2:18", "draft preserves scanner location precision instead of only the grouping path");
  assert(draft.group_key.startsWith("["), "group key uses a delimiter-safe encoded tuple");
  assertNoForbiddenCopy(draftSet);

  const groupedInput = await createNormalizationInput();
  groupedInput.scanner_finding_set.candidate_findings.push({
    ...groupedInput.scanner_finding_set.candidate_findings[0],
    candidate_finding_id: "candidate_finding:demo_regex_002"
  });
  const grouped = worker.normalizeCandidateFindings(groupedInput);
  assert(grouped.outcome === "normalized", "duplicate-like candidates should normalize");
  const regexDraft = grouped.draft_set.review_finding_drafts.find((nextDraft) => nextDraft.scanner_rule_ids.includes("demo.regex.eval"));
  assert(regexDraft.candidate_finding_refs.length === 3, "deterministic grouping preserves all duplicate and related candidate ids");

  // C5-39: candidates must be corroborated by a successful scanner run
  // covering their file, so the synthetic delimiter-shaped paths need a
  // matching scanned_files entry -- both candidates below inherit
  // `source: "regex"` from candidate_findings[0].
  const delimiterInput = await createNormalizationInput();
  delimiterInput.scanner_finding_set.scanner_runs = delimiterInput.scanner_finding_set.scanner_runs.map((run) =>
    run.scanner_name === "regex" ? { ...run, scanned_files: [...run.scanned_files, "b|c", "c"] } : run
  );
  delimiterInput.scanner_finding_set.candidate_findings = [
    {
      ...delimiterInput.scanner_finding_set.candidate_findings[0],
      candidate_finding_id: "candidate_finding:delimiter_one",
      scanner_rule_id: "a",
      affected_area: "b|c"
    },
    {
      ...delimiterInput.scanner_finding_set.candidate_findings[0],
      candidate_finding_id: "candidate_finding:delimiter_two",
      scanner_rule_id: "a|b",
      affected_area: "c"
    }
  ];
  const delimiterResult = worker.normalizeCandidateFindings(delimiterInput);
  assert(delimiterResult.outcome === "normalized", "delimiter-like scanner values should normalize");
  assert(delimiterResult.draft_set.review_finding_drafts.length === 2, "delimiter-like scanner values must not collide into one group");

  // C5-39/C5-42: a leading-colon affected_area strips to an empty file path
  // (no real path precedes the line:column suffix), which by construction
  // can never appear in a schema-valid (non-empty-string) scanned_files
  // entry -- this is correctly unresolvable/unverifiable and must reject,
  // not silently normalize under a degenerate group key.
  const leadingColonInput = await createNormalizationInput();
  leadingColonInput.scanner_finding_set.candidate_findings[0].affected_area = ":10:5";
  const leadingColonResult = worker.normalizeCandidateFindings(leadingColonInput);
  assert(
    leadingColonResult.outcome === "rejected" && leadingColonResult.reason === "normalization_candidate_run_coverage_missing",
    `a leading-colon affected_area with no derivable file path must be rejected; got ${JSON.stringify(leadingColonResult)}`
  );

  const severityInput = await createNormalizationInput();
  severityInput.scanner_finding_set.candidate_findings[0].severity = "low";
  severityInput.scanner_finding_set.candidate_findings[1].severity = "critical";
  severityInput.scanner_finding_set.candidate_findings[0].confidence = "low";
  severityInput.scanner_finding_set.candidate_findings[1].confidence = "high";
  const severityResult = worker.normalizeCandidateFindings(severityInput);
  assert(severityResult.outcome === "normalized", "mixed scanner metadata should normalize");
  assert(severityResult.draft_set.review_finding_drafts[0].severity === "critical", "grouped severity preserves the highest scanner-provided value");
  assert(severityResult.draft_set.review_finding_drafts[0].confidence === "high", "grouped confidence preserves the highest scanner-provided value");
}

async function testReceiptBoundaryRejections(worker) {
  assert(worker.normalizeCandidateFindings(null).reason === "normalization_input_not_object", "non-object input rejected with stable code");
  const noReceipt = await createNormalizationInput();
  noReceipt.vendor_receipt = undefined;
  assert(worker.normalizeCandidateFindings(noReceipt).reason === "normalization_receipt_absent", "missing receipt rejected");

  const wrongState = await createNormalizationInput();
  wrongState.vendor_receipt = { ...wrongState.vendor_receipt, verification_state: "quarantined_no_receipt" };
  assert(worker.normalizeCandidateFindings(wrongState).reason === "normalization_receipt_not_received", "non-received receipt state rejected before schema assumptions");

  const bundleMismatch = await createNormalizationInput();
  bundleMismatch.vendor_receipt = { ...bundleMismatch.vendor_receipt, evidence_bundle_id: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" };
  assert(worker.normalizeCandidateFindings(bundleMismatch).reason === "normalization_receipt_bundle_mismatch", "bundle mismatch rejected");

  const manifestMismatch = await createNormalizationInput();
  manifestMismatch.vendor_receipt = { ...manifestMismatch.vendor_receipt, manifest_id: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" };
  assert(worker.normalizeCandidateFindings(manifestMismatch).reason === "normalization_receipt_manifest_mismatch", "manifest mismatch rejected");

  const receiptCoverageMismatch = await createNormalizationInput();
  receiptCoverageMismatch.vendor_receipt = { ...receiptCoverageMismatch.vendor_receipt, coverage_mode: "metadata_only" };
  assert(
    worker.normalizeCandidateFindings(receiptCoverageMismatch).reason === "normalization_receipt_coverage_mode_mismatch",
    "receipt coverage mode is part of the received-with-receipt trust boundary"
  );

  const attemptMismatch = await createNormalizationInput();
  attemptMismatch.vendor_receipt = { ...attemptMismatch.vendor_receipt, bundle_instance_id: "bundle_instance:other_demo_001" };
  assert(worker.normalizeCandidateFindings(attemptMismatch).reason === "normalization_receipt_attempt_mismatch", "bundle attempt mismatch rejected");

  // C5-47: submission_attempt_id and bundle_instance_id are two independent
  // fields in the same equality check -- test each in isolation.
  const submissionAttemptMismatch = await createNormalizationInput();
  submissionAttemptMismatch.vendor_receipt = { ...submissionAttemptMismatch.vendor_receipt, submission_attempt_id: "submission_attempt:other_demo_001" };
  assert(
    worker.normalizeCandidateFindings(submissionAttemptMismatch).reason === "normalization_receipt_attempt_mismatch",
    "submission attempt mismatch rejected independently of bundle_instance_id"
  );

  const manifestBundleMismatch = await createNormalizationInput();
  manifestBundleMismatch.outbound_manifest = { ...manifestBundleMismatch.outbound_manifest, coverage_mode: "metadata_only" };
  assert(
    worker.normalizeCandidateFindings(manifestBundleMismatch).reason === "normalization_outbound_manifest_semantic_invalid",
    "bundle/outbound coverage mismatch rejected as an intrinsic outbound-manifest semantic failure before the contextual mismatch check runs"
  );

  const manifestBundleMismatchSemanticallyConsistent = await createNormalizationInput();
  manifestBundleMismatchSemanticallyConsistent.outbound_manifest = {
    ...manifestBundleMismatchSemanticallyConsistent.outbound_manifest,
    coverage_mode: "extended_approved_snippets_or_targeted_files"
  };
  assert(
    worker.normalizeCandidateFindings(manifestBundleMismatchSemanticallyConsistent).reason === "normalization_outbound_manifest_semantic_invalid",
    "an outbound manifest whose coverage_mode diverges from its own manifest_id/disclosure_policy_summary is caught by the intrinsic semantic check even for another otherwise-valid coverage mode"
  );

  const scannerMismatch = await createNormalizationInput();
  scannerMismatch.bundle_manifest = { ...scannerMismatch.bundle_manifest, scanner_finding_set_ref: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" };
  assert(
    worker.normalizeCandidateFindings(scannerMismatch).reason === "normalization_bundle_manifest_identity_invalid",
    "retargeting bundle_manifest.scanner_finding_set_ref without recomputing evidence_bundle_id is caught as an intrinsic bundle identity failure before the contextual ref-mismatch check runs"
  );

  const scannerRefMismatchOnly = await createNormalizationInput();
  const rewrittenScannerId = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
  scannerRefMismatchOnly.scanner_finding_set = { ...scannerRefMismatchOnly.scanner_finding_set, scanner_finding_set_id: rewrittenScannerId };
  assert(
    worker.normalizeCandidateFindings(scannerRefMismatchOnly).reason === "normalization_scanner_finding_set_mismatch",
    "scanner finding set self-relabeling against an unchanged manifest ref is still rejected by the contextual scanner-set mismatch check"
  );

  // C5-47: bundle_manifest and outbound_manifest each carry their own
  // scanner_finding_set_ref -- test the outbound side independently of the
  // bundle side above.
  const outboundScannerMismatch = await createNormalizationInput();
  outboundScannerMismatch.outbound_manifest = { ...outboundScannerMismatch.outbound_manifest, scanner_finding_set_ref: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" };
  assert(
    worker.normalizeCandidateFindings(outboundScannerMismatch).reason === "normalization_outbound_manifest_semantic_invalid",
    "retargeting outbound_manifest.scanner_finding_set_ref without recomputing manifest_id is caught as an intrinsic outbound identity failure"
  );
}

async function testSchemaInvalidRejections(worker) {
  const invalidBundle = await createNormalizationInput();
  invalidBundle.bundle_manifest = { ...invalidBundle.bundle_manifest, protocol_version: "codeattest.v999" };
  assert(worker.normalizeCandidateFindings(invalidBundle).reason === "normalization_bundle_manifest_schema_invalid", "invalid bundle manifest schema rejected");

  const invalidOutbound = await createNormalizationInput();
  invalidOutbound.outbound_manifest = { ...invalidOutbound.outbound_manifest, coverage_mode: "obsolete_targeted_snippets" };
  assert(worker.normalizeCandidateFindings(invalidOutbound).reason === "normalization_outbound_manifest_schema_invalid", "invalid outbound manifest schema rejected");

  const invalidScannerSet = await createNormalizationInput();
  invalidScannerSet.scanner_finding_set = { ...invalidScannerSet.scanner_finding_set, scanner_finding_set_id: "not-a-digest" };
  assert(worker.normalizeCandidateFindings(invalidScannerSet).reason === "normalization_scanner_finding_set_schema_invalid", "invalid scanner finding set schema rejected");

  const invalidReceipt = await createNormalizationInput();
  invalidReceipt.vendor_receipt = { ...invalidReceipt.vendor_receipt, protocol_version: "codeattest.v999" };
  assert(worker.normalizeCandidateFindings(invalidReceipt).reason === "normalization_vendor_receipt_schema_invalid", "invalid vendor receipt schema rejected");

  const duplicateCandidateIds = await createNormalizationInput();
  duplicateCandidateIds.scanner_finding_set.candidate_findings.push({
    ...duplicateCandidateIds.scanner_finding_set.candidate_findings[0]
  });
  assert(worker.normalizeCandidateFindings(duplicateCandidateIds).reason === "normalization_output_schema_invalid", "schema-invalid normalized output is rejected");

  // C5-35: an impossible availability tuple (deleted_under_policy with no
  // deletion evidence ref) is now caught by the input-level availability
  // contract before draft-building even runs, not by the output semantic
  // validator after the fact.
  const deletedWithoutProof = await createNormalizationInput();
  deletedWithoutProof.artifact_availability = {
    ...deletedWithoutProof.artifact_availability,
    "artifact_ref:synthetic_raw_snippet": {
      availability_state: "deleted_under_policy",
      source_derived_class: "transient_source_derived"
    }
  };
  assert(worker.normalizeCandidateFindings(deletedWithoutProof).reason === "normalization_availability_invalid", "impossible availability tuple is rejected at the input boundary");
}

async function testScannerFindingSetSemanticRejections(worker) {
  const unsuccessfulWithoutReason = await createNormalizationInput();
  unsuccessfulWithoutReason.scanner_finding_set.scanner_runs[0].status = "failed";
  delete unsuccessfulWithoutReason.scanner_finding_set.scanner_runs[0].failure_reason;
  let result = worker.normalizeCandidateFindings(unsuccessfulWithoutReason);
  assert(
    result.outcome === "rejected" && result.reason === "normalization_scanner_finding_set_schema_invalid",
    "an unsuccessful scanner run without failure_reason must fail schema authority"
  );

  const successfulWithReason = await createNormalizationInput();
  successfulWithReason.scanner_finding_set.scanner_runs[0].failure_reason = "unexpected failure metadata";
  result = worker.normalizeCandidateFindings(successfulWithReason);
  assert(
    result.outcome === "rejected" && result.reason === "normalization_scanner_finding_set_schema_invalid",
    "a successful scanner run carrying failure_reason must fail schema authority"
  );

  const candidateWithoutSuccessfulSource = await createNormalizationInput();
  const semgrepRun = candidateWithoutSuccessfulSource.scanner_finding_set.scanner_runs.find((run) => run.scanner_name === "semgrep");
  semgrepRun.status = "failed";
  semgrepRun.failure_reason = "synthetic scanner failure";
  result = worker.normalizeCandidateFindings(candidateWithoutSuccessfulSource);
  assert(
    result.outcome === "rejected" && result.reason === "normalization_scanner_finding_set_semantic_invalid",
    "a candidate whose source has no successful run must fail scanner semantics"
  );
}

async function testReviewScopeAuthority(worker) {
  const conflictingCallerLabel = await createNormalizationInput();
  conflictingCallerLabel.review_id = "review:conflicting-caller-label";
  let result = worker.normalizeCandidateFindings(conflictingCallerLabel);
  assert(
    result.outcome === "rejected" && result.reason === "normalization_metadata_invalid",
    "a naked caller-controlled review_id must be rejected rather than relabeling verified evidence"
  );

  const consistentlyRelabeledDownstreamChain = await createNormalizationInput();
  const otherScopeRef = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  consistentlyRelabeledDownstreamChain.bundle_manifest.review_scope_ref = otherScopeRef;
  consistentlyRelabeledDownstreamChain.outbound_manifest.review_scope_ref = otherScopeRef;
  consistentlyRelabeledDownstreamChain.scanner_finding_set.review_scope_ref = otherScopeRef;
  resealOutboundManifest(consistentlyRelabeledDownstreamChain.outbound_manifest);
  consistentlyRelabeledDownstreamChain.bundle_manifest.manifest_id = consistentlyRelabeledDownstreamChain.outbound_manifest.manifest_id;
  resealBundleManifest(consistentlyRelabeledDownstreamChain.bundle_manifest);
  consistentlyRelabeledDownstreamChain.vendor_receipt.evidence_bundle_id = consistentlyRelabeledDownstreamChain.bundle_manifest.evidence_bundle_id;
  consistentlyRelabeledDownstreamChain.vendor_receipt.manifest_id = consistentlyRelabeledDownstreamChain.outbound_manifest.manifest_id;
  setReceiptComparisonRow(
    consistentlyRelabeledDownstreamChain.vendor_receipt,
    "evidence_bundle_id",
    consistentlyRelabeledDownstreamChain.vendor_receipt.evidence_bundle_id
  );
  setReceiptComparisonRow(
    consistentlyRelabeledDownstreamChain.vendor_receipt,
    "manifest_id",
    consistentlyRelabeledDownstreamChain.vendor_receipt.manifest_id
  );
  resealReceiptIn(consistentlyRelabeledDownstreamChain);
  result = worker.normalizeCandidateFindings(consistentlyRelabeledDownstreamChain);
  assert(
    result.outcome === "rejected" && result.reason === "normalization_review_scope_mismatch",
    "a consistently relabeled downstream chain must not override the authoritative review scope"
  );

  const valid = await createNormalizationInput();
  result = worker.normalizeCandidateFindings(valid);
  assert(result.outcome === "normalized", "a chain bound to the verified review scope must normalize");
  assert(result.draft_set.review_id === valid.review_scope.review_id, "output review_id must be derived exclusively from the verified review scope");
}

// C5-31/C5-36/C5-37/C5-40/C5-43/C5-45: chronology, prototype-pollution
// safety, candidate-provenance content safety, incomplete-scan reporting,
// provenance-only basis exclusion, and hostile-object-graph safety.
async function testChronologyProvenanceAndPollutionSafety(worker) {
  // C5-31: normalization must not predate the scanner output or receipt.
  const beforeScanner = await createNormalizationInput({ created_at: "2020-01-01T00:00:00Z" });
  assert(
    worker.normalizeCandidateFindings(beforeScanner).reason === "normalization_chronology_invalid",
    "normalization created_at before the scanner/receipt chronology must be rejected"
  );

  // C5-37: source/secret/PII-shaped candidate provenance must be rejected,
  // not retained.
  const unsafeProvenance = await createNormalizationInput();
  unsafeProvenance.scanner_finding_set.candidate_findings[0].original_reference = "token=AKIAABCDEFGHIJKLMNOP leaked in scanner output";
  assert(
    worker.normalizeCandidateFindings(unsafeProvenance).reason === "normalization_candidate_provenance_unsafe",
    "secret-shaped candidate provenance must be rejected"
  );

  // C5-36: `artifact_availability` must be a plain (or null-prototype)
  // object -- an `Object.create({...})` map whose entries live only on the
  // prototype (not as own properties) is rejected outright rather than
  // silently treated as empty or, worse, having its inherited entries
  // trusted via prototype-chain lookup.
  const pollutedInput = await createNormalizationInput();
  pollutedInput.artifact_availability = Object.create({
    "artifact_ref:synthetic_raw_snippet": { availability_state: "retained_review_artifact", source_derived_class: "transient_source_derived" }
  });
  assert(
    worker.normalizeCandidateFindings(pollutedInput).reason === "normalization_availability_invalid",
    "a non-plain-prototype artifact_availability object must be rejected, not have its inherited entries trusted"
  );

  // A genuinely plain object whose values are `Object.create`-based (own key,
  // prototype-inherited value shape) must also be rejected by the same
  // per-entry validation, not silently fall back to unresolved.
  const pollutedEntryInput = await createNormalizationInput();
  pollutedEntryInput.artifact_availability = {
    "artifact_ref:synthetic_raw_snippet": Object.create({ availability_state: "retained_review_artifact", source_derived_class: "transient_source_derived" })
  };
  assert(
    worker.normalizeCandidateFindings(pollutedEntryInput).reason === "normalization_availability_invalid",
    "a non-plain-prototype availability entry value must be rejected"
  );

  // C5-43: the ever-present scanner-finding-set provenance ref must never by
  // itself grant retained_review_artifact corroborating basis.
  const metadataOnly = await createMetadataOnlyNormalizationInput();
  const metadataResult = worker.normalizeCandidateFindings(metadataOnly);
  assert(metadataResult.outcome === "normalized", "metadata-only input should normalize for provenance-basis check");
  assert(
    !metadataResult.draft_set.review_finding_drafts[0].evidence_basis.includes("retained_review_artifact"),
    "scanner-set provenance alone must not be misclassified as corroborating retained review evidence"
  );

  // C5-40: zero candidates because every run failed/was unavailable, with no
  // successful run over a nonempty file set, must not be reported the same
  // way as a completed clean scan.
  const incompleteCoverage = await createNormalizationInput();
  incompleteCoverage.scanner_finding_set = await readFixture("valid/scanner-finding-set.no-findings.json");
  incompleteCoverage.scanner_finding_set.scanner_runs = incompleteCoverage.scanner_finding_set.scanner_runs.map((run) => ({
    ...run,
    status: "failed",
    scanned_files: [],
    failure_reason: "synthetic scanner failure"
  }));
  incompleteCoverage.bundle_manifest = { ...incompleteCoverage.bundle_manifest, scanner_finding_set_ref: incompleteCoverage.scanner_finding_set.scanner_finding_set_id };
  incompleteCoverage.outbound_manifest = { ...incompleteCoverage.outbound_manifest, scanner_finding_set_ref: incompleteCoverage.scanner_finding_set.scanner_finding_set_id };
  resealOutboundManifest(incompleteCoverage.outbound_manifest);
  incompleteCoverage.bundle_manifest.manifest_id = incompleteCoverage.outbound_manifest.manifest_id;
  resealBundleManifest(incompleteCoverage.bundle_manifest);
  incompleteCoverage.vendor_receipt = {
    ...incompleteCoverage.vendor_receipt,
    evidence_bundle_id: incompleteCoverage.bundle_manifest.evidence_bundle_id,
    manifest_id: incompleteCoverage.outbound_manifest.manifest_id
  };
  setReceiptComparisonRow(incompleteCoverage.vendor_receipt, "evidence_bundle_id", incompleteCoverage.vendor_receipt.evidence_bundle_id);
  setReceiptComparisonRow(incompleteCoverage.vendor_receipt, "manifest_id", incompleteCoverage.vendor_receipt.manifest_id);
  resealReceiptIn(incompleteCoverage);
  assert(
    worker.normalizeCandidateFindings(incompleteCoverage).reason === "normalization_scan_coverage_incomplete",
    "zero candidates with no successful run over a nonempty file set must not be reported as a completed clean scan"
  );

  // C5-45: hostile in-process object graphs (throwing accessors, cycles)
  // must return a stable rejection, not throw.
  const throwingInput = await createNormalizationInput();
  Object.defineProperty(throwingInput, "normalization_run_id", {
    get() {
      throw new Error("hostile accessor");
    },
    enumerable: true,
    configurable: true
  });
  let throwingResult;
  try {
    throwingResult = worker.normalizeCandidateFindings(throwingInput);
  } catch (error) {
    assert(false, `normalizeCandidateFindings must not throw on a hostile accessor; threw ${error}`);
  }
  assert(throwingResult.outcome === "rejected", "a hostile accessor must produce a stable rejection");

  // A throwing accessor reachable only through a nested field (not the
  // top-level input itself) must be caught by the same guard.
  const throwingArtifactAvailability = await createNormalizationInput();
  Object.defineProperty(throwingArtifactAvailability, "artifact_availability", {
    get() {
      throw new Error("hostile nested accessor");
    },
    enumerable: true,
    configurable: true
  });
  let throwingNestedResult;
  try {
    throwingNestedResult = worker.normalizeCandidateFindings(throwingArtifactAvailability);
  } catch (error) {
    assert(false, `normalizeCandidateFindings must not throw on a hostile nested accessor; threw ${error}`);
  }
  assert(throwingNestedResult.outcome === "rejected", "a hostile nested accessor must produce a stable rejection");
}

async function testCoverageModesAndEvidenceAvailability(worker) {
  // C5-28/C5-32: naive `{ ...manifest, coverage_mode: "..." }` overrides used
  // to slip past the worker entirely because nothing recomputed the mutated
  // artifact's own content-derived identity or re-checked its semantics.
  // Now that verifiedArtifactSemanticIssues/verifiedSubmissionChainIssues are
  // wired in, a coverage-mode-only override is self-inconsistent (identity
  // mismatch) and rejected -- so these cases must build genuinely resealed,
  // internally-consistent metadata-only/extended fixtures instead.
  const metadataOnly = await createMetadataOnlyNormalizationInput();
  const metadataResult = worker.normalizeCandidateFindings(metadataOnly);
  assert(metadataResult.outcome === "normalized", "metadata-only input should normalize");
  const metadataDraft = metadataResult.draft_set.review_finding_drafts[0];
  assert(metadataDraft.coverage_mode === "metadata_only", "draft records metadata-only coverage mode");
  assert(metadataDraft.evidence_basis.includes("metadata_only"), "metadata-only evidence basis is explicit");
  assert(metadataDraft.evidence_refs.length === 1, "metadata-only candidates with no association do not invent a source evidence slot");
  assert(metadataDraft.source_reference_state === "unresolved_reference", "an empty candidate association never implies source availability");
  assert(metadataDraft.threshold_gaps.some((gap) => /metadata-only/i.test(gap)), "metadata-only threshold gap is recorded");

  // C5-34: unavailable (never_collected) source must not also carry the
  // positive extended_approved_source_context claim -- only scanner
  // provenance plus the corresponding unavailable-reference basis.
  const extended = await createExtendedNormalizationInput();
  const extendedResult = worker.normalizeCandidateFindings(extended);
  assert(extendedResult.outcome === "normalized", "extended approved evidence input should normalize");
  const extendedDraft = extendedResult.draft_set.review_finding_drafts[0];
  assert(!extendedDraft.evidence_basis.includes("extended_approved_source_context"), "unavailable extended source must not claim a positive content basis");
  assert(extendedDraft.evidence_basis.includes("never_collected_reference"), "never-collected reference basis is explicit");
  assert(extendedDraft.source_reference_state === "never_collected", "never-collected source state is explicit");

  // Positive control: when the extended source IS actually available, the
  // positive basis is present.
  const extendedAvailable = await createExtendedNormalizationInput();
  extendedAvailable.artifact_availability = {
    ...extendedAvailable.artifact_availability,
    "artifact_ref:synthetic_raw_snippet": {
      availability_state: "retained_review_artifact",
      source_derived_class: "customer_opt_in_retained_source"
    }
  };
  const extendedAvailableResult = worker.normalizeCandidateFindings(extendedAvailable);
  assert(extendedAvailableResult.outcome === "normalized", "extended input with available source should normalize");
  const extendedAvailableDraft = extendedAvailableResult.draft_set.review_finding_drafts[0];
  assert(extendedAvailableDraft.evidence_basis.includes("extended_approved_source_context"), "available extended source carries the positive content basis");
  assert(extendedAvailableDraft.evidence_basis.includes("retained_review_artifact"), "available extended source also carries the retained-artifact basis");

  const unresolved = await createNormalizationInput();
  delete unresolved.artifact_availability;
  const unresolvedResult = worker.normalizeCandidateFindings(unresolved);
  assert(unresolvedResult.outcome === "normalized", "missing availability lookup should not throw");
  const unresolvedDraft = unresolvedResult.draft_set.review_finding_drafts[0];
  assert(unresolvedDraft.source_reference_state === "unresolved_reference", "missing lookup resolves evidence as unresolved, not available");
  assert(unresolvedDraft.evidence_basis.includes("unresolved_reference"), "unresolved evidence basis is explicit");

  const deleted = await createNormalizationInput();
  deleted.artifact_availability = {
    ...deleted.artifact_availability,
    "artifact_ref:synthetic_raw_snippet": {
      availability_state: "deleted_under_policy",
      source_derived_class: "transient_source_derived",
      deletion_evidence_ref: "deletion_evidence:synthetic_deletion_evidence"
    }
  };
  const deletedResult = worker.normalizeCandidateFindings(deleted);
  assert(deletedResult.outcome === "normalized", "deleted-under-policy evidence should normalize by reference");
  const deletedRef = deletedResult.draft_set.review_finding_drafts[0].evidence_refs.find((ref) => ref.artifact_ref === "artifact_ref:synthetic_raw_snippet");
  assert(deletedRef.available_for_review === false, "deleted evidence is not shown as available");
  assert(deletedRef.display_state === "deleted", "deleted evidence has text-first deleted display state");
  assert(deletedRef.deletion_evidence_ref === "deletion_evidence:synthetic_deletion_evidence", "deleted evidence resolves to deletion evidence");

  // C5-33: a candidate's explicit association must resolve to a real shipped
  // source artifact before the availability side-channel is considered.
  const noBackingArtifact = await createNormalizationInput();
  noBackingArtifact.bundle_manifest = {
    ...noBackingArtifact.bundle_manifest,
    artifact_references: noBackingArtifact.bundle_manifest.artifact_references.filter((reference) => reference.artifact_type !== "raw_snippet")
  };
  resealBundleManifest(noBackingArtifact.bundle_manifest);
  noBackingArtifact.vendor_receipt.evidence_bundle_id = noBackingArtifact.bundle_manifest.evidence_bundle_id;
  setReceiptComparisonRow(noBackingArtifact.vendor_receipt, "evidence_bundle_id", noBackingArtifact.vendor_receipt.evidence_bundle_id);
  resealReceiptIn(noBackingArtifact);
  // The side-channel dishonestly claims the association is available anyway.
  assert(noBackingArtifact.artifact_availability["artifact_ref:synthetic_raw_snippet"].availability_state === "retained_review_artifact", "test setup: side-channel claims availability");
  const noBackingResult = worker.normalizeCandidateFindings(noBackingArtifact);
  assert(noBackingResult.outcome === "normalized", "missing bundle artifact should still normalize, just as unresolved");
  const noBackingDraft = noBackingResult.draft_set.review_finding_drafts[0];
  const noBackingRef = noBackingDraft.evidence_refs.find((ref) => ref.artifact_ref === "artifact_ref:synthetic_raw_snippet");
  assert(noBackingRef.availability_state === "unresolved_reference", "an unshipped association must not inherit an availability claim from the side-channel");
  assert(noBackingRef.available_for_review === false, "an unshipped association must not be shown as available for review");
  assert(noBackingDraft.source_reference_state === "unresolved_reference", "source reference state reflects the forced-unresolved evidence ref");

  const distinct = await createNormalizationInput();
  distinct.scanner_finding_set.candidate_findings[0].source_artifact_refs = ["artifact_ref:synthetic_raw_snippet"];
  distinct.scanner_finding_set.candidate_findings[1].source_artifact_refs = ["artifact_ref:synthetic_raw_snippet_two"];
  const secondSnippet = {
    ...distinct.bundle_manifest.artifact_references.find((reference) => reference.artifact_type === "raw_snippet"),
    artifact_ref: "artifact_ref:synthetic_raw_snippet_two",
    content_path: "demo-raw-snippet-two.synthetic.txt"
  };
  distinct.bundle_manifest.artifact_references.push(secondSnippet);
  distinct.bundle_manifest.local_cleanup_intent.push({
    ...distinct.bundle_manifest.local_cleanup_intent.find((intent) => intent.artifact_ref === "artifact_ref:synthetic_raw_snippet"),
    artifact_ref: "artifact_ref:synthetic_raw_snippet_two"
  });
  distinct.artifact_availability["artifact_ref:synthetic_raw_snippet_two"] = {
    availability_state: "retained_review_artifact",
    source_derived_class: "transient_source_derived"
  };
  resealBundleManifest(distinct.bundle_manifest);
  distinct.vendor_receipt.evidence_bundle_id = distinct.bundle_manifest.evidence_bundle_id;
  setReceiptComparisonRow(distinct.vendor_receipt, "evidence_bundle_id", distinct.vendor_receipt.evidence_bundle_id);
  resealReceiptIn(distinct);
  const distinctResult = worker.normalizeCandidateFindings(distinct);
  assert(distinctResult.outcome === "normalized", `two candidates may bind to distinct shipped snippets, got ${JSON.stringify(distinctResult)}`);
  assert(
    distinctResult.draft_set.review_finding_drafts[0].evidence_refs.some((ref) => ref.artifact_ref === "artifact_ref:synthetic_raw_snippet_two"),
    "a distinct candidate snippet binding is preserved in the grouped draft"
  );

  const duplicateAssociation = await createNormalizationInput();
  duplicateAssociation.scanner_finding_set.candidate_findings[0].source_artifact_refs = [
    "artifact_ref:synthetic_raw_snippet",
    "artifact_ref:synthetic_raw_snippet"
  ];
  assert(
    worker.normalizeCandidateFindings(duplicateAssociation).reason === "normalization_scanner_finding_set_schema_invalid",
    "duplicate candidate source associations are rejected by protocol schema"
  );

  const wrongType = await createNormalizationInput();
  wrongType.scanner_finding_set.candidate_findings[0].source_artifact_refs = ["artifact_ref:review_scope"];
  wrongType.artifact_availability["artifact_ref:review_scope"] = {
    availability_state: "retained_review_artifact",
    source_derived_class: "retained_review_artifact"
  };
  const wrongTypeResult = worker.normalizeCandidateFindings(wrongType);
  assert(wrongTypeResult.outcome === "normalized", "a wrong-type association is retained as unresolved rather than throwing");
  assert(
    wrongTypeResult.draft_set.review_finding_drafts[0].evidence_refs.find((ref) => ref.artifact_ref === "artifact_ref:review_scope")
      .availability_state === "unresolved_reference",
    "a wrong-type artifact cannot substantiate candidate source availability"
  );
}

async function testNoFindingsClaimSafeOutput(worker) {
  const input = await createNormalizationInput();
  input.scanner_finding_set = await readFixture("valid/scanner-finding-set.no-findings.json");
  input.bundle_manifest = { ...input.bundle_manifest, scanner_finding_set_ref: input.scanner_finding_set.scanner_finding_set_id };
  input.outbound_manifest = { ...input.outbound_manifest, scanner_finding_set_ref: input.scanner_finding_set.scanner_finding_set_id };
  // C5-28: retargeting scanner_finding_set_ref changes each manifest's own
  // content, so its content-derived identity must be recomputed too, and
  // bundle_manifest.manifest_id must stay pinned to the (now-recomputed)
  // outbound manifest_id.
  resealOutboundManifest(input.outbound_manifest);
  input.bundle_manifest.manifest_id = input.outbound_manifest.manifest_id;
  resealBundleManifest(input.bundle_manifest);
  input.vendor_receipt = { ...input.vendor_receipt, evidence_bundle_id: input.bundle_manifest.evidence_bundle_id, manifest_id: input.outbound_manifest.manifest_id };
  setReceiptComparisonRow(input.vendor_receipt, "evidence_bundle_id", input.vendor_receipt.evidence_bundle_id);
  setReceiptComparisonRow(input.vendor_receipt, "manifest_id", input.vendor_receipt.manifest_id);
  resealReceiptIn(input);

  const result = worker.normalizeCandidateFindings(input);
  assert(result.outcome === "normalized", "no-findings scanner output should normalize");
  assert(result.draft_set.normalization_status === "no_findings_produced", "no-findings status is explicit");
  assert(result.draft_set.review_finding_drafts.length === 0, "no-findings output has no drafts");
  assert(result.draft_set.no_findings_statement === "No findings were produced by the configured inputs", "claim-safe no-findings statement is exact");
  assert(result.draft_set.normalization_limitations.some((limitation) => limitation.includes("does not prove absence of vulnerabilities")), "no-findings limitation prevents overclaiming");
  assertNoForbiddenCopy(result.draft_set, [/no vulnerabilities/i], [/absence of vulnerabilities/i]);
}

async function testMalformedInputDoesNotThrow(worker) {
  const malformedInputs = [undefined, null, "not-json-object", [], 42];
  for (const malformed of malformedInputs) {
    const result = worker.normalizeCandidateFindings(malformed);
    assert(result.outcome === "rejected", "malformed JSON-like callers return a rejected union");
  }

  const missingRunId = await createNormalizationInput();
  delete missingRunId.normalization_run_id;
  assert(worker.normalizeCandidateFindings(missingRunId).reason === "normalization_metadata_invalid", "missing normalization_run_id returns a stable rejection");

  const nonStringRunId = await createNormalizationInput();
  nonStringRunId.normalization_run_id = 42;
  assert(worker.normalizeCandidateFindings(nonStringRunId).reason === "normalization_metadata_invalid", "non-string normalization_run_id returns a stable rejection");

  const maxRunId = await createNormalizationInput({ normalization_run_id: `normalization_run:${"a".repeat(64)}` });
  const maxRunResult = worker.normalizeCandidateFindings(maxRunId);
  assert(maxRunResult.outcome === "normalized", "maximum-length normalization_run_id should not overflow generated draft ids");
  assert(
    maxRunResult.draft_set.review_finding_drafts.every((draft) => /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/.test(draft.review_finding_draft_id)),
    "generated draft ids stay inside the protocol id pattern"
  );
}

// C5-41: draft ids are a content hash, not truncated text plus ordinal
// position -- they must be deterministic and stable under insertion of an
// unrelated, earlier-sorting group.
async function testDraftIdStability(worker) {
  const baseResult = worker.normalizeCandidateFindings(await createNormalizationInput());
  assert(baseResult.outcome === "normalized", "base input must normalize for draft id stability test");
  const baseDraftId = baseResult.draft_set.review_finding_drafts.find((draft) => draft.affected_area === "src/app.ts:2:18").review_finding_draft_id;

  const repeatResult = worker.normalizeCandidateFindings(await createNormalizationInput());
  const repeatDraftId = repeatResult.draft_set.review_finding_drafts.find((draft) => draft.affected_area === "src/app.ts:2:18").review_finding_draft_id;
  assert(baseDraftId === repeatDraftId, "the same group must produce the same draft id across independent calls");

  const withInsertedGroup = await createNormalizationInput();
  withInsertedGroup.scanner_finding_set.scanner_runs = withInsertedGroup.scanner_finding_set.scanner_runs.map((run) =>
    run.scanner_name === "regex" ? { ...run, scanned_files: [...run.scanned_files, "aaa/earlier.ts"] } : run
  );
  withInsertedGroup.scanner_finding_set.candidate_findings = [
    {
      ...withInsertedGroup.scanner_finding_set.candidate_findings[0],
      candidate_finding_id: "candidate_finding:inserted_earlier",
      affected_area: "aaa/earlier.ts:1:1"
    },
    ...withInsertedGroup.scanner_finding_set.candidate_findings
  ];
  const insertedResult = worker.normalizeCandidateFindings(withInsertedGroup);
  assert(insertedResult.outcome === "normalized", "input with an inserted unrelated group must still normalize");
  assert(insertedResult.draft_set.review_finding_drafts.length === 2, "the inserted group must produce its own distinct draft");
  const survivingDraft = insertedResult.draft_set.review_finding_drafts.find((draft) => draft.affected_area === "src/app.ts:2:18");
  assert(survivingDraft !== undefined, "the original group must still be present");
  assert(survivingDraft.review_finding_draft_id === baseDraftId, "inserting an unrelated earlier-sorting group must not renumber an existing draft's id");
}

async function testProtocolFixtureConvergence(worker) {
  const expected = await readFixture("valid/review-finding-draft-set.finding-context.json");
  const input = await createNormalizationInput({ normalization_run_id: expected.normalization_run_id, created_at: expected.created_at });
  input.scanner_finding_set.candidate_findings = [input.scanner_finding_set.candidate_findings[1]];
  const result = worker.normalizeCandidateFindings(input);
  assert(result.outcome === "normalized", "fixture-equivalent input should normalize");
  assert(result.draft_set.normalization_status === expected.normalization_status, "worker output converges with protocol fixture status");
  assert(result.draft_set.review_finding_drafts[0].affected_area === expected.review_finding_drafts[0].affected_area, "worker output preserves fixture affected_area precision");
  assert(result.draft_set.review_finding_drafts.every((draft) => draft.review_lifecycle_state === "under_review"), "rendering state stays text-first");
  assertNoForbiddenCopy(result.draft_set);
}

async function createNormalizationInput(overrides = {}) {
  const reviewScope = await readFixture("valid/review-scope.json");
  const scannerFindingSet = await readFixture("valid/scanner-finding-set.json");
  const bundleManifest = await readFixture("valid/bundle-manifest.json");
  const outboundManifest = await readFixture("valid/outbound-manifest.json");
  const vendorReceipt = await readFixture("valid/vendor-receipt.json");
  return {
    normalization_run_id: "normalization_run:synthetic-demo-normalization",
    created_at: "2026-07-21T00:00:00Z",
    review_scope: reviewScope,
    scanner_finding_set: scannerFindingSet,
    bundle_manifest: bundleManifest,
    outbound_manifest: outboundManifest,
    vendor_receipt: vendorReceipt,
    vendor_receipt_signature_outcome: receiptSignatureOutcome(vendorReceipt),
    artifact_availability: {
      "artifact_ref:scanner_finding_set": {
        availability_state: "retained_review_artifact",
        source_derived_class: "retained_review_artifact"
      },
      "artifact_ref:synthetic_raw_snippet": {
        availability_state: "retained_review_artifact",
        source_derived_class: "transient_source_derived"
      },
      "artifact_ref:synthetic_extended_context": {
        availability_state: "retained_review_artifact",
        source_derived_class: "customer_opt_in_retained_source"
      }
    },
    ...overrides
  };
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

// C5-28/C5-32: builds a genuinely resealed metadata-only submission chain --
// bundle/outbound manifest identities and the vendor receipt signature/
// comparison rows are all recomputed from the mutated content, matching the
// same reseal pattern the intake test suite uses (see
// services/intake/test/vendor-receipt.test.mjs `canonicalIdentity`/
// `canonicalReceiptIdentity`), so the mutation is only caught by the
// semantic checks under test rather than by identity drift.
async function createMetadataOnlyNormalizationInput() {
  const reviewScope = await readFixture("valid/review-scope.json");
  const scannerFindingSet = await readFixture("valid/scanner-finding-set.json");
  const bundleManifest = await readFixture("valid/bundle-manifest.json");
  const outboundManifest = await readFixture("valid/outbound-manifest.json");
  const vendorReceipt = await readFixture("valid/vendor-receipt.json");

  for (const candidate of scannerFindingSet.candidate_findings) candidate.source_artifact_refs = [];

  outboundManifest.coverage_mode = "metadata_only";
  outboundManifest.disclosure_policy_summary.coverage_mode = "metadata_only";
  outboundManifest.warnings = [
    ...outboundManifest.warnings,
    "Expert confidence may be lower because Raw Snippets were not provided in metadata-only coverage."
  ];
  const rawSnippets = outboundManifest.evidence_categories.find((category) => category.category === "raw_snippets");
  rawSnippets.included = false;
  rawSnippets.inclusion_state = "excluded_by_policy";
  rawSnippets.count = 0;
  rawSnippets.reference = "not_included_by_metadata_only_policy";
  rawSnippets.source_derived_class = "never_collected";
  rawSnippets.source_code_disclosure = false;
  rawSnippets.redaction_state = "not_applicable";
  rawSnippets.redaction_configuration_version = "not_applicable";
  rawSnippets.retention_handling = "not collected in metadata-only mode";
  rawSnippets.limitation = "Raw Snippets are excluded by the Disclosure Policy for metadata-only mode.";
  rawSnippets.details = ["No selected files or area references are included."];
  delete rawSnippets.snippet_controls;
  resealOutboundManifest(outboundManifest);

  bundleManifest.coverage_mode = "metadata_only";
  bundleManifest.manifest_id = outboundManifest.manifest_id;
  resealBundleManifest(bundleManifest);

  vendorReceipt.evidence_bundle_id = bundleManifest.evidence_bundle_id;
  vendorReceipt.manifest_id = outboundManifest.manifest_id;
  setReceiptComparisonRow(vendorReceipt, "evidence_bundle_id", vendorReceipt.evidence_bundle_id);
  setReceiptComparisonRow(vendorReceipt, "manifest_id", vendorReceipt.manifest_id);
  vendorReceipt.coverage_mode = "metadata_only";
  vendorReceipt.disclosure_policy_summary.coverage_mode = "metadata_only";
  setReceiptComparisonRow(vendorReceipt, "coverage_mode", "metadata_only");
  setReceiptComparisonRow(vendorReceipt, "disclosure_policy_summary", disclosureSummaryComparisonValue(vendorReceipt.disclosure_policy_summary));
  resealVendorReceipt(vendorReceipt);

  return {
    normalization_run_id: "normalization_run:synthetic-demo-normalization",
    created_at: "2026-07-21T00:00:00Z",
    review_scope: reviewScope,
    scanner_finding_set: scannerFindingSet,
    bundle_manifest: bundleManifest,
    outbound_manifest: outboundManifest,
    vendor_receipt: vendorReceipt,
    vendor_receipt_signature_outcome: receiptSignatureOutcome(vendorReceipt),
    artifact_availability: {
      "artifact_ref:scanner_finding_set": {
        availability_state: "retained_review_artifact",
        source_derived_class: "retained_review_artifact"
      },
    }
  };
}

// C5-28/C5-32: same reseal discipline as above, for the extended-coverage
// submission chain. `targeted_files` moves from excluded to included with a
// full, schema-valid, semantically-consistent evidence category.
async function createExtendedNormalizationInput() {
  const reviewScope = await readFixture("valid/review-scope.json");
  const scannerFindingSet = await readFixture("valid/scanner-finding-set.json");
  const bundleManifest = await readFixture("valid/bundle-manifest.json");
  const outboundManifest = await readFixture("valid/outbound-manifest.json");
  const vendorReceipt = await readFixture("valid/vendor-receipt.json");

  outboundManifest.coverage_mode = "extended_approved_snippets_or_targeted_files";
  outboundManifest.disclosure_policy_summary.coverage_mode = "extended_approved_snippets_or_targeted_files";
  const targetedFiles = outboundManifest.evidence_categories.find((category) => category.category === "targeted_files");
  targetedFiles.included = true;
  targetedFiles.inclusion_state = "included";
  targetedFiles.count = 1;
  targetedFiles.reference = "customer_selected_targeted_files";
  targetedFiles.source_derived_class = "customer_opt_in_retained_source";
  targetedFiles.source_code_disclosure = true;
  targetedFiles.redaction_state = "redaction_configured";
  targetedFiles.redaction_configuration_version = "synthetic-demo-redaction-v0";
  targetedFiles.retention_handling = "customer opt-in retained targeted files";
  targetedFiles.limitation = "Targeted files are source-code disclosure; redaction configuration is recorded, and secret detection cannot prove absence of secrets.";
  targetedFiles.details = ["Source-code disclosure label: Targeted files.", "Customer-approved targeted file selection is included."];
  targetedFiles.snippet_controls = {
    max_snippet_chars: 2000,
    context_lines: 10,
    redaction_profile: "synthetic-demo-redaction",
    redaction_configuration_version: "synthetic-demo-redaction-v0",
    retention_class: "customer_opt_in_retained_source",
    selected_files_or_areas: ["src/app.ts"]
  };
  resealOutboundManifest(outboundManifest);

  bundleManifest.coverage_mode = "extended_approved_snippets_or_targeted_files";
  bundleManifest.manifest_id = outboundManifest.manifest_id;
  resealBundleManifest(bundleManifest);

  vendorReceipt.evidence_bundle_id = bundleManifest.evidence_bundle_id;
  vendorReceipt.manifest_id = outboundManifest.manifest_id;
  setReceiptComparisonRow(vendorReceipt, "evidence_bundle_id", vendorReceipt.evidence_bundle_id);
  setReceiptComparisonRow(vendorReceipt, "manifest_id", vendorReceipt.manifest_id);
  vendorReceipt.coverage_mode = "extended_approved_snippets_or_targeted_files";
  vendorReceipt.disclosure_policy_summary.coverage_mode = "extended_approved_snippets_or_targeted_files";
  setReceiptComparisonRow(vendorReceipt, "coverage_mode", "extended_approved_snippets_or_targeted_files");
  setReceiptComparisonRow(vendorReceipt, "disclosure_policy_summary", disclosureSummaryComparisonValue(vendorReceipt.disclosure_policy_summary));
  resealVendorReceipt(vendorReceipt);

  return {
    normalization_run_id: "normalization_run:synthetic-demo-normalization",
    created_at: "2026-07-21T00:00:00Z",
    review_scope: reviewScope,
    scanner_finding_set: scannerFindingSet,
    bundle_manifest: bundleManifest,
    outbound_manifest: outboundManifest,
    vendor_receipt: vendorReceipt,
    vendor_receipt_signature_outcome: receiptSignatureOutcome(vendorReceipt),
    artifact_availability: {
      "artifact_ref:scanner_finding_set": {
        availability_state: "retained_review_artifact",
        source_derived_class: "retained_review_artifact"
      },
      "artifact_ref:synthetic_raw_snippet": {
        availability_state: "never_collected",
        source_derived_class: "never_collected"
      }
    }
  };
}

function resealBundleManifest(bundleManifest) {
  bundleManifest.evidence_bundle_id = canonicalIdentity(bundleManifest, "evidence_bundle_id");
  return bundleManifest;
}

function resealOutboundManifest(outboundManifest) {
  outboundManifest.manifest_id = canonicalIdentity(outboundManifest, "manifest_id");
  return outboundManifest;
}

// Resealing a receipt inside an already-built normalization input moves its
// signed identity, so the outcome that authenticates that signature has to
// move with it.
function resealReceiptIn(input) {
  resealVendorReceipt(input.vendor_receipt);
  input.vendor_receipt_signature_outcome = receiptSignatureOutcome(input.vendor_receipt);
  return input;
}

function resealVendorReceipt(vendorReceipt) {
  vendorReceipt.vendor_receipt_id = canonicalReceiptIdentity(vendorReceipt);
  vendorReceipt.receipt_signature.signed_identity = vendorReceipt.vendor_receipt_id;
  vendorReceipt.public_verification_metadata.signed_identity = vendorReceipt.vendor_receipt_id;
  return vendorReceipt;
}

// D3-2: `verifiedSubmissionChainIssues` can no longer authenticate a
// receipt's signature from the receipt alone -- this pure workspace holds no
// key material and performs no I/O -- so the caller carries the
// independently produced outcome for it. Deriving it from the receipt's own
// signature envelope keeps each tamper case isolated to the field it
// tampers with.
function receiptSignatureOutcome(vendorReceipt) {
  const signature = vendorReceipt.receipt_signature;
  return {
    protocol_version: "codeattest.v0",
    signed_identity_type: signature.signed_identity_type,
    signed_identity: signature.signed_identity,
    algorithm_profile: signature.algorithm_profile,
    key_id: signature.key_id,
    key_version: signature.key_version,
    key_directory_version: 1,
    verified_at: "2026-07-21T00:00:00Z",
    result: "verified"
  };
}

function setReceiptComparisonRow(vendorReceipt, field, value) {
  const row = vendorReceipt.approved_vs_received_comparison.rows.find((entry) => entry.field === field);
  row.approved_value = value;
  row.received_value = value;
}

function disclosureSummaryComparisonValue(summary) {
  return `${summary.disclosure_policy_ref}:${summary.coverage_mode}:${summary.redaction_configuration_version}`;
}

function canonicalIdentity(value, excludedField) {
  const identityInput = JSON.parse(JSON.stringify(value));
  delete identityInput[excludedField];
  return digestBytes(canonicalizeJson(identityInput));
}

function canonicalReceiptIdentity(receipt) {
  const identityInput = structuredClone(receipt);
  delete identityInput.vendor_receipt_id;
  delete identityInput.receipt_signature;
  delete identityInput.public_verification_metadata.signed_identity;
  return digestBytes(canonicalizeJson(identityInput));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertNoForbiddenCopy(value, extraForbidden = [], allowedRequiredPhrases = []) {
  let serialized = JSON.stringify(value);
  for (const allowed of allowedRequiredPhrases) {
    // C5-38: coverage limitations projected from the scanner-finding-set
    // fixture can legitimately repeat an allowed safe-hedge phrase (e.g.
    // "does not prove/imply absence of vulnerabilities") more than once --
    // strip every occurrence, not just the first.
    serialized = serialized.replaceAll(new RegExp(allowed, allowed.flags.includes("g") ? allowed.flags : `${allowed.flags}g`), "");
  }
  for (const forbidden of [...FORBIDDEN_RESULT_COPY, ...extraForbidden]) {
    assert(!forbidden.test(serialized), `output must not include forbidden copy ${forbidden}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
