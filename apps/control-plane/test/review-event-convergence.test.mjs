// Convergence: the append/identity/visibility rules for a review event log are
// implemented twice — once in `scripts/lib/protocol-utils.mjs` (fixture/gate
// validator, hashing via `node:crypto`) and once in
// `apps/control-plane/src/index.ts` (append boundary, hashing via
// `globalThis.crypto.subtle`). `protocol/fixtures/v0/invariants.json` lists
// both under `javascript_coverage` as if they were one surface, but nothing
// asserted the two agree, so a drift between them was invisible to CI.
//
// This drives every negative `review-event-log` fixture through BOTH layers and
// asserts they reject the same fixture for the corresponding reason.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateReviewEventLogSemantics, validateReviewEventSemantics } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-review-event-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-convergence-dist");

// Validator code -> the boundary rejection reason that must cover the same fixture.
const CONVERGENT_CODES = new Map([
  ["review_event_log_sequence_not_monotonic", "review_event_log_sequence_not_monotonic"],
  ["review_event_log_duplicate_event_id", "review_event_log_duplicate_event_id"],
  ["review_event_identity_mismatch", "review_event_identity_mismatch"],
  ["review_event_log_review_id_mismatch", "review_event_log_review_id_mismatch"],
  ["review_event_log_supersedes_unknown_event", "review_event_log_supersedes_unknown_event"],
  ["customer_event_cannot_supersede_classification", "customer_event_cannot_supersede_classification"],
  ["customer_event_cannot_supersede_expert_record", "customer_event_cannot_supersede_expert_record"],
  ["review_event_internal_note_requires_internal_only", "review_event_internal_note_requires_internal_only"],
  ["review_event_reason_raw_source_text_forbidden", "review_event_reason_raw_source_text_forbidden"],
  ["review_event_reason_claim_unsafe_text_forbidden", "review_event_reason_claim_unsafe_text_forbidden"],
  ["review_event_classification_reviewer_actor_required", "review_event_classification_reviewer_actor_required"],
  ["review_event_remediation_guidance_reviewer_actor_required", "review_event_remediation_guidance_reviewer_actor_required"],
  ["review_event_customer_remediation_actor_required", "review_event_customer_remediation_actor_required"],
  ["review_event_false_positive_reviewer_actor_required", "review_event_false_positive_reviewer_actor_required"],
  ["review_event_accepted_risk_customer_evidence_required", "review_event_accepted_risk_customer_evidence_required"],
  ["review_event_outcome_supersedes_family_mismatch", "review_event_outcome_supersedes_family_mismatch"],
  ["review_event_verification_scope_supersedes_family_mismatch", "review_event_verification_scope_supersedes_family_mismatch"],
  ["review_event_verification_scope_version_invalid", "review_event_verification_scope_version_invalid"],
  ["review_event_verification_scope_actor_required", "review_event_verification_scope_actor_required"],
  ["review_event_verification_scope_customer_backing_required", "review_event_verification_scope_customer_backing_required"],
  ["review_event_verification_scope_reason_claim_unsafe_text_forbidden", "review_event_verification_scope_reason_claim_unsafe_text_forbidden"],
  ["review_event_verification_record_version_invalid", "review_event_verification_record_version_invalid"],
  ["review_event_missing_source_derived_class", "review_event_missing_source_derived_class"],
  ["review_event_identity_excludes_invalid", "review_event_identity_excludes_invalid"],
  ["review_event_typed_artifact_ref_mismatch", "review_event_schema_invalid"],
  // Same judgment under different names: a stored log repeating an
  // `idempotency_key` across two *different* bodies is a duplicate to the
  // validator and a conflict to the boundary. Both reject.
  ["review_event_log_duplicate_idempotency_key", "review_event_log_idempotency_key_conflict"]
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
  assertClassificationSupersedesFailureMappingIsExact(await readFile(path.join(repoRoot, "scripts", "protocol-check.mjs"), "utf8"));

  const negativeLogFixtures = (fixtureIndex.negative_fixtures ?? [])
    // Calendar/enum fixtures are schema-structural coverage and intentionally
    // do not claim a hand-written review-event semantic failure code.
    .filter((entry) => entry.path.includes("review-event-log.") && CONVERGENT_CODES.has(entry.expected_failure));
  assert(negativeLogFixtures.length > 0, "there must be negative review-event-log fixtures to converge on");

  const exercisedCodes = new Set();

  for (const entry of negativeLogFixtures) {
    const log = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const name = entry.path.split("/").pop();

    // Layer 1: the fixture/gate validator must produce the indexed code.
    const validatorErrors = [];
    validateReviewEventLogSemantics(log, validatorErrors);
    for (const event of log.events ?? []) {
      validateReviewEventSemantics(event, validatorErrors);
    }
    const validatorCodes = new Set(validatorErrors.map((error) => error.code));
    assert(
      validatorCodes.has(entry.expected_failure),
      `${name}: validator must produce ${entry.expected_failure}, got [${[...validatorCodes].join(", ")}]`
    );

    // Layer 2: replaying the same events through the append boundary.
    const outcome = await replayThroughBoundary(controlPlane, log);

    const expectedReason = CONVERGENT_CODES.get(entry.expected_failure);
    assert(
      expectedReason !== undefined,
      `${name}: ${entry.expected_failure} is neither mapped as convergent nor declared divergent by design; the two layers may have drifted`
    );
    assert(
      outcome.rejected === expectedReason,
      `${name}: boundary must reject with ${expectedReason} to match validator ${entry.expected_failure}, got ${outcome.rejected}`
    );
    exercisedCodes.add(entry.expected_failure);
  }

  const missingCodes = [...CONVERGENT_CODES.keys()].filter((code) => !exercisedCodes.has(code));
  assert(
    missingCodes.length === 0,
    `every convergent code must be exercised by at least one fixture; missing [${missingCodes.join(", ")}]`
  );

  await testIdempotentReplayIsComplementary(controlPlane, fixtureRoot);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils review event convergence tests passed.");

/**
 * The one place the two layers legitimately differ, asserted rather than left
 * implicit. Replaying the *same* body under an already-used `idempotency_key`
 * is a no-op at the append boundary — there is nothing to persist, so no
 * duplicate ever reaches a stored log for the validator to object to. The
 * validator has no equivalent case because it only ever sees stored logs.
 */
async function testIdempotentReplayIsComplementary(controlPlane, fixtureRoot) {
  const validLog = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", "review-event-log.json"), "utf8"));
  const seeded = { protocol_version: validLog.protocol_version, review_id: validLog.review_id, events: validLog.events.slice(0, 2) };
  const replayed = validLog.events[1];

  const result = await controlPlane.appendReviewEvent(seeded, replayed);
  assert(
    result.outcome === "idempotent_noop",
    `replaying an identical body under a used idempotency_key must be a no-op, got ${result.outcome}`
  );
  assert(result.log.events.length === seeded.events.length, "an idempotent no-op must not grow the log");

  const validatorErrors = [];
  validateReviewEventLogSemantics(result.log, validatorErrors);
  assert(
    !validatorErrors.some((error) => error.code === "review_event_log_duplicate_idempotency_key"),
    "the log left by an idempotent no-op must stay clean under the validator"
  );
}

/** Replays a fixture log event-by-event through the append boundary. */
async function replayThroughBoundary(controlPlane, log) {
  let current = { protocol_version: log.protocol_version, review_id: log.review_id, events: [] };
  let idempotentNoops = 0;

  for (const event of log.events ?? []) {
    const result = await controlPlane.appendReviewEvent(current, event);
    if (result.outcome === "rejected") {
      return { rejected: result.reason, idempotentNoops };
    }
    if (result.outcome === "idempotent_noop") {
      idempotentNoops += 1;
    }
    current = result.log;
  }
  return { rejected: undefined, idempotentNoops };
}

function assertClassificationSupersedesFailureMappingIsExact(protocolCheckSource) {
  const match = /customer_event_cannot_supersede_classification:\s*\[([^\]]+)\]/.exec(protocolCheckSource);
  assert(match !== null, "protocol-check must explicitly map customer_event_cannot_supersede_classification");
  const mappedCodes = Array.from(match[1].matchAll(/"([^"]+)"/g), (codeMatch) => codeMatch[1]);
  assert(
    JSON.stringify(mappedCodes) === JSON.stringify(["customer_event_cannot_supersede_classification"]),
    `classification-supersedes fixtures must not silently accept generic expert-record failures; got [${mappedCodes.join(", ")}]`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
