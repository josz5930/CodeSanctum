import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C8-09: schema validation behavior is duplicated in scripts/lib/protocol-utils.mjs
// (validateAgainstSchema) and packages/protocol-ts/src/validation.ts
// (validateProtocolSchema). Public fixtures can stay green under the script
// gate while protocol-ts runtime consumers (UI/control-plane) drift on the
// same schema if the two implementations disagree on a keyword. This feeds
// every fixture-index.json valid/negative fixture through both validators
// and requires the same normalized schema-error-code set, plus focused
// mutation cases for conditional/composition keywords and scalar/array bounds
// not already exercised by a registered negative fixture.
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

  const protocolTs = await import(pathToFileURL(path.join(outDir, "index.js")).href);
  const { loadSchemas, validateAgainstSchema } = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);
  const { schemaMap } = await loadSchemas();

  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));
  const allEntries = [...(fixtureIndex.valid_fixtures ?? []), ...(fixtureIndex.negative_fixtures ?? [])];

  let compared = 0;
  for (const entry of allEntries) {
    // Mirrors scripts/protocol-check.mjs's own skips: malformed_json fixtures
    // are not valid JSON to schema-validate, and self_referential_identity is
    // a semantic (not schema) failure mode that the script gate itself skips
    // schema validation for.
    if (entry.expected_failure === "malformed_json" || entry.expected_failure === "self_referential_identity") {
      continue;
    }
    const schema = schemaMap.get(entry.schema);
    if (schema === undefined) {
      throw new Error(`${entry.path} references unknown schema ${entry.schema}`);
    }
    const value = JSON.parse(await readFile(path.join(fixtureRoot, entry.path), "utf8"));
    compareSchemaCodes(entry.path, entry.schema, value, schema, schemaMap, protocolTs, validateAgainstSchema);
    compared += 1;
  }
  assert(compared > 100, `expected to compare a substantial fixture corpus, only compared ${compared}`);

  // Focused mutation: verification-evidence-record if/then.required — no
  // registered negative fixture exercises reviewer_authored_script_output
  // without reviewer_validation_script_ref.
  const verificationEvidenceSchemaId = "urn:codeattest:protocol:v0:verification-evidence-record";
  const verificationEvidenceBase = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/verification-evidence-record.follow-up-commit.json"), "utf8"));
  const missingReviewerScriptRef = { ...verificationEvidenceBase, requested_verification_type: "reviewer_authored_script_output" };
  compareSchemaCodes(
    "mutation: verification-evidence-record reviewer_authored_script_output without reviewer_validation_script_ref",
    verificationEvidenceSchemaId,
    missingReviewerScriptRef,
    schemaMap.get(verificationEvidenceSchemaId),
    schemaMap,
    protocolTs,
    validateAgainstSchema
  );
  const missingReviewerScriptRefCodes = protocolTs.validateProtocolSchema(verificationEvidenceSchemaId, missingReviewerScriptRef).map((error) => error.code);
  assert(missingReviewerScriptRefCodes.includes("required"), `expected a required-keyword violation for missing reviewer_validation_script_ref; got ${JSON.stringify(missingReviewerScriptRefCodes)}`);

  // Focused mutations: submission-outcome maxItems/uniqueItems/maxLength —
  // no registered negative fixture exercises these array/string bounds.
  const submissionOutcomeSchemaId = "urn:codeattest:protocol:v0:submission-outcome";
  const submissionOutcomeBase = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/submission-outcome.received-with-receipt.json"), "utf8"));
  const submissionOutcomeSchema = schemaMap.get(submissionOutcomeSchemaId);

  const duplicateIdentities = {
    ...submissionOutcomeBase,
    submission_identities: [submissionOutcomeBase.submission_identities[0], submissionOutcomeBase.submission_identities[0]]
  };
  compareSchemaCodes("mutation: submission-outcome duplicate submission_identities (uniqueItems)", submissionOutcomeSchemaId, duplicateIdentities, submissionOutcomeSchema, schemaMap, protocolTs, validateAgainstSchema);
  const duplicateIdentitiesCodes = protocolTs.validateProtocolSchema(submissionOutcomeSchemaId, duplicateIdentities).map((error) => error.code);
  assert(duplicateIdentitiesCodes.includes("unique_items"), `expected a uniqueItems violation for duplicate submission_identities; got ${JSON.stringify(duplicateIdentitiesCodes)}`);

  const tooManyIdentities = {
    ...submissionOutcomeBase,
    submission_identities: Array.from({ length: 17 }, (_, index) => ({
      identity_type: "manifest_id",
      identity_value: `sha256:${String(index).padStart(64, "0")}`
    }))
  };
  compareSchemaCodes("mutation: submission-outcome 17 submission_identities (maxItems)", submissionOutcomeSchemaId, tooManyIdentities, submissionOutcomeSchema, schemaMap, protocolTs, validateAgainstSchema);
  const tooManyIdentitiesCodes = protocolTs.validateProtocolSchema(submissionOutcomeSchemaId, tooManyIdentities).map((error) => error.code);
  assert(tooManyIdentitiesCodes.includes("max_items"), `expected a maxItems violation for 17 submission_identities; got ${JSON.stringify(tooManyIdentitiesCodes)}`);

  const tooLongSummary = { ...submissionOutcomeBase, customer_facing_summary: "a".repeat(513) };
  compareSchemaCodes("mutation: submission-outcome customer_facing_summary over maxLength", submissionOutcomeSchemaId, tooLongSummary, submissionOutcomeSchema, schemaMap, protocolTs, validateAgainstSchema);
  const tooLongSummaryCodes = protocolTs.validateProtocolSchema(submissionOutcomeSchemaId, tooLongSummary).map((error) => error.code);
  assert(tooLongSummaryCodes.includes("max_length"), `expected a maxLength violation for a 513-char customer_facing_summary; got ${JSON.stringify(tooLongSummaryCodes)}`);

  const scannerFindingSetSchemaId = "urn:codeattest:protocol:v0:scanner-finding-set";
  const scannerFindingSetBase = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/scanner-finding-set.json"), "utf8"));
  const scannerFindingSetSchema = schemaMap.get(scannerFindingSetSchemaId);
  const failedRunWithoutReason = structuredClone(scannerFindingSetBase);
  failedRunWithoutReason.scanner_runs[0].status = "failed";
  delete failedRunWithoutReason.scanner_runs[0].failure_reason;
  compareSchemaCodes("mutation: scanner failure without failure_reason (if/then)", scannerFindingSetSchemaId, failedRunWithoutReason, scannerFindingSetSchema, schemaMap, protocolTs, validateAgainstSchema);
  const failedRunWithoutReasonCodes = protocolTs.validateProtocolSchema(scannerFindingSetSchemaId, failedRunWithoutReason).map((error) => error.code);
  assert(failedRunWithoutReasonCodes.includes("required"), `expected a required-keyword violation for missing failure_reason; got ${JSON.stringify(failedRunWithoutReasonCodes)}`);

  const successfulRunWithReason = structuredClone(scannerFindingSetBase);
  successfulRunWithReason.scanner_runs[0].failure_reason = "contradictory success detail";
  compareSchemaCodes("mutation: scanner success with failure_reason (dependentSchemas/not)", scannerFindingSetSchemaId, successfulRunWithReason, scannerFindingSetSchema, schemaMap, protocolTs, validateAgainstSchema);
  const successfulRunWithReasonCodes = protocolTs.validateProtocolSchema(scannerFindingSetSchemaId, successfulRunWithReason).map((error) => error.code);
  assert(successfulRunWithReasonCodes.includes("enum") && successfulRunWithReasonCodes.includes("not"), `expected dependentSchemas enum and not violations for success with failure_reason; got ${JSON.stringify(successfulRunWithReasonCodes)}`);

  const reviewDraftSetSchemaId = "urn:codeattest:protocol:v0:review-finding-draft-set";
  const reviewDraftSetBase = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/review-finding-draft-set.grouped.json"), "utf8"));
  const contradictoryNoFindings = structuredClone(reviewDraftSetBase);
  contradictoryNoFindings.normalization_status = "no_findings_produced";
  contradictoryNoFindings.no_findings_statement = "No findings were produced by the configured inputs";
  compareSchemaCodes("mutation: no-findings status with drafts (oneOf)", reviewDraftSetSchemaId, contradictoryNoFindings, schemaMap.get(reviewDraftSetSchemaId), schemaMap, protocolTs, validateAgainstSchema);
  const contradictoryNoFindingsCodes = protocolTs.validateProtocolSchema(reviewDraftSetSchemaId, contradictoryNoFindings).map((error) => error.code);
  assert(contradictoryNoFindingsCodes.includes("one_of"), `expected a oneOf violation for no-findings status with drafts; got ${JSON.stringify(contradictoryNoFindingsCodes)}`);

  const disclosurePolicySchemaId = "urn:codeattest:protocol:v0:disclosure-policy";
  const disclosurePolicyBase = JSON.parse(await readFile(path.join(fixtureRoot, "v0/valid/disclosure-policy.json"), "utf8"));
  const missingIncludedRawSnippet = structuredClone(disclosurePolicyBase);
  missingIncludedRawSnippet.evidence_categories.find((category) => category.category === "raw_snippets").included = false;
  compareSchemaCodes("mutation: finding-context mode without included raw snippet (contains)", disclosurePolicySchemaId, missingIncludedRawSnippet, schemaMap.get(disclosurePolicySchemaId), schemaMap, protocolTs, validateAgainstSchema);
  const missingIncludedRawSnippetCodes = protocolTs.validateProtocolSchema(disclosurePolicySchemaId, missingIncludedRawSnippet).map((error) => error.code);
  assert(missingIncludedRawSnippetCodes.includes("contains"), `expected a contains violation for missing included raw snippet; got ${JSON.stringify(missingIncludedRawSnippetCodes)}`);

  console.log(`protocol-ts / script schema-keyword parity tests passed (${compared} corpus fixtures + 8 focused mutations).`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function compareSchemaCodes(label, schemaId, value, schema, schemaMap, protocolTs, validateAgainstSchema) {
  const scriptCodes = new Set(validateAgainstSchema(value, schema, schemaMap).map((error) => error.code));
  const protocolTsCodes = new Set(protocolTs.validateProtocolSchema(schemaId, value).map((error) => error.code));
  const onlyInScript = [...scriptCodes].filter((code) => !protocolTsCodes.has(code));
  const onlyInProtocolTs = [...protocolTsCodes].filter((code) => !scriptCodes.has(code));
  assert(
    onlyInScript.length === 0 && onlyInProtocolTs.length === 0,
    `${label}: schema-error code sets differ (script-only: ${JSON.stringify(onlyInScript)}, protocol-ts-only: ${JSON.stringify(onlyInProtocolTs)})`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
