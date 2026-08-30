import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");
const artifactReferenceSchemaId = "urn:codeattest:protocol:v0:artifact-reference";

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

  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);

  const validReference = await readFixtureJson("valid/artifact-reference.raw-snippet.json");
  const validErrors = protocol.validateProtocolSchema(artifactReferenceSchemaId, validReference);
  assert(validErrors.length === 0, `valid artifact reference must validate; got ${JSON.stringify(validErrors)}`);

  const missingAnchor = await readFixtureJson("invalid/artifact-reference.missing-content-path-anchor.json");
  const missingAnchorErrors = protocol.validateProtocolSchema(artifactReferenceSchemaId, missingAnchor);
  assert(
    missingAnchorErrors.some((error) => error.code === "dependent_required" && error.location === "$.content_path_anchor"),
    `content_path without content_path_anchor must fail with dependent_required; got ${JSON.stringify(missingAnchorErrors)}`
  );

  // C8-07: size_bytes must be capped at Number.MAX_SAFE_INTEGER so schema,
  // script, protocol-ts, and Rust (u64-backed) all agree on the same value
  // space. Rust convergence is proven separately by
  // runner/crates/local-runner-scaffold/src/lib.rs's
  // size_bytes_js_safe_accepts_max_safe_integer /
  // size_bytes_js_safe_rejects_one_past_max_safe_integer unit tests.
  const { loadSchemas, validateAgainstSchema } = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);
  const { schemaMap } = await loadSchemas();
  const artifactReferenceSchema = schemaMap.get(artifactReferenceSchemaId);
  const atMaxSafeInteger = { ...validReference, size_bytes: 9007199254740991 };
  const overMaxSafeInteger = { ...validReference, size_bytes: 9007199254740992 };

  const atMaxProtocolTs = protocol.validateProtocolSchema(artifactReferenceSchemaId, atMaxSafeInteger);
  assert(atMaxProtocolTs.length === 0, `protocol-ts must accept size_bytes at MAX_SAFE_INTEGER; got ${JSON.stringify(atMaxProtocolTs)}`);
  const overMaxProtocolTs = protocol.validateProtocolSchema(artifactReferenceSchemaId, overMaxSafeInteger);
  assert(overMaxProtocolTs.length > 0, "protocol-ts must reject size_bytes one past MAX_SAFE_INTEGER");

  const atMaxScript = validateAgainstSchema(atMaxSafeInteger, artifactReferenceSchema, schemaMap);
  assert(atMaxScript.length === 0, `script validator must accept size_bytes at MAX_SAFE_INTEGER; got ${JSON.stringify(atMaxScript)}`);
  const overMaxScript = validateAgainstSchema(overMaxSafeInteger, artifactReferenceSchema, schemaMap);
  assert(overMaxScript.length > 0, "script validator must reject size_bytes one past MAX_SAFE_INTEGER");

  console.log("protocol-ts artifact reference dependent_required tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

async function readFixtureJson(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
