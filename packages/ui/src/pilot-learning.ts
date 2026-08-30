import { compareUtcRfc3339Timestamps, customerVisibleTextForbidden, piiTextForbidden, sourceCodeLikeTextReason, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import type { PilotFeedbackRecord, PilotMetricRecord } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { snapshotJsonData } from "../../protocol-ts/src/index.js";
import { epic5Accessibility, epic5InputIsSerializable, isPlainRecord, meaningfulText } from "./epic5-safety.js";

export type PilotLearningMetricRecord = PilotMetricRecord;
export type PilotLearningFeedbackRecord = PilotFeedbackRecord;
export type PilotLearningView = {
  kind: "pilot-learning";
  available: boolean;
  visibility: "internal_only";
  reviewId: string;
  metricRecordId: string;
  feedbackRecordId?: string;
  metrics: Array<{ label: string; value: string }>;
  feedback: Array<{ label: string; values: string[] }>;
  caveats: string[];
  pilotDecisionFrame: string[];
  exclusion: {
    customerAttestation: true;
    staticBundleManifestAndFiles: true;
    portalSearchAndPrint: true;
    customerEventHistory: true;
  };
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  reducedMotion: typeof epic5Accessibility.reducedMotion;
  doesNotRelyOnColor: true;
};

export function PilotLearningView(props: { metric: unknown; feedback?: unknown; audience?: "internal" | "customer" | "evidence_consumer" } | unknown): PilotLearningView | null {
  if (!isPlainRecord(props) || props.audience !== "internal" || !metricIsSafe(props.metric)) return null;
  if (props.feedback !== undefined && !feedbackIsSafe(props.feedback)) return null;
  const metric = props.metric;
  const feedback = props.feedback as PilotFeedbackRecord | undefined;
  if (feedback !== undefined && feedback.review_id !== metric.review_id) return null;
  return {
    kind: "pilot-learning",
    available: true,
    visibility: "internal_only",
    reviewId: metric.review_id,
    metricRecordId: metric.pilot_metric_record_id,
    ...(feedback === undefined ? {} : { feedbackRecordId: feedback.pilot_feedback_record_id }),
    metrics: [
      { label: "Measurement window", value: `${metric.measurement_window.start_timestamp} to ${metric.measurement_window.end_timestamp}` },
      { label: "Classification yield", value: `${metric.metrics.classified_finding_count}/${metric.metrics.candidate_finding_count}` },
      { label: "Actionable classifications", value: `${metric.metrics.actionable_classification_count}` },
      { label: "Expert review time", value: `${metric.metrics.review_hours} hours` },
      { label: "Validation time", value: `${metric.metrics.validation_hours} hours` },
      { label: "Turnaround", value: `${metric.metrics.turnaround_hours} hours` },
      { label: "Disclosure mode", value: metric.metrics.disclosure_mode },
      { label: "Submission rejections", value: `${metric.metrics.submission_rejection_count}` },
      { label: "Repeat intent", value: metric.metrics.repeat_intent_signal },
      { label: "Pay intent", value: metric.metrics.pay_intent_signal }
    ],
    feedback: feedback === undefined ? [] : [
      { label: "Feedback source", values: [feedback.feedback_source] },
      { label: "Usefulness rating", values: [`${feedback.usefulness_rating}/5`] },
      { label: "Mapping feedback", values: feedback.mapping_feedback.map((entry) => `${entry.mapping_profile}: ${entry.usefulness_rating}/5`) },
      { label: "Objection codes", values: [...feedback.objection_codes] },
      { label: "Repeat intent", values: [feedback.repeat_intent] },
      { label: "Pay intent", values: [feedback.pay_intent] }
    ],
    caveats: [...metric.caveats, ...(feedback?.caveats ?? [])],
    pilotDecisionFrame: ["Assess whether disclosure controls were workable for the pilot context.", "Assess whether expert classification was useful with the submitted evidence boundary.", "Assess whether evidence consumers found the package useful as supporting evidence."],
    exclusion: { customerAttestation: true, staticBundleManifestAndFiles: true, portalSearchAndPrint: true, customerEventHistory: true },
    ...epic5Accessibility
  };
}

/**
 * C6-34: `T | unknown` collapses to `unknown` under TypeScript's rules, so a
 * generic `T` here never provided real compile-time safety — callers could
 * claim any shape. This also used to return the original caller-owned
 * reference, so mutation after validation could smuggle internal fields past
 * this guard before serialization. Returns a frozen snapshot as `unknown`
 * instead; callers that need a specific type must validate/narrow it
 * themselves from the returned snapshot, the same way every other protocol
 * boundary in this package works.
 */
export function excludeInternalLearningFromCustomerArtifact(value: unknown): unknown | null {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true })) return null;
  const snapshot = snapshotJsonData(value, {}, new Set());
  if (!snapshot.ok || containsInternalOnlyRecord(snapshot.value)) return null;
  return snapshot.value;
}

function containsInternalOnlyRecord(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInternalOnlyRecord);
  if (!isPlainRecord(value)) return false;
  if (value.visibility === "internal_only" || meaningfulText(value.pilot_metric_record_id) || meaningfulText(value.pilot_feedback_record_id)) return true;
  return Object.values(value).some(containsInternalOnlyRecord);
}

