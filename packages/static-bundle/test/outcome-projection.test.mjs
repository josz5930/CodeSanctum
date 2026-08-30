// Story 3.5: static bundle projection exposes protocol-backed outcome sections
// without generating a full portal or redefining protocol truth.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-static-outcome-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "static-bundle-outcome-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "static-bundle.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const staticBundle = await import(pathToFileURL(path.join(outDir, "packages", "static-bundle", "src", "index.js")).href);
  assert("projectStaticBundleOutcomeSections" in staticBundle, "static-bundle exports outcome projection helper");

  const acceptedRisk = await readFixture("customer-facing-finding-record.accepted-risk-outcome.json");
  const falsePositive = await readFixture("customer-facing-finding-record.false-positive-outcome.json");
  const acceptedRiskProjection = staticBundle.projectStaticBundleOutcomeSections(acceptedRisk);
  const acceptedRiskSection = acceptedRiskProjection.outcomeSections.find((section) => section.kind === "accepted_risk");
  assert(acceptedRiskSection, "accepted-risk section projects from valid customer-facing record");
  assert(acceptedRiskSection.recordRef === acceptedRisk.accepted_risk_record_ref, "accepted-risk record ref is carried");
  assert(acceptedRiskSection.actorCategory === acceptedRisk.accepted_risk_outcome.actor_category, "accepted-risk actor category is carried");
  assert(acceptedRiskSection.evidenceBasisSummary === acceptedRisk.accepted_risk_outcome.evidence_basis_summary, "accepted-risk evidence basis summary is carried");
  assert(JSON.stringify(acceptedRiskSection.evidenceRefs) === JSON.stringify(acceptedRisk.accepted_risk_outcome.evidence_refs), "accepted-risk evidence refs are carried");
  assert(acceptedRiskSection.body.includes(acceptedRisk.accepted_risk_outcome.customer_acceptance_summary), "accepted-risk customer rationale/sign-off is carried");
  assert(acceptedRiskSection.body.includes(acceptedRisk.accepted_risk_outcome.limitations[0]), "accepted-risk limitations are carried");
  assert(JSON.stringify(acceptedRiskProjection).includes("Customer approved carrying residual risk"), "accepted-risk copy is bounded");
  assertNoUnsafeCopy(acceptedRiskProjection);

  const falsePositiveProjection = staticBundle.projectStaticBundleOutcomeSections(falsePositive);
  const falsePositiveSection = falsePositiveProjection.outcomeSections.find((section) => section.kind === "false_positive");
  assert(falsePositiveSection, "false-positive section projects from valid customer-facing record");
  assert(falsePositiveSection.recordRef === falsePositive.false_positive_record_ref, "false-positive record ref is carried");
  assert(falsePositiveSection.actorCategory === falsePositive.false_positive_outcome.actor_category, "false-positive actor category is carried");
  assert(falsePositiveSection.evidenceBasisSummary === falsePositive.false_positive_outcome.evidence_basis_summary, "false-positive evidence basis summary is carried");
  assert(JSON.stringify(falsePositiveSection.evidenceRefs) === JSON.stringify(falsePositive.false_positive_outcome.evidence_refs), "false-positive evidence refs are carried");
  assert(falsePositiveSection.body.includes(falsePositive.false_positive_outcome.rationale_summary), "false-positive rationale projects");
  assert(falsePositiveSection.body.includes(falsePositive.false_positive_outcome.limitations[0]), "false-positive limitations project");
  assertNoUnsafeCopy(falsePositiveProjection);

  const excluded = structuredClone(acceptedRisk);
  excluded.accepted_risk_outcome.evidence_consumer_export = "exclude";
  assert(staticBundle.projectStaticBundleOutcomeSections(excluded) === null, "excluded accepted-risk outcome sections fail closed for static projection");
  const falsePositiveExcluded = structuredClone(falsePositive);
  falsePositiveExcluded.false_positive_outcome.evidence_consumer_export = "exclude";
  assert(staticBundle.projectStaticBundleOutcomeSections(falsePositiveExcluded) === null, "excluded false-positive outcome sections fail closed for static projection");
  const topLevelExcluded = structuredClone(acceptedRisk);
  topLevelExcluded.evidence_consumer_export = "exclude";
  assert(staticBundle.projectStaticBundleOutcomeSections(topLevelExcluded) === null, "top-level evidence-consumer export exclusion fails closed");
  const hiddenFuture = structuredClone(acceptedRisk);
  hiddenFuture.future_outcome_visibility.accepted_risk_visible = false;
  assert(staticBundle.projectStaticBundleOutcomeSections(hiddenFuture) === null, "future visibility hidden outcome fails closed");
  const topLevelMismatch = structuredClone(acceptedRisk);
  topLevelMismatch.accepted_risk_record_ref = "accepted_risk:other_record";
  assert(staticBundle.projectStaticBundleOutcomeSections(topLevelMismatch) === null, "top-level accepted-risk ref mismatch fails closed");
  const nestedMismatch = structuredClone(falsePositive);
  nestedMismatch.false_positive_outcome.false_positive_record_ref = "false_positive:other_record";
  assert(staticBundle.projectStaticBundleOutcomeSections(nestedMismatch) === null, "nested false-positive ref mismatch fails closed");
  const missingOutcome = structuredClone(acceptedRisk);
  delete missingOutcome.accepted_risk_outcome;
  assert(staticBundle.projectStaticBundleOutcomeSections(missingOutcome) === null, "missing nested outcome section fails closed");
  const malformedAccepted = structuredClone(acceptedRisk);
  delete malformedAccepted.accepted_risk_outcome.customer_acceptance_summary;
  assert(staticBundle.projectStaticBundleOutcomeSections(malformedAccepted) === null, "malformed accepted-risk outcome section fails closed");
  const malformedFalsePositive = structuredClone(falsePositive);
  malformedFalsePositive.false_positive_outcome.evidence_refs = [""];
  assert(staticBundle.projectStaticBundleOutcomeSections(malformedFalsePositive) === null, "malformed false-positive outcome section fails closed");
  for (const phrase of ["auditor accepted", "SOC 2 compliant", "regulator approval", "regulatory approval", "deployment certified", "control satisfied", "customer says this is fixed and verified", "remediation completed", "token:"]) {
    const unsafe = structuredClone(acceptedRisk);
    unsafe.accepted_risk_outcome.customer_acceptance_summary = `SYNTHETIC_DEMO_DATA ${phrase} outcome wording. NOT_CUSTOMER_SOURCE.`;
    assert(staticBundle.projectStaticBundleOutcomeSections(unsafe) === null, `claim-unsafe nested outcome copy fails closed for ${phrase}`);
  }
  assert(staticBundle.projectStaticBundleOutcomeSections(null) === null, "malformed input returns null instead of throwing");

  // C6-11: projectStaticBundleOutcomeSections previously ran the ported semantic
  // validator with no schema-validation step first, even though the ported
  // validator's record-like check deliberately defers schema shape to that layer.
  // A schema-invalid or non-protocol object with a well-formed nested outcome
  // section could still project.
  const schemaInvalidVersion = structuredClone(acceptedRisk);
  schemaInvalidVersion.protocol_version = "v99";
  assert(staticBundle.projectStaticBundleOutcomeSections(schemaInvalidVersion) === null, "schema-invalid protocol version fails closed");

  const nonProtocolObject = {
    visibility: "customer_facing",
    evidence_consumer_export: "include",
    review_id: "review:probe",
    review_finding_draft_ref: "review_finding_draft:probe",
    accepted_risk_record_ref: acceptedRisk.accepted_risk_record_ref,
    future_outcome_visibility: { accepted_risk_visible: true, accepted_risk_record_ref: acceptedRisk.accepted_risk_record_ref },
    accepted_risk_outcome: structuredClone(acceptedRisk.accepted_risk_outcome)
  };
  assert(staticBundle.projectStaticBundleOutcomeSections(nonProtocolObject) === null, "minimal non-protocol object must not project outcome sections");

  await testRegisteredCustomerFacingFindingFixtures(staticBundle);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("static-bundle outcome projection tests passed.");

