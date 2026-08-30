import type { VerificationAddendum } from "../../protocol-ts/src/index.js";
import { claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import type { TextFirstStatusView } from "./customer-finding-record.js";
import { verificationStateDefinition } from "./verification-state.js";
import { scanJsonSafety } from "./json-safety.js";

export type VerificationAddendumAudience = "customer" | "evidence_consumer" | "reviewer";
export type VerificationAddendumFinalizationState = VerificationAddendum["finalization_state"];
export type VerificationAddendumSafeLinkView = { label: string; href: string; printLabel: string; doesNotRelyOnColor: true };
export type VerificationAddendumEvidenceView = {
  artifactRef: string;
  title: string;
  recordedAt?: string;
  deletionEvidenceRef?: string;
  deletionTimestamp?: string;
  deletionVerificationStatus?: string;
  accessLink?: VerificationAddendumSafeLinkView;
  availability: "retained" | "deleted";
  sourceDerivedClass?: string;
  doesNotRelyOnColor: true;
};
export type VerificationAddendumFindingView = {
  findingRef: string;
  classificationRecordRef: string;
  currentClassification: string;
  verificationStatus: string;
  reviewerActorCategory: "reviewer";
  verificationRecordRef: string;
  verificationEvidenceRecordRefs: string[];
  remediationGuidanceRef?: string;
  validationPathRef?: string;
  acceptedRiskRecordRef?: string;
  falsePositiveRecordRef?: string;
  timestamp: string;
  summary: string;
  remainingLimitations: string[];
  nextStepSummary?: string;
};
export type VerificationAddendumSectionId = "summary" | "retained_evidence" | "deleted_evidence" | "history" | "limitations" | "unavailable";
export type VerificationAddendumSectionView = { id: VerificationAddendumSectionId; title: string; summary: string; items: IdentityRef[]; body: string[]; actions: AccessibleAction[] };
export type VerificationAddendumViewProps = { addendum: unknown; audience?: VerificationAddendumAudience };
export type VerificationAddendumView = {
  kind: "verification-addendum";
  verificationAddendumRef: string;
  verificationPassRef: string;
  reviewId: string;
  selectedCommitRef: string;
  audience: VerificationAddendumAudience;
  generatedAt: string;
  verificationState: TextFirstStatusView;
  finalizationState: TextFirstStatusView;
  outcomeStates: TextFirstStatusView[];
  findings: VerificationAddendumFindingView[];
  retainedEvidence: VerificationAddendumEvidenceView[];
  deletedEvidence: VerificationAddendumEvidenceView[];
  timelineLinks: VerificationAddendumSafeLinkView[];
  disclosure: { title: string; body: string[]; nonDismissible: true; tokenRole: CodeAttestColorRole; doesNotRelyOnColor: true };
  sections: VerificationAddendumSectionView[];
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  doesNotRelyOnColor: true;
};

const FINALIZATION: Record<VerificationAddendumFinalizationState, { label: string; meaning: string; tokenRole: CodeAttestColorRole }> = {
  finalized: { label: "Finalized", meaning: "The standalone addendum is ready to share as a bounded projection over recorded artifacts and history.", tokenRole: "review" },
  not_finalized: { label: "Not finalized", meaning: "The standalone addendum remains incomplete and must not be presented as final.", tokenRole: "warning" }
};

export function VerificationAddendumView(props: VerificationAddendumViewProps | unknown): VerificationAddendumView {
  const propsValid = scanJsonSafety(props).valid;
  const audience = propsValid && isRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  if (!propsValid || !isRecord(props) || !addendumIsSafe(props.addendum)) return unavailableView(audience);
  const addendum = props.addendum;
  const aggregateState = addendum.findings.every((finding) => finding.verification_status === "verification_complete")
    ? "verification_complete"
    : addendum.findings.some((finding) => finding.verification_status === "requires_customer_side_validation")
      ? "requires_customer_side_validation"
      : addendum.findings.some((finding) => finding.verification_status === "verification_pending")
        ? "verification_pending"
        : "not_verified";
  const retainedEvidence = addendum.retained_evidence.map((entry) => retainedView(entry));
  const deletedEvidence = addendum.deleted_evidence.map((entry) => deletedView(entry));
  const timelineLinks = addendum.history_refs.map((ref) => safeLink("Review history event", ref, "history"));
  const selectedCommitRef = `git_commit:${addendum.selected_commit.commit_sha}`;
  return {
    kind: "verification-addendum",
    verificationAddendumRef: addendum.verification_addendum_id,
    verificationPassRef: addendum.verification_pass_id,
    reviewId: addendum.review_id,
    selectedCommitRef,
    audience,
    generatedAt: addendum.generated_at,
    verificationState: status("verification_state", aggregateState, verificationStateDefinition(aggregateState)),
    finalizationState: status("finalization_state", addendum.finalization_state, FINALIZATION[addendum.finalization_state]),
    outcomeStates: addendum.findings.flatMap((finding) => outcomeStates(finding)),
    findings: addendum.findings.map((finding) => ({
      findingRef: finding.review_finding_draft_ref,
      classificationRecordRef: finding.classification_record_ref,
      currentClassification: finding.current_classification,
      verificationStatus: finding.verification_status,
      reviewerActorCategory: finding.reviewer_actor_category,
      verificationRecordRef: finding.verification_record_ref,
      verificationEvidenceRecordRefs: [...finding.verification_evidence_record_refs],
      ...(finding.remediation_guidance_ref === undefined ? {} : { remediationGuidanceRef: finding.remediation_guidance_ref }),
      ...(finding.validation_path_ref === undefined ? {} : { validationPathRef: finding.validation_path_ref }),
      ...(finding.accepted_risk_record_ref === undefined ? {} : { acceptedRiskRecordRef: finding.accepted_risk_record_ref }),
      ...(finding.false_positive_record_ref === undefined ? {} : { falsePositiveRecordRef: finding.false_positive_record_ref }),
      timestamp: finding.timestamp,
      summary: finding.summary,
      remainingLimitations: [...finding.remaining_limitations],
      ...(finding.next_step_summary === undefined ? {} : { nextStepSummary: finding.next_step_summary })
    })),
    retainedEvidence,
    deletedEvidence,
    timelineLinks,
    disclosure: {
      title: "Standalone verification addendum boundary",
      body: [
        "This addendum preserves the original review scope, selected commit, evidence references, reviewer decisions, lifecycle state, and limitations.",
        "It is a standalone projection and does not create authority beyond the recorded scope and history."
      ],
      nonDismissible: true,
      tokenRole: addendum.finalization_state === "finalized" ? "review" : "warning",
      doesNotRelyOnColor: true
    },
    sections: [
      section("summary", "Verification summary", `${addendum.findings.length} selected finding outcome${addendum.findings.length === 1 ? "" : "s"}.`, summaryItems(addendum, selectedCommitRef), addendum.findings.flatMap((finding) => [finding.summary, ...finding.remaining_limitations, ...(finding.next_step_summary === undefined ? [] : [finding.next_step_summary])]), []),
      section("retained_evidence", "Retained evidence references", `${retainedEvidence.length} retained evidence reference${retainedEvidence.length === 1 ? "" : "s"}.`, retainedEvidence.map((entry) => item("Retained evidence", entry.artifactRef)), retainedEvidence.map((entry) => `${entry.artifactRef} — ${entry.recordedAt} — ${entry.sourceDerivedClass}`), []),
      section("deleted_evidence", "Deleted evidence representation", `${deletedEvidence.length} deleted evidence entr${deletedEvidence.length === 1 ? "y" : "ies"}.`, deletedEvidence.flatMap((entry) => [item("Deleted evidence", entry.artifactRef), item("Deletion evidence", entry.deletionEvidenceRef ?? "deletion_evidence:unavailable")]), deletedEvidence.map((entry) => `${entry.artifactRef} — deletion status ${entry.deletionVerificationStatus}`), []),
      section("history", "Linked history surfaces", `${timelineLinks.length} print/export-safe history link${timelineLinks.length === 1 ? "" : "s"}.`, timelineLinks.map((entry) => item(entry.label, entry.href)), timelineLinks.map((entry) => entry.printLabel), []),
      section("limitations", "Limitations and next step", addendum.next_step_summary ?? "No further included-pass step is recorded.", [], [...addendum.limitations, ...(addendum.next_step_summary === undefined ? [] : [addendum.next_step_summary])], [])
    ],
    actions: [copyAction("copy_verification_addendum_reference", "Copy verification addendum reference", addendum.verification_addendum_id)],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor },
    doesNotRelyOnColor: true
  };
}

