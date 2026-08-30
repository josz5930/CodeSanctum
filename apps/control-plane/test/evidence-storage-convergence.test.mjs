// Convergence: the Story 2.5 evidence-storage rules are implemented twice —
// once in `scripts/lib/protocol-utils.mjs` (fixture/gate validator) and once in
// `apps/control-plane/src/index.ts` (the pure boundary).
// `protocol/fixtures/v0/invariants.json` lists both under `javascript_coverage`
// as if they were one surface, so a drift between them would otherwise be
// invisible to CI.
//
// This drives every negative Story 2.5 fixture through BOTH layers and asserts
// they reject the same fixture for the corresponding reason, and drives every
// valid fixture through both asserting neither rejects. It fails loudly if a
// fixture appears whose expected failure is not mapped here, so adding a rule
// to one layer and not the other cannot pass silently.
//
// It also pins leak-safety on the layer that actually interpolates values: the
// validator messages. The boundary emits fixed reason codes; the validators
// build human-readable strings out of fixture fields, which is where a raw
// snippet or a secret could escape into a log-shaped string.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateEvidenceLifecycleEventSemantics,
  validateEvidenceMinimizationProjectionSemantics,
  validateRetentionOptInRecordSemantics,
  validateStoredObjectClassificationSemantics
} from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-evidence-storage-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-evidence-convergence-dist");

const STORY_25_FIXTURE_PREFIXES = [
  "stored-object-classification.",
  "evidence-lifecycle-event.",
  "deletion-evidence",
  "retention-opt-in-record",
  "evidence-minimization-projection"
];

// Validator code -> the boundary rejection reason that must cover the same fixture.
const CONVERGENT_CODES = new Map([
  ["stored_object_forbidden_source_class", "stored_object_forbidden_source_class"],
  ["stored_object_opt_in_not_allowed", "stored_object_opt_in_not_allowed"],
  ["deletion_event_missing_deletion_evidence", "deletion_event_missing_deletion_evidence"],
  ["access_event_missing_scope", "access_event_missing_scope"],
  ["access_event_scope_mismatch", "access_event_scope_mismatch"],
  ["evidence_event_missing_source_derived_class", "evidence_event_missing_source_derived_class"],
  ["retention_period_invalid", "retention_period_invalid"],
  ["minimization_category_class_mismatch", "minimization_category_class_mismatch"],
  ["minimization_deleted_without_evidence", "minimization_deleted_without_evidence"],
  ["minimization_artifact_category_conflict", "minimization_artifact_category_conflict"]
]);

// Fixtures whose rejection is schema-shaped, so the validator layer leaves it to
// the JSON Schema pass while the boundary reports its schema backstop reason.
// Keyed by fixture file name, not by `expected_failure`: generic schema codes
// like `required` recur across artifacts, so keying on them would silently
// assert a future fixture against the wrong artifact's backstop reason.
const SCHEMA_ONLY_FIXTURES = new Map([
  ["retention-opt-in-record.missing-period.json", "retention_opt_in_schema_invalid"],
  ["retention-opt-in-record.wrong-source-class.json", "retention_opt_in_schema_invalid"]
]);

// Deletion Evidence has no cross-field rule and no boundary entry point that
// takes one on its own — the JSON Schema gate is its whole contract. Its
// negatives are still asserted here to be schema-shaped and to reach no
// boundary rule, so a future cross-field rule cannot be added on one layer only.
const GATE_ONLY_FIXTURE_PREFIX = "deletion-evidence";

// Rejection reasons the boundary owns alone, each because the rule needs state
// no single fixture can carry. Listing them explicitly is what keeps the
// convergence claim honest: a reason that is neither convergent nor listed here
// is a rule that landed on one layer without anyone deciding it should.
const STORY_25_REASON_TYPES = [
  "StoredObjectRejectionReason",
  "EvidenceLifecycleAppendRejectionReason",
  "RetentionOptInRejectionReason",
  "EvidenceAccessDenialReason",
  "MinimizationProjectionRejectionReason"
];

