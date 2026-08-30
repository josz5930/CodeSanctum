// Convergence: Story 2.6 submission-event rules are implemented both by the
// protocol fixture gate and the pure control-plane boundary. This test prevents
// those two surfaces from drifting while keeping review-event-log as the only
// history surface.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateFixtureSemantics,
  validateSubmissionOutcomeSemantics
} from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-submission-outcome-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-submission-outcome-convergence-dist");
const cache = new Map();

const CONVERGENT_EVENT_CODES = new Map([
  ["submission_event_state_not_a_failure", "submission_event_state_not_a_failure"],
  ["submission_event_type_state_mismatch", "submission_event_type_state_mismatch"],
  ["submission_event_missing_outcome_ref", "submission_event_missing_outcome_ref"],
  ["submission_event_idempotency_key_not_derived", "submission_event_idempotency_key_not_derived"]
]);

const OUTCOME_CODES = new Set([
  "submission_outcome_receipt_required",
  "submission_outcome_failure_must_not_reference_receipt",
  "submission_outcome_failure_requires_reason_codes",
  "submission_outcome_received_must_not_carry_reason_codes",
  "submission_outcome_next_path_state_mismatch",
  "submission_outcome_summary_implies_review",
  "submission_outcome_summary_text_forbidden",
  "submission_outcome_identity_value_text_forbidden",
  "submission_outcome_duplicate_identity_type",
  "submission_outcome_identity_field_mismatch"
]);

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));
  // Schema-structural fixtures (e.g. C1-09's invalid_outcome_state enum negative) never reach
  // validateSubmissionOutcomeSemantics -- they're rejected by JSON Schema before the semantic
  // layer runs -- so they carry no Story 2.6 convergence behavior to check here.
  const negatives = (fixtureIndex.negative_fixtures ?? [])
    .filter((entry) => entry.path.includes("submission-") || entry.path.includes("review-event.submission"))
    .filter((entry) => CONVERGENT_EVENT_CODES.has(entry.expected_failure) || OUTCOME_CODES.has(entry.expected_failure));
  assert(negatives.length > 0, "there must be Story 2.6 negative fixtures to converge on");

  for (const entry of negatives) {
    const fixture = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const gateCodes = (await validateFixtureSemantics(fixture, { fixtureRoot, fixturePath: entry.path })).map((error) => error.code);
    assert(gateCodes.includes(entry.expected_failure), `${entry.path}: gate did not produce ${entry.expected_failure}; got [${gateCodes.join(", ")}]`);

    if (CONVERGENT_EVENT_CODES.has(entry.expected_failure)) {
      const boundaryReason = boundaryReasonForEvent(controlPlane, entry.path, fixture);
      assert(
        boundaryReason === CONVERGENT_EVENT_CODES.get(entry.expected_failure),
        `${entry.path}: boundary produced ${boundaryReason}, expected ${entry.expected_failure}`
      );
    } else if (OUTCOME_CODES.has(entry.expected_failure)) {
      const errors = [];
      validateSubmissionOutcomeSemantics(fixture, errors);
      assert(
        errors.some((error) => error.code === entry.expected_failure),
        `${entry.path}: outcome validator did not produce ${entry.expected_failure}`
      );
    } else {
      throw new Error(`${entry.path}: unmapped Story 2.6 negative fixture ${entry.expected_failure}`);
    }
  }

  validateMalformedOutcomeIdDoesNotBypassSemantics();
  await validateEveryMatchedOutcomeRefIsChecked();
  validateSubmissionIdentityBindingConvergence();
  validateFailureNoticeTextSafetyConvergence();
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils submission outcome convergence tests passed.");

