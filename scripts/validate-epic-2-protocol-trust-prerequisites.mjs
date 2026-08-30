import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCoverageMarkerCorpus, canonicalize, coverageMarkerResolved, listFiles, readJson, resolveProjectPath, sha256IdFromCanonical } from "./lib/protocol-utils.mjs";

// C7-17: an invariant's javascript_coverage/rust_coverage marker used to only
// need to be a non-empty string, so a typo'd or removed function/test name
// still counted as "covered". `not_applicable_*` remains an explicit,
// human-reviewed sentinel that intentionally has no resolvable marker.
const NOT_APPLICABLE_MARKER_PATTERN = /^not_applicable_/u;

const errors = [];

await verifyInvariantInventory();
await verifyPortableFixtureContentPaths();
await verifyCrossLanguageIdentityParity();
await verifyEnvironmentGateFixtures();

run("Rust runner build", ["npm", "run", "rust:build"]);
run("protocol gate", ["npm", "run", "protocol:check"]);
run("fixture drift", ["npm", "run", "fixtures:drift"]);
run("generated bindings", ["npm", "run", "bindings:check"]);
run("JavaScript JCS canonicalization", ["node", "scripts/test-jcs-canonicalization.mjs"]);
run("Story 1.8 copied artifact verification gate", ["npm", "run", "runner:story-1.8-schema-check"]);
run("Story 1.9 failure/rerun/trust gate", ["npm", "run", "runner:story-1.9-schema-check"]);

const cargo = findCargoCommand();
run("Rust JCS canonicalization", [cargo, "test", "--manifest-path", "runner/crates/local-runner-scaffold/Cargo.toml", "--test", "jcs_canonicalization"]);
run("Rust environment evidence gate", [cargo, "test", "--manifest-path", "runner/crates/local-runner-scaffold/Cargo.toml", "--test", "environment_evidence_gate"]);

if (errors.length > 0) {
  console.error("Epic 2 protocol trust prerequisite gate failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Epic 2 protocol trust prerequisite gate passed: JCS identities, portable artifact paths, copied artifact verification, invariant coverage markers, and demo-vs-pilot evidence gates are valid.");

function run(title, args) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: resolveProjectPath(),
    encoding: "utf8",
    stdio: "inherit",
    env: makeEnv()
  });
  if (result.status !== 0) {
    errors.push(`${title} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function findCargoCommand() {
  for (const candidate of ["cargo", "/opt/homebrew/opt/rustup/bin/cargo"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", env: makeEnv() });
    if (result.status === 0) {
      return candidate;
    }
  }
  errors.push("cargo command not found");
  return "cargo";
}

function makeEnv() {
  return {
    ...process.env,
    PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH ?? ""}`
  };
}

async function verifyInvariantInventory() {
  const inventory = await readJson(resolveProjectPath("protocol/fixtures/v0/invariants.json"));
  if (inventory.schema_version !== 1) {
    errors.push("protocol invariant inventory schema_version must be 1");
  }
  if (inventory.protocol_version !== "codeattest.v0") {
    errors.push("protocol invariant inventory protocol_version must be codeattest.v0");
  }
  const invariants = inventory.invariants ?? [];
  if (invariants.length < 10) {
    errors.push("protocol invariant inventory must cover prerequisite protocol surfaces");
  }

  const jsCorpus = await buildCoverageMarkerCorpus(["scripts", "packages", "apps", "services", "protocol"]);
  const rustCorpus = await buildCoverageMarkerCorpus(["runner"]);

  const ids = new Set();
  for (const invariant of invariants) {
    if (ids.has(invariant.id)) {
      errors.push(`duplicate invariant id ${invariant.id}`);
    }
    ids.add(invariant.id);
    if (!Array.isArray(invariant.javascript_coverage) || invariant.javascript_coverage.length === 0) {
      errors.push(`${invariant.id} must declare JavaScript coverage markers`);
    } else {
      for (const marker of invariant.javascript_coverage) {
        if (typeof marker === "string" && !NOT_APPLICABLE_MARKER_PATTERN.test(marker) && !coverageMarkerResolved(marker, jsCorpus)) {
          errors.push(`${invariant.id} javascript_coverage marker "${marker}" does not resolve to any JS/TS source`);
        }
      }
    }
    if (!Array.isArray(invariant.rust_coverage) || invariant.rust_coverage.length === 0) {
      errors.push(`${invariant.id} must declare Rust coverage markers`);
    } else {
      for (const marker of invariant.rust_coverage) {
        if (typeof marker === "string" && !NOT_APPLICABLE_MARKER_PATTERN.test(marker) && !coverageMarkerResolved(marker, rustCorpus)) {
          errors.push(`${invariant.id} rust_coverage marker "${marker}" does not resolve to any Rust source`);
        }
      }
    }
  }
}