function addendumIsSafe(value: unknown): value is VerificationAddendum {
  if (!schemaValid(value)) return false;
  const addendum = value as VerificationAddendum;
  const retained = new Set(addendum.retained_evidence.map((entry) => entry.artifact_ref));
  const deleted = new Set(addendum.deleted_evidence.map((entry) => entry.artifact_ref));
  if (retained.size !== addendum.retained_evidence.length || deleted.size !== addendum.deleted_evidence.length || [...retained].some((ref) => deleted.has(ref))) return false;
  const findingRefs = addendum.findings.map((finding) => finding.review_finding_draft_ref);
  const decisionRefs = addendum.findings.map((finding) => finding.verification_record_ref);
  // C6-30: control-plane can legitimately bind one follow-up commit/evidence
  // record to multiple selected findings — uniqueness is a per-finding
  // constraint (no finding cites the same evidence record twice), not a
  // global one across the whole addendum.
  const evidenceRecordRefs = addendum.findings.flatMap((finding) => finding.verification_evidence_record_refs);
  if (
    new Set(findingRefs).size !== findingRefs.length ||
    new Set(decisionRefs).size !== decisionRefs.length ||
    addendum.findings.some((finding) => new Set(finding.verification_evidence_record_refs).size !== finding.verification_evidence_record_refs.length)
  ) return false;
  const uniqueEvidenceRecordRefs = new Set(evidenceRecordRefs);
  if ([...uniqueEvidenceRecordRefs].some((ref) => {
    const artifactRef = `artifact_ref:${ref.slice("verification_evidence:".length)}`;
    return Number(retained.has(artifactRef)) + Number(deleted.has(artifactRef)) !== 1;
  })) return false;
  if (addendum.findings.some((finding) => finding.verification_status !== "verification_complete" && !meaningful(finding.next_step_summary))) return false;
  if (addendum.finalization_state === "finalized" && addendum.findings.some((finding) => finding.verification_status === "verification_pending" || finding.verification_status === "requires_customer_side_validation")) return false;
  if ((addendum.finalization_state === "not_finalized" || addendum.findings.some((finding) => finding.verification_status !== "verification_complete")) && !meaningful(addendum.next_step_summary)) return false;
  const texts = [addendum.next_step_summary, ...addendum.limitations, ...addendum.findings.flatMap((finding) => [finding.summary, finding.next_step_summary, ...finding.remaining_limitations])];
  return !texts.some(unsafeText);
}

