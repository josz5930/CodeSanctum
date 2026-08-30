// Story 3.3: dependency-free customer-facing finding record and structured
// remediation guidance view contracts.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-customer-finding-record-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-customer-finding-record-test-dist");

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
    path.join(tempDir, "ui.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  for (const exportName of ["RemediationGuidanceSummary", "CustomerFindingRecordView"]) {
    assert(exportName in ui, `missing public export: ${exportName}`);
  }

  const classification = await readFixture("finding-classification-record.likely.json");
  const guidance = await readFixture("finding-remediation-guidance.likely-actionable.json");
  const limitedGuidance = await readFixture("finding-remediation-guidance.requires-validation-limited.json");
  const pathOnlyGuidance = await readFixture("finding-remediation-guidance.requires-validation-path-only.json");
  const unavailableGuidance = await readFixture("finding-remediation-guidance.unavailable-insufficient-evidence.json");
  const status = await readFixture("customer-remediation-status-record.owner-due-date.json");
  const projection = await readFixture("customer-facing-finding-record.json");

  testRemediationGuidanceSummaryGuardsUnsafeInput(ui, guidance);
  testStructuredGuidanceInWorkbench(ui, classification, guidance);
  testStructuredPathOnlyAndUnavailableGuidanceInWorkbench(ui, classification, pathOnlyGuidance, unavailableGuidance);
  testGuidanceSummaryStatuses(ui, guidance, limitedGuidance, pathOnlyGuidance, unavailableGuidance);
  testCustomerFindingSections(ui, projection);
  testCustomerMetadataVisibility(ui, projection, status);
  testEvidenceConsumerExportDefaultsClosed(ui, projection);
  await testFormalValidationPathAndScriptSections(ui, projection);
  await testRecordBackedOutcomeSections(ui, projection);
  await testValidationHandoffsAndLaterOutcomes(ui, projection);
  testCustomerStatusVocabulary(ui, projection);
  testTextFirstAndTokenSemantics(ui, projection);
  testNullMalformedInputs(ui);
  testCopySafetyClauseAndNormalizationBypasses(ui, projection);
  testNoHiddenHoverOnlyControls(ui, projection);
  await testRegisteredCustomerFacingFindingFixtures(ui);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("UI customer finding record tests passed.");

// C6-13: RemediationGuidanceSummary is an independently exported function
// and must reject malformed/unsafe input on its own, not only when reached
// through the fuller customer finding record view.
function testRemediationGuidanceSummaryGuardsUnsafeInput(ui, guidance) {
  assert(ui.RemediationGuidanceSummary(null).status.value === "guidance_unavailable", "null guidance must return the unavailable summary");
  assert(ui.RemediationGuidanceSummary({}).status.value === "guidance_unavailable", "a schema-invalid empty object must return the unavailable summary");
  const unsafe = { ...guidance, suggested_remediation: "contact token: abc for details" };
  assert(ui.RemediationGuidanceSummary(unsafe).status.value === "guidance_unavailable", "unsafe narrative text must return the unavailable summary rather than render it");
  const malformed = { ...guidance, guidance_status: "not_a_real_status", protocol_version: 12345 };
  assert(ui.RemediationGuidanceSummary(malformed).status.value === "guidance_unavailable", "a schema-invalid record must return the unavailable summary");
}

function testStructuredGuidanceInWorkbench(ui, classification, guidance) {
  const view = ui.ReviewerClassificationWorkbench(workbenchProps(classification, guidance));
  const panel = view.panels.find((candidate) => candidate.id === "remediation_guidance");
  assert(panel.title === "Remediation guidance", "workbench panel title reflects structured guidance, not placeholder-only copy");
  assert(panel.summary.includes("Actionable guidance provided"), "structured guidance status is visible in the workbench");
  assert(panel.items.some((item) => item.label === "Guidance status" && item.value === "Actionable guidance provided"), "guidance status item is visible");
  assert(panel.items.some((item) => item.label === "Evidence reference" && item.value === "artifact_ref:synthetic_raw_snippet"), "guidance evidence reference is visible");
  assert(panel.fields.some((field) => field.id === "exploitability_rationale" && field.value === guidance.exploitability_rationale), "structured exploitability rationale is visible");
  assert(panel.fields.some((field) => field.id === "suggested_remediation" && field.shortcutsSuppressed === true), "structured remediation field is a shortcut-suppressed text-entry zone");
  assert(panel.fields.some((field) => field.id === "validation_steps"), "validation steps field is exposed alongside guidance");
  for (const fieldId of ["insufficient_evidence_reason", "next_step_summary"]) {
    assert(panel.fields.some((field) => field.id === fieldId), `structured guidance field is represented: ${fieldId}`);
  }
  // C6-29: validation_path_ref/validation_path_summary belong to exactly one
  // panel — the validation path panel, not remediation guidance, since their
  // field id is owned by that panel's `startsWith("validation_path_")` filter.
  assert(!panel.fields.some((field) => field.id === "validation_path_ref"), "validation_path_ref must not be duplicated into the remediation guidance panel");
  const validationPathPanelForGuidance = view.panels.find((candidate) => candidate.id === "validation_path");
  assert(validationPathPanelForGuidance.fields.some((field) => field.id === "validation_path_ref"), "validation_path_ref is represented in the validation path panel");
  assert(view.shortcutSuppressionZones.some((zone) => zone.id === "suggested_remediation" && zone.zoneType === "remediation_guidance"), "structured guidance fields suppress global shortcuts");
}