function validateMalformedOutcomeIdDoesNotBypassSemantics() {
  const errors = [];
  validateSubmissionOutcomeSemantics({
    protocol_version: "codeattest.v0",
    submission_outcome_id: "outcome-1",
    review_id: "review:synthetic-demo-001",
    outcome_state: "quarantined_no_receipt",
    bundle_instance_id: "bundle_instance:synthetic-demo-0002",
    submission_attempt_id: "submission_attempt:synthetic-demo-0002",
    occurred_at: "2026-07-20T00:01:00Z",
    submission_identities: [],
    failure_reason_codes: [],
    next_path: "retry",
    customer_facing_summary: "This submission was quarantined before any receipt was issued."
  }, errors);
  const codes = errors.map((error) => error.code);
  assert(codes.includes("submission_outcome_failure_requires_reason_codes"), `malformed id must not bypass reason-code semantics; got [${codes.join(", ")}]`);
  assert(codes.includes("submission_outcome_next_path_state_mismatch"), `malformed id must not bypass next-path semantics; got [${codes.join(", ")}]`);
}

// C4-10: schema uniqueItems only forbids an exact (type, value) duplicate;
// this proves the mirrored protocol-utils.mjs semantic rule independently
// catches a duplicate identity_type and a bundle/attempt-value mismatch —
// no fixture exists for these yet, so this is the only convergence coverage.
function validateSubmissionIdentityBindingConvergence() {
  const base = {
    protocol_version: "codeattest.v0",
    submission_outcome_id: "submission_outcome:synthetic-demo-0099",
    review_id: "review:synthetic-demo-001",
    outcome_state: "quarantined_no_receipt",
    bundle_instance_id: "bundle_instance:synthetic-demo-0002",
    submission_attempt_id: "submission_attempt:synthetic-demo-0002",
    occurred_at: "2026-07-20T00:01:00Z",
    submission_identities: [
      { identity_type: "bundle_instance_id", identity_value: "bundle_instance:synthetic-demo-0002" },
      { identity_type: "submission_attempt_id", identity_value: "submission_attempt:synthetic-demo-0002" }
    ],
    failure_reason_codes: ["artifact_digest_mismatch"],
    next_path: "retry",
    customer_facing_summary: "This submission was quarantined before any receipt was issued."
  };

  const duplicateType = {
    ...base,
    submission_identities: [...base.submission_identities, { identity_type: "bundle_instance_id", identity_value: "bundle_instance:synthetic-demo-9999" }]
  };
  const duplicateErrors = [];
  validateSubmissionOutcomeSemantics(duplicateType, duplicateErrors);
  assert(
    duplicateErrors.some((error) => error.code === "submission_outcome_duplicate_identity_type"),
    `duplicate identity_type must be rejected; got [${duplicateErrors.map((error) => error.code).join(", ")}]`
  );

  const mismatchedValue = {
    ...base,
    submission_identities: base.submission_identities.map((row) => row.identity_type === "bundle_instance_id" ? { ...row, identity_value: "bundle_instance:synthetic-demo-9999" } : row)
  };
  const mismatchErrors = [];
  validateSubmissionOutcomeSemantics(mismatchedValue, mismatchErrors);
  assert(
    mismatchErrors.some((error) => error.code === "submission_outcome_identity_field_mismatch"),
    `identity row disagreeing with the top-level field must be rejected; got [${mismatchErrors.map((error) => error.code).join(", ")}]`
  );

  const validErrors = [];
  validateSubmissionOutcomeSemantics(base, validErrors);
  assert(
    !validErrors.some((error) => error.code === "submission_outcome_duplicate_identity_type" || error.code === "submission_outcome_identity_field_mismatch"),
    `a genuinely bound identity set must not be rejected; got [${validErrors.map((error) => error.code).join(", ")}]`
  );
}

