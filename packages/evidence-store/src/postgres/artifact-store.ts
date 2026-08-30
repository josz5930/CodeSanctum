import type { DeletionEvidence } from "../../../protocol-ts/src/index.js";
import { unverifiedDeletionAttempt, verifiedDeletionRecord } from "../deletion-evidence-append.js";
import { toCanonicalRow } from "../canonical-row.js";
import {
  isEnvelope,
  isSourceDerivedClass,
  unwrapEnvelope,
  wrapEnvelope,
  type EnvelopeKey
} from "../envelope-encryption.js";
import type { FilesystemObjectStore } from "../filesystem/object-store.js";
import type {
  AllowedAccess,
  ArtifactGetResult,
  ArtifactPutInput,
  ArtifactStore,
  DeletionOutcome,
  EvidenceLifecycleLogStore
} from "../ports.js";
import type { SqlExecutor } from "./pool.js";

/**
 * The object store and Postgres are separate systems with no shared
 * transaction, so write order is the design:
 *
 *   Bytes before records. Orphans are inert; dangling references are not.
 *
 * Content-addressed bytes are written first, where a duplicate write is a no-op
 * by construction, and the metadata row is committed second. A crash between
 * the two leaves orphaned bytes that are unreachable, because `get` requires an
 * allowed access decision and finds no row to serve. The worst outcome is
 * wasted disk. Committing the row first would invert that into a dangling
 * reference, which is both a correctness and an audit failure.
 */
export function createPostgresArtifactStore(input: {
  sql: SqlExecutor;
  objects: FilesystemObjectStore;
  lifecycleLog: EvidenceLifecycleLogStore;
  envelope?: EnvelopeKey;
}): ArtifactStore {
  const { sql, objects, lifecycleLog, envelope } = input;

  return {
    async put(artifact: ArtifactPutInput) {
      const existing = await sql.query("SELECT digest FROM artifact_reference WHERE digest = $1", [artifact.digest]);
      if (existing.rows.length > 0) {
        return { outcome: "already_present" as const };
      }

      if (isSourceDerivedClass(artifact.classification.source_derived_class) && envelope === undefined) {
        return { outcome: "encryption_unavailable" as const };
      }
      const storedBytes = envelope !== undefined && isSourceDerivedClass(artifact.classification.source_derived_class)
        ? wrapEnvelope(artifact.bytes, envelope)
        : artifact.bytes;
      await objects.put(artifact.digest, storedBytes);

      const row = toCanonicalRow(artifact.classification);
      await sql.query(
        `INSERT INTO artifact_reference (digest, review_id, size_bytes, body)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (digest) DO NOTHING`,
        [artifact.digest, artifact.reviewId, artifact.bytes.byteLength, row.body]
      );

      return { outcome: "stored" as const };
    },

    async get(request: { access: AllowedAccess; digest: string }): Promise<ArtifactGetResult> {
      const row = await sql.query("SELECT digest FROM artifact_reference WHERE digest = $1", [request.digest]);
      // A miss is reported before logging: an access event for an artifact that
      // is not here would imply an inspection that never happened.
      if (row.rows.length === 0) {
        return { outcome: "not_found" };
      }

      const appended = await lifecycleLog.append(request.access.event.review_id, request.access.event);
      if (appended.outcome === "rejected") {
        return { outcome: "access_not_logged" };
      }

      const bytes = await objects.get(request.digest);
      if (bytes === undefined) {
        return { outcome: "not_found" };
      }
      if (isEnvelope(bytes)) {
        if (envelope === undefined) {
          return { outcome: "decryption_failed" };
        }
        const opened = unwrapEnvelope(bytes, envelope);
        if (!opened.ok) {
          return { outcome: "decryption_failed" };
        }
        return { outcome: "read", bytes: opened.plaintext };
      }
      return { outcome: "read", bytes };
    },

    async delete(request: { digest: string; evidence: DeletionEvidence }): Promise<DeletionOutcome> {
      // The mirror image of a write: record the intent, delete the bytes, then
      // confirm absence by re-reading. A crash mid-delete leaves the unverified
      // attempt in place; a later verified result is a new append, never an UPDATE.
      const attempt = unverifiedDeletionAttempt(request.evidence);
      await sql.query(
        `INSERT INTO deletion_evidence (deletion_evidence_id, body) VALUES ($1, $2)
         ON CONFLICT (deletion_evidence_id) DO NOTHING`,
        [attempt.deletion_evidence_id, toCanonicalRow(attempt).body]
      );

      await objects.remove(request.digest);

      const stillPresent = await objects.has(request.digest);
      if (stillPresent) {
        return { outcome: "not_verified", evidence: attempt };
      }
      const verified = verifiedDeletionRecord(attempt);
      await sql.query(
        `INSERT INTO deletion_evidence (deletion_evidence_id, body) VALUES ($1, $2)
         ON CONFLICT (deletion_evidence_id) DO NOTHING`,
        [verified.deletion_evidence_id, toCanonicalRow(verified).body]
      );
      return { outcome: "deleted", evidence: verified };
    },

    async findDeletionEvidence(deletionEvidenceId: string) {
      const { rows } = await sql.query(
        "SELECT body FROM deletion_evidence WHERE deletion_evidence_id = $1",
        [deletionEvidenceId]
      );
      const row = rows[0];
      return row === undefined ? undefined : (JSON.parse(row.body as string) as DeletionEvidence);
    }
  };
}
