import assert from "node:assert/strict";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { postgresAvailable, withMigratedPostgres, APP_URL } from "./helpers/postgres-harness.mjs";
import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";
import { buildTestServer, submitSyntheticBundle, syntheticBundle, syntheticGate, REVIEW_ID } from "./helpers/submission-fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

if (!(await postgresAvailable())) {
  console.log("worker-postgres test skipped: no database reachable.");
  process.exit(0);
}

const { createPostgresPool, createPostgresReviewEventLogStore, releaseStaleJobClaims } = await importEvidenceStoreCompiled("src/index.js");
const { seedEnvironmentGate } = await import("../../../scripts/seed-environment-gate.mjs");
const { drainNormalizeJobs, WORKER_ACTOR_ID } = await importCompiled("src/worker/normalize-job.js");
const { createPostgresNormalizationOutcomeStore, createPostgresArtifactPresenceReader } = await importCompiled("src/worker/normalization-records.js");
const { createHttpTransparencyAnchor, createPostgresCheckpointPublicationStore, loadReviewHeads, runTransparencyCheckpoint } = await importCompiled("src/worker/transparency.js");
const { createSubmissionAccessMinter } = await importCompiled("src/submission/access.js");

const now = () => "2026-08-16T12:05:00Z";

async function expectPermissionDenied(pool, statement) {
  await assert.rejects(pool.query(statement), (error) => error.code === "42501", statement);
}

