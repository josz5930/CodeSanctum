import assert from "node:assert/strict";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";
import { importCompiled } from "./helpers/compile.mjs";
import { buildTestServer as buildIdentityServer, loginAs, SEEDED } from "./helpers/identity-fixtures.mjs";
import { APP_URL, postgresAvailable, withMigratedPostgres } from "./helpers/postgres-harness.mjs";
import { buildTestServer as buildSubmissionServer, submitSyntheticBundle, REVIEW_ID, SYNTHETIC_OBJECT_ENVELOPE, syntheticBundle, syntheticGate } from "./helpers/submission-fixtures.mjs";

if (!(await postgresAvailable())) {
  console.log("reviewer-postgres test skipped: no database reachable.");
  process.exit(0);
}

const {
  createFilesystemObjectStore,
  createPostgresArtifactStore,
  createPostgresClassificationStore,
  createPostgresEvidenceLifecycleLogStore,
  createPostgresPool,
  createPostgresReviewEventLogStore
} = await importEvidenceStoreCompiled("src/index.js");
const { seedEnvironmentGate } = await import("../../../scripts/seed-environment-gate.mjs");
const { createServer } = await importCompiled("src/server.js");
const { registerActorResolution } = await importCompiled("src/auth/resolve-actor.js");
const { registerAuthRoutes } = await importCompiled("src/routes/auth.js");
const { registerReviewerRoutes } = await importCompiled("src/routes/reviewer.js");
const { errorEnvelope } = await importCompiled("src/error-envelope.js");
const { createMemoryReviewRecordStore } = await importCompiled("src/web/record-store.js");
const { createMemoryReviewOwnershipReader } = await importCompiled("src/web/review-ownership.js");
const { createPostgresFindingClassificationRecordStore } = await importCompiled("src/reviewer/classification-store.js");
const { drainNormalizeJobs, WORKER_ACTOR_ID } = await importCompiled("src/worker/normalize-job.js");
const { createPostgresArtifactPresenceReader, createPostgresNormalizationOutcomeStore } = await importCompiled("src/worker/normalization-records.js");
const { createSubmissionAccessMinter } = await importCompiled("src/submission/access.js");
const { validateProtocolSchema } = await importCompiled("../../packages/protocol-ts/src/index.js");

// The submission credential names the same review as the bundle's review
// scope, as a provisioned credential must (C13).
const BUNDLE_REVIEW = REVIEW_ID;

async function expectPermissionDenied(pool, statement) {
  await assert.rejects(pool.query(statement), (error) => error.code === "42501", statement);
}

