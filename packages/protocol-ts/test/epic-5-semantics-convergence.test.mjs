import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C4-23: the static-bundle manifest semantic rules exist twice — once in
// `scripts/lib/protocol-utils.mjs` (the pre-existing fixture/gate validator)
// and once ported to `packages/protocol-ts/src/epic-5-semantics.ts` (so the
// control plane, which must not import scripts/, can enforce the same rules
// before emitting a `static_bundle_generated` event). This drives the
// registered valid/invalid manifest fixtures through both layers and asserts
// they agree on accept/reject for each.
const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
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

  const { staticBundleManifestSemanticIssues } = await import(pathToFileURL(path.join(outDir, "epic-5-semantics.js")).href);
  const { validateStaticBundleManifestSemantics } = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);

  const cases = [
    ["v0/valid/static-bundle-manifest.generated.json", true],
    ["v0/valid/static-bundle-manifest.finalized.json", true],
    ["v0/invalid/static-bundle-manifest.internal-learning-file.json", false]
  ];

  for (const [relativePath, expectedValid] of cases) {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
    const tsValid = staticBundleManifestSemanticIssues(manifest).length === 0;
    assert(tsValid === expectedValid, `protocol-ts must ${expectedValid ? "accept" : "reject"} ${relativePath}`);
    const scriptErrors = [];
    validateStaticBundleManifestSemantics(manifest, scriptErrors);
    const scriptValid = scriptErrors.length === 0;
    assert(scriptValid === expectedValid, `script validator must ${expectedValid ? "accept" : "reject"} ${relativePath}`);
  }

  // Duplicate file paths/refs must be rejected by both layers identically.
  const generated = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/static-bundle-manifest.generated.json"), "utf8"));
  const duplicated = { ...generated, files: [...generated.files, generated.files[generated.files.length - 1]] };
  assert(staticBundleManifestSemanticIssues(duplicated).includes("static_bundle_duplicate_file"), "protocol-ts must reject duplicate files");
  const duplicatedErrors = [];
  validateStaticBundleManifestSemantics(duplicated, duplicatedErrors);
  assert(duplicatedErrors.some((error) => error.code === "static_bundle_duplicate_file"), "script validator must reject duplicate files");

  console.log("protocol-ts / script static bundle manifest semantics convergence tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
