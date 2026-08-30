// Story 3.2: dependency-free reviewer classification workbench contracts.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-classification-workbench-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-classification-workbench-test-dist");

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
  for (const exportName of ["ClassificationBadge", "ReviewerClassificationWorkbench"]) {
    assert(exportName in ui, `missing public export: ${exportName}`);
  }

  const likely = await readFixture("finding-classification-record.likely.json");
  const confirmed = await readFixture("finding-classification-record.confirmed-submitted-evidence.json");
  const confirmedMetadata = await readFixture("finding-classification-record.confirmed-metadata-defensible.json");
  const inconclusive = await readFixture("finding-classification-record.inconclusive.json");
  const requiresValidation = await readFixture("finding-classification-record.requires-validation.json");

  testAllowedBadges(ui, { likely, confirmed, confirmedMetadata, inconclusive, requiresValidation });
  testWorkbenchLayoutParity(ui, { requiresValidation, confirmed });
  testWorkbenchInitialOpenState(ui, likely);
  testKeyboardAndShortcutSuppression(ui, requiresValidation);
  testSnippetDisclosure(ui, likely);
  await testValidationPathAndScriptPanels(ui, requiresValidation);
  testSanitizerPreservesMultilineTextAndRemovesInvisibleControls(ui, likely);
  testUnknownTaxonomyStates(ui, likely);
  testNullAndMissingCollectionsDoNotCrash(ui, likely);
  testNoHiddenHoverOnlyControls(ui, confirmed);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("UI classification workbench tests passed.");

function testAllowedBadges(ui, records) {
  const cases = [
    [records.likely, "Likely", "review"],
    [records.confirmed, "Confirmed", "verification"],
    [records.inconclusive, "Inconclusive", "neutral"],
    [records.requiresValidation, "Requires customer-side validation", "warning"]
  ];

  for (const [record, label, tokenRole] of cases) {
    const badge = ui.ClassificationBadge(record);
    assert(badge.kind === "classification-badge", "badge kind must be stable");
    assert(badge.visibleLabel === label, `${record.classification} must have visible text`);
    assert(badge.accessibleLabel.includes(label), `${record.classification} accessible label includes visible label`);
    assert(badge.meaning.length > 0, `${record.classification} must explain evidence basis or limitations`);
    assert(badge.tokenRole === tokenRole, `${record.classification} token role must match UX meaning`);
    assert(badge.doesNotRelyOnColor === true, "classification meaning must not rely on color alone");
    assert(badge.evidenceBasis.length > 0, "badge must expose evidence basis");
    assert(badge.limitations.length > 0, "badge must keep limitations visible");
  }

  assert(ui.ClassificationBadge(records.confirmed).tokenRole === "verification", "verification green is used only for confirmed classification");
  assert(ui.ClassificationBadge(records.likely).tokenRole !== "verification", "likely must not use verification green");
  assert(ui.ClassificationBadge(records.inconclusive).tokenRole !== "verification", "inconclusive must not use verification green");
  assert(ui.ClassificationBadge(records.requiresValidation).tokenRole !== "verification", "validation-required must not use verification green");
  const confirmedBadge = ui.ClassificationBadge(records.confirmed);
  assert(
    JSON.stringify(confirmedBadge.confirmationCriteria) === JSON.stringify(records.confirmed.confirmation_criteria),
    "confirmed badge must expose reviewer confirmation criteria"
  );
  assert(ui.ClassificationBadge(records.requiresValidation).validationPath.length > 0, "validation-required badge must expose validation path text");

  // C6-06: a customer-authored (or simply empty) object with no reviewer
  // identity, evidence, criteria, or limitations must never render as a
  // green "Confirmed" verification badge.
  const forgedConfirmed = { classification: "confirmed" };
  assert(ui.ClassificationBadge(forgedConfirmed).classification === "unknown", "a bare {classification:confirmed} object must not become a Confirmed badge");
  assert(ui.ClassificationBadge(forgedConfirmed).tokenRole !== "verification", "a forged confirmed object must never render verification green");

  const customerAuthored = { classification: "confirmed", actor: { actor_type: "customer_user", actor_id: "customer:synthetic-eve" }, evidence_basis: ["scanner_output"], limitations: ["placeholder"], confirmation_criteria: ["not a real criterion just filler text"] };
  assert(ui.ClassificationBadge(customerAuthored).tokenRole !== "verification", "a customer-authored actor must never produce a Confirmed badge");

  const missingCriteria = { ...records.confirmed, confirmation_criteria: [] };
  assert(ui.ClassificationBadge(missingCriteria).tokenRole !== "verification", "confirmed without meaningful criteria must not render verification green");

  const insufficientBasisNoDefensible = { ...records.confirmed, evidence_basis: ["scanner_output"], defensible_confirmation_criteria: undefined };
  assert(ui.ClassificationBadge(insufficientBasisNoDefensible).tokenRole !== "verification", "confirmed with only scanner-output basis and no defensible criteria must not render verification green");

  const unsafeText = { ...records.likely, rationale: "CodeAttest certifies the code is vulnerability-free" };
  assert(ui.ClassificationBadge(unsafeText).classification === "unknown", "claim-unsafe rationale text must make the badge unavailable rather than rendering the unsafe claim");
  for (const record of [records.likely, records.inconclusive, records.requiresValidation]) {
    const badge = ui.ClassificationBadge(record);
    assert(
      JSON.stringify(badge.thresholdGaps) === JSON.stringify(record.threshold_gaps),
      `${record.classification} badge must expose threshold gaps`
    );
    assert(badge.thresholdGaps.length > 0, `${record.classification} badge must not drop non-empty threshold gaps`);
  }
  assert(
    ui.ClassificationBadge(records.confirmedMetadata).defensibleConfirmationCriteria === records.confirmedMetadata.defensible_confirmation_criteria,
    "metadata/scanner confirmation badge must expose its defensible confirmation justification"
  );
}

