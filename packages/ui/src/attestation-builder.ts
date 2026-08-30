import { recomputeExcludedFieldIdentity } from "../../protocol-ts/src/index.js";
import type { SecurityReviewAttestation } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import type { AccessibleAction } from "./primitives.js";
import { copyActions, epic5Accessibility, epic5Action, epic5InputIsSerializable, epic5TextIsSafe, isPlainRecord, meaningfulText } from "./epic5-safety.js";

export type AttestationBuilderAudience = "reviewer" | "ops" | "customer" | "evidence_consumer";
export type AttestationBuilderInput = SecurityReviewAttestation;
export type AttestationSectionInput = SecurityReviewAttestation["sections"][number];

export type AttestationSectionView = {
  id: string;
  sectionType: AttestationSectionInput["section_type"];
  title: string;
  summary: string;
  scope: string;
  evidenceBasis: string[];
  limitations: string[];
  supportingArtifactRefs: string[];
  actions: Array<AccessibleAction & { value: string }>;
};

export type AttestationBuilderView = {
  kind: "attestation-builder";
  available: boolean;
  audience: AttestationBuilderAudience;
  attestationId: string;
  attestationVersion: number;
  reviewId: string;
  generatedAt: string;
  generationAuthority: string;
  scopeContext: Array<{ label: string; value: string }>;
  receiptChain: Array<{ label: string; value: string }>;
  sections: AttestationSectionView[];
  lifecycle: Array<{ label: string; reference: string; visibleState: string }>;
  methodLimitations: string[];
  limitations: string[];
  verificationAddendumRefs: string[];
  /** C6-33: the package-level (not per-section) supporting-evidence refs, previously validated but never exposed to the independently readable view. */
  supportingArtifactRefs: string[];
  disclosure: { title: string; body: string[]; nonDismissible: true };
  copyActions: Array<AccessibleAction & { value: string }>;
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  reducedMotion: typeof epic5Accessibility.reducedMotion;
  doesNotRelyOnColor: true;
};

const REQUIRED_SECTION_TYPES = new Set<AttestationSectionInput["section_type"]>([
  "scope",
  "method",
  "receipt_chain",
  "findings_and_classification",
  "remediation_and_validation",
  "verification_outcomes",
  "evidence_lifecycle",
  "limitations"
]);

