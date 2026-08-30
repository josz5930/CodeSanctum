import { claimSafePositiveClosurePhrase, customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import type { VerificationPassScope } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import type { TextFirstStatusView } from "./customer-finding-record.js";

export type VerificationPassScopeAudience = "customer" | "evidence_consumer" | "reviewer";
export type VerificationPassScopeSectionId = "selected_findings" | "deadline" | "script_allocation" | "limitations" | "unavailable";

export type VerificationPassScopeFindingView = {
  findingRef: string;
  classificationRecordRef: string;
  classification: TextFirstStatusView;
  remediationStatus: TextFirstStatusView;
  requestedVerificationType: TextFirstStatusView;
  eligibility: TextFirstStatusView;
  eligibilityReason: string;
  nextStep: string;
  refs: IdentityRef[];
  limitations: string[];
};

export type VerificationPassScopeSectionView = {
  id: VerificationPassScopeSectionId;
  title: string;
  summary: string;
  items: IdentityRef[];
  body: string[];
  actions: AccessibleAction[];
};

export type VerificationPassScopeViewProps = {
  scope: VerificationPassScope | unknown;
  audience?: VerificationPassScopeAudience;
};

export type VerificationPassScopeView = {
  kind: "verification-pass-scope";
  verificationPassRef: string;
  reviewId: string;
  audience: VerificationPassScopeAudience;
  passDeadline: string;
  statusChips: TextFirstStatusView[];
  selectedFindings: VerificationPassScopeFindingView[];
  includedScriptSlots: IdentityRef[];
  additionalScriptCandidates: IdentityRef[];
  disclosure: {
    title: string;
    body: string[];
    nonDismissible: true;
    tokenRole: CodeAttestColorRole;
    doesNotRelyOnColor: true;
  };
  sections: VerificationPassScopeSectionView[];
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: {
    widthPx: number;
    color: string;
  };
  doesNotRelyOnColor: true;
};

const CLASSIFICATION_LABELS: Record<string, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  likely: { label: "Likely", meaning: "Reviewer recorded likely finding status from bounded evidence.", tokenRole: "review" },
  confirmed: { label: "Confirmed", meaning: "Reviewer recorded confirmation criteria; this is not verification or audit acceptance.", tokenRole: "review" },
  inconclusive: { label: "Inconclusive", meaning: "Reviewer could not make a stronger judgment from available evidence.", tokenRole: "neutral" },
  requires_customer_side_validation: { label: "Requires customer-side validation", meaning: "Formal validation context is needed before verification can proceed.", tokenRole: "warning" }
};

const CUSTOMER_STATUS_LABELS: Record<string, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  not_started: { label: "Not started", meaning: "Customer has not started remediation work.", tokenRole: "neutral" },
  planned: { label: "Planned", meaning: "Customer has planned remediation work.", tokenRole: "review" },
  in_progress: { label: "In progress", meaning: "Customer remediation work is in progress.", tokenRole: "review" },
  remediated_by_customer: { label: "Remediated by customer", meaning: "Customer reports remediation, but this is not verification evidence.", tokenRole: "warning" },
  validation_pending: { label: "Validation pending", meaning: "Customer remediation awaits validation evidence.", tokenRole: "warning" },
  deferred: { label: "Deferred", meaning: "Customer deferred remediation work.", tokenRole: "warning" },
  not_applicable: { label: "Not applicable", meaning: "Customer marked remediation not applicable without changing reviewer classification.", tokenRole: "neutral" },
  unavailable: { label: "Remediation status unavailable", meaning: "No current customer remediation status was supplied for this selected finding.", tokenRole: "neutral" }
};

const REQUEST_TYPE_LABELS: Record<string, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  follow_up_commit: { label: "Follow-up commit", meaning: "Later Story 4.2 evidence may provide a follow-up commit for scoped verification.", tokenRole: "review" },
  customer_validation_evidence: { label: "Customer validation evidence", meaning: "Later customer-provided validation evidence may be submitted for the selected finding.", tokenRole: "warning" },
  reviewer_authored_script_output: { label: "Reviewer-authored script output", meaning: "A reviewer-authored script may produce later customer-provided output; the script alone is not verification.", tokenRole: "warning" },
  manual_validation_record: { label: "Manual validation record", meaning: "A later manual validation record may be submitted against recorded criteria.", tokenRole: "warning" },
  remote_dynamic_testing_evidence: { label: "Remote dynamic testing evidence", meaning: "Later remote testing evidence may be submitted against an authorized validation path.", tokenRole: "warning" }
};

