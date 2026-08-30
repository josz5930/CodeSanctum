import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../protocol/fixtures", import.meta.url)));

async function loadFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function conflictBody(record) {
  return {
    ...record,
    limitations: [...record.limitations, "SYNTHETIC_DEMO_DATA body-conflict probe. NOT_CUSTOMER_SOURCE."]
  };
}

/**
 * Memory and Postgres readiness adapters must share one identity-keyed
 * append-only contract: same body is a no-op, a different body under the same
 * identity is a rewrite and is rejected.
 */
export async function runReadinessStoreContract({ name, createStores }) {
  const evidence = await loadFixture("v0/valid/environment-readiness-evidence.access-control.json");
  const decision = await loadFixture("v0/valid/environment-readiness-decision.declined.json");

  {
    const { readinessEvidence } = await createStores();
    assert.equal((await readinessEvidence.record(evidence)).outcome, "recorded", `${name}: first evidence insert`);
    assert.equal((await readinessEvidence.record(evidence)).outcome, "already_present", `${name}: identical evidence is idempotent`);
    const found = await readinessEvidence.find(evidence.readiness_evidence_id);
    assert.equal(found.control, "access_control_ready", `${name}: evidence must round-trip`);
    assert.equal(await readinessEvidence.find("sha256:" + "c".repeat(64)), undefined);
  }

  {
    const { readinessEvidence } = await createStores();
    await readinessEvidence.record(evidence);
    const conflicting = conflictBody(evidence);
    assert.equal(
      (await readinessEvidence.record(conflicting)).outcome,
      "body_conflict",
      `${name}: a different body under the same evidence identity is a rewrite`
    );
    const found = await readinessEvidence.find(evidence.readiness_evidence_id);
    assert.deepEqual(found.limitations, evidence.limitations, `${name}: body conflict must leave the original evidence row`);
  }

  {
    const { readinessDecisions } = await createStores();
    assert.equal((await readinessDecisions.record(decision)).outcome, "recorded", `${name}: first decision insert`);
    assert.equal((await readinessDecisions.record(decision)).outcome, "already_present", `${name}: identical decision is idempotent`);
    const found = await readinessDecisions.find(decision.readiness_decision_id);
    assert.equal(found.decision, "declined", `${name}: decision must round-trip`);
  }

  {
    const { readinessDecisions } = await createStores();
    await readinessDecisions.record(decision);
    assert.equal(
      (await readinessDecisions.record(conflictBody(decision))).outcome,
      "body_conflict",
      `${name}: a different body under the same decision identity is a rewrite`
    );
  }

  console.log(`${name}: readiness store contract passed.`);
}
