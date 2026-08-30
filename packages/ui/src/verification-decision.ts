import type { VerificationRecord } from "../../protocol-ts/src/index.js";
import { claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import type { TextFirstStatusView } from "./customer-finding-record.js";
import { normalizeVerificationState, verificationStateDefinition, type CanonicalVerificationState } from "./verification-state.js";
import { scanJsonSafety } from "./json-safety.js";

export type VerificationDecisionAudience = "customer" | "reviewer";
export type VerificationDecisionSectionId = "decision" | "evidence" | "limitations" | "unavailable";
export type VerificationDecisionSectionView = { id: VerificationDecisionSectionId; title: string; summary: string; items: IdentityRef[]; body: string[]; actions: AccessibleAction[] };
export type VerificationDecisionViewProps = { decision: unknown; audience?: VerificationDecisionAudience };
export type VerificationDecisionView = {
  kind: "verification-decision";
  verificationRecordRef: string;
  reviewId: string;
  verificationPassRef: string;
  audience: VerificationDecisionAudience;
  decidedAt: string;
  decisionState: TextFirstStatusView;
  actorCategory: string;
  selectedFindingRef: string;
  beforeBasisSummary: string;
  afterBasisSummary: string;
  originalEvidenceRefs: string[];
  evidenceBasis: string[];
  sourceReferenceState: string;
  confirmationCriteria: string[];
  criteriaResults: Array<{ criterion: string; result: string }>;
  afterEvidenceRefs: string[];
  disclosure: { title: string; body: string[]; nonDismissible: true; tokenRole: CodeAttestColorRole; doesNotRelyOnColor: true };
  sections: VerificationDecisionSectionView[];
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  doesNotRelyOnColor: true;
};

export function VerificationDecisionView(props: VerificationDecisionViewProps | unknown): VerificationDecisionView {
  const propsValid = scanJsonSafety(props).valid;
  const audience = propsValid && isRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  const normalized = propsValid && isRecord(props) ? normalizeDecision(props.decision) : undefined;
  if (normalized === undefined || !decisionIsSafe(normalized, audience)) return unavailableView(audience);
  const decision = normalized;
  const state = decision.verification_status;
  const definition = verificationStateDefinition(state);
  const beforeBasis = `Original classification: ${decision.before_state.classification}. Evidence basis: ${decision.before_state.evidence_basis.join(", ")}. Criteria: ${decision.before_state.confirmation_criteria.join("; ")}.`;
  const afterBasis = `${decision.after_state.summary} Criteria results: ${decision.after_state.criteria_results.map((result) => `${result.criterion}: ${result.result}`).join("; ")}.`;
  return {
    kind: "verification-decision",
    verificationRecordRef: decision.verification_record_id,
    reviewId: decision.review_id,
    verificationPassRef: decision.verification_pass_id,
    audience,
    decidedAt: decision.recorded_at,
    decisionState: status("verification_state", state, definition),
    actorCategory: "CodeAttest reviewer",
    selectedFindingRef: decision.review_finding_draft_ref,
    beforeBasisSummary: beforeBasis,
    afterBasisSummary: afterBasis,
    originalEvidenceRefs: [...decision.before_state.review_finding_draft_evidence_refs],
    evidenceBasis: [...decision.before_state.evidence_basis],
    sourceReferenceState: decision.before_state.source_reference_state,
    confirmationCriteria: [...decision.before_state.confirmation_criteria],
    criteriaResults: decision.after_state.criteria_results.map((entry) => ({ ...entry })),
    afterEvidenceRefs: [...decision.after_state.evidence_refs],
    disclosure: {
      title: "Reviewer verification decision boundary",
      body: [
        "This decision is bounded to the selected finding, submitted follow-up evidence, and recorded validation criteria only.",
        "It does not extend beyond the recorded scope, evidence references, criteria, and stated limitations."
      ],
      nonDismissible: true,
      tokenRole: state === "verification_complete" ? "review" : "warning",
      doesNotRelyOnColor: true
    },
    sections: [
      section("decision", "Verification decision", decision.rationale, decisionItems(decision, state), decisionBody(decision, state), []),
      section("evidence", "Before-and-after evidence basis", afterBasis, evidenceItems(decision), [beforeBasis, afterBasis], []),
      section("limitations", "Limitations and next step", decision.next_step_summary ?? "No further included-pass step is recorded.", [], [...decision.remaining_limitations, ...(decision.next_step_summary === undefined ? [] : [decision.next_step_summary])], [])
    ],
    actions: [copyAction("copy_verification_record_reference", "Copy verification record reference", decision.verification_record_id)],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor },
    doesNotRelyOnColor: true
  };
}

function normalizeDecision(value: unknown): VerificationRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.verification_status === "string") return value as VerificationRecord;
  const legacyState = normalizeVerificationState(value.verification_state);
  if (legacyState === undefined) return undefined;
  const normalized: Record<string, unknown> = { ...value, verification_status: legacyState };
  delete normalized["verification_state"];
  return normalized as VerificationRecord;
}