const ELIGIBILITY_LABELS: Record<string, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  eligible: { label: "Eligible", meaning: "Selected finding is in scope for the included pass; this is not a verification outcome.", tokenRole: "review" },
  out_of_scope: { label: "Out of scope", meaning: "Selected finding will not be verified under current included-pass terms/context.", tokenRole: "neutral" },
  requires_additional_agreement: { label: "Requires additional agreement", meaning: "Scope exceeds included terms or script allocation and needs a separate agreement.", tokenRole: "warning" },
  blocked_pending_validation_path: { label: "Blocked pending validation path", meaning: "A formal validation path or additional agreement is required before customer evidence intake can proceed.", tokenRole: "warning" }
};

export function VerificationPassScopeView(props: VerificationPassScopeViewProps | unknown): VerificationPassScopeView {
  const audience = isRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  if (!isRecord(props) || !isRecord(props.scope)) {
    return unavailableVerificationPassScopeView(audience);
  }
  const scope = props.scope as VerificationPassScope;
  if (scope.visibility !== "customer_facing" || recordContainsForbiddenCopy(scope) || !scopeShapeIsSafe(scope)) {
    return unavailableVerificationPassScopeView(audience);
  }
  const selectedFindings = scope.selected_findings.map(selectedFindingView);
  const includedSlots = listValues<Record<string, unknown>>(scope.included_script_allocation.included_slots).map((slot) => item(`Included slot ${String(slot.slot ?? "unavailable")}`, slot.validation_script_ref));
  const additionalCandidates = listValues<Record<string, unknown>>(scope.included_script_allocation.additional_script_candidates).map((candidate) => item("Additional script candidate pricing TBD", candidate.validation_script_ref));
  const eligibilitySummary = selectedFindings.some((finding) => finding.eligibility.value === "requires_additional_agreement" || finding.eligibility.value === "blocked_pending_validation_path")
    ? "Some selected findings need a formal validation path or additional agreement before the included pass can proceed."
    : "Selected findings are recorded for included-pass consideration only; verification remains pending later evidence and decisions.";
  return {
    kind: "verification-pass-scope",
    verificationPassRef: visibleOrDefault(scope.verification_pass_id, "verification_pass:unavailable"),
    reviewId: visibleOrDefault(scope.review_id, "review:unavailable"),
    audience,
    passDeadline: visibleOrDefault(scope.pass_deadline, "deadline unavailable"),
    statusChips: [
      statusView("included_pass_window", "available_within_30_days", { label: "Available within 30 days", meaning: "Included pass availability is bounded by the recorded pass deadline, not an SLA beyond it.", tokenRole: "warning" }),
      statusView("selected_findings", `${selectedFindings.length}_selected`, { label: `${selectedFindings.length} selected finding${selectedFindings.length === 1 ? "" : "s"}`, meaning: "Only selected findings are in this verification-pass scope.", tokenRole: "review" })
    ],
    selectedFindings,
    includedScriptSlots: includedSlots,
    additionalScriptCandidates: additionalCandidates,
    disclosure: {
      title: "Verification pass scope limitation",
      body: [
        "This verification pass is limited to selected findings, submitted follow-up evidence, and recorded validation criteria.",
        "It is not a complete fresh secure-code review and does not record fixed, remediated, resolved, or verification-complete status."
      ],
      nonDismissible: true,
      tokenRole: "warning",
      doesNotRelyOnColor: true
    },
    sections: [
      sectionView("selected_findings", "Selected findings", eligibilitySummary, selectedFindings.flatMap((finding) => finding.refs), selectedFindings.flatMap((finding) => [finding.eligibilityReason, finding.nextStep, ...finding.limitations]), []),
      sectionView("deadline", "Included pass deadline", "Included pass availability is bounded to 30 days from the recorded start basis.", [item("Pass deadline", scope.pass_deadline), item("Start basis", scope.included_pass_start_basis)], [scope.included_pass_start_basis, `Pass deadline: ${scope.pass_deadline}`], []),
      sectionView("script_allocation", "Validation Script allocation", "Included slots 1..3 are shown separately from additional script candidates with pricing TBD.", [...includedSlots, ...additionalCandidates], scriptAllocationBody(scope), []),
      sectionView("limitations", "Limitations", "Scope limitations must travel with later verification decisions and addenda.", [], [...listValues(scope.limitations)], [])
    ],
    actions: [actionView("copy_verification_pass_reference", "Copy verification pass reference", true)],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    focusRing: {
      widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx,
      color: codeAttestDesignTokens.accessibility.focusRingColor
    },
    doesNotRelyOnColor: true
  };
}