function testWorkbenchLayoutParity(ui, records) {
  const record = records.requiresValidation;
  const view = ui.ReviewerClassificationWorkbench(workbenchProps(record));
  assert(view.kind === "classification-workbench", "workbench kind must be stable");
  assert(view.currentState.badge.visibleLabel === "Requires customer-side validation", "current classification badge remains visible");
  assert(
    JSON.stringify(view.currentState.thresholdGaps) === JSON.stringify(record.threshold_gaps),
    "workbench current state must expose classified-state threshold gaps"
  );
  assert(view.currentState.thresholdGaps.length > 0, "workbench current state must not drop non-empty threshold gaps");
  const validationLimitationsPanel = view.panels.find((panel) => panel.id === "limitations");
  assert(
    validationLimitationsPanel.items.some((item) => item.label === "Threshold gap" && item.value === record.threshold_gaps[0]),
    "workbench limitations panel must expose classified-state threshold gaps"
  );
  assert(view.panels.some((panel) => panel.id === "evidence_references"), "evidence references panel must exist");
  const evidencePanel = view.panels.find((panel) => panel.id === "evidence_references");
  assert(evidencePanel.items.some((item) => item.label.includes("available_reference") && item.value.includes("available for review")), "evidence references panel must surface per-reference availability state");
  assert(evidencePanel.items.some((item) => item.label.includes("deleted") && item.value.includes("not available for review")), "evidence references panel must not hide unavailable disclosure state");
  const scannerOnlyProps = workbenchProps(record);
  delete scannerOnlyProps.currentClassification;
  scannerOnlyProps.draft.evidenceBasis = ["scanner_output", "metadata_only"];
  const scannerOnlyView = ui.ReviewerClassificationWorkbench(scannerOnlyProps);
  const scannerOnlyDecision = scannerOnlyView.panels.find((panel) => panel.id === "classification_decision");
  assert(scannerOnlyDecision.actions.find((action) => action.type === "choose_confirmed").actionable === false, "confirmed choice is disabled until scanner/metadata-only guardrail context exists");
  assert(view.panels.some((panel) => panel.id === "scanner_context"), "scanner context panel must exist");
  assert(view.panels.some((panel) => panel.id === "reviewer_notes"), "reviewer notes panel must exist");
  assert(view.panels.some((panel) => panel.id === "remediation_guidance"), "remediation guidance panel must exist");
  assert(view.panels.some((panel) => panel.id === "validation_path"), "validation path panel must exist");
  assert(view.panels.some((panel) => panel.id === "limitations"), "limitations panel must exist");

  // C6-29: every field must belong to exactly one panel — a duplicate field
  // id across panels creates duplicate DOM/form/focus/serialization identity.
  const remediationPanel = view.panels.find((panel) => panel.id === "remediation_guidance");
  const validationPathPanel = view.panels.find((panel) => panel.id === "validation_path");
  const remediationFieldIds = new Set(remediationPanel.fields.map((field) => field.id));
  assert(!remediationFieldIds.has("validation_path_summary"), "validation_path_summary must belong only to the validation path panel");
  assert(!remediationFieldIds.has("validation_path_ref"), "validation_path_ref must belong only to the validation path panel");
  assert(validationPathPanel.fields.length > 0, "sanity check: the validation path panel must still expose fields");
  const allFieldIds = view.panels.flatMap((panel) => panel.fields.map((field) => field.id));
  assert(new Set(allFieldIds).size === allFieldIds.length, "every field id must be unique across all panels");

  const desktop = view.layouts.find((layout) => layout.mode === "desktop_two_column");
  const stacked = view.layouts.find((layout) => layout.mode === "stacked_narrow");
  assert(desktop !== undefined, "desktop two-column layout metadata must exist");
  assert(stacked !== undefined, "stacked narrow layout metadata must exist");
  assert(desktop.exposesCurrentState === true && stacked.exposesCurrentState === true, "both layouts expose current state");
  assert(desktop.actionSetKey === stacked.actionSetKey, "both layouts expose the same action set");

  const desktopPanels = new Set(desktop.regions.flatMap((region) => region.panelIds));
  const stackedPanels = new Set(stacked.regions.flatMap((region) => region.panelIds));
  assertSetEquals(desktopPanels, stackedPanels, "desktop and stacked layouts must expose the same panels");
  assertSetEquals(new Set(view.panels.map((panel) => panel.id)), stackedPanels, "layout metadata must cover every panel");

  const confirmedView = ui.ReviewerClassificationWorkbench(workbenchProps(records.confirmed));
  const classificationPanel = confirmedView.panels.find((panel) => panel.id === "classification_decision");
  assert(
    JSON.stringify(confirmedView.currentState.badge.confirmationCriteria) === JSON.stringify(records.confirmed.confirmation_criteria),
    "workbench current-state badge must expose confirmed criteria"
  );
  assert(
    classificationPanel.items.some((item) => item.label === "Confirmation criterion" && item.value === records.confirmed.confirmation_criteria[0]),
    "workbench classification panel must expose confirmed criteria"
  );

  for (const recordWithGap of [records.requiresValidation]) {
    const gapView = ui.ReviewerClassificationWorkbench(workbenchProps(recordWithGap));
    const gapPanel = gapView.panels.find((panel) => panel.id === "limitations");
    assert(
      JSON.stringify(gapView.currentState.thresholdGaps) === JSON.stringify(recordWithGap.threshold_gaps),
      `${recordWithGap.classification} workbench current state must expose threshold gaps`
    );
    assert(
      gapPanel.items.some((item) => item.label === "Threshold gap" && item.value === recordWithGap.threshold_gaps[0]),
      `${recordWithGap.classification} workbench limitations panel must expose threshold gaps`
    );
  }
}

