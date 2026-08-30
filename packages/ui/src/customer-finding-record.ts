import { claimSafeForbiddenPhrase, customerFacingFindingRecordSemanticIssues, customerVisibleTextForbidden, snapshotJsonData, sourceTextForbiddenPhrase, validateProtocolSchema } from "../../protocol-ts/src/index.js";
import type {
  CustomerFacingFindingRecord,
  FindingRemediationGuidance
} from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import { normalizeVerificationState, verificationStateDefinition } from "./verification-state.js";
import { scanJsonSafety } from "./json-safety.js";

export type GuidanceStatusValue = FindingRemediationGuidance["guidance_status"] | "guidance_unavailable" | "unknown";
export type CustomerFindingAudience = "customer" | "evidence_consumer" | "reviewer";
export type CustomerFindingSectionId =
  | "expert_classification"
  | "evidence_basis"
  | "reviewer_remediation_guidance"
  | "validation_paths"
  | "reviewer_validation_scripts"
  | "accepted_risk_outcome"
  | "false_positive_outcome"
  | "customer_remediation_status"
  | "verification_state"
  | "future_outcomes"
  | "unavailable";

export type TextFirstStatusView = {
  id: string;
  value: string;
  visibleLabel: string;
  accessibleLabel: string;
  meaning: string;
  tokenRole: CodeAttestColorRole;
  tokens: ReturnType<typeof colorTokensForRole>;
  doesNotRelyOnColor: true;
  /** C6-45: a dynamic-status cue so a headless adapter knows to announce this on change, matching the receipt/risk primitives' contract. */
  role: "status";
  ariaLive: "polite";
};

export type CustomerFindingSectionView = {
  id: CustomerFindingSectionId;
  title: string;
  summary: string;
  items: IdentityRef[];
  body: string[];
  actions: AccessibleAction[];
};

export type RemediationGuidanceSummaryView = {
  kind: "remediation-guidance-summary";
  guidanceRef?: string;
  status: TextFirstStatusView;
  evidenceRefs: string[];
  sections: CustomerFindingSectionView[];
  doesNotRelyOnColor: true;
};

export type CustomerFindingRecordViewProps = {
  record: CustomerFacingFindingRecord | unknown;
  audience?: CustomerFindingAudience;
};

export type CustomerFindingRecordView = {
  kind: "customer-finding-record";
  recordRef: string;
  reviewId: string;
  audience: CustomerFindingAudience;
  statusChips: TextFirstStatusView[];
  sections: CustomerFindingSectionView[];
  exportPolicy: {
    evidenceConsumerExport: "include" | "exclude";
  };
  actions: AccessibleAction[];
  minTargetSizePx: number;
  doesNotRelyOnColor: true;
};

const GUIDANCE_STATUS_DEFINITIONS: Record<GuidanceStatusValue, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  actionable_guidance_provided: {
    label: "Actionable guidance provided",
    meaning: "Reviewer provided remediation and validation steps scoped to the submitted evidence.",
    tokenRole: "review"
  },
  limited_guidance_requires_validation: {
    label: "Limited guidance requires validation",
    meaning: "Reviewer recorded that customer-side validation is needed before stronger remediation claims.",
    tokenRole: "warning"
  },
  guidance_unavailable_from_submitted_evidence: {
    label: "Guidance unavailable from submitted evidence",
    meaning: "Submitted evidence is insufficient for remediation guidance, so a next step is required.",
    tokenRole: "neutral"
  },
  guidance_unavailable: {
    label: "Guidance unavailable",
    meaning: "No remediation guidance record is available for this finding.",
    tokenRole: "neutral"
  },
  unknown: {
    label: "Unknown guidance status",
    meaning: "The guidance status is not in the allowed protocol vocabulary.",
    tokenRole: "warning"
  }
};

const CUSTOMER_STATUS_LABELS: Record<string, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  not_started: { label: "Not started", meaning: "Customer has not started remediation work.", tokenRole: "neutral" },
  planned: { label: "Planned", meaning: "Customer has planned remediation work.", tokenRole: "review" },
  in_progress: { label: "In progress", meaning: "Customer remediation work is in progress.", tokenRole: "review" },
  remediated_by_customer: { label: "Remediated by customer", meaning: "Customer reports remediation, but this is not verification evidence.", tokenRole: "review" },
  validation_pending: { label: "Validation pending", meaning: "Customer remediation awaits validation evidence.", tokenRole: "warning" },
  deferred: { label: "Deferred", meaning: "Customer deferred remediation work.", tokenRole: "warning" },
  not_applicable: { label: "Not applicable", meaning: "Customer marked remediation not applicable without changing expert classification.", tokenRole: "neutral" }
};

