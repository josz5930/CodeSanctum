// Convergence: Story 3.4 protocol semantic validators and pure control-plane
// builders/projectors must reject malformed validation path/script records with
// equivalent stable reasons.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSchemas, validateAgainstSchema, validateFixtureSemantics, validateReviewerValidationScriptPackageSemantics } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-validation-path-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-validation-path-convergence-dist");

const BOUNDARY_REASONS = new Map([
  ["validation_path_remote_authorization_required", "validation_path_remote_authorization_required"],
  ["validation_path_script_ref_required", "validation_path_script_ref_required"],
  ["validation_path_branch_field_forbidden", "validation_path_branch_field_forbidden"],
  ["validation_path_manual_attachment_instructions_required", "validation_path_manual_attachment_instructions_required"],
  ["validation_path_evidence_ref_unbound", "validation_path_evidence_ref_unbound"],
  ["validation_path_source_reference_state_mismatch", "validation_path_source_reference_state_mismatch"],
  ["validation_path_raw_source_text_forbidden", "validation_path_text_forbidden"],
  ["validation_path_claim_unsafe_text_forbidden", "validation_path_text_forbidden"],
  ["validation_script_included_slot_required", "validation_script_included_slot_required"],
  ["validation_script_additional_slot_forbidden", "validation_script_additional_slot_forbidden"],
  ["validation_script_pricing_tbd_required", "validation_script_pricing_tbd_required"],
  ["validation_script_included_cap_exceeded", "validation_script_included_cap_exceeded"],
  ["validation_script_raw_source_text_forbidden", "validation_script_text_forbidden"],
  ["validation_script_claim_unsafe_text_forbidden", "validation_script_text_forbidden"]
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
  const classification = await readValid("finding-classification-record.requires-validation.json");
  const guidance = await readValid("finding-remediation-guidance.requires-validation-path-only.json");
  const validPath = await readValid("finding-validation-path.customer-run-script.json");
  const validScript = await readValid("reviewer-validation-script.included-slot-1.json");
  const validScriptSlot3 = await readValid("reviewer-validation-script.included-slot-3.json");
  const validAdditionalScript = await readValid("reviewer-validation-script.additional-pricing-tbd.json");
  const validScripts = [validScript, validScriptSlot3, validAdditionalScript];
  const validScriptContext = {
    validation_path: validPath,
    prior_included_scripts: [validScript, validScriptSlot3, { ...validScript, validation_script_id: "validation_script:synthetic_included_002", included_script_slot: 2 }]
  };

  const fixtures = fixtureIndex.negative_fixtures.filter((entry) =>
    (entry.path.includes("finding-validation-path.") || entry.path.includes("reviewer-validation-script.")) &&
    BOUNDARY_REASONS.has(entry.expected_failure)
  );
  assert(fixtures.length > 0, "Story 3.4 validation path/script fixtures must exist");

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
    if (entry.expected_failure === "validation_script_included_cap_exceeded") {
      validateReviewerValidationScriptPackageSemantics([...validScripts, record], gateErrors);
    }
    const gateCodes = new Set(gateErrors.map((error) => error.code));
    assert(gateCodes.has(entry.expected_failure), `${entry.path}: gate must emit ${entry.expected_failure}; got [${[...gateCodes].join(", ")}]`);

    const expectedReason = BOUNDARY_REASONS.get(entry.expected_failure);
    assert(expectedReason !== undefined, `${entry.path}: missing convergence mapping for ${entry.expected_failure}`);
    const result = entry.path.includes("finding-validation-path.")
      ? controlPlane.buildFindingValidationPathEvent(record, envelopeFor(0), {
          reviewer_validation_scripts: validScripts
        })
      : controlPlane.buildReviewerValidationScriptEvent(
          record,
          envelopeFor(0),
          entry.expected_failure === "validation_script_included_cap_exceeded"
            ? validScriptContext
            : { validation_path: validPath, prior_included_scripts: [] }
        );
    assert(result.outcome === "rejected", `${entry.path}: boundary must reject`);
    assert(result.reason === expectedReason, `${entry.path}: expected ${expectedReason}, got ${result.reason}`);
    exercisedCodes.add(entry.expected_failure);
  }

  for (const code of BOUNDARY_REASONS.keys()) {
    assert(exercisedCodes.has(code), `missing converged Story 3.4 fixture for ${code}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils validation path convergence tests passed.");

async function readValid(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", fileName), "utf8"));
}

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