function testWorkbenchInitialOpenState(ui, record) {
  const props = workbenchProps(record);
  delete props.currentClassification;
  const view = ui.ReviewerClassificationWorkbench(props);
  assert(view.currentState.badge === null, "initial-open workbench state has no current classification badge");
  assert(view.currentState.evidenceBasis.length === props.draft.evidenceBasis.length, "draft evidence basis remains visible before classification");
  assert(view.currentState.thresholdGaps.length === props.draft.thresholdGaps.length, "draft threshold gaps remain visible before classification");
  assert(view.currentState.limitations.length === props.draft.limitations.length, "draft limitations remain visible before classification");
  assert(view.panels.find((panel) => panel.id === "classification_decision").summary.includes("Choose likely"), "classification panel guides initial choice without dereferencing a badge");
}

function testKeyboardAndShortcutSuppression(ui, record) {
  const view = ui.ReviewerClassificationWorkbench(workbenchProps(record));
  const targets = new Set(view.keyboardActions.map((action) => action.target));
  for (const target of ["findings", "classification_choices", "evidence_references", "remediation_guidance", "validation_path"]) {
    assert(targets.has(target), `keyboard action target must exist: ${target}`);
  }
  assert(view.keyboardActions.every((action) => action.suppressedInTextEntry === true), "keyboard actions must be suppressed in text entry");
  assert(
    view.keyboardActions.every((action) => action.accessibleLabel.includes("reviewer notes") && action.accessibleLabel.includes("remediation guidance") && action.accessibleLabel.includes("validation path") && action.accessibleLabel.includes("snippet")),
    "keyboard accessible labels name every shortcut-suppression zone"
  );

  const zoneTypes = new Set(view.shortcutSuppressionZones.map((zone) => zone.zoneType));
  for (const zoneType of ["reviewer_notes", "remediation_guidance", "validation_path", "snippet_text"]) {
    assert(zoneTypes.has(zoneType), `shortcut suppression zone must exist: ${zoneType}`);
  }
  assert(view.shortcutSuppressionZones.every((zone) => zone.shortcutsSuppressed === true), "all suppression zones must suppress shortcuts");
}