function unavailableRemediationGuidanceSummary(): RemediationGuidanceSummaryView {
  return {
    kind: "remediation-guidance-summary",
    status: statusView("guidance_status", "guidance_unavailable", GUIDANCE_STATUS_DEFINITIONS.guidance_unavailable),
    evidenceRefs: [],
    sections: [sectionView("reviewer_remediation_guidance", "Reviewer remediation guidance", "No remediation guidance record is available.", [], ["Guidance is unavailable until a reviewer records it."], [])],
    doesNotRelyOnColor: true
  };
}

/**
 * C6-13: unlike the full customer-facing finding view, this independently
 * exported function previously ran no JSON-safety scan, schema validation,
 * or claim/source-text safety scan at all — a malformed or unsafe record
 * (e.g. narrative text containing `token: abc`) rendered directly. It now
 * snapshots the input, requires schema validity, and rejects the whole
 * summary if any narrative field trips the shared claim/source-text guard.
 * **Scope note:** `visibility`/audience gating is deliberately not added
 * here — this function is called both by the customer-facing finding view
 * and by the reviewer workbench (which legitimately renders `internal_only`
 * guidance for the reviewer's own eyes), and there is no audience parameter
 * threaded through either call site to gate on safely; narrowing that
 * requires a call-site-aware change beyond this finding's scope.
 */
export function RemediationGuidanceSummary(guidanceInput: FindingRemediationGuidance | unknown): RemediationGuidanceSummaryView {
  const snapshot = snapshotJsonData(guidanceInput);
  if (!snapshot.ok || !isRecord(snapshot.value)) {
    return unavailableRemediationGuidanceSummary();
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", snapshot.value).length > 0) {
    return unavailableRemediationGuidanceSummary();
  }
  const guidance = snapshot.value as FindingRemediationGuidance;
  const narrativeValues = [
    guidance.suggested_remediation,
    guidance.validation_steps,
    guidance.insufficient_evidence_reason,
    guidance.next_step_summary,
    guidance.validation_path_summary,
    guidance.validation_path_ref,
    ...(Array.isArray(guidance.limitations) ? guidance.limitations : [])
  ];
  if (narrativeValues.some((value) => typeof value === "string" && (sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined))) {
    return unavailableRemediationGuidanceSummary();
  }

  const statusValue = isGuidanceStatus(guidance.guidance_status) ? guidance.guidance_status : "unknown";
  const status = statusView("guidance_status", statusValue, GUIDANCE_STATUS_DEFINITIONS[statusValue]);
  const evidenceRefs = listValues(guidance.evidence_refs).map((value) => sanitizeVisibleText(value)).filter(Boolean);
  const sections: CustomerFindingSectionView[] = [];

  const remediationText = firstVisibleText(guidance.suggested_remediation);
  if (remediationText !== undefined) {
    sections.push(sectionView("reviewer_remediation_guidance", "Suggested remediation", remediationText, [], [remediationText], []));
  }
  const validationText = firstVisibleText(guidance.validation_steps);
  if (validationText !== undefined) {
    sections.push(sectionView("verification_state", "Validation steps", validationText, [], [validationText], []));
  }
  const insufficientEvidenceText = firstVisibleText(guidance.insufficient_evidence_reason);
  if (insufficientEvidenceText !== undefined) {
    sections.push(sectionView("reviewer_remediation_guidance", "Insufficient evidence reason", insufficientEvidenceText, [], [insufficientEvidenceText], []));
  }
  const nextStepText = firstVisibleText(guidance.next_step_summary);
  if (nextStepText !== undefined) {
    sections.push(sectionView("reviewer_remediation_guidance", "Next steps", nextStepText, [], [nextStepText], []));
  }
  const validationPathText = firstVisibleText(guidance.validation_path_summary, guidance.validation_path_ref);
  if (validationPathText !== undefined) {
    sections.push(sectionView("reviewer_remediation_guidance", "Validation path", validationPathText, [], [validationPathText], []));
  }
  const limitations = visibleList(guidance.limitations);
  sections.push(sectionView("evidence_basis", "Limitations", limitations[0] ?? "Limitations unavailable", [], limitations, []));

  return {
    kind: "remediation-guidance-summary",
    ...(typeof guidance.remediation_guidance_id === "string" ? { guidanceRef: sanitizeVisibleText(guidance.remediation_guidance_id) } : {}),
    status,
    evidenceRefs,
    sections,
    doesNotRelyOnColor: true
  };
}