function metricIsSafe(value: unknown): value is PilotMetricRecord {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: false, rejectPayloadFields: true }) || validateProtocolSchema("urn:codeattest:protocol:v0:pilot-metric-record", value).length > 0 || !isPlainRecord(value) || value.protocol_version !== "codeattest.v0" || value.visibility !== "internal_only" || value.source_derived_class !== "retained_review_artifact" || value.content_free !== true) return false;
  if (!meaningfulText(value.pilot_metric_record_id) || !Number.isSafeInteger(value.record_version) || Number(value.record_version) < 1 || !meaningfulText(value.review_id) || !isUtc(value.recorded_at) || !internalActor(value.recorded_by)) return false;
  // C6-17: `Date.parse` truncates to millisecond precision, so a valid
  // sub-millisecond interval (e.g. `.123000001Z` -> `.123000002Z`) was
  // rejected as non-positive, and reversed sub-millisecond ordering could
  // pass. `compareUtcRfc3339Timestamps` compares at full nanosecond precision.
  if (
    !isPlainRecord(value.measurement_window) || !isUtc(value.measurement_window.start_timestamp) || !isUtc(value.measurement_window.end_timestamp) ||
    compareUtcRfc3339Timestamps(value.measurement_window.start_timestamp, value.measurement_window.end_timestamp) >= 0 ||
    compareUtcRfc3339Timestamps(value.measurement_window.end_timestamp, value.recorded_at) > 0
  ) return false;
  if (!isPlainRecord(value.metrics)) return false;
  const integerFields = [value.metrics.candidate_finding_count, value.metrics.classified_finding_count, value.metrics.actionable_classification_count, value.metrics.submission_rejection_count];
  if (!integerFields.every(nonnegativeInteger) || Number(value.metrics.classified_finding_count) > Number(value.metrics.candidate_finding_count) || Number(value.metrics.actionable_classification_count) > Number(value.metrics.classified_finding_count)) return false;
  if (![value.metrics.review_hours, value.metrics.validation_hours, value.metrics.turnaround_hours].every(nonnegativeNumber)) return false;
  if (!["metadata_only", "finding_context_snippets", "extended_approved_snippets_or_targeted_files"].includes(String(value.metrics.disclosure_mode)) || !intentSafe(value.metrics.repeat_intent_signal) || !intentSafe(value.metrics.pay_intent_signal)) return false;
  return Array.isArray(value.caveats) && value.caveats.length > 0 && value.caveats.every(internalPilotTextIsSafe);
}

function feedbackIsSafe(value: unknown): value is PilotFeedbackRecord {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: false, rejectPayloadFields: true }) || validateProtocolSchema("urn:codeattest:protocol:v0:pilot-feedback-record", value).length > 0 || !isPlainRecord(value) || value.protocol_version !== "codeattest.v0" || value.visibility !== "internal_only" || value.source_derived_class !== "retained_review_artifact" || value.content_free !== true || value.pii_free !== true) return false;
  if (!meaningfulText(value.pilot_feedback_record_id) || !Number.isSafeInteger(value.record_version) || Number(value.record_version) < 1 || !meaningfulText(value.review_id) || !isUtc(value.recorded_at) || !internalActor(value.recorded_by)) return false;
  if (!["customer_admin_aggregate", "evidence_consumer_aggregate", "reviewer_observation"].includes(String(value.feedback_source)) || !Number.isInteger(value.usefulness_rating) || Number(value.usefulness_rating) < 1 || Number(value.usefulness_rating) > 5 || !intentSafe(value.repeat_intent) || !intentSafe(value.pay_intent)) return false;
  if (!Array.isArray(value.mapping_feedback) || value.mapping_feedback.some((entry) => !isPlainRecord(entry) || !["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review", "not_used"].includes(String(entry.mapping_profile)) || !Number.isSafeInteger(entry.usefulness_rating) || Number(entry.usefulness_rating) < 1 || Number(entry.usefulness_rating) > 5)) return false;
  const profiles = value.mapping_feedback.map((entry) => entry.mapping_profile);
  if (new Set(profiles).size !== profiles.length || !Array.isArray(value.objection_codes) || new Set(value.objection_codes).size !== value.objection_codes.length || !value.objection_codes.every(meaningfulText)) return false;
  return Array.isArray(value.caveats) && value.caveats.length > 0 && value.caveats.every(internalPilotTextIsSafe);
}

function internalActor(value: unknown): boolean {
  return isPlainRecord(value) && (value.actor_type === "vendor_service" || value.actor_type === "reviewer") && meaningfulText(value.actor_id);
}

function intentSafe(value: unknown): boolean {
  return value === "yes" || value === "no" || value === "unsure" || value === "not_asked";
}

function nonnegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

// C6-18: adds source-code-snippet detection — SSN/unlabeled-phone/cloud-credential
// PII families are now covered via the shared `piiTextForbidden` family list (see claim-safety.ts).
function internalPilotTextIsSafe(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && customerVisibleTextForbidden(value) === undefined && sourceTextForbiddenPhrase(value) === undefined && sourceCodeLikeTextReason(value) === undefined && !piiTextLikely(value);
}

function piiTextLikely(value: string): boolean {
  return piiTextForbidden(value) !== undefined;
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