function retainedView(entry: VerificationAddendum["retained_evidence"][number]): VerificationAddendumEvidenceView {
  return { artifactRef: entry.artifact_ref, title: "Retained verification evidence", recordedAt: entry.recorded_at, availability: "retained", sourceDerivedClass: entry.source_derived_class, accessLink: safeLink("Open retained evidence reference", entry.artifact_ref, "artifacts"), doesNotRelyOnColor: true };
}
function deletedView(entry: VerificationAddendum["deleted_evidence"][number]): VerificationAddendumEvidenceView {
  return { artifactRef: entry.artifact_ref, title: "Deleted verification evidence", deletionEvidenceRef: entry.deletion_evidence_ref, deletionTimestamp: entry.deletion_timestamp, deletionVerificationStatus: entry.deletion_verification_status, availability: "deleted", doesNotRelyOnColor: true };
}
function safeLink(label: string, ref: string, segment: string): VerificationAddendumSafeLinkView {
  const href = `./${segment}/${encodeURIComponent(ref)}`;
  return { label, href, printLabel: `${label}: ${href}`, doesNotRelyOnColor: true };
}
function outcomeStates(finding: VerificationAddendum["findings"][number]): TextFirstStatusView[] {
  return [
    ...(finding.accepted_risk_record_ref === undefined ? [] : [status("risk_outcome", "risk_carried", { label: `Accept${"ed"} risk`, meaning: "Customer risk posture remains visible and separate from verification.", tokenRole: "warning" })]),
    ...(finding.false_positive_record_ref === undefined ? [] : [status("false_positive_outcome", "false_positive", { label: "False positive", meaning: "Reviewer false-positive posture remains visible and separate from verification.", tokenRole: "neutral" })])
  ];
}
function summaryItems(addendum: VerificationAddendum, selectedCommitRef: string): IdentityRef[] {
  return [item("Verification addendum", addendum.verification_addendum_id), item("Review", addendum.review_id), item("Review scope", addendum.review_scope_ref), item("Verification pass", addendum.verification_pass_id), item("Verification scope", addendum.verification_pass_ref), item("Selected commit", selectedCommitRef), ...addendum.findings.flatMap((finding) => [item("Selected finding", finding.review_finding_draft_ref), item("Verification record", finding.verification_record_ref)])];
}

