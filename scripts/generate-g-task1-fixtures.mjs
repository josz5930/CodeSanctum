#!/usr/bin/env node
// Generates Sub-project G Task 1 refusal fixtures from the canonical approved
// and declined examples. The generated decisions preserve content-addressed
// identities while changing only the acceptance condition named by the file.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectPath, sha256Hex, sha256IdFromCanonical } from "./lib/protocol-utils.mjs";

const fixtureRoot = resolveProjectPath("protocol/fixtures/v0");
const approved = await readJson("valid/environment-readiness-decision.approved.json");
const declined = await readJson("valid/environment-readiness-decision.declined.json");
const finalGate = await readJson("valid/environment-evidence-gate.real-snippet-ready.json");
const staleAccess = await readJson("valid/environment-readiness-evidence.stale-access-control.json");
const failedEncryption = await readJson("valid/environment-readiness-evidence.failed-encryption.json");
const wrongReleaseAccess = await readJson("valid/environment-readiness-evidence.wrong-release-access-control.json");

await writeEvidence("invalid/environment-readiness-evidence.invalid-enum-value.json", await readJson("valid/environment-readiness-evidence.access-control.json"), (evidence) => {
  evidence.control = "invalid_control";
});

await writeEvidence("invalid/environment-readiness-evidence.invalid-calendar-timestamp.json", await readJson("valid/environment-readiness-evidence.access-control.json"), (evidence) => {
  evidence.observed_at = "2026-08-99T10:00:00Z";
});

await writeDecision("invalid/environment-readiness-decision.stale.json", approved, (decision) => {
  decision.evidence_bindings[0].readiness_evidence_ref = staleAccess.readiness_evidence_id;
});

await writeDecision("invalid/environment-readiness-decision.failed-control.json", approved, (decision) => {
  decision.evidence_bindings[2].readiness_evidence_ref = failedEncryption.readiness_evidence_id;
});

await writeDecision("invalid/environment-readiness-decision.duplicate-control.json", declined, (decision) => {
  decision.evidence_bindings[6] = structuredClone(decision.evidence_bindings[0]);
});

await writeDecision("invalid/environment-readiness-decision.missing-control.json", declined, (decision) => {
  decision.evidence_bindings.pop();
});

await writeDecision("invalid/environment-readiness-decision.wrong-release.json", declined, (decision) => {
  decision.evidence_bindings[0].readiness_evidence_ref = wrongReleaseAccess.readiness_evidence_id;
});

await writeDecision("invalid/environment-readiness-decision.self-approved.json", declined, (decision) => {
  decision.approvers[0].actor.actor_id = "pilot-access-evidence-producer";
});

await writeDecision("invalid/environment-readiness-decision.invalid-enum-value.json", declined, (decision) => {
  decision.decision = "conditional";
});

await writeDecision("invalid/environment-readiness-decision.invalid-calendar-timestamp.json", declined, (decision) => {
  decision.decided_at = "2026-02-30T10:00:00Z";
});

const wrongGateDigest = structuredClone(finalGate);
wrongGateDigest.notes = [
  "SYNTHETIC_DEMO_DATA fixture changes the proposed gate body after approval. NOT_CUSTOMER_SOURCE."
];
await writeJson("invalid/environment-evidence-gate.wrong-gate-digest.json", wrongGateDigest);

await updateCanonicalManifest();

async function writeDecision(relativePath, source, mutate) {
  const decision = structuredClone(source);
  mutate(decision);
  delete decision.readiness_decision_id;
  delete decision.decision_signature;
  decision.readiness_decision_id = sha256IdFromCanonical(decision);
  if (source.decision_signature !== undefined) {
    decision.decision_signature = structuredClone(source.decision_signature);
    decision.decision_signature.signed_identity = decision.readiness_decision_id;
  }
  const ordered = { protocol_version: decision.protocol_version, readiness_decision_id: decision.readiness_decision_id, ...decision };
  await writeJson(relativePath, ordered);
}

