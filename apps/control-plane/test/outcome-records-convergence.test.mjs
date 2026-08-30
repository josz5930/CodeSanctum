// Convergence: Story 3.5 protocol semantic validators and pure control-plane
// builders/projectors reject malformed outcome records with equivalent reasons.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSchemas, validateAgainstSchema, validateFixtureSemantics } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-outcome-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-outcome-convergence-dist");

const BOUNDARY_REASONS = new Map([
  ["false_positive_record_reviewer_actor_required", "false_positive_record_reviewer_actor_required"],
  ["false_positive_record_evidence_basis_required", "false_positive_record_reference_mismatch"],
  ["false_positive_record_rationale_required", "false_positive_record_rationale_required"],
  ["false_positive_record_limitations_required", "false_positive_record_limitations_required"],
  ["false_positive_record_finding_ref_required", "false_positive_record_reference_mismatch"],
  ["false_positive_record_raw_source_text_forbidden", "false_positive_record_text_forbidden"],
  ["accepted_risk_record_customer_acceptance_required", "accepted_risk_record_customer_acceptance_required"],
  ["accepted_risk_record_rewrite_forbidden", "accepted_risk_record_rewrite_forbidden"],
  ["accepted_risk_record_evidence_basis_unbound", "accepted_risk_record_evidence_basis_unbound"],
  ["accepted_risk_record_source_reference_state_mismatch", "accepted_risk_record_source_reference_state_mismatch"],
  ["accepted_risk_record_review_by_date_invalid", "accepted_risk_record_review_by_date_invalid"],
  ["false_positive_record_source_reference_state_mismatch", "false_positive_record_source_reference_state_mismatch"],
  ["false_positive_record_claim_unsafe_text_forbidden", "false_positive_record_text_forbidden"],
  ["false_positive_record_reference_mismatch", "false_positive_record_reference_mismatch"],
  ["accepted_risk_record_reference_mismatch", "accepted_risk_record_reference_mismatch"],
  ["accepted_risk_record_claim_unsafe_text_forbidden", "accepted_risk_record_text_forbidden"],
  ["accepted_risk_record_raw_source_text_forbidden", "accepted_risk_record_text_forbidden"]
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
  const config = JSON.parse(await readFile(path.join(repoRoot, "protocol", "gate.config.json"), "utf8"));
  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));
  const { schemaMap } = await loadSchemas();
  const classification = await readValid("finding-classification-record.likely.json");
  const acceptedRisk = await readValid("accepted-risk-record.customer-rationale.json");
  const falsePositive = await readValid("false-positive-record.reviewer.json");

  const fixtures = fixtureIndex.negative_fixtures.filter((entry) =>
    (entry.path.includes("false-positive-record.") || entry.path.includes("accepted-risk-record.")) &&
    BOUNDARY_REASONS.has(entry.expected_failure)
  );
  assert(fixtures.length > 0, "Story 3.5 negative fixtures must exist");
  const exercisedCodes = new Set();

  for (const entry of fixtures) {
    const record = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const schema = schemaMap.get(entry.schema);
    assert(schema !== undefined, `${entry.path}: schema must load`);
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
    assert(gateCodes.has(entry.expected_failure), `${entry.path}: gate must emit ${entry.expected_failure}; got [${[...gateCodes].join(", ")}]`);

    const expectedReason = BOUNDARY_REASONS.get(entry.expected_failure);
    assert(expectedReason !== undefined, `${entry.path}: missing convergence mapping for ${entry.expected_failure}`);
    const result = entry.path.includes("false-positive-record.")
      ? controlPlane.buildFalsePositiveEvent(record, envelopeFor(0), { classification })
      : controlPlane.buildCustomerAcceptedRiskEvent(record, envelopeFor(0), { classification });
    assert(result.outcome === "rejected", `${entry.path}: boundary/projector must reject`);
    assert(result.reason === expectedReason, `${entry.path}: expected ${expectedReason}, got ${result.reason}`);
    exercisedCodes.add(entry.expected_failure);
  }

  for (const code of BOUNDARY_REASONS.keys()) {
    assert(exercisedCodes.has(code), `missing converged Story 3.5 fixture for ${code}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils outcome record convergence tests passed.");

async function readValid(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", fileName), "utf8"));
}

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
