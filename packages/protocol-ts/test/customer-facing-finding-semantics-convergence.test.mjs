import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C6-11: customer-facing-finding semantic rules exist twice -- once in
// `scripts/lib/protocol-utils.mjs` (the fixture/gate validator) and once ported
// to `packages/protocol-ts/src/customer-facing-finding-semantics.ts` (so UI and
// static-bundle, which must not import `scripts/lib`, can fail closed on the
// same record). This drives every registered valid/invalid fixture for that
// schema through both layers and asserts they agree on accept/reject and the
// expected reason code.
const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-cff-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-cff-semantics-test-dist");

const SCHEMA_ID = "urn:codeattest:protocol:v0:customer-facing-finding-record";

const SEMANTIC_CODES = new Set([
  "customer_facing_finding_source_class_required",
  "customer_facing_finding_visibility_required",
  "customer_facing_finding_status_separation_required",
  "customer_facing_finding_reference_mismatch",
  "customer_facing_finding_evidence_ref_required",
  "customer_facing_finding_guidance_actionable_details_required",
  "customer_facing_finding_guidance_insufficient_evidence_reason_required",
  "customer_facing_finding_guidance_next_step_required",
  "customer_facing_finding_verification_reference_required",
  "customer_facing_finding_future_outcome_reference_required",
  "customer_facing_finding_outcome_section_required",
  "customer_facing_finding_outcome_details_required",
  "customer_facing_finding_outcome_export_required",
  "customer_facing_finding_customer_notes_export_forbidden",
  "customer_facing_finding_due_date_invalid",
  "customer_facing_finding_script_pricing_tbd_required",
  "customer_facing_finding_raw_source_text_forbidden",
  "customer_facing_finding_claim_unsafe_text_forbidden"
]);

function semanticExpectedFailure(expectedFailure) {
  return typeof expectedFailure === "string" && SEMANTIC_CODES.has(expectedFailure);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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

  const { customerFacingFindingRecordSemanticIssues } = await import(pathToFileURL(path.join(outDir, "customer-facing-finding-semantics.js")).href);
  const protocolUtils = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);
  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));

  const validFixtures = fixtureIndex.valid_fixtures.filter((entry) => entry.schema === SCHEMA_ID);
  assert(validFixtures.length > 0, "at least one registered valid customer-facing-finding fixture is required");

  let checked = 0;
  for (const fixture of validFixtures) {
    const value = JSON.parse(await readFile(path.join(fixtureRoot, fixture.path), "utf8"));
    const tsIssues = customerFacingFindingRecordSemanticIssues(value);
    assert(tsIssues.length === 0, `protocol-ts must accept valid fixture ${fixture.path}; got ${tsIssues.join(", ")}`);
    const scriptErrors = [];
    protocolUtils.validateCustomerFacingFindingRecordSemantics(value, scriptErrors);
    assert(scriptErrors.length === 0, `script validator must accept valid fixture ${fixture.path}; got ${scriptErrors.map((error) => error.code).join(", ")}`);
    checked += 1;
  }

  const negativeFixtures = fixtureIndex.negative_fixtures.filter((entry) => entry.schema === SCHEMA_ID && semanticExpectedFailure(entry.expected_failure));
  assert(negativeFixtures.length > 0, "at least one registered semantic-negative customer-facing-finding fixture is required");
  for (const fixture of negativeFixtures) {
    const value = JSON.parse(await readFile(path.join(fixtureRoot, fixture.path), "utf8"));
    const tsIssues = customerFacingFindingRecordSemanticIssues(value);
    assert(tsIssues.includes(fixture.expected_failure), `protocol-ts must reject ${fixture.path} with ${fixture.expected_failure}; got ${tsIssues.join(", ")}`);
    const scriptErrors = [];
    protocolUtils.validateCustomerFacingFindingRecordSemantics(value, scriptErrors);
    assert(scriptErrors.some((error) => error.code === fixture.expected_failure), `script validator must reject ${fixture.path} with ${fixture.expected_failure}; got ${scriptErrors.map((error) => error.code).join(", ")}`);
    checked += 1;
  }

  assert(checked >= 37, `convergence suite must exercise every registered customer-facing-finding fixture; checked ${checked}`);
  console.log(`protocol-ts / script customer-facing-finding semantics convergence tests passed (${checked} fixtures).`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
