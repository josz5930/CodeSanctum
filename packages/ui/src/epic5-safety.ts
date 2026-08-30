import { claimSafeForbiddenPhrase, piiTextForbidden, snapshotJsonData, sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import { codeAttestDesignTokens } from "./tokens.js";
import type { AccessibleAction } from "./primitives.js";

const PAYLOAD_KEYS = new Set(["payload", "content", "body_bytes", "evidence_content", "evidence_bytes", "raw_text", "raw_source", "source_text", "snippet", "stdout", "stderr", "script_output", "base64", "source_code"]);
const INTERNAL_KEYS = new Set(["pilot_feedback", "pilot_metric", "pilot_metrics", "pilot_learning", "internal_learning", "internal_feedback", "unit_economics", "private_notes", "internal_notes"]);

/**
 * C6-01: delegates the exception-safe reflection walk to the shared
 * protocol-ts `snapshotJsonData`. The `rejectInternalLearning` check runs
 * separately over the already-frozen, already-verified snapshot value (safe
 * to re-read, since it is plain frozen data, not the caller-owned original).
 */
export function epic5InputIsSerializable(value: unknown, options: { rejectInternalLearning?: boolean; rejectPayloadFields?: boolean } = {}): boolean {
  const result = snapshotJsonData(value, {}, options.rejectPayloadFields === true ? PAYLOAD_KEYS : new Set());
  if (!result.ok) return false;
  if (options.rejectPayloadFields === true && result.payloadFieldPresent) return false;
  if (options.rejectInternalLearning === true && snapshotContainsInternalReference(result.value)) return false;
  return true;
}

/**
 * C6-16: a spelling denylist matched only lowercased-with-underscores keys,
 * so `pilotFeedback`, `unit-economics`, and other separator variants of the
 * same denied name bypassed it entirely. `normalizeIdentifier` folds
 * camelCase/kebab-case/space-separated variants to the same snake_case form
 * before comparison, closing that class of bypass. This also now scans
 * *string values*, not just keys — an internal ref such as
 * `"pilot_metric:secret"` nested under an innocuous key (e.g. a generic
 * `refs` array) is caught by its own internal-namespace prefix.
 */
function normalizeIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[\s._-]+/gu, "_")
    .replace(/_{2,}/gu, "_")
    .toLowerCase();
}

const INTERNAL_VALUE_PREFIXES = ["pilot_metric:", "pilot_feedback:"];

function snapshotContainsInternalReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => snapshotContainsInternalReference(entry));
  if (typeof value === "string") {
    const normalized = normalizeIdentifier(value);
    return INTERNAL_VALUE_PREFIXES.some((prefix) => normalized.includes(prefix));
  }
  if (value === null || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (INTERNAL_KEYS.has(normalizeIdentifier(key)) || snapshotContainsInternalReference(nested)) return true;
  }
  return false;
}

export function epic5TextIsSafe(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && claimSafeForbiddenPhrase(value) === undefined && sourceTextForbiddenPhrase(value) === undefined && piiTextForbidden(value) === undefined && !/\b(?:auditor\s+approved|certification\s+granted|absence\s+of\s+vulnerabilities|pilot[_ -]?(?:metric|feedback|learning)|internal learning|unit economics|private notes)\b/iu.test(value);
}

export function meaningfulText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

export function epic5Action(type: string, label: string, actionable = true): AccessibleAction {
  return { type, label, accessibleLabel: label, hoverOnly: false, minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx, actionable };
}

export function copyActions(values: Array<{ type: string; label: string; value: string }>): Array<AccessibleAction & { value: string }> {
  return values.map((entry) => ({ ...epic5Action(entry.type, entry.label), value: entry.value }));
}

/**
 * C6-27: this is a module-level singleton shared by every caller of every
 * Epic 5 view. `as const` only affects TypeScript's static types; without an
 * explicit runtime freeze, one caller mutating `.focusRing` or `.reducedMotion`
 * would leak into every other view built afterward. Frozen (including the
 * nested object) so the shared identity can never be corrupted at runtime.
 */
export const epic5Accessibility = Object.freeze({
  minTargetSizePx: codeAttestDesignTokens.accessibility.minimumTargetSizePx,
  focusRing: Object.freeze({ widthPx: codeAttestDesignTokens.accessibility.focusRingWidthPx, color: codeAttestDesignTokens.accessibility.focusRingColor }),
  reducedMotion: codeAttestDesignTokens.motion,
  doesNotRelyOnColor: true as const
});