function testSnippetDisclosure(ui, record) {
  const view = ui.ReviewerClassificationWorkbench(workbenchProps(record));
  assert(view.snippets.length === 6, "fixture covers available, unavailable, unresolved, invalid, and out-of-range snippets");
  const available = view.snippets.find((snippet) => snippet.availabilityState === "available_reference" && snippet.id === "snippet-available");
  const deleted = view.snippets.find((snippet) => snippet.availabilityState === "deleted");
  const notCollected = view.snippets.find((snippet) => snippet.availabilityState === "not_collected");
  const notSubmitted = view.snippets.find((snippet) => snippet.availabilityState === "not_submitted");
  const unresolved = view.snippets.find((snippet) => snippet.availabilityState === "unresolved_reference");
  const inverted = view.snippets.find((snippet) => snippet.id === "snippet-inverted-lines");

  assert(available.label === "Source-code disclosure", "available snippet must be visibly labeled as source-code disclosure");
  assert(available.sourceCodeDisclosure === true, "source-code disclosure boolean must be explicit");
  assert(available.lineReference.startLine === 12 && available.lineReference.endLine === 18, "line references must be preserved");
  assert(available.redactionMarkers.some((marker) => marker.line === 15 && marker.marker === "[REDACTED]"), "redaction markers must be preserved");
  assert(!available.redactionMarkers.some((marker) => marker.line === 99), "out-of-range redaction markers must be filtered");
  assert(available.actions.every((action) => action.hoverOnly === false), "snippet actions must not be hover-only");
  assert(available.actions.some((action) => action.type === "copy_snippet" && action.actionable === true), "copy action is explicit and permission gated");
  assert(available.actions.some((action) => action.type === "download_snippet" && action.actionable === false), "download action is explicit even when denied");
  assert(available.permissionGate.copyAllowed === true && available.permissionGate.downloadAllowed === false, "snippet permission gate must be visible");

  for (const snippet of [deleted, notCollected, notSubmitted, unresolved]) {
    assert(snippet.label === "Source-code disclosure", `${snippet.availabilityState} snippet still carries disclosure label`);
    assert(snippet.contentPreview === undefined, `${snippet.availabilityState} snippets must not render withheld content preview`);
    assert(snippet.actions.every((action) => action.actionable === false), `${snippet.availabilityState} snippet copy/download controls are denied`);
  }
  assert(inverted.lineReference.startLine === 1 && inverted.lineReference.endLine === 1, "invalid or inverted line ranges fall back to an explicit unavailable line reference");
  assert(inverted.redactionMarkers.length === 0, "redaction markers outside the safe line range are filtered");

  // C6-10: a snippet claiming available_reference for a ref the canonical
  // evidence map says is deleted must not disclose content or enable
  // copy/download, no matter what the snippet itself asserts.
  const contradictedProps = workbenchProps(record);
  contradictedProps.snippets = [{
    id: "snippet-contradicted",
    artifactRef: "artifact_ref:synthetic_deleted_001",
    startLine: 1,
    endLine: 5,
    availabilityState: "available_reference",
    contentPreview: "must not render",
    copyAllowed: true,
    downloadAllowed: true,
    permissionReason: "forged"
  }];
  const contradictedView = ui.ReviewerClassificationWorkbench(contradictedProps);
  const [contradicted] = contradictedView.snippets;
  assert(contradicted.availabilityState === "unresolved_reference", "a self-asserted available_reference contradicted by the canonical evidence map must be downgraded");
  assert(contradicted.contentPreview === undefined, "contradicted snippet content must not render");
  assert(contradicted.permissionGate.copyAllowed === false && contradicted.permissionGate.downloadAllowed === false, "contradicted snippet must not permit copy/download");

  // C6-10: a duplicate evidence-reference entry is ambiguous and must never
  // resolve to a usable availability.
  const duplicateProps = workbenchProps(record);
  duplicateProps.draft.evidenceReferences = [
    { label: "A", value: "artifact_ref:synthetic_dup_001", availabilityState: "available_reference" },
    { label: "B", value: "artifact_ref:synthetic_dup_001", availabilityState: "deleted" }
  ];
  duplicateProps.snippets = [{
    id: "snippet-dup",
    artifactRef: "artifact_ref:synthetic_dup_001",
    startLine: 1,
    endLine: 5,
    availabilityState: "available_reference",
    contentPreview: "must not render",
    copyAllowed: true,
    downloadAllowed: true,
    permissionReason: "forged"
  }];
  const duplicateView = ui.ReviewerClassificationWorkbench(duplicateProps);
  const [duplicateSnippet] = duplicateView.snippets;
  assert(duplicateSnippet.availabilityState === "unresolved_reference", "an ambiguous (duplicate) evidence reference must never resolve to a usable availability");
  assert(duplicateSnippet.permissionGate.copyAllowed === false, "ambiguous evidence reference must not permit copy");

  // C6-10: an invalid/inverted line range must disable disclosure entirely,
  // not just fall back to a plausible-looking 1-1 citation.
  const invertedRangeProps = workbenchProps(record);
  invertedRangeProps.snippets = [{
    id: "snippet-inverted-forged",
    artifactRef: "artifact_ref:synthetic_snippet_001",
    startLine: 20,
    endLine: 5,
    availabilityState: "available_reference",
    contentPreview: "must not render",
    copyAllowed: true,
    downloadAllowed: true,
    permissionReason: "forged"
  }];
  const invertedRangeView = ui.ReviewerClassificationWorkbench(invertedRangeProps);
  const [invertedRangeSnippet] = invertedRangeView.snippets;
  assert(invertedRangeSnippet.contentPreview === undefined, "an inverted line range must not disclose content even for an otherwise-available ref");
  assert(invertedRangeSnippet.permissionGate.copyAllowed === false, "an inverted line range must disable copy");
}

