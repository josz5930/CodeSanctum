import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-review-event-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-review-event-test-dist");

const reviewEventSchemaId = "urn:codeattest:protocol:v0:review-event";
const reviewEventLogSchemaId = "urn:codeattest:protocol:v0:review-event-log";
const reviewEventCustomerProjectionSchemaId = "urn:codeattest:protocol:v0:review-event-customer-projection";

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

  for (const schemaId of [reviewEventSchemaId, reviewEventLogSchemaId, reviewEventCustomerProjectionSchemaId]) {
    assert(schemaId in generatedSchemas.protocolV0Schemas, `${schemaId} must be generated`);
  }

  await assertValidFixture(protocol, reviewEventSchemaId, "valid/review-event.json");
  await assertValidFixture(protocol, reviewEventLogSchemaId, "valid/review-event-log.json");
  await assertValidFixture(protocol, reviewEventCustomerProjectionSchemaId, "valid/review-event-customer-projection.json");

  await assertInvalidFixture(
    protocol,
    reviewEventLogSchemaId,
    "invalid/review-event-log.identity-excludes-invalid.json",
    "enum"
  );
  await assertInvalidFixture(
    protocol,
    reviewEventCustomerProjectionSchemaId,
    "invalid/review-event-customer-projection.internal-only-entry.json",
    "const"
  );

  await assertInternalNoteIsStructurallyImpossibleInProjection(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts review event binding tests passed.");

async function assertInternalNoteIsStructurallyImpossibleInProjection(protocol) {
  const projection = await readFixtureJson("valid/review-event-customer-projection.json");
  projection.entries[0].internal_note = "NOT_CUSTOMER_SOURCE note";
  const errors = protocol.validateProtocolSchema(reviewEventCustomerProjectionSchemaId, projection);
  assert(
    errors.some((error) => error.code === "additional_property"),
    `the customer projection schema must have no internal_note property; got ${JSON.stringify(errors)}`
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