const BOUNDARY_ONLY_REASONS = new Map([
  // Needs a prior log to compare against.
  ["evidence_event_not_append_only", "append-only discipline is a property of a log, not of one event"],
  // A single event has no "other events" to share (or conflict on) a review_id
  // with; this rule only has meaning across at least two entries in a log.
  ["evidence_event_review_id_mismatch", "cross-review binding is a property of a log, not of one event"],
  // Needs the supplied Deletion Evidence set as a second argument.
  ["minimization_deletion_evidence_unresolved", "resolution is checked against evidence passed alongside the projection"],
  // Needs the supplied retention_opt_in_records/deletion_evidence companion
  // context (third argument); no single fixture can express a missing,
  // wrong, skeletal, out-of-window, unverified, actor-mismatched, or
  // timestamp-mismatched companion without that call-site argument.
  ["retention_event_missing_retention_record", "resolution is checked against companion context passed alongside the event"],
  ["retention_event_record_unresolved", "resolution is checked against companion context passed alongside the event"],
  ["deletion_event_deletion_evidence_unresolved", "resolution is checked against companion context passed alongside the event"],
  // The record carries no `environment_profile`, so the pilot-profile gate is a
  // call-site parameter the validator structurally cannot see. This is the same
  // limitation `invariants.json` records for
  // `retention-opt-in-requires-period-and-approval`.
  ["retention_opt_in_not_allowed", "the opt-in record does not carry the profile that authorized it"],
  // Access enforcement takes a request, which is not a protocol artifact.
  ["access_request_invalid", "access requests have no fixture representation"],
  ["access_denied_out_of_scope", "access requests have no fixture representation"],
  ["access_denied_role_not_permitted", "access requests have no fixture representation"],
  ["access_event_not_appendable", "access requests have no fixture representation"],
  // Schema backstops; the JSON Schema gate covers the same ground on fixtures.
  ["stored_object_schema_invalid", "schema backstop"],
  ["evidence_event_schema_invalid", "schema backstop"],
  ["retention_opt_in_schema_invalid", "schema backstop"],
  ["minimization_projection_schema_invalid", "schema backstop"]
]);