async function testValidationPathAndScriptPanels(ui, record) {
  const validationPath = await readFixture("finding-validation-path.customer-run-script.json");
  const remotePath = await readFixture("finding-validation-path.remote-dynamic-testing.json");
  const manualPath = await readFixture("finding-validation-path.manual-steps.json");
  const includedScript = await readFixture("reviewer-validation-script.included-slot-1.json");
  const additionalScript = await readFixture("reviewer-validation-script.additional-pricing-tbd.json");
  const view = ui.ReviewerClassificationWorkbench({
    ...workbenchProps(record),
    // C6-09: the detail fields (and any script fields shown alongside them)
    // are for the *first* draft-bound path, so the path scripts are actually
    // bound to (via validation_path_ref) must be first for this test to
    // exercise a coherent, non-contradictory record graph.
    structuredValidationPaths: [{ ...validationPath, reviewer_validation_script_refs: [includedScript.validation_script_id, additionalScript.validation_script_id] }, remotePath, manualPath],
    reviewerValidationScripts: [includedScript, additionalScript],
    structuredRemediationGuidance: {
      review_finding_draft_ref: record.review_finding_draft_ref,
      exploitability_rationale: "SYNTHETIC_DEMO_DATA exploitability rationale. NOT_CUSTOMER_SOURCE.",
      suggested_remediation: "SYNTHETIC_DEMO_DATA suggested remediation. NOT_CUSTOMER_SOURCE.",
      validation_steps: "SYNTHETIC_DEMO_DATA validation steps. NOT_CUSTOMER_SOURCE.",
      validation_path_summary: "SYNTHETIC_DEMO_DATA validation path summary. NOT_CUSTOMER_SOURCE.",
      validation_path_ref: validationPath.validation_path_id,
      limitations: ["SYNTHETIC_DEMO_DATA limitation. NOT_CUSTOMER_SOURCE."]
    }
  });
  const validationPanel = view.panels.find((panel) => panel.id === "validation_path");
  const remediationPanelForPathFields = view.panels.find((panel) => panel.id === "remediation_guidance");
  assert(validationPanel.summary.includes("Customer-run script"), "validation panel summary describes the primary (script-bound) validation path");
  assert(validationPanel.items.some((item) => item.label === "Validation path" && item.value === validationPath.validation_path_id), "validation path id is visible");
  assert(validationPanel.items.some((item) => item.label === "Path type" && item.value === "Customer-run script"), "validation path type is text-first");
  assert(validationPanel.items.some((item) => item.label === "Path type" && item.value === "Remote dynamic testing"), "remote dynamic testing branch label is visible");
  assert(validationPanel.items.some((item) => item.label === "Path type" && item.value === "Manual steps"), "manual-step branch label is visible");
  assert(validationPanel.items.some((item) => item.label === "Reviewer-authored script" && item.value === includedScript.validation_script_id), "included reviewer-authored script ref is visible");
  assert(validationPanel.fields.some((field) => field.id === "validation_path_required_evidence" && field.shortcutsSuppressed === true), "validation path required evidence is a shortcut-suppressed text-entry zone");

  // C6-09: remote-dynamic-testing-specific detail fields are checked with
  // that path type primary — a customer-run-script path (this test's
  // primary path above) has no target/method/authorization fields of its
  // own, and a real record graph never has one path claiming both types.
  const remoteView = ui.ReviewerClassificationWorkbench({
    ...workbenchProps(record),
    structuredValidationPaths: [remotePath, manualPath]
  });
  const remotePanel = remoteView.panels.find((panel) => panel.id === "validation_path");
  assert(remotePanel.fields.some((field) => field.id === "validation_path_target" && field.value === remotePath.target), "remote dynamic testing target is visible in the workbench");
  assert(remotePanel.fields.some((field) => field.id === "validation_path_authorization_assumption" && field.value === remotePath.authorization_assumption), "remote authorization assumption is visible in the workbench");
  assert(remotePanel.fields.some((field) => field.id === "validation_path_method" && field.value === remotePath.method), "remote method is visible in the workbench");
  assert(remotePanel.fields.some((field) => field.id === "validation_path_safety_constraints" && field.value === remotePath.safety_constraints), "remote safety constraints are visible in the workbench");

  assert(validationPanel.fields.some((field) => field.id === "validation_script_purpose" && field.value === includedScript.purpose), "script purpose is visible separately from validation steps");
  assert(validationPanel.fields.some((field) => field.id === "validation_script_prerequisites" && field.value === includedScript.prerequisites), "script prerequisites are visible separately from validation steps");
  assert(validationPanel.fields.some((field) => field.id === "validation_script_execution_steps" && field.value === includedScript.execution_steps), "script execution steps are visible separately from validation steps");
  assert(validationPanel.fields.some((field) => field.id === "validation_script_output_attachment_instructions" && field.value === includedScript.output_attachment_instructions), "script attachment instructions are visible separately from validation steps");
  assert(validationPanel.fields.some((field) => field.id === "validation_script_content" && field.value === includedScript.script_content), "approved script content is visible as a retained Review Artifact field");
  assert(view.shortcutSuppressionZones.some((zone) => zone.id === "validation_script_execution_steps" && zone.zoneType === "validation_path"), "script text suppresses global shortcuts");
  assert(JSON.stringify(validationPanel).includes("pricing TBD"), "additional script candidate preserves pricing TBD copy");
  assert(!JSON.stringify(validationPanel).includes("Verified"), "validation path/script authoring does not claim verification complete");

  // C6-09: a path/script/guidance from a different draft must not appear.
  const wrongDraftPath = { ...remotePath, review_finding_draft_ref: "review_finding_draft:a_different_finding" };
  const crossDraftView = ui.ReviewerClassificationWorkbench({
    ...workbenchProps(record),
    structuredValidationPaths: [wrongDraftPath]
  });
  const crossDraftPanel = crossDraftView.panels.find((panel) => panel.id === "validation_path");
  assert(!crossDraftPanel.items.some((item) => item.value === wrongDraftPath.validation_path_id), "a validation path bound to a different draft must not render");
  assert(!crossDraftPanel.fields.some((field) => field.id === "validation_path_target"), "detail fields for a cross-draft path must not render");

  // Deliberately does not reuse includedScript's id: the path fixture itself
  // separately self-declares `reviewer_validation_script_refs` (its own
  // "expected script" list, an unrelated pre-existing feature) containing
  // that id, which would make this assertion pass for the wrong reason.
  const wrongPathScript = { ...additionalScript, validation_script_id: "validation_script:synthetic_unrelated_999", validation_path_ref: "validation_path:an_unrelated_path" };
  const scriptMismatchView = ui.ReviewerClassificationWorkbench({
    ...workbenchProps(record),
    structuredValidationPaths: [{ ...validationPath, reviewer_validation_script_refs: [validationPath.reviewer_validation_script_refs[0]] }],
    reviewerValidationScripts: [wrongPathScript]
  });
  const scriptMismatchPanel = scriptMismatchView.panels.find((panel) => panel.id === "validation_path");
  assert(!scriptMismatchPanel.fields.some((field) => field.id === "validation_script_content"), "a script bound to a different path must not render as this path's script");
  assert(!scriptMismatchPanel.items.some((item) => item.value === wrongPathScript.validation_script_id), "a script bound to a different path must not appear in validation path items");

  // C6-29: validation_path_summary/ref belong to exactly one panel.
  assert(validationPanel.fields.some((field) => field.id === "validation_path_summary"), "validation_path_summary must appear in the validation path panel");
  assert(validationPanel.fields.some((field) => field.id === "validation_path_ref"), "validation_path_ref must appear in the validation path panel");
  assert(!remediationPanelForPathFields.fields.some((field) => field.id === "validation_path_summary"), "validation_path_summary must not also appear in the remediation guidance panel");
  assert(!remediationPanelForPathFields.fields.some((field) => field.id === "validation_path_ref"), "validation_path_ref must not also appear in the remediation guidance panel");
}