function testStructuredPathOnlyAndUnavailableGuidanceInWorkbench(ui, classification, pathOnlyGuidance, unavailableGuidance) {
  const pathView = ui.ReviewerClassificationWorkbench(workbenchProps(classification, pathOnlyGuidance));
  const pathPanel = pathView.panels.find((candidate) => candidate.id === "remediation_guidance");
  const pathPanelForValidationRef = pathView.panels.find((candidate) => candidate.id === "validation_path");
  assert(pathPanelForValidationRef.fields.some((field) => field.id === "validation_path_ref" && field.value === pathOnlyGuidance.validation_path_ref), "structured workbench renders validation-path-ref-only guidance in the validation path panel");
  assert(!pathPanel.fields.some((field) => field.id === "validation_path_ref"), "validation_path_ref must not be duplicated into the remediation guidance panel");
  assert(pathPanel.fields.some((field) => field.id === "insufficient_evidence_reason" && field.value === pathOnlyGuidance.insufficient_evidence_reason), "structured workbench renders path-only insufficient-evidence reason");
  assert(!pathPanel.fields.some((field) => field.id === "next_step_summary" && field.value.length > 0), "path-ref-only guidance does not fabricate next-step text");

  const unavailableView = ui.ReviewerClassificationWorkbench(workbenchProps(classification, unavailableGuidance));
  const unavailablePanel = unavailableView.panels.find((candidate) => candidate.id === "remediation_guidance");
  assert(unavailablePanel.summary.includes("Guidance unavailable from submitted evidence"), "structured workbench renders unavailable guidance status");
  assert(unavailablePanel.fields.some((field) => field.id === "insufficient_evidence_reason" && field.value === unavailableGuidance.insufficient_evidence_reason), "structured workbench renders unavailable guidance reason");
  assert(unavailablePanel.fields.some((field) => field.id === "next_step_summary" && field.value === unavailableGuidance.next_step_summary), "structured workbench renders unavailable guidance next step");
}

function testGuidanceSummaryStatuses(ui, actionable, limited, pathOnly, unavailable) {
  const actionableView = ui.RemediationGuidanceSummary(actionable);
  assert(actionableView.kind === "remediation-guidance-summary", "guidance summary kind is stable");
  assert(actionableView.status.visibleLabel === "Actionable guidance provided", "actionable status has visible text");
  assert(actionableView.status.tokenRole === "review", "actionable guidance uses review role, not verification green");
  // C6-45: dynamic status views need explicit state-announcement metadata.
  assert(actionableView.status.role === "status" && actionableView.status.ariaLive === "polite", "guidance status carries state-announcement metadata for headless adapters");
  assert(actionableView.evidenceRefs.includes("artifact_ref:synthetic_raw_snippet"), "guidance summary exposes evidence refs");
  assert(actionableView.sections.some((section) => section.title === "Limitations" && section.body.length > 0), "limitations section remains visible");
  assert(actionableView.doesNotRelyOnColor === true, "guidance meaning is text-first");

  const limitedView = ui.RemediationGuidanceSummary(limited);
  assert(limitedView.status.visibleLabel === "Limited guidance requires validation", "limited guidance has explicit visible text");
  assert(limitedView.status.tokenRole === "warning", "limited guidance uses warning role");
  assert(limitedView.sections.some((section) => section.title === "Insufficient evidence reason" && section.body.includes(limited.insufficient_evidence_reason)), "limited guidance summary shows the insufficient-evidence reason even when a next step exists");
  assert(limitedView.sections.some((section) => section.title === "Next steps" && section.body.includes(limited.next_step_summary)), "limited guidance includes next step or validation handoff");

  const pathOnlyView = ui.RemediationGuidanceSummary(pathOnly);
  assert(pathOnlyView.sections.some((section) => section.title === "Validation path" && section.body.includes(pathOnly.validation_path_ref)), "validation-path-ref-only guidance summary shows the reference handoff under a validation-path label");
  assert(!pathOnlyView.sections.some((section) => section.title === "Validation steps"), "a bare validation-path reference is not mislabeled as concrete validation steps");
  assert(pathOnlyView.sections.filter((section) => section.body.includes(pathOnly.validation_path_ref)).length === 1, "validation-path reference is not duplicated across sections");
  assert(pathOnlyView.sections.some((section) => section.title === "Insufficient evidence reason" && section.body.includes(pathOnly.insufficient_evidence_reason)), "path-only guidance summary shows its insufficient-evidence reason");

  const unavailableView = ui.RemediationGuidanceSummary(unavailable);
  assert(unavailableView.status.visibleLabel === "Guidance unavailable from submitted evidence", "unavailable guidance has explicit visible text");
  assert(unavailableView.sections.some((section) => section.title === "Insufficient evidence reason" && section.body.includes(unavailable.insufficient_evidence_reason)), "unavailable guidance summary shows the reason");
  assert(unavailableView.sections.some((section) => section.title === "Next steps" && section.body.includes(unavailable.next_step_summary)), "unavailable guidance summary shows the next step");
}

