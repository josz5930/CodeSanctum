// Convergence: finding-classification record guardrails are implemented twice —
// once in `scripts/lib/protocol-utils.mjs` for protocol fixture gates and once
// in `apps/control-plane/src/index.ts` for malformed JSON-like boundary callers.
// Driving every negative fixture through both layers keeps the two surfaces from
// drifting on guardrail ordering, insufficient-basis handling, and source-state
// binding.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  loadSchemas,
  validateAgainstSchema,
  validateFixtureSemantics
} from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-finding-classification-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-finding-classification-convergence-dist");

// Gate semantic/schema code -> boundary rejection reason that must cover the
// same fixture. Some protocol gate failures are schema-only at the control-plane
// boundary, while raw-source and claim-safety branches are intentionally exposed
// as one boundary text-safety reason.
const BOUNDARY_EQUIVALENT_REASONS = new Map([
  ["finding_classification_allowed_taxonomy_required", "finding_classification_schema_invalid"],
  ["finding_classification_draft_ref_required", "finding_classification_schema_invalid"],
  ["finding_classification_confirmed_criteria_required", "finding_classification_confirmed_criteria_required"],
  ["finding_classification_confirmed_defensible_criteria_required", "finding_classification_confirmed_defensible_criteria_required"],
  ["finding_classification_validation_path_required", "finding_classification_validation_path_required"],
  ["finding_classification_evidence_basis_required", "finding_classification_evidence_basis_required"],
  ["finding_classification_evidence_basis_not_bound_to_draft", "finding_classification_evidence_basis_not_bound_to_draft"],
  ["finding_classification_source_reference_state_mismatch", "finding_classification_source_reference_state_mismatch"],
  ["finding_classification_limitations_required", "finding_classification_limitations_required"],
  ["finding_classification_forbidden_field", "finding_classification_forbidden_field"],
  ["finding_classification_raw_source_text_forbidden", "finding_classification_text_forbidden"],
  ["finding_classification_claim_unsafe_text_forbidden", "finding_classification_text_forbidden"],
  ["finding_classification_reviewer_actor_required", "finding_classification_reviewer_actor_required"],
  ["camel_case_protocol_field", "finding_classification_schema_invalid"]
]);

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
    path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  const config = JSON.parse(await readFile(path.join(repoRoot, "protocol", "gate.config.json"), "utf8"));
  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));
  const { schemaMap } = await loadSchemas();

  const negativeClassificationFixtures = (fixtureIndex.negative_fixtures ?? [])
    .filter((entry) => entry.path.includes("finding-classification-record.") && BOUNDARY_EQUIVALENT_REASONS.has(entry.expected_failure));
  assert(negativeClassificationFixtures.length > 0, "there must be negative finding-classification-record fixtures to converge on");

  const exercisedGateCodes = new Set();

  for (const entry of negativeClassificationFixtures) {
    const record = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const name = entry.path.split("/").pop();

    const schema = schemaMap.get(entry.schema);
    assert(schema !== undefined, `${name}: fixture schema ${entry.schema} must be available`);

    // Layer 1: the protocol gate path must reject this fixture for its indexed
    // finding-classification reason.
    const gateErrors = [
      ...validateAgainstSchema(record, schema, schemaMap),
      ...await validateFixtureSemantics(record, {
        fixtureRoot,
        fixturePath: entry.path,
        expectedFailure: entry.expected_failure,
        syntheticMarkers: config.syntheticFixtureMarkers
      })
    ];
    const gateCodes = new Set(gateErrors.map((error) => error.code));
    assert(
      gateCodes.has(entry.expected_failure),
      `${name}: gate must produce ${entry.expected_failure}, got [${[...gateCodes].join(", ")}]`
    );
    exercisedGateCodes.add(entry.expected_failure);

    // Layer 2: the control-plane boundary must reject the same fixture for the
    // corresponding boundary reason.
    const expectedBoundaryReason = BOUNDARY_EQUIVALENT_REASONS.get(entry.expected_failure);
    assert(
      expectedBoundaryReason !== undefined,
      `${name}: ${entry.expected_failure} is not mapped as a convergent finding-classification boundary reason`
    );

    const outcome = controlPlane.buildFindingClassificationEvent(record, envelopeFor(0));
    assert(outcome.outcome === "rejected", `${name}: boundary must reject the negative fixture, got ${JSON.stringify(outcome)}`);
    assert(
      outcome.reason === expectedBoundaryReason,
      `${name}: boundary must reject with ${expectedBoundaryReason} for gate ${entry.expected_failure}, got ${outcome.reason}`
    );
  }

  for (const expectedCode of BOUNDARY_EQUIVALENT_REASONS.keys()) {
    assert(
      exercisedGateCodes.has(expectedCode),
      `every mapped finding-classification convergence code must be exercised by a fixture; missing ${expectedCode}`
    );
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils finding classification convergence tests passed.");

function envelopeFor(sequenceNumber) {
  return {
    event_id: `sha256:${"0".repeat(64)}`,
    sequence_number: sequenceNumber
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