async function testRegisteredCustomerFacingFindingFixtures(staticBundle) {
  const fixtureIndex = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "fixture-index.json"), "utf8"));
  const schemaId = "urn:codeattest:protocol:v0:customer-facing-finding-record";
  const validFixtures = fixtureIndex.valid_fixtures.filter((entry) => entry.schema === schemaId);
  const negativeFixtures = fixtureIndex.negative_fixtures.filter((entry) => entry.schema === schemaId);
  assert(validFixtures.length > 0, "at least one valid customer-facing-finding fixture is required");
  assert(negativeFixtures.length > 0, "at least one invalid customer-facing-finding fixture is required");

  for (const fixture of validFixtures) {
    const record = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", fixture.path), "utf8"));
    const projection = staticBundle.projectStaticBundleOutcomeSections(record);
    const hasExportableOutcome = (record.accepted_risk_outcome?.evidence_consumer_export === "include" && record.future_outcome_visibility?.accepted_risk_visible === true) ||
      (record.false_positive_outcome?.evidence_consumer_export === "include" && record.future_outcome_visibility?.false_positive_visible === true);
    if (record.evidence_consumer_export === "include" && hasExportableOutcome) {
      assert(projection !== null, `exportable outcome fixture ${fixture.path} must project`);
      assert(projection.outcomeSections.length > 0, `exportable outcome fixture ${fixture.path} must include at least one section`);
    } else {
      assert(projection === null, `valid fixture ${fixture.path} without exportable outcome sections must not project`);
    }
  }

  for (const fixture of negativeFixtures) {
    const record = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", fixture.path), "utf8"));
    assert(staticBundle.projectStaticBundleOutcomeSections(record) === null, `invalid fixture ${fixture.path} must fail closed`);
  }
}

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertNoUnsafeCopy(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["auditor accepted", "soc 2 accepted", "control satisfied", "regulator approved", "regulatory approval", "independent assurance", "no vulnerabilities"]) {
    assert(!serialized.includes(forbidden), `static projection must not contain forbidden copy: ${forbidden}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