function testCustomerFindingSections(ui, projection) {
  const view = ui.CustomerFindingRecordView({ record: projection, audience: "customer" });
  assert(view.kind === "customer-finding-record", "customer finding kind is stable");
  const sections = new Set(view.sections.map((section) => section.id));
  for (const id of ["expert_classification", "evidence_basis", "reviewer_remediation_guidance", "customer_remediation_status", "verification_state"]) {
    assert(sections.has(id), `customer finding section must exist: ${id}`);
  }
  assert(!sections.has("future_outcomes"), "future outcomes remain absent until later artifacts exist");
  assert(view.sections.find((section) => section.id === "expert_classification").title === "Expert classification", "expert classification is separately labeled");
  assert(view.sections.find((section) => section.id === "reviewer_remediation_guidance").title === "Reviewer remediation guidance", "reviewer guidance is separately labeled");
  assert(view.sections.find((section) => section.id === "reviewer_remediation_guidance").body.includes(projection.reviewer_remediation_guidance.exploitability_rationale_summary), "projected exploitability rationale is visible");
  assert(view.sections.find((section) => section.id === "verification_state").summary.includes("Not verified"), "verification remains explicit and separate");
}

function testCustomerMetadataVisibility(ui, projection, status) {
  const view = ui.CustomerFindingRecordView({ record: projection, audience: "evidence_consumer" });
  const customerStatus = view.sections.find((section) => section.id === "customer_remediation_status");
  assert(customerStatus.items.some((item) => item.label === "Latest customer status" && item.value === "Planned"), "customer status is text-first");
  assert(customerStatus.items.some((item) => item.label === "Due date" && item.value === "2026-08-31"), "exportable due date is visible");
  assert(!JSON.stringify(view).includes(status.owner), "owner excluded by export posture does not appear");
  assert(!JSON.stringify(view).includes("customer validation pending"), "unset/excluded target state does not appear");
  assert(!JSON.stringify(view).includes(status.customer_notes), "customer notes excluded by export posture do not appear");
  assert(view.exportPolicy.evidenceConsumerExport === "include", "evidence-consumer export posture is explicit");
}

function testEvidenceConsumerExportDefaultsClosed(ui, projection) {
  const malformedProjection = { ...projection };
  delete malformedProjection.evidence_consumer_export;
  const view = ui.CustomerFindingRecordView({ record: malformedProjection, audience: "evidence_consumer" });
  assert(view.exportPolicy.evidenceConsumerExport === "exclude", "missing evidence-consumer export posture must default to exclude");
  assert(view.sections.some((section) => section.id === "unavailable"), "excluded evidence-consumer records return an unavailable view");
  assert(!JSON.stringify(view).includes(projection.expert_classification.rationale_summary), "excluded records do not leak finding content");
}

async function testFormalValidationPathAndScriptSections(ui, projection) {
  const validationPath = await readFixture("finding-validation-path.customer-run-script.json");
  const remotePath = await readFixture("finding-validation-path.remote-dynamic-testing.json");
  const manualPath = await readFixture("finding-validation-path.manual-steps.json");
  const includedScript = await readFixture("reviewer-validation-script.included-slot-1.json");
  const additionalScript = await readFixture("reviewer-validation-script.additional-pricing-tbd.json");
  const record = structuredClone(projection);
  const scriptPath = projectedPath(validationPath);
  scriptPath.reviewer_validation_script_refs = [includedScript.validation_script_id, additionalScript.validation_script_id];
  record.validation_paths = [scriptPath, projectedPath(remotePath), projectedPath(manualPath)];
  record.reviewer_validation_scripts = [projectedScript(includedScript), projectedScript(additionalScript)];
  const view = ui.CustomerFindingRecordView({ record, audience: "customer" });
  assert(view.sections.some((section) => section.id === "validation_paths"), "formal validation path section is present");
  assert(view.sections.some((section) => section.id === "reviewer_validation_scripts"), "reviewer-authored script section is present");
  const pathSection = view.sections.find((section) => section.id === "validation_paths");
  assert(pathSection.items.some((item) => item.label === "Validation path" && item.value === validationPath.validation_path_id), "projected validation path id is visible");
  assert(pathSection.items.some((item) => item.label === "Path type" && item.value === "Customer-run script"), "path type is text-first and distinct from manual/remote branches");
  assert(pathSection.items.some((item) => item.label === "Path type" && item.value === "Remote dynamic testing"), "remote dynamic testing path type is text-first");
  assert(pathSection.items.some((item) => item.label === "Path type" && item.value === "Manual steps"), "manual-step path type is text-first and distinct from scripts");
  assert(pathSection.items.some((item) => item.label === "Remote testing target" && item.value === remotePath.target), "remote target is visible to customers");
  assert(pathSection.items.some((item) => item.label === "Remote testing authorization" && item.value === remotePath.authorization_assumption), "remote authorization assumption is visible to customers");
  assert(pathSection.items.some((item) => item.label === "Remote testing safety constraints" && item.value === remotePath.safety_constraints), "remote safety constraints are visible to customers");
  assert(pathSection.items.some((item) => item.label === "Remote evidence artifact to collect" && item.value === remotePath.evidence_artifacts_to_collect[0]), "remote evidence artifact collection instructions are visible to customers");
  assert(pathSection.items.some((item) => item.label === "Output attachment instructions" && item.value === validationPath.output_attachment_instructions), "validation output attachment instructions are visible to customers");
  assert(pathSection.body.some((body) => body.includes(validationPath.required_evidence)), "required evidence is visible in the validation path section");
  assert(pathSection.body.some((body) => body.includes(manualPath.required_evidence)), "manual-step required evidence is visible in the validation path section");
  assert(pathSection.body.some((body) => body.includes(remotePath.method)), "remote method is visible in the validation path section body");
  const scriptSection = view.sections.find((section) => section.id === "reviewer_validation_scripts");
  assert(scriptSection.items.some((item) => item.label === "Reviewer-authored script" && item.value === includedScript.validation_script_id), "projected script id is visible");
  assert(scriptSection.items.some((item) => item.label === "Included script slot" && item.value === "1"), "included script slot is visible");
  assert(scriptSection.body.some((body) => body.includes(includedScript.script_content)), "approved script content is visible as customer-facing Review Artifact content");
  assert(JSON.stringify(scriptSection).includes("pricing TBD"), "additional-script candidate preserves pricing TBD posture");
  assert(!JSON.stringify(view).includes("Verified"), "formal validation path/script display does not claim verification complete");
}

