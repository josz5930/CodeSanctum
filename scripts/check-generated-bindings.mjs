import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractJsSpecifiers } from "./lib/dependency-scan.mjs";
import {
  generateProtocolTypeArtifacts,
  generatedManifestForArtifacts,
  generatedRoot
} from "./lib/protocol-types-generator.mjs";
import { listFiles, readJson, sha256Hex } from "./lib/protocol-utils.mjs";

// C8-15: bindings:check only proved checked-in generated files match the
// generator and the manifest hash — it never inspected generated *content*
// for import/export-from specifiers. Generated bindings are re-exported from
// protocol-ts's public barrel, so a generator that started emitting a
// forbidden import would stay drift-clean (generator, checked-in file, and
// manifest hash would all still agree with each other) while silently
// smuggling a boundary-violating import into the public package surface. No
// generated protocol binding currently needs any import, so the allowlist
// starts empty; add an entry here only for a deliberate future exception.
const GENERATED_IMPORT_ALLOWLIST = new Set();

const root = generatedRoot();
const manifestPath = path.join(root, "bindings-manifest.json");
const manifest = await readJson(manifestPath);
const expectedArtifacts = await generateProtocolTypeArtifacts();
const expectedManifest = generatedManifestForArtifacts(expectedArtifacts);
const errors = [];

expect(manifest.schemaVersion === 1, "generated binding manifest schemaVersion must be 1");
expect(manifest.ownerStory === "1.3", "generated binding manifest ownerStory must be 1.3");
expect(manifest.status === "generated-from-protocol-schemas", "generated binding manifest status must be generated-from-protocol-schemas");
expect(manifest.hashAlgorithm === "sha256", "generated binding manifest hashAlgorithm must be sha256");

runGitDiffIfAvailable("packages/protocol-ts/src/generated");
await verifySourceSchemaHashes();
await verifyGeneratedFiles();
await verifyNoUnmanifestedGeneratedFiles();

if (errors.length > 0) {
  console.error("Generated binding check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Generated binding check passed: TypeScript protocol bindings match protocol/schemas output and manifest hashes.");

async function verifySourceSchemaHashes() {
  const actual = JSON.stringify(manifest.sourceSchemas ?? []);
  const expected = JSON.stringify(expectedManifest.sourceSchemas);
  expect(actual === expected, "source schema hashes in bindings-manifest.json drifted from protocol/schemas");
}

async function verifyGeneratedFiles() {
  const expectedFilesByPath = new Map(expectedArtifacts.files.map((file) => [file.path, file]));
  const manifestFilesByPath = new Map((manifest.files ?? []).map((file) => [file.path, file]));

  for (const expectedFile of expectedArtifacts.files) {
    const manifestFile = manifestFilesByPath.get(expectedFile.path);
    expect(Boolean(manifestFile), `${expectedFile.path} is missing from bindings-manifest.json`);
    if (manifestFile) {
      expect(manifestFile.sha256 === expectedFile.sha256, `${expectedFile.path} manifest hash drifted: expected ${expectedFile.sha256}, got ${manifestFile.sha256}`);
    }

    const generatedPath = path.join(root, expectedFile.path);
    const content = await readFile(generatedPath, "utf8");
    expect(content === expectedFile.content, `${expectedFile.path} does not match schema-derived generated output`);
    expect(sha256Hex(content) === expectedFile.sha256, `${expectedFile.path} file hash does not match generated content hash`);

    checkImportFree(expectedFile.path, "generator output", expectedFile.content);
    checkImportFree(expectedFile.path, "checked-in file", content);
  }

  for (const manifestFile of manifest.files ?? []) {
    expect(expectedFilesByPath.has(manifestFile.path), `${manifestFile.path} is listed in bindings-manifest.json but is not generated`);
  }
}

async function verifyNoUnmanifestedGeneratedFiles() {
  const documented = new Set(["README.md", "bindings-manifest.json", ...(manifest.files ?? []).map((entry) => entry.path)]);
  const files = await listFiles(root);
  for (const absolutePath of files) {
    const relativePath = path.relative(root, absolutePath);
    if (!documented.has(relativePath)) {
      errors.push(`${relativePath} is not listed in bindings-manifest.json`);
    }
  }
}

function checkImportFree(filePath, source, content) {
  const specifiers = extractJsSpecifiers(content).filter((specifier) => !GENERATED_IMPORT_ALLOWLIST.has(specifier));
  expect(specifiers.length === 0, `${filePath} ${source} contains disallowed import/export-from specifier(s): ${specifiers.join(", ")}`);
}

function runGitDiffIfAvailable(targetPath) {
  const isGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (isGit.status !== 0) {
    console.log("Git workspace not detected; using generated file and manifest hash fallback for generated binding drift.");
    return;
  }
  const diff = spawnSync("git", ["diff", "--exit-code", "--", targetPath], { stdio: "inherit" });
  expect(diff.status === 0, `git diff detected generated binding drift under ${targetPath}`);
}

function expect(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}