function selectedFindingView(finding: VerificationPassScope["selected_findings"][number]): VerificationPassScopeFindingView {
  const eligibility = statusView("eligibility_state", String(finding.eligibility_state), ELIGIBILITY_LABELS[String(finding.eligibility_state)] ?? { label: "Unknown eligibility", meaning: "Eligibility state is outside the allowed Story 4.1 vocabulary.", tokenRole: "warning" });
  const nextStep = finding.eligibility_state === "blocked_pending_validation_path"
    ? "Record a formal validation path or explicit additional agreement before accepting customer-side validation evidence."
    : finding.eligibility_state === "requires_additional_agreement"
      ? "Resolve separate agreement and pricing TBD posture before treating this as included scope."
      : finding.eligibility_state === "out_of_scope"
        ? "Keep the original finding and any prior outcome visible; do not treat this as hidden cleanup."
        : "Await later submitted evidence and reviewer verification decision before showing any success state.";
  return {
    findingRef: visibleOrDefault(finding.review_finding_draft_ref, "review_finding_draft:unavailable"),
    classificationRecordRef: visibleOrDefault(finding.classification_record_ref, "classification_record:unavailable"),
    classification: statusView("current_classification", String(finding.current_classification), CLASSIFICATION_LABELS[String(finding.current_classification)] ?? { label: "Unknown classification", meaning: "Classification value is outside the allowed reviewer taxonomy.", tokenRole: "warning" }),
    remediationStatus: statusView("current_customer_remediation_status", String(finding.current_customer_remediation_status ?? "unavailable"), CUSTOMER_STATUS_LABELS[String(finding.current_customer_remediation_status ?? "unavailable")] ?? { label: "Remediation status unavailable", meaning: "No current customer remediation status was supplied for this selected finding.", tokenRole: "neutral" }),
    requestedVerificationType: statusView("requested_verification_type", String(finding.requested_verification_type), REQUEST_TYPE_LABELS[String(finding.requested_verification_type)] ?? { label: "Unknown requested verification type", meaning: "Requested verification type is outside the Story 4.1 vocabulary.", tokenRole: "warning" }),
    eligibility,
    eligibilityReason: visibleOrDefault(finding.eligibility_reason, "Eligibility reason unavailable"),
    nextStep,
    refs: [
      item("Review Finding draft", finding.review_finding_draft_ref),
      item("Classification record", finding.classification_record_ref),
      item("Remediation guidance", finding.remediation_guidance_ref),
      item("Customer status", finding.customer_status_record_ref),
      item("Validation path", finding.validation_path_ref),
      item("Risk acceptance record", finding.accepted_risk_record_ref),
      item("False positive", finding.false_positive_record_ref),
      ...listValues(finding.reviewer_validation_script_refs).map((ref) => item("Reviewer-authored script", ref))
    ],
    limitations: listValues(finding.limitations)
  };
}