async function testRecordBackedOutcomeSections(ui, projection) {
  const falsePositiveProjection = await readFixture("customer-facing-finding-record.false-positive-outcome.json");
  const acceptedRiskProjection = await readFixture("customer-facing-finding-record.accepted-risk-outcome.json");

  const falsePositiveView = ui.CustomerFindingRecordView({ record: falsePositiveProjection, audience: "customer" });
  const falsePositiveChip = falsePositiveView.statusChips.find((chip) => chip.id === "false_positive_outcome");
  assert(falsePositiveChip.visibleLabel === "False positive", "false-positive status chip appears only when a record-backed outcome exists");
  assert(falsePositiveChip.tokenRole !== "verification", "false-positive outcome does not use verification green");
  const falsePositiveSection = falsePositiveView.sections.find((section) => section.id === "false_positive_outcome");
  assert(falsePositiveSection.title === "False positive", "false-positive outcome section has a visible label");
  assert(falsePositiveSection.items.some((item) => item.label === "Record reference" && item.value === falsePositiveProjection.false_positive_record_ref), "false-positive record reference is visible");
  assert(falsePositiveSection.items.some((item) => item.label === "Responsible actor category" && item.value === "Reviewer"), "false-positive actor category is visible");
  assert(falsePositiveSection.items.some((item) => item.label === "Evidence basis" && item.value === falsePositiveProjection.false_positive_outcome.evidence_basis_summary), "false-positive evidence basis is visible");
  assert(falsePositiveSection.items.some((item) => item.label === "Evidence reference" && item.value === falsePositiveProjection.false_positive_outcome.evidence_refs[0]), "false-positive evidence basis refs are visible");
  assert(falsePositiveSection.items.some((item) => item.label === "Limitations" && item.value === falsePositiveProjection.false_positive_outcome.limitations[0]), "false-positive limitations have a visible label");
  assert(falsePositiveSection.body.some((body) => body.includes("false positive")), "false-positive rationale text is visible");
  assert(falsePositiveView.sections.some((section) => section.id === "expert_classification"), "false-positive outcome does not hide the finding or expert classification");

  const acceptedRiskView = ui.CustomerFindingRecordView({ record: acceptedRiskProjection, audience: "customer" });
  const acceptedRiskChip = acceptedRiskView.statusChips.find((chip) => chip.id === "accepted_risk_outcome");
  assert(acceptedRiskChip.visibleLabel === "Accepted risk", "accepted-risk status chip appears only when record-backed outcome exists");
  assert(acceptedRiskChip.tokenRole === "warning", "accepted-risk outcome uses warning posture, not verification green");
  const acceptedRiskSection = acceptedRiskView.sections.find((section) => section.id === "accepted_risk_outcome");
  assert(acceptedRiskSection.title === "Accepted risk", "accepted-risk section has visible label");
  assert(acceptedRiskSection.items.some((item) => item.label === "Record reference" && item.value === acceptedRiskProjection.accepted_risk_record_ref), "accepted-risk record reference is visible");
  assert(acceptedRiskSection.items.some((item) => item.label === "Evidence basis" && item.value === acceptedRiskProjection.accepted_risk_outcome.evidence_basis_summary), "accepted-risk evidence basis is visible");
  assert(acceptedRiskSection.items.some((item) => item.label === "Evidence reference" && item.value === acceptedRiskProjection.accepted_risk_outcome.evidence_refs[0]), "accepted-risk evidence refs are visible");
  assert(acceptedRiskSection.items.some((item) => item.label === "Customer rationale/sign-off" && item.value.includes("accepted residual risk")), "accepted-risk customer rationale/sign-off is visible");
  assert(acceptedRiskSection.items.some((item) => item.label === "Responsible actor category" && item.value === "Customer user"), "accepted-risk actor category is visible");
  assert(acceptedRiskSection.items.some((item) => item.label === "Limitations" && item.value === acceptedRiskProjection.accepted_risk_outcome.limitations[0]), "accepted-risk limitations have a visible label");
  assert(acceptedRiskSection.body.some((body) => body.includes("not remediation") || body.includes("accepted residual risk")), "accepted-risk limitations/rationale are visible");
  assert(!JSON.stringify(acceptedRiskView).includes("Not recorded"), "outcome view does not render placeholder not-recorded rows");
  assertNoUnsafeView(acceptedRiskView);

  const excludedAccepted = structuredClone(acceptedRiskProjection);
  excludedAccepted.accepted_risk_outcome.evidence_consumer_export = "exclude";
  const evidenceConsumerAccepted = ui.CustomerFindingRecordView({ record: excludedAccepted, audience: "evidence_consumer" });
  assert(!evidenceConsumerAccepted.statusChips.some((chip) => chip.id === "accepted_risk_outcome"), "evidence-consumer chips omit accepted-risk when nested export excludes it");
  assert(!evidenceConsumerAccepted.sections.some((section) => section.id === "accepted_risk_outcome"), "evidence-consumer view omits accepted-risk outcome when nested export excludes it");
  assert(!JSON.stringify(evidenceConsumerAccepted).includes(excludedAccepted.accepted_risk_outcome.customer_acceptance_summary), "excluded accepted-risk rationale does not leak to evidence consumer");
  assert(!evidenceConsumerAccepted.sections.some((section) => section.id === "future_outcomes"), "evidence-consumer view does not fall back to bare accepted-risk refs");

  const excludedFalsePositive = structuredClone(falsePositiveProjection);
  excludedFalsePositive.false_positive_outcome.evidence_consumer_export = "exclude";
  const evidenceConsumerFalsePositive = ui.CustomerFindingRecordView({ record: excludedFalsePositive, audience: "evidence_consumer" });
  assert(!evidenceConsumerFalsePositive.statusChips.some((chip) => chip.id === "false_positive_outcome"), "evidence-consumer chips omit false-positive when nested export excludes it");
  assert(!evidenceConsumerFalsePositive.sections.some((section) => section.id === "false_positive_outcome"), "evidence-consumer view omits false-positive outcome when nested export excludes it");
  assert(!JSON.stringify(evidenceConsumerFalsePositive).includes(excludedFalsePositive.false_positive_outcome.rationale_summary), "excluded false-positive rationale does not leak to evidence consumer");
  assert(!evidenceConsumerFalsePositive.sections.some((section) => section.id === "future_outcomes"), "evidence-consumer view does not fall back to bare false-positive refs");

  const hiddenAccepted = structuredClone(acceptedRiskProjection);
  hiddenAccepted.future_outcome_visibility.accepted_risk_visible = false;
  const hiddenAcceptedView = ui.CustomerFindingRecordView({ record: hiddenAccepted, audience: "customer" });
  assert(hiddenAcceptedView.sections.some((section) => section.id === "unavailable"), "accepted-risk outcome present while future visibility is hidden fails closed");
  const mismatchedFalsePositive = structuredClone(falsePositiveProjection);
  mismatchedFalsePositive.false_positive_outcome.false_positive_record_ref = "false_positive:other_record";
  const mismatchedFalsePositiveView = ui.CustomerFindingRecordView({ record: mismatchedFalsePositive, audience: "customer" });
  assert(mismatchedFalsePositiveView.sections.some((section) => section.id === "unavailable"), "nested false-positive ref mismatch fails closed");

  const malformedAccepted = structuredClone(acceptedRiskProjection);
  delete malformedAccepted.accepted_risk_outcome.customer_acceptance_summary;
  const malformedView = ui.CustomerFindingRecordView({ record: malformedAccepted, audience: "customer" });
  assert(malformedView.sections.some((section) => section.id === "unavailable"), "malformed accepted-risk outcome fails closed instead of rendering partial state");
  const malformedFalsePositive = structuredClone(falsePositiveProjection);
  malformedFalsePositive.false_positive_outcome.actor_category = "customer_user";
  const malformedFalsePositiveView = ui.CustomerFindingRecordView({ record: malformedFalsePositive, audience: "customer" });
  assert(malformedFalsePositiveView.sections.some((section) => section.id === "unavailable"), "malformed false-positive outcome fails closed instead of rendering unknown actor state");

  for (const phrase of ["auditor accepted", "SOC 2 compliant", "regulator approval", "regulatory approval", "deployment certified", "control satisfied", "customer says this is fixed and verified", "remediation completed"]) {
    const unsafeAccepted = structuredClone(acceptedRiskProjection);
    unsafeAccepted.accepted_risk_outcome.customer_acceptance_summary = `SYNTHETIC_DEMO_DATA ${phrase} outcome. NOT_CUSTOMER_SOURCE.`;
    const unsafeView = ui.CustomerFindingRecordView({ record: unsafeAccepted, audience: "customer" });
    assert(unsafeView.sections.some((section) => section.id === "unavailable"), `claim-unsafe outcome copy fails closed in UI view for ${phrase}`);
  }
}


