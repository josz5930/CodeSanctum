import { snapshotJsonData } from "../../protocol-ts/src/index.js";

/**
 * C6-01: delegates to the shared, exception-safe protocol-ts snapshot
 * implementation instead of running its own boolean-only reflection scan.
 * Callers that only need the legacy `{valid, payloadFieldPresent}` shape can
 * keep using this; callers that need to avoid re-reading the caller-owned
 * original after validation should call `snapshotJsonData` directly and use
 * its returned `value`.
 */
export function scanJsonSafety(value: unknown): { valid: boolean; payloadFieldPresent: boolean } {
  const result = snapshotJsonData(value);
  return result.ok ? { valid: true, payloadFieldPresent: result.payloadFieldPresent } : { valid: false, payloadFieldPresent: false };
}
