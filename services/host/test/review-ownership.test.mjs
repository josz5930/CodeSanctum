import assert from "node:assert/strict";

import pg from "pg";

import { importCompiled } from "./helpers/compile.mjs";
import { buildTestServer, loginAs, SEEDED } from "./helpers/identity-fixtures.mjs";
import { APP_URL, MIGRATOR_URL, postgresAvailable, withMigratedPostgres } from "./helpers/postgres-harness.mjs";

const { createMemoryReviewOwnershipReader, createPostgresReviewOwnershipReader, ownerTenantFor } = await importCompiled("src/web/review-ownership.js");

// A tenant-wide grant covers the tenant's own reviews only. Before the gate
// resolved the owner, a customer in one tenant could read every route below
// for another tenant's review, and the access event landed in that tenant's log.
{
  const { server, ports } = await buildTestServer();
  const cookie = await loginAs(server, SEEDED.customer);
  const foreignLogBefore = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length;
  for (const suffix of ["", "/findings", "/attestation"]) {
    const foreign = await server.inject({
      method: "GET",
      url: `/web/reviews/${encodeURIComponent(SEEDED.reviewOutOfScope)}${suffix}`,
      headers: { cookie }
    });
    assert.equal(foreign.statusCode, 403, `foreign review${suffix}: ${foreign.body}`);
    assert.equal(foreign.json().reason_code, "evidence_access_denied");
  }
  assert.equal((await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length, foreignLogBefore, "a denied read logs nothing in the foreign tenant");

  // The tenant's own review is still readable through the same grant.
  const own = await server.inject({ method: "GET", url: `/web/reviews/${encodeURIComponent(SEEDED.reviewRejected)}`, headers: { cookie } });
  assert.equal(own.statusCode, 200, own.body);

  // A review no credential names is not readable by anyone.
  const unknown = await server.inject({ method: "GET", url: "/web/reviews/review%3Anever-provisioned", headers: { cookie } });
  assert.equal(unknown.statusCode, 403, unknown.body);
  assert.equal((await ports.evidenceLifecycleLog.loadLog("review:never-provisioned")).length, 0);

  // A public synthetic review is readable by a signed-in account of any tenant.
  ports.reviewOwnership.seedPublicSynthetic("review:public-synthetic-0001");
  const publicRead = await server.inject({ method: "GET", url: "/web/reviews/review%3Apublic-synthetic-0001", headers: { cookie } });
  assert.equal(publicRead.statusCode, 200, publicRead.body);
}

// The scoped grant path is unchanged: a grant naming a review is still bound
// to the review's owner.
{
  const reader = createMemoryReviewOwnershipReader();
  reader.seedOwner("review:owned-0001", "tenant-a");
  reader.seedPublicSynthetic("review:public-0001");
  assert.equal(ownerTenantFor(await reader("review:owned-0001"), "tenant-b"), "tenant-a");
  assert.equal(ownerTenantFor(await reader("review:public-0001"), "tenant-b"), "tenant-b");
  assert.equal(ownerTenantFor(await reader("review:missing-0001"), "tenant-b"), undefined);
}

// Postgres: ownership comes from the submission credentials. A review with
// credentials for two tenants fails closed.
if (await postgresAvailable()) {
  await withMigratedPostgres(async () => {
    const admin = new pg.Client({ connectionString: MIGRATOR_URL });
    await admin.connect();
    try {
      await admin.query("INSERT INTO tenant (tenant_id, display_name) VALUES ('tenant-a', 'A'), ('tenant-b', 'B')");
      const credential = (tokenKeyId, reviewId, tenantId) => admin.query(
        `INSERT INTO submission_credential
           (token_key_id, review_id, tenant_id, customer_id, selected_application_id, selected_commit,
            repository_identity_hash, expected_manifest_id, secret_hash, expires_at)
         VALUES ($1, $2, $3, 'customer', 'app', $4, $5, $5, 'scrypt$x', now() + interval '1 day')`,
        [tokenKeyId, reviewId, tenantId, "a".repeat(40), `sha256:${"b".repeat(64)}`]
      );
      await credential("key-1", "review:owned-0001", "tenant-a");
      await credential("key-2", "review:owned-0001", "tenant-a");
      await credential("key-3", "review:split-0001", "tenant-a");
      await credential("key-4", "review:split-0001", "tenant-b");
    } finally {
      await admin.end();
    }
    const app = new pg.Pool({ connectionString: APP_URL });
    try {
      const fallback = createMemoryReviewOwnershipReader();
      fallback.seedPublicSynthetic("review:public-0001");
      const reader = createPostgresReviewOwnershipReader(app, fallback);
      assert.deepEqual(await reader("review:owned-0001"), { kind: "owned", tenant_id: "tenant-a" });
      assert.deepEqual(await reader("review:split-0001"), { kind: "unknown" });
      assert.deepEqual(await reader("review:missing-0001"), { kind: "unknown" });
      assert.deepEqual(await reader("review:public-0001"), { kind: "public_synthetic" });
    } finally {
      await app.end();
    }
  });
  console.log("review ownership tests passed (with Postgres).");
} else {
  console.log("review ownership tests passed (Postgres skipped: no database reachable).");
}