async function testValidationHandoffsAndLaterOutcomes(ui, projection) {
  const validationPathRef = "validation_path:synthetic_customer_validation_001";
  const insufficientReason = "SYNTHETIC_DEMO_DATA runtime evidence remains unavailable. NOT_CUSTOMER_SOURCE.";
  const pathOnlyProjection = structuredClone(projection);
  pathOnlyProjection.remediation_guidance_ref = "remediation_guidance:synthetic_requires_path_only_001";
  pathOnlyProjection.reviewer_remediation_guidance = {
    guidance_status: "limited_guidance_requires_validation",
    remediation_guidance_ref: "remediation_guidance:synthetic_requires_path_only_001",
    validation_path_ref: validationPathRef,
    insufficient_evidence_reason: insufficientReason,
    limitations: ["SYNTHETIC_DEMO_DATA submitted evidence is bounded. NOT_CUSTOMER_SOURCE."]
  };
  const pathView = ui.CustomerFindingRecordView({ record: pathOnlyProjection, audience: "customer" });
  const guidanceSection = pathView.sections.find((section) => section.id === "reviewer_remediation_guidance");
  assert(guidanceSection.body.includes(validationPathRef), "validation-path-only handoff is visible in the full finding view");
  assert(guidanceSection.body.includes(insufficientReason), "insufficient-evidence reason is visible in the full finding view");

  const laterProjection = await readFixture("customer-facing-finding-record.accepted-risk-outcome.json");
  laterProjection.verification_record_ref = "verification_record:synthetic_verification_001";
  laterProjection.verification_state = {
    status: "verification_pending",
    verification_record_ref: "verification_record:synthetic_verification_001",
    summary: "SYNTHETIC_DEMO_DATA verification reference awaits a decision. NOT_CUSTOMER_SOURCE."
  };
  const laterView = ui.CustomerFindingRecordView({ record: laterProjection, audience: "customer" });
  const verification = laterView.sections.find((section) => section.id === "verification_state");
  assert(verification.items.some((entry) => entry.value === "verification_record:synthetic_verification_001"), "verification reference is visible");
  assert(laterView.sections.some((section) => section.id === "accepted_risk_outcome"), "record-backed accepted-risk outcome remains visible alongside later verification state");

  const internalProjection = { ...projection, visibility: "internal_only" };
  const internalView = ui.CustomerFindingRecordView({ record: internalProjection, audience: "customer" });
  assert(internalView.sections.some((section) => section.id === "unavailable"), "internal-only records fail closed for customer audiences");

  const verifiedWithoutRef = structuredClone(projection);
  verifiedWithoutRef.verification_state = {
    status: "verified_with_evidence",
    summary: "SYNTHETIC_DEMO_DATA malformed verification claim lacks a record reference. NOT_CUSTOMER_SOURCE."
  };
  const verifiedWithoutRefView = ui.CustomerFindingRecordView({ record: verifiedWithoutRef, audience: "customer" });
  assert(verifiedWithoutRefView.sections.some((section) => section.id === "unavailable"), "verified_with_evidence without a verification artifact fails closed");

  const futureWithoutRefs = structuredClone(projection);
  futureWithoutRefs.future_outcome_visibility = {
    accepted_risk_visible: true,
    false_positive_visible: true
  };
  const futureWithoutRefsView = ui.CustomerFindingRecordView({ record: futureWithoutRefs, audience: "customer" });
  assert(futureWithoutRefsView.sections.some((section) => section.id === "unavailable"), "future outcomes visible without refs fail closed");
  assert(!JSON.stringify(futureWithoutRefsView).includes("Recorded"), "future outcomes never fabricate Recorded without explicit refs");

  const missingStatusListRef = structuredClone(projection);
  missingStatusListRef.customer_status_record_refs = [];
  const missingStatusListRefView = ui.CustomerFindingRecordView({ record: missingStatusListRef, audience: "customer" });
  assert(missingStatusListRefView.sections.some((section) => section.id === "unavailable"), "latest status ref missing from customer_status_record_refs fails closed");

  const actionableWithoutEvidence = structuredClone(projection);
  actionableWithoutEvidence.evidence_basis.evidence_refs = [];
  const actionableWithoutEvidenceView = ui.CustomerFindingRecordView({ record: actionableWithoutEvidence, audience: "customer" });
  assert(actionableWithoutEvidenceView.sections.some((section) => section.id === "unavailable"), "actionable customer guidance without evidence refs fails closed");
}

