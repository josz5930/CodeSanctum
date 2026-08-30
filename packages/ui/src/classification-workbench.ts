import type { FindingClassificationRecord, FindingRemediationGuidance, FindingValidationPath, ReviewerValidationScript } from "../../protocol-ts/src/index.js";
import { customerVisibleTextForbidden, snapshotJsonData, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import { RemediationGuidanceSummary } from "./customer-finding-record.js";

// C6-06: evidence-basis values that, alone, cannot support a defensible
// "confirmed" classification without an explicit defensible-criteria
// narrative — mirrors control-plane's `rejectionForFindingClassificationRecord`.
const CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS = new Set<FindingClassificationRecord["evidence_basis"][number]>([
  "scanner_output",
  "metadata_only",
  "deleted_under_policy_reference",
  "not_submitted_by_policy_reference",
  "never_collected_reference",
  "unresolved_reference"
]);

function isMeaningfulClassificationText(value: unknown): value is string {
  return typeof value === "string" && /[a-z0-9]+/iu.test(value) && value.trim().split(/\s+/u).filter(Boolean).length >= 3 && value.trim().length >= 12;
}

function classificationTextForbidden(value: unknown): boolean {
  return typeof value === "string" && (sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined);
}

/**
 * C6-06: a customer-authored (or simply empty) object with no reviewer
 * identity, no evidence basis, no criteria, and no limitations must never
 * become a "Confirmed" verification-colored badge. Full JSON-schema
 * validation was deliberately *not* used as the entry gate here — this
 * package's own established, tested design intentionally lets a record with
 * an out-of-vocabulary `evidence_basis` entry still render (degrading that
 * one entry to an explicit "Unknown evidence basis" display, not rejecting
 * the whole badge), which a strict schema-enum gate would break. These
 * checks instead target exactly the structural/cross-field gaps the finding
 * names, ported (record-only subset, without control-plane's draft-binding
 * cross-checks — that binding is [C6-08]/[C6-09]'s job at the workbench
 * level) from `rejectionForFindingClassificationRecord`.
 */
function findingClassificationRecordSemanticIssues(record: FindingClassificationRecord): string[] {
  const issues: string[] = [];
  const actor = isPlainObject(record.actor) ? record.actor : undefined;
  if (actor === undefined || actor.actor_type !== "reviewer" || typeof actor.actor_id !== "string" || actor.actor_id.length === 0) {
    issues.push("finding_classification_reviewer_actor_required");
  }
  if (!Array.isArray(record.evidence_basis) || record.evidence_basis.length === 0) {
    issues.push("finding_classification_evidence_basis_required");
  }
  if (!Array.isArray(record.limitations) || record.limitations.length === 0) {
    issues.push("finding_classification_limitations_required");
  }
  const criteria = Array.isArray(record.confirmation_criteria) ? record.confirmation_criteria : [];
  if (record.classification === "confirmed" && criteria.every((criterion) => !isMeaningfulClassificationText(criterion))) {
    issues.push("finding_classification_confirmed_criteria_required");
  }
  const evidenceBasisValues = Array.isArray(record.evidence_basis) ? record.evidence_basis : [];
  const hasInsufficientBasis = evidenceBasisValues.some((basis) => CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS.has(basis));
  if (record.classification === "confirmed" && hasInsufficientBasis && !isMeaningfulClassificationText(record.defensible_confirmation_criteria)) {
    issues.push("finding_classification_confirmed_defensible_criteria_required");
  }
  if (
    record.classification === "requires_customer_side_validation" &&
    !isMeaningfulClassificationText(record.validation_path_summary) &&
    !(typeof record.validation_path_ref === "string" && record.validation_path_ref.length > 0)
  ) {
    issues.push("finding_classification_validation_path_required");
  }
  const textValues = [
    record.rationale,
    record.defensible_confirmation_criteria,
    record.validation_path_summary,
    record.validation_path_ref,
    ...criteria,
    ...(Array.isArray(record.threshold_gaps) ? record.threshold_gaps : []),
    ...(Array.isArray(record.limitations) ? record.limitations : [])
  ];
  if (textValues.some((value) => classificationTextForbidden(value))) {
    issues.push("finding_classification_text_forbidden");
  }
  return issues;
}

export type FindingClassificationValue = FindingClassificationRecord["classification"];
export type ClassificationBadgeClassification = FindingClassificationValue | "unknown";
export type WorkbenchLayoutMode = "desktop_two_column" | "stacked_narrow";
export type WorkbenchPanelId =
  | "finding_context"
  | "classification_decision"
  | "evidence_references"
  | "scanner_context"
  | "reviewer_notes"
  | "remediation_guidance"
  | "validation_path"
  | "limitations";

export type EvidenceBasisView = {
  value: FindingClassificationRecord["evidence_basis"][number] | "unknown";
  label: string;
  accessibleLabel: string;
  unknownValue?: string;
};

export type ClassificationBadgeView = {
  kind: "classification-badge";
  classification: ClassificationBadgeClassification;
  visibleLabel: string;
  accessibleLabel: string;
  meaning: string;
  evidenceBasis: EvidenceBasisView[];
  confirmationCriteria: string[];
  defensibleConfirmationCriteria?: string;
  thresholdGaps: string[];
  limitations: string[];
  validationPath?: string;
  tokenRole: CodeAttestColorRole;
  tokens: ReturnType<typeof colorTokensForRole>;
  doesNotRelyOnColor: true;
};

export type WorkbenchTextFieldView = {
  id: string;
  label: string;
  value: string;
  multiline: true;
  textEntryZone: true;
  shortcutsSuppressed: true;
  accessibleLabel: string;
};

export type WorkbenchPanelView = {
  id: WorkbenchPanelId;
  title: string;
  summary: string;
  currentStateVisible: true;
  items: IdentityRef[];
  fields: WorkbenchTextFieldView[];
  actions: AccessibleAction[];
};

export type WorkbenchLayoutView = {
  mode: WorkbenchLayoutMode;
  regions: Array<{
    region: "primary" | "secondary" | "stack";
    panelIds: WorkbenchPanelId[];
  }>;
  exposesCurrentState: true;
  actionSetKey: string;
};

export type KeyboardActionTarget =
  | "findings"
  | "classification_choices"
  | "evidence_references"
  | "remediation_guidance"
  | "validation_path";

export type KeyboardActionView = {
  id: string;
  label: string;
  shortcut: string;
  target: KeyboardActionTarget;
  accessibleLabel: string;
  suppressedInTextEntry: true;
};

export type ShortcutSuppressionZoneView = {
  id: string;
  label: string;
  zoneType: "reviewer_notes" | "snippet_text" | "remediation_guidance" | "validation_path" | "text_entry";
  shortcutsSuppressed: true;
};

export type SnippetLineReference = {
  startLine: number;
  endLine: number;
};

export type SnippetRedactionMarker = {
  line: number;
  marker: string;
  reason: string;
};

export type SnippetBlockView = {
  kind: "snippet-block";
  id: string;
  label: "Source-code disclosure";
  sourceCodeDisclosure: true;
  artifactRef: string;
  lineReference: SnippetLineReference;
  redactionMarkers: SnippetRedactionMarker[];
  availabilityState: "available_reference" | "deleted" | "not_collected" | "not_submitted" | "unresolved_reference";
  textEntryZone: true;
  shortcutsSuppressed: true;
  contentPreview?: string;
  actions: AccessibleAction[];
  permissionGate: {
    copyAllowed: boolean;
    downloadAllowed: boolean;
    reason: string;
  };
};

export type ReviewerWorkbenchDraftInput = {
  reviewFindingDraftId: string;
  title: string;
  affectedArea: string;
  scannerContext: IdentityRef[];
  evidenceReferences: Array<IdentityRef & { availabilityState?: SnippetBlockView["availabilityState"] }>;
  evidenceBasis: readonly FindingClassificationRecord["evidence_basis"][number][];
  thresholdGaps: string[];
  limitations: string[];
  sourceReferenceState: FindingClassificationRecord["source_reference_state"];
};

export type ReviewerWorkbenchSnippetInput = {
  id: string;
  artifactRef: string;
  startLine: number;
  endLine: number;
  redactionMarkers?: SnippetRedactionMarker[];
  availabilityState?: SnippetBlockView["availabilityState"];
  contentPreview?: string;
  copyAllowed: boolean;
  downloadAllowed: boolean;
  permissionReason: string;
};

export type ReviewerClassificationWorkbenchProps = {
  draft: ReviewerWorkbenchDraftInput;
  currentClassification?: FindingClassificationRecord;
  reviewerNotes?: string;
  remediationGuidancePlaceholder?: string;
  structuredRemediationGuidance?: FindingRemediationGuidance;
  structuredValidationPaths?: FindingValidationPath[];
  reviewerValidationScripts?: ReviewerValidationScript[];
  validationPathText?: string;
  snippets?: ReviewerWorkbenchSnippetInput[];
};

export type ReviewerClassificationWorkbenchView = {
  kind: "classification-workbench";
  /** C6-07: false for a null/missing/synthetic-unavailable draft — every action in `panels`/`actionSet` is forced non-actionable when this is false. */
  available: boolean;
  draftRef: string;
  title: string;
  affectedArea: string;
  currentState: {
    badge: ClassificationBadgeView | null;
    evidenceBasis: EvidenceBasisView[];
    thresholdGaps: string[];
    limitations: string[];
    sourceReferenceState: FindingClassificationRecord["source_reference_state"];
  };
  panels: WorkbenchPanelView[];
  layouts: WorkbenchLayoutView[];
  keyboardActions: KeyboardActionView[];
  shortcutSuppressionZones: ShortcutSuppressionZoneView[];
  snippets: SnippetBlockView[];
  actionSet: AccessibleAction[];
  minTargetSizePx: number;
  doesNotRelyOnColor: true;
};

const CLASSIFICATION_DEFINITIONS: Record<ClassificationBadgeClassification, {
  visibleLabel: string;
  meaning: string;
  tokenRole: CodeAttestColorRole;
}> = {
  likely: {
    visibleLabel: "Likely",
    meaning: "Reviewer judgment indicates the finding is likely based on bounded evidence, with limitations still visible.",
    tokenRole: "review"
  },
  confirmed: {
    visibleLabel: "Confirmed",
    meaning: "Reviewer recorded confirmation criteria for the approved evidence. This is not audit acceptance or absence-of-vulnerabilities proof.",
    tokenRole: "verification"
  },
  inconclusive: {
    visibleLabel: "Inconclusive",
    meaning: "Reviewer cannot make a stronger judgment from the available evidence and recorded threshold gaps.",
    tokenRole: "neutral"
  },
  requires_customer_side_validation: {
    visibleLabel: "Requires customer-side validation",
    meaning: "Reviewer needs a customer-side validation path before this finding can be confirmed or closed.",
    tokenRole: "warning"
  },
  unknown: {
    visibleLabel: "Unknown classification",
    meaning: "The classification value is not in the allowed reviewer taxonomy and must be resolved before it is represented as expert judgment.",
    tokenRole: "warning"
  }
};

const EVIDENCE_BASIS_LABELS: Record<FindingClassificationRecord["evidence_basis"][number], string> = {
  scanner_output: "Scanner output",
  metadata_only: "Metadata only",
  finding_context_snippet: "Finding-context snippet",
  extended_approved_source_context: "Extended approved source context",
  retained_review_artifact: "Retained review artifact",
  deleted_under_policy_reference: "Deleted-under-policy reference",
  not_submitted_by_policy_reference: "Not submitted by policy",
  never_collected_reference: "Never collected reference",
  unresolved_reference: "Unresolved reference"
};

const CLASSIFICATION_CHOICES: FindingClassificationValue[] = [
  "likely",
  "confirmed",
  "inconclusive",
  "requires_customer_side_validation"
];

// C6-29: `validation_path_summary`/`validation_path_ref` are deliberately
// excluded here even though `textFields` produces them alongside the other
// remediation-guidance fields — they belong to exactly one panel, and the
// `validation_path` panel below already claims every `validation_path_*`
// field via its `startsWith` filter. Including them in both sets gave the
// same field id (and DOM/form/focus/serialization identity) to two panels.
const REMEDIATION_GUIDANCE_FIELD_IDS = new Set([
  "exploitability_rationale",
  "suggested_remediation",
  "validation_steps",
  "insufficient_evidence_reason",
  "next_step_summary",
  "guidance_limitations"
]);

export function ClassificationBadge(record: FindingClassificationRecord | unknown): ClassificationBadgeView {
  const snapshot = snapshotJsonData(record);
  if (!snapshot.ok || !isPlainObject(snapshot.value)) {
    return unavailableClassificationBadge();
  }
  const classificationRecord = snapshot.value as FindingClassificationRecord;
  if (findingClassificationRecordSemanticIssues(classificationRecord).length > 0) {
    return unavailableClassificationBadge();
  }
  const classification = isClassificationValue(classificationRecord.classification) ? classificationRecord.classification : "unknown";
  const definition = CLASSIFICATION_DEFINITIONS[classification];
  const evidenceBasis = evidenceBasisViews(classificationRecord.evidence_basis);
  const validationPath = firstVisibleText(classificationRecord.validation_path_summary, classificationRecord.validation_path_ref);
  const defensibleConfirmationCriteria = firstVisibleText(classificationRecord.defensible_confirmation_criteria);

  return {
    kind: "classification-badge",
    classification,
    visibleLabel: definition.visibleLabel,
    accessibleLabel: `${definition.visibleLabel}: ${definition.meaning}`,
    meaning: definition.meaning,
    evidenceBasis,
    confirmationCriteria: visibleList(classificationRecord.confirmation_criteria),
    ...(defensibleConfirmationCriteria === undefined ? {} : { defensibleConfirmationCriteria }),
    thresholdGaps: visibleList(classificationRecord.threshold_gaps),
    limitations: visibleList(classificationRecord.limitations),
    ...(classification === "requires_customer_side_validation" && validationPath !== undefined ? { validationPath } : {}),
    tokenRole: definition.tokenRole,
    tokens: colorTokensForRole(definition.tokenRole),
    doesNotRelyOnColor: true
  };
}

export function ReviewerClassificationWorkbench(props: ReviewerClassificationWorkbenchProps | unknown): ReviewerClassificationWorkbenchView {
  if (!isPlainObject(props) || !isPlainObject(props.draft)) {
    return unavailableWorkbenchView();
  }
  return buildReviewerClassificationWorkbench(props as ReviewerClassificationWorkbenchProps);
}

/**
 * C6-08: a classification record for a different draft must never be
 * treated as this draft's current state — its badge/basis/criteria and
 * "defensible" confirmation text would otherwise render under this draft's
 * title and enable choices (e.g. Confirmed) it never earned. Every reader of
 * `props.currentClassification` in this module must go through this one
 * binding check rather than re-deriving its own unbound cast.
 */
function boundCurrentClassification(props: ReviewerClassificationWorkbenchProps): FindingClassificationRecord | undefined {
  const candidate = isPlainObject(props.currentClassification) ? props.currentClassification as FindingClassificationRecord : undefined;
  return candidate !== undefined && candidate.review_finding_draft_ref === props.draft.reviewFindingDraftId ? candidate : undefined;
}

function buildReviewerClassificationWorkbench(props: ReviewerClassificationWorkbenchProps): ReviewerClassificationWorkbenchView {
  const draft = props.draft;
  const currentClassification = boundCurrentClassification(props);
  const badge = currentClassification === undefined ? null : ClassificationBadge(currentClassification);
  const evidenceBasis = badge?.evidenceBasis ?? evidenceBasisViews(draft.evidenceBasis);
  const thresholdGaps = badge?.thresholdGaps ?? visibleList(draft.thresholdGaps);
  const limitations = badge?.limitations ?? visibleList(draft.limitations);
  const evidenceAvailability = canonicalEvidenceAvailability(draft.evidenceReferences);
  const snippets = listValues(props.snippets).filter(isPlainObject).map((snippet) => snippetBlockView(snippet as ReviewerWorkbenchSnippetInput, evidenceAvailability));
  const actionSet = workbenchActionSet();
  const fields = textFields(props, currentClassification);
  const panels = panelViews(props, badge, fields, snippets, evidenceBasis, thresholdGaps, limitations);

  // C6-07: a null/missing draft is converted to the synthetic
  // `review_finding_draft:unavailable` identity elsewhere in this module
  // (`unavailableWorkbenchView`); that synthetic view must expose no
  // mutating action, not the same choices/save action a genuine draft gets.
  const available = hasVisibleText(draft.reviewFindingDraftId) && draft.reviewFindingDraftId !== "review_finding_draft:unavailable";
  const gatedPanels = available ? panels : panels.map((panel) => ({ ...panel, actions: panel.actions.map((action) => ({ ...action, actionable: false })) }));
  const gatedActionSet = available ? actionSet : actionSet.map((action) => ({ ...action, actionable: false }));

  return {
    kind: "classification-workbench",
    available,
    draftRef: sanitizeVisibleText(draft.reviewFindingDraftId),
    title: visibleOrDefault(draft.title, "Review Finding draft"),
    affectedArea: visibleOrDefault(draft.affectedArea, "Affected area unavailable"),
    currentState: {
      badge,
      evidenceBasis,
      thresholdGaps,
      limitations,
      sourceReferenceState: isSourceReferenceState(draft.sourceReferenceState) ? draft.sourceReferenceState : "unresolved_reference"
    },
    panels: gatedPanels,
    layouts: layoutViews(),
    keyboardActions: keyboardActions(),
    shortcutSuppressionZones: suppressionZones(fields, snippets),
    snippets,
    actionSet: gatedActionSet,
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    doesNotRelyOnColor: true
  };
}

function panelViews(
  props: ReviewerClassificationWorkbenchProps,
  badge: ClassificationBadgeView | null,
  fields: WorkbenchTextFieldView[],
  snippets: SnippetBlockView[],
  evidenceBasis: EvidenceBasisView[],
  thresholdGaps: string[],
  limitations: string[]
): WorkbenchPanelView[] {
  const draft = props.draft;
  return [
    {
      id: "finding_context",
      title: "Finding context",
      summary: visibleOrDefault(draft.affectedArea, "Affected area unavailable"),
      currentStateVisible: true,
      items: [{ label: "Review Finding draft", value: sanitizeVisibleText(draft.reviewFindingDraftId) }],
      fields: [],
      actions: [actionView("move_next_finding", "Next finding", true), actionView("move_previous_finding", "Previous finding", true)]
    },
    {
      id: "classification_decision",
      title: "Classification criteria",
      summary: badge?.meaning ?? "Choose likely, confirmed, inconclusive, or requires customer-side validation.",
      currentStateVisible: true,
      items: [
        ...(badge === null ? [] : [{ label: "Current classification", value: badge.visibleLabel }]),
        ...(badge?.confirmationCriteria ?? []).map((criterion) => ({ label: "Confirmation criterion", value: criterion })),
        ...(badge?.defensibleConfirmationCriteria === undefined ? [] : [{ label: "Defensible confirmation criteria", value: badge.defensibleConfirmationCriteria }]),
        ...CLASSIFICATION_CHOICES.map((choice) => ({ label: "Allowed classification", value: CLASSIFICATION_DEFINITIONS[choice].visibleLabel }))
      ],
      fields: [],
      actions: CLASSIFICATION_CHOICES.map((choice) => classificationChoiceAction(choice, props))
    },
    {
      id: "evidence_references",
      title: "Evidence references",
      summary: `${evidenceBasis.map((basis) => basis.label).join(", ") || "Evidence basis unavailable"}`,
      currentStateVisible: true,
      items: evidenceReferenceItems(props.draft.evidenceReferences),
      fields: [],
      actions: [actionView("focus_evidence", "Review evidence references", true)]
    },
    {
      id: "scanner_context",
      title: "Scanner context",
      summary: "Scanner output remains provenance and does not become expert classification by itself.",
      currentStateVisible: true,
      items: listValues(props.draft.scannerContext).filter(isPlainObject).map((reference) => identityView(reference as IdentityRef, "Scanner context")),
      fields: [],
      actions: []
    },
    {
      id: "reviewer_notes",
      title: "Reviewer notes",
      summary: "Reviewer notes are text-entry zones; shortcuts are suppressed while editing.",
      currentStateVisible: true,
      items: [],
      fields: fields.filter((field) => field.id === "reviewer_notes"),
      actions: []
    },
    {
      id: "remediation_guidance",
      title: "Remediation guidance",
      summary: remediationGuidancePanelSummary(props),
      currentStateVisible: true,
      items: remediationGuidanceItems(props),
      fields: fields.filter((field) => field.id === "remediation_guidance" || REMEDIATION_GUIDANCE_FIELD_IDS.has(field.id)),
      actions: [actionView("focus_remediation_guidance", "Move to remediation guidance", true)]
    },
    {
      id: "validation_path",
      title: "Validation path",
      summary: validationPathPanelSummary(props, badge),
      currentStateVisible: true,
      items: validationPathItems(props),
      fields: fields.filter((field) => field.id === "validation_path" || field.id.startsWith("validation_path_") || field.id.startsWith("validation_script_")),
      actions: [actionView("focus_validation_path", "Move to validation path", true)]
    },
    {
      id: "limitations",
      title: "Limitations and threshold gaps",
      summary: "Evidence limitations and threshold gaps remain visible next to the classification.",
      currentStateVisible: true,
      items: [
        ...thresholdGaps.map((gap) => ({ label: "Threshold gap", value: gap })),
        ...limitations.map((limitation) => ({ label: "Limitation", value: limitation })),
        ...snippets.map((snippet) => ({ label: snippet.label, value: `${snippet.artifactRef}:${snippet.lineReference.startLine}-${snippet.lineReference.endLine}` }))
      ],
      fields: [],
      actions: []
    }
  ];
}

/**
 * C6-09: guidance/paths/scripts are protocol records that each carry their
 * own `review_finding_draft_ref` (and, for scripts, `validation_path_ref`)
 * — reject a candidate whose refs don't bind to the current draft/path so
 * guidance or a validation path from another finding, or a script pointing
 * at a different path, cannot render as authoritative instructions under
 * the active finding.
 */
function boundToDraft<T extends { review_finding_draft_ref: string }>(records: readonly unknown[] | undefined, draftRef: string): T[] {
  return listValues(records).filter(isPlainObject).filter((record) => record.review_finding_draft_ref === draftRef) as T[];
}

function textFields(props: ReviewerClassificationWorkbenchProps, currentClassification: FindingClassificationRecord | undefined): WorkbenchTextFieldView[] {
  const draftRef = props.draft.reviewFindingDraftId;
  const candidateGuidance = isPlainObject(props.structuredRemediationGuidance) ? props.structuredRemediationGuidance as FindingRemediationGuidance : undefined;
  const guidance = candidateGuidance !== undefined && candidateGuidance.review_finding_draft_ref === draftRef ? candidateGuidance : undefined;
  const fields = [
    textField("reviewer_notes", "Reviewer notes", props.reviewerNotes ?? "")
  ];
  if (guidance === undefined) {
    fields.push(textField("remediation_guidance", "Remediation guidance", props.remediationGuidancePlaceholder ?? "Remediation guidance will be captured separately from the classification."));
  } else {
    fields.push(textField("exploitability_rationale", "Exploitability rationale", guidance.exploitability_rationale ?? ""));
    fields.push(textField("suggested_remediation", "Suggested remediation", guidance.suggested_remediation ?? ""));
    fields.push(textField("validation_steps", "Validation steps", guidance.validation_steps ?? ""));
    fields.push(textField("validation_path_summary", "Validation path summary", guidance.validation_path_summary ?? ""));
    fields.push(textField("insufficient_evidence_reason", "Insufficient evidence reason", guidance.insufficient_evidence_reason ?? ""));
    fields.push(textField("next_step_summary", "Next step", guidance.next_step_summary ?? ""));
    fields.push(textField("validation_path_ref", "Validation path reference", guidance.validation_path_ref ?? ""));
    fields.push(textField("guidance_limitations", "Guidance limitations", visibleList(guidance.limitations).join("\n")));
  }
  fields.push(textField("validation_path", "Validation path", props.validationPathText ?? currentClassification?.validation_path_summary ?? ""));
  const validationPath = boundToDraft<FindingValidationPath>(props.structuredValidationPaths, draftRef)[0];
  if (validationPath !== undefined) {
    fields.push(textField("validation_path_required_evidence", "Validation path required evidence", validationPath.required_evidence));
    fields.push(textField("validation_path_steps", "Validation path steps", validationPath.steps));
    fields.push(textField("validation_path_expected_result", "Validation path expected result", validationPath.expected_result));
    fields.push(textField("validation_path_target", "Remote testing target", validationPath.target ?? ""));
    fields.push(textField("validation_path_authorization_assumption", "Remote testing authorization assumption", validationPath.authorization_assumption ?? ""));
    fields.push(textField("validation_path_method", "Remote testing method", validationPath.method ?? ""));
    fields.push(textField("validation_path_safety_constraints", "Remote testing safety constraints", validationPath.safety_constraints ?? ""));
    fields.push(textField("validation_path_output_attachment_instructions", "Validation output attachment instructions", validationPath.output_attachment_instructions ?? ""));
  }
  const validationScript = validationPath === undefined ? undefined : listValues(props.reviewerValidationScripts)
    .filter(isPlainObject)
    .find((candidate) => (candidate as ReviewerValidationScript).validation_path_ref === validationPath.validation_path_id) as ReviewerValidationScript | undefined;
  if (validationScript !== undefined) {
    fields.push(textField("validation_script_purpose", "Reviewer-authored script purpose", validationScript.purpose));
    fields.push(textField("validation_script_prerequisites", "Reviewer-authored script prerequisites", validationScript.prerequisites));
    fields.push(textField("validation_script_execution_steps", "Reviewer-authored script execution steps", validationScript.execution_steps));
    fields.push(textField("validation_script_expected_output", "Reviewer-authored script expected output", validationScript.expected_output));
    fields.push(textField("validation_script_safety_notes", "Reviewer-authored script safety notes", validationScript.safety_notes));
    fields.push(textField("validation_script_output_attachment_instructions", "Reviewer-authored script output attachment instructions", validationScript.output_attachment_instructions));
    fields.push(textField("validation_script_content", "Reviewer-authored script content", validationScript.script_content));
  }
  return fields;
}

// C6-09: guidance/paths must bind to this draft before they can appear in
// any panel summary/items — not just the detail fields (see `textFields`).
function boundGuidance(props: ReviewerClassificationWorkbenchProps): FindingRemediationGuidance | undefined {
  const candidate = isPlainObject(props.structuredRemediationGuidance) ? props.structuredRemediationGuidance as FindingRemediationGuidance : undefined;
  return candidate !== undefined && candidate.review_finding_draft_ref === props.draft.reviewFindingDraftId ? candidate : undefined;
}

function remediationGuidancePanelSummary(props: ReviewerClassificationWorkbenchProps): string {
  const guidance = boundGuidance(props);
  if (guidance === undefined) {
    return "Guidance remains separate from classification and is elaborated by remediation workflow.";
  }
  return RemediationGuidanceSummary(guidance).status.visibleLabel;
}

function remediationGuidanceItems(props: ReviewerClassificationWorkbenchProps): IdentityRef[] {
  const guidance = boundGuidance(props);
  if (guidance === undefined) {
    return [];
  }
  const summary = RemediationGuidanceSummary(guidance);
  return [
    { label: "Guidance status", value: summary.status.visibleLabel },
    ...(summary.guidanceRef === undefined ? [] : [{ label: "Guidance record", value: summary.guidanceRef }]),
    ...summary.evidenceRefs.map((ref) => ({ label: "Evidence reference", value: ref }))
  ];
}

function validationPathPanelSummary(props: ReviewerClassificationWorkbenchProps, badge: ClassificationBadgeView | null): string {
  const pathRecord = boundToDraft<FindingValidationPath>(props.structuredValidationPaths, props.draft.reviewFindingDraftId)[0];
  if (pathRecord !== undefined) {
    return `${pathTypeLabel(pathRecord.path_type)} validation path keeps required evidence, steps, and limitations visible.`;
  }
  return badge?.validationPath ?? "Validation path stays visible when customer-side validation is required.";
}

function validationPathItems(props: ReviewerClassificationWorkbenchProps): IdentityRef[] {
  const paths = boundToDraft<FindingValidationPath>(props.structuredValidationPaths, props.draft.reviewFindingDraftId);
  const pathIds = new Set(paths.map((pathRecord) => pathRecord.validation_path_id));
  // C6-09: a script pointing at a path this draft doesn't have must not
  // render as though it belongs here.
  const scripts = (listValues(props.reviewerValidationScripts).filter(isPlainObject) as ReviewerValidationScript[])
    .filter((script) => pathIds.has(script.validation_path_ref));
  const items: IdentityRef[] = [];
  for (const pathRecord of paths) {
    items.push({ label: "Validation path", value: sanitizeVisibleText(pathRecord.validation_path_id) });
    items.push({ label: "Path type", value: pathTypeLabel(pathRecord.path_type) });
    for (const ref of listValues(pathRecord.reviewer_validation_script_refs)) {
      items.push({ label: "Reviewer-authored script", value: sanitizeVisibleText(ref) });
    }
  }
  for (const script of scripts) {
    items.push({ label: script.script_package_status === "included_base_package" ? "Included reviewer-authored script" : "Additional reviewer-authored script candidate", value: sanitizeVisibleText(script.validation_script_id) });
    if (script.included_script_slot !== undefined) {
      items.push({ label: "Included script slot", value: sanitizeVisibleText(script.included_script_slot) });
    }
    if (script.script_package_status === "additional_script_candidate_pricing_tbd") {
      items.push({ label: "Additional script pricing", value: "pricing TBD" });
    }
  }
  return items;
}

function pathTypeLabel(value: unknown): string {
  if (value === "remote_dynamic_testing") {
    return "Remote dynamic testing";
  }
  if (value === "customer_run_script") {
    return "Customer-run script";
  }
  if (value === "manual_steps") {
    return "Manual steps";
  }
  return "Unknown validation path";
}

function layoutViews(): WorkbenchLayoutView[] {
  const actionSetKey = "classification-workbench-actions:v1";
  return [
    {
      mode: "desktop_two_column",
      regions: [
        { region: "primary", panelIds: ["finding_context", "evidence_references", "scanner_context", "limitations"] },
        { region: "secondary", panelIds: ["classification_decision", "reviewer_notes", "remediation_guidance", "validation_path"] }
      ],
      exposesCurrentState: true,
      actionSetKey
    },
    {
      mode: "stacked_narrow",
      regions: [
        {
          region: "stack",
          panelIds: [
            "finding_context",
            "classification_decision",
            "evidence_references",
            "scanner_context",
            "reviewer_notes",
            "remediation_guidance",
            "validation_path",
            "limitations"
          ]
        }
      ],
      exposesCurrentState: true,
      actionSetKey
    }
  ];
}

function keyboardActions(): KeyboardActionView[] {
  return [
    keyboardAction("next_finding", "Next finding", "J", "findings"),
    keyboardAction("previous_finding", "Previous finding", "K", "findings"),
    keyboardAction("classification_choices", "Move to classification choices", "C", "classification_choices"),
    keyboardAction("evidence_references", "Move to evidence references", "E", "evidence_references"),
    keyboardAction("remediation_guidance", "Move to remediation guidance", "R", "remediation_guidance"),
    keyboardAction("validation_path", "Move to validation path", "V", "validation_path")
  ];
}

function suppressionZones(fields: WorkbenchTextFieldView[], snippets: SnippetBlockView[]): ShortcutSuppressionZoneView[] {
  const zones: ShortcutSuppressionZoneView[] = fields.map((field) => ({
    id: field.id,
    label: field.label,
    zoneType: field.id === "reviewer_notes" || field.id === "remediation_guidance" || field.id === "validation_path"
      ? field.id
      : field.id.startsWith("validation_path_") || field.id.startsWith("validation_script_")
        ? "validation_path"
        : field.id === "suggested_remediation" || field.id === "validation_steps" || field.id === "guidance_limitations"
          ? "remediation_guidance"
          : "text_entry",
    shortcutsSuppressed: true
  }));
  zones.push(...snippets.map((snippet): ShortcutSuppressionZoneView => ({
    id: snippet.id,
    label: snippet.label,
    zoneType: "snippet_text",
    shortcutsSuppressed: true
  })));
  return zones;
}

/**
 * C6-10: `canonicalAvailability` is keyed from `draft.evidenceReferences`
 * (the actual evidence-reference map), not the snippet's own self-asserted
 * `availabilityState`/`copyAllowed`/`downloadAllowed`. A snippet whose ref is
 * missing from that map, ambiguous (duplicate entries), or claims an
 * availability the canonical map disagrees with is downgraded to
 * `unresolved_reference` regardless of what it asserts about itself — a
 * caller cannot self-certify disclosure permission for evidence it doesn't
 * canonically control. An invalid/inverted line range also disables preview
 * and copy/download rather than silently citing a fabricated `1-1` range.
 */
function snippetBlockView(snippet: ReviewerWorkbenchSnippetInput, canonicalAvailability: ReadonlyMap<string, SnippetBlockView["availabilityState"]>): SnippetBlockView {
  const selfAssertedAvailability = isAvailabilityState(snippet.availabilityState) ? snippet.availabilityState : "unresolved_reference";
  // Only a claim of `available_reference` grants any disclosure right, so
  // only that claim needs canonical corroboration — a negative claim
  // (deleted/not_collected/not_submitted/unresolved) can't be abused for
  // disclosure and legitimately has no canonical evidence-reference entry
  // to check against (nothing was ever collected/submitted to reference).
  const canonical = canonicalAvailability.get(snippet.artifactRef);
  const availabilityState = selfAssertedAvailability !== "available_reference"
    ? selfAssertedAvailability
    : canonical === "available_reference" ? canonical : "unresolved_reference";
  const lineReferenceWasValid = safeLine(snippet.startLine) !== undefined && safeLine(snippet.endLine) !== undefined && safeLine(snippet.endLine)! >= safeLine(snippet.startLine)!;
  const disclosureAllowed = availabilityState === "available_reference" && lineReferenceWasValid;
  const copyAllowed = disclosureAllowed && snippet.copyAllowed === true;
  const downloadAllowed = disclosureAllowed && snippet.downloadAllowed === true;
  const permissionReason = visibleOrDefault(snippet.permissionReason, "Evidence-handling policy controls this action.");
  const lineReference = safeLineReference(snippet.startLine, snippet.endLine);
  return {
    kind: "snippet-block",
    id: sanitizeVisibleText(snippet.id),
    label: "Source-code disclosure",
    sourceCodeDisclosure: true,
    artifactRef: sanitizeVisibleText(snippet.artifactRef),
    lineReference,
    redactionMarkers: listValues(snippet.redactionMarkers)
      .filter(isPlainObject)
      .map((marker) => safeRedactionMarker(marker as SnippetRedactionMarker, lineReference))
      .filter((marker): marker is SnippetRedactionMarker => marker !== undefined),
    availabilityState,
    textEntryZone: true,
    shortcutsSuppressed: true,
    ...(disclosureAllowed && hasVisibleText(snippet.contentPreview)
      ? { contentPreview: sanitizeVisibleText(snippet.contentPreview) }
      : {}),
    actions: [
      actionView("copy_snippet", "Copy snippet with line and redaction markers", copyAllowed),
      actionView("download_snippet", "Download snippet with line and redaction markers", downloadAllowed)
    ],
    permissionGate: {
      copyAllowed,
      downloadAllowed,
      reason: permissionReason
    }
  };
}

function canonicalEvidenceAvailability(evidenceReferences: ReviewerWorkbenchDraftInput["evidenceReferences"]): Map<string, SnippetBlockView["availabilityState"]> {
  const counts = new Map<string, number>();
  for (const reference of listValues(evidenceReferences).filter(isPlainObject)) {
    const ref = reference as IdentityRef & { availabilityState?: SnippetBlockView["availabilityState"] };
    if (typeof ref.value === "string") {
      counts.set(ref.value, (counts.get(ref.value) ?? 0) + 1);
    }
  }
  const resolved = new Map<string, SnippetBlockView["availabilityState"]>();
  for (const reference of listValues(evidenceReferences).filter(isPlainObject)) {
    const ref = reference as IdentityRef & { availabilityState?: SnippetBlockView["availabilityState"] };
    // A duplicate ref is ambiguous — never resolve it to any availability.
    if (typeof ref.value === "string" && counts.get(ref.value) === 1 && isAvailabilityState(ref.availabilityState)) {
      resolved.set(ref.value, ref.availabilityState);
    }
  }
  return resolved;
}

function workbenchActionSet(): AccessibleAction[] {
  return [
    actionView("save_classification", "Save classification event", true),
    actionView("view_history", "View classification history", true),
    actionView("copy_reference", "Copy finding reference", true)
  ];
}

function keyboardAction(id: string, label: string, shortcut: string, target: KeyboardActionTarget): KeyboardActionView {
  return {
    id,
    label,
    shortcut,
    target,
    accessibleLabel: `${label} shortcut ${shortcut}; disabled inside reviewer notes, remediation guidance, validation path, and source-code disclosure snippet zones`,
    suppressedInTextEntry: true
  };
}

function textField(id: string, label: string, value: string): WorkbenchTextFieldView {
  const visibleLabel = sanitizeVisibleText(label);
  return {
    id: sanitizeVisibleText(id),
    label: visibleLabel,
    value: sanitizeVisibleText(value),
    multiline: true,
    textEntryZone: true,
    shortcutsSuppressed: true,
    accessibleLabel: `${visibleLabel}; keyboard shortcuts are suppressed while editing`
  };
}

function actionView(type: string, label: string, actionable: boolean): AccessibleAction {
  const visibleLabel = sanitizeVisibleText(label);
  return {
    type: sanitizeVisibleText(type),
    label: visibleLabel,
    accessibleLabel: visibleLabel,
    hoverOnly: false,
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    actionable
  };
}

function classificationChoiceAction(choice: FindingClassificationValue, props: ReviewerClassificationWorkbenchProps): AccessibleAction {
  const safe = choice !== "confirmed" || confirmedChoiceHasGuardrailContext(props);
  return actionView(`choose_${choice}`, `Choose ${CLASSIFICATION_DEFINITIONS[choice].visibleLabel}`, safe);
}

function confirmedChoiceHasGuardrailContext(props: ReviewerClassificationWorkbenchProps): boolean {
  const basis = listValues(props.draft.evidenceBasis);
  // C6-07: `[].some(...)` is vacuously `false`, so an empty/unknown evidence
  // basis previously looked like "not insufficient" and left Confirmed
  // enabled. Zero known evidence basis values must never be sufficient.
  if (basis.length === 0 || !basis.every((value) => isEvidenceBasisValue(value))) {
    const current = boundCurrentClassification(props);
    return current?.classification === "confirmed" && hasVisibleText(current.defensible_confirmation_criteria);
  }
  const hasInsufficientBasis = basis.some((value) =>
    value === "scanner_output" ||
    value === "metadata_only" ||
    value === "deleted_under_policy_reference" ||
    value === "not_submitted_by_policy_reference" ||
    value === "never_collected_reference" ||
    value === "unresolved_reference"
  );
  if (!hasInsufficientBasis) {
    return true;
  }
  const current = boundCurrentClassification(props);
  return current?.classification === "confirmed" && hasVisibleText(current.defensible_confirmation_criteria);
}

function evidenceBasisViews(values: readonly FindingClassificationRecord["evidence_basis"][number][]): EvidenceBasisView[] {
  return listValues(values).map((value) => {
    if (isEvidenceBasisValue(value)) {
      const label = EVIDENCE_BASIS_LABELS[value];
      return {
        value,
        label,
        accessibleLabel: `Evidence basis: ${label}`
      };
    }
    const unknownValue = sanitizeVisibleText(value);
    return {
      value: "unknown",
      label: "Unknown evidence basis",
      accessibleLabel: `Unknown evidence basis: ${unknownValue || "unavailable"}`,
      ...(unknownValue.length > 0 ? { unknownValue } : {})
    };
  });
}

function visibleList(values: readonly string[] | undefined): string[] {
  return listValues(values)
    .map((value) => sanitizeVisibleText(value))
    .filter((value) => value.trim().length > 0);
}

function evidenceReferenceItems(value: ReviewerWorkbenchDraftInput["evidenceReferences"]): IdentityRef[] {
  return listValues(value)
    .filter(isPlainObject)
    .map((reference) => {
      const identity = identityView(reference as IdentityRef, "Evidence reference");
      const availabilityState = isAvailabilityState(reference.availabilityState) ? reference.availabilityState : "unresolved_reference";
      const disclosure = availabilityState === "available_reference" ? "available for review" : "not available for review";
      return {
        label: `${identity.label} (${availabilityState})`,
        value: `${identity.value} — ${disclosure}`
      };
    });
}

function identityView(identity: IdentityRef, fallbackLabel: string): IdentityRef {
  return {
    label: visibleOrDefault(identity.label, fallbackLabel),
    value: visibleOrDefault(identity.value, "unavailable")
  };
}

function listValues<T>(value: readonly T[] | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClassificationValue(value: unknown): value is FindingClassificationValue {
  return value === "likely" || value === "confirmed" || value === "inconclusive" || value === "requires_customer_side_validation";
}

function isEvidenceBasisValue(value: unknown): value is FindingClassificationRecord["evidence_basis"][number] {
  return typeof value === "string" && Object.hasOwn(EVIDENCE_BASIS_LABELS, value);
}

function isSourceReferenceState(value: unknown): value is FindingClassificationRecord["source_reference_state"] {
  return value === "retained_review_artifact" ||
    value === "deleted_under_policy" ||
    value === "never_collected" ||
    value === "not_submitted_by_policy" ||
    value === "unresolved_reference";
}

function isAvailabilityState(value: unknown): value is SnippetBlockView["availabilityState"] {
  return value === "available_reference" ||
    value === "deleted" ||
    value === "not_collected" ||
    value === "not_submitted" ||
    value === "unresolved_reference";
}

function unavailableClassificationBadge(): ClassificationBadgeView {
  const definition = CLASSIFICATION_DEFINITIONS.unknown;
  return {
    kind: "classification-badge",
    classification: "unknown",
    visibleLabel: definition.visibleLabel,
    accessibleLabel: `${definition.visibleLabel}: ${definition.meaning}`,
    meaning: definition.meaning,
    evidenceBasis: [],
    confirmationCriteria: [],
    thresholdGaps: [],
    limitations: [],
    tokenRole: definition.tokenRole,
    tokens: colorTokensForRole(definition.tokenRole),
    doesNotRelyOnColor: true
  };
}

function unavailableWorkbenchView(): ReviewerClassificationWorkbenchView {
  return buildReviewerClassificationWorkbench({
    draft: {
      reviewFindingDraftId: "review_finding_draft:unavailable",
      title: "Review Finding unavailable",
      affectedArea: "Affected area unavailable",
      scannerContext: [],
      evidenceReferences: [],
      evidenceBasis: [],
      thresholdGaps: [],
      limitations: [],
      sourceReferenceState: "unresolved_reference"
    },
    reviewerNotes: "",
    remediationGuidancePlaceholder: "Remediation guidance unavailable.",
    validationPathText: "",
    snippets: []
  });
}

function firstVisibleText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (hasVisibleText(value)) {
      return sanitizeVisibleText(value);
    }
  }
  return undefined;
}

