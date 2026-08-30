import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C5-05/C5-32: outbound-manifest, customer-approval, and disclosure-policy
// semantic rules exist twice -- once in `scripts/lib/protocol-utils.mjs`
// (the pre-existing fixture/gate validator) and once ported to
// `packages/protocol-ts/src/submitted-artifact-semantics.ts` (so intake,
// which must not import `scripts/lib`, can enforce the same rules over
// artifact bytes it received directly, not just the schema-only side-channel
// objects it used to trust). This drives every registered valid/invalid
// fixture for these three schemas through both layers and asserts they
// agree on accept/reject and, for rejections, on the expected reason code.
const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");

// Fixtures registered under `malformed_json`, `camel_case_protocol_field`,
// schema-shape failures (`malformed_algorithm_prefixed_digest`, etc.) exist
// to exercise schema validation, not these semantic layers -- the semantic
// functions intentionally no-op on structurally-unrecognizable input (see
// `isOutboundManifestLike` and friends), so only fixtures whose declared
// `expected_failure` matches a code these functions actually emit belong in
// this suite.
const SEMANTIC_CODES = new Set([
  "outbound_manifest_identity_mismatch",
  "outbound_manifest_missing_evidence_category",
  "outbound_manifest_duplicate_evidence_category",
  "outbound_manifest_policy_coverage_mode_mismatch",
  "outbound_manifest_policy_ref_mismatch",
  "preview_safe_package_state_required",
  "preview_safe_approval_state_required",
  "metadata_only_must_not_include_snippets",
  "metadata_only_warning_required",
  "finding_context_requires_caps_redaction",
  "finding_context_warning_required",
  "extended_requires_selected_files_or_areas",
  "extended_warning_required",
  "retained_review_artifact_class_required",
  "source_code_disclosure_label_required",
  "raw_snippet_wrong_source_class",
  "targeted_file_wrong_source_class",
  "source_code_disclosure_controls_required",
  "outbound_manifest_inclusion_state_mismatch",
  "redaction_limitation_required",
  "outbound_manifest_data_minimization_required",
  "approval_manifest_context_mismatch",
  "approval_displayed_context_required",
  "approval_state_mismatch",
  "approval_warnings_acknowledgement_mismatch",
  "approval_not_submitted_state_required",
  "disclosure_policy_missing_evidence_category",
  "disclosure_policy_duplicate_evidence_category",
  "scanner_finding_set_ref_required",
  "metadata_category_mismatch",
  "dependency_category_mismatch",
  "scanner_findings_category_mismatch",
  "retained_source_requires_opt_in_and_period"
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

  const { outboundManifestSemanticIssues, customerApprovalSemanticIssues, disclosurePolicySemanticIssues } = await import(pathToFileURL(path.join(outDir, "submitted-artifact-semantics.js")).href);
  const protocolUtils = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);

  const fixtureIndex = JSON.parse(await readFile(path.join(fixtureRoot, "v0", "fixture-index.json"), "utf8"));

  const suites = [
    {
      schema: "urn:codeattest:protocol:v0:outbound-manifest",
      tsFn: outboundManifestSemanticIssues,
      scriptFn: (value, errors) => protocolUtils.validateOutboundManifestSemantics(value, errors)
    },
    {
      schema: "urn:codeattest:protocol:v0:customer-approval",
      tsFn: customerApprovalSemanticIssues,
      scriptFn: (value, errors) => protocolUtils.validateCustomerApprovalSemantics(value, errors)
    },
    {
      schema: "urn:codeattest:protocol:v0:disclosure-policy",
      tsFn: disclosurePolicySemanticIssues,
      scriptFn: (value, errors) => protocolUtils.validateDisclosurePolicySemantics(value, errors)
    }
  ];

  let checked = 0;
  for (const suite of suites) {
    const validFixtures = fixtureIndex.valid_fixtures.filter((entry) => entry.schema === suite.schema);
    assert(validFixtures.length > 0, `at least one registered valid fixture is required for ${suite.schema}`);
    for (const fixture of validFixtures) {
      const value = JSON.parse(await readFile(path.join(fixtureRoot, fixture.path), "utf8"));
      const tsIssues = suite.tsFn(value);
      assert(tsIssues.length === 0, `protocol-ts must accept valid fixture ${fixture.path}; got ${tsIssues.join(", ")}`);
      const scriptErrors = [];
      suite.scriptFn(value, scriptErrors);
      assert(scriptErrors.length === 0, `script validator must accept valid fixture ${fixture.path}; got ${scriptErrors.map((error) => error.code).join(", ")}`);
      checked += 1;
    }

    const negativeFixtures = fixtureIndex.negative_fixtures.filter((entry) => entry.schema === suite.schema && semanticExpectedFailure(entry.expected_failure));
    assert(negativeFixtures.length > 0, `at least one registered semantic-negative fixture is required for ${suite.schema}`);
    for (const fixture of negativeFixtures) {
      const value = JSON.parse(await readFile(path.join(fixtureRoot, fixture.path), "utf8"));
      const tsIssues = suite.tsFn(value);
      assert(tsIssues.includes(fixture.expected_failure), `protocol-ts must reject ${fixture.path} with ${fixture.expected_failure}; got ${tsIssues.join(", ")}`);
      const scriptErrors = [];
      suite.scriptFn(value, scriptErrors);
      assert(scriptErrors.some((error) => error.code === fixture.expected_failure), `script validator must reject ${fixture.path} with ${fixture.expected_failure}; got ${scriptErrors.map((error) => error.code).join(", ")}`);
      checked += 1;
    }
  }
  assert(checked > 10, "convergence suite must exercise a meaningful number of fixtures");

  console.log(`protocol-ts / script outbound-manifest, customer-approval, and disclosure-policy semantics convergence tests passed (${checked} fixtures).`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
