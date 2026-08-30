import { customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "./claim-safety.js";

/**
 * C6-11: faithful TypeScript port of `validateCustomerFacingFindingRecordSemantics`
 * in `scripts/lib/protocol-utils.mjs`. UI and static-bundle must not import that
 * script module, so the same rules live here as the runtime source both
 * projectors and the script adapter can be checked against via fixture-driven
 * convergence tests. Unrecognizable input degrades to no issues (schema owns
 * that layer); do not throw.
 */

export type CustomerFacingFindingRecordSemanticIssue =
  | "customer_facing_finding_source_class_required"
  | "customer_facing_finding_visibility_required"
  | "customer_facing_finding_status_separation_required"
  | "customer_facing_finding_reference_mismatch"
  | "customer_facing_finding_evidence_ref_required"
  | "customer_facing_finding_guidance_actionable_details_required"
  | "customer_facing_finding_guidance_insufficient_evidence_reason_required"
  | "customer_facing_finding_guidance_next_step_required"
  | "customer_facing_finding_verification_reference_required"
  | "customer_facing_finding_future_outcome_reference_required"
  | "customer_facing_finding_outcome_section_required"
  | "customer_facing_finding_outcome_details_required"
  | "customer_facing_finding_outcome_export_required"
  | "customer_facing_finding_customer_notes_export_forbidden"
  | "customer_facing_finding_due_date_invalid"
  | "customer_facing_finding_script_pricing_tbd_required"
  | "customer_facing_finding_raw_source_text_forbidden"
  | "customer_facing_finding_claim_unsafe_text_forbidden";

const CUSTOMER_FACING_FINDING_TEXT_FIELDS = [
  "expert_classification.rationale_summary",
  "expert_classification.criteria_summary",
  "expert_classification.limitations",
  "evidence_basis.limitations",
  "reviewer_remediation_guidance.exploitability_rationale_summary",
  "reviewer_remediation_guidance.suggested_remediation_summary",
  "reviewer_remediation_guidance.validation_step_summary",
  "reviewer_remediation_guidance.next_step_summary",
  "reviewer_remediation_guidance.validation_path_summary",
  "reviewer_remediation_guidance.validation_path_ref",
  "reviewer_remediation_guidance.insufficient_evidence_reason",
  "reviewer_remediation_guidance.limitations",
  "customer_remediation_status.owner",
  "customer_remediation_status.target_state",
  "customer_remediation_status.customer_notes_summary",
  "verification_state.summary",
  "validation_paths.required_evidence",
  "validation_paths.steps",
  "validation_paths.expected_result",
  "validation_paths.limitations",
  "validation_paths.output_attachment_instructions",
  "validation_paths.target",
  "validation_paths.authorization_assumption",
  "validation_paths.method",
  "validation_paths.safety_constraints",
  "validation_paths.evidence_artifacts_to_collect",
  "reviewer_validation_scripts.purpose",
  "reviewer_validation_scripts.prerequisites",
  "reviewer_validation_scripts.execution_steps",
  "reviewer_validation_scripts.expected_output",
  "reviewer_validation_scripts.safety_notes",
  "reviewer_validation_scripts.output_attachment_instructions",
  "reviewer_validation_scripts.script_content",
  "reviewer_validation_scripts.pricing_note",
  "accepted_risk_outcome.evidence_basis_summary",
  "accepted_risk_outcome.customer_acceptance_summary",
  "accepted_risk_outcome.risk_owner",
  "accepted_risk_outcome.scope_of_acceptance",
  "accepted_risk_outcome.limitations",
  "false_positive_outcome.evidence_basis_summary",
  "false_positive_outcome.rationale_summary",
  "false_positive_outcome.limitations"
] as const;

export function customerFacingFindingRecordSemanticIssues(value: unknown): CustomerFacingFindingRecordSemanticIssue[] {
  const issues: CustomerFacingFindingRecordSemanticIssue[] = [];
  if (!isCustomerFacingFindingRecordLike(value)) {
    return issues;
  }

  const expert = asRecord(value.expert_classification) ?? {};
  const guidance = asRecord(value.reviewer_remediation_guidance) ?? {};
  const customerStatus = asRecord(value.customer_remediation_status) ?? {};
  const verification = asRecord(value.verification_state) ?? {};
  const future = asRecord(value.future_outcome_visibility) ?? {};

  if (value.source_derived_class !== "retained_review_artifact") {
    issues.push("customer_facing_finding_source_class_required");
  }
  if (value.visibility !== "customer_facing") {
    issues.push("customer_facing_finding_visibility_required");
  }
  if (typeof value.ambiguous_status === "string" || typeof value.status === "string" || typeof value.remediation_status === "string") {
    issues.push("customer_facing_finding_status_separation_required");
  }
  if (typeof value.classification_record_ref === "string" && expert.classification_record_ref !== value.classification_record_ref) {
    issues.push("customer_facing_finding_reference_mismatch");
  }
  if (typeof value.remediation_guidance_ref === "string" && guidance.remediation_guidance_ref !== value.remediation_guidance_ref) {
    issues.push("customer_facing_finding_reference_mismatch");
  }
  if ((typeof value.verification_record_ref === "string" || typeof verification.verification_record_ref === "string") && verification.verification_record_ref !== value.verification_record_ref) {
    issues.push("customer_facing_finding_reference_mismatch");
  }
  const acceptedRiskTopLevelMatches = future.accepted_risk_record_ref === value.accepted_risk_record_ref;
  const falsePositiveTopLevelMatches = future.false_positive_record_ref === value.false_positive_record_ref;
  if ((typeof value.accepted_risk_record_ref === "string" || typeof future.accepted_risk_record_ref === "string") && !acceptedRiskTopLevelMatches) {
    issues.push("customer_facing_finding_reference_mismatch");
  }
  if ((typeof value.false_positive_record_ref === "string" || typeof future.false_positive_record_ref === "string") && !falsePositiveTopLevelMatches) {
    issues.push("customer_facing_finding_reference_mismatch");
  }

  const evidenceBasis = asRecord(value.evidence_basis);
  const evidenceRefs = evidenceBasis !== undefined && Array.isArray(evidenceBasis.evidence_refs) ? evidenceBasis.evidence_refs : [];
  if (evidenceRefs.length === 0) {
    issues.push("customer_facing_finding_evidence_ref_required");
  }
  if (typeof customerStatus.latest_status_record_ref === "string") {
    const statusRefs = Array.isArray(value.customer_status_record_refs) ? value.customer_status_record_refs : [];
    if (!statusRefs.includes(customerStatus.latest_status_record_ref)) {
      issues.push("customer_facing_finding_reference_mismatch");
    }
  }

  if (guidance.guidance_status === "actionable_guidance_provided") {
    const requiresExploitabilityRationale = expert.classification === "likely" || expert.classification === "confirmed";
    if (
      !isMeaningfulRemediationText(guidance.suggested_remediation_summary) ||
      !isMeaningfulRemediationText(guidance.validation_step_summary) ||
      (requiresExploitabilityRationale && !isMeaningfulRemediationText(guidance.exploitability_rationale_summary))
    ) {
      issues.push("customer_facing_finding_guidance_actionable_details_required");
    }
  }
  if (guidance.guidance_status === "limited_guidance_requires_validation" || guidance.guidance_status === "guidance_unavailable_from_submitted_evidence") {
    if (!isMeaningfulRemediationText(guidance.insufficient_evidence_reason)) {
      issues.push("customer_facing_finding_guidance_insufficient_evidence_reason_required");
    }
    if (!isMeaningfulRemediationText(guidance.next_step_summary) && !isMeaningfulRemediationText(guidance.validation_path_summary) && typeof guidance.validation_path_ref !== "string") {
      issues.push("customer_facing_finding_guidance_next_step_required");
    }
  }
  if ((verification.status === "verification_complete" || verification.status === "verified_with_evidence") && typeof verification.verification_record_ref !== "string") {
    issues.push("customer_facing_finding_verification_reference_required");
  }

  const acceptedRiskFutureRefConsistent = future.accepted_risk_visible === (typeof future.accepted_risk_record_ref === "string");
  const falsePositiveFutureRefConsistent = future.false_positive_visible === (typeof future.false_positive_record_ref === "string");
  if (!acceptedRiskFutureRefConsistent) {
    issues.push("customer_facing_finding_future_outcome_reference_required");
  }
  if (!falsePositiveFutureRefConsistent) {
    issues.push("customer_facing_finding_future_outcome_reference_required");
  }

  const acceptedRiskOutcome = asRecord(value.accepted_risk_outcome);
  const falsePositiveOutcome = asRecord(value.false_positive_outcome);
  if (future.accepted_risk_visible === true && acceptedRiskFutureRefConsistent && acceptedRiskTopLevelMatches && typeof value.accepted_risk_record_ref === "string") {
    if (acceptedRiskOutcome === undefined || acceptedRiskOutcome.accepted_risk_record_ref !== future.accepted_risk_record_ref || acceptedRiskOutcome.accepted_risk_record_ref !== value.accepted_risk_record_ref) {
      issues.push("customer_facing_finding_outcome_section_required");
    }
  } else if (acceptedRiskOutcome !== undefined && future.accepted_risk_visible !== true) {
    issues.push("customer_facing_finding_outcome_section_required");
  }
  if (future.false_positive_visible === true && falsePositiveFutureRefConsistent && falsePositiveTopLevelMatches && typeof value.false_positive_record_ref === "string") {
    if (falsePositiveOutcome === undefined || falsePositiveOutcome.false_positive_record_ref !== future.false_positive_record_ref || falsePositiveOutcome.false_positive_record_ref !== value.false_positive_record_ref) {
      issues.push("customer_facing_finding_outcome_section_required");
    }
  } else if (falsePositiveOutcome !== undefined && future.false_positive_visible !== true) {
    issues.push("customer_facing_finding_outcome_section_required");
  }

  if (acceptedRiskOutcome !== undefined) {
    if (!Array.isArray(acceptedRiskOutcome.evidence_refs) || acceptedRiskOutcome.evidence_refs.length === 0 || !isMeaningfulRemediationText(acceptedRiskOutcome.evidence_basis_summary) || !isMeaningfulRemediationText(acceptedRiskOutcome.customer_acceptance_summary)) {
      issues.push("customer_facing_finding_outcome_details_required");
    }
    if (acceptedRiskOutcome.evidence_consumer_export !== "include" && acceptedRiskOutcome.evidence_consumer_export !== "exclude") {
      issues.push("customer_facing_finding_outcome_export_required");
    }
  }
  if (falsePositiveOutcome !== undefined) {
    if (!Array.isArray(falsePositiveOutcome.evidence_refs) || falsePositiveOutcome.evidence_refs.length === 0 || !isMeaningfulRemediationText(falsePositiveOutcome.evidence_basis_summary) || !isMeaningfulRemediationText(falsePositiveOutcome.rationale_summary)) {
      issues.push("customer_facing_finding_outcome_details_required");
    }
    if (falsePositiveOutcome.actor_category !== "reviewer") {
      issues.push("customer_facing_finding_outcome_details_required");
    }
    if (falsePositiveOutcome.evidence_consumer_export !== "include" && falsePositiveOutcome.evidence_consumer_export !== "exclude") {
      issues.push("customer_facing_finding_outcome_export_required");
    }
  }
  if (customerStatus.customer_notes_visible === false && typeof customerStatus.customer_notes_summary === "string") {
    issues.push("customer_facing_finding_customer_notes_export_forbidden");
  }
  if (typeof customerStatus.due_date === "string" && !isIsoCalendarDate(customerStatus.due_date)) {
    issues.push("customer_facing_finding_due_date_invalid");
  }

  const validationPaths = Array.isArray(value.validation_paths)
    ? value.validation_paths.filter((pathRecord): pathRecord is Record<string, unknown> => asRecord(pathRecord) !== undefined)
    : [];
  const validationScripts = Array.isArray(value.reviewer_validation_scripts)
    ? value.reviewer_validation_scripts.filter((script): script is Record<string, unknown> => asRecord(script) !== undefined)
    : [];
  const validationScriptsByRef = new Map(validationScripts
    .filter((script) => typeof script.validation_script_ref === "string")
    .map((script) => [script.validation_script_ref as string, script]));
  const validationPathsByRef = new Map(validationPaths
    .filter((pathRecord) => typeof pathRecord.validation_path_ref === "string")
    .map((pathRecord) => [pathRecord.validation_path_ref as string, pathRecord]));

  for (const pathRecord of validationPaths) {
    const hasRemoteFields = pathRecord.target !== undefined || pathRecord.authorization_assumption !== undefined || pathRecord.method !== undefined || pathRecord.safety_constraints !== undefined || pathRecord.evidence_artifacts_to_collect !== undefined;
    if (pathRecord.path_type === "remote_dynamic_testing") {
      if (!isMeaningfulRemediationText(pathRecord.target) || !isMeaningfulRemediationText(pathRecord.authorization_assumption) || !isMeaningfulRemediationText(pathRecord.method) || !isMeaningfulRemediationText(pathRecord.safety_constraints) || !Array.isArray(pathRecord.evidence_artifacts_to_collect) || pathRecord.evidence_artifacts_to_collect.length === 0) {
        issues.push("customer_facing_finding_reference_mismatch");
      }
    } else if (hasRemoteFields) {
      issues.push("customer_facing_finding_reference_mismatch");
    }
    const scriptRefs = Array.isArray(pathRecord.reviewer_validation_script_refs) ? pathRecord.reviewer_validation_script_refs : [];
    if (pathRecord.path_type === "customer_run_script") {
      if (scriptRefs.length === 0) {
        issues.push("customer_facing_finding_reference_mismatch");
      }
      for (const ref of scriptRefs) {
        const script = typeof ref === "string" ? validationScriptsByRef.get(ref) : undefined;
        if (script === undefined || script.validation_path_ref !== pathRecord.validation_path_ref) {
          issues.push("customer_facing_finding_reference_mismatch");
          break;
        }
      }
    } else if (pathRecord.reviewer_validation_script_refs !== undefined) {
      issues.push("customer_facing_finding_reference_mismatch");
    }
    if (pathRecord.path_type === "manual_steps" && !isMeaningfulRemediationText(pathRecord.output_attachment_instructions)) {
      issues.push("customer_facing_finding_reference_mismatch");
    }
  }

  for (const script of validationScripts) {
    const pathRecord = typeof script.validation_path_ref === "string" ? validationPathsByRef.get(script.validation_path_ref) : undefined;
    const pathScriptRefs = Array.isArray(pathRecord?.reviewer_validation_script_refs) ? pathRecord.reviewer_validation_script_refs : [];
    if (pathRecord === undefined || pathRecord.path_type !== "customer_run_script" || !pathScriptRefs.includes(script.validation_script_ref)) {
      issues.push("customer_facing_finding_reference_mismatch");
    }
    if (script.script_package_status === "additional_script_candidate_pricing_tbd") {
      const pricingCopy = [
        script.pricing_note,
        script.purpose,
        script.prerequisites,
        script.execution_steps,
        script.expected_output,
        script.safety_notes,
        script.output_attachment_instructions,
        script.script_content
      ].filter((item): item is string => typeof item === "string").join(" ");
      if (!/pricing\s+tbd/iu.test(pricingCopy)) {
        issues.push("customer_facing_finding_script_pricing_tbd_required");
      }
    }
  }

  for (const field of CUSTOMER_FACING_FINDING_TEXT_FIELDS) {
    collectTextViolations(valueAtPath(value, field), issues);
  }

  return issues;
}

function isCustomerFacingFindingRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof (value as Record<string, unknown>).customer_facing_finding_record_id === "string" || (value as Record<string, unknown>).expert_classification !== undefined)
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isMeaningfulRemediationText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length >= 12;
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return false;
  }
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function collectTextViolations(value: unknown, issues: CustomerFacingFindingRecordSemanticIssue[]): void {
  if (typeof value === "string") {
    if (sourceTextForbiddenPhrase(value) !== undefined) {
      issues.push("customer_facing_finding_raw_source_text_forbidden");
      return;
    }
    if (customerVisibleTextForbidden(value) !== undefined) {
      issues.push("customer_facing_finding_claim_unsafe_text_forbidden");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextViolations(item, issues);
    }
  }
}

function valueAtPath(value: unknown, dottedPath: string): unknown {
  return valueAtPathParts(value, dottedPath.split("."));
}

function valueAtPathParts(value: unknown, parts: string[]): unknown {
  if (parts.length === 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => valueAtPathParts(item, parts));
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const [part, ...remaining] = parts;
  if (part === undefined) {
    return value;
  }
  return valueAtPathParts((value as Record<string, unknown>)[part], remaining);
}
