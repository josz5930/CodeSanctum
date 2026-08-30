import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)), "..", "..");

// Retired signing vocabulary. Every one of these is a signing path, not an
// evidence-class label -- see the D3 plan section 1 for the tokens that are
// deliberately kept.
const RETIRED = [
  "ml_dsa_65_demo_pilot",
  "demo_file_backed",
  "demo_signing_behavior",
  "synthetic_demo_sha256:",
  "synthetic:SYNTHETIC_DEMO_DATA:NOT_CUSTOMER_SOURCE:",
  "syntheticDemoSignatureBytes",
  "createSyntheticDemoSignature",
  "verifySyntheticDemoSignature",
  "isTrustedSyntheticEvidenceBundleSignatureBytes",
  "syntheticEvidenceBundleSignatureBytes",
  "syntheticReceiptSignatureBytes",
  "SYNTHETIC_DEMO_LIMITATIONS",
  "not a production ml-dsa signature"
];

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dist", "docs", ".superpowers"]);
const SCANNED = new Set([".ts", ".mjs", ".js", ".rs", ".json", ".md"]);

// This file necessarily names every token it forbids.
// Test files that deliberately reference retired tokens to verify they're rejected by schema validation.
const ALLOWED_FILES = new Set([
  path.join("packages", "protocol-ts", "test", "no-synthetic-signing.test.mjs"),
  path.join("packages", "protocol-ts", "test", "ml-dsa-signing-protocol.test.mjs"),
  path.join("packages", "protocol-ts", "test", "signature-verification-outcome-protocol.test.mjs"),
  path.join("packages", "signing", "test", "envelope.test.mjs"),
  path.join("packages", "static-bundle", "test", "epic-5-static-bundle.test.mjs"),
  path.join("services", "host", "test", "key-service.test.mjs")
]);

const findings = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith("_")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!SCANNED.has(path.extname(entry.name))) continue;
    const relative = path.relative(repoRoot, full);
    if (ALLOWED_FILES.has(relative)) continue;
    const text = await readFile(full, "utf8");
    for (const token of RETIRED) {
      if (text.includes(token)) findings.push(`${relative}: ${token}`);
    }
  }
}
await walk(repoRoot);

assert.deepEqual(findings, [], `retired synthetic signing tokens are still present:\n${findings.join("\n")}`);

// The kept tokens must still be present -- a scan that passes because the
// repository is empty is not a scan.
const gate = await readFile(path.join(repoRoot, "protocol", "schemas", "environment-evidence-gate.schema.json"), "utf8");
assert.ok(gate.includes("synthetic_demo"), "environment_profile: synthetic_demo is an evidence-class label and must survive D3");

console.log(`no-synthetic-signing guard passed over the tracked tree.`);