function safeLineReference(startLine: unknown, endLine: unknown): SnippetLineReference {
  const start = safeLine(startLine);
  const end = safeLine(endLine);
  if (start === undefined || end === undefined || end < start) {
    return { startLine: 1, endLine: 1 };
  }
  return { startLine: start, endLine: end };
}

function safeLine(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function safeRedactionMarker(marker: SnippetRedactionMarker, lineReference: SnippetLineReference): SnippetRedactionMarker | undefined {
  const line = safeLine(marker.line);
  if (line === undefined || line < lineReference.startLine || line > lineReference.endLine) {
    return undefined;
  }
  return {
    line,
    marker: visibleOrDefault(marker.marker, "redacted"),
    reason: visibleOrDefault(marker.reason, "Redaction marker preserved")
  };
}

function hasVisibleText(value: unknown): boolean {
  return sanitizeVisibleText(value).trim().length > 0;
}

function visibleOrDefault(value: unknown, fallback: string): string {
  return hasVisibleText(value) ? sanitizeVisibleText(value) : fallback;
}

const invisibleControlPattern = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\u2066-\u2069\u2800\u3164\uFE00-\uFE0F\uFEFF\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

function sanitizeVisibleText(value: unknown): string {
  let raw: string;
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    raw = String(value);
  } else {
    return "";
  }
  return raw.replace(invisibleControlPattern, "");
}
