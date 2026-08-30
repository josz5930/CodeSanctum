import type { DeletionEvidence } from "../../protocol-ts/src/index.js";

export function unverifiedDeletionAttempt(evidence: DeletionEvidence): DeletionEvidence {
  return {
    protocol_version: evidence.protocol_version,
    deletion_evidence_id: evidence.deletion_evidence_id,
    deleted_artifact_digests: evidence.deleted_artifact_digests,
    deletion_method: evidence.deletion_method,
    deletion_timestamp: evidence.deletion_timestamp,
    actor: evidence.actor,
    verification_status: "unverified"
  };
}

export function verifiedDeletionRecord(evidence: DeletionEvidence): DeletionEvidence {
  const attemptId = evidence.deletion_evidence_id;
  const local = attemptId.startsWith("deletion_evidence:") ? attemptId.slice("deletion_evidence:".length) : attemptId;
  const verifiedLocal = local.endsWith("_verified") ? local : `${local}_verified`;
  return {
    ...evidence,
    deletion_evidence_id: `deletion_evidence:${verifiedLocal}`,
    verification_status: "verified",
    supersedes_deletion_evidence_ref: attemptId
  };
}
