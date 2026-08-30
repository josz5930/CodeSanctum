import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { listFiles, readJson, resolveProjectPath, resolveUnderRoot, sha256Hex, verifyCanonicalIdentity } from "./lib/protocol-utils.mjs";

const fixtureRoot = resolveProjectPath("protocol/fixtures");
const manifestPath = path.join(fixtureRoot, "canonical-manifest.json");
const manifest = await readJson(manifestPath);
const errors = [];

// Public fixture payloads must be synthetic by default. Non-payload metadata
// (the fixture index and the cross-artifact invariants document) is the only
// unconditional exception; every other file under these public-fixture-corpus
// roots must either be marked synthetic (and carry the markers) or declare an
// explicit, reviewable nonSyntheticReason (C8-19) so "synthetic:false" cannot
// silently opt a real/customer-shaped payload out of the marker check.
const PUBLIC_METADATA_ALLOWLIST = new Set(["v0/fixture-index.json", "v0/invariants.json"]);
const SYNTHETIC_REQUIRED_ROOTS = ["v0/valid/", "v0/invalid/", "v0/signing-inputs/"];
const MIN_NON_SYNTHETIC_REASON_LENGTH = 20;

expect(manifest.schemaVersion === 1, "fixture manifest schemaVersion must be 1");
expect(manifest.ownerStory === "1.3", "fixture manifest ownerStory must be 1.3");
expect(manifest.status === "active-canonical-fixtures", "fixture manifest status must be active-canonical-fixtures");
expect(manifest.hashAlgorithm === "sha256", "fixture manifest hashAlgorithm must be sha256");

runGitDiffIfAvailable("protocol/fixtures");
await verifyManifestFiles();
await verifyCanonicalIdentities();
await verifyNoUnmanifestedFixtureFiles();

if (errors.length > 0) {
  console.error("Fixture drift check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Fixture drift check passed: sha256 file hashes and RFC 8785 canonical identity expectations match the manifest.");

// C7-15: entry.path came straight from the manifest and was joined onto
// fixtureRoot without checking it stayed under that root, so a traversing
// path (e.g. "../schemas/foo.schema.json") with a matching sha256 could be
// accepted as a fixture file even though its content lives outside the
// fixture tree.
async function verifyManifestFiles() {
  for (const entry of manifest.files ?? []) {
    let filePath;
    try {
      filePath = resolveUnderRoot(fixtureRoot, entry.path, "canonical manifest file path");
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const content = await readFile(filePath);
    const digest = sha256Hex(content);
    expect(digest === entry.sha256, `${entry.path} hash drifted: expected ${entry.sha256}, got ${digest}`);

    const text = content.toString("utf8");
    if (entry.synthetic === true) {
      for (const marker of manifest.syntheticFixtureMarkers ?? []) {
        expect(text.includes(marker), `${entry.path} must contain synthetic marker ${marker}`);
      }
      continue;
    }

    if (PUBLIC_METADATA_ALLOWLIST.has(entry.path)) {
      continue;
    }
    if (SYNTHETIC_REQUIRED_ROOTS.some((root) => entry.path.startsWith(root))) {
      const reason = entry.nonSyntheticReason;
      expect(
        typeof reason === "string" && reason.trim().length >= MIN_NON_SYNTHETIC_REASON_LENGTH,
        `${entry.path} is synthetic:false under a public-fixture-corpus root without an explicit nonSyntheticReason (>= ${MIN_NON_SYNTHETIC_REASON_LENGTH} chars); mark it synthetic:true with markers or document why it cannot be`
      );
    }
  }
}

async function verifyCanonicalIdentities() {
  for (const entry of manifest.canonicalIdentities ?? []) {
    try {
      for (const error of await verifyCanonicalIdentity(entry, fixtureRoot)) {
        errors.push(error.message);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
}

async function verifyNoUnmanifestedFixtureFiles() {
  const documented = new Set(["README.md", "canonical-manifest.json", ...(manifest.files ?? []).map((entry) => entry.path)]);
  const files = await listFiles(fixtureRoot);
  for (const absolutePath of files) {
    const relativePath = path.relative(fixtureRoot, absolutePath);
    if (!documented.has(relativePath)) {
      errors.push(`${relativePath} is not listed in canonical-manifest.json`);
    }
  }
}

function runGitDiffIfAvailable(targetPath) {
  const isGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (isGit.status !== 0) {
    console.log("Git workspace not detected; using sha256 manifest fallback for fixture drift.");
    return;
  }
  const diff = spawnSync("git", ["diff", "--exit-code", "--", targetPath], { stdio: "inherit" });
  expect(diff.status === 0, `git diff detected fixture drift under ${targetPath}`);
}

function expect(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}