// C4-11: append-time review-event text checks do not protect this
// independently callable projector — prove the mirrored protocol-utils.mjs
// rule independently catches raw source/secret text in the summary and in
// an identity_value, since no fixture exists yet for either new code.
function validateFailureNoticeTextSafetyConvergence() {
  const base = {
    protocol_version: "codeattest.v0",
    submission_outcome_id: "submission_outcome:synthetic-demo-0098",
    review_id: "review:synthetic-demo-001",
    outcome_state: "rejected_no_receipt",
    bundle_instance_id: "bundle_instance:synthetic-demo-0002",
    submission_attempt_id: "submission_attempt:synthetic-demo-0002",
    occurred_at: "2026-07-20T00:01:00Z",
    submission_identities: [
      { identity_type: "manifest_id", identity_value: "sha256:1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a" },
      { identity_type: "bundle_instance_id", identity_value: "bundle_instance:synthetic-demo-0002" },
      { identity_type: "submission_attempt_id", identity_value: "submission_attempt:synthetic-demo-0002" }
    ],
    failure_reason_codes: ["artifact_digest_mismatch"],
    next_path: "retry",
    customer_facing_summary: "This submission was rejected before any receipt was issued."
  };

  const forbiddenSummaryErrors = [];
  validateSubmissionOutcomeSemantics({ ...base, customer_facing_summary: "Raw scanner output showed the failure: eval('1 + 1')" }, forbiddenSummaryErrors);
  assert(
    forbiddenSummaryErrors.some((error) => error.code === "submission_outcome_summary_text_forbidden"),
    `forbidden summary text must be rejected; got [${forbiddenSummaryErrors.map((error) => error.code).join(", ")}]`
  );

  const forbiddenIdentityErrors = [];
  validateSubmissionOutcomeSemantics({
    ...base,
    submission_identities: base.submission_identities.map((row) => row.identity_type === "manifest_id" ? { ...row, identity_value: "contact support@example.com for a manual retry" } : row)
  }, forbiddenIdentityErrors);
  assert(
    forbiddenIdentityErrors.some((error) => error.code === "submission_outcome_identity_value_text_forbidden"),
    `forbidden identity_value text must be rejected; got [${forbiddenIdentityErrors.map((error) => error.code).join(", ")}]`
  );

  const validErrors = [];
  validateSubmissionOutcomeSemantics(base, validErrors);
  assert(
    !validErrors.some((error) => error.code === "submission_outcome_summary_text_forbidden" || error.code === "submission_outcome_identity_value_text_forbidden"),
    `a genuinely clean outcome must not be rejected; got [${validErrors.map((error) => error.code).join(", ")}]`
  );
}

async function validateEveryMatchedOutcomeRefIsChecked() {
  const rejectedEvent = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "invalid", "review-event.submission-type-state-mismatch.json"), "utf8"));
  const errors = await validateFixtureSemantics({
    ...rejectedEvent,
    event_type: "submission_rejected",
    artifact_refs: ["artifact_ref:synthetic-demo-0001", "artifact_ref:synthetic-demo-0002"]
  }, { fixtureRoot, fixturePath: "in-memory/review-event.multiple-outcome-refs.json" });
  const codes = errors.map((error) => error.code);
  assert(codes.includes("submission_event_type_state_mismatch"), `all matched outcome refs must be checked; got [${codes.join(", ")}]`);
}

function boundaryReasonForEvent(controlPlane, fixturePath, event) {
  const outcomes = {
    "synthetic-demo-0001": readCached("valid/submission-outcome.rejected-no-receipt.json"),
    "synthetic-demo-0002": readCached("valid/submission-outcome.quarantined-no-receipt.json"),
    "synthetic-demo-0003": readCached("valid/submission-outcome.received-with-receipt.json")
  };
  const ref = (event.artifact_refs ?? []).find((value) => typeof value === "string" && value.startsWith("artifact_ref:synthetic-demo-"));
  const outcome = outcomes[ref?.slice("artifact_ref:".length)] ?? outcomes["synthetic-demo-0001"];
  const result = controlPlane.buildSubmissionOutcomeEvent(outcome, {
    event_id: event.event_id,
    sequence_number: event.sequence_number,
    actor: event.actor,
    visibility: event.visibility,
    event_type: event.event_type,
    event_timestamp: event.event_timestamp,
    artifact_refs: event.artifact_refs,
    idempotency_key: event.idempotency_key
  });
  if (result.outcome === "rejected") {
    return result.reason;
  }
  throw new Error(`${fixturePath}: negative fixture unexpectedly built a submission event`);
}

function readCached(relativePath) {
  if (!cache.has(relativePath)) {
    const absolute = path.join(fixtureRoot, "v0", relativePath);
    cache.set(relativePath, JSON.parse(execFileSync(process.execPath, ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(absolute)}, 'utf8'))`], { encoding: "utf8" })));
  }
  return cache.get(relativePath);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
