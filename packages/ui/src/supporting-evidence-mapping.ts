import type { SupportingEvidenceMapping } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import type { AccessibleAction } from "./primitives.js";
import { copyActions, epic5Accessibility, epic5InputIsSerializable, epic5TextIsSafe, isPlainRecord, meaningfulText } from "./epic5-safety.js";

export type SupportingEvidenceMappingViewInput = SupportingEvidenceMapping;
export type SupportingEvidenceMappingView = {
  kind: "supporting-evidence-mapping";
  available: boolean;
  mappingId: string;
  mappingVersion: number;
  profile: string;
  decisionAuthority: string;
  acceptanceDisclaimer: string;
  entries: Array<{
    id: string;
    topic: string;
    supportingEvidenceRole: string;
    scopeSummary: string;
    methodSummary: string;
    receiptContext: string;
    evidenceRefs: string[];
    limitations: string[];
  }>;
  limitations: string[];
  actions: Array<AccessibleAction & { value: string }>;
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  reducedMotion: typeof epic5Accessibility.reducedMotion;
  doesNotRelyOnColor: true;
};

const APPROVED_PROFILES = new Set<SupportingEvidenceMapping["mapping_profile"]>(["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"]);

export function SupportingEvidenceMappingView(props: { mapping: unknown; reviewId: string; attestationId: string } | unknown): SupportingEvidenceMappingView {
  if (!isPlainRecord(props) || !mappingIsSafe(props.mapping) || props.mapping.review_id !== props.reviewId || props.mapping.attestation_ref !== props.attestationId) return unavailable();
  const mapping = props.mapping;
  const evidenceRefs = mapping.entries.flatMap((entry) => entry.evidence_refs);
  return {
    kind: "supporting-evidence-mapping",
    available: true,
    mappingId: mapping.supporting_evidence_mapping_id,
    mappingVersion: mapping.mapping_version,
    profile: mapping.mapping_profile,
    decisionAuthority: mapping.decision_authority,
    acceptanceDisclaimer: mapping.acceptance_disclaimer,
    entries: mapping.entries.map((entry) => ({
      id: entry.mapping_entry_id,
      topic: entry.topic,
      supportingEvidenceRole: entry.supporting_evidence_role,
      scopeSummary: entry.scope_summary,
      methodSummary: entry.method_summary,
      receiptContext: entry.receipt_context,
      evidenceRefs: [...entry.evidence_refs],
      limitations: [...entry.limitations]
    })),
    limitations: [...mapping.limitations],
    actions: copyActions(evidenceRefs.map((value, index) => ({ type: `copy_mapping_ref_${index + 1}`, label: `Copy supporting artifact reference ${index + 1}`, value }))),
    ...epic5Accessibility
  };
}

function mappingIsSafe(value: unknown): value is SupportingEvidenceMapping {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) || validateProtocolSchema("urn:codeattest:protocol:v0:supporting-evidence-mapping", value).length > 0 || !isPlainRecord(value) || value.protocol_version !== "codeattest.v0" || value.approval_state !== "approved" || value.visibility !== "customer_facing" || value.source_derived_class !== "retained_review_artifact" || !APPROVED_PROFILES.has(value.mapping_profile as SupportingEvidenceMapping["mapping_profile"])) return false;
  if (!meaningfulText(value.supporting_evidence_mapping_id) || !Number.isInteger(value.mapping_version) || Number(value.mapping_version) < 1 || !meaningfulText(value.review_id) || !meaningfulText(value.attestation_ref) || !isUtc(value.approved_at) || !isPlainRecord(value.approved_by)) return false;
  if (![value.decision_authority, value.acceptance_disclaimer].every(epic5TextIsSafe)) return false;
  if (!Array.isArray(value.entries) || value.entries.length === 0 || value.entries.some((entry) => !entryIsSafe(entry))) return false;
  const entryIds = value.entries.map((entry) => isPlainRecord(entry) ? entry.mapping_entry_id : undefined);
  if (new Set(entryIds).size !== entryIds.length) return false;
  return Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every(epic5TextIsSafe);
}

function entryIsSafe(value: unknown): value is SupportingEvidenceMapping["entries"][number] {
  if (!isPlainRecord(value) || ![value.mapping_entry_id, value.topic, value.supporting_evidence_role, value.scope_summary, value.method_summary, value.receipt_context].every(epic5TextIsSafe)) return false;
  if (!Array.isArray(value.evidence_refs) || value.evidence_refs.length === 0 || !value.evidence_refs.every(meaningfulText)) return false;
  return Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every(epic5TextIsSafe);
}

function unavailable(): SupportingEvidenceMappingView {
  return { kind: "supporting-evidence-mapping", available: false, mappingId: "supporting_evidence_mapping:unavailable", mappingVersion: 0, profile: "unavailable", decisionAuthority: "Evidence consumer", acceptanceDisclaimer: "No acceptance or certification claim is made from an unavailable mapping.", entries: [], limitations: ["Only approved and versioned mapping profiles can be rendered."], actions: [], ...epic5Accessibility };
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
