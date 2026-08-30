import type { DeletionEvidence } from "../../../protocol-ts/src/index.js";
import { unverifiedDeletionAttempt, verifiedDeletionRecord } from "../deletion-evidence-append.js";
import {
  isEnvelope,
  isSourceDerivedClass,
  unwrapEnvelope,
  wrapEnvelope,
  type EnvelopeKey
} from "../envelope-encryption.js";
import type {
  AllowedAccess,
  ArtifactGetResult,
  ArtifactPutInput,
  ArtifactStore,
  DeletionOutcome,
  EvidenceLifecycleLogStore
} from "../ports.js";

/**
 * Bytes are keyed by digest, so a duplicate write is a no-op by construction
 * and there is no partial-overwrite state to reason about.
 *
 * `get` is the only door to bytes and it demands an allowed access decision.
 * The decision's lifecycle event is appended before any bytes are returned; if
 * that append is rejected, the read fails. This is what makes access logging a
 * property of the store rather than a convention its callers are asked to obey.
 */
export function createMemoryArtifactStore(
  lifecycleLog: EvidenceLifecycleLogStore,
  options?: { envelope?: EnvelopeKey; objectMap?: Map<string, Uint8Array> }
): ArtifactStore {
  const objects = options?.objectMap ?? new Map<string, Uint8Array>();
  const envelope = options?.envelope;
  const deletionEvidence = new Map<string, DeletionEvidence>();

  return {
    async put(input: ArtifactPutInput) {
      if (objects.has(input.digest)) {
        return { outcome: "already_present" as const };
      }
      if (isSourceDerivedClass(input.classification.source_derived_class)) {
        if (envelope === undefined) {
          return { outcome: "encryption_unavailable" as const };
        }
        objects.set(input.digest, wrapEnvelope(input.bytes, envelope));
        return { outcome: "stored" as const };
      }
      objects.set(input.digest, Uint8Array.from(input.bytes));
      return { outcome: "stored" as const };
    },

    async get(input: { access: AllowedAccess; digest: string }): Promise<ArtifactGetResult> {
      const bytes = objects.get(input.digest);
      // A miss is reported before logging: an access event for a nonexistent
      // artifact would imply an inspection that never happened.
      if (bytes === undefined) {
        return { outcome: "not_found" };
      }

      const appended = await lifecycleLog.append(input.access.event.review_id, input.access.event);
      if (appended.outcome === "rejected") {
        return { outcome: "access_not_logged" };
      }

      if (isEnvelope(bytes)) {
        if (envelope === undefined) {
          return { outcome: "decryption_failed" };
        }
        const opened = unwrapEnvelope(bytes, envelope);
        if (!opened.ok) {
          return { outcome: "decryption_failed" };
        }
        return { outcome: "read", bytes: Uint8Array.from(opened.plaintext) };
      }

      return { outcome: "read", bytes: Uint8Array.from(bytes) };
    },

    async delete(input: { digest: string; evidence: DeletionEvidence }): Promise<DeletionOutcome> {
      const attempt = unverifiedDeletionAttempt(input.evidence);
      deletionEvidence.set(attempt.deletion_evidence_id, attempt);
      objects.delete(input.digest);
      // Verification is a re-read confirming absence, not an assumption that
      // the delete call succeeded. The verified result is a new append.
      const stillPresent = objects.has(input.digest);
      if (stillPresent) {
        return { outcome: "not_verified", evidence: attempt };
      }
      const verified = verifiedDeletionRecord(attempt);
      deletionEvidence.set(verified.deletion_evidence_id, verified);
      return { outcome: "deleted", evidence: verified };
    },

    async findDeletionEvidence(deletionEvidenceId: string) {
      return deletionEvidence.get(deletionEvidenceId);
    }
  };
}
