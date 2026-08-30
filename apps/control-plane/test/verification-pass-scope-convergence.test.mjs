// Convergence: Story 4.1 protocol semantic validators and pure control-plane
// builders/projectors reject malformed verification-pass scopes with equivalent reasons.
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
const validRoot = path.join(fixtureRoot, "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-scope-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-verification-scope-convergence-dist");

const BOUNDARY_REASONS = new Map([
  ["verification_scope_customer_backing_required", "verification_scope_customer_backing_required"],
  ["verification_scope_selected_findings_required", "verification_scope_selected_findings_required"],
  ["verification_scope_classification_binding_required", "verification_scope_classification_binding_required"],
  ["verification_scope_classification_binding_mismatch", "verification_scope_classification_binding_mismatch"],
  ["verification_scope_draft_binding_mismatch", "verification_scope_draft_binding_mismatch"],
  ["verification_scope_eligibility_reason_required", "verification_scope_eligibility_reason_required"],
  ["verification_scope_limitations_required", "verification_scope_limitations_required"],
  ["verification_scope_validation_path_required_for_eligible", "verification_scope_validation_path_required_for_eligible"],
  ["verification_scope_blocked_next_step_required", "verification_scope_blocked_next_step_required"],
  ["verification_scope_additional_agreement_next_step_required", "verification_scope_additional_agreement_next_step_required"],
  ["verification_scope_outcome_default_out_of_scope_required", "verification_scope_outcome_default_out_of_scope_required"],
  ["verification_scope_deadline_basis_limitation_required", "verification_scope_deadline_basis_limitation_required"],
  ["verification_scope_included_script_cap_exceeded", "verification_scope_included_script_cap_exceeded"],
  ["verification_scope_included_script_slot_duplicate", "verification_scope_included_script_slot_duplicate"],
  ["verification_scope_additional_script_pricing_tbd_required", "verification_scope_additional_script_pricing_tbd_required"],
  ["verification_scope_script_allocation_ref_mismatch", "verification_scope_script_allocation_ref_mismatch"],
  ["verification_scope_actor_authority_required", "verification_scope_actor_authority_required"],
  ["verification_scope_reference_mismatch", "verification_scope_reference_mismatch"],
  ["verification_scope_deadline_outside_included_window", "verification_scope_deadline_outside_included_window"],
  ["verification_scope_story_4_1_field_forbidden", "verification_scope_story_4_1_field_forbidden"],
  ["verification_scope_claim_unsafe_text_forbidden", "verification_scope_text_forbidden"]
]);

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "control-plane.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const controlPlaneSource = await readFile(path.join(repoRoot, "apps", "control-plane", "src", "index.ts"), "utf8");
  const controlPlane = await import(pathToFileURL(path.join(outDir, "apps", "control-plane", "src", "index.js")).href);
  const config = JSON.parse(await readFile(path.join(repoRoot, "protocol", "gate.config.json"), "utf8"));
  assertBoundaryReasonMapIsComplete(controlPlaneSource);
  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));
  const { schemaMap } = await loadSchemas();
  const context = await fixtureContext();

  const fixtures = fixtureIndex.negative_fixtures.filter((entry) =>
    entry.path.includes("verification-pass-scope.") && BOUNDARY_REASONS.has(entry.expected_failure)
  );
  assert(fixtures.length > 0, "Story 4.1 negative fixtures must exist");
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
    const expectedGateCodes = gateCodesFor(entry.expected_failure);
    assert(expectedGateCodes.some((code) => gateCodes.has(code)), `${entry.path}: gate must emit one of [${expectedGateCodes.join(", ")}]; got [${[...gateCodes].join(", ")}]`);
    if (entry.expected_failure.startsWith("verification_scope_")) {
      const schemaFallbacks = ["additional_property", "const", "max_items", "maximum", "min_items"];
      assert(!expectedGateCodes.some((code) => schemaFallbacks.includes(code)), `${entry.path}: Story 4.1 convergence must not accept schema fallback codes for semantic cases`);
    }

    const expectedReason = BOUNDARY_REASONS.get(entry.expected_failure);
    assert(expectedReason !== undefined, `${entry.path}: missing convergence mapping for ${entry.expected_failure}`);
    const result = controlPlane.buildVerificationPassScopeEvent(record, envelopeFor(0), context);
    assert(result.outcome === "rejected", `${entry.path}: boundary must reject`);
    assert(result.reason === expectedReason, `${entry.path}: expected ${expectedReason}, got ${result.reason}`);
    exercisedCodes.add(entry.expected_failure);
  }

  for (const code of BOUNDARY_REASONS.keys()) {
    assert(exercisedCodes.has(code), `missing converged Story 4.1 fixture for ${code}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils verification pass scope convergence tests passed.");

async function fixtureContext() {
  return {
    review_finding_drafts: [
      await readValid("review-finding-draft-set.metadata-only.json"),
      await readValid("review-finding-draft-set.finding-context.json")
    ],
    classifications: [
      await readValid("finding-classification-record.likely.json"),
      await readValid("finding-classification-record.requires-validation.json"),
      await readValid("finding-classification-record.other-context.json")
    ],
    remediation_guidance_records: [
      await readValid("finding-remediation-guidance.likely-actionable.json"),
      await readValid("finding-remediation-guidance.requires-validation-path-only.json")
    ],
    customer_status_records: [await readValid("customer-remediation-status-record.owner-due-date.json")],
    validation_paths: [
      await readValid("finding-validation-path.customer-run-script.json"),
      await readValid("finding-validation-path.additional-agreement-required.json"),
      await readValid("finding-validation-path.outcome-formal-manual.json")
    ],
    reviewer_validation_scripts: [
      await readValid("reviewer-validation-script.included-slot-1.json"),
      await readValid("reviewer-validation-script.included-slot-2.json"),
      await readValid("reviewer-validation-script.included-slot-3.json"),
      await readValid("reviewer-validation-script.additional-pricing-tbd.json")
    ],
    accepted_risk_records: [await readValid("accepted-risk-record.customer-rationale.json")],
    false_positive_records: [await readValid("false-positive-record.reviewer.json")]
  };
}

async function readValid(fileName) {
  return JSON.parse(await readFile(path.join(validRoot, fileName), "utf8"));
}

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

function assertBoundaryReasonMapIsComplete(source) {
  const match = /export type VerificationPassScopeRejectionReason =([\s\S]*?);\n\nexport type VerificationPassScopeEventBuildRejectionReason/.exec(source);
  assert(match !== null, "VerificationPassScopeRejectionReason must remain discoverable for convergence coverage");
  const runtimeReasons = Array.from(match[1].matchAll(/"([^"]+)"/g), (reasonMatch) => reasonMatch[1])
    .filter((reason) => reason !== "verification_scope_schema_invalid");
  const mappedReasons = new Set(BOUNDARY_REASONS.values());
  const missing = runtimeReasons.filter((reason) => !mappedReasons.has(reason));
  assert(missing.length === 0, `runtime Story 4.1 rejection reasons must be mapped for convergence; missing [${missing.join(", ")}]`);
}

function gateCodesFor(expectedFailure) {
  const mapping = {
    verification_scope_reference_mismatch: ["verification_scope_reference_mismatch", "verification_scope_validation_path_ref_mismatch", "verification_scope_script_ref_mismatch"],
    verification_scope_included_script_cap_exceeded: ["verification_scope_included_script_cap_exceeded"],
    verification_scope_included_script_slot_duplicate: ["verification_scope_included_script_slot_duplicate"],
    verification_scope_additional_script_pricing_tbd_required: ["verification_scope_additional_script_pricing_tbd_required"],
    verification_scope_story_4_1_field_forbidden: ["verification_scope_story_4_1_field_forbidden"],
    verification_scope_eligibility_reason_required: ["verification_scope_eligibility_reason_required"],
    verification_scope_limitations_required: ["verification_scope_limitations_required"]
  };
  return mapping[expectedFailure] ?? [expectedFailure];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
