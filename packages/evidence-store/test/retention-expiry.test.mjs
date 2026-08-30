import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { makeLifecycleEvent } from "./helpers/fixtures.mjs";

const { createMemoryArtifactStore } = await importCompiled("src/memory/artifact-store.js");
const { createMemoryEvidenceLifecycleLogStore } = await importCompiled("src/memory/evidence-lifecycle-log-store.js");
const { createMemoryJobQueue } = await importCompiled("src/memory/job-queue.js");
const { createMemoryRetentionRecordStore } = await importCompiled("src/memory/record-stores.js");
const {
  catchUpRetentionExpiry,
  operatorDeleteArtifact,
  processRetentionExpiryJob,
  retentionPolicyForClassification
} = await importCompiled("src/retention-expiry.js");

const DIGEST = "sha256:" + "d".repeat(64);
const BYTES = new TextEncoder().encode("SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE");
const NOW = "2026-08-26T00:00:00Z";
const ACTOR = { actor_type: "vendor_service", actor_id: "vendor:synthetic_demo" };

function classification(sourceDerivedClass) {
  return {
    protocol_version: "codeattest.v0",
    stored_object_ref: "stored_object:synthetic_demo_1",
    object_kind: "evidence_artifact",
    source_derived_class: sourceDerivedClass,
    environment_profile: "synthetic_demo"
  };
}

assert.equal(retentionPolicyForClassification(classification("customer_opt_in_retained_source"), undefined).reason, "missing_policy");
assert.equal(retentionPolicyForClassification(classification("transient_source_derived"), undefined).ok, true);

const retention = {
  protocol_version: "codeattest.v0",
  retention_record_id: "retention_record:opt_in_due",
  source_derived_class: "customer_opt_in_retained_source",
  customer_approval_ref: "approval:synthetic-demo-opt-in-0001",
  retention_period: {
    start_timestamp: "2026-07-19T00:00:00Z",
    end_timestamp: NOW
  },
  retained_artifact_refs: ["artifact_ref:opt_in_snippet_001"]
};

{
  const jobs = createMemoryJobQueue();
  const retentionRecords = createMemoryRetentionRecordStore();
  await retentionRecords.record(retention);
  await retentionRecords.record({
    ...retention,
    retention_record_id: "retention_record:opt_in_future",
    retention_period: {
      start_timestamp: "2026-07-19T00:00:00Z",
      end_timestamp: "2026-12-01T00:00:00Z"
    }
  });
  const first = await catchUpRetentionExpiry({ jobs, retentionRecords, now: NOW });
  assert.equal(first.enqueued, 1);
  const second = await catchUpRetentionExpiry({ jobs, retentionRecords, now: NOW });
  assert.equal(second.enqueued, 0, "catch-up is idempotent while the job is still queued");
}

{
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const artifacts = createMemoryArtifactStore(lifecycleLog);
  const jobs = createMemoryJobQueue();
  const retentionRecords = createMemoryRetentionRecordStore();
  await retentionRecords.record(retention);
  await artifacts.put({
    digest: DIGEST,
    bytes: BYTES,
    classification: classification("retained_review_artifact"),
    reviewId: "review:synthetic_demo_expiry"
  });
  await jobs.enqueue({
    job_id: retention.retention_record_id,
    job_type: "retention_expiry",
    payload: JSON.stringify({
      retention_record_id: retention.retention_record_id,
      end_timestamp: NOW,
      artifact_digests: [DIGEST]
    })
  });
  const processed = await processRetentionExpiryJob({
    jobs,
    artifacts,
    retentionRecords,
    now: NOW,
    actor: ACTOR
  });
  assert.equal(processed.processed, 1);
  const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: "review:synthetic_demo_expiry" }) };
  assert.equal((await artifacts.get({ access, digest: DIGEST })).outcome, "not_found");
}

{
  const jobs = createMemoryJobQueue();
  const retentionRecords = createMemoryRetentionRecordStore();
  await jobs.enqueue({
    job_id: "retention_record:missing_end",
    job_type: "retention_expiry",
    payload: JSON.stringify({ retention_record_id: "retention_record:missing_end" })
  });
  const processed = await processRetentionExpiryJob({
    jobs,
    artifacts: createMemoryArtifactStore(createMemoryEvidenceLifecycleLogStore()),
    retentionRecords,
    now: NOW,
    actor: ACTOR
  });
  assert.deepEqual(processed.refused, ["missing_policy"]);
}

{
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const artifacts = createMemoryArtifactStore(lifecycleLog);
  await artifacts.put({
    digest: DIGEST,
    bytes: BYTES,
    classification: classification("retained_review_artifact"),
    reviewId: "review:synthetic_demo_operator"
  });
  const deleted = await operatorDeleteArtifact({
    artifacts,
    digest: DIGEST,
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic_demo" },
    now: NOW
  });
  assert.equal(deleted.outcome, "deleted");
  assert.equal(deleted.evidence.deletion_method, "secure_delete");
  assert.equal(deleted.evidence.verification_status, "verified");
  assert.equal(deleted.evidence.supersedes_deletion_evidence_ref.startsWith("deletion_evidence:"), true);
}

// C5: a throwing artifacts.delete() must not strand the job. The claimed job
// is routed to fail() (re-claimable), the worker returns rather than throwing,
// and no job is left stuck in `claimed`.
{
  const jobs = createMemoryJobQueue();
  const retentionRecords = createMemoryRetentionRecordStore();
  await retentionRecords.record(retention);
  const throwingArtifacts = {
    async delete() {
      throw new Error("simulated storage failure");
    }
  };
  await jobs.enqueue({
    job_id: retention.retention_record_id,
    job_type: "retention_expiry",
    payload: JSON.stringify({
      retention_record_id: retention.retention_record_id,
      end_timestamp: NOW,
      artifact_digests: [DIGEST]
    })
  });
  const result = await processRetentionExpiryJob({
    jobs,
    artifacts: throwingArtifacts,
    retentionRecords,
    now: NOW,
    actor: ACTOR
  });
  assert.deepEqual(result.failed, [retention.retention_record_id], "the delete failure must be reported");
  assert.equal(result.processed, 0);
  // The job is re-claimable: fail() returned it to the queue, so a later worker
  // pass (with a working store) can claim and complete it. No job is stranded.
  const reclaimed = await jobs.claim("retention_expiry");
  assert.notEqual(reclaimed, undefined, "the failed job must be re-claimable, not stuck in claimed");
  assert.equal(reclaimed.job_id, retention.retention_record_id);
}

console.log("retention-expiry test passed.");