export function AttestationBuilderView(props: { attestation: unknown; audience: AttestationBuilderAudience } | unknown): AttestationBuilderView {
  const audience = isPlainRecord(props) && isAudience(props.audience) ? props.audience : "customer";
  if (!isPlainRecord(props) || !isAudience(props.audience) || !attestationIsSafe(props.attestation)) return unavailable(audience);
  const attestation = props.attestation;
  const identities = [
    { type: "copy_attestation_id", label: "Copy Attestation identity", value: attestation.attestation_id },
    { type: "copy_review_scope", label: "Copy review scope identity", value: attestation.review_scope_ref },
    { type: "copy_selected_commit", label: "Copy selected commit", value: attestation.selected_commit.commit_sha },
    { type: "copy_repository_identity", label: "Copy repository identity", value: attestation.repository_identity },
    { type: "copy_manifest_ref", label: "Copy Outbound Manifest identity", value: attestation.receipt_chain.manifest_id },
    { type: "copy_bundle_ref", label: "Copy Evidence Bundle identity", value: attestation.receipt_chain.evidence_bundle_id },
    { type: "copy_receipt_ref", label: "Copy Vendor Receipt identity", value: attestation.receipt_chain.vendor_receipt_id },
    ...attestation.supporting_artifact_refs.map((value, index) => ({ type: `copy_supporting_artifact_${index + 1}`, label: `Copy package-level supporting artifact reference ${index + 1}`, value }))
  ];
  return {
    kind: "attestation-builder",
    available: true,
    audience,
    attestationId: attestation.attestation_id,
    attestationVersion: attestation.attestation_version,
    reviewId: attestation.review_id,
    generatedAt: attestation.generated_at,
    generationAuthority: attestation.generated_by.actor_type === "reviewer" ? "CodeAttest reviewer" : "CodeAttest vendor service",
    scopeContext: [
      { label: "Review scope", value: attestation.review_scope_ref },
      { label: "Selected commit", value: attestation.selected_commit.commit_sha },
      { label: "Repository identity", value: attestation.repository_identity },
      { label: "Coverage Mode", value: attestation.method.coverage_mode },
      { label: "Scanner versions", value: attestation.method.scanner_versions.join(", ") },
      { label: "Tooling summary", value: attestation.method.tooling_summary },
      { label: "Disclosure summary", value: attestation.method.disclosure_summary }
    ],
    receiptChain: [
      { label: "Outbound Manifest", value: attestation.receipt_chain.manifest_id },
      { label: "Evidence Bundle", value: attestation.receipt_chain.evidence_bundle_id },
      { label: "Vendor Receipt", value: attestation.receipt_chain.vendor_receipt_id },
      { label: "Receipt timestamp", value: attestation.receipt_chain.receipt_timestamp },
      { label: "Verification state", value: attestation.receipt_chain.verification_state }
    ],
    sections: attestation.sections.map((section) => ({
      id: section.section_id,
      sectionType: section.section_type,
      title: section.title,
      summary: section.summary,
      scope: section.scope,
      evidenceBasis: [...section.evidence_basis],
      limitations: [...section.limitations],
      supportingArtifactRefs: [...section.supporting_artifact_refs],
      actions: copyActions(section.supporting_artifact_refs.map((value, index) => ({ type: `copy_section_artifact_${index + 1}`, label: `Copy ${section.title} artifact reference ${index + 1}`, value })))
    })),
    lifecycle: [
      { label: "Evidence minimization", reference: attestation.evidence_minimization_ref, visibleState: "Recorded minimization projection" },
      ...attestation.deletion_evidence_refs.map((reference) => ({ label: "Deletion evidence", reference, visibleState: "Deleted under policy" }))
    ],
    methodLimitations: [...attestation.method.method_limitations],
    limitations: [...attestation.limitations],
    verificationAddendumRefs: [...attestation.verification_addendum_refs],
    supportingArtifactRefs: [...attestation.supporting_artifact_refs],
    disclosure: {
      title: "Bounded supporting-evidence Attestation",
      body: [
        "This Attestation describes recorded scope, methods, evidence basis, receipt chain, outcomes, lifecycle states, and limitations.",
        "An evidence consumer decides whether this package is useful for their own review context."
      ],
      nonDismissible: true
    },
    copyActions: copyActions(identities),
    actions: audience === "reviewer" || audience === "ops" ? [epic5Action("generate_attestation", `Generate Attestation ${attestation.attestation_id}`)] : [],
    ...epic5Accessibility
  };
}