function testSanitizerPreservesMultilineTextAndRemovesInvisibleControls(ui, record) {
  const view = ui.ReviewerClassificationWorkbench({
    ...workbenchProps(record),
    reviewerNotes: "first paragraph\nsecond\tcolumn\rthird​hidden"
  });
  const notes = view.panels.find((panel) => panel.id === "reviewer_notes").fields[0].value;
  assert(notes.includes("first paragraph\nsecond\tcolumn\rthirdhidden"), "multiline text fields preserve newline, tab, and carriage return while stripping zero-width controls");
  assert(!notes.includes("​"), "zero-width characters are removed from visible text");
  const bigintView = ui.ReviewerClassificationWorkbench({ ...workbenchProps(record), reviewerNotes: BigInt(42) });
  assert(bigintView.panels.find((panel) => panel.id === "reviewer_notes").fields[0].value === "", "bigint values must not be coerced into visible reviewer text");
}

function testUnknownTaxonomyStates(ui, record) {
  const unknownClassification = ui.ClassificationBadge({ ...record, classification: "critical" });
  assert(unknownClassification.classification === "unknown", "unknown classification must not be silently coerced to inconclusive");
  assert(unknownClassification.visibleLabel === "Unknown classification", "unknown classification has explicit visible state");
  assert(unknownClassification.tokenRole === "warning", "unknown classification uses warning treatment");

  const unknownBasis = ui.ClassificationBadge({ ...record, evidence_basis: ["scanner_output", "mystery_basis"] });
  assert(unknownBasis.evidenceBasis.some((basis) => basis.value === "unknown" && basis.unknownValue === "mystery_basis"), "unknown evidence basis is surfaced explicitly instead of dropped");
  const inheritedBasis = ui.ClassificationBadge({ ...record, evidence_basis: ["toString"] });
  assert(inheritedBasis.evidenceBasis[0].value === "unknown", "inherited object keys are not accepted as protocol evidence-basis values");
}