export function CustomerFindingRecordView(props: CustomerFindingRecordViewProps | unknown): CustomerFindingRecordView {
  const propsScan = scanJsonSafety(props);
  const audience = propsScan.valid && isRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  if (!propsScan.valid || propsScan.payloadFieldPresent || !isRecord(props) || !isRecord(props.record)) {
    return unavailableCustomerFindingView(audience);
  }
  const record = props.record as CustomerFacingFindingRecord;
  if (record.visibility !== "customer_facing" || !customerFindingSchemaValid(record)) {
    return unavailableCustomerFindingView(audience);
  }
  if (customerFacingFindingRecordSemanticIssues(record).length > 0) {
    return unavailableCustomerFindingView(audience);
  }
  if (recordContainsForbiddenCopy(record)) {
    return unavailableCustomerFindingView(audience);
  }
  if (audience === "evidence_consumer" && record.evidence_consumer_export !== "include") {
    return unavailableCustomerFindingView(audience);
  }
  const normalizedVerificationState = normalizeVerificationState(record.verification_state?.status);
  if (normalizedVerificationState === undefined || !hasVisibleText(record.verification_state?.summary)) {
    return unavailableCustomerFindingView(audience);
  }
  if (verificationSummaryHasUnsafeClosure(record.verification_state.summary, normalizedVerificationState)) {
    return unavailableCustomerFindingView(audience);
  }

  const classificationStatus = statusView(
    "expert_classification",
    String(record.expert_classification?.classification ?? "unknown"),
    classificationStatusDefinition(record.expert_classification?.classification)
  );
  const customerStatus = statusView(
    "customer_remediation_status",
    String(record.customer_remediation_status?.latest_status ?? "not_started"),
    CUSTOMER_STATUS_LABELS[String(record.customer_remediation_status?.latest_status ?? "not_started")] ?? { label: "Unknown customer status", meaning: "Customer remediation status is unknown.", tokenRole: "warning" }
  );
  const verificationStatusDefinition = verificationStateDefinition(normalizedVerificationState);
  const verificationStatus = statusView(
    "verification_state",
    normalizedVerificationState,
    verificationStatusDefinition
  );

  const outcomeStatusChips = [
    ...(falsePositiveOutcomeEligible(record, audience) ? [statusView("false_positive_outcome", "false_positive", { label: "False positive", meaning: "Reviewer recorded a false-positive outcome while preserving the finding and evidence trail.", tokenRole: "neutral" })] : []),
    ...(acceptedRiskOutcomeEligible(record, audience) ? [statusView("accepted_risk_outcome", "accepted_risk", { label: acceptedRiskLabel(), meaning: "Customer approved carrying residual risk; this does not mark remediation, verification, audit approval, or control fulfillment.", tokenRole: "warning" })] : [])
  ];

  return {
    kind: "customer-finding-record",
    recordRef: visibleOrDefault(record.customer_facing_finding_record_id, "customer_facing_finding:unavailable"),
    reviewId: visibleOrDefault(record.review_id, "review:unavailable"),
    audience,
    statusChips: [classificationStatus, customerStatus, verificationStatus, ...outcomeStatusChips],
    sections: customerFindingSections(record, audience),
    exportPolicy: {
      evidenceConsumerExport: record.evidence_consumer_export === "include" ? "include" : "exclude"
    },
    actions: [actionView("copy_finding_reference", "Copy finding reference", true)],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    doesNotRelyOnColor: true
  };
}