async function writeEvidence(relativePath, source, mutate) {
  const evidence = structuredClone(source);
  mutate(evidence);
  delete evidence.readiness_evidence_id;
  evidence.readiness_evidence_id = sha256IdFromCanonical(evidence);
  const ordered = { protocol_version: evidence.protocol_version, readiness_evidence_id: evidence.readiness_evidence_id, ...evidence };
  await writeJson(relativePath, ordered);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

async function writeJson(relativePath, value) {
  await writeFile(path.join(fixtureRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateCanonicalManifest() {
  const manifestPath = resolveProjectPath("protocol/fixtures/canonical-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const evidenceNames = [
    "access-control",
    "access-logging",
    "encryption-at-rest",
    "retention-defaults",
    "deletion-controls",
    "demo-budget-gate",
    "signing-release-trust",
    "failed-encryption",
    "stale-access-control",
    "wrong-release-access-control"
  ];
  const taskPaths = [
    ...evidenceNames.flatMap((name) => [
      `v0/valid/environment-readiness-evidence.${name}.json`,
      `v0/valid/environment-readiness-evidence.${name}.identity-input.json`
    ]),
    "v0/valid/environment-readiness-decision.approved.json",
    "v0/valid/environment-readiness-decision.identity-input.json",
    "v0/valid/environment-readiness-decision.declined.json",
    "v0/valid/environment-readiness-decision.declined.identity-input.json",
    "v0/signing-inputs/environment-readiness-decision-identity.json",
    "v0/invalid/environment-readiness-evidence.self-reviewed.json",
    "v0/invalid/environment-readiness-evidence.invalid-enum-value.json",
    "v0/invalid/environment-readiness-evidence.invalid-calendar-timestamp.json",
    "v0/invalid/environment-readiness-decision.stale.json",
    "v0/invalid/environment-readiness-decision.failed-control.json",
    "v0/invalid/environment-readiness-decision.duplicate-control.json",
    "v0/invalid/environment-readiness-decision.missing-control.json",
    "v0/invalid/environment-readiness-decision.wrong-release.json",
    "v0/invalid/environment-readiness-decision.self-approved.json",
    "v0/invalid/environment-readiness-decision.invalid-enum-value.json",
    "v0/invalid/environment-readiness-decision.invalid-calendar-timestamp.json",
    "v0/invalid/environment-evidence-gate.wrong-gate-digest.json",
    "v0/invalid/environment-evidence-gate.unsafe-real-acceptance.json"
  ];
  const entryByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  for (const relativePath of taskPaths) {
    const content = await readFile(path.join(resolveProjectPath("protocol/fixtures"), relativePath), "utf8");
    let entry = entryByPath.get(relativePath);
    if (entry === undefined) {
      entry = content.includes("SYNTHETIC_DEMO_DATA") && content.includes("NOT_CUSTOMER_SOURCE")
        ? { path: relativePath, sha256: "", synthetic: true }
        : {
            path: relativePath,
            sha256: "",
            synthetic: false,
            nonSyntheticReason: "Structured protocol identity input contains only fixed synthetic identifiers and digests; its closed schema has no narrative field for fixture markers."
          };
      manifest.files.push(entry);
      entryByPath.set(relativePath, entry);
    }
    entry.sha256 = sha256Hex(content);
  }
  for (const entry of manifest.files) {
    const content = await readFile(path.join(resolveProjectPath("protocol/fixtures"), entry.path));
    entry.sha256 = sha256Hex(content);
  }

  const fixtureIndex = await readJson("fixture-index.json");
  const taskCanonicalEntries = fixtureIndex.canonical_identities.filter((entry) =>
    entry.fixture_path.startsWith("v0/valid/environment-readiness-")
  );
  manifest.canonicalIdentities = manifest.canonicalIdentities.filter((entry) =>
    !entry.fixture_path.startsWith("v0/valid/environment-readiness-")
  );
  manifest.canonicalIdentities.push(...taskCanonicalEntries);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
