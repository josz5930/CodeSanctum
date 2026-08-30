// One-command CodeAttest Local Runner demo.
//
// Drives the full customer-side workflow end to end against the bundled
// synthetic demo application in `runner/examples/demo-app/`:
//
//   1. scope init          capture the review scope (application + commit)
//   2. scan run            run the configured local regex scanner
//   3. disclosure configure decide what evidence may leave (metadata_only)
//   4. manifest preview    preview exactly what would be sent
//   5. bundle prepare      explicitly approve + build a signed local bundle
//
// Everything runs locally and nothing is transmitted. All runtime output is
// written under a gitignored `.codeattest/demo/` directory at the repository
// root, so a demo run never dirties the tracked tree. Re-runnable: the output
// directory is cleared at the start of each run.
//
// If Rust/Cargo is not installed the demo prints PENDING and exits 0, matching
// the repository's `rust:*` gate convention (unless running under CI).

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCargoOrSkip } from "./lib/cargo-gate.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoAppDir = path.join(repoRoot, "runner", "examples", "demo-app");
const scannerConfig = path.join(demoAppDir, "scanner-config.json");
const disclosureConfig = path.join(demoAppDir, "disclosure-policy-config.json");

const outDir = path.join(repoRoot, ".codeattest", "demo");
const reviewScope = path.join(outDir, "review-scope.json");
const scannerFindings = path.join(outDir, "scanner-findings.json");
const disclosurePolicy = path.join(outDir, "disclosure-policy.json");
const outboundManifest = path.join(outDir, "outbound-manifest.json");
const bundleDir = path.join(outDir, "evidence-bundle");
const attemptLog = path.join(outDir, "local-runner-attempts.jsonl");

// A fixed synthetic commit + review id keep the demo deterministic and make
// clear this is not a real repository state.
const demoCommit = "0123456789abcdef0123456789abcdef01234567";
const demoReviewId = "review:synthetic-demo";
const demoApprover = "demo-approver@example.com";

const resolved = resolveCargoOrSkip("demo");
if (resolved.skip) {
  process.exit(0);
}

const relOut = path.relative(repoRoot, outDir);
console.log("\nCodeAttest Local Runner demo");
console.log(`  synthetic app : ${path.relative(repoRoot, demoAppDir)}`);
console.log(`  output (local): ${relOut}/  (gitignored; nothing is transmitted)\n`);

// Build the runner once up front so per-step output is clean and any build
// failure surfaces before the workflow starts.
runStep("build runner", resolved.cargo, ["build", "-q", "-p", "onevps-local-runner-scaffold"], {
  cwd: repoRoot,
  quiet: true
});

const targetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(repoRoot, "target");
const runnerBin = path.join(targetDir, "debug", binaryName("onevps-local-runner-scaffold"));

// Fresh output directory for a re-runnable demo.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

runStep("1/5  scope init", runnerBin, [
  "scope", "init",
  "--application-path", demoAppDir,
  "--review-id", demoReviewId,
  "--commit", demoCommit,
  "--output", reviewScope
]);

runStep("2/5  scan run", runnerBin, [
  "scan", "run",
  "--application-path", demoAppDir,
  "--scope", reviewScope,
  "--scanner-config", scannerConfig,
  "--output", scannerFindings
]);

runStep("3/5  disclosure configure", runnerBin, [
  "disclosure", "configure",
  "--scope", reviewScope,
  "--scanner-findings", scannerFindings,
  "--policy-config", disclosureConfig,
  "--output", disclosurePolicy
]);

runStep("4/5  manifest preview", runnerBin, [
  "manifest", "preview",
  "--scope", reviewScope,
  "--scanner-findings", scannerFindings,
  "--disclosure-policy", disclosurePolicy,
  "--output", outboundManifest
]);

// The approval confirmation is the manifest_id the preview just computed. Read
// it from the emitted artifact rather than scraping terminal output.
const manifestId = readManifestId(outboundManifest);

runStep("5/5  bundle prepare", runnerBin, [
  "bundle", "prepare",
  "--scope", reviewScope,
  "--scanner-findings", scannerFindings,
  "--disclosure-policy", disclosurePolicy,
  "--manifest", outboundManifest,
  "--approving-actor", demoApprover,
  "--approval-decision", "approve",
  "--approval-confirmation", manifestId,
  "--output-dir", bundleDir,
  "--attempt-log", attemptLog
]);

console.log("\nDemo complete. A signed, local-only Evidence Bundle is ready:");
console.log(`  ${path.relative(repoRoot, bundleDir)}/`);
console.log("Nothing was transmitted. Inspect the bundle, or delete");
console.log(`  ${relOut}/  to reset.\n`);

function runStep(label, command, args, options = {}) {
  console.log(`\x1b[1m==> ${label}\x1b[0m`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit",
    env: resolved.env
  });
  if (result.error) {
    fail(`${label}: could not run ${command}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`${label} failed (exit ${result.status ?? "unknown"}).`);
  }
  if (!options.quiet) {
    console.log("");
  }
}

function readManifestId(manifestPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`could not read manifest_id from ${manifestPath}: ${error.message}`);
  }
  const manifestId = parsed?.manifest_id;
  if (typeof manifestId !== "string" || manifestId.length === 0) {
    fail(`manifest ${manifestPath} has no manifest_id`);
  }
  return manifestId;
}

function binaryName(base) {
  return process.platform === "win32" ? `${base}.exe` : base;
}

function fail(message) {
  console.error(`\ndemo failed: ${message}`);
  process.exit(1);
}