function attestationIsSafe(value: unknown): value is SecurityReviewAttestation {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) || validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", value).length > 0 || !isPlainRecord(value) || value.protocol_version !== "codeattest.v0" || value.visibility !== "customer_facing" || value.customer_safe_projection !== true || value.source_derived_class !== "retained_review_artifact" || value.canonicalization !== "rfc8785" || value.identity_hash_algorithm !== "sha256") return false;
  try {
    if (recomputeExcludedFieldIdentity(value, "attestation_id", "attestation") !== value.attestation_id) return false;
  } catch { return false; }
  if (!meaningfulText(value.attestation_id) || !Number.isSafeInteger(value.attestation_version) || Number(value.attestation_version) < 1 || !meaningfulText(value.review_id) || !isUtc(value.generated_at)) return false;
  if (!isPlainRecord(value.generated_by) || !["reviewer", "vendor_service"].includes(String(value.generated_by.actor_type)) || !meaningfulText(value.generated_by.actor_id)) return false;
  if (!meaningfulText(value.review_scope_ref) || !isPlainRecord(value.selected_commit) || !/^[a-f0-9]{40}$/u.test(String(value.selected_commit.commit_sha)) || value.selected_commit.source_control_system !== "git" || !meaningfulText(value.repository_identity)) return false;
  if (!isPlainRecord(value.method) || ![value.method.tooling_summary, value.method.disclosure_summary].every(epic5TextIsSafe) || !Array.isArray(value.method.scanner_versions) || value.method.scanner_versions.length === 0 || !value.method.scanner_versions.every(epic5TextIsSafe) || !Array.isArray(value.method.method_limitations) || value.method.method_limitations.length === 0 || !value.method.method_limitations.every(epic5TextIsSafe)) return false;
  if (!isPlainRecord(value.receipt_chain) || ![value.receipt_chain.manifest_id, value.receipt_chain.evidence_bundle_id, value.receipt_chain.vendor_receipt_id].every(meaningfulText) || !isUtc(value.receipt_chain.receipt_timestamp) || value.receipt_chain.verification_state !== "received_with_receipt") return false;
  if (!Array.isArray(value.sections) || value.sections.length !== REQUIRED_SECTION_TYPES.size || value.sections.some((section) => !sectionIsSafe(section))) return false;
  const sectionTypes = new Set(value.sections.map((section) => isPlainRecord(section) ? section.section_type : undefined));
  if ([...REQUIRED_SECTION_TYPES].some((sectionType) => !sectionTypes.has(sectionType))) return false;
  // C6-33: section_id must be unique — duplicate IDs collide in the DOM/form/focus/serialization identity a consumer derives from them.
  const sectionIds = value.sections.map((section) => isPlainRecord(section) ? section.section_id : undefined);
  if (new Set(sectionIds).size !== sectionIds.length) return false;
  if (!meaningfulText(value.evidence_minimization_ref) || !Array.isArray(value.deletion_evidence_refs) || !value.deletion_evidence_refs.every(meaningfulText) || !Array.isArray(value.verification_addendum_refs) || !value.verification_addendum_refs.every(meaningfulText)) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || !value.limitations.every(epic5TextIsSafe) || !Array.isArray(value.supporting_artifact_refs) || value.supporting_artifact_refs.length === 0 || !value.supporting_artifact_refs.every(meaningfulText)) return false;
  return Array.isArray(value.identity_input_excludes) && value.identity_input_excludes.length === 1 && value.identity_input_excludes[0] === "attestation_id";
}

function sectionIsSafe(value: unknown): value is AttestationSectionInput {
  if (!isPlainRecord(value) || !meaningfulText(value.section_id) || !REQUIRED_SECTION_TYPES.has(value.section_type as AttestationSectionInput["section_type"]) || ![value.title, value.summary, value.scope].every(epic5TextIsSafe)) return false;
  if (!Array.isArray(value.evidence_basis) || value.evidence_basis.length === 0 || !value.evidence_basis.every(epic5TextIsSafe)) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || !value.limitations.every(epic5TextIsSafe)) return false;
  return Array.isArray(value.supporting_artifact_refs) && value.supporting_artifact_refs.length > 0 && value.supporting_artifact_refs.every(meaningfulText);
}

function unavailable(audience: AttestationBuilderAudience): AttestationBuilderView {
  return { kind: "attestation-builder", available: false, audience, attestationId: "attestation:unavailable", attestationVersion: 0, reviewId: "review:unavailable", generatedAt: "timestamp unavailable", generationAuthority: "Generation authority unavailable", scopeContext: [], receiptChain: [], sections: [], lifecycle: [], methodLimitations: [], limitations: [], verificationAddendumRefs: [], supportingArtifactRefs: [], disclosure: { title: "Attestation unavailable", body: ["No supporting-evidence or completion claim is made from missing or malformed input."], nonDismissible: true }, copyActions: [], actions: [], ...epic5Accessibility };
}

const UTC_CALENDAR_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u;

/**
 * C6-32: `Date.parse` silently normalizes out-of-range dates (e.g. February
 * 30 rolls forward to March), so `!Number.isNaN(Date.parse(...))` accepts
 * calendar-invalid timestamps. This validates day-of-month against the
 * actual month/leap-year instead.
 */
function isUtc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_CALENDAR_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2: return isLeapYear(year) ? 29 : 28;
    case 4: case 6: case 9: case 11: return 30;
    default: return 31;
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isAudience(value: unknown): value is AttestationBuilderAudience {
  return value === "reviewer" || value === "ops" || value === "customer" || value === "evidence_consumer";
}