function testCustomerStatusVocabulary(ui, projection) {
  const cases = [
    ["not_started", "Not started"],
    ["planned", "Planned"],
    ["in_progress", "In progress"],
    ["remediated_by_customer", "Remediated by customer"],
    ["validation_pending", "Validation pending"],
    ["deferred", "Deferred"],
    ["not_applicable", "Not applicable"]
  ];
  for (const [value, label] of cases) {
    const record = structuredClone(projection);
    record.customer_remediation_status.latest_status = value;
    const view = ui.CustomerFindingRecordView({ record, audience: "customer" });
    const chip = view.statusChips.find((candidate) => candidate.id === "customer_remediation_status");
    assert(chip.visibleLabel === label, `${value} customer status renders as text-first label ${label}`);
    assert(chip.accessibleLabel.includes(label), `${value} customer status label is accessible`);
    const section = view.sections.find((candidate) => candidate.id === "customer_remediation_status");
    assert(section.summary === label, `${value} customer status section summary uses bounded vocabulary label`);
  }
}

function testTextFirstAndTokenSemantics(ui, projection) {
  const view = ui.CustomerFindingRecordView({ record: projection, audience: "customer" });
  assert(view.doesNotRelyOnColor === true, "customer finding meaning must not rely on color alone");
  assert(view.statusChips.every((chip) => chip.visibleLabel.length > 0 && chip.accessibleLabel.includes(chip.visibleLabel)), "status chips are visible and accessible");
  const verification = view.statusChips.find((chip) => chip.id === "verification_state");
  assert(verification.visibleLabel === "Not verified", "not-verified state is visible");
  assert(verification.tokenRole !== "verification", "verification green is not used for not-verified or customer remediation states");
  const remediation = view.statusChips.find((chip) => chip.id === "customer_remediation_status");
  assert(remediation.visibleLabel === "Planned", "customer remediation status uses text, not color alone");
  assert(remediation.tokenRole !== "verification", "planned customer remediation does not use verification green");
}

