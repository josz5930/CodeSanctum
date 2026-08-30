import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateEnvironmentGatePromotion, formatPromotionReport, persistEnvironmentGatePromotion } from "../../../scripts/lib/promote-environment-gate.mjs";
import { postgresAvailable, withPostgres } from "./helpers/postgres-harness.mjs";

const fixtureRoot = path.resolve(fileURLToPath(new URL("../../../protocol/fixtures", import.meta.url)));

async function loadFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

async function loadPassingEvidence() {
  return [
    await loadFixture("v0/valid/environment-readiness-evidence.access-control.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.access-logging.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.encryption-at-rest.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.retention-defaults.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.deletion-controls.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.demo-budget-gate.json"),
    await loadFixture("v0/valid/environment-readiness-evidence.signing-release-trust.json")
  ];
}

const NOW = "2026-08-23T12:00:00Z";
const SIGNATURE_VERIFIED = { result: "verified" };

function reasonsOf(evaluation) {
  return evaluation.reasons.map((reason) => reason.code);
}

const current = { version: 1, gate: await loadFixture("v0/valid/environment-evidence-gate.synthetic-demo.json") };
const proposedGate = await loadFixture("v0/valid/environment-evidence-gate.real-snippet-ready.json");
const approved = await loadFixture("v0/valid/environment-readiness-decision.approved.json");
const passingEvidence = await loadPassingEvidence();

{
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: approved,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, true, `approved promotion should pass: ${JSON.stringify(evaluation.reasons)}`);
  assert.equal(evaluation.identities.readiness_decision_id, approved.readiness_decision_id);
  assert.equal(evaluation.identities.proposed_gate_version, 2);
}

{
  const staleDecision = await loadFixture("v0/invalid/environment-readiness-decision.stale.json");
  const staleEvidence = await loadFixture("v0/valid/environment-readiness-evidence.stale-access-control.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: [staleEvidence, ...passingEvidence.slice(1)],
    decision: staleDecision,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("stale_evidence"), `expected stale_evidence, got ${reasonsOf(evaluation)}`);
}

{
  const duplicate = await loadFixture("v0/invalid/environment-readiness-decision.duplicate-control.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: duplicate,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("duplicate_or_missing_control"), `expected duplicate_or_missing_control, got ${reasonsOf(evaluation)}`);
}

{
  const missing = await loadFixture("v0/invalid/environment-readiness-decision.missing-control.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: missing,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("duplicate_or_missing_control"), `expected duplicate_or_missing_control, got ${reasonsOf(evaluation)}`);
}

{
  const selfApproved = await loadFixture("v0/invalid/environment-readiness-decision.self-approved.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: selfApproved,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("self_approval"), `expected self_approval, got ${reasonsOf(evaluation)}`);
}

{
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: approved,
    proposedGate,
    now: NOW,
    signatureResult: { result: "signature_invalid" }
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("invalid_signature"), `expected invalid_signature, got ${reasonsOf(evaluation)}`);
}

{
  const evaluation = evaluateEnvironmentGatePromotion({
    current: { version: 4, gate: current.gate },
    evidenceRecords: passingEvidence,
    decision: approved,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("nonconsecutive_version"), `expected nonconsecutive_version, got ${reasonsOf(evaluation)}`);
}

{
  const wrongRelease = await loadFixture("v0/invalid/environment-readiness-decision.wrong-release.json");
  const wrongEvidence = await loadFixture("v0/valid/environment-readiness-evidence.wrong-release-access-control.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: [wrongEvidence, ...passingEvidence.slice(1)],
    decision: wrongRelease,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("unbound_release"), `expected unbound_release, got ${reasonsOf(evaluation)}`);
}

{
  const wrongDigest = await loadFixture("v0/invalid/environment-evidence-gate.wrong-gate-digest.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: approved,
    proposedGate: wrongDigest,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("gate_body_mismatch"), `expected gate_body_mismatch, got ${reasonsOf(evaluation)}`);
}

{
  const failedDecision = await loadFixture("v0/invalid/environment-readiness-decision.failed-control.json");
  const failedEvidence = await loadFixture("v0/valid/environment-readiness-evidence.failed-encryption.json");
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: [
      passingEvidence[0],
      passingEvidence[1],
      failedEvidence,
      ...passingEvidence.slice(3)
    ],
    decision: failedDecision,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  assert.equal(evaluation.ok, false);
  assert.ok(reasonsOf(evaluation).includes("failed_control"), `expected failed_control, got ${reasonsOf(evaluation)}`);
}

{
  const evaluation = evaluateEnvironmentGatePromotion({
    current,
    evidenceRecords: passingEvidence,
    decision: approved,
    proposedGate,
    now: NOW,
    signatureResult: SIGNATURE_VERIFIED
  });
  const report = formatPromotionReport(evaluation);
  assert.match(report, /readiness_decision_id/);
  assert.doesNotMatch(report, /ml_dsa_65:/);
  assert.doesNotMatch(report, /postgres:\/\//);
  assert.doesNotMatch(report, /attachment_digest/);
}

if (await postgresAvailable()) {
  await withPostgres(async ({ migratorPool, appPool }) => {
    const evaluation = evaluateEnvironmentGatePromotion({
      current,
      evidenceRecords: passingEvidence,
      decision: approved,
      proposedGate,
      now: NOW,
      signatureResult: SIGNATURE_VERIFIED
    });
    const dryRun = await persistEnvironmentGatePromotion({
      sql: migratorPool,
      evaluation,
      current,
      evidenceRecords: passingEvidence,
      decision: approved,
      proposedGate,
      dryRun: true
    });
    assert.equal(dryRun.outcome, "dry_run");
    const { rows: dryGateRows } = await appPool.query("SELECT version FROM environment_evidence_gate");
    assert.equal(dryGateRows.length, 0, "dry-run must not insert a gate row");

    await migratorPool.query(
      "INSERT INTO environment_evidence_gate (version, body) VALUES ($1, $2)",
      [1, JSON.stringify(current.gate)]
    );

    const committed = await persistEnvironmentGatePromotion({
      sql: migratorPool,
      evaluation,
      current,
      evidenceRecords: passingEvidence,
      decision: approved,
      proposedGate,
      dryRun: false
    });
    assert.equal(committed.outcome, "promoted");
    const { rows: gateRows } = await appPool.query("SELECT version FROM environment_evidence_gate ORDER BY version");
    assert.deepEqual(gateRows.map((row) => Number(row.version)), [1, 2]);
    const { rows: decisionRows } = await appPool.query("SELECT readiness_decision_id FROM environment_readiness_decision");
    assert.equal(decisionRows.length, 1);
    const { rows: evidenceRows } = await appPool.query("SELECT readiness_evidence_id FROM environment_readiness_evidence");
    assert.equal(evidenceRows.length, 7);
  });
  console.log("postgres promotion persistence passed.");
} else {
  console.log("postgres promotion persistence skipped: no database reachable.");
}

console.log("promotion evaluation passed.");
