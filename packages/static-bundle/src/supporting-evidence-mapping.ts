import { canonicalizeProtocolJson, customerVisibleTextForbidden, sha256ProtocolText, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import type { SupportingEvidenceMapping } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";

const INTERNAL_KEYS = new Set(["internal_feedback", "pilot_feedback", "pilot_metrics", "unit_economics", "private_notes", "internal_notes"]);

export type SupportingEvidenceMappingProjection = {
  kind: "supporting-evidence-mapping";
  mappingId: string;
  reviewId: string;
  attestationRef: string;
  mappingVersion: number;
  profile: SupportingEvidenceMapping["mapping_profile"];
  decisionAuthority: string;
  acceptanceDisclaimer: string;
  entries: Array<{
    mappingEntryId: string;
    topic: string;
    supportingEvidenceRole: string;
    scopeSummary: string;
    methodSummary: string;
    receiptContext: string;
    evidenceLinks: Array<{ artifactRef: string; href: string; printLabel: string }>;
    limitations: string[];
  }>;
  limitations: string[];
};

export function projectSupportingEvidenceMapping(input: SupportingEvidenceMapping | unknown): SupportingEvidenceMappingProjection | null {
  if (!mappingIsSafe(input)) return null;
  const projection: SupportingEvidenceMappingProjection = {
    kind: "supporting-evidence-mapping",
    mappingId: input.supporting_evidence_mapping_id,
    reviewId: input.review_id,
    attestationRef: input.attestation_ref,
    mappingVersion: input.mapping_version,
    profile: input.mapping_profile,
    decisionAuthority: input.decision_authority,
    acceptanceDisclaimer: input.acceptance_disclaimer,
    entries: input.entries.map((entry) => ({
      mappingEntryId: entry.mapping_entry_id,
      topic: entry.topic,
      supportingEvidenceRole: entry.supporting_evidence_role,
      scopeSummary: entry.scope_summary,
      methodSummary: entry.method_summary,
      receiptContext: entry.receipt_context,
      evidenceLinks: entry.evidence_refs.map((artifactRef) => { const href = relativeLink(input.supporting_evidence_mapping_id, artifactRef); return { artifactRef, href, printLabel: `Supporting artifact: ${href}` }; }),
      limitations: [...entry.limitations]
    })),
    limitations: [...input.limitations]
  };
  deepFreeze(projection);
  return projection;
}

export const buildSupportingEvidenceMappingProjection = projectSupportingEvidenceMapping;

export function projectApprovedSupportingEvidenceMappings(inputs: unknown): SupportingEvidenceMappingProjection[] {
  return Array.isArray(inputs) ? inputs.flatMap((input) => { const projection = projectSupportingEvidenceMapping(input); return projection === null ? [] : [projection]; }) : [];
}

function mappingIsSafe(value: unknown): value is SupportingEvidenceMapping {
  try { canonicalizeProtocolJson(value); } catch { return false; }
  if (!isPlainRecord(value) || validateProtocolSchema("urn:codeattest:protocol:v0:supporting-evidence-mapping", value).length > 0 || containsInternalLearning(value) || value.protocol_version !== "codeattest.v0" || value.approval_state !== "approved" || !["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"].includes(String(value.mapping_profile))) return false;
  if (!meaningful(value.supporting_evidence_mapping_id) || !Number.isSafeInteger(value.mapping_version) || Number(value.mapping_version) < 1 || !meaningful(value.review_id) || !meaningful(value.attestation_ref) || !isUtc(value.approved_at) || !isPlainRecord(value.approved_by) || value.approved_by.actor_type !== "reviewer") return false;
  if (![value.decision_authority, value.acceptance_disclaimer].every(safeText) || !disclaimerActuallyDisclaims(String(value.acceptance_disclaimer))) return false;
  if (!Array.isArray(value.entries) || value.entries.length === 0 || !value.entries.every(entryIsSafe)) return false;
  // C4-27: JSON Schema `uniqueItems` compares complete entry objects, so two
  // entries sharing one mapping_entry_id but differing elsewhere pass schema
  // validation -- this independent projection must reject that ambiguity
  // itself rather than trusting the control-plane layer already did.
  const entryIds = value.entries.map((entry) => (entry as { mapping_entry_id?: unknown }).mapping_entry_id);
  if (new Set(entryIds).size !== entryIds.length) return false;
  return Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every(safeText) && value.visibility === "customer_facing" && value.source_derived_class === "retained_review_artifact";
}
function entryIsSafe(value: unknown): boolean {
  return isPlainRecord(value) && [value.mapping_entry_id, value.topic, value.supporting_evidence_role, value.scope_summary, value.method_summary, value.receipt_context].every(safeText) && Array.isArray(value.evidence_refs) && value.evidence_refs.length > 0 && value.evidence_refs.every(meaningful) && Array.isArray(value.limitations) && value.limitations.length > 0 && value.limitations.every(safeText);
}
function containsInternalLearning(value: unknown): boolean { if (Array.isArray(value)) return value.some(containsInternalLearning); if (!isPlainRecord(value)) return false; return Object.entries(value).some(([key, entry]) => INTERNAL_KEYS.has(key.toLowerCase()) || containsInternalLearning(entry)); }
// C6-35: previously a narrow local regex (`UNSAFE_CLAIMS`) that omitted the
// shared claim/source/PII family lists this package's own `safeText` in
// `static-portal.ts` and the UI package already use. Now delegates to the
// shared checks instead of forking a weaker copy.
function safeText(value: unknown): value is string { return meaningful(value) && customerVisibleTextForbidden(value) === undefined && sourceTextForbiddenPhrase(value) === undefined; }

/**
 * C6-35: `/decid|accept|useful/` accepted any disclaimer that merely
 * *mentioned* those words, including a contradictory positive claim like
 * "CodeAttest accepts every control result." A genuine disclaimer must
 * negate one of those words within the same clause (e.g. "does not
 * determine acceptance"), not just contain it.
 */
function disclaimerActuallyDisclaims(value: string): boolean {
  const normalized = value.toLowerCase();
  const clauses = normalized.split(/[.!?;\n]+/u);
  const subjectPattern = /\b(?:decid|accept|useful|approv|certif|satisf)/u;
  const negationPattern = /\b(?:not|never|no|without|does not|do not|cannot|is not|does\s+not)\b/u;
  return clauses.some((clause) => subjectPattern.test(clause) && negationPattern.test(clause));
}
// C6-36: scoped by mappingId (not just the artifact ref) so the same
// artifact reused across multiple portal mappings gets a distinct target id
// per mapping, instead of every mapping colliding on one global DOM id.
function relativeLink(mappingId: string, ref: string): string { return `#ref-${sha256ProtocolText(`${mappingId}:${ref}`).slice(7, 23)}`; }
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isUtc(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/u.test(value); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function deepFreeze(value: unknown): void { if (value === null || typeof value !== "object" || Object.isFrozen(value)) return; for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