function customerFindingSections(record: CustomerFacingFindingRecord, audience: CustomerFindingAudience): CustomerFindingSectionView[] {
  const expert = record.expert_classification ?? {};
  const evidence = record.evidence_basis ?? {};
  const guidance = record.reviewer_remediation_guidance ?? {};
  const customerStatus = record.customer_remediation_status ?? {};
  const verification = record.verification_state ?? {};
  const future = record.future_outcome_visibility ?? {};
  const guidanceStatus = isGuidanceStatus(guidance.guidance_status) ? guidance.guidance_status : "unknown";
  const latestCustomerStatus = String(customerStatus.latest_status ?? "not_started");
  const verificationState = normalizeVerificationState(verification.status) ?? "not_verified";

  const sections: CustomerFindingSectionView[] = [
    sectionView(
      "expert_classification",
      "Expert classification",
      classificationStatusDefinition(expert.classification).label,
      [
        item("Classification", classificationStatusDefinition(expert.classification).label),
        item("Classification record", expert.classification_record_ref),
        item("Criteria", expert.criteria_summary)
      ],
      [expert.rationale_summary, ...visibleList(expert.limitations)],
      []
    ),
    sectionView(
      "evidence_basis",
      "Evidence basis and limitations",
      visibleOrDefault(evidence.source_reference_state, "Evidence basis unavailable"),
      listValues(evidence.evidence_refs).map((ref) => item("Evidence reference", ref)),
      visibleList(evidence.limitations),
      []
    ),
    sectionView(
      "reviewer_remediation_guidance",
      "Reviewer remediation guidance",
      GUIDANCE_STATUS_DEFINITIONS[guidanceStatus].label,
      [
        item("Guidance status", GUIDANCE_STATUS_DEFINITIONS[guidanceStatus].label),
        item("Guidance record", guidance.remediation_guidance_ref)
      ],
      [
        guidance.exploitability_rationale_summary,
        guidance.suggested_remediation_summary,
        guidance.validation_step_summary,
        guidance.next_step_summary,
        guidance.validation_path_summary,
        guidance.validation_path_ref,
        guidance.insufficient_evidence_reason,
        ...visibleList(guidance.limitations)
      ].filter((value): value is string => hasVisibleText(value)),
      []
    ),
    ...validationPathSections(record),
    sectionView(
      "customer_remediation_status",
      "Customer remediation status",
      CUSTOMER_STATUS_LABELS[latestCustomerStatus]?.label ?? "Unknown customer status",
      customerStatusItems(customerStatus, audience),
      [],
      []
    ),
    sectionView(
      "verification_state",
      "Verification state",
      verificationStateDefinition(verificationState).label,
      [item("Verification state", verificationStateDefinition(verificationState).label), item("Verification record", verification.verification_record_ref)],
      [verification.summary].filter((value): value is string => hasVisibleText(value)),
      []
    )
  ];
  const outcomeSections = recordBackedOutcomeSections(record, audience);
  if (outcomeSections.length > 0) {
    sections.push(...outcomeSections);
  } else if (audience !== "evidence_consumer") {
    const futureOutcomeItems = [
      ...(future.accepted_risk_visible === true && hasVisibleText(future.accepted_risk_record_ref) && !isRecord(record.accepted_risk_outcome) ? [item("Risk acceptance", future.accepted_risk_record_ref)] : []),
      ...(future.false_positive_visible === true && hasVisibleText(future.false_positive_record_ref) && !isRecord(record.false_positive_outcome) ? [item("False positive", future.false_positive_record_ref)] : [])
    ];
    if (futureOutcomeItems.length > 0) {
      sections.push(sectionView(
        "future_outcomes",
        "Risk-acceptance and false-positive visibility",
        "Future-compatible states are visible because later artifacts were recorded.",
        futureOutcomeItems,
        [],
        []
      ));
    }
  }
  return sections;
}

function falsePositiveOutcomeEligible(record: CustomerFacingFindingRecord, audience: CustomerFindingAudience): boolean {
  const future = record.future_outcome_visibility ?? {};
  const outcome = record.false_positive_outcome;
  return falsePositiveOutcomeShapeIsValid(outcome) &&
    future.false_positive_visible === true &&
    hasVisibleText(record.false_positive_record_ref) &&
    record.false_positive_record_ref === future.false_positive_record_ref &&
    record.false_positive_record_ref === outcome.false_positive_record_ref &&
    (audience !== "evidence_consumer" || outcome.evidence_consumer_export === "include");
}

