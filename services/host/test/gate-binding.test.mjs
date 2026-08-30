import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";

const { bindEnvironmentGate } = await importCompiled("src/gate-binding.js");
const { createMemoryEnvironmentGateStore } = await importEvidenceStoreCompiled("src/memory/record-stores.js");

const DEMO_GATE = {
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

// No gate row at all is fatal.
{
  const store = createMemoryEnvironmentGateStore();
  const result = await bindEnvironmentGate(store, "demo");
  assert.equal(result.ok, false);
}

// A synthetic_demo gate binds a demo deployment.
{
  const store = createMemoryEnvironmentGateStore();
  await store.recordVersion({ version: 1, gate: DEMO_GATE });
  const result = await bindEnvironmentGate(store, "demo");
  assert.equal(result.ok, true);
}

// The same gate must NOT bind a pilot deployment: mismatch is fatal.
{
  const store = createMemoryEnvironmentGateStore();
  await store.recordVersion({ version: 1, gate: DEMO_GATE });
  const result = await bindEnvironmentGate(store, "pilot");
  assert.equal(result.ok, false);
}

// A partner_pilot_candidate gate binds a pilot deployment.
{
  const store = createMemoryEnvironmentGateStore();
  await store.recordVersion({
    version: 1,
    gate: { ...DEMO_GATE, environment_profile: "partner_pilot_candidate" }
  });
  const result = await bindEnvironmentGate(store, "pilot");
  assert.equal(result.ok, true);
}

// loadCurrent reads the highest version, not the first-inserted one.
{
  const store = createMemoryEnvironmentGateStore();
  await store.recordVersion({ version: 1, gate: DEMO_GATE });
  await store.recordVersion({
    version: 2,
    gate: { ...DEMO_GATE, environment_profile: "partner_pilot_candidate" }
  });
  const result = await bindEnvironmentGate(store, "pilot");
  assert.equal(result.ok, true);
}

console.log("gate-binding test passed.");
