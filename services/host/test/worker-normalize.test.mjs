import assert from "node:assert/strict";

import { buildTestServer, submitSyntheticBundle, syntheticBundle, REVIEW_ID } from "./helpers/submission-fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { drainNormalizeJobs, WORKER_ACTOR_ID } = await importCompiled("src/worker/normalize-job.js");
const { createMemoryNormalizationOutcomeStore, createMemoryArtifactPresenceReader } = await importCompiled("src/worker/normalization-records.js");
const { createSubmissionAccessMinter } = await importCompiled("src/submission/access.js");
const { validateProtocolSchema } = await importCompiled("../../packages/protocol-ts/src/index.js");

const NORMALIZE = "normalize_scanner_findings";
const now = () => "2026-08-16T12:05:00Z";

function workerDeps(deps, overrides = {}) {
  const logs = [];
  return {
    logs,
    workerDeps: {
      jobs: deps.jobs,
      attempts: deps.attempts,
      receipts: deps.receipts,
      artifacts: deps.artifacts,
      classifications: deps.classifications,
      presence: createMemoryArtifactPresenceReader(deps.classifications),
      outcomes: createMemoryNormalizationOutcomeStore(),
      verifier: deps.keyService.verifier,
      mintAccess: (jobAttempt, attempt, reference) =>
        createSubmissionAccessMinter(deps.evidenceLifecycleLog, now, {
          actorId: WORKER_ACTOR_ID,
          purpose: "finding_normalization",
          idempotencyScope: `normalize:${jobAttempt}`
        })(attempt, reference),
      environmentProfile: deps.boundGate.environment_profile,
      now,
      log: (entry) => logs.push(entry),
      ...overrides
    }
  };
}

// --- a received submission is normalized and its draft set stored --------------
{
  const { server, deps } = await buildTestServer();
  const bundle = await syntheticBundle();
  const finalized = await submitSyntheticBundle(server, bundle);
  assert.equal(finalized.submission_outcome.outcome_state, "received_with_receipt");
  const attemptId = bundle.bundle_manifest.submission_attempt_id;

  const { workerDeps: worker, logs } = workerDeps(deps);
  const drained = await drainNormalizeJobs(worker);
  assert.deepEqual(drained, { normalized: 1, rejected: 0, failed: [] }, JSON.stringify(logs));
  assert.equal(await deps.jobs.claim(NORMALIZE), undefined, "the job is taken off the queue");

  const recorded = await worker.outcomes.find(attemptId);
  assert.equal(recorded.outcome, "normalized");
  assert.equal(recorded.review_id, REVIEW_ID);
  assert.match(recorded.draft_set_digest, /^sha256:[a-f0-9]{64}$/);

  // The draft set is an encrypted, classified object, readable only through a
  // logged access decision like every other artifact.
  const classification = await deps.classifications.find(`stored_object:${recorded.draft_set_digest.slice("sha256:".length)}`);
  assert.equal(classification.source_derived_class, "retained_review_artifact");
  const access = await createSubmissionAccessMinter(deps.evidenceLifecycleLog, now, { idempotencyScope: "test-read" })(
    await deps.attempts.find(attemptId),
    { artifact_ref: "artifact_ref:draft_set", digest: recorded.draft_set_digest, source_derived_class: "retained_review_artifact" }
  );
  const read = await deps.artifacts.get({ access, digest: recorded.draft_set_digest });
  assert.equal(read.outcome, "read");
  const draftSet = JSON.parse(new TextDecoder().decode(read.bytes));
  assert.deepEqual(validateProtocolSchema("urn:codeattest:protocol:v0:review-finding-draft-set", draftSet), []);
  assert.equal(draftSet.vendor_receipt_ref, finalized.submission_outcome.vendor_receipt_ref);

  // The worker's own reads are in the access log under its own actor.
  const lifecycle = await deps.evidenceLifecycleLog.loadLog(REVIEW_ID);
  const workerReads = lifecycle.filter((event) => event.actor?.actor_id === WORKER_ACTOR_ID);
  assert.equal(workerReads.length, 2, "the worker reads the review scope and the scanner finding set, nothing else");

  // A replayed finalize enqueues the job again; the worker sees the recorded
  // result and does not normalize twice.
  await deps.jobs.enqueue({ job_id: `job:normalize:${attemptId}`, job_type: NORMALIZE, payload: JSON.stringify({ review_id: REVIEW_ID, submission_attempt_id: attemptId }) });
  assert.deepEqual(await drainNormalizeJobs(worker), { normalized: 0, rejected: 0, failed: [] });
  assert.equal(await deps.jobs.claim(NORMALIZE), undefined);

  // A job for an attempt that does not exist is recorded as rejected, once.
  await deps.jobs.enqueue({ job_id: "job:normalize:ghost", job_type: NORMALIZE, payload: JSON.stringify({ review_id: REVIEW_ID, submission_attempt_id: "submission_attempt:ghost-attempt" }) });
  assert.deepEqual(await drainNormalizeJobs(worker), { normalized: 0, rejected: 1, failed: [] });
  assert.equal((await worker.outcomes.find("submission_attempt:ghost-attempt")).rejection_reason, "worker_attempt_not_found");

  // A payload that names nothing is dropped, not retried forever.
  await deps.jobs.enqueue({ job_id: "job:normalize:junk", job_type: NORMALIZE, payload: "not json" });
  assert.deepEqual(await drainNormalizeJobs(worker), { normalized: 0, rejected: 0, failed: [] });
  assert.equal(await deps.jobs.claim(NORMALIZE), undefined);
  assert.ok(logs.some((entry) => entry.event === "normalize_job_payload_invalid"));
}

// --- a receipt whose signature does not verify is rejected, not normalized ------
{
  const { server, deps } = await buildTestServer();
  const bundle = await syntheticBundle();
  await submitSyntheticBundle(server, bundle);
  const attemptId = bundle.bundle_manifest.submission_attempt_id;
  const failingVerifier = {
    verify: (input) => ({ ...deps.keyService.verifier.verify(input), result: "failed" })
  };
  const { workerDeps: worker } = workerDeps(deps, { verifier: failingVerifier });
  assert.deepEqual(await drainNormalizeJobs(worker), { normalized: 0, rejected: 1, failed: [] });
  assert.equal((await worker.outcomes.find(attemptId)).rejection_reason, "normalization_receipt_unverified");
}

// --- a retryable failure returns the job; too many tries end in a rejection -----
{
  const { server, deps } = await buildTestServer();
  const bundle = await syntheticBundle();
  await submitSyntheticBundle(server, bundle);
  const attemptId = bundle.bundle_manifest.submission_attempt_id;
  const brokenArtifacts = { ...deps.artifacts, get: async () => ({ outcome: "decryption_failed" }) };
  const { workerDeps: worker, logs } = workerDeps(deps, { artifacts: brokenArtifacts, maxAttempts: 2 });

  const first = await drainNormalizeJobs(worker);
  assert.equal(first.failed.length, 1, "a decryption failure is retried, not recorded");
  assert.equal(await worker.outcomes.find(attemptId), undefined);
  assert.ok(logs.some((entry) => entry.event === "normalize_job_failed"));

  await drainNormalizeJobs(worker);
  const third = await drainNormalizeJobs(worker);
  assert.deepEqual(third, { normalized: 0, rejected: 1, failed: [] }, "after maxAttempts the job stops retrying");
  assert.equal((await worker.outcomes.find(attemptId)).rejection_reason, "worker_attempts_exhausted");
  assert.equal(await deps.jobs.claim(NORMALIZE), undefined);
}

console.log("worker normalize test passed.");
