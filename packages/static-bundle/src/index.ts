import { claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerFacingFindingRecordSemanticIssues, customerVisibleTextForbidden, snapshotJsonData, sourceTextForbiddenPhrase, validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { isProtocolManifest } from "./signed-static-bundle.js";
export * from "./signed-static-bundle.js";
export * from "./static-portal.js";
export * from "./supporting-evidence-mapping.js";
export const workspaceName = "@onevps/static-bundle";
export const workspaceScope = "static-bundle-outcome-projection-scaffold";

export type StaticBundleOutcomeSection = {
  kind: "accepted_risk" | "false_positive";
  recordRef: string;
  title: string;
  actorCategory: string;
  evidenceBasisSummary: string;
  evidenceRefs: string[];
  body: string[];
  evidenceConsumerExport: "include" | "exclude";
};

export type StaticBundleFindingOutcomeProjection = {
  kind: "static-bundle-finding-outcomes";
  reviewId: string;
  findingRef: string;
  outcomeSections: StaticBundleOutcomeSection[];
};

export type StaticBundleVerificationAddendumFinding = {
  findingRef: string;
  classificationRecordRef: string;
  currentClassification: string;
  verificationStatus: string;
  verificationRecordRef: string;
  verificationEvidenceRecordRefs: string[];
  reviewerActorCategory: "reviewer";
  timestamp: string;
  summary: string;
  remainingLimitations: string[];
  remediationGuidanceRef?: string;
  validationPathRef?: string;
  acceptedRiskRecordRef?: string;
  falsePositiveRecordRef?: string;
  nextStepSummary?: string;
  surfaceLinks: Array<{ label: string; href: string; printLabel: string }>;
};

export type StaticBundleVerificationAddendumProjection = {
  kind: "static-bundle-verification-addendum";
  addendumRef: string;
  reviewId: string;
  reviewScopeRef: string;
  verificationPassRef: string;
  verificationScopeRef: string;
  selectedCommitRef: string;
  repositoryIdentity: string;
  generatedAt: string;
  findings: StaticBundleVerificationAddendumFinding[];
  retainedEvidence: Array<{ artifactRef: string; sourceDerivedClass: string; recordedAt: string; href: string }>;
  deletedEvidence: Array<{ artifactRef: string; deletionEvidenceRef: string; deletionTimestamp: string; deletionVerificationStatus: string }>;
  historyLinks: Array<{ ref: string; href: string; printLabel: string }>;
  limitations: string[];
  nextStepSummary?: string;
  finalizationState: "finalized" | "not_finalized";
  disclosure: string[];
};

export function projectStaticBundleVerificationAddendum(addendum: unknown, manifest: unknown): StaticBundleVerificationAddendumProjection | null {
  if (!verificationAddendumShapeIsSafe(addendum)) {
    return null;
  }
  // C6-43: links were previously synthesized from typed refs alone, with no
  // manifest asset registry to check against -- they could target files
  // never actually packaged. A real, verified manifest is now required, and
  // retained-evidence links resolve only against its own file list.
  if (!isProtocolManifest(manifest) || manifest.review_id !== addendum.review_id) {
    return null;
  }
  const manifestArtifactRefs = new Set(manifest.files.map((file) => file.artifact_ref));
  if (addendum.retained_evidence.some((entry) => !manifestArtifactRefs.has(entry.artifact_ref))) {
    return null;
  }
  // A finalized (immutable) addendum must not present a "deleted" evidence
  // claim that was never actually verified -- pending/unavailable deletion
  // status is not a fact for a finalized, static output to assert.
  if (addendum.finalization_state === "finalized" && addendum.deleted_evidence.some((entry) => entry.deletion_verification_status !== "verified")) {
    return null;
  }
  return {
    kind: "static-bundle-verification-addendum",
    addendumRef: addendum.verification_addendum_id,
    reviewId: addendum.review_id,
    reviewScopeRef: addendum.review_scope_ref,
    verificationPassRef: addendum.verification_pass_id,
    verificationScopeRef: addendum.verification_pass_ref,
    selectedCommitRef: `git_commit:${addendum.selected_commit.commit_sha}`,
    repositoryIdentity: addendum.repository_identity,
    generatedAt: addendum.generated_at,
    findings: addendum.findings.map((finding) => ({
      findingRef: finding.review_finding_draft_ref,
      classificationRecordRef: finding.classification_record_ref,
      currentClassification: finding.current_classification,
      verificationStatus: finding.verification_status,
      verificationRecordRef: finding.verification_record_ref,
      verificationEvidenceRecordRefs: [...finding.verification_evidence_record_refs],
      reviewerActorCategory: "reviewer",
      timestamp: finding.timestamp,
      summary: finding.summary,
      remainingLimitations: [...finding.remaining_limitations],
      ...(finding.remediation_guidance_ref === undefined ? {} : { remediationGuidanceRef: finding.remediation_guidance_ref }),
      ...(finding.validation_path_ref === undefined ? {} : { validationPathRef: finding.validation_path_ref }),
      ...(finding.accepted_risk_record_ref === undefined ? {} : { acceptedRiskRecordRef: finding.accepted_risk_record_ref }),
      ...(finding.false_positive_record_ref === undefined ? {} : { falsePositiveRecordRef: finding.false_positive_record_ref }),
      ...(finding.next_step_summary === undefined ? {} : { nextStepSummary: finding.next_step_summary }),
      surfaceLinks: findingSurfaceLinks(finding)
    })),
    retainedEvidence: addendum.retained_evidence.map((entry) => ({ artifactRef: entry.artifact_ref, sourceDerivedClass: entry.source_derived_class, recordedAt: entry.recorded_at, href: staticRelativeLink("artifacts", entry.artifact_ref) })),
    deletedEvidence: addendum.deleted_evidence.map((entry) => ({ artifactRef: entry.artifact_ref, deletionEvidenceRef: entry.deletion_evidence_ref, deletionTimestamp: entry.deletion_timestamp, deletionVerificationStatus: entry.deletion_verification_status })),
    historyLinks: addendum.history_refs.map((ref) => {
      const href = staticRelativeLink("history", ref);
      return { ref, href, printLabel: `Review history event: ${href}` };
    }),
    limitations: [...addendum.limitations],
    ...(addendum.next_step_summary === undefined ? {} : { nextStepSummary: addendum.next_step_summary }),
    finalizationState: addendum.finalization_state,
    disclosure: [
      "This standalone addendum preserves the original review scope, selected commit, bounded verification outcomes, evidence lifecycle state, linked history, and stated limitations.",
      "Pending or customer-side-validation states are not presented as success outcomes."
    ]
  };
}

export type StaticBundleVerificationScopeFinding = {
  findingRef: string;
  classificationRecordRef: string;
  currentClassification: string;
  remediationStatus: string;
  requestedVerificationType: string;
  eligibilityState: string;
  eligibilityReason: string;
  limitations: string[];
  acceptedRiskRecordRef?: string;
  falsePositiveRecordRef?: string;
};

export type StaticBundleVerificationScopeProjection = {
  kind: "static-bundle-verification-pass-scope";
  reviewId: string;
  verificationPassRef: string;
  passDeadline: string;
  selectedFindings: StaticBundleVerificationScopeFinding[];
  includedScriptSlots: string[];
  additionalScriptCandidates: string[];
  limitations: string[];
  disclosure: string[];
};

export function projectStaticBundleVerificationScope(scope: unknown): StaticBundleVerificationScopeProjection | null {
  if (!scopeShapeIsSafe(scope)) {
    return null;
  }
  const selectedFindings = scope.selected_findings;
  const includedSlots = scope.included_script_allocation.included_slots;
  const additionalCandidates = scope.included_script_allocation.additional_script_candidates;
  return {
    kind: "static-bundle-verification-pass-scope",
    reviewId: visibleOrDefault(scope.review_id, "review:unavailable"),
    verificationPassRef: visibleOrDefault(scope.verification_pass_id, "verification_pass:unavailable"),
    passDeadline: visibleOrDefault(scope.pass_deadline, "deadline unavailable"),
    selectedFindings: selectedFindings.map((finding) => ({
      findingRef: visibleOrDefault(finding.review_finding_draft_ref, "review_finding_draft:unavailable"),
      classificationRecordRef: visibleOrDefault(finding.classification_record_ref, "classification_record:unavailable"),
      currentClassification: visibleOrDefault(finding.current_classification, "unknown"),
      remediationStatus: visibleOrDefault(finding.current_customer_remediation_status, "unavailable"),
      requestedVerificationType: visibleOrDefault(finding.requested_verification_type, "unknown"),
      eligibilityState: visibleOrDefault(finding.eligibility_state, "unknown"),
      eligibilityReason: visibleOrDefault(finding.eligibility_reason, "Eligibility reason unavailable"),
      limitations: listValues(finding.limitations),
      ...(typeof finding.accepted_risk_record_ref === "string" ? { acceptedRiskRecordRef: finding.accepted_risk_record_ref } : {}),
      ...(typeof finding.false_positive_record_ref === "string" ? { falsePositiveRecordRef: finding.false_positive_record_ref } : {})
    })),
    includedScriptSlots: includedSlots.map((slot) => `included slot ${String(slot.slot ?? "unavailable")}: ${visibleOrDefault(slot.validation_script_ref, "validation_script:unavailable")}`),
    additionalScriptCandidates: additionalCandidates.map((candidate) => `${visibleOrDefault(candidate.validation_script_ref, "validation_script:unavailable")}: pricing TBD`),
    limitations: listValues(scope.limitations),
    disclosure: [
      "This verification pass is limited to selected findings, submitted follow-up evidence, and recorded validation criteria.",
      "It is not a complete fresh secure-code review and does not record fixed, remediated, resolved, or verification-complete status."
    ]
  };
}

export function projectStaticBundleOutcomeSections(record: unknown): StaticBundleFindingOutcomeProjection | null {
  if (!isRecord(record) || record.visibility !== "customer_facing" || record.evidence_consumer_export !== "include") {
    return null;
  }
  if (!customerFacingFindingSchemaValid(record)) {
    return null;
  }
  if (customerFacingFindingRecordSemanticIssues(record).length > 0) {
    return null;
  }
  if (recordContainsForbiddenCopy(record)) {
    return null;
  }
  const outcomeSections: StaticBundleOutcomeSection[] = [];
  const future = isRecord(record.future_outcome_visibility) ? record.future_outcome_visibility : {};
  const acceptedRisk = record.accepted_risk_outcome;
  if (
    acceptedRiskOutcomeShapeIsValid(acceptedRisk) &&
    acceptedRisk.evidence_consumer_export === "include" &&
    future.accepted_risk_visible === true &&
    typeof record.accepted_risk_record_ref === "string" &&
    record.accepted_risk_record_ref === future.accepted_risk_record_ref &&
    record.accepted_risk_record_ref === acceptedRisk.accepted_risk_record_ref
  ) {
    outcomeSections.push({
      kind: "accepted_risk",
      recordRef: visibleOrDefault(acceptedRisk.accepted_risk_record_ref, "accepted_risk:unavailable"),
      title: "Accepted risk",
      actorCategory: visibleOrDefault(acceptedRisk.actor_category, "unknown"),
      evidenceBasisSummary: visibleOrDefault(acceptedRisk.evidence_basis_summary, "Evidence basis unavailable"),
      evidenceRefs: listValues(acceptedRisk.evidence_refs),
      body: visibleList([
        "Customer approved carrying residual risk. This does not mark remediation, verification, audit approval, or control fulfillment.",
        acceptedRisk.customer_acceptance_summary,
        acceptedRisk.scope_of_acceptance,
        ...listValues(acceptedRisk.limitations)
      ]),
      evidenceConsumerExport: "include"
    });
  }
  const falsePositive = record.false_positive_outcome;
  if (
    falsePositiveOutcomeShapeIsValid(falsePositive) &&
    falsePositive.evidence_consumer_export === "include" &&
    future.false_positive_visible === true &&
    typeof record.false_positive_record_ref === "string" &&
    record.false_positive_record_ref === future.false_positive_record_ref &&
    record.false_positive_record_ref === falsePositive.false_positive_record_ref
  ) {
    outcomeSections.push({
      kind: "false_positive",
      recordRef: visibleOrDefault(falsePositive.false_positive_record_ref, "false_positive:unavailable"),
      title: "False positive",
      actorCategory: "reviewer",
      evidenceBasisSummary: visibleOrDefault(falsePositive.evidence_basis_summary, "Evidence basis unavailable"),
      evidenceRefs: listValues(falsePositive.evidence_refs),
      body: visibleList([
        "Reviewer recorded a false-positive outcome while preserving the finding and evidence trail.",
        falsePositive.rationale_summary,
        ...listValues(falsePositive.limitations)
      ]),
      evidenceConsumerExport: "include"
    });
  }
  if (outcomeSections.length === 0) {
    return null;
  }
  return {
    kind: "static-bundle-finding-outcomes",
    reviewId: visibleOrDefault(record.review_id, "review:unavailable"),
    findingRef: visibleOrDefault(record.review_finding_draft_ref, "review_finding_draft:unavailable"),
    outcomeSections
  };
}

type StaticVerificationAddendumShape = {
  verification_addendum_id: string;
  review_id: string;
  review_scope_ref: string;
  verification_pass_id: string;
  verification_pass_ref: string;
  selected_commit: { commit_sha: string; source_control_system: "git" };
  repository_identity: string;
  generated_at: string;
  findings: Array<{
    review_finding_draft_ref: string;
    classification_record_ref: string;
    current_classification: string;
    verification_status: string;
    reviewer_actor_category: "reviewer";
    verification_record_ref: string;
    verification_evidence_record_refs: string[];
    timestamp: string;
    summary: string;
    remaining_limitations: string[];
    remediation_guidance_ref?: string;
    validation_path_ref?: string;
    accepted_risk_record_ref?: string;
    false_positive_record_ref?: string;
    next_step_summary?: string;
  }>;
  retained_evidence: Array<{ artifact_ref: string; source_derived_class: string; recorded_at: string }>;
  deleted_evidence: Array<{ artifact_ref: string; deletion_evidence_ref: string; deletion_timestamp: string; deletion_verification_status: string }>;
  history_refs: string[];
  limitations: string[];
  next_step_summary?: string;
  finalization_state: "finalized" | "not_finalized";
};

function verificationAddendumShapeIsSafe(value: unknown): value is StaticVerificationAddendumShape {
  const scan = scanStaticJsonSafety(value);
  if (!scan.valid || scan.payloadFieldPresent || !isRecord(value) || value.protocol_version !== "codeattest.v0" || value.visibility !== "customer_facing" || value.source_derived_class !== "retained_review_artifact") return false;
  if (!hasOnlyKeys(value, ["protocol_version", "verification_addendum_id", "review_id", "verification_pass_id", "review_scope_ref", "verification_pass_ref", "selected_commit", "repository_identity", "generated_at", "findings", "retained_evidence", "deleted_evidence", "history_refs", "limitations", "next_step_summary", "finalization_state", "visibility", "source_derived_class"])) return false;
  if (!refMatches(value.verification_addendum_id, /^verification_addendum:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(value.review_id, /^review:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(value.verification_pass_id, /^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$/u) || value.verification_pass_ref !== value.verification_pass_id) return false;
  if (!refMatches(value.review_scope_ref, /^sha256:[a-f0-9]{64}$/u) || !refMatches(value.repository_identity, /^sha256:[a-f0-9]{64}$/u) || !isIsoUtcTimestamp(value.generated_at)) return false;
  if (!isRecord(value.selected_commit) || !hasOnlyKeys(value.selected_commit, ["commit_sha", "source_control_system"]) || !refMatches(value.selected_commit.commit_sha, /^[a-f0-9]{40}$/u) || value.selected_commit.source_control_system !== "git") return false;
  if (!Array.isArray(value.findings) || value.findings.length === 0 || value.findings.some((finding) => !verificationAddendumFindingIsSafe(finding))) return false;
  if (!Array.isArray(value.retained_evidence) || value.retained_evidence.some((entry) => !retainedAddendumEvidenceIsSafe(entry)) || !Array.isArray(value.deleted_evidence) || value.deleted_evidence.some((entry) => !deletedAddendumEvidenceIsSafe(entry))) return false;
  if (!Array.isArray(value.history_refs) || value.history_refs.length === 0 || value.history_refs.some((ref) => !refMatches(ref, /^sha256:[a-f0-9]{64}$/u)) || new Set(value.history_refs).size !== value.history_refs.length) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.some((entry) => !meaningfulAddendumText(entry)) || verificationAddendumTextIsUnsafe([value.next_step_summary, ...value.limitations, ...value.findings.flatMap((finding) => isRecord(finding) ? [finding.summary, finding.next_step_summary, ...(Array.isArray(finding.remaining_limitations) ? finding.remaining_limitations : [])] : [])])) return false;
  if (value.finalization_state !== "finalized" && value.finalization_state !== "not_finalized") return false;
  const unresolved = value.findings.some((finding) => isRecord(finding) && (finding.verification_status === "verification_pending" || finding.verification_status === "requires_customer_side_validation"));
  if ((unresolved && value.finalization_state !== "not_finalized") || ((unresolved || value.finalization_state === "not_finalized") && !meaningfulAddendumText(value.next_step_summary))) return false;
  const findingRefs = value.findings.map((finding) => finding.review_finding_draft_ref);
  const decisionRefs = value.findings.map((finding) => finding.verification_record_ref);
  // C6-30: uniqueness of evidence record refs is a per-finding constraint —
  // control-plane can legitimately bind one evidence record to multiple
  // selected findings.
  const evidenceRecordRefs = value.findings.flatMap((finding) => finding.verification_evidence_record_refs);
  if (
    new Set(findingRefs).size !== findingRefs.length ||
    new Set(decisionRefs).size !== decisionRefs.length ||
    value.findings.some((finding) => new Set(finding.verification_evidence_record_refs).size !== finding.verification_evidence_record_refs.length)
  ) return false;
  const retainedRefs = new Set(value.retained_evidence.filter(isRecord).map((entry) => entry.artifact_ref));
  const deletedRefs = new Set(value.deleted_evidence.filter(isRecord).map((entry) => entry.artifact_ref));
  if (retainedRefs.size !== value.retained_evidence.length || deletedRefs.size !== value.deleted_evidence.length || [...retainedRefs].some((ref) => deletedRefs.has(ref))) return false;
  return [...new Set(evidenceRecordRefs)].every((ref) => {
    const artifactRef = `artifact_ref:${ref.slice("verification_evidence:".length)}`;
    return Number(retainedRefs.has(artifactRef)) + Number(deletedRefs.has(artifactRef)) === 1;
  });
}

function verificationAddendumFindingIsSafe(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["review_finding_draft_ref", "classification_record_ref", "current_classification", "verification_status", "reviewer_actor_category", "verification_record_ref", "verification_evidence_record_refs", "remediation_guidance_ref", "validation_path_ref", "accepted_risk_record_ref", "false_positive_record_ref", "timestamp", "summary", "remaining_limitations", "next_step_summary"])) return false;
  if (!refMatches(value.review_finding_draft_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(value.classification_record_ref, /^classification_record:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(value.verification_record_ref, /^verification_record:[a-z0-9][a-z0-9_-]{2,63}$/u) || value.reviewer_actor_category !== "reviewer") return false;
  if (!new Set(["likely", "confirmed", "inconclusive", "requires_customer_side_validation"]).has(String(value.current_classification)) || !new Set(["verification_complete", "verification_pending", "not_verified", "requires_customer_side_validation"]).has(String(value.verification_status))) return false;
  if (!Array.isArray(value.verification_evidence_record_refs) || value.verification_evidence_record_refs.length === 0 || value.verification_evidence_record_refs.some((ref) => !refMatches(ref, /^verification_evidence:[a-z0-9][a-z0-9_-]{2,63}$/u)) || new Set(value.verification_evidence_record_refs).size !== value.verification_evidence_record_refs.length) return false;
  if (!isIsoUtcTimestamp(value.timestamp) || !meaningfulAddendumText(value.summary) || !Array.isArray(value.remaining_limitations) || value.remaining_limitations.length === 0 || value.remaining_limitations.some((entry) => !meaningfulAddendumText(entry))) return false;
  if (value.verification_status !== "verification_complete" && !meaningfulAddendumText(value.next_step_summary)) return false;
  return (value.remediation_guidance_ref === undefined || refMatches(value.remediation_guidance_ref, /^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$/u)) &&
    (value.validation_path_ref === undefined || refMatches(value.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u)) &&
    (value.accepted_risk_record_ref === undefined || refMatches(value.accepted_risk_record_ref, /^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$/u)) &&
    (value.false_positive_record_ref === undefined || refMatches(value.false_positive_record_ref, /^false_positive:[a-z0-9][a-z0-9_-]{2,63}$/u));
}

function retainedAddendumEvidenceIsSafe(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["artifact_ref", "source_derived_class", "recorded_at"]) && refMatches(value.artifact_ref, /^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$/u) && (value.source_derived_class === "retained_review_artifact" || value.source_derived_class === "customer_opt_in_retained_source") && isIsoUtcTimestamp(value.recorded_at);
}

function deletedAddendumEvidenceIsSafe(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, ["artifact_ref", "deletion_evidence_ref", "deletion_timestamp", "deletion_verification_status"]) && refMatches(value.artifact_ref, /^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$/u) && refMatches(value.deletion_evidence_ref, /^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$/u) && isIsoUtcTimestamp(value.deletion_timestamp) && new Set(["verified", "pending", "unavailable"]).has(String(value.deletion_verification_status));
}

