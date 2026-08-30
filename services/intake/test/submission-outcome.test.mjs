// Story 2.6 AC1: a submission that failed before receipt can only become
// `rejected_no_receipt` or `quarantined_no_receipt`, and no argument shape
// produces `received_with_receipt` without a minted receipt.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { CLAIM_SAFE_FORBIDDEN_PHRASES } from "../../../scripts/lib/protocol-utils.mjs";
import { receiptOutcomeFor } from "./helpers/receipt-fixtures.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-submission-outcome-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "intake-service-submission-outcome-test-dist");

const MANIFEST_ID = `sha256:${"1a".repeat(32)}`;
const BUNDLE_ID = `sha256:${"2b".repeat(32)}`;

const verifiedResult = {
  state: "verified_receipt_eligible",
  reason_codes: [],
  verification_summary: "verification_passed_receipt_eligible",
  intake_record: {
    projection_state: "verified_receipt_eligible",
    manifest_id: MANIFEST_ID,
    evidence_bundle_id: BUNDLE_ID,
    bundle_instance_id: "bundle_instance:synthetic-demo-0003",
    submission_attempt_id: "submission_attempt:synthetic-demo-0003"
  },
  next_path: "generate_receipt_in_story_2_3"
};

const rejectedResult = {
  state: "rejected_no_receipt",
  reason_codes: ["artifact_digest_mismatch"],
  affected_identity: { manifest_id: MANIFEST_ID, evidence_bundle_id: BUNDLE_ID, review_request_id: "review_request:demo-1" },
  next_path: "retry"
};

const quarantinedResult = {
  state: "quarantined_no_receipt",
  reason_codes: ["environment_gate_real_evidence_not_allowed"],
  affected_identity: { manifest_id: MANIFEST_ID },
  next_path: "quarantine_support"
};

const baseRequest = {
  review_id: "review:synthetic-demo-001",
  submission_outcome_id: "submission_outcome:synthetic-demo-0001",
  occurred_at: "2026-07-20T00:00:00Z",
  bundle_instance_id: "bundle_instance:synthetic-demo-0001",
  submission_attempt_id: "submission_attempt:synthetic-demo-0001"
};

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
  assert(typeof intake.buildSubmissionOutcome === "function", "buildSubmissionOutcome must be exported");

  const verifiedReceipt = await readFixture("valid/vendor-receipt.json");

  await testVerifiedWithReceipt(intake, verifiedReceipt);
  await testForgedReceiptIsRefused(intake);
  await testReceiptEligibleWithoutReceiptIsRefused(intake);
  await testReceiptSpliceIsRefused(intake, verifiedReceipt);
  await testMalformedIntakeRecordDoesNotThrow(intake, verifiedReceipt);
  await testCallerMutationAfterInvocationDoesNotAffectOutcome(intake, verifiedReceipt);
  await testOccurredBeforeReceiptIsRefused(intake, verifiedReceipt);
  await testMalformedIdentityGrammarIsRefused(intake);
  await testRejectedOutcome(intake);
  await testQuarantinedOutcome(intake);
  await testFailureNeedsIdentityAndReasonCodes(intake);
  await testInvalidFailureStateIsRefused(intake);
  await testFailureCopyIsClaimSafe(intake);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("intake submission outcome tests passed.");

async function testVerifiedWithReceipt(intake, verifiedReceipt) {
  const resultForReceipt = verifiedResultForReceipt(verifiedReceipt);
  const result = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: resultForReceipt,
    vendor_receipt: verifiedReceipt,
    vendor_receipt_signature_outcome: receiptOutcomeFor(verifiedReceipt.receipt_signature)
  });
  const outcome = expectOutcome(result);
  assert(outcome.outcome_state === "received_with_receipt", "a verified result with a verified receipt is received_with_receipt");
  assert(outcome.vendor_receipt_ref === verifiedReceipt.vendor_receipt_id, "the verified receipt reference must be carried");
  assert(outcome.failure_reason_codes === undefined, "a received outcome carries no failure reason codes");
  assert(outcome.next_path === "verify_receipt", "a received outcome points at receipt verification");
  // The verified path takes its identity from the intake record, not from the
  // caller: the accepted identity is the one intake actually verified.
  assert(outcome.bundle_instance_id === resultForReceipt.intake_record.bundle_instance_id, "identity comes from the intake record");
}

async function testForgedReceiptIsRefused(intake) {
  const result = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: verifiedResult,
    vendor_receipt: { vendor_receipt_id: `sha256:${"3c".repeat(32)}` }
  });
  assert(result.outcome === undefined, "a fabricated receipt object must not build a received outcome");
  assert(result.reason === "submission_outcome_receipt_invalid", `expected submission_outcome_receipt_invalid; got ${result.reason}`);
}