await withMigratedPostgres(async () => {
  const pool = createPostgresPool(APP_URL);
  try {
    await seedEnvironmentGate(pool, { version: 1, gate: await syntheticGate() });
    const objectStoreRoot = await mkdtemp(path.join(tmpdir(), "onevps-host-worker-pg-"));
    await chmod(objectStoreRoot, 0o700);
    const { server, deps } = await buildTestServer({ pool, objectStoreRoot });
    const bundle = await syntheticBundle();
    const finalized = await submitSyntheticBundle(server, bundle);
    const attemptId = bundle.bundle_manifest.submission_attempt_id;

    // --- the receipt row the finalize wrote ------------------------------------
    const receiptRows = await pool.query("SELECT vendor_receipt_id, submission_attempt_id FROM submission_vendor_receipt");
    assert.deepEqual(receiptRows.rows, [{ vendor_receipt_id: finalized.submission_outcome.vendor_receipt_ref, submission_attempt_id: attemptId }]);

    // --- normalize through the Postgres stores ----------------------------------
    const outcomes = createPostgresNormalizationOutcomeStore(pool);
    const logs = [];
    const drained = await drainNormalizeJobs({
      jobs: deps.jobs,
      attempts: deps.attempts,
      receipts: deps.receipts,
      artifacts: deps.artifacts,
      classifications: deps.classifications,
      presence: createPostgresArtifactPresenceReader(pool),
      outcomes,
      verifier: deps.keyService.verifier,
      mintAccess: (jobAttempt, attempt, reference) =>
        createSubmissionAccessMinter(deps.evidenceLifecycleLog, now, { actorId: WORKER_ACTOR_ID, purpose: "finding_normalization", idempotencyScope: `normalize:${jobAttempt}` })(attempt, reference),
      environmentProfile: deps.boundGate.environment_profile,
      now,
      log: (entry) => logs.push(entry)
    });
    assert.deepEqual(drained, { normalized: 1, rejected: 0, failed: [] }, JSON.stringify(logs));
    const outcomeRows = await pool.query("SELECT outcome, review_id, draft_set_digest, rejection_reason FROM finding_normalization_outcome");
    assert.equal(outcomeRows.rows.length, 1);
    assert.equal(outcomeRows.rows[0].outcome, "normalized");
    assert.equal(outcomeRows.rows[0].review_id, REVIEW_ID);
    assert.equal(outcomeRows.rows[0].rejection_reason, null);
    const draftDigest = outcomeRows.rows[0].draft_set_digest;
    assert.deepEqual((await outcomes.find(attemptId)), { submission_attempt_id: attemptId, review_id: REVIEW_ID, outcome: "normalized", draft_set_digest: draftDigest });
    const draftRef = await pool.query("SELECT digest FROM artifact_reference WHERE digest = $1", [draftDigest]);
    assert.equal(draftRef.rows.length, 1, "the draft set is stored as an object, not as SQL text");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM job")).rows[0].n, 0);

    // --- the presence reader sees stored, deleted, and unknown digests ----------
    const presence = createPostgresArtifactPresenceReader(pool);
    const [someDigest] = bundle.bundle_manifest.artifact_references.map((reference) => reference.digest);
    const unknownDigest = `sha256:${"e".repeat(64)}`;
    let seen = await presence([someDigest, unknownDigest]);
    assert.deepEqual(seen.get(someDigest), { state: "stored" });
    assert.deepEqual(seen.get(unknownDigest), { state: "unknown" });
    await deps.artifacts.delete({
      digest: someDigest,
      evidence: {
        protocol_version: "codeattest.v0",
        deletion_evidence_id: "deletion_evidence:worker_pg_test",
        deleted_artifact_digests: [someDigest],
        deletion_method: "secure_delete",
        deletion_timestamp: now(),
        actor: { actor_type: "vendor_service", actor_id: WORKER_ACTOR_ID },
        verification_status: "unverified"
      }
    });
    seen = await presence([someDigest]);
    assert.deepEqual(seen.get(someDigest), { state: "deleted", deletion_evidence_id: "deletion_evidence:worker_pg_test_verified" });

    // --- a claim left by a dead worker goes back to the queue -------------------
    await deps.jobs.enqueue({ job_id: "job:stale", job_type: "normalize_scanner_findings", payload: "{}" });
    assert.ok(await deps.jobs.claim("normalize_scanner_findings"));
    assert.equal(await deps.jobs.claim("normalize_scanner_findings"), undefined, "a claimed job is not claimable");
    assert.equal(await releaseStaleJobClaims(pool, 900), 0, "a fresh claim is left alone");
    await pool.query("UPDATE job SET claimed_at = now() - interval '1 hour' WHERE job_id = 'job:stale'");
    assert.equal(await releaseStaleJobClaims(pool, 900), 1);
    const reclaimed = await deps.jobs.claim("normalize_scanner_findings");
    assert.equal(reclaimed.job_id, "job:stale");
    assert.equal(reclaimed.attempts, 2, "the attempt count carries over, so the attempt cap still applies");
    await deps.jobs.complete("job:stale");

    // --- checkpoint over the real review heads ---------------------------------
    const heads = await loadReviewHeads(pool, createPostgresReviewEventLogStore(pool));
    assert.equal(heads.length, 1);
    assert.equal(heads[0].review_id, REVIEW_ID);
    assert.match(heads[0].head_hash, /^[a-f0-9]{64}$/);
    const objects = new Map();
    const anchor = createHttpTransparencyAnchor({
      baseUrl: "https://anchor.example.invalid",
      token: "synthetic-anchor-token",
      fetchImpl: async (url, init = {}) => {
        if (init.method === "PUT") {
          objects.set(url, init.body);
          return new Response(null, { status: 204 });
        }
        return objects.has(url) ? new Response(objects.get(url), { status: 200 }) : new Response("", { status: 404 });
      }
    });
    const publications = createPostgresCheckpointPublicationStore(pool);
    const published = await runTransparencyCheckpoint({ anchor, heads, publications, now: () => "2026-10-17T01:00:00Z" });
    assert.equal(published.outcome, "published");
    const latest = await publications.latest();
    assert.equal(latest.published_at, "2026-10-17T01:00:00Z", "published_at round-trips exactly, so the checkpoint id still matches");
    assert.equal(latest.anchor_ref, `https://anchor.example.invalid/checkpoints/${published.checkpoint_id}`);
    const unchanged = await runTransparencyCheckpoint({ anchor, heads, publications, now: () => "2026-10-17T02:00:00Z" });
    assert.equal(unchanged.outcome, "unchanged");
    const anchored = await pool.query("SELECT review_id, head_event_id FROM chain_head_anchor");
    assert.deepEqual(anchored.rows, [{ review_id: REVIEW_ID, head_event_id: heads[0].head_event_id }]);

    // --- the new tables are append-only for codeattest_app ---------------------
    for (const table of ["submission_vendor_receipt", "finding_normalization_outcome", "transparency_checkpoint_publication"]) {
      await expectPermissionDenied(pool, `UPDATE ${table} SET recorded_at = now()`);
      await expectPermissionDenied(pool, `DELETE FROM ${table}`);
    }
  } finally {
    await pool.end();
  }
});

console.log("worker-postgres test passed.");
