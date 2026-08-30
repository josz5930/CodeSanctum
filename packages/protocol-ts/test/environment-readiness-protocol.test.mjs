import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-environment-readiness-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-environment-readiness-test-dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
execFileSync(process.execPath, [
  path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
  "-p",
  "tsconfig.json",
  "--outDir",
  outDir,
  "--tsBuildInfoFile",
  path.join(tempDir, "protocol-ts.tsbuildinfo")
], { cwd: workspacePath, stdio: "pipe" });

const {
  computeCanonicalSha256Id,
  signatureEnvelopeMatchesExpectation,
  validateProtocolSchema
} = await import(pathToFileURL(path.join(outDir, "index.js")).href);

const fixtureRoot = path.resolve(import.meta.dirname, "../../../protocol/fixtures/v0");
const approved = await fixture("valid/environment-readiness-decision.approved.json");
const declined = await fixture("valid/environment-readiness-decision.declined.json");
const finalGate = await fixture("valid/environment-evidence-gate.real-snippet-ready.json");
const signingInput = await fixture("signing-inputs/environment-readiness-decision-identity.json");

for (const name of [
  "access-control",
  "access-logging",
  "encryption-at-rest",
  "retention-defaults",
  "deletion-controls",
  "demo-budget-gate",
  "signing-release-trust"
]) {
  const evidence = await fixture(`valid/environment-readiness-evidence.${name}.json`);
  assert.deepEqual(
    validateProtocolSchema("urn:codeattest:protocol:v0:environment-readiness-evidence", evidence),
    [],
    `${name} evidence must satisfy its generated schema`
  );
  const { readiness_evidence_id: identity, ...identityInput } = evidence;
  assert.equal(identity, computeCanonicalSha256Id(identityInput), `${name} evidence identity must recompute`);
}

for (const decision of [approved, declined]) {
  assert.deepEqual(
    validateProtocolSchema("urn:codeattest:protocol:v0:environment-readiness-decision", decision),
    [],
    `${decision.decision} decision must satisfy its generated schema`
  );
  const { readiness_decision_id: identity, decision_signature: _signature, ...identityInput } = decision;
  assert.equal(identity, computeCanonicalSha256Id(identityInput), `${decision.decision} decision identity must recompute`);
}

assert.equal(approved.evidence_bindings.length, 7);
assert.equal(new Set(approved.evidence_bindings.map((binding) => binding.control)).size, 7);
assert.equal(approved.approvers.length, 2);
assert.notEqual(approved.approvers[0].actor.actor_id, approved.approvers[1].actor.actor_id);
assert.equal(finalGate.readiness_decision_ref, approved.readiness_decision_id);

const { readiness_decision_ref: _decisionRef, ...gateApprovalInput } = finalGate;
assert.equal(approved.proposed_gate_approval_input_digest, computeCanonicalSha256Id(gateApprovalInput));
assert.equal(
  signatureEnvelopeMatchesExpectation(signingInput, approved.decision_signature, {
    protocol_version: "codeattest.v0",
    signing_input_type: "environment_readiness_decision_identity",
    signed_identity_type: "environment_readiness_decision",
    signed_identity: approved.readiness_decision_id,
    identity_input_path: "v0/valid/environment-readiness-decision.identity-input.json",
    key_id: approved.decision_signature.key_id,
    key_version: approved.decision_signature.key_version,
    signing_time: approved.decision_signature.signing_time
  }),
  true,
  "approved readiness decision signature metadata must bind its exact identity"
);
assert.equal(declined.decision_signature, undefined, "declined decisions remain recorded without an approval signature");

console.log("Environment readiness evidence, decision, signature, and final-gate linkage contract passed.");

await rm(tempDir, { recursive: true, force: true });

async function fixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}