/** The AC1 guard: receipt-eligible is not received. */
async function testReceiptEligibleWithoutReceiptIsRefused(intake) {
  for (const vendorReceipt of [undefined, null, "receipt", 7]) {
    const result = await intake.buildSubmissionOutcome({ ...baseRequest, result: verifiedResult, vendor_receipt: vendorReceipt });
    assert(result.outcome === undefined, `a receipt-eligible result with ${String(vendorReceipt)} as receipt must not build an outcome`);
    assert(result.reason === "submission_outcome_receipt_required", `expected submission_outcome_receipt_required; got ${result.reason}`);
  }
}

// C5-17: a receipt that is fully valid on its own must still be refused if
// its identities do not bind exactly to the intake record this outcome is
// being built for -- otherwise a valid receipt from one submission could be
// spliced into another submission's outcome.
async function testReceiptSpliceIsRefused(intake, verifiedReceipt) {
  const splicedResult = {
    ...verifiedResult,
    intake_record: {
      ...verifiedResult.intake_record,
      manifest_id: `sha256:${"4d".repeat(32)}`,
      evidence_bundle_id: verifiedReceipt.evidence_bundle_id,
      bundle_instance_id: verifiedReceipt.bundle_instance_id,
      submission_attempt_id: verifiedReceipt.submission_attempt_id
    }
  };
  const result = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: splicedResult,
    vendor_receipt: verifiedReceipt,
    vendor_receipt_signature_outcome: receiptOutcomeFor(verifiedReceipt.receipt_signature)
  });
  assert(result.outcome === undefined, "a receipt whose identities do not match the intake record must not build an outcome");
  assert(result.reason === "submission_outcome_receipt_mismatch", `expected submission_outcome_receipt_mismatch; got ${result.reason}`);
}

// C5-18: a verified_receipt_eligible result with a missing/null/partial
// intake_record must return a typed rejection, never throw.
async function testMalformedIntakeRecordDoesNotThrow(intake, verifiedReceipt) {
  for (const intakeRecord of [undefined, null, {}, { manifest_id: MANIFEST_ID }]) {
    let result;
    try {
      result = await intake.buildSubmissionOutcome({
        ...baseRequest,
        result: { ...verifiedResult, intake_record: intakeRecord },
        vendor_receipt: verifiedReceipt,
    vendor_receipt_signature_outcome: receiptOutcomeFor(verifiedReceipt.receipt_signature)
      });
    } catch (error) {
      assert(false, `buildSubmissionOutcome must not throw on a malformed intake_record; threw ${error}`);
    }
    assert(result.outcome === undefined, "a malformed intake_record must not build an outcome");
    assert(result.reason === "submission_outcome_input_invalid", `expected submission_outcome_input_invalid; got ${result.reason}`);
  }
}

// C5-19: the complete request is cloned before the first `await` (the
// receipt-verification digest), so mutating the caller's own objects
// immediately after invocation must not affect the in-flight result.
async function testCallerMutationAfterInvocationDoesNotAffectOutcome(intake, verifiedReceipt) {
  const resultForReceipt = verifiedResultForReceipt(verifiedReceipt);
  const originalManifestId = resultForReceipt.intake_record.manifest_id;
  const request = { ...baseRequest, result: resultForReceipt, vendor_receipt: verifiedReceipt, vendor_receipt_signature_outcome: receiptOutcomeFor(verifiedReceipt.receipt_signature) };
  const resultPromise = intake.buildSubmissionOutcome(request);
  request.result.intake_record.manifest_id = `sha256:${"5e".repeat(32)}`;
  request.occurred_at = "1970-01-01T00:00:00Z";
  const outcome = expectOutcome(await resultPromise);
  assert(
    outcome.submission_identities.some((identity) => identity.identity_type === "manifest_id" && identity.identity_value === originalManifestId),
    "post-invocation mutation of the caller's own object must not affect an in-flight outcome build"
  );
}

// C5-20: a receipt-backed success must not predate the receipt it reports.
async function testOccurredBeforeReceiptIsRefused(intake, verifiedReceipt) {
  const resultForReceipt = verifiedResultForReceipt(verifiedReceipt);
  const result = await intake.buildSubmissionOutcome({
    ...baseRequest,
    occurred_at: "2020-01-01T00:00:00Z",
    result: resultForReceipt,
    vendor_receipt: verifiedReceipt,
    vendor_receipt_signature_outcome: receiptOutcomeFor(verifiedReceipt.receipt_signature)
  });
  assert(result.outcome === undefined, "an outcome that predates its own receipt must be refused");
  assert(result.reason === "submission_outcome_occurred_before_receipt", `expected submission_outcome_occurred_before_receipt; got ${result.reason}`);
}

// C5-22: a present-but-grammar-invalid identity value must reject the whole
// outcome rather than silently being omitted from it.
async function testMalformedIdentityGrammarIsRefused(intake) {
  const badManifestId = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: { ...rejectedResult, affected_identity: { ...rejectedResult.affected_identity, manifest_id: "secret=leaked-token-material" } }
  });
  assert(badManifestId.outcome === undefined, "a manifest_id that does not match the sha256 grammar must be refused, not silently omitted");
  assert(badManifestId.reason === "submission_outcome_input_invalid", `expected submission_outcome_input_invalid; got ${badManifestId.reason}`);

  const badReviewRequestId = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: { ...rejectedResult, affected_identity: { ...rejectedResult.affected_identity, review_request_id: "alice@example.com" } }
  });
  assert(badReviewRequestId.outcome === undefined, "a review_request_id that does not match the canonical grammar must be refused");
  assert(badReviewRequestId.reason === "submission_outcome_input_invalid", `expected submission_outcome_input_invalid; got ${badReviewRequestId.reason}`);
}