// Strings that must never reach a validator message, injected into every
// free-text field a Story 2.5 message could interpolate.
const LEAK_SENTINELS = [
  "api_key=AKIAIOSFODNN7EXAMPLE",
  "-----BEGIN PRIVATE KEY-----",
  "function vulnerable() { eval(untrusted); }",
  "password=hunter2"
];
const LEAKABLE_TEXT_FIELDS = ["purpose", "customer_approval_ref", "idempotency_key", "evidence_boundary"];

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

  // C4-06: appendEvidenceLifecycleEvent now resolves retention/deletion
  // companions, so a *valid* deleted/retention-status-changed fixture needs
  // matching companion context to keep converging on "not rejected".
  const lifecycleContext = {
    retention_opt_in_records: [JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", "retention-opt-in-record.json"), "utf8"))],
    deletion_evidence: [JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", "deletion-evidence.json"), "utf8"))]
  };

  const negatives = (fixtureIndex.negative_fixtures ?? []).filter((entry) => {
    if (!isStory25Fixture(entry)) return false;
    const name = entry.path.split("/").pop();
    return name.startsWith(GATE_ONLY_FIXTURE_PREFIX) ||
      SCHEMA_ONLY_FIXTURES.has(name) ||
      CONVERGENT_CODES.has(entry.expected_failure);
  });
  const positives = (fixtureIndex.valid_fixtures ?? []).filter(isStory25Fixture);
  assert(negatives.length > 0, "there must be negative Story 2.5 fixtures to converge on");
  assert(positives.length > 0, "there must be valid Story 2.5 fixtures to converge on");

  let convergentChecked = 0;
  const negativeFixtures = new Map();

  for (const entry of negatives) {
    const fixture = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    negativeFixtures.set(entry.path, fixture);
    const name = entry.path.split("/").pop();

    // Gate-only artifacts have no boundary rule to converge on. Assert exactly
    // that, so adding one later trips this test instead of passing unnoticed.
    if (name.startsWith(GATE_ONLY_FIXTURE_PREFIX)) {
      assert(
        CONVERGENT_CODES.get(entry.expected_failure) === undefined,
        `${name} is gate-only but expects ${entry.expected_failure}, a convergent code — give it a boundary entry point or change its expectation`
      );
      assert(
        boundaryReasonFor(controlPlane, entry.path, fixture, lifecycleContext) === undefined,
        `${name} is declared gate-only, but the boundary now rejects it — converge the rule or drop the gate-only declaration`
      );
      convergentChecked += 1;
      continue;
    }

    const schemaOnlyReason = SCHEMA_ONLY_FIXTURES.get(name);
    const expectedBoundaryReason = schemaOnlyReason ?? CONVERGENT_CODES.get(entry.expected_failure);
    assert(
      expectedBoundaryReason !== undefined,
      `${name} expects ${entry.expected_failure}, which is not mapped in this convergence test — map it or fix the layer that lost the rule`
    );

    // Layer 1: the fixture/gate validator.
    const validatorCodes = validatorCodesFor(fixture);
    if (schemaOnlyReason === undefined) {
      assert(
        validatorCodes.includes(entry.expected_failure),
        `${name}: the protocol-utils validator did not produce ${entry.expected_failure}; got [${validatorCodes.join(", ")}]`
      );
    }

    // Layer 2: the control-plane boundary.
    const boundaryReason = boundaryReasonFor(controlPlane, entry.path, fixture, lifecycleContext);
    assert(
      boundaryReason === expectedBoundaryReason,
      `${name}: the control-plane boundary reported ${boundaryReason}, expected ${expectedBoundaryReason}`
    );
    convergentChecked += 1;
  }

  assert(convergentChecked === negatives.length, "every negative Story 2.5 fixture must be checked on both layers");

  // Both layers must also agree on acceptance, or a rule present in only one of
  // them would show up as a false rejection rather than a missed one.
  for (const entry of positives) {
    const fixture = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const name = entry.path.split("/").pop();

    assert(
      validatorCodesFor(fixture).length === 0,
      `${name}: the protocol-utils validator rejected a valid fixture`
    );
    const boundaryReason = boundaryReasonFor(controlPlane, entry.path, fixture, lifecycleContext);
    assert(boundaryReason === undefined, `${name}: the control-plane boundary rejected a valid fixture (${boundaryReason})`);
  }

  testValidatorMessagesAreLeakSafe(negativeFixtures);
  await testEveryBoundaryReasonIsAccountedFor();
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils evidence storage convergence tests passed.");

/**
 * Validator messages interpolate fixture values, so they are the Story 2.5
 * surface where source-derived content could escape into a log-shaped string.
 * Poison every free-text field a message could reach and assert nothing echoes.
 */
function testValidatorMessagesAreLeakSafe(negativeFixtures) {
  assert(negativeFixtures.size > 0, "leak-safety needs fixtures that actually produce messages");
  let messagesChecked = 0;

  for (const sentinel of LEAK_SENTINELS) {
    for (const [fixturePath, original] of negativeFixtures) {
      const fixture = poison(structuredClone(original), sentinel);
      const errors = [];
      validateStoredObjectClassificationSemantics(fixture, errors);
      validateEvidenceLifecycleEventSemantics(fixture, errors);
      validateRetentionOptInRecordSemantics(fixture, errors);
      validateEvidenceMinimizationProjectionSemantics(fixture, errors);

      for (const error of errors) {
        assert(
          !error.message.includes(sentinel),
          `${fixturePath}: validator message echoed source-derived content: ${error.code}`
        );
        assert(typeof error.code === "string" && /^[a-z0-9_]+$/.test(error.code), `error codes must be stable identifiers; got ${error.code}`);
        messagesChecked += 1;
      }
    }
  }

  assert(messagesChecked > 0, "the leak-safety check must actually inspect emitted messages");
}

function poison(value, sentinel) {
  if (Array.isArray(value)) {
    for (const item of value) {
      poison(item, sentinel);
    }
    return value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEAKABLE_TEXT_FIELDS.includes(key) && typeof child === "string") {
      value[key] = `${child} ${sentinel}`;
    } else {
      poison(child, sentinel);
    }
  }
  return value;
}

function validatorCodesFor(fixture) {
  const errors = [];
  validateStoredObjectClassificationSemantics(fixture, errors);
  validateEvidenceLifecycleEventSemantics(fixture, errors);
  validateRetentionOptInRecordSemantics(fixture, errors);
  validateEvidenceMinimizationProjectionSemantics(fixture, errors);
  return errors.map((error) => error.code);
}

/**
 * The convergence claim above only holds for rules a fixture can express. A rule
 * added to the boundary alone would otherwise never show up here — the negative
 * fixtures drive what gets checked, so a boundary-only rule is invisible by
 * construction. Every rejection reason the boundary can emit must therefore be
 * either convergent, schema-backstop, or explicitly declared boundary-only.
 */
async function testEveryBoundaryReasonIsAccountedFor() {
  const source = await readFile(path.join(workspacePath, "src", "index.ts"), "utf8");
  const reasons = new Set();
  // Read the Story 2.5 reason unions rather than every `reason:` literal in the
  // file — `index.ts` also carries Story 2.4's review-event boundary, which has
  // its own convergence test.
  for (const typeName of STORY_25_REASON_TYPES) {
    const declaration = new RegExp(`export type ${typeName} =([^;]+);`).exec(source);
    assert(declaration !== null, `${typeName} is gone from the boundary — update this test's reason inventory`);
    for (const match of declaration[1].matchAll(/"([a-z0-9_]+)"/g)) {
      reasons.add(match[1]);
    }
  }
  assert(reasons.size > 0, "the boundary must emit rejection reasons for this check to mean anything");

  const convergent = new Set(CONVERGENT_CODES.values());
  const schemaBackstops = new Set(SCHEMA_ONLY_FIXTURES.values());

  for (const reason of reasons) {
    assert(
      convergent.has(reason) || schemaBackstops.has(reason) || BOUNDARY_ONLY_REASONS.has(reason),
      `the boundary can reject with ${reason}, which is neither convergent nor declared boundary-only — converge it with protocol-utils.mjs or declare why it cannot be`
    );
  }

  // The declaration must stay honest in the other direction too: a reason listed
  // as boundary-only that no longer exists is a stale exemption that could hide
  // the next divergence.
  for (const reason of BOUNDARY_ONLY_REASONS.keys()) {
    assert(reasons.has(reason), `${reason} is declared boundary-only but the boundary no longer emits it — drop the declaration`);
  }
}

function boundaryReasonFor(controlPlane, fixturePath, fixture, lifecycleContext) {
  const name = fixturePath.split("/").pop();

  if (name.startsWith("stored-object-classification")) {
    const result = controlPlane.classifyStoredObject(fixture);
    return result.outcome === "rejected" ? result.reason : undefined;
  }
  if (name.startsWith("evidence-lifecycle-event")) {
    const result = controlPlane.appendEvidenceLifecycleEvent([], fixture, lifecycleContext);
    return result.outcome === "rejected" ? result.reason : undefined;
  }
  if (name.startsWith("retention-opt-in-record")) {
    const result = controlPlane.recordOptInRetention(fixture, "partner_pilot_real_snippet_ready");
    return result.outcome === "rejected" ? result.reason : undefined;
  }
  if (name.startsWith("evidence-minimization-projection")) {
    const result = controlPlane.buildEvidenceMinimizationProjection(fixture, deletionEvidenceForProjection(fixture));
    return result.outcome === "rejected" ? result.reason : undefined;
  }
  if (name.startsWith("deletion-evidence")) {
    // Deletion Evidence has no cross-field rule; the schema is its whole
    // contract, so there is no boundary entry point to converge on.
    return undefined;
  }
  throw new Error(`no boundary entry point mapped for ${fixturePath}`);
}

/**
 * Supply every Deletion Evidence a projection names, so a fixture fails for its
 * own reason rather than for an unresolved reference this test introduced.
 */
function deletionEvidenceForProjection(projection) {
  const refs = new Set();
  for (const entry of projection.entries ?? []) {
    if (entry && typeof entry === "object" && typeof entry.deletion_evidence_ref === "string") {
      refs.add(entry.deletion_evidence_ref);
    }
  }
  // C4-08: every supplied Deletion Evidence item must independently pass the
  // full schema now, not just carry a matching id — build complete records.
  return [...refs].map((deletionEvidenceId) => ({
    protocol_version: "codeattest.v0",
    deletion_evidence_id: deletionEvidenceId,
    deleted_artifact_digests: ["sha256:6f4b6612125fb3a0daecd2799dfd6c9c299424fd920f9b308110a2c1fbd8f443"],
    deletion_method: "crypto_erase",
    deletion_timestamp: "2026-07-19T00:00:00Z",
    actor: { actor_type: "vendor_service", actor_id: "SYNTHETIC_DEMO_DATA-retention-worker" },
    verification_status: "verified"
  }));
}

function isStory25Fixture(entry) {
  const name = entry.path.split("/").pop();
  return STORY_25_FIXTURE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