function scriptAllocationBody(scope: VerificationPassScope): string[] {
  const included = listValues<Record<string, unknown>>(scope.included_script_allocation.included_slots).map((slot) => `Included slot ${String(slot.slot ?? "unavailable")}: ${visibleOrDefault(slot.validation_script_ref, "validation_script:unavailable")}.`);
  const additional = listValues<Record<string, unknown>>(scope.included_script_allocation.additional_script_candidates).map((candidate) => `Additional script candidate ${visibleOrDefault(candidate.validation_script_ref, "validation_script:unavailable")}: pricing TBD.`);
  return [...included, ...additional, "No invented prices or in-product purchase flow are shown for additional scripts."];
}

function unavailableVerificationPassScopeView(audience: VerificationPassScopeAudience): VerificationPassScopeView {
  return {
    kind: "verification-pass-scope",
    verificationPassRef: "verification_pass:unavailable",
    reviewId: "review:unavailable",
    audience,
    passDeadline: "deadline unavailable",
    statusChips: [statusView("record", "unavailable", { label: "Verification scope unavailable", meaning: "Verification-pass scope is unavailable or malformed.", tokenRole: "warning" })],
    selectedFindings: [],
    includedScriptSlots: [],
    additionalScriptCandidates: [],
    disclosure: {
      title: "Verification pass scope unavailable",
      body: ["No verification, remediation, audit, certification, or absence-of-vulnerabilities claim is made from malformed input."],
      nonDismissible: true,
      tokenRole: "warning",
      doesNotRelyOnColor: true
    },
    sections: [sectionView("unavailable", "Verification scope unavailable", "Verification-pass scope is unavailable or malformed.", [], ["No claim is made from malformed input."], [])],
    actions: [],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor },
    doesNotRelyOnColor: true
  };
}

