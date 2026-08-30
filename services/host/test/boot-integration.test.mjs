import assert from "node:assert/strict";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { postgresAvailable, withMigratedPostgres, APP_URL } from "./helpers/postgres-harness.mjs";
import { importCompiled } from "./helpers/compile.mjs";
import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";

if (!(await postgresAvailable())) {
  console.log("boot-integration test skipped: no database reachable.");
  process.exit(0);
}

const { runBootSequence } = await importCompiled("src/boot.js");
const { createPostgresPool, createPostgresEnvironmentGateStore } = await importEvidenceStoreCompiled("src/index.js");
const { seedEnvironmentGate } = await import("../../../scripts/seed-environment-gate.mjs");

await withMigratedPostgres(async () => {
  const pool = createPostgresPool(APP_URL);
  try {
    const gateStore = createPostgresEnvironmentGateStore(pool);
    await seedEnvironmentGate(pool, {
      version: 1,
      gate: {
        protocol_version: "codeattest.v0",
        environment_profile: "synthetic_demo",
        allowed_source_derived_classes: ["never_collected"],
        real_raw_snippet_acceptance: false,
        real_targeted_file_acceptance: false,
        access_control_ready: false,
        access_logging_ready: false,
        encryption_at_rest_ready: false,
        retention_defaults_ready: false,
        deletion_controls_ready: false,
        demo_budget_gate_ready: false,
        signing_release_trust_ready: false,
        retention_period_required: false,
        evidence_boundary: "synthetic-demo-only"
      }
    });

    const objectStoreRoot = await mkdtemp(path.join(tmpdir(), "onevps-host-integration-"));
    await chmod(objectStoreRoot, 0o700);

    const config = {
      deployment_identity: "demo",
      database_url: APP_URL,
      object_store_root: objectStoreRoot,
      object_store_encrypted: false,
      listen_addr: "127.0.0.1:0",
      encryption_key_ref: "integration-test-ref",
      session_cookie_secure: true,
      signing: {
        key_directory_path: "unused-in-this-test",
        trust_anchor_public_key: "A".repeat(2603),
        key_id: "integration-test-key",
        key_version: "v1",
        credential_name: "signing-key"
      }
    };

    // This test exercises the database-backed steps against a real Postgres;
    // the signing-key check has its own dedicated coverage in
    // signing-key-check.test.mjs, so it is faked here.
    const signingKey = { key_id: "integration-test-key", key_version: "v1", privateKeyPkcs8: new Uint8Array([1, 2, 3]) };
    const keyDirectory = { directory_version: 1 };
    const result = await runBootSequence({
      config,
      sql: pool,
      gateStore,
      pool,
      signingKeyCheck: async () => ({ ok: true, key: signingKey, directory: keyDirectory })
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.signingKey, signingKey);
    console.log("boot-integration test passed.");
  } finally {
    await pool.end();
  }
});