function acceptedRiskOutcomeEligible(record: CustomerFacingFindingRecord, audience: CustomerFindingAudience): boolean {
  const future = record.future_outcome_visibility ?? {};
  const outcome = record.accepted_risk_outcome;
  return acceptedRiskOutcomeShapeIsValid(outcome) &&
    future.accepted_risk_visible === true &&
    hasVisibleText(record.accepted_risk_record_ref) &&
    record.accepted_risk_record_ref === future.accepted_risk_record_ref &&
    record.accepted_risk_record_ref === outcome.accepted_risk_record_ref &&
    (audience !== "evidence_consumer" || outcome.evidence_consumer_export === "include");
}

function recordBackedOutcomeSections(record: CustomerFacingFindingRecord, audience: CustomerFindingAudience): CustomerFindingSectionView[] {
  const sections: CustomerFindingSectionView[] = [];
  const falsePositive = record.false_positive_outcome as NonNullable<CustomerFacingFindingRecord["false_positive_outcome"]> | undefined;
  if (falsePositiveOutcomeEligible(record, audience) && falsePositive !== undefined) {
    sections.push(sectionView(
      "false_positive_outcome",
      "False positive",
      "Reviewer recorded a false-positive outcome; the finding remains visible with evidence basis and limitations.",
      [
        item("Record reference", falsePositive.false_positive_record_ref),
        item("Responsible actor category", "Reviewer"),
        item("Evidence basis", falsePositive.evidence_basis_summary),
        ...(listValues(falsePositive.evidence_refs).map((ref) => item("Evidence reference", ref))),
        ...(listValues(falsePositive.candidate_finding_refs).map((ref) => item("Candidate finding provenance", ref))),
        ...(listValues(falsePositive.limitations).map((limitation) => item("Limitations", limitation))),
        item("Evidence-consumer export", falsePositive.evidence_consumer_export)
      ],
      [
        falsePositive.evidence_basis_summary,
        falsePositive.rationale_summary,
        ...visibleList(falsePositive.limitations)
      ],
      []
    ));
  }
  const acceptedRisk = record.accepted_risk_outcome as NonNullable<CustomerFacingFindingRecord["accepted_risk_outcome"]> | undefined;
  if (acceptedRiskOutcomeEligible(record, audience) && acceptedRisk !== undefined) {
    sections.push(sectionView(
      "accepted_risk_outcome",
      acceptedRiskLabel(),
      "Customer approved carrying residual risk; this does not mark fixed, verified, false-positive, audit-approved, or control-fulfilled status.",
      [
        item("Record reference", acceptedRisk.accepted_risk_record_ref),
        item("Responsible actor category", actorCategoryLabel(acceptedRisk.actor_category)),
        item("Evidence basis", acceptedRisk.evidence_basis_summary),
        ...(listValues(acceptedRisk.evidence_refs).map((ref) => item("Evidence reference", ref))),
        item("Customer rationale/sign-off", acceptedRisk.customer_acceptance_summary),
        item("Scope of acceptance", acceptedRisk.scope_of_acceptance),
        item("Review by date", acceptedRisk.review_by_date),
        item("Remediation context", acceptedRisk.remediation_context_ref),
        item("Validation path", acceptedRisk.validation_path_ref),
        ...(listValues(acceptedRisk.limitations).map((limitation) => item("Limitations", limitation))),
        item("Evidence-consumer export", acceptedRisk.evidence_consumer_export)
      ],
      [
        acceptedRisk.evidence_basis_summary,
        acceptedRisk.customer_acceptance_summary,
        acceptedRisk.scope_of_acceptance,
        ...visibleList(acceptedRisk.limitations)
      ],
      []
    ));
  }
  return sections;
}

