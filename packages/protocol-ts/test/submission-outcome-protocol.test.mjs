// Story 2.6: the generated bindings must carry the submission-outcome artifact,
// and the TypeScript validator must agree with the Node gate about which
// fixtures are schema-valid. C1-01 makes expressible state/receipt/reason-code
// rules schema-authoritative; equality, derived ids, and claim-safe wording stay
// in the semantic layer.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-submission-outcome-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-submission-outcome-test-dist");

const schemaIds = {
  outcome: "urn:codeattest:protocol:v0:submission-outcome",
  reviewEvent: "urn:codeattest:protocol:v0:review-event",
  reviewEventLog: "urn:codeattest:protocol:v0:review-event-log"
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

  assert(schemaIds.outcome in generatedSchemas.protocolV0Schemas, `${schemaIds.outcome} must be generated`);
  assert(!("urn:codeattest:protocol:v0:submission-attempt-history" in generatedSchemas.protocolV0Schemas), "Story 2.6 must not generate a bespoke attempt-history schema");

  for (const [schemaId, relativePath] of [
    [schemaIds.outcome, "valid/submission-outcome.received-with-receipt.json"],
    [schemaIds.outcome, "valid/submission-outcome.rejected-no-receipt.json"],
    [schemaIds.outcome, "valid/submission-outcome.quarantined-no-receipt.json"],
    [schemaIds.reviewEventLog, "valid/review-event-log.submission-failures.json"]
  ]) {
    await assertValidFixture(protocol, schemaId, relativePath);
  }

  for (const [relativePath, expectedCode] of [
    ["invalid/submission-outcome.failure-with-receipt-ref.json", "not"],
    ["invalid/submission-outcome.failure-without-reason-codes.json", "min_items"],
    ["invalid/submission-outcome.received-with-reason-codes.json", "not"],
    ["invalid/submission-outcome.failure-next-path-state-mismatch.json", "enum"],
    ["invalid/submission-outcome.next-path-state-mismatch.json", "const"]
  ]) {
    await assertInvalidFixture(protocol, schemaIds.outcome, relativePath, expectedCode);
  }

  // These require claim interpretation or equality/derivation against sibling
  // values, which Draft 2020-12 cannot express without nonstandard $data.
  for (const [schemaId, relativePath] of [
    [schemaIds.outcome, "invalid/submission-outcome.summary-implies-review.json"],
    [schemaIds.reviewEvent, "invalid/review-event.submission-received-outcome.json"],
    [schemaIds.reviewEvent, "invalid/review-event.submission-type-state-mismatch.json"],
    [schemaIds.reviewEvent, "invalid/review-event.submission-missing-outcome-ref.json"],
    [schemaIds.reviewEvent, "invalid/review-event.submission-idempotency-not-derived.json"]
  ]) {
    await assertValidFixture(protocol, schemaId, relativePath);
  }

  testSchemaEnforceableShapes(protocol);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts submission outcome protocol tests passed.");

/** The parts of the three-outcome contract the schema alone can hold. */
function testSchemaEnforceableShapes(protocol) {
  const base = {
    protocol_version: "codeattest.v0",
    submission_outcome_id: "submission_outcome:synthetic-demo-0001",
    review_id: "review:synthetic-demo-001",
    outcome_state: "rejected_no_receipt",
    bundle_instance_id: "bundle_instance:synthetic-demo-0001",
    submission_attempt_id: "submission_attempt:synthetic-demo-0001",
    occurred_at: "2026-07-20T00:00:00Z",
    submission_identities: [{ identity_type: "manifest_id", identity_value: `sha256:${"1a".repeat(32)}` }],
    failure_reason_codes: ["artifact_digest_mismatch"],
    next_path: "retry",
    customer_facing_summary: "This submission was rejected before any receipt was issued."
  };

  assertNoErrors(protocol, schemaIds.outcome, base);

  assertErrorCode(protocol, schemaIds.outcome, { ...base, outcome_state: "received" }, "enum");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, next_path: "escalate" }, "enum");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, submission_identities: [] }, "min_items");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, occurred_at: "2026-07-20T00:00:00-00:00" }, "pattern");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, bundle_instance_id: "bundle:demo" }, "pattern");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, failure_reason_codes: ["Digest_Mismatch"] }, "pattern");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, vendor_receipt_ref: "receipt-0001" }, "pattern");
  assertErrorCode(protocol, schemaIds.outcome, { ...base, unexpected_field: "x" }, "additional_property");
  assertErrorCode(
    protocol,
    schemaIds.outcome,
    { ...base, submission_identities: [{ identity_type: "customer_id", identity_value: "x" }] },
    "enum"
  );
  assertErrorCode(
    protocol,
    schemaIds.outcome,
    {
      ...base,
      submission_identities: [
        { identity_type: "manifest_id", identity_value: "x" },
        { identity_type: "manifest_id", identity_value: "x" }
      ]
    },
    "unique_items"
  );

  // C3-04: direct max_length schema-negative coverage. customer_facing_summary
  // is one of the few live schema fields with a maxLength keyword.
  // dependent_required already has its own dedicated direct test against
  // artifact-reference's content_path/content_path_anchor pair (the only
  // schema that currently declares dependentRequired) in
  // artifact-reference-protocol.test.mjs.
  assertErrorCode(protocol, schemaIds.outcome, { ...base, customer_facing_summary: "x".repeat(513) }, "max_length");
  assertNoErrors(protocol, schemaIds.outcome, { ...base, customer_facing_summary: "x".repeat(512) });
}

function assertNoErrors(protocol, schemaId, value) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(errors.length === 0, `${schemaId} rejected a structurally valid value: ${JSON.stringify(errors)}`);
}

function assertErrorCode(protocol, schemaId, value, expectedCode) {
  const errors = protocol.validateProtocolSchema(schemaId, value);
  assert(
    errors.some((error) => error.code === expectedCode),
    `${schemaId} must report ${expectedCode}; got ${JSON.stringify(errors)}`
  );
}

async function assertValidFixture(protocol, schemaId, relativePath) {
  const fixture = JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
  const errors = protocol.validateProtocolSchema(schemaId, fixture);
  assert(errors.length === 0, `${relativePath} must validate against ${schemaId}; got ${JSON.stringify(errors)}`);
}

async function assertInvalidFixture(protocol, schemaId, relativePath, expectedCode) {
  const fixture = JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
  const errors = protocol.validateProtocolSchema(schemaId, fixture);
  assert(errors.some((error) => error.code === expectedCode), `${relativePath} must fail with ${expectedCode}; got ${JSON.stringify(errors)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