function testNullMalformedInputs(ui) {
  assert(ui.RemediationGuidanceSummary(null).status.visibleLabel === "Guidance unavailable", "null guidance returns safe unavailable view");
  const malformed = ui.CustomerFindingRecordView({ record: null, audience: "customer" });
  assert(malformed.kind === "customer-finding-record", "malformed customer finding still returns a safe contract");
  assert(malformed.sections.some((section) => section.id === "unavailable"), "malformed input renders an unavailable section instead of throwing");
  const nullProps = ui.CustomerFindingRecordView(null);
  assert(nullProps.sections.some((section) => section.id === "unavailable"), "null props return a safe unavailable view");
}

// C6-12: (1) a forbidden phrase split by an invisible control character must
// not bypass the scan and then reassemble once rendered; (2) a negated
// closure claim elsewhere in the text must not mask an unrelated, later
// genuine positive closure claim in the same string.
function testCopySafetyClauseAndNormalizationBypasses(ui, projection) {
  const splitPhrase = { ...projection, verification_state: { ...projection.verification_state, summary: `vulnerability${String.fromCodePoint(0x200b)}-free codebase` } };
  const splitView = ui.CustomerFindingRecordView({ record: splitPhrase, audience: "customer" });
  assert(splitView.sections.some((section) => section.id === "unavailable"), "a forbidden phrase split by an invisible control character must still be rejected");

  const mixedClause = { ...projection, verification_state: { ...projection.verification_state, summary: "This is not verified. It is fixed." } };
  const mixedView = ui.CustomerFindingRecordView({ record: mixedClause, audience: "customer" });
  assert(mixedView.sections.some((section) => section.id === "unavailable"), "an unrelated later positive closure claim must not be masked by an earlier negation");
}

async function testRegisteredCustomerFacingFindingFixtures(ui) {
  const fixtureIndex = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "fixture-index.json"), "utf8"));
  const schemaId = "urn:codeattest:protocol:v0:customer-facing-finding-record";
  const validFixtures = fixtureIndex.valid_fixtures.filter((entry) => entry.schema === schemaId);
  const negativeFixtures = fixtureIndex.negative_fixtures.filter((entry) => entry.schema === schemaId);
  assert(validFixtures.length > 0, "at least one valid customer-facing-finding fixture is required");
  assert(negativeFixtures.length > 0, "at least one invalid customer-facing-finding fixture is required");

  for (const fixture of validFixtures) {
    const record = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", fixture.path), "utf8"));
    const view = ui.CustomerFindingRecordView({ record, audience: "customer" });
    assert(view.kind === "customer-finding-record", `valid fixture ${fixture.path} must render a customer finding view`);
    assert(!view.sections.some((section) => section.id === "unavailable"), `valid fixture ${fixture.path} must not fail closed`);
    if (record.evidence_consumer_export === "include") {
      const consumerView = ui.CustomerFindingRecordView({ record, audience: "evidence_consumer" });
      assert(!consumerView.sections.some((section) => section.id === "unavailable"), `exportable valid fixture ${fixture.path} must render for evidence consumers`);
    }
  }

  for (const fixture of negativeFixtures) {
    const record = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", fixture.path), "utf8"));
    const view = ui.CustomerFindingRecordView({ record, audience: "customer" });
    assert(view.sections.some((section) => section.id === "unavailable"), `invalid fixture ${fixture.path} must fail closed`);
    const serialized = JSON.stringify(view);
    if (typeof record.expert_classification?.rationale_summary === "string") {
      assert(!serialized.includes(record.expert_classification.rationale_summary), `invalid fixture ${fixture.path} must not leak classification rationale`);
    }
  }
}