await withMigratedPostgres(async () => {
  const pool = createPostgresPool(APP_URL);
  try {
    // --- a real submission, normalized by the worker into a stored draft set ---
    await seedEnvironmentGate(pool, { version: 1, gate: await syntheticGate() });
    const objectStoreRoot = await mkdtemp(path.join(tmpdir(), "onevps-host-reviewer-pg-"));
    await chmod(objectStoreRoot, 0o700);
    const { server: intake, deps } = await buildSubmissionServer({ pool, objectStoreRoot });
    await submitSyntheticBundle(intake, await syntheticBundle());
    const workerNow = () => "2026-08-16T12:05:00Z";
    const outcomes = createPostgresNormalizationOutcomeStore(pool);
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
        createSubmissionAccessMinter(deps.evidenceLifecycleLog, workerNow, { actorId: WORKER_ACTOR_ID, purpose: "finding_normalization", idempotencyScope: `normalize:${jobAttempt}` })(attempt, reference),
      environmentProfile: deps.boundGate.environment_profile,
      now: workerNow,
      log: () => {}
    });
    assert.equal(drained.normalized, 1);
    await intake.close();

    // --- the host as main.ts composes it, over the same database ---------------
    // Accounts and sessions come from the identity harness: the reviewer there
    // has TOTP, and this tenant is the one the submission credential names.
    const { ports: identity } = await buildIdentityServer();
    const evidenceLifecycleLog = createPostgresEvidenceLifecycleLogStore(pool);
    const reviewEventLog = createPostgresReviewEventLogStore(pool);
    const reviewOwnership = createMemoryReviewOwnershipReader();
    reviewOwnership.seedOwner(BUNDLE_REVIEW, SEEDED.reviewer.tenant_id);
    const classifications = createPostgresFindingClassificationRecordStore(pool);
    let tick = Date.parse("2026-08-20T00:00:00Z");
    const server = createServer({ isReady: () => true });
    server.decorate("ports", { evidenceLifecycleLog, reviewEventLog, records: createMemoryReviewRecordStore(), reviewOwnership });
    server.decorate("now", () => {
      tick += 1000;
      return new Date(tick).toISOString().replace(/\.000Z$/, "Z");
    });
    registerActorResolution(server, { accounts: identity.accounts, sessions: identity.sessions, sessionCookieSecure: true });
    await registerAuthRoutes(server, {
      accounts: identity.accounts,
      sessions: identity.sessions,
      throttle: identity.throttle,
      totpKey: identity.totpKey,
      sessionCookieSecure: true,
      errorEnvelope
    });
    await registerReviewerRoutes(server, {
      outcomes,
      artifacts: createPostgresArtifactStore({
        sql: pool,
        objects: createFilesystemObjectStore(objectStoreRoot),
        lifecycleLog: evidenceLifecycleLog,
        envelope: SYNTHETIC_OBJECT_ENVELOPE
      }),
      objectClassifications: createPostgresClassificationStore(pool),
      classifications,
      errorEnvelope
    });
    await server.ready();

    const cookie = await loginAs(server, SEEDED.reviewer);
    // The queue finds the review through the attempt's tenant in Postgres.
    const queue = await server.inject({ method: "GET", url: "/web/reviewer/queue", headers: { cookie } });
    assert.equal(queue.statusCode, 200, queue.body);
    assert.deepEqual(queue.json().reviews, [{ reviewScope: BUNDLE_REVIEW, normalized: 1, rejected: 0 }]);
    assert.deepEqual(await outcomes.listReviewsForTenant("tenant-someone-else"), []);
    const drafts = await server.inject({ method: "GET", url: `/web/reviewer/reviews/${encodeURIComponent(BUNDLE_REVIEW)}/drafts`, headers: { cookie } });
    assert.equal(drafts.statusCode, 200, drafts.body);
    const [set] = drafts.json().draftSets;
    assert.equal(set.available, true, JSON.stringify(set));
    assert.ok(set.drafts.length > 0, "the synthetic bundle yields at least one draft");
    const [draft] = set.drafts;
    assert.equal(draft.workbench.available, true);

    // The draft set was read through the envelope key, and the read left its
    // access receipt in Postgres.
    const accessRows = await pool.query(
      "SELECT body_query FROM evidence_lifecycle_event WHERE review_id = $1 AND body_query ->> 'purpose' = 'reviewer_classification'",
      [BUNDLE_REVIEW]
    );
    assert.equal(accessRows.rows.length, 1);

    // --- classify the real draft: the normalizer's evidence binding holds ------
    const recorded = await server.inject({
      method: "POST",
      url: `/web/reviewer/reviews/${encodeURIComponent(BUNDLE_REVIEW)}/classifications`,
      headers: { cookie },
      payload: {
        draft_set_digest: set.draftSetDigest,
        review_finding_draft_ref: draft.draftRef,
        classification: "inconclusive",
        rationale: "The metadata-only evidence cannot settle whether this finding is real.",
        limitations: ["Metadata-only coverage carries no source context for this finding."]
      }
    });
    assert.equal(recorded.statusCode, 201, recorded.body);
    const { classification_record_id: recordId, event_id: eventId } = recorded.json();

    const rows = await pool.query("SELECT review_id, review_finding_draft_ref, draft_set_digest, record_body FROM finding_classification_record");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].draft_set_digest, set.draftSetDigest);
    const record = JSON.parse(rows.rows[0].record_body);
    assert.equal(record.classification_record_id, recordId);
    assert.deepEqual(validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", record), []);
    const events = await reviewEventLog.loadLog(BUNDLE_REVIEW);
    assert.deepEqual(events.map((event) => event.event_type), ["receipt_issued", "classification_recorded"]);
    assert.equal(events[1].event_id, eventId);

    // --- the next judgment supersedes it, read back from Postgres --------------
    const changed = await server.inject({
      method: "POST",
      url: `/web/reviewer/reviews/${encodeURIComponent(BUNDLE_REVIEW)}/classifications`,
      headers: { cookie },
      payload: {
        draft_set_digest: set.draftSetDigest,
        review_finding_draft_ref: draft.draftRef,
        classification: "likely",
        rationale: "A second look at the scanner output points to a likely finding.",
        limitations: ["Metadata-only coverage carries no source context for this finding."]
      }
    });
    assert.equal(changed.statusCode, 201, changed.body);
    assert.equal(changed.json().supersedes_classification_record_ref, recordId);
    const reread = (await server.inject({ method: "GET", url: `/web/reviewer/reviews/${encodeURIComponent(BUNDLE_REVIEW)}/drafts`, headers: { cookie } })).json();
    const current = reread.draftSets[0].drafts.find((entry) => entry.draftRef === draft.draftRef).current;
    assert.equal(current.classification, "likely");
    assert.equal(current.recordRef, changed.json().classification_record_id);

    // --- classification records are append-only for codeattest_app -------------
    await expectPermissionDenied(pool, "UPDATE finding_classification_record SET record_body = '{}'");
    await expectPermissionDenied(pool, "DELETE FROM finding_classification_record");
    await server.close();
  } finally {
    await pool.end();
  }
});

console.log("reviewer-postgres test passed.");