function decisionIsSafe(record: VerificationRecord, audience: VerificationDecisionAudience): boolean {
  if (!schemaValid(record) || record.actor.actor_type !== "reviewer") return false;
  if (record.visibility === "internal_only" && audience !== "reviewer") return false;
  if (record.verification_status !== "verification_complete" && !meaningful(record.next_step_summary)) return false;
  if (new Set(record.verification_evidence_record_refs).size !== record.verification_evidence_record_refs.length) return false;
  const criteria = record.after_state.criteria_results;
  if (new Set(criteria.map((entry) => entry.criterion)).size !== criteria.length) return false;
  const expected = new Set(record.before_state.confirmation_criteria);
  if (criteria.length !== expected.size || criteria.some((entry) => !expected.has(entry.criterion))) return false;
  if (record.verification_status === "verification_complete" && criteria.some((entry) => entry.result !== "satisfied")) return false;
  if (record.verification_status === "not_verified" && !criteria.some((entry) => entry.result === "not_satisfied")) return false;
  if (record.verification_status === "verification_pending" && !criteria.some((entry) => entry.result === "not_evaluated")) return false;
  if (record.verification_status === "requires_customer_side_validation" && !criteria.some((entry) => entry.result === "customer_validation_required")) return false;
  const renderedText = [record.after_state.summary, record.rationale, record.next_step_summary, ...record.remaining_limitations, ...record.before_state.evidence_basis, ...record.before_state.confirmation_criteria, ...criteria.map((entry) => entry.criterion)];
  return !renderedText.some((value) => unsafeDecisionText(value, record.verification_status));
}

function decisionItems(record: VerificationRecord, state: CanonicalVerificationState): IdentityRef[] {
  return [item("Verification record", record.verification_record_id), item("Review", record.review_id), item("Verification pass", record.verification_pass_id), item("Verification scope", record.verification_pass_ref), item("Selected finding", record.review_finding_draft_ref), item("Classification record", record.classification_record_ref), item("Verification state", verificationStateDefinition(state).label), item("Reviewer actor category", "CodeAttest reviewer")];
}
function decisionBody(record: VerificationRecord, state: CanonicalVerificationState): string[] {
  const stateLine = state === "verification_complete" ? "A bounded complete outcome is recorded for this selected finding and criteria only." : state === "verification_pending" ? "The decision remains pending and is not presented as a success outcome." : state === "requires_customer_side_validation" ? "Customer-side validation remains required before a bounded complete outcome can be recorded." : "The selected finding is not verified under the current bounded evidence and criteria.";
  return [record.rationale, stateLine, ...(record.next_step_summary === undefined ? [] : [record.next_step_summary])];
}
function evidenceItems(record: VerificationRecord): IdentityRef[] { return [...record.verification_evidence_record_refs.map((ref) => item("Verification evidence", ref)), ...record.after_state.evidence_refs.map((ref) => item("After-state evidence", ref))]; }

function unavailableView(audience: VerificationDecisionAudience): VerificationDecisionView {
  return { kind: "verification-decision", verificationRecordRef: "verification_record:unavailable", reviewId: "review:unavailable", verificationPassRef: "verification_pass:unavailable", audience, decidedAt: "timestamp unavailable", decisionState: status("verification_state", "unavailable", { label: "Decision unavailable", meaning: "Verification decision is unavailable or malformed.", tokenRole: "warning" }), actorCategory: "Actor unavailable", selectedFindingRef: "review_finding_draft:unavailable", beforeBasisSummary: "Before basis unavailable", afterBasisSummary: "After basis unavailable", originalEvidenceRefs: [], evidenceBasis: [], sourceReferenceState: "unavailable", confirmationCriteria: [], criteriaResults: [], afterEvidenceRefs: [], disclosure: { title: "Verification decision unavailable", body: ["No outcome or success claim is made from malformed input."], nonDismissible: true, tokenRole: "warning", doesNotRelyOnColor: true }, sections: [section("unavailable", "Verification decision unavailable", "Decision input is unavailable or malformed.", [], ["No claim is made from malformed input."], [])], actions: [], minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor }, doesNotRelyOnColor: true };
}
function status(id: string, value: string, definition: { label: string; meaning: string; tokenRole: CodeAttestColorRole }): TextFirstStatusView { return { id, value, visibleLabel: definition.label, accessibleLabel: `${definition.label}: ${definition.meaning}`, meaning: definition.meaning, tokenRole: definition.tokenRole, tokens: colorTokensForRole(definition.tokenRole), doesNotRelyOnColor: true, role: "status", ariaLive: "polite" }; }
function section(id: VerificationDecisionSectionId, title: string, summary: string, items: IdentityRef[], body: string[], actions: AccessibleAction[]): VerificationDecisionSectionView { return { id, title, summary, items, body, actions }; }
function action(type: string, label: string): AccessibleAction { return { type, label, accessibleLabel: label, hoverOnly: false, minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, actionable: true }; }
// C6-31: a copy action must carry the exact identity to copy, matching the
// Epic 5 `copyActions` contract — otherwise an adapter must hardcode an
// out-of-band lookup and can copy the wrong identity or nothing.
function copyAction(type: string, label: string, value: string): AccessibleAction & { value: string } { return { ...action(type, label), value }; }
function item(label: string, value: string): IdentityRef { return { label, value }; }
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).length >= 3; }
// C6-15: `customerVisibleTextForbidden` adds PII (email/phone/customer-ID)
// and hidden-control/bidi-character detection on top of the claim/source
// checks already run here.
function unsafeDecisionText(value: unknown, statusValue: VerificationRecord["verification_status"]): boolean {
  if (typeof value !== "string" || sourceTextForbiddenPhrase(value) !== undefined || claimSafeForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined) return typeof value === "string";
  const phrase = claimSafePositiveClosurePhrase(value);
  return phrase !== undefined && !(statusValue === "verification_complete" && phrase === "verification complete");
}
function schemaValid(value: unknown): boolean { try { return validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", value).length === 0; } catch { return false; } }
function isAudience(value: unknown): value is VerificationDecisionAudience { return value === "customer" || value === "reviewer"; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
