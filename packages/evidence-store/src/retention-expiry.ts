import type { DeletionEvidence, RetentionOptInRecord, StoredObjectClassification } from "../../protocol-ts/src/index.js";
import type { ArtifactStore, JobQueue, RetentionRecordStore } from "./ports.js";

export const RETENTION_EXPIRY_JOB_TYPE = "retention_expiry";

export function retentionPolicyForClassification(
  classification: StoredObjectClassification,
  retentionRecord: RetentionOptInRecord | undefined
): { ok: true } | { ok: false; reason: "missing_policy" } {
  if (classification.source_derived_class === "customer_opt_in_retained_source" && retentionRecord === undefined) {
    return { ok: false, reason: "missing_policy" };
  }
  return { ok: true };
}

export async function catchUpRetentionExpiry(input: {
  jobs: JobQueue;
  retentionRecords: RetentionRecordStore;
  now: string;
}): Promise<{ enqueued: number }> {
  const due = await input.retentionRecords.listDue(input.now);
  let enqueued = 0;
  for (const record of due) {
    const result = await input.jobs.enqueue({
      job_id: record.retention_record_id,
      job_type: RETENTION_EXPIRY_JOB_TYPE,
      payload: JSON.stringify({
        retention_record_id: record.retention_record_id,
        end_timestamp: record.retention_period.end_timestamp,
        artifact_digests: record.retained_artifact_refs.filter((ref) => ref.startsWith("sha256:"))
      })
    });
    if (result.outcome === "enqueued") {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export async function processRetentionExpiryJob(input: {
  jobs: JobQueue;
  artifacts: ArtifactStore;
  retentionRecords: RetentionRecordStore;
  now: string;
  actor: DeletionEvidence["actor"];
}): Promise<{ processed: number; refused: string[]; failed: string[] }> {
  let processed = 0;
  const refused: string[] = [];
  const failed: string[] = [];
  for (;;) {
    const job = await input.jobs.claim(RETENTION_EXPIRY_JOB_TYPE);
    if (job === undefined) {
      return { processed, refused, failed };
    }
    const payload = JSON.parse(job.payload) as {
      retention_record_id?: string;
      end_timestamp?: string;
      artifact_digests?: string[];
    };
    if (typeof payload.end_timestamp !== "string" || typeof payload.retention_record_id !== "string") {
      refused.push("missing_policy");
      await input.jobs.complete(job.job_id);
      continue;
    }
    if (payload.end_timestamp > input.now) {
      await input.jobs.fail(job.job_id);
      continue;
    }
    const record = await input.retentionRecords.find(payload.retention_record_id);
    if (record === undefined) {
      refused.push("missing_policy");
      await input.jobs.complete(job.job_id);
      continue;
    }
    const digests = Array.isArray(payload.artifact_digests) ? payload.artifact_digests.filter((digest) => digest.startsWith("sha256:")) : [];
    // A throw from artifacts.delete() mid-loop must not propagate: that would
    // leave the claimed job neither completed nor failed — a stuck or lost
    // purge depending on the queue's lease semantics. Route it to fail() so it
    // is re-claimable, and stop this drain pass rather than looping (fail()
    // un-claims the job, so continuing would immediately re-claim it).
    try {
      for (const artifactDigest of digests) {
        const local = artifactDigest.slice("sha256:".length, "sha256:".length + 24);
        const evidence: DeletionEvidence = {
          protocol_version: "codeattest.v0",
          deletion_evidence_id: `deletion_evidence:exp_${local}`,
          deleted_artifact_digests: [artifactDigest],
          deletion_method: "expiry_purge",
          deletion_timestamp: input.now,
          actor: input.actor,
          verification_status: "unverified"
        };
        await input.artifacts.delete({ digest: artifactDigest, evidence });
      }
    } catch {
      await input.jobs.fail(job.job_id);
      failed.push(job.job_id);
      return { processed, refused, failed };
    }
    await input.jobs.complete(job.job_id);
    processed += 1;
  }
}

export async function operatorDeleteArtifact(input: {
  artifacts: ArtifactStore;
  digest: string;
  actor: DeletionEvidence["actor"];
  now: string;
}): Promise<ReturnType<ArtifactStore["delete"]>> {
  const local = input.digest.slice("sha256:".length, "sha256:".length + 24) || "operator";
  return input.artifacts.delete({
    digest: input.digest,
    evidence: {
      protocol_version: "codeattest.v0",
      deletion_evidence_id: `deletion_evidence:op_${local}`,
      deleted_artifact_digests: [input.digest],
      deletion_method: "secure_delete",
      deletion_timestamp: input.now,
      actor: input.actor,
      verification_status: "unverified"
    }
  });
}