function scopeShapeIsSafe(scope: VerificationPassScope): boolean {
  const forbiddenFields = ["follow_up_commit_ref", "follow_up_commit", "uploaded_validation_evidence_ref", "validation_evidence_ref", "before_after_outcome", "before_after_decision", "verification_complete", "verified_with_evidence", "verification_decision", "addendum_ref", "attestation_addendum_ref", "fixed", "resolved", "remediated", "accepted_risk_record", "false_positive_record"];
  if (
    !refMatches(scope.review_id, /^review:[a-z0-9][a-z0-9_-]{2,63}$/u) ||
    !refMatches(scope.verification_pass_id, /^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$/u) ||
    !Number.isInteger(scope.scope_version) || scope.scope_version < 1 ||
    scope.source_derived_class !== "retained_review_artifact" ||
    !isIsoUtcTimestamp(scope.included_pass_started_at) ||
    !isIsoUtcTimestamp(scope.scope_recorded_at) ||
    !isIsoUtcTimestamp(scope.pass_deadline) ||
    !verificationScopeWindowIsValid(scope.included_pass_started_at, scope.scope_recorded_at, scope.pass_deadline) ||
    verificationScopeDeadlineBasisIsUnsafe(scope.included_pass_start_basis, scope.limitations)
  ) {
    return false;
  }
  if (!Array.isArray(scope.limitations) || scope.limitations.length === 0 || scope.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation))) {
    return false;
  }
  if (!Array.isArray(scope.selected_findings) || scope.selected_findings.length === 0 || !isRecord(scope.included_script_allocation) || !Array.isArray(scope.included_script_allocation.included_slots) || !Array.isArray(scope.included_script_allocation.additional_script_candidates)) {
    return false;
  }
  if (forbiddenFields.some((field) => Object.prototype.hasOwnProperty.call(scope, field) && (scope as Record<string, unknown>)[field] !== undefined)) {
    return false;
  }
  const selectedFindings = scope.selected_findings.filter(isRecord);
  if (selectedFindings.length !== scope.selected_findings.length) {
    return false;
  }
  const selectedFindingRefs = new Set<string>();
  for (const finding of selectedFindings) {
    if (!refMatches(finding.review_finding_draft_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(finding.classification_record_ref, /^classification_record:[a-z0-9][a-z0-9_-]{2,63}$/u)) {
      return false;
    }
    if (selectedFindingRefs.has(finding.review_finding_draft_ref as string)) return false;
    selectedFindingRefs.add(finding.review_finding_draft_ref as string);
    if (!Object.prototype.hasOwnProperty.call(CLASSIFICATION_LABELS, String(finding.current_classification)) || !Object.prototype.hasOwnProperty.call(REQUEST_TYPE_LABELS, String(finding.requested_verification_type)) || !Object.prototype.hasOwnProperty.call(ELIGIBILITY_LABELS, String(finding.eligibility_state))) {
      return false;
    }
    if (!isMeaningfulVerificationScopeReason(finding.eligibility_reason) || !Array.isArray(finding.limitations) || finding.limitations.length === 0 || finding.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation))) return false;
    if (forbiddenFields.some((field) => Object.prototype.hasOwnProperty.call(finding, field) && (finding as Record<string, unknown>)[field] !== undefined)) return false;
    if (finding.remediation_guidance_ref !== undefined && !refMatches(finding.remediation_guidance_ref, /^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if (finding.customer_status_record_ref !== undefined && !refMatches(finding.customer_status_record_ref, /^customer_status:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if (finding.current_customer_remediation_status !== undefined && !Object.prototype.hasOwnProperty.call(CUSTOMER_STATUS_LABELS, String(finding.current_customer_remediation_status))) return false;
    if (finding.validation_path_ref !== undefined && !refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if (finding.accepted_risk_record_ref !== undefined && !refMatches(finding.accepted_risk_record_ref, /^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if (finding.false_positive_record_ref !== undefined && !refMatches(finding.false_positive_record_ref, /^false_positive:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if ((finding.accepted_risk_record_ref !== undefined || finding.false_positive_record_ref !== undefined) && finding.eligibility_state !== "out_of_scope" && !(refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u) && finding.requested_verification_type !== "follow_up_commit")) return false;
    if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && !refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
    if ((finding.eligibility_state === "blocked_pending_validation_path" || finding.eligibility_state === "requires_additional_agreement") && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) return false;
    if (finding.reviewer_validation_script_refs !== undefined) {
      if (!Array.isArray(finding.reviewer_validation_script_refs) || !finding.reviewer_validation_script_refs.every((ref) => refMatches(ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u))) return false;
      if (new Set(finding.reviewer_validation_script_refs).size !== finding.reviewer_validation_script_refs.length) return false;
    }
  }
  if (scope.included_script_allocation.included_slots.length > 3) return false;
  const slotNumbers = new Set<number>();
  const allocationScriptRefs = new Set<string>();
  const allAllocationEntries = [...scope.included_script_allocation.included_slots, ...scope.included_script_allocation.additional_script_candidates];
  for (const slot of scope.included_script_allocation.included_slots) {
    if (!isRecord(slot) || typeof slot.slot !== "number" || !Number.isInteger(slot.slot) || slot.slot < 1 || slot.slot > 3 || slotNumbers.has(slot.slot) || !refMatches(slot.finding_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(slot.validation_script_ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u)) {
      return false;
    }
    slotNumbers.add(slot.slot);
  }
  for (const candidate of scope.included_script_allocation.additional_script_candidates) {
    if (!isRecord(candidate) || candidate.pricing_posture !== "pricing_tbd" || !refMatches(candidate.finding_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(candidate.validation_script_ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u) || typeof candidate.reason !== "string" || !/pricing\s*tbd/iu.test(candidate.reason)) {
      return false;
    }
  }
  for (const entry of allAllocationEntries) {
    if (!isRecord(entry) || typeof entry.finding_ref !== "string" || !selectedFindingRefs.has(entry.finding_ref)) {
      return false;
    }
    const selectedFinding = selectedFindings.find((finding) => finding.review_finding_draft_ref === entry.finding_ref);
    const selectedScriptRefs = new Set(Array.isArray(selectedFinding?.reviewer_validation_script_refs) ? selectedFinding.reviewer_validation_script_refs : []);
    if (typeof entry.validation_script_ref !== "string" || allocationScriptRefs.has(entry.validation_script_ref) || !selectedScriptRefs.has(entry.validation_script_ref)) {
      return false;
    }
    allocationScriptRefs.add(entry.validation_script_ref);
  }
  return allocationScriptRefs.size === selectedFindings.flatMap((finding) => Array.isArray(finding.reviewer_validation_script_refs) ? finding.reviewer_validation_script_refs : []).length;
}

function refMatches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isIsoUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}

function verificationScopeWindowIsValid(startValue: unknown, recordedValue: unknown, deadlineValue: unknown): boolean {
  const start = parseUtcTimestampNs(startValue);
  const recorded = parseUtcTimestampNs(recordedValue);
  const deadline = parseUtcTimestampNs(deadlineValue);
  if (start === undefined || recorded === undefined || deadline === undefined) return false;
  const maxWindowNs = 30n * 24n * 60n * 60n * 1_000_000_000n;
  const deadlineDelta = deadline - start;
  return deadlineDelta > 0n && deadlineDelta <= maxWindowNs && recorded >= start && recorded <= deadline;
}

function parseUtcTimestampNs(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !isIsoUtcTimestamp(value)) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/u.exec(value);
  if (match === null) return undefined;
  const wholeSeconds = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(wholeSeconds)) return undefined;
  const fractional = BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  return BigInt(wholeSeconds) * 1_000_000n + fractional;
}

function verificationScopeDeadlineBasisIsUnsafe(startBasis: unknown, limitations: unknown): boolean {
  const basis = typeof startBasis === "string" ? startBasis.toLowerCase() : "";
  const limitationText = Array.isArray(limitations) ? limitations.filter((value): value is string => typeof value === "string").join(" ").toLowerCase() : "";
  const uncertainBasis = /unavailable|unknown|estimated|fallback|basis used/u.test(basis);
  const impliesSla = /(?:guaranteed|committed|assured|contractual|promised).{0,40}(?:within|in|delivery|deadline)?\s*30\s*days|30\s*days.{0,40}(?:guaranteed|committed|assured|contractual|promised|delivery|deadline)|\b30-day\s*sla\b|\bcontractual\s+30-day\s+sla\b|\bpromised\s+delivery\s+within\s+30\s+days\b/u.test(`${basis} ${limitationText}`);
  return impliesSla || (uncertainBasis && !/basis|deadline|included pass|30 days|sla/u.test(limitationText));
}

function verificationScopeReasonHasSpecificNextStep(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  if (/\b(?:no|not|without|do not|does not|cannot)\b.{0,40}\b(?:validation path|formal path|next step|additional agreement|obtain|request|record|agree|confirm)\b/u.test(normalized)) {
    return false;
  }
  return /\b(?:obtain|request|record|agree|confirm|create|provide|submit|document|schedule)\b.{0,80}\b(?:validation path|formal path|next step|additional agreement|pricing\s*tbd|customer approval|order form|scope)\b|\b(?:validation path|formal path|additional agreement|pricing\s*tbd)\b.{0,80}\b(?:required|needed|before|must|next)\b/u.test(normalized);
}

function isMeaningfulVerificationScopeReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).filter(Boolean).length >= 3;
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

function sectionView(id: VerificationPassScopeSectionId, title: string, summary: string, items: IdentityRef[], body: unknown[], actions: AccessibleAction[]): VerificationPassScopeSectionView {
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

function item(label: string, value: unknown): IdentityRef {
  return {
    label: sanitizeVisibleText(label),
    value: visibleOrDefault(value, "unavailable")
  };
}

function recordContainsForbiddenCopy(value: unknown): boolean {
  if (typeof value === "string") {
    return sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined || claimSafePositiveClosurePhrase(value) !== undefined;
  }
  if (Array.isArray(value)) {
    return value.some((itemValue) => recordContainsForbiddenCopy(itemValue));
  }
  if (isRecord(value)) {
    return Object.values(value).some((itemValue) => recordContainsForbiddenCopy(itemValue));
  }
  return false;
}

function visibleList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => visibleOrDefault(value, "")).filter(Boolean);
}

function listValues<T = string>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) as T[] : [];
}

function visibleOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? sanitizeVisibleText(value) : fallback;
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
  return raw.replace(invisibleControlPattern, "").replace(/\s+/gu, " ").trim();
}

function isAudience(value: unknown): value is VerificationPassScopeAudience {
  return value === "customer" || value === "evidence_consumer" || value === "reviewer";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