function unavailableView(audience: VerificationAddendumAudience): VerificationAddendumView {
  return { kind: "verification-addendum", verificationAddendumRef: "verification_addendum:unavailable", verificationPassRef: "verification_pass:unavailable", reviewId: "review:unavailable", selectedCommitRef: "git_commit:unavailable", audience, generatedAt: "timestamp unavailable", verificationState: status("verification_state", "unavailable", { label: "Addendum unavailable", meaning: "Standalone addendum input is unavailable or malformed.", tokenRole: "warning" }), finalizationState: status("finalization_state", "unavailable", { label: "Finalization unavailable", meaning: "Finalization state is unavailable or malformed.", tokenRole: "warning" }), outcomeStates: [], findings: [], retainedEvidence: [], deletedEvidence: [], timelineLinks: [], disclosure: { title: "Standalone verification addendum unavailable", body: ["No finalization or success claim is made from malformed input."], nonDismissible: true, tokenRole: "warning", doesNotRelyOnColor: true }, sections: [section("unavailable", "Verification addendum unavailable", "Addendum input is unavailable or malformed.", [], ["No claim is made from malformed input."], [])], actions: [], minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor }, doesNotRelyOnColor: true };
}
function status(id: string, value: string, definition: { label: string; meaning: string; tokenRole: CodeAttestColorRole }): TextFirstStatusView { return { id, value, visibleLabel: definition.label, accessibleLabel: `${definition.label}: ${definition.meaning}`, meaning: definition.meaning, tokenRole: definition.tokenRole, tokens: colorTokensForRole(definition.tokenRole), doesNotRelyOnColor: true, role: "status", ariaLive: "polite" }; }
function section(id: VerificationAddendumSectionId, title: string, summary: string, items: IdentityRef[], body: string[], actions: AccessibleAction[]): VerificationAddendumSectionView { return { id, title, summary, items, body, actions }; }
function action(type: string, label: string): AccessibleAction { return { type, label, accessibleLabel: label, hoverOnly: false, minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, actionable: true }; }
// C6-31: a copy action must carry the exact identity to copy, matching the Epic 5 `copyActions` contract.
function copyAction(type: string, label: string, value: string): AccessibleAction & { value: string } { return { ...action(type, label), value }; }
function item(label: string, value: string): IdentityRef { return { label, value }; }
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).length >= 3; }
// C6-15: adds PII (email/phone/customer-ID) and hidden-control/bidi-character detection.
function unsafeText(value: unknown): boolean { return typeof value === "string" && (sourceTextForbiddenPhrase(value) !== undefined || claimSafeForbiddenPhrase(value) !== undefined || claimSafePositiveClosurePhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined); }
function schemaValid(value: unknown): boolean { try { return validateProtocolSchema("urn:codeattest:protocol:v0:verification-addendum", value).length === 0; } catch { return false; } }
function isAudience(value: unknown): value is VerificationAddendumAudience { return value === "customer" || value === "evidence_consumer" || value === "reviewer"; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