async function verifyPortableFixtureContentPaths() {
  const fixtureRoot = resolveProjectPath("protocol/fixtures");
  const validRoot = path.join(fixtureRoot, "v0/valid");
  const fixtureFiles = (await listFiles(validRoot)).filter((filePath) => filePath.endsWith(".json"));
  for (const filePath of fixtureFiles) {
    const relativePath = path.relative(fixtureRoot, filePath);
    const fixture = await readJson(filePath);
    for (const artifact of collectArtifactReferences(fixture)) {
      if (!artifact.content_path) {
        continue;
      }
      if (!artifact.content_path_anchor) {
        errors.push(`${relativePath} ${artifact.artifact_ref} is missing content_path_anchor`);
      }
      if (
        artifact.content_path.startsWith("/") ||
        /^[A-Za-z]:/.test(artifact.content_path) ||
        artifact.content_path.includes("\\") ||
        artifact.content_path.includes("\0") ||
        artifact.content_path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        errors.push(`${relativePath} ${artifact.artifact_ref} has non-portable content_path ${JSON.stringify(artifact.content_path)}`);
      }
    }
  }
}

// C8-08: the JCS parity gate previously covered only 3 hard-coded signing-input
// fixtures and only compared script (Node `canonicalize`) against Rust. A
// protocol-ts-only regression in key ordering, escaping, or unsafe-number
// handling could pass that gate while downstream identity verification (which
// runs through protocol-ts, e.g. control-plane/UI) silently broke. This now
// discovers every protocol/fixtures/v0/signing-inputs/*.json fixture and
// compares canonical bytes + sha256 id across all three runtimes (script,
// protocol-ts, Rust), plus a small JCS edge corpus that IS representable as
// plain JSON across all three (UTF-16 key sort order, Unicode
// non-normalization). Edge cases that only exist as JS-only constructs
// (Symbol keys, getters/accessors, sparse arrays, cyclic references,
// non-finite numbers) have no Rust-representable equivalent to feed through
// this file-based comparison; those are covered by protocol-ts's own
// canonical-identity.test.mjs and the script's test-jcs-canonicalization.mjs,
// each independently asserting rejection.
async function verifyCrossLanguageIdentityParity() {
  const protocolTs = await compileAndImportCanonicalIdentity();
  if (protocolTs === undefined) {
    return;
  }

  const signingInputsRoot = resolveProjectPath("protocol/fixtures/v0/signing-inputs");
  const fixturePaths = (await listFiles(signingInputsRoot)).filter((filePath) => filePath.endsWith(".json"));
  if (fixturePaths.length === 0) {
    errors.push("no protocol/fixtures/v0/signing-inputs/*.json fixtures were discovered for JCS parity");
    return;
  }

  const edgeCorpusDir = await mkdtemp(path.join(tmpdir(), "onevps-jcs-edge-corpus-"));
  try {
    const edgeCorpusFixtures = await writeJcsEdgeCorpusFixtures(edgeCorpusDir);
    for (const [label, absolutePath] of [
      ...fixturePaths.map((filePath) => [path.relative(resolveProjectPath(), filePath), filePath]),
      ...edgeCorpusFixtures
    ]) {
      await verifyCanonicalIdentityAcrossRuntimes(label, absolutePath, protocolTs);
    }
  } finally {
    await rm(edgeCorpusDir, { recursive: true, force: true });
  }
}

