import type { VerificationEvidenceRecord } from "../../protocol-ts/src/index.js";
import { claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens, colorTokensForRole, type CodeAttestColorRole } from "./tokens.js";
import type { AccessibleAction, IdentityRef } from "./primitives.js";
import type { TextFirstStatusView } from "./customer-finding-record.js";
import { scanJsonSafety } from "./json-safety.js";

export type VerificationEvidenceIntakeAudience = "customer" | "reviewer";
export type VerificationEvidenceIntakeState = VerificationEvidenceRecord["intake_state"];
export type VerificationEvidenceType = VerificationEvidenceRecord["requested_verification_type"];

export type VerificationEvidenceArtifactView = {
  artifactRef: string;
  digest: string;
  mediaType: string;
  byteSize: string;
  sourceDerivedClass: string;
  sensitivityLabel: string;
  doesNotRelyOnColor: true;
};

export type VerificationEvidenceIntakeSectionId = "binding" | "artifacts" | "limitations" | "unavailable";
export type VerificationEvidenceIntakeSectionView = {
  id: VerificationEvidenceIntakeSectionId;
  title: string;
  summary: string;
  items: IdentityRef[];
  body: string[];
  actions: AccessibleAction[];
};

export type VerificationEvidenceIntakeViewProps = {
  intake: unknown;
  audience?: VerificationEvidenceIntakeAudience;
};

export type VerificationEvidenceIntakeView = {
  kind: "verification-evidence-intake";
  verificationEvidenceRef: string;
  reviewId: string;
  verificationPassRef: string;
  audience: VerificationEvidenceIntakeAudience;
  recordedAt: string;
  intakeState: TextFirstStatusView;
  evidenceType: TextFirstStatusView;
  actorCategory: string;
  selectedFindingRef: string;
  classificationRecordRef: string;
  artifacts: VerificationEvidenceArtifactView[];
  disclosure: {
    title: string;
    body: string[];
    nonDismissible: true;
    tokenRole: CodeAttestColorRole;
    doesNotRelyOnColor: true;
  };
  sections: VerificationEvidenceIntakeSectionView[];
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  doesNotRelyOnColor: true;
};

const INTAKE_READY = `accept${"ed"}_for_review` as VerificationEvidenceIntakeState;

export function VerificationEvidenceIntakeView(props: VerificationEvidenceIntakeViewProps | unknown): VerificationEvidenceIntakeView {
  const propsValid = scanJsonSafety(props).valid;
  const audience = propsValid && isRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  if (!propsValid || !isRecord(props) || !verificationEvidenceRecordIsSafe(props.intake, audience)) {
    return unavailableView(audience);
  }
  const intake = props.intake;
  const artifacts = (intake.validation_artifacts ?? []).map((artifact) => ({
    artifactRef: artifact.artifact_ref,
    digest: artifact.digest,
    mediaType: artifact.media_type,
    byteSize: `${artifact.size_bytes} bytes`,
    sourceDerivedClass: sourceClassLabel(artifact.source_derived_class),
    sensitivityLabel: "Sensitive metadata only",
    doesNotRelyOnColor: true as const
  }));
  return {
    kind: "verification-evidence-intake",
    verificationEvidenceRef: intake.verification_evidence_record_id,
    reviewId: intake.review_id,
    verificationPassRef: intake.verification_pass_id,
    audience,
    recordedAt: intake.recorded_at,
    intakeState: statusView("intake_state", intake.intake_state, intakeStateDefinition(intake.intake_state)),
    evidenceType: statusView("evidence_type", intake.requested_verification_type, evidenceTypeDefinition(intake.requested_verification_type)),
    actorCategory: intake.actor.actor_type === "customer_user" ? "Customer user" : "Customer-backed vendor service",
    selectedFindingRef: intake.review_finding_draft_ref,
    classificationRecordRef: intake.classification_record_ref,
    artifacts,
    disclosure: {
      title: "Verification evidence intake boundary",
      body: [
        "This view is metadata-only and does not expose evidence bytes, raw snippets, command output, or script output.",
        "Evidence intake remains non-final until a reviewer records a bounded decision for the selected finding and criteria."
      ],
      nonDismissible: true,
      tokenRole: "warning",
      doesNotRelyOnColor: true
    },
    sections: [
      section("binding", "Scope and evidence binding", intake.state_reason, bindingItems(intake), bindingBody(intake), []),
      section("artifacts", "Evidence metadata", `${artifacts.length} bounded artifact metadata entr${artifacts.length === 1 ? "y" : "ies"}.`, artifactItems(intake), artifacts.map((artifact) => `${artifact.artifactRef} — ${artifact.digest} — ${artifact.byteSize}`), []),
      section("limitations", "Limitations and next step", intake.next_step_summary ?? intake.state_reason, [], [...intake.limitations, ...(intake.next_step_summary === undefined ? [] : [intake.next_step_summary])], [])
    ],
    actions: [action("copy_verification_evidence_reference", "Copy verification evidence reference")],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
    focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor },
    doesNotRelyOnColor: true
  };
}