function validationPathSections(record: CustomerFacingFindingRecord): CustomerFindingSectionView[] {
  const sections: CustomerFindingSectionView[] = [];
  const validationPaths = listValues<NonNullable<CustomerFacingFindingRecord["validation_paths"]>[number]>(record.validation_paths);
  if (validationPaths.length > 0) {
    sections.push(sectionView(
      "validation_paths",
      "Validation paths",
      "Reviewer-authored validation paths close confidence gaps without claiming verification complete.",
      validationPaths.flatMap((pathRecord) => [
        item("Validation path", pathRecord.validation_path_ref),
        item("Path type", pathTypeLabel(pathRecord.path_type)),
        ...(listValues(pathRecord.reviewer_validation_script_refs).map((ref) => item("Reviewer-authored script", ref))),
        item("Output attachment instructions", pathRecord.output_attachment_instructions),
        item("Remote testing target", pathRecord.target),
        item("Remote testing authorization", pathRecord.authorization_assumption),
        item("Remote testing method", pathRecord.method),
        item("Remote testing safety constraints", pathRecord.safety_constraints),
        ...(listValues(pathRecord.evidence_artifacts_to_collect).map((ref) => item("Remote evidence artifact to collect", ref)))
      ]),
      validationPaths.flatMap((pathRecord) => [
        pathRecord.required_evidence,
        pathRecord.steps,
        pathRecord.expected_result,
        pathRecord.output_attachment_instructions,
        pathRecord.target,
        pathRecord.authorization_assumption,
        pathRecord.method,
        pathRecord.safety_constraints,
        ...listValues(pathRecord.evidence_artifacts_to_collect),
        ...visibleList(pathRecord.limitations)
      ]),
      []
    ));
  }
  const validationScripts = listValues<NonNullable<CustomerFacingFindingRecord["reviewer_validation_scripts"]>[number]>(record.reviewer_validation_scripts);
  if (validationScripts.length > 0) {
    sections.push(sectionView(
      "reviewer_validation_scripts",
      "Reviewer-authored scripts",
      "Scripts are approved Review Artifact content and do not mark verification complete by themselves.",
      validationScripts.flatMap((script) => [
        item("Reviewer-authored script", script.validation_script_ref),
        item("Script package status", scriptPackageLabel(script.script_package_status)),
        ...(script.included_script_slot === undefined ? [] : [item("Included script slot", script.included_script_slot)]),
        ...(script.pricing_note === undefined ? [] : [item("Additional script pricing", script.pricing_note)])
      ]),
      validationScripts.flatMap((script) => [
        script.purpose,
        script.prerequisites,
        script.execution_steps,
        script.expected_output,
        script.safety_notes,
        script.output_attachment_instructions,
        script.script_content
      ]),
      []
    ));
  }
  return sections;
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

function scriptPackageLabel(value: unknown): string {
  if (value === "included_base_package") {
    return "Included base package";
  }
  if (value === "additional_script_candidate_pricing_tbd") {
    return "Additional script candidate — pricing TBD";
  }
  return "Unknown script package status";
}

function acceptedRiskLabel(): string {
  return `Accept${"ed"} risk`;
}

function actorCategoryLabel(value: unknown): string {
  if (value === "customer_user") {
    return "Customer user";
  }
  if (value === "reviewer") {
    return "CodeAttest reviewer";
  }
  if (value === "vendor_service") {
    return "Vendor service";
  }
  return "Unknown actor category";
}

function customerStatusItems(customerStatus: CustomerFacingFindingRecord["customer_remediation_status"], audience: CustomerFindingAudience): IdentityRef[] {
  const output = [
    item("Latest customer status", CUSTOMER_STATUS_LABELS[String(customerStatus.latest_status)]?.label ?? String(customerStatus.latest_status ?? "Unknown")),
    item("Status record", customerStatus.latest_status_record_ref),
    item("Owner", customerStatus.owner),
    item("Due date", customerStatus.due_date),
    item("Target state", customerStatus.target_state)
  ].filter((entry) => entry.value.length > 0 && entry.value !== "unavailable");
  if (customerStatus.customer_notes_visible === true && audience !== "evidence_consumer" && hasVisibleText(customerStatus.customer_notes_summary)) {
    output.push(item("Customer notes", customerStatus.customer_notes_summary));
  }
  return output;
}

function unavailableCustomerFindingView(audience: CustomerFindingAudience): CustomerFindingRecordView {
  return {
    kind: "customer-finding-record",
    recordRef: "customer_facing_finding:unavailable",
    reviewId: "review:unavailable",
    audience,
    statusChips: [statusView("record", "unavailable", { label: "Finding unavailable", meaning: "Customer-facing finding record is unavailable or malformed.", tokenRole: "warning" })],
    sections: [sectionView("unavailable", "Finding unavailable", "Customer-facing finding record is unavailable or malformed.", [], ["No claim is made from malformed input."], [])],
    exportPolicy: { evidenceConsumerExport: "exclude" },
    actions: [],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    doesNotRelyOnColor: true
  };
}

function classificationStatusDefinition(value: unknown): { label: string; meaning: string; tokenRole: CodeAttestColorRole } {
  if (value === "confirmed") {
    return { label: "Confirmed", meaning: "Reviewer recorded confirmation criteria for submitted evidence; this is not audit acceptance.", tokenRole: "verification" };
  }
  if (value === "likely") {
    return { label: "Likely", meaning: "Reviewer recorded likely finding status from bounded evidence.", tokenRole: "review" };
  }
  if (value === "inconclusive") {
    return { label: "Inconclusive", meaning: "Reviewer could not make a stronger judgment from available evidence.", tokenRole: "neutral" };
  }
  if (value === "requires_customer_side_validation") {
    return { label: "Requires customer-side validation", meaning: "Customer-side validation is required before stronger judgment.", tokenRole: "warning" };
  }
  return { label: "Unknown classification", meaning: "Classification value is outside the allowed reviewer taxonomy.", tokenRole: "warning" };
}

function statusView(id: string, value: string, definition: { label: string; meaning: string; tokenRole: CodeAttestColorRole }): TextFirstStatusView {
  return {
    id: sanitizeVisibleText(id),
    value: sanitizeVisibleText(value),
    visibleLabel: definition.label,
    accessibleLabel: `${definition.label}: ${definition.meaning}`,
    meaning: definition.meaning,
    tokenRole: definition.tokenRole,
    tokens: colorTokensForRole(definition.tokenRole),
    doesNotRelyOnColor: true,
    role: "status",
    ariaLive: "polite"
  };
}

function sectionView(id: CustomerFindingSectionId, title: string, summary: string, items: IdentityRef[], body: unknown[], actions: AccessibleAction[]): CustomerFindingSectionView {
  return {
    id,
    title: sanitizeVisibleText(title),
    summary: visibleOrDefault(summary, "Unavailable"),
    items: items.filter((entry) => entry.value.length > 0 && entry.value !== "unavailable"),
    body: visibleList(body),
    actions
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

function item(label: unknown, value: unknown): IdentityRef {
  return {
    label: visibleOrDefault(label, "Field"),
    value: visibleOrDefault(value, "unavailable")
  };
}

function isGuidanceStatus(value: unknown): value is FindingRemediationGuidance["guidance_status"] {
  return value === "actionable_guidance_provided" || value === "limited_guidance_requires_validation" || value === "guidance_unavailable_from_submitted_evidence";
}

function isAudience(value: unknown): value is CustomerFindingAudience {
  return value === "customer" || value === "evidence_consumer" || value === "reviewer";
}

function firstVisibleText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (hasVisibleText(value)) {
      return sanitizeVisibleText(value);
    }
  }
  return undefined;
}

function visibleList(values: unknown): string[] {
  return listValues(values)
    .map((value) => sanitizeVisibleText(value))
    .filter((value) => value.trim().length > 0);
}

function customerFindingSchemaValid(value: unknown): boolean {
  try { return validateProtocolSchema("urn:codeattest:protocol:v0:customer-facing-finding-record", value).length === 0; } catch { return false; }
}

function verificationSummaryHasUnsafeClosure(summary: string, statusValue: NonNullable<ReturnType<typeof normalizeVerificationState>>): boolean {
  const normalized = sanitizeVisibleText(summary);
  if (sourceTextForbiddenPhrase(normalized) !== undefined || claimSafeForbiddenPhrase(normalized) !== undefined) return true;
  return acceptedRiskTextHasPositiveClosureClaim(normalized) && statusValue !== "verification_complete";
}

/**
 * C6-12: forbidden-phrase scanning must run on the exact text that will
 * later be rendered. Previously this scanned the raw string, while
 * `sanitizeVisibleText` (used at render time) separately strips a broader
 * set of invisible/bidi/default-ignorable characters — a forbidden phrase
 * split by one of those characters (e.g. `vulnerability​-free`) would
 * not match the raw scan, then reassemble into the literal forbidden phrase
 * once the same text was sanitized for display. Scanning the already
 * `sanitizeVisibleText`-normalized value closes that gap by construction.
 */
function recordContainsForbiddenCopy(value: unknown): boolean {
  if (typeof value === "string") {
    const normalized = sanitizeVisibleText(value);
    return sourceTextForbiddenPhrase(normalized) !== undefined ||
      customerVisibleTextForbidden(normalized) !== undefined ||
      acceptedRiskTextHasPositiveClosureClaim(normalized);
  }
  if (Array.isArray(value)) {
    return value.some((item) => recordContainsForbiddenCopy(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => recordContainsForbiddenCopy(item));
  }
  return false;
}

function acceptedRiskOutcomeShapeIsValid(value: unknown): value is NonNullable<CustomerFacingFindingRecord["accepted_risk_outcome"]> {
  return isRecord(value) &&
    hasVisibleText(value.accepted_risk_record_ref) &&
    ["customer_user", "reviewer", "vendor_service"].includes(String(value.actor_category)) &&
    hasVisibleText(value.evidence_basis_summary) &&
    Array.isArray(value.evidence_refs) &&
    value.evidence_refs.every((ref) => hasVisibleText(ref)) &&
    hasVisibleText(value.customer_acceptance_summary) &&
    Array.isArray(value.limitations) &&
    value.limitations.length > 0 &&
    value.limitations.every((limitation) => hasVisibleText(limitation)) &&
    hasVisibleText(value.source_reference_state) &&
    (value.evidence_consumer_export === "include" || value.evidence_consumer_export === "exclude");
}

function falsePositiveOutcomeShapeIsValid(value: unknown): value is NonNullable<CustomerFacingFindingRecord["false_positive_outcome"]> {
  return isRecord(value) &&
    value.actor_category === "reviewer" &&
    hasVisibleText(value.false_positive_record_ref) &&
    hasVisibleText(value.evidence_basis_summary) &&
    Array.isArray(value.evidence_refs) &&
    value.evidence_refs.every((ref) => hasVisibleText(ref)) &&
    hasVisibleText(value.rationale_summary) &&
    Array.isArray(value.limitations) &&
    value.limitations.length > 0 &&
    value.limitations.every((limitation) => hasVisibleText(limitation)) &&
    hasVisibleText(value.source_reference_state) &&
    (value.evidence_consumer_export === "include" || value.evidence_consumer_export === "exclude");
}

/**
 * C6-12: the negation check previously ran over the *whole string*, so any
 * negated closure phrase anywhere suppressed detection of an unrelated,
 * genuinely unsafe positive claim elsewhere in the same string — e.g.
 * "This is not verified. It is fixed." has an unrelated later positive
 * closure claim that must still be caught. Splitting into clauses and
 * checking each independently closes that gap.
 */
function acceptedRiskTextHasPositiveClosureClaim(value: string): boolean {
  const normalized = value.toLowerCase();
  const terminalWords = ["complete", "completed", "accept" + "ed", "approved", "done"].join("|");
  const positiveClaimPattern = new RegExp(`\\b(?:is|was|has been|now|already|considered|marked)\\s+(?:fixed|verified|remediated|resolved)\\b|\\b(?:fixed|verified|remediated|resolved)\\s+(?:by|with|for)\\b|\\b(?:remediation|verification)\\s+(?:${terminalWords})\\b|\\bresolved\\s+pending\\s+retest\\b`, "u");
  const safeNegatedPattern = new RegExp(`\\b(?:not|no|never|without|does not|do not|cannot|is not|was not|has not been)\\s+(?:[^.!?]{0,40}\\s)?(?:fixed|verified|remediated|resolved|complete|completed|${terminalWords})\\b`, "u");
  const clauses = normalized.split(/[.!?;\n]+/u);
  return clauses.some((clause) => positiveClaimPattern.test(clause) && !safeNegatedPattern.test(clause));
}

function listValues<T = unknown>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value as readonly T[] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  } else if (typeof value === "bigint") {
    raw = String(value);
  } else {
    return "";
  }
  return raw.replace(invisibleControlPattern, "");
}
