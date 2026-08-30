import assert from "node:assert/strict";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { postgresAvailable, withMigratedPostgres, APP_URL } from "./helpers/postgres-harness.mjs";
import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";
import { buildTestServer, syntheticBundle, syntheticGate, AUTH_HEADER, REVIEW_ID } from "./helpers/submission-fixtures.mjs";

if (!(await postgresAvailable())) {
  console.log("submissions-postgres test skipped: no database reachable.");
  process.exit(0);
}

const { createPostgresPool, createPostgresEnvironmentGateStore } = await importEvidenceStoreCompiled("src/index.js");
const { seedEnvironmentGate } = await import("../../../scripts/seed-environment-gate.mjs");

await withMigratedPostgres(async () => {
  const pool = createPostgresPool(APP_URL);
  try {
    const gateStore = createPostgresEnvironmentGateStore(pool);
    await seedEnvironmentGate(pool, { version: 1, gate: await syntheticGate() });
    // The boot-bound gate itself is read from a config file at boot in
    // production (spec section 5.6 step 3); this proves the same seeded row
    // is what `bindEnvironmentGate` would load, without re-running boot here.
    const loaded = await gateStore.loadCurrent();
    assert.deepEqual(loaded.gate, await syntheticGate());

    const objectStoreRoot = await mkdtemp(path.join(tmpdir(), "onevps-host-submissions-pg-"));
    await chmod(objectStoreRoot, 0o700);

    const { server, deps } = await buildTestServer({ pool, objectStoreRoot });
    const bundle = await syntheticBundle();

    const opened = await server.inject({
      method: "POST",
      url: "/v0/submissions",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      payload: {
        bundle_manifest: bundle.bundle_manifest,
        signature_envelope: bundle.signature_envelope,
        customer_approval: bundle.customer_approval,
        approved_outbound_manifest: bundle.approved_outbound_manifest
      }
    });
    assert.equal(opened.statusCode, 201, opened.body);

    for (const reference of bundle.bundle_manifest.artifact_references) {
      const stored = await server.inject({
        method: "PUT",
        url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/artifacts/${reference.digest}`,
        headers: { authorization: AUTH_HEADER, "content-type": "application/octet-stream" },
        payload: Buffer.from(bundle.artifact_bytes_by_digest[reference.digest])
      });
      assert.equal(stored.statusCode, 200, stored.body);
    }

    const finalized = await server.inject({
      method: "POST",
      url: `/v0/submissions/${bundle.bundle_manifest.submission_attempt_id}/finalize`,
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      payload: {}
    });
    assert.equal(finalized.statusCode, 200, finalized.body);
    assert.equal(finalized.json().submission_outcome.outcome_state, "received_with_receipt");

    // Spec section 5.3: no code path returns artifact bytes without a
    // persisted evidence_accessed event. Finalize read every artifact, so
    // the lifecycle log must carry one access event per artifact.
    const lifecycle = await deps.evidenceLifecycleLog.loadLog(REVIEW_ID);
    const accessed = lifecycle.filter((event) => event.event_type === "evidence_accessed");
    assert.equal(accessed.length, bundle.bundle_manifest.artifact_references.length);

    // Spec section 5.4: every stored artifact round-trips to its original digest.
    for (const reference of bundle.bundle_manifest.artifact_references) {
      const rows = await pool.query("SELECT digest FROM artifact_reference WHERE digest = $1", [reference.digest]);
      assert.equal(rows.rows.length, 1, `artifact_reference row missing for ${reference.digest}`);
    }

    await server.close();
  } finally {
    await pool.end();
  }
});

console.log("Submissions Postgres flow test passed.");