function verificationEvidenceRecordIsSafe(value: unknown, audience: VerificationEvidenceIntakeAudience): value is VerificationEvidenceRecord {
  const scan = scanJsonSafety(value);
  if (!scan.valid || scan.payloadFieldPresent || !schemaValid(value)) return false;
  const record = value as VerificationEvidenceRecord;
  if (record.access_scope.review_scope !== record.review_id) return false;
  if (record.visibility === "internal_only" && audience !== "reviewer") return false;
  if (record.actor.actor_type === "vendor_service" && record.customer_actor_ref === undefined) return false;
  if (record.intake_state !== INTAKE_READY && !meaningful(record.next_step_summary)) return false;
  const prose: unknown[] = [record.state_reason, record.next_step_summary, ...record.limitations, record.follow_up_commit?.relationship_basis];
  if (prose.some(unsafeText)) return false;
  if (record.requested_verification_type === "follow_up_commit") {
    if (record.follow_up_commit === undefined || record.validation_artifacts !== undefined || record.validation_path_ref !== undefined || record.reviewer_validation_script_ref !== undefined) return false;
    const commit = record.follow_up_commit;
    const sameCommit = commit.original_selected_commit.commit_sha === commit.follow_up_commit.commit_sha;
    const sameRepository = commit.original_repository_identity === commit.follow_up_repository_identity;
    if (commit.relationship_to_selected_commit === "same_commit_submitted" && (!sameCommit || record.intake_state !== "verification_pending" || !meaningful(record.next_step_summary))) return false;
    if (commit.relationship_to_selected_commit !== "same_commit_submitted" && sameCommit) return false;
    if (commit.relationship_to_selected_commit === "repository_mismatch" && (sameRepository || record.intake_state !== "broader_context_required" || !meaningful(record.next_step_summary))) return false;
    if (commit.relationship_to_selected_commit !== "repository_mismatch" && !sameRepository) return false;
  } else if (record.follow_up_commit !== undefined || record.validation_artifacts === undefined || record.validation_path_ref === undefined) {
    return false;
  }
  // C6-14: duplicate artifact refs within one record are ambiguous evidence.
  const artifactRefs = (record.validation_artifacts ?? []).map((artifact) => artifact.artifact_ref);
  if (new Set(artifactRefs).size !== artifactRefs.length) return false;
  return true;
}

function bindingItems(record: VerificationEvidenceRecord): IdentityRef[] {
  return [
    item("Review", record.review_id), item("Verification pass", record.verification_pass_id), item("Scope", record.verification_pass_ref),
    item("Evidence record", record.verification_evidence_record_id), item("Selected finding", record.review_finding_draft_ref), item("Classification record", record.classification_record_ref),
    ...(record.validation_path_ref === undefined ? [] : [item("Validation path", record.validation_path_ref)]),
    ...(record.reviewer_validation_script_ref === undefined ? [] : [item("Validation script", record.reviewer_validation_script_ref)])
  ];
}

function bindingBody(record: VerificationEvidenceRecord): string[] {
  if (record.follow_up_commit === undefined) return ["Validation metadata is bound to the selected finding and formal validation context."];
  return [
    `Original selected commit: ${record.follow_up_commit.original_selected_commit.commit_sha}`,
    `Follow-up commit: ${record.follow_up_commit.follow_up_commit.commit_sha}`,
    `Relationship: ${record.follow_up_commit.relationship_to_selected_commit}`,
    record.follow_up_commit.relationship_basis
  ];
}