function testNullAndMissingCollectionsDoNotCrash(ui, record) {
  assert(ui.ClassificationBadge(null).classification === "unknown", "null classification badge input degrades to unknown");
  assert(ui.ReviewerClassificationWorkbench(null).draftRef === "review_finding_draft:unavailable", "null workbench props return a serializable unavailable view");
  assert(ui.ReviewerClassificationWorkbench({}).draftRef === "review_finding_draft:unavailable", "missing draft input returns a serializable unavailable view");

  // C6-07: the synthetic unavailable view must expose no mutating action.
  const unavailableView = ui.ReviewerClassificationWorkbench(null);
  assert(unavailableView.available === false, "a null-props workbench must be marked unavailable");
  assert(unavailableView.actionSet.every((action) => action.actionable === false), "an unavailable workbench's action set must have no actionable entries");
  assert(unavailableView.panels.every((panel) => panel.actions.every((action) => action.actionable === false)), "an unavailable workbench's panel actions must have no actionable entries");

  // C6-07: empty evidence basis must never be sufficient to enable Confirmed.
  const emptyBasisProps = workbenchProps(record);
  emptyBasisProps.draft.evidenceBasis = [];
  const emptyBasisView = ui.ReviewerClassificationWorkbench(emptyBasisProps);
  const confirmedChoice = emptyBasisView.panels.find((panel) => panel.id === "classification_decision").actions.find((action) => action.type === "choose_confirmed");
  assert(confirmedChoice.actionable === false, "empty evidence basis must not enable the Confirmed choice");

  // C6-08: a classification record bound to a different draft must never be
  // treated as this draft's current state.
  const crossDraftProps = workbenchProps(record);
  crossDraftProps.draft.reviewFindingDraftId = "review_finding_draft:a_different_draft";
  const crossDraftView = ui.ReviewerClassificationWorkbench(crossDraftProps);
  assert(crossDraftView.currentState.badge === null, "a classification record for a different draft must not be surfaced as the current badge");
  const crossDraftConfirmedChoice = crossDraftView.panels.find((panel) => panel.id === "classification_decision").actions.find((action) => action.type === "choose_confirmed");
  assert(crossDraftConfirmedChoice.actionable === false, "a cross-draft confirmed record must not enable Confirmed for this draft");
  const props = workbenchProps(record);
  props.currentClassification = null;
  props.draft.evidenceReferences = null;
  props.draft.scannerContext = undefined;
  props.snippets = [null, { ...props.snippets[0], availabilityState: "not-a-state", contentPreview: "must not render" }];
  const view = ui.ReviewerClassificationWorkbench(props);
  assert(view.currentState.badge === null, "null currentClassification is treated as no current classification");
  assert(view.panels.find((panel) => panel.id === "evidence_references").items.length === 0, "null evidenceReferences does not crash or fabricate items");
  assert(view.panels.find((panel) => panel.id === "scanner_context").items.length === 0, "missing scannerContext does not crash or fabricate items");

  const collectionMembers = workbenchProps(record);
  collectionMembers.draft.evidenceReferences = [null, { label: "Evidence ref", value: "artifact_ref:synthetic_member_001" }];
  collectionMembers.draft.scannerContext = [null, { label: "Scanner rule", value: "semgrep.synthetic.rule" }];
  const collectionView = ui.ReviewerClassificationWorkbench(collectionMembers);
  assert(collectionView.panels.find((panel) => panel.id === "evidence_references").items.length === 1, "null evidenceReferences members are ignored without crashing");
  assert(collectionView.panels.find((panel) => panel.id === "scanner_context").items.length === 1, "null scannerContext members are ignored without crashing");
  assert(view.snippets.length === 1, "null snippet members are ignored");
  assert(view.snippets[0].availabilityState === "unresolved_reference", "unknown snippet availability becomes explicit unresolved state");
  assert(view.snippets[0].contentPreview === undefined, "unknown snippet availability cannot render content preview");

  const malformedPermissions = workbenchProps(record);
  malformedPermissions.snippets = [{
    ...malformedPermissions.snippets[0],
    copyAllowed: "yes",
    downloadAllowed: 1
  }];
  const permissionView = ui.ReviewerClassificationWorkbench(malformedPermissions);
  assert(permissionView.snippets[0].permissionGate.copyAllowed === false, "non-boolean copy permission fails closed");
  assert(permissionView.snippets[0].permissionGate.downloadAllowed === false, "non-boolean download permission fails closed");
}

function testNoHiddenHoverOnlyControls(ui, record) {
  const view = ui.ReviewerClassificationWorkbench(workbenchProps(record));
  assertNoUnsafeView(view);
  assertWalk(view, (value) => {
    if (value && typeof value === "object" && "hoverOnly" in value) {
      assert(value.hoverOnly === false, "actions must not be hidden-hover-only");
      assert(value.minTargetSizePx >= 44, "actions must expose 44px target metadata");
      assert(typeof value.accessibleLabel === "string" && value.accessibleLabel.length > 0, "actions need accessible labels");
    }
  });
}