function testNoHiddenHoverOnlyControls(ui, projection) {
  const view = ui.CustomerFindingRecordView({ record: projection, audience: "customer" });
  assertNoUnsafeView(view);
  assertWalk(view, (value) => {
    if (value && typeof value === "object" && "hoverOnly" in value) {
      assert(value.hoverOnly === false, "actions must not be hidden-hover-only");
      assert(value.minTargetSizePx >= 44, "actions must expose 44px target metadata");
      assert(typeof value.accessibleLabel === "string" && value.accessibleLabel.length > 0, "actions need accessible labels");
    }
  });
}

function projectedPath(pathRecord) {
  return {
    validation_path_ref: pathRecord.validation_path_id,
    path_type: pathRecord.path_type,
    required_evidence: pathRecord.required_evidence,
    steps: pathRecord.steps,
    expected_result: pathRecord.expected_result,
    limitations: [...pathRecord.limitations],
    included_pass_verifiability: pathRecord.included_pass_verifiability,
    ...(pathRecord.reviewer_validation_script_refs === undefined ? {} : { reviewer_validation_script_refs: [...pathRecord.reviewer_validation_script_refs] }),
    ...(pathRecord.output_attachment_instructions === undefined ? {} : { output_attachment_instructions: pathRecord.output_attachment_instructions }),
    ...(pathRecord.target === undefined ? {} : { target: pathRecord.target }),
    ...(pathRecord.authorization_assumption === undefined ? {} : { authorization_assumption: pathRecord.authorization_assumption }),
    ...(pathRecord.method === undefined ? {} : { method: pathRecord.method }),
    ...(pathRecord.safety_constraints === undefined ? {} : { safety_constraints: pathRecord.safety_constraints }),
    ...(pathRecord.evidence_artifacts_to_collect === undefined ? {} : { evidence_artifacts_to_collect: [...pathRecord.evidence_artifacts_to_collect] })
  };
}

function projectedScript(script) {
  return {
    validation_script_ref: script.validation_script_id,
    validation_path_ref: script.validation_path_ref,
    script_package_status: script.script_package_status,
    ...(script.included_script_slot === undefined ? {} : { included_script_slot: script.included_script_slot }),
    ...(script.script_package_status === "additional_script_candidate_pricing_tbd" ? { pricing_note: "Additional reviewer-authored script candidate; pricing TBD." } : {}),
    purpose: script.purpose,
    prerequisites: script.prerequisites,
    execution_steps: script.execution_steps,
    expected_output: script.expected_output,
    safety_notes: script.safety_notes,
    output_attachment_instructions: script.output_attachment_instructions,
    script_content: script.script_content
  };
}

function workbenchProps(record, guidance) {
  return {
    draft: {
      reviewFindingDraftId: record.review_finding_draft_ref,
      title: "SYNTHETIC_DEMO_DATA reviewer workbench draft. NOT_CUSTOMER_SOURCE.",
      affectedArea: "SYNTHETIC_DEMO_DATA payments-api authentication middleware. NOT_CUSTOMER_SOURCE.",
      scannerContext: [{ label: "Scanner rule", value: "semgrep.synthetic.rule" }],
      evidenceReferences: [{ label: "Finding context snippet", value: "artifact_ref:synthetic_snippet_001", availabilityState: "available_reference" }],
      evidenceBasis: record.evidence_basis,
      thresholdGaps: record.threshold_gaps,
      limitations: record.limitations,
      sourceReferenceState: record.source_reference_state
    },
    currentClassification: record,
    // C6-09: the guidance/classification fixtures used across these tests
    // are independently valid but were never authored as one draft-bound
    // pair — reseal the ref so this test exercises the intended guidance
    // content against a coherent record graph rather than an incidental
    // cross-draft combination the workbench now correctly rejects.
    structuredRemediationGuidance: guidance === undefined ? undefined : { ...guidance, review_finding_draft_ref: record.review_finding_draft_ref },
    reviewerNotes: "SYNTHETIC_DEMO_DATA reviewer note without raw source bytes. NOT_CUSTOMER_SOURCE.",
    validationPathText: record.validation_path_summary ?? "SYNTHETIC_DEMO_DATA validation path field visible. NOT_CUSTOMER_SOURCE.",
    snippets: []
  };
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertNoUnsafeView(view) {
  const serialized = JSON.stringify(view).toLowerCase();
  for (const forbidden of ["dangerouslysetinnerhtml", "no vulnerabilities", "audit accepted", "soc 2 accepted", "certified", "regulator approved", "independent assurance"]) {
    assert(!serialized.includes(forbidden), `view contract must not contain forbidden copy: ${forbidden}`);
  }
}

function assertWalk(value, visitor) {
  visitor(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      assertWalk(item, visitor);
    }
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      assertWalk(child, visitor);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