async function testRejectedOutcome(intake) {
  const outcome = expectOutcome(await intake.buildSubmissionOutcome({ ...baseRequest, result: rejectedResult }));
  assert(outcome.outcome_state === "rejected_no_receipt", "a rejected result stays rejected_no_receipt");
  assert(outcome.vendor_receipt_ref === undefined, "a failed outcome must reference no receipt");
  assertSameSet(outcome.failure_reason_codes, ["artifact_digest_mismatch"]);
  assert(outcome.next_path === "retry", "a rejected outcome offers retry");
  assertSameSet(
    outcome.submission_identities.map((identity) => identity.identity_type),
    ["manifest_id", "evidence_bundle_id", "review_request_id", "bundle_instance_id", "submission_attempt_id"]
  );
}

async function testQuarantinedOutcome(intake) {
  const outcome = expectOutcome(await intake.buildSubmissionOutcome({ ...baseRequest, result: quarantinedResult }));
  assert(outcome.outcome_state === "quarantined_no_receipt", "a quarantined result stays quarantined_no_receipt");
  assert(outcome.vendor_receipt_ref === undefined, "a quarantined outcome must reference no receipt");
  assert(outcome.next_path === "quarantine_support", "a quarantined outcome offers the quarantine support path");
  // A quarantined submission that named only one identity still names it, so a
  // notice built from it is never identity-less.
  assert(outcome.submission_identities.length >= 1, "at least one identity must survive");
}

async function testFailureNeedsIdentityAndReasonCodes(intake) {
  // `FailedIntakeResult` carries no bundle/attempt identity of its own, so a
  // caller that omits it gets a rejection rather than an outcome with a
  // fabricated identity.
  const noIdentity = await intake.buildSubmissionOutcome({
    ...baseRequest,
    bundle_instance_id: undefined,
    submission_attempt_id: undefined,
    result: rejectedResult
  });
  assert(noIdentity.reason === "submission_outcome_input_invalid", `expected submission_outcome_input_invalid; got ${noIdentity.reason}`);

  const noCodes = await intake.buildSubmissionOutcome({ ...baseRequest, result: { ...rejectedResult, reason_codes: [] } });
  assert(noCodes.reason === "submission_outcome_input_invalid", `a failure with no reason codes is not reportable; got ${noCodes.reason}`);

  const badId = await intake.buildSubmissionOutcome({ ...baseRequest, submission_outcome_id: "outcome-1", result: rejectedResult });
  assert(badId.reason === "submission_outcome_schema_invalid", `the schema backstop must catch a malformed id; got ${badId.reason}`);
}

async function testInvalidFailureStateIsRefused(intake) {
  const result = await intake.buildSubmissionOutcome({
    ...baseRequest,
    result: { ...rejectedResult, state: "received_with_receipt" }
  });
  assert(result.outcome === undefined, "a caller-supplied non-intake failure state must not flow into outcome_state");
  assert(result.reason === "submission_outcome_input_invalid", `expected submission_outcome_input_invalid; got ${result.reason}`);
}

/**
 * Failure copy must never read as a review outcome, checked against the shared
 * forbidden-phrase list rather than a second copy of it.
 */
async function testFailureCopyIsClaimSafe(intake) {
  for (const result of [rejectedResult, quarantinedResult]) {
    const outcome = expectOutcome(await intake.buildSubmissionOutcome({ ...baseRequest, result }));
    const summary = outcome.customer_facing_summary.toLowerCase();
    for (const phrase of CLAIM_SAFE_FORBIDDEN_PHRASES) {
      assert(!summary.includes(phrase), `${result.state} summary must not contain claim-unsafe phrase: ${phrase}`);
    }
  }
}

function verifiedResultForReceipt(receipt) {
  return {
    ...verifiedResult,
    intake_record: {
      ...verifiedResult.intake_record,
      manifest_id: receipt.manifest_id,
      evidence_bundle_id: receipt.evidence_bundle_id,
      bundle_instance_id: receipt.bundle_instance_id,
      submission_attempt_id: receipt.submission_attempt_id
    }
  };
}

function expectOutcome(result) {
  assert(result.outcome !== undefined, `expected an outcome; got ${JSON.stringify(result)}`);
  return result.outcome;
}

function assertSameSet(actual, expected) {
  const actualSet = new Set(actual);
  assert(actualSet.size === expected.length, `expected ${expected.length} entries; got ${JSON.stringify(actual)}`);
  for (const item of expected) {
    assert(actualSet.has(item), `expected ${item} in ${JSON.stringify(actual)}`);
  }
}

async function readFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
