import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixturesRoot = path.join(repoRoot, "protocol", "fixtures");
const regenerator = path.join(repoRoot, "scripts", "regenerate-signature-fixtures.mjs");

// The regenerator now always signs for real via D1's Rust deterministic
// signer (the synthetic `--mode` was retired in the same commit that
// retired synthetic signing everywhere else), so this test -- unlike the
// rest of `npm run test:ts` -- needs `cargo` on PATH. Mirror
// scripts/run-rust-gate.mjs's PENDING convention rather than hard-failing
// a TypeScript-only local run: skip locally when Cargo is missing, but
// never skip in CI, where the pinned toolchain is guaranteed.
if (spawnSync("cargo", ["--version"]).error) {
  const markers = [process.env.CI, process.env.GITHUB_ACTIONS, process.env.BUILDKITE, process.env.TF_BUILD];
  const isCiLike = markers.some((value) => value !== undefined && value !== "" && value !== "false" && value !== "0");
  const message = "Rust/Cargo is not installed locally, and the fixture regenerator now signs for real via cargo. Install Rust 1.96.1, or rely on CI where the pinned toolchain is installed before npm run ci.";
  if (isCiLike && process.env.ONEVPS_ALLOW_MISSING_RUST !== "1") {
    console.error(`FAIL fixture-regeneration.test.mjs: ${message}`);
    process.exit(1);
  }
  console.log(`PENDING fixture-regeneration.test.mjs: ${message}`);
  process.exit(0);
}

async function fileMap(root) {
  const map = new Map();
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else map.set(path.relative(root, full), await readFile(full, "utf8"));
    }
  }
  await walk(root);
  return map;
}

async function copyCorpus(work, name) {
  const copy = path.join(work, name);
  await cp(fixturesRoot, copy, { recursive: true });
  return copy;
}

const work = await mkdtemp(path.join(tmpdir(), "onevps-fixture-regen-"));

try {
  const copy = await copyCorpus(work, "fixtures");
  const before = await fileMap(copy);

  execFileSync("node", [regenerator, "--fixtures-root", copy], { stdio: "inherit" });

  const after = await fileMap(copy);

  // The tool that regenerates the corpus must reproduce the corpus. Any
  // difference here means its cascade order, its identity exclusions, or its
  // canonicalization disagrees with whatever produced these fixtures -- and a
  // tool that disagrees must not be trusted to rewrite them in Task 3.
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "regeneration must not add or remove files");
  const differing = [...before.keys()].filter((key) => before.get(key) !== after.get(key));
  assert.deepEqual(differing, [], `regenerating the committed corpus must be a no-op; these files changed: ${differing.join(", ")}`);

  // A no-op that is a no-op because the tool did nothing proves nothing. The
  // tool reports how many identities, signatures and packages it recomputed;
  // assert it actually recomputed the whole cascade.
  const report = JSON.parse(execFileSync("node", [regenerator, "--fixtures-root", copy, "--report-json"], { encoding: "utf8" }));
  assert.equal(report.identities_recomputed, report.identity_entries, "every declared identity entry must be recomputed");
  assert.ok(report.identity_entries >= 19, `expected the full identity cascade, recomputed ${report.identity_entries}`);
  assert.ok(report.signatures_rebuilt >= 16, `expected every signature fixture to be rebuilt, rebuilt ${report.signatures_rebuilt}`);
  assert.ok(report.verification_packages_rebuilt >= 2, `expected every verification package to be rebuilt, rebuilt ${report.verification_packages_rebuilt}`);
  assert.equal(report.changed_files.length, 0, `regeneration must change nothing: ${report.changed_files.join(", ")}`);

  // Stronger than the counters: move one field inside an identity input, let
  // the cascade run, then move it back and let the cascade run again. A tool
  // that understood nothing could still be a no-op on an untouched corpus; only
  // one that computes the real cascade can walk the corpus away across dozens
  // of files and land back on it byte-for-byte.
  const tampered = await copyCorpus(work, "tampered");
  const receiptPath = path.join(tampered, "v0", "valid", "vendor-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.receipt_timestamp, "2026-07-10T00:20:00Z", "the tampered field must exist before it is tampered with");
  receipt.receipt_timestamp = "2026-07-10T00:20:01Z";
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  const moved = JSON.parse(execFileSync("node", [regenerator, "--fixtures-root", tampered, "--report-json"], { encoding: "utf8" }));
  assert.ok(moved.identities_moved >= 9, `one moved identity input must move the cascade, moved ${moved.identities_moved}`);
  assert.ok(moved.changed_files.length >= 50, `the cascade must reach the whole corpus, changed ${moved.changed_files.length} files`);

  const revertPath = path.join(tampered, "v0", "valid", "vendor-receipt.json");
  const reverted = JSON.parse(await readFile(revertPath, "utf8"));
  reverted.receipt_timestamp = "2026-07-10T00:20:00Z";
  await writeFile(revertPath, `${JSON.stringify(reverted, null, 2)}\n`, "utf8");
  execFileSync("node", [regenerator, "--fixtures-root", tampered], { stdio: "inherit" });

  const restored = await fileMap(tampered);
  const unrestored = [...before.keys()].filter((key) => before.get(key) !== restored.get(key));
  assert.deepEqual(unrestored, [], `reverting the moved field must restore the corpus exactly; still differing: ${unrestored.join(", ")}`);

  // A --check that cannot fail is not a check.
  receipt.receipt_timestamp = "2026-07-10T00:20:01Z";
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  let checkStatus = 0;
  try {
    execFileSync("node", [regenerator, "--fixtures-root", tampered, "--check"], { stdio: "pipe" });
  } catch (error) {
    checkStatus = error.status;
  }
  assert.notEqual(checkStatus, 0, "--check must exit non-zero when the corpus would change");

  const untouched = await fileMap(tampered);
  assert.equal(untouched.get(path.join("v0", "valid", "vendor-receipt.json")), `${JSON.stringify(receipt, null, 2)}\n`, "--check must not write");

  console.log("fixture regeneration round-trip passed.");
} finally {
  await rm(work, { recursive: true, force: true });
}
