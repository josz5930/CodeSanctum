import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";

const { errorEnvelope } = await importCompiled("src/error-envelope.js");
const { runBootSequence } = await importCompiled("src/boot.js");
const { loadConfig } = await importCompiled("src/config.js");
const { registerBudgetHaltGuard } = await importCompiled("src/routes/submissions.js");
const { createServer } = await importCompiled("src/server.js");

function warningEvents(lines) {
  return lines.map((line) => JSON.parse(line)).filter((entry) => entry.event === "budget_halted");
}

async function guardedServer(deploymentIdentity, ratio) {
  const captured = [];
  const server = createServer({
    isReady: () => true,
    logger: { stream: { write: (line) => captured.push(line) }, level: "warn" }
  });
  registerBudgetHaltGuard(server, {
    deploymentIdentity,
    budget: { async spendRatio() { return ratio; } },
    errorEnvelope
  });
  server.get("/web/context", async () => ({ outcome: "served" }));
  server.post("/v0/submissions", async () => ({ outcome: "served" }));
  await server.ready();
  return { server, captured };
}

function demoGate() {
  return {
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
    demo_budget_gate_ready: true,
    signing_release_trust_ready: false,
    retention_period_required: false,
    evidence_boundary: "synthetic-demo-only"
  };
}

// Demo business routes halt at the full ceiling, while both supervisor
// probes remain available and the refusal is emitted as structured data.
{
  const { server, captured } = await guardedServer("demo", 1);
  const web = await server.inject({ method: "GET", url: "/web/context" });
  assert.equal(web.statusCode, 503);
  assert.equal(web.json().reason_code, "budget_halted");
  const submission = await server.inject({ method: "POST", url: "/v0/submissions" });
  assert.equal(submission.statusCode, 503);
  assert.equal(submission.json().reason_code, "budget_halted");
  assert.equal((await server.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
  assert.equal((await server.inject({ method: "GET", url: "/readyz" })).statusCode, 200);
  const events = warningEvents(captured);
  assert.equal(events.length, 2);
  assert.equal(events[0].deployment_identity, "demo");
  assert.equal(events[0].spend_ratio, 1);
  await server.close();
}

// A pilot host never evaluates or enforces the demo halt path.
{
  let meterReads = 0;
  const captured = [];
  const server = createServer({
    isReady: () => true,
    logger: { stream: { write: (line) => captured.push(line) }, level: "warn" }
  });
  registerBudgetHaltGuard(server, {
    deploymentIdentity: "pilot",
    budget: { async spendRatio() { meterReads += 1; return 1; } },
    errorEnvelope
  });
  server.get("/web/context", async () => ({ outcome: "served" }));
  await server.ready();
  const web = await server.inject({ method: "GET", url: "/web/context" });
  assert.equal(web.statusCode, 200);
  assert.equal(meterReads, 0);
  assert.equal(warningEvents(captured).length, 0);
  await server.close();
}

// A mode-0600 demo config with an explicit positive ceiling loads and passes
// the existing fail-closed boot ladder. Database and signing seams are faked
// exactly at their ports; config parsing, gate binding, and object-store
// verification are real.
{
  const objectStoreRoot = await mkdtemp(path.join(tmpdir(), "onevps-budget-object-store-"));
  const configDir = await mkdtemp(path.join(tmpdir(), "onevps-budget-config-"));
  const configPath = path.join(configDir, "host.json");
  await writeFile(configPath, JSON.stringify({
    deployment_identity: "demo",
    database_url: "postgres://unused",
    object_store_root: objectStoreRoot,
    object_store_encrypted: false,
    listen_addr: "127.0.0.1:8080",
    encryption_key_ref: "demo-totp-key",
    session_cookie_secure: true,
    signing: {
      key_directory_path: "/var/lib/codeattest/demo/signing-key-directory.json",
      trust_anchor_public_key: "A".repeat(2603),
      key_id: "codeattest-demo-signing-key",
      key_version: "v1",
      credential_name: "demo-signing-key"
    },
    demo_budget_meter: {
      monthly_unit_ceiling: 20,
      unit_per_billable_event: 0.25
    }
  }));
  await chmod(configPath, 0o600);
  const config = await loadConfig(configPath);
  assert.deepEqual(config.demo_budget_meter, {
    monthly_unit_ceiling: 20,
    unit_per_billable_event: 0.25
  });

  const { migrationHead } = await import("../../../scripts/run-migrations.mjs");
  const expectedHead = await migrationHead();
  const gate = demoGate();
  const result = await runBootSequence({
    config,
    sql: { async query() { return { rows: [{ filename: expectedHead }] }; } },
    gateStore: {
      async loadCurrent() { return { version: 1, gate }; },
      async recordVersion() { throw new Error("not used"); }
    },
    pool: {
      async withConnection(fn) {
        return fn({
          async query(text) {
            if (text.startsWith("UPDATE")) {
              const error = new Error("insufficient privilege");
              error.code = "42501";
              throw error;
            }
            return { rows: [] };
          }
        });
      }
    },
    signingKeyCheck: async () => ({
      ok: true,
      key: { key_id: "codeattest-demo-signing-key", key_version: "v1", privateKeyPkcs8: new Uint8Array([1]) },
      directory: { directory_version: 1 }
    })
  });
  assert.equal(result.ok, true);
}

console.log("Demo-only budget halt guard test passed.");
