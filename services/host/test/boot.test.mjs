import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { runBootSequence } = await importCompiled("src/boot.js");

const CONFIG = {
  deployment_identity: "demo",
  database_url: "unused-in-this-test",
  object_store_root: "/tmp",
  object_store_encrypted: false,
  listen_addr: "127.0.0.1:8080",
  encryption_key_ref: "ref",
  session_cookie_secure: true
};

const GATE = {
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
};

function fakeGateStore(gate) {
  return { async loadCurrent() { return gate === undefined ? undefined : { version: 1, gate }; }, async recordVersion() { throw new Error("not used"); } };
}

function fakeSql(migrationHeadRow) {
  return { async query() { return { rows: migrationHeadRow === undefined ? [] : [{ filename: migrationHeadRow }] }; } };
}

function fakePool(updateThrows) {
  return {
    async withConnection(fn) {
      return fn({
        async query(text) {
          if (text.startsWith("UPDATE")) {
            if (updateThrows) throw new Error("permission denied for table review_event");
            return { rows: [] };
          }
          return { rows: [] };
        }
      });
    }
  };
}

function fakeSigningKeyCheck(result) {
  return async () => result;
}

const SIGNING_KEY = { key_id: "codeattest-demo-signing-key", key_version: "v1", privateKeyPkcs8: new Uint8Array([1, 2, 3]) };
const KEY_DIRECTORY = { directory_version: 1 };

const realHead = (await import("../../../scripts/run-migrations.mjs")).migrationHead;
const expectedHead = await realHead();

// The happy path: every step passes, including the signing-key check.
{
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true),
    signingKeyCheck: fakeSigningKeyCheck({ ok: true, key: SIGNING_KEY, directory: KEY_DIRECTORY })
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.signingKey, SIGNING_KEY);
  // Sub-project B: the boot-bound gate comes back too, so the composition
  // root never has to read a gate from anywhere but this ladder.
  assert.deepEqual(result.gate, GATE);
}

// A migration-head mismatch stops boot before any later step runs.
{
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql("0000_wrong.sql"),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true)
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "migration_head");
}

// A gate mismatch (pilot config, demo-only gate) stops boot at gate_binding.
{
  const result = await runBootSequence({
    config: { ...CONFIG, deployment_identity: "pilot" },
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true)
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "gate_binding");
}

// A bad grants self-test stops boot at the last step.
{
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(false)
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "grant_self_test");
}

// A gate store whose loadCurrent() rejects (e.g. the database drops mid-boot)
// must produce a structured gate_binding failure, not an uncaught rejection.
{
  const gateStore = {
    async loadCurrent() { throw new Error("connection terminated"); },
    async recordVersion() { throw new Error("not used"); }
  };
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql(expectedHead),
    gateStore,
    pool: fakePool(true)
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "gate_binding");
  assert.equal(result.reason, "connection terminated");
}

// A pool whose withConnection() rejects (e.g. the database drops between the
// object-store step and the grant self-test) must produce a structured
// grant_self_test failure, not an uncaught rejection.
{
  const pool = {
    async withConnection() { throw new Error("connection terminated"); }
  };
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "grant_self_test");
  assert.equal(result.reason, "connection terminated");
}

// A non-loopback listen_addr with session_cookie_secure: false is refused
// after the gate binds. Constructed config: loadConfig already rejects 0.0.0.0.
{
  const result = await runBootSequence({
    config: { ...CONFIG, listen_addr: "0.0.0.0:8080", session_cookie_secure: false },
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true),
    signingKeyCheck: fakeSigningKeyCheck({ ok: true, key: SIGNING_KEY, directory: KEY_DIRECTORY })
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "session_cookie");
  assert.equal(result.reason, "session_cookie_secure_required_off_loopback");
}

// Loopback may issue a non-Secure cookie for local HTTP development.
{
  const result = await runBootSequence({
    config: { ...CONFIG, session_cookie_secure: false },
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true),
    signingKeyCheck: fakeSigningKeyCheck({ ok: true, key: SIGNING_KEY, directory: KEY_DIRECTORY })
  });
  assert.equal(result.ok, true);
}

// A failing signing-key check stops boot at the last step, after every
// database-backed step has already passed.
{
  const result = await runBootSequence({
    config: CONFIG,
    sql: fakeSql(expectedHead),
    gateStore: fakeGateStore(GATE),
    pool: fakePool(true),
    signingKeyCheck: fakeSigningKeyCheck({ ok: false, reason: "signing_key_credential_directory_missing" })
  });
  assert.equal(result.ok, false);
  assert.equal(result.step, "signing_key");
  assert.equal(result.reason, "signing_key_credential_directory_missing");
}

console.log("boot test passed.");