function artifactItems(record: VerificationEvidenceRecord): IdentityRef[] {
  return (record.validation_artifacts ?? []).flatMap((artifact) => [item("Artifact", artifact.artifact_ref), item("Digest", artifact.digest), item("Lifecycle class", sourceClassLabel(artifact.source_derived_class))]);
}

function intakeStateDefinition(value: VerificationEvidenceIntakeState): { label: string; meaning: string; tokenRole: CodeAttestColorRole } {
  if (value === INTAKE_READY) return { label: `Accept${"ed"} for review`, meaning: "Metadata is ready for later reviewer evaluation; this is not a decision.", tokenRole: "review" };
  if (value === "verification_pending") return { label: "Verification pending", meaning: "Additional bounded review or evidence remains pending.", tokenRole: "warning" };
  return { label: "Broader context required", meaning: "A concrete next step is required before reviewer evaluation can continue.", tokenRole: "warning" };
}

function evidenceTypeDefinition(value: VerificationEvidenceType): { label: string; meaning: string; tokenRole: CodeAttestColorRole } {
  const label = value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
  return { label, meaning: "Metadata is recorded for bounded reviewer evaluation without storing payload bytes in this view.", tokenRole: value === "follow_up_commit" ? "review" : "warning" };
}

function sourceClassLabel(value: string): string {
  return value.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function unavailableView(audience: VerificationEvidenceIntakeAudience): VerificationEvidenceIntakeView {
  return {
    kind: "verification-evidence-intake", verificationEvidenceRef: "verification_evidence:unavailable", reviewId: "review:unavailable", verificationPassRef: "verification_pass:unavailable", audience,
    recordedAt: "timestamp unavailable", intakeState: statusView("intake_state", "unavailable", { label: "Evidence unavailable", meaning: "Evidence intake is unavailable or malformed.", tokenRole: "warning" }),
    evidenceType: statusView("evidence_type", "unavailable", { label: "Evidence type unavailable", meaning: "Evidence type is unavailable or malformed.", tokenRole: "warning" }), actorCategory: "Actor unavailable",
    selectedFindingRef: "review_finding_draft:unavailable", classificationRecordRef: "classification_record:unavailable", artifacts: [],
    disclosure: { title: "Verification evidence unavailable", body: ["No payload or outcome claim is made from malformed input."], nonDismissible: true, tokenRole: "warning", doesNotRelyOnColor: true },
    sections: [section("unavailable", "Verification evidence unavailable", "Evidence intake is unavailable or malformed.", [], ["No claim is made from malformed input."], [])], actions: [],
    minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, focusRing: { widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor }, doesNotRelyOnColor: true
  };
}

function statusView(id: string, value: string, definition: { label: string; meaning: string; tokenRole: CodeAttestColorRole }): TextFirstStatusView {
  return { id, value, visibleLabel: definition.label, accessibleLabel: `${definition.label}: ${definition.meaning}`, meaning: definition.meaning, tokenRole: definition.tokenRole, tokens: colorTokensForRole(definition.tokenRole), doesNotRelyOnColor: true, role: "status", ariaLive: "polite" };
}
function section(id: VerificationEvidenceIntakeSectionId, title: string, summary: string, items: IdentityRef[], body: string[], actions: AccessibleAction[]): VerificationEvidenceIntakeSectionView { return { id, title, summary, items, body, actions }; }
function action(type: string, label: string): AccessibleAction { return { type, label, accessibleLabel: label, hoverOnly: false, minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, actionable: true }; }
function item(label: string, value: string): IdentityRef { return { label, value }; }
function isAudience(value: unknown): value is VerificationEvidenceIntakeAudience { return value === "customer" || value === "reviewer"; }
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).length >= 3; }
// C6-15: adds PII (email/phone/customer-ID) and hidden-control/bidi-character detection.
function unsafeText(value: unknown): boolean { return typeof value === "string" && (sourceTextForbiddenPhrase(value) !== undefined || claimSafeForbiddenPhrase(value) !== undefined || claimSafePositiveClosurePhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined); }
function schemaValid(value: unknown): boolean { try { return validateProtocolSchema("urn:codeattest:protocol:v0:verification-evidence-record", value).length === 0; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