async function verifyCanonicalIdentityAcrossRuntimes(label, absolutePath, protocolTs) {
  const value = await readJson(absolutePath);
  const nodeCanonical = canonicalize(value);
  const nodeIdentity = sha256IdFromCanonical(value);

  let protocolTsCanonical;
  let protocolTsIdentity;
  try {
    protocolTsCanonical = protocolTs.canonicalizeProtocolJson(value);
    protocolTsIdentity = protocolTs.computeCanonicalSha256Id(value);
  } catch (error) {
    errors.push(`${label} protocol-ts canonicalization threw: ${error.message}`);
    return;
  }
  if (protocolTsCanonical !== nodeCanonical) {
    errors.push(`${label} canonical bytes differ between Node and protocol-ts`);
  }
  if (protocolTsIdentity !== nodeIdentity) {
    errors.push(`${label} SHA-256 identity differs between Node and protocol-ts`);
  }

  const result = spawnSync(findCargoCommand(), [
    "test",
    "--manifest-path",
    "runner/crates/local-runner-scaffold/Cargo.toml",
    "--test",
    "jcs_canonicalization",
    "--",
    "--ignored",
    "emit_canonical_identity_for_env_fixture",
    "--nocapture"
  ], {
    cwd: resolveProjectPath(),
    encoding: "utf8",
    env: { ...makeEnv(), ONEVPS_JCS_FIXTURE_PATH: absolutePath }
  });
  if (result.status !== 0) {
    errors.push(`Rust canonical identity emitter failed for ${label} with exit code ${result.status ?? "unknown"}`);
    return;
  }
  const payloadLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("ONEVPS_JCS_PARITY "));
  if (!payloadLine) {
    errors.push(`Rust canonical identity emitter did not print parity payload for ${label}`);
    return;
  }
  const payload = JSON.parse(payloadLine.slice("ONEVPS_JCS_PARITY ".length));
  if (payload.canonical !== nodeCanonical) {
    errors.push(`${label} canonical bytes differ between Node and Rust`);
  }
  if (payload.sha256_id !== nodeIdentity) {
    errors.push(`${label} SHA-256 identity differs between Node and Rust`);
  }
}

async function writeJcsEdgeCorpusFixtures(dir) {
  const cases = {
    "edge-corpus-utf16-key-sort.json": { "": 1, "\u{1F600}": 2, "a": 3 },
    "edge-corpus-unicode-non-normalization.json": { value: "é" },
    "edge-corpus-nested-array-object-sort.json": [{ z: 1, a: { y: 2, x: [3, { b: true, a: false }] } }]
  };
  const written = [];
  for (const [fileName, value] of Object.entries(cases)) {
    const absolutePath = path.join(dir, fileName);
    await writeFile(absolutePath, JSON.stringify(value), "utf8");
    written.push([`v0/signing-inputs edge corpus: ${fileName}`, absolutePath]);
  }
  return written;
}

async function compileAndImportCanonicalIdentity() {
  const workspacePath = resolveProjectPath("packages/protocol-ts");
  const outDir = resolveProjectPath("node_modules/.cache/protocol-ts-jcs-parity-dist");
  const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-jcs-parity-"));
  try {
    const tscBin = resolveProjectPath("node_modules/typescript/bin/tsc");
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    execFileSync(process.execPath, [
      tscBin,
      "-p",
      "tsconfig.json",
      "--outDir",
      outDir,
      "--tsBuildInfoFile",
      path.join(tempDir, "protocol-ts.tsbuildinfo")
    ], {
      cwd: workspacePath,
      stdio: "pipe"
    });
    return await import(pathToFileURL(path.join(outDir, "canonical-identity.js")).href);
  } catch (error) {
    errors.push(`unable to compile/import protocol-ts canonical-identity module for JCS parity: ${error.message}`);
    return undefined;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function verifyEnvironmentGateFixtures() {
  const demo = await readJson(resolveProjectPath("protocol/fixtures/v0/valid/environment-evidence-gate.synthetic-demo.json"));
  if (demo.environment_profile !== "synthetic_demo" || demo.real_raw_snippet_acceptance || demo.real_targeted_file_acceptance) {
    errors.push("synthetic demo environment gate must reject real source-derived evidence");
  }
  const ready = await readJson(resolveProjectPath("protocol/fixtures/v0/valid/environment-evidence-gate.real-snippet-ready.json"));
  for (const field of [
    "access_control_ready",
    "access_logging_ready",
    "encryption_at_rest_ready",
    "retention_defaults_ready",
    "deletion_controls_ready",
    "demo_budget_gate_ready",
    "signing_release_trust_ready",
    "retention_period_required"
  ]) {
    if (ready[field] !== true) {
      errors.push(`real snippet ready fixture must set ${field}=true`);
    }
  }
}

function collectArtifactReferences(value) {
  const references = [];
  visit(value);
  return references;

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (!Array.isArray(node) && typeof node.artifact_type === "string" && typeof node.artifact_ref === "string") {
      references.push(node);
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      visit(child);
    }
  }
}