function meaningfulAddendumText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).length >= 3;
}

// C6-15: adds PII (email/phone/customer-ID) and hidden-control/bidi-character detection.
function verificationAddendumTextIsUnsafe(value: unknown): boolean {
  if (typeof value === "string") return sourceTextForbiddenPhrase(value) !== undefined || claimSafeForbiddenPhrase(value) !== undefined || claimSafePositiveClosurePhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined;
  if (Array.isArray(value)) return value.some(verificationAddendumTextIsUnsafe);
  return false;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function findingSurfaceLinks(finding: StaticVerificationAddendumShape["findings"][number]): Array<{ label: string; href: string; printLabel: string }> {
  const refs: Array<[string, string, string]> = [
    ["Finding", "findings", finding.review_finding_draft_ref],
    ["Verification decision", "verification", finding.verification_record_ref],
    ...finding.verification_evidence_record_refs.map((ref): [string, string, string] => ["Verification evidence", "evidence", ref]),
    ...(finding.remediation_guidance_ref === undefined ? [] : [["Remediation guidance", "remediation", finding.remediation_guidance_ref] as [string, string, string]]),
    ...(finding.validation_path_ref === undefined ? [] : [["Validation path", "validation", finding.validation_path_ref] as [string, string, string]]),
    ...(finding.accepted_risk_record_ref === undefined ? [] : [["Accepted risk", "outcomes", finding.accepted_risk_record_ref] as [string, string, string]]),
    ...(finding.false_positive_record_ref === undefined ? [] : [["False positive", "outcomes", finding.false_positive_record_ref] as [string, string, string]])
  ];
  return refs.map(([label, segment, ref]) => { const href = staticRelativeLink(segment, ref); return { label, href, printLabel: `${label}: ${href}` }; });
}

function staticRelativeLink(segment: string, ref: string): string {
  return `./${segment}/${encodeURIComponent(ref)}`;
}

const STATIC_PAYLOAD_KEYS = new Set(["payload", "content", "body", "raw_text", "raw_source", "source_text", "snippet", "stdout", "stderr", "script_output", "base64", "source_code"]);

/**
 * C6-01: delegates to the shared, exception-safe protocol-ts snapshot
 * implementation instead of running its own boolean-only reflection scan
 * that could throw on a revoked/trapping Proxy.
 */
function scanStaticJsonSafety(value: unknown): { valid: boolean; payloadFieldPresent: boolean } {
  const result = snapshotJsonData(value, {}, STATIC_PAYLOAD_KEYS);
  return result.ok ? { valid: true, payloadFieldPresent: result.payloadFieldPresent } : { valid: false, payloadFieldPresent: false };
}

function selectedFindingShapeIsValid(finding: Record<string, unknown>): boolean {
  const allowedClassifications = new Set(["likely", "confirmed", "inconclusive", "requires_customer_side_validation"]);
  const allowedRequestTypes = new Set(["follow_up_commit", "customer_validation_evidence", "reviewer_authored_script_output", "manual_validation_record", "remote_dynamic_testing_evidence"]);
  const allowedEligibility = new Set(["eligible", "out_of_scope", "requires_additional_agreement", "blocked_pending_validation_path"]);
  const forbiddenFields = ["follow_up_commit_ref", "follow_up_commit", "uploaded_validation_evidence_ref", "validation_evidence_ref", "before_after_outcome", "before_after_decision", "verification_complete", "verified_with_evidence", "verification_decision", "addendum_ref", "attestation_addendum_ref", "fixed", "resolved", "remediated", "accepted_risk_record", "false_positive_record"];
  if (!refMatches(finding.review_finding_draft_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) || !refMatches(finding.classification_record_ref, /^classification_record:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if (!allowedClassifications.has(String(finding.current_classification)) || !allowedRequestTypes.has(String(finding.requested_verification_type)) || !allowedEligibility.has(String(finding.eligibility_state))) return false;
  if (!isMeaningfulVerificationScopeReason(finding.eligibility_reason) || !Array.isArray(finding.limitations) || finding.limitations.length === 0 || finding.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation))) return false;
  if (finding.source_derived_class !== undefined || finding.actor !== undefined) return false;
  if (forbiddenFields.some((field) => Object.prototype.hasOwnProperty.call(finding, field) && finding[field] !== undefined)) return false;
  if (finding.remediation_guidance_ref !== undefined && !refMatches(finding.remediation_guidance_ref, /^remediation_guidance:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if (finding.customer_status_record_ref !== undefined && !refMatches(finding.customer_status_record_ref, /^customer_status:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if (finding.current_customer_remediation_status !== undefined && !new Set(["not_started", "planned", "in_progress", "remediated_by_customer", "validation_pending", "deferred", "not_applicable"]).has(String(finding.current_customer_remediation_status))) return false;
  if (finding.validation_path_ref !== undefined && !refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if (finding.accepted_risk_record_ref !== undefined && !refMatches(finding.accepted_risk_record_ref, /^accepted_risk:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if (finding.false_positive_record_ref !== undefined && !refMatches(finding.false_positive_record_ref, /^false_positive:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if ((finding.accepted_risk_record_ref !== undefined || finding.false_positive_record_ref !== undefined) && finding.eligibility_state !== "out_of_scope" && !(refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u) && finding.requested_verification_type !== "follow_up_commit")) return false;
  if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && !refMatches(finding.validation_path_ref, /^validation_path:[a-z0-9][a-z0-9_-]{2,63}$/u)) return false;
  if ((finding.eligibility_state === "blocked_pending_validation_path" || finding.eligibility_state === "requires_additional_agreement") && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) return false;
  if (finding.reviewer_validation_script_refs !== undefined) {
    if (!Array.isArray(finding.reviewer_validation_script_refs)) return false;
    const scriptRefs = finding.reviewer_validation_script_refs;
    if (!scriptRefs.every((ref) => refMatches(ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u)) || new Set(scriptRefs).size !== scriptRefs.length) return false;
  }
  return true;
}

function includedSlotShapeIsValid(slot: Record<string, unknown>): boolean {
  return typeof slot.slot === "number" && Number.isInteger(slot.slot) && slot.slot >= 1 && slot.slot <= 3 &&
    refMatches(slot.finding_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) &&
    refMatches(slot.validation_script_ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u);
}

function additionalCandidateShapeIsValid(candidate: Record<string, unknown>): boolean {
  return candidate.pricing_posture === "pricing_tbd" && typeof candidate.reason === "string" && /pricing\s*tbd/iu.test(candidate.reason) &&
    refMatches(candidate.finding_ref, /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/u) &&
    refMatches(candidate.validation_script_ref, /^validation_script:[a-z0-9][a-z0-9_-]{2,63}$/u);
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

function verificationScopeContainsForbiddenCopy(value: unknown): boolean {
  if (typeof value === "string") {
    return sourceTextForbiddenPhrase(value) !== undefined ||
      claimSafeForbiddenPhrase(value) !== undefined ||
      claimSafePositiveClosurePhrase(value) !== undefined;
  }
  if (Array.isArray(value)) {
    return value.some((item) => verificationScopeContainsForbiddenCopy(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => verificationScopeContainsForbiddenCopy(item));
  }
  return false;
}

function recordContainsForbiddenCopy(value: unknown): boolean {
  if (typeof value === "string") {
    return sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined || acceptedRiskTextHasPositiveClosureClaim(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => recordContainsForbiddenCopy(item));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => recordContainsForbiddenCopy(item));
  }
  return false;
}

function acceptedRiskOutcomeShapeIsValid(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    typeof value.accepted_risk_record_ref === "string" && value.accepted_risk_record_ref.length > 0 &&
    ["customer_user", "reviewer", "vendor_service"].includes(String(value.actor_category)) &&
    typeof value.evidence_basis_summary === "string" && value.evidence_basis_summary.length > 0 &&
    Array.isArray(value.evidence_refs) && value.evidence_refs.every((ref) => typeof ref === "string" && ref.length > 0) &&
    typeof value.customer_acceptance_summary === "string" && value.customer_acceptance_summary.length > 0 &&
    Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every((limitation) => typeof limitation === "string" && limitation.length > 0) &&
    typeof value.source_reference_state === "string" && value.source_reference_state.length > 0 &&
    (value.evidence_consumer_export === "include" || value.evidence_consumer_export === "exclude");
}

function falsePositiveOutcomeShapeIsValid(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    value.actor_category === "reviewer" &&
    typeof value.false_positive_record_ref === "string" && value.false_positive_record_ref.length > 0 &&
    typeof value.evidence_basis_summary === "string" && value.evidence_basis_summary.length > 0 &&
    Array.isArray(value.evidence_refs) && value.evidence_refs.every((ref) => typeof ref === "string" && ref.length > 0) &&
    typeof value.rationale_summary === "string" && value.rationale_summary.length > 0 &&
    Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every((limitation) => typeof limitation === "string" && limitation.length > 0) &&
    typeof value.source_reference_state === "string" && value.source_reference_state.length > 0 &&
    (value.evidence_consumer_export === "include" || value.evidence_consumer_export === "exclude");
}

/**
 * C6-12: the negation check previously ran over the *whole string*, so any
 * negated closure phrase anywhere suppressed detection of an unrelated,
 * genuinely unsafe positive claim elsewhere in the same string — e.g.
 * "This is not verified. It is fixed." has an unrelated later positive
 * closure claim that must still be caught. Splitting into clauses and
 * checking each independently closes that gap (mirrors the same fix in
 * `packages/ui/src/customer-finding-record.ts`).
 */
function acceptedRiskTextHasPositiveClosureClaim(value: string): boolean {
  const normalized = value.toLowerCase();
  const positiveClaimPattern = /\b(?:is|was|has been|now|already|considered|marked)\s+(?:fixed|verified|remediated|resolved)\b|\b(?:fixed|verified|remediated|resolved)\s+(?:by|with|for)\b|\b(?:remediation|verification)\s+(?:complete|completed|accepted|approved|done)\b|\bresolved\s+pending\s+retest\b/u;
  const safeNegatedPattern = /\b(?:not|no|never|without|does not|do not|cannot|is not|was not|has not been)\s+(?:[^.!?]{0,40}\s)?(?:fixed|verified|remediated|resolved|complete|completed|accepted|approved|done)\b/u;
  const clauses = normalized.split(/[.!?;\n]+/u);
  return clauses.some((clause) => positiveClaimPattern.test(clause) && !safeNegatedPattern.test(clause));
}

type StaticBundleVerificationScopeShape = {
  review_id: string;
  verification_pass_id: string;
  scope_version: number;
  included_pass_started_at: string;
  included_pass_start_basis: string;
  scope_recorded_at: string;
  pass_deadline: string;
  visibility: "customer_facing";
  source_derived_class: "retained_review_artifact";
  limitations: string[];
  selected_findings: Record<string, unknown>[];
  included_script_allocation: {
    included_slots: Record<string, unknown>[];
    additional_script_candidates: Record<string, unknown>[];
  };
};

function scopeShapeIsSafe(scope: unknown): scope is StaticBundleVerificationScopeShape {
  if (!isRecord(scope) || scope.visibility !== "customer_facing" || verificationScopeContainsForbiddenCopy(scope)) {
    return false;
  }
  if (
    !refMatches(scope.review_id, /^review:[a-z0-9][a-z0-9_-]{2,63}$/u) ||
    !refMatches(scope.verification_pass_id, /^verification_pass:[a-z0-9][a-z0-9_-]{2,63}$/u) ||
    !Number.isInteger(scope.scope_version) || Number(scope.scope_version) < 1 ||
    scope.source_derived_class !== "retained_review_artifact" ||
    !isIsoUtcTimestamp(scope.included_pass_started_at) ||
    !isIsoUtcTimestamp(scope.scope_recorded_at) ||
    !isIsoUtcTimestamp(scope.pass_deadline) ||
    !verificationScopeWindowIsValid(scope.included_pass_started_at, scope.scope_recorded_at, scope.pass_deadline) ||
    verificationScopeDeadlineBasisIsUnsafe(scope.included_pass_start_basis, scope.limitations)
  ) {
    return false;
  }
  if (
    !Array.isArray(scope.limitations) ||
    scope.limitations.length === 0 ||
    scope.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation)) ||
    !Array.isArray(scope.selected_findings) ||
    scope.selected_findings.length === 0 ||
    !isRecord(scope.included_script_allocation) ||
    !Array.isArray(scope.included_script_allocation.included_slots) ||
    !Array.isArray(scope.included_script_allocation.additional_script_candidates)
  ) {
    return false;
  }
  const selectedFindings: Record<string, unknown>[] = scope.selected_findings.filter(isRecord);
  if (selectedFindings.length !== scope.selected_findings.length || selectedFindings.some((finding) => !selectedFindingShapeIsValid(finding))) {
    return false;
  }
  const includedSlots: Record<string, unknown>[] = scope.included_script_allocation.included_slots.filter(isRecord);
  const additionalCandidates: Record<string, unknown>[] = scope.included_script_allocation.additional_script_candidates.filter(isRecord);
  if (
    includedSlots.length !== scope.included_script_allocation.included_slots.length ||
    additionalCandidates.length !== scope.included_script_allocation.additional_script_candidates.length ||
    includedSlots.some((slot) => !includedSlotShapeIsValid(slot)) ||
    additionalCandidates.some((candidate) => !additionalCandidateShapeIsValid(candidate))
  ) {
    return false;
  }
  const selectedFindingRefs = new Set(selectedFindings.map((finding) => finding.review_finding_draft_ref));
  if (selectedFindingRefs.size !== selectedFindings.length || includedSlots.length > 3) {
    return false;
  }
  const slotNumbers = new Set<number>();
  const allocationScriptRefs = new Set<string>();
  for (const slot of includedSlots) {
    if (!isFiniteNumber(slot.slot) || slotNumbers.has(slot.slot)) {
      return false;
    }
    slotNumbers.add(slot.slot);
  }
  for (const allocationEntry of [...includedSlots, ...additionalCandidates]) {
    if (typeof allocationEntry.finding_ref !== "string" || !selectedFindingRefs.has(allocationEntry.finding_ref)) {
      return false;
    }
    const selectedFinding = selectedFindings.find((finding) => finding.review_finding_draft_ref === allocationEntry.finding_ref);
    const scriptRefs = new Set(Array.isArray(selectedFinding?.reviewer_validation_script_refs) ? selectedFinding.reviewer_validation_script_refs : []);
    if (typeof allocationEntry.validation_script_ref !== "string" || allocationScriptRefs.has(allocationEntry.validation_script_ref) || !scriptRefs.has(allocationEntry.validation_script_ref)) {
      return false;
    }
    allocationScriptRefs.add(allocationEntry.validation_script_ref);
  }
  return allocationScriptRefs.size === selectedFindings.flatMap((finding) => Array.isArray(finding.reviewer_validation_script_refs) ? finding.reviewer_validation_script_refs : []).length;
}

function listValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => visibleOrDefault(item, "")).filter(Boolean) : [];
}

function visibleList(values: unknown[]): string[] {
  return values.flatMap((value) => Array.isArray(value) ? listValues(value) : [visibleOrDefault(value, "")]).filter(Boolean);
}

function visibleOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function customerFacingFindingSchemaValid(value: unknown): boolean {
  try { return validateProtocolSchema("urn:codeattest:protocol:v0:customer-facing-finding-record", value).length === 0; } catch { return false; }
}
