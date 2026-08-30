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
const vendorReceiptSchemaId = "urn:codeattest:protocol:v0:vendor-receipt";
const signatureEnvelopeSchemaId = "urn:codeattest:protocol:v0:signature-envelope";
const identitySigningInputSchemaId = "urn:codeattest:protocol:v0:identity-signing-input";

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

  assert(vendorReceiptSchemaId in generatedSchemas.protocolV0Schemas, "Vendor Receipt schema id must be generated");
  assert(typeof protocol.validateProtocolSchema === "function", "validateProtocolSchema must be exported");

  await assertValidFixture(protocol, vendorReceiptSchemaId, "valid/vendor-receipt.json");
  await assertValidReceiptTimestampForms(protocol);
  await assertDuplicateReceiptCountCategoriesRejected(protocol);
  await assertValidFixture(protocol, signatureEnvelopeSchemaId, "valid/signature-envelope.receipt.json");
  await assertValidFixture(protocol, identitySigningInputSchemaId, "signing-inputs/vendor-receipt-identity.json");

  await assertInvalidFixture(protocol, vendorReceiptSchemaId, "invalid/vendor-receipt.invalid-timestamp.json", "utc_rfc3339_timestamp");
  await assertInvalidFixture(protocol, vendorReceiptSchemaId, "invalid/vendor-receipt.missing-key-metadata.json", "required");

  console.log("protocol-ts vendor receipt binding tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

async function assertValidFixture(protocol, schemaId, relativePath) {
  const fixture = await readFixtureJson(relativePath);
  const errors = protocol.validateProtocolSchema(schemaId, fixture);
  assert(errors.length === 0, `${relativePath} must validate against ${schemaId}; got ${JSON.stringify(errors)}`);
}

async function assertValidReceiptTimestampForms(protocol) {
  const fixture = await readFixtureJson("valid/vendor-receipt.json");
  for (const timestamp of ["2026-07-10T00:20:00.123Z", "2026-07-10T00:20:00.123456789Z", "2026-07-10T00:20:00+00:00"]) {
    const receipt = structuredClone(fixture);
    receipt.receipt_timestamp = timestamp;
    receipt.receipt_signature.signing_time = timestamp;
    receipt.public_verification_metadata.signing_time = timestamp;
    const errors = protocol.validateProtocolSchema(vendorReceiptSchemaId, receipt);
    assert(errors.length === 0, `UTC RFC 3339 timestamp ${timestamp} must validate; got ${JSON.stringify(errors)}`);
  }
}

async function assertDuplicateReceiptCountCategoriesRejected(protocol) {
  const receipt = await readFixtureJson("valid/vendor-receipt.json");
  receipt.approved_artifact_count_summary.categories.push(structuredClone(receipt.approved_artifact_count_summary.categories[0]));
  receipt.received_artifact_count_summary.categories.push(structuredClone(receipt.received_artifact_count_summary.categories[0]));
  const errors = protocol.validateProtocolSchema(vendorReceiptSchemaId, receipt);
  assert(errors.some((error) => error.code === "unique_items"), `duplicate artifact count categories must fail schema validation; got ${JSON.stringify(errors)}`);
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
