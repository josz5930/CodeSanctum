import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRerunManifest,
  collectObservation,
  loadSyntheticCanaries,
  redactEvidenceText
} from "../../../scripts/lib/collect-readiness-evidence.mjs";

const raw = [
  "connected postgres://codeattest_app:super-secret@127.0.0.1:5434/codeattest",
  "Cookie: session=abc123totp",
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload",
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC",
  "-----END PRIVATE KEY-----",
  "otpauth://totp/CodeAttest:ops@example.com?secret=JBSWY3DPEHPK3PXP",
  "customer 555-0100 called about review:synthetic_demo_alpha"
].join("\n");

const redacted = redactEvidenceText(raw);
assert.doesNotMatch(redacted, /postgres:\/\//);
assert.doesNotMatch(redacted, /super-secret/);
assert.doesNotMatch(redacted, /session=abc123/);
assert.doesNotMatch(redacted, /Bearer eyJ/);
assert.doesNotMatch(redacted, /BEGIN PRIVATE KEY/);
assert.doesNotMatch(redacted, /otpauth:\/\//);
assert.doesNotMatch(redacted, /ops@example.com/);
assert.doesNotMatch(redacted, /555-0100/);
assert.match(redacted, /\[REDACTED/);

const collected = collectObservation({
  check_id: "access-control-live-negative-cases",
  command: "node scripts/check-workspace-boundary.mjs",
  stdout: raw,
  stderr: "",
  exit_status: 0,
  tool_version: "node-24.18.0",
  collected_at: "2026-08-26T00:00:00Z",
  release_digest: "sha256:" + "a".repeat(64),
  expected_release_digest: "sha256:" + "a".repeat(64),
  deployment_identity: "pilot",
  required: true
});
assert.equal(collected.outcome, "collected");
assert.equal(collected.observation.check_id, "access-control-live-negative-cases");
assert.equal(collected.observation.exit_status, 0);
assert.equal(collected.observation.tool_version, "node-24.18.0");
assert.equal(collected.observation.collected_at, "2026-08-26T00:00:00Z");
assert.equal(collected.observation.deployment_identity, "pilot");
assert.match(collected.observation.attachment_digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(collected.redacted_attachment.includes("super-secret"), false);
assert.equal(collected.redacted_attachment, redacted);

const skipped = collectObservation({
  check_id: "identity-c-check",
  command: "npm run identity:c-check",
  stdout: "PENDING: cargo missing",
  stderr: "",
  exit_status: 0,
  tool_version: "unknown",
  collected_at: "2026-08-26T00:00:00Z",
  release_digest: "sha256:" + "a".repeat(64),
  expected_release_digest: "sha256:" + "a".repeat(64),
  deployment_identity: "pilot",
  required: true
});
assert.equal(skipped.outcome, "refused");
assert.equal(skipped.reason, "required_tool_skipped");

const wrongRelease = collectObservation({
  check_id: "identity-c-check",
  command: "npm run identity:c-check",
  stdout: "ok",
  stderr: "",
  exit_status: 0,
  tool_version: "node-24.18.0",
  collected_at: "2026-08-26T00:00:00Z",
  release_digest: "sha256:" + "b".repeat(64),
  expected_release_digest: "sha256:" + "a".repeat(64),
  deployment_identity: "pilot",
  required: true
});
assert.equal(wrongRelease.outcome, "refused");
assert.equal(wrongRelease.reason, "release_mismatch");

const canaries = await loadSyntheticCanaries();
assert.ok(canaries.length >= 2);
for (const canary of canaries) {
  assert.match(canary.body, /SYNTHETIC_DEMO_DATA/);
  assert.match(canary.body, /NOT_CUSTOMER_SOURCE/);
  assert.equal(canary.body, canaries.find((other) => other.path === canary.path).body);
}

const manifest = buildRerunManifest({
  release_digest: "sha256:" + "a".repeat(64),
  deployment_identity: "pilot",
  observations: [collected.observation],
  canaries
});
assert.equal(manifest.deployment_identity, "pilot");
assert.equal(manifest.observations[0].check_id, "access-control-live-negative-cases");
assert.equal(manifest.observations[0].command, "node scripts/check-workspace-boundary.mjs");
assert.equal(manifest.observations[0].attachment_digest, collected.observation.attachment_digest);
assert.ok(manifest.canaries.every((entry) => entry.path.startsWith("infra/deploy/readiness-canaries/")));

const instructions = await readFile(
  path.resolve(fileURLToPath(new URL("../../../infra/deploy/READINESS-EVIDENCE.md", import.meta.url))),
  "utf8"
);
assert.match(instructions, /collect-readiness-evidence/);
assert.match(instructions, /rerun/);
assert.match(instructions, /do not paste secrets/i);

console.log("collect-readiness-evidence test passed.");
