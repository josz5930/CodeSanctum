// Convergence: Story 3.3 protocol semantic validators and pure control-plane
// boundary builders must reject the same malformed guidance/status/projection
// records with equivalent stable reasons.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSchemas, validateAgainstSchema, validateFixtureSemantics, validateCustomerFacingFindingRecordSemantics } from "../../../scripts/lib/protocol-utils.mjs";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-remediation-guidance-convergence-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "control-plane-remediation-guidance-convergence-dist");

const BOUNDARY_REASONS = new Map([
  ["remediation_guidance_classification_ref_required", "remediation_guidance_classification_ref_required"],
  ["remediation_guidance_inconclusive_not_actionable", "remediation_guidance_inconclusive_not_actionable"],
  ["remediation_guidance_actionable_details_required", "remediation_guidance_actionable_details_required"],
  ["remediation_guidance_exploitability_rationale_required", "remediation_guidance_exploitability_rationale_required"],
  // C4-12: a "confirmed" classification with empty confirmation_criteria is
  // not itself a valid classification record, so once classification_context
  // is bound to an authoritative record this fixture's drifted claim now
  // fails at the reference layer before the guidance's own downstream
  // confirmed-criteria check is ever reached. The gate (a single-artifact
  // check with no cross-reference) still independently emits the original code.
  ["remediation_guidance_confirmed_criteria_context_required", "remediation_guidance_reference_mismatch"],
  ["remediation_guidance_source_reference_state_mismatch", "remediation_guidance_source_reference_state_mismatch"],
  ["remediation_guidance_evidence_ref_unbound", "remediation_guidance_evidence_ref_unbound"],
  ["remediation_guidance_evidence_ref_required", "remediation_guidance_evidence_ref_required"],
  ["remediation_guidance_insufficient_evidence_reason_required", "remediation_guidance_insufficient_evidence_reason_required"],
  ["remediation_guidance_next_step_required", "remediation_guidance_next_step_required"],
  ["remediation_guidance_raw_source_text_forbidden", "remediation_guidance_text_forbidden"],
  ["remediation_guidance_claim_unsafe_text_forbidden", "remediation_guidance_text_forbidden"],
  ["customer_remediation_status_rewrite_forbidden", "customer_remediation_status_rewrite_forbidden"],
  ["customer_remediation_status_finding_ref_required", "customer_remediation_status_finding_ref_required"],
  ["customer_remediation_status_due_date_invalid", "customer_remediation_status_due_date_invalid"],
  ["customer_remediation_status_raw_source_text_forbidden", "customer_remediation_status_text_forbidden"],
  ["customer_remediation_status_claim_unsafe_text_forbidden", "customer_remediation_status_text_forbidden"]
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
  const projectionClassifications = new Map();
  for (const fixtureName of [
    "finding-classification-record.likely.json",
    "finding-classification-record.confirmed-submitted-evidence.json",
    "finding-classification-record.inconclusive.json",
    "finding-classification-record.requires-validation.json"
  ]) {
    const classification = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", fixtureName), "utf8"));
    projectionClassifications.set(classification.classification_record_id, classification);
  }
  const projectionGuidance = new Map();
  for (const fixtureName of [
    "finding-remediation-guidance.likely-actionable.json",
    "finding-remediation-guidance.confirmed-actionable.json",
    "finding-remediation-guidance.requires-validation-limited.json",
    "finding-remediation-guidance.requires-validation-path-only.json",
    "finding-remediation-guidance.unavailable-insufficient-evidence.json"
  ]) {
    const guidance = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", fixtureName), "utf8"));
    projectionGuidance.set(guidance.classification_record_ref, guidance);
  }
  const defaultProjectionClassification = projectionClassifications.get("classification_record:synthetic_likely_001");
  const defaultProjectionGuidance = projectionGuidance.get("classification_record:synthetic_likely_001");
  assert(defaultProjectionClassification !== undefined, "valid likely classification must seed projection convergence");
  assert(defaultProjectionGuidance !== undefined, "valid likely guidance must seed status projection convergence");

  // Regression: requires_customer_side_validation + actionable_guidance_provided has no
  // exploitability_rationale (the source rule only requires it for likely/confirmed). The runtime
  // must project this record AND the customer-facing gate must accept the projected record without
  // demanding an exploitability rationale summary — the two layers must converge.
  {
    const requiresValidationClassification = projectionClassifications.get("classification_record:synthetic_requires_validation_001");
    const limitedGuidance = projectionGuidance.get("classification_record:synthetic_requires_validation_001");
    assert(requiresValidationClassification !== undefined, "requires-validation classification must seed the actionable-without-rationale regression");
    assert(limitedGuidance !== undefined, "requires-validation guidance must seed the actionable-without-rationale regression");
    const actionableWithoutRationale = {
      ...limitedGuidance,
      remediation_guidance_id: "remediation_guidance:synthetic_requires_actionable_001",
      guidance_status: "actionable_guidance_provided",
      suggested_remediation: "SYNTHETIC_DEMO_DATA apply the bounded customer-side configuration guard and record retained evidence. NOT_CUSTOMER_SOURCE.",
      validation_steps: "SYNTHETIC_DEMO_DATA rerun the scoped customer-side check and preserve validation evidence. NOT_CUSTOMER_SOURCE."
    };
    delete actionableWithoutRationale.insufficient_evidence_reason;
    delete actionableWithoutRationale.next_step_summary;
    delete actionableWithoutRationale.validation_path_summary;
    delete actionableWithoutRationale.validation_path_ref;
    delete actionableWithoutRationale.exploitability_rationale;

    const built = controlPlane.buildFindingRemediationGuidanceEvent(actionableWithoutRationale, envelopeFor(0), { classification: requiresValidationClassification });
    assert(built.outcome === "built", `requires_customer_side_validation actionable guidance must build at runtime, got ${built.reason}`);

    const projected = controlPlane.projectCustomerFacingFindingRecord({
      classification: requiresValidationClassification,
      remediation_guidance: actionableWithoutRationale,
      customer_status_records: []
    });
    assert(projected.outcome === "projected", `runtime must project requires_customer_side_validation actionable guidance, got ${projected.reason}`);
    assert(projected.record.reviewer_remediation_guidance.guidance_status === "actionable_guidance_provided", "projected guidance stays actionable");
    assert(projected.record.reviewer_remediation_guidance.exploitability_rationale_summary === undefined, "requires_customer_side_validation actionable guidance carries no exploitability rationale summary");

    const gateErrors = [];
    validateCustomerFacingFindingRecordSemantics(projected.record, gateErrors);
    assert(
      !gateErrors.some((error) => error.code === "customer_facing_finding_guidance_actionable_details_required"),
      "customer-facing gate must accept the runtime-projected requires_customer_side_validation actionable record without demanding exploitability rationale"
    );
  }

  // Regression: the negative customer-facing collapsed-status fixture also violates the
  // closed schema via an extra `status` field. Pin the semantic guard directly so the
  // fixture cannot false-green on schema `additional_property` alone.
  {
    const validProjection = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "valid", "customer-facing-finding-record.json"), "utf8"));
    const semanticErrors = [];
    validateCustomerFacingFindingRecordSemantics({ ...validProjection, status: "resolved" }, semanticErrors);
    assert(
      semanticErrors.some((error) => error.code === "customer_facing_finding_status_separation_required"),
      "customer-facing finding semantic validation must reject collapsed top-level status fields"
    );
  }

  const fixtures = fixtureIndex.negative_fixtures.filter((entry) =>
    (entry.path.includes("finding-remediation-guidance.") || entry.path.includes("customer-remediation-status-record.")) &&
    BOUNDARY_REASONS.has(entry.expected_failure)
  );
  assert(fixtures.length > 0, "Story 3.3 guidance and status fixtures must exist");

  const exercisedCodes = new Set();
  const projectionExercisedCodes = new Set();
  for (const entry of fixtures) {
    const record = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    const schema = schemaMap.get(entry.schema);
    assert(schema !== undefined, `${entry.path}: schema must load`);
    const gateCodes = new Set([
      ...validateAgainstSchema(record, schema, schemaMap),
      ...await validateFixtureSemantics(record, {
        fixtureRoot,
        fixturePath: entry.path,
        expectedFailure: entry.expected_failure,
        syntheticMarkers: config.syntheticFixtureMarkers
      })
    ].map((error) => error.code));
    assert(gateCodes.has(entry.expected_failure), `${entry.path}: gate must emit ${entry.expected_failure}`);

    const expectedReason = BOUNDARY_REASONS.get(entry.expected_failure);
    if (expectedReason === undefined) {
      continue;
    }
    // C4-12: buildFindingRemediationGuidanceEvent now requires an
    // authoritative classification context; supply the fixture's own real
    // classification (by ref), with its classification_context-mirrored
    // fields and draft evidence refs overridden to match this record's own
    // claim. These fixtures predate the binding requirement and were never
    // authored to keep those fields byte-identical to a real classification,
    // so this lets each fixture still reach the specific rule it exists to
    // exercise rather than the new binding check — which has its own
    // dedicated coverage in remediation-guidance.test.mjs. Where the record's
    // claimed combination (e.g. confirmed + empty confirmation_criteria) is
    // not itself a valid classification, this still — correctly — surfaces
    // as remediation_guidance_reference_mismatch.
    const matchedClassification = projectionClassifications.get(record.classification_record_ref) ?? defaultProjectionClassification;
    const classification = {
      ...matchedClassification,
      classification: record.classification_context?.classification ?? matchedClassification.classification,
      confirmation_criteria: record.classification_context?.confirmation_criteria ?? matchedClassification.confirmation_criteria,
      evidence_basis: record.classification_context?.evidence_basis ?? matchedClassification.evidence_basis,
      source_reference_state: record.classification_context?.source_reference_state ?? matchedClassification.source_reference_state,
      review_finding_draft_evidence_refs: record.review_finding_draft_evidence_refs ?? matchedClassification.review_finding_draft_evidence_refs
    };
    const result = entry.path.includes("finding-remediation-guidance.")
      ? controlPlane.buildFindingRemediationGuidanceEvent(record, envelopeFor(0), { classification })
      : controlPlane.buildCustomerRemediationStatusEvent(record, envelopeFor(0));
    assert(result.outcome === "rejected", `${entry.path}: boundary must reject`);
    assert(result.reason === expectedReason, `${entry.path}: expected ${expectedReason}, got ${result.reason}`);
    exercisedCodes.add(entry.expected_failure);

    const validGuidance = projectionGuidance.get(classification.classification_record_id) ?? defaultProjectionGuidance;
    const projection = entry.path.includes("finding-remediation-guidance.")
      ? controlPlane.projectCustomerFacingFindingRecord({
          classification,
          remediation_guidance: record,
          customer_status_records: []
        })
      : controlPlane.projectCustomerFacingFindingRecord({
          classification,
          remediation_guidance: validGuidance,
          customer_status_records: [record]
        });
    assert(
      projection.outcome === "rejected",
      `${entry.path}: semantic-invalid source record must not pass the customer-facing projection boundary`
    );
    assert(
      projection.reason === "customer_facing_finding_input_invalid",
      `${entry.path}: projection must reject semantic-invalid source records with input_invalid, got ${projection.reason}`
    );
    projectionExercisedCodes.add(entry.expected_failure);
  }

  for (const code of BOUNDARY_REASONS.keys()) {
    assert(exercisedCodes.has(code), `missing converged Story 3.3 fixture for ${code}`);
    assert(projectionExercisedCodes.has(code), `missing projector convergence coverage for ${code}`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("control-plane / protocol-utils remediation guidance convergence tests passed.");

function envelopeFor(sequence_number) {
  return { event_id: `sha256:${"0".repeat(64)}`, sequence_number };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
