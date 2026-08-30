// Story 4.1: static-bundle verification-pass scope projection is minimal,
// protocol-backed, and fail-closed.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-static-verification-scope-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "static-verification-scope-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "static-bundle.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const staticBundle = await import(pathToFileURL(path.join(outDir, "packages", "static-bundle", "src", "index.js")).href);
  assert("projectStaticBundleVerificationScope" in staticBundle, "projection helper must be exported");

  const scope = await readFixture("verification-pass-scope.additional-script-pricing-tbd.json");
  const projection = staticBundle.projectStaticBundleVerificationScope(scope);
  assert(projection !== null, "valid customer-facing scope projects");
  assert(projection.kind === "static-bundle-verification-pass-scope", "projection kind is stable");
  assert(projection.verificationPassRef === scope.verification_pass_id, "projection preserves pass ref");
  assert(projection.selectedFindings[0].eligibilityState === "requires_additional_agreement", "eligibility stays text-first");
  assert(projection.includedScriptSlots.length === 1, "included slot visible");
  assert(projection.additionalScriptCandidates[0].includes("pricing TBD"), "additional scripts remain pricing TBD");
  assert(projection.disclosure.join(" ").includes("not a complete fresh secure-code review"), "projection preserves claim-safe limitation");
  assertNoUnsafeCopy(projection);

  const outcomeScope = await readFixture("verification-pass-scope.outcome-visible-out-of-scope.json");
  const outcomeProjection = staticBundle.projectStaticBundleVerificationScope(outcomeScope);
  assert(outcomeProjection !== null, "outcome-visible out-of-scope projection succeeds");
  assert(outcomeProjection.selectedFindings[0].acceptedRiskRecordRef === outcomeScope.selected_findings[0].accepted_risk_record_ref, "accepted-risk ref is preserved");
  assert(outcomeProjection.selectedFindings[0].falsePositiveRecordRef === outcomeScope.selected_findings[0].false_positive_record_ref, "false-positive ref is preserved");

  assert(staticBundle.projectStaticBundleVerificationScope(null) === null, "malformed scope fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, visibility: "internal_only" }) === null, "internal-only scope fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, review_id: "review bad" }) === null, "malformed review ref fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, selected_findings: [{ ...scope.selected_findings[0], eligibility_state: "verified_with_evidence" }] }) === null, "verified outcome state cannot project as scope");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_script_allocation: { ...scope.included_script_allocation, included_slots: [{ ...scope.included_script_allocation.included_slots[0], slot: 4 }] } }) === null, "invalid included slot fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], pricing_posture: "included_base_package" }] } }) === null, "invalid additional pricing posture fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], reason: "SYNTHETIC_DEMO_DATA additional reviewer work is recorded. NOT_CUSTOMER_SOURCE." }] } }) === null, "additional script reason without pricing TBD fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], finding_ref: "review_finding_draft:missing" }] } }) === null, "orphaned allocation fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...outcomeScope, selected_findings: [{ ...outcomeScope.selected_findings[0], eligibility_state: "eligible" }] }) === null, "outcome-visible scope must preserve out-of-scope posture");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, limitations: ["SYNTHETIC_DEMO_DATA fixed and verified with no vulnerabilities. NOT_CUSTOMER_SOURCE."] }) === null, "unsafe success copy fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, pass_deadline: "2026-08-28T00:00:01Z" }) === null, "scope beyond 30 days fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, pass_deadline: "2026-08-28T00:00:00.000000001Z" }) === null, "scope one nanosecond beyond 30 days fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_pass_start_basis: "SYNTHETIC_DEMO_DATA guaranteed within 30 days. NOT_CUSTOMER_SOURCE." }) === null, "SLA-implying deadline basis fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, pass_deadline: scope.included_pass_started_at }) === null, "zero-day scope fails closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_pass_started_at: "2026-02-30T00:00:00Z", scope_recorded_at: "2026-03-02T12:00:00Z", pass_deadline: "2026-04-01T00:00:00Z" }) === null, "calendar-rollover timestamps fail closed");
  assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, included_script_allocation: { ...scope.included_script_allocation, included_slots: [{ ...scope.included_script_allocation.included_slots[0] }, { ...scope.included_script_allocation.included_slots[0], slot: 2 }] } }) === null, "duplicate included script refs fail closed");
  const eligibleWithoutPath = await readFixture("verification-pass-scope.requires-validation-path.json");
  delete eligibleWithoutPath.selected_findings[0].validation_path_ref;
  assert(staticBundle.projectStaticBundleVerificationScope(eligibleWithoutPath) === null, "eligible customer-side validation without a formal path fails closed");
  const blockedWithoutNextStep = { ...eligibleWithoutPath, selected_findings: [{ ...eligibleWithoutPath.selected_findings[0], eligibility_state: "blocked_pending_validation_path", eligibility_reason: "SYNTHETIC_DEMO_DATA waiting without a specific action. NOT_CUSTOMER_SOURCE." }] };
  assert(staticBundle.projectStaticBundleVerificationScope(blockedWithoutNextStep) === null, "blocked state without a specific next step fails closed");
  for (const eligibilityReason of [
    "SYNTHETIC_DEMO_DATA no validation path has been recorded yet. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA do not record a formal path yet. NOT_CUSTOMER_SOURCE."
  ]) {
    assert(staticBundle.projectStaticBundleVerificationScope({ ...blockedWithoutNextStep, selected_findings: [{ ...blockedWithoutNextStep.selected_findings[0], eligibility_reason: eligibilityReason }] }) === null, "negated blocked-state non-action fails closed");
  }
  const outcomeFormalPath = await readFixture("verification-pass-scope.outcome-eligible-with-formal-path.json");
  const outcomeFormalProjection = staticBundle.projectStaticBundleVerificationScope(outcomeFormalPath);
  assert(outcomeFormalProjection !== null, "outcome context with a new formal path projects");
  assert(outcomeFormalProjection.selectedFindings[0].eligibilityReason === outcomeFormalPath.selected_findings[0].eligibility_reason, "formal-path eligibility reason is preserved exactly");
  assert(JSON.stringify(outcomeFormalProjection.selectedFindings[0].limitations) === JSON.stringify(outcomeFormalPath.selected_findings[0].limitations), "formal-path limitations are preserved exactly");
  assert(outcomeFormalProjection.selectedFindings[0].acceptedRiskRecordRef === outcomeFormalPath.selected_findings[0].accepted_risk_record_ref, "formal-path accepted-risk ref is preserved");
  const uncertainBasis = {
    ...scope,
    verification_pass_id: "verification_pass:synthetic_pass_uncertain_basis_valid_001",
    included_pass_start_basis: "SYNTHETIC_DEMO_DATA estimated fallback timestamp used because review completion was unavailable. NOT_CUSTOMER_SOURCE.",
    limitations: [
      "SYNTHETIC_DEMO_DATA estimated fallback basis is recorded for the included-pass deadline calculation and is not an SLA. NOT_CUSTOMER_SOURCE.",
      "SYNTHETIC_DEMO_DATA this selection is not a complete fresh secure-code review and does not record a verification decision. NOT_CUSTOMER_SOURCE."
    ]
  };
  assert(staticBundle.projectStaticBundleVerificationScope(uncertainBasis) !== null, "uncertain basis with explicit limitation projects");
  const negatedDisclaimer = await readFixture("verification-pass-scope.negated-disclaimer.json");
  const negatedProjection = staticBundle.projectStaticBundleVerificationScope(negatedDisclaimer);
  assert(negatedProjection !== null, "negated disclaimer remains available through static projection");
  assert(negatedProjection.selectedFindings[0].eligibilityReason === negatedDisclaimer.selected_findings[0].eligibility_reason, "negated disclaimer reason is preserved exactly");
  assert(JSON.stringify(negatedProjection.selectedFindings[0].limitations) === JSON.stringify(negatedDisclaimer.selected_findings[0].limitations), "negated disclaimer limitations are preserved exactly");
  const customerProjectionScope = await readFixture("verification-pass-scope.customer-facing-projection.json");
  const customerProjection = staticBundle.projectStaticBundleVerificationScope(customerProjectionScope);
  assert(customerProjection !== null, "customer-facing projection scope projects");
  assert(JSON.stringify(customerProjection.includedScriptSlots) === JSON.stringify(customerProjectionScope.included_script_allocation.included_slots.map((slot) => `included slot ${slot.slot}: ${slot.validation_script_ref}`)), "included slot/script identities are preserved exactly");
  assert(JSON.stringify(customerProjection.additionalScriptCandidates) === JSON.stringify(customerProjectionScope.included_script_allocation.additional_script_candidates.map((candidate) => `${candidate.validation_script_ref}: pricing TBD`)), "additional script identities are preserved exactly");
  assert(JSON.stringify(customerProjection.limitations) === JSON.stringify(customerProjectionScope.limitations), "top-level limitations are preserved exactly");
  const outOfScopeProjection = staticBundle.projectStaticBundleVerificationScope(await readFixture("verification-pass-scope.outcome-visible-out-of-scope.json"));
  assert(outOfScopeProjection !== null, "out-of-scope scope still projects");
  assert(outOfScopeProjection.selectedFindings[0].eligibilityState === "out_of_scope", "out-of-scope eligibility is preserved");
  const negationBypass = { ...scope, limitations: ["SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review. The selected finding is resolved. NOT_CUSTOMER_SOURCE."] };
  assert(staticBundle.projectStaticBundleVerificationScope(negationBypass) === null, "cross-sentence closure claim fails closed");
  for (const limitation of [
    "SYNTHETIC_DEMO_DATA verification_pass:verified later evidence remains pending. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA the finding is not verified but now fixed before evidence. NOT_CUSTOMER_SOURCE."
  ]) {
    assert(staticBundle.projectStaticBundleVerificationScope({ ...scope, limitations: [limitation] }) === null, "namespaced or mixed-negation closure claim fails closed");
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("static-bundle verification scope projection tests passed.");

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertNoUnsafeCopy(value) {
  const text = JSON.stringify(value).toLowerCase();
  for (const phrase of ["fixed and verified", "no vulnerabilities", "soc 2 accepted", "certified", "regulator approved", "auditor accepted", "control satisfied", "independent assurance"]) {
    assert(!text.includes(phrase), `projection must not include unsafe phrase ${phrase}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