function workbenchProps(record) {
  return {
    draft: {
      reviewFindingDraftId: record.review_finding_draft_ref,
      title: "SYNTHETIC_DEMO_DATA reviewer workbench draft. NOT_CUSTOMER_SOURCE.",
      affectedArea: "SYNTHETIC_DEMO_DATA payments-api authentication middleware. NOT_CUSTOMER_SOURCE.",
      scannerContext: [
        { label: "Scanner rule", value: "semgrep.synthetic.rule" },
        { label: "Scanner confidence", value: "medium" }
      ],
      evidenceReferences: [
        { label: "Finding context snippet", value: "artifact_ref:synthetic_snippet_001", availabilityState: "available_reference" },
        { label: "Deleted reference", value: "artifact_ref:synthetic_deleted_001", availabilityState: "deleted" }
      ],
      evidenceBasis: record.evidence_basis,
      thresholdGaps: record.threshold_gaps,
      limitations: record.limitations,
      sourceReferenceState: record.source_reference_state
    },
    currentClassification: record,
    reviewerNotes: "SYNTHETIC_DEMO_DATA reviewer note without raw source bytes. NOT_CUSTOMER_SOURCE.",
    remediationGuidancePlaceholder: "SYNTHETIC_DEMO_DATA remediation guidance placeholder remains separate. NOT_CUSTOMER_SOURCE.",
    validationPathText: record.validation_path_summary ?? "SYNTHETIC_DEMO_DATA validation path field visible. NOT_CUSTOMER_SOURCE.",
    snippets: [
      {
        id: "snippet-available",
        artifactRef: "artifact_ref:synthetic_snippet_001",
        startLine: 12,
        endLine: 18,
        redactionMarkers: [
          { line: 15, marker: "[REDACTED]", reason: "Synthetic redaction marker preserved" },
          { line: 99, marker: "[OUT_OF_RANGE]", reason: "Must be filtered" }
        ],
        availabilityState: "available_reference",
        contentPreview: "SYNTHETIC_DEMO_DATA line preview with [REDACTED] marker. NOT_CUSTOMER_SOURCE.",
        copyAllowed: true,
        downloadAllowed: false,
        permissionReason: "Copy allowed for approved synthetic snippet; download denied by evidence policy."
      },
      {
        id: "snippet-deleted",
        artifactRef: "artifact_ref:synthetic_deleted_001",
        startLine: 1,
        endLine: 1,
        redactionMarkers: [],
        availabilityState: "deleted",
        contentPreview: "must not render",
        copyAllowed: true,
        downloadAllowed: true,
        permissionReason: "Deleted-under-policy evidence is not available for copy or download."
      },
      {
        id: "snippet-not-collected",
        artifactRef: "artifact_ref:synthetic_not_collected_001",
        startLine: 1,
        endLine: 1,
        redactionMarkers: [],
        availabilityState: "not_collected",
        contentPreview: "must not render",
        copyAllowed: true,
        downloadAllowed: true,
        permissionReason: "Never-collected evidence is not available for copy or download."
      },
      {
        id: "snippet-not-submitted",
        artifactRef: "artifact_ref:synthetic_not_submitted_001",
        startLine: 1,
        endLine: 1,
        redactionMarkers: [],
        availabilityState: "not_submitted",
        contentPreview: "must not render",
        copyAllowed: true,
        downloadAllowed: true,
        permissionReason: "Not-submitted evidence is not available for copy or download."
      },
      {
        id: "snippet-unresolved",
        artifactRef: "artifact_ref:synthetic_unresolved_001",
        startLine: 1,
        endLine: 1,
        redactionMarkers: [],
        availabilityState: "unresolved_reference",
        contentPreview: "must not render",
        copyAllowed: true,
        downloadAllowed: true,
        permissionReason: "Unresolved evidence references are not available for copy or download."
      },
      {
        id: "snippet-inverted-lines",
        artifactRef: "artifact_ref:synthetic_inverted_001",
        startLine: 20,
        endLine: 12,
        redactionMarkers: [{ line: 20, marker: "[OUT_OF_RANGE]", reason: "Must be filtered" }],
        availabilityState: "available_reference",
        contentPreview: "SYNTHETIC_DEMO_DATA invalid line range fallback. NOT_CUSTOMER_SOURCE.",
        copyAllowed: true,
        downloadAllowed: true,
        permissionReason: "Invalid line range falls back to an explicit safe line reference."
      }
    ]
  };
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertNoUnsafeView(view) {
  const serialized = JSON.stringify(view).toLowerCase();
  for (const forbidden of ["dangerouslysetinnerhtml", "no vulnerabilities", "audit accepted", "soc 2 accepted", "certified", "regulator approved"]) {
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

function assertSetEquals(actual, expected, message) {
  assert(actual.size === expected.size && [...actual].every((value) => expected.has(value)), `${message}: expected ${[...expected].join(",")}, got ${[...actual].join(",")}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
