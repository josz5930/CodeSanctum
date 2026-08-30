import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-evidence-storage-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-evidence-storage-test-dist");

const schemaIds = {
  storedObject: "urn:codeattest:protocol:v0:stored-object-classification",
  lifecycleEvent: "urn:codeattest:protocol:v0:evidence-lifecycle-event",
  deletionEvidence: "urn:codeattest:protocol:v0:deletion-evidence",
  optInRecord: "urn:codeattest:protocol:v0:retention-opt-in-record",
  minimization: "urn:codeattest:protocol:v0:evidence-minimization-projection"
};

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
  const generatedSchemas = await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href);

  for (const schemaId of Object.values(schemaIds)) {
    assert(schemaId in generatedSchemas.protocolV0Schemas, `${schemaId} must be generated`);
  }

  for (const [schemaId, relativePath] of [
    [schemaIds.storedObject, "valid/stored-object-classification.evidence-artifact.json"],
    [schemaIds.storedObject, "valid/stored-object-classification.log-trace.json"],
    [schemaIds.storedObject, "valid/stored-object-classification.opt-in-pilot.json"],
    [schemaIds.lifecycleEvent, "valid/evidence-lifecycle-event.accessed.json"],
    [schemaIds.lifecycleEvent, "valid/evidence-lifecycle-event.deleted.json"],
    [schemaIds.lifecycleEvent, "valid/evidence-lifecycle-event.retention-status-changed.json"],
    [schemaIds.deletionEvidence, "valid/deletion-evidence.json"],
    [schemaIds.optInRecord, "valid/retention-opt-in-record.json"],
    [schemaIds.minimization, "valid/evidence-minimization-projection.json"]
  ]) {
    await assertValidFixture(protocol, schemaId, relativePath);
  }

  // Only the schema-enforceable negatives belong here; the cross-field rules
  // (forbidden class, missing deletion evidence, inverted period) are semantic
  // and are proven by `npm run protocol:check`.
  await assertInvalidFixture(protocol, schemaIds.optInRecord, "invalid/retention-opt-in-record.missing-period.json", "required");
  await assertInvalidFixture(protocol, schemaIds.optInRecord, "invalid/retention-opt-in-record.wrong-source-class.json", "const");

  await assertDeletionEvidenceRejectsRawSnippetBytes(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts evidence storage binding tests passed.");

/**
 * Deletion Evidence proves deletion by digest, so the schema must have no place
 * to put the deleted bytes themselves.
 */
async function assertDeletionEvidenceRejectsRawSnippetBytes(protocol) {
  const evidence = await readFixtureJson("valid/deletion-evidence.json");
  evidence.deleted_artifact_contents = "SYNTHETIC_DEMO_DATA deleted snippet body";
  const errors = protocol.validateProtocolSchema(schemaIds.deletionEvidence, evidence);
  assert(
    errors.some((error) => error.code === "additional_property"),
    `deletion evidence must not accept artifact contents; got ${JSON.stringify(errors)}`
  );
}

async function assertValidFixture(protocol, schemaId, relativePath) {
  const fixture = await readFixtureJson(relativePath);
  const errors = protocol.validateProtocolSchema(schemaId, fixture);
  assert(errors.length === 0, `${relativePath} must validate against ${schemaId}; got ${JSON.stringify(errors)}`);
}

async function assertInvalidFixture(protocol, schemaId, relativePath, expectedCode) {
  const fixture = await readFixtureJson(relativePath);
  const errors = protocol.validateProtocolSchema(schemaId, fixture);
  assert(errors.some((error) => error.code === expectedCode), `${relativePath} must fail with ${expectedCode}; got ${JSON.stringify(errors)}`);
}

async function readFixtureJson(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
