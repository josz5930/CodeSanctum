// Story 4.1: dependency-free verification-pass scope view contract.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-verification-pass-scope-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-verification-pass-scope-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "ui.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  assert("VerificationPassScopeView" in ui, "VerificationPassScopeView must be exported");

  const scope = await readFixture("verification-pass-scope.additional-script-pricing-tbd.json");
  const view = ui.VerificationPassScopeView({ scope });
  assert(view.kind === "verification-pass-scope", "view kind is stable");
  assert(view.verificationPassRef === scope.verification_pass_id, "view preserves verification pass ref");
  assert(view.passDeadline === scope.pass_deadline, "view displays pass deadline");
  assert(view.disclosure.nonDismissible === true, "scope limitation disclosure is non-dismissible");
  assert(view.disclosure.body.join(" ").includes("limited to selected findings"), "disclosure states selected-scope boundary");
  assert(view.disclosure.body.join(" ").includes("not a complete fresh secure-code review"), "disclosure rejects fresh-review implication");
  assert(view.selectedFindings[0].eligibility.value === "requires_additional_agreement", "additional agreement state remains text-first");
  assert(view.selectedFindings[0].nextStep.includes("pricing TBD"), "additional agreement next step names pricing TBD posture");
  assert(view.includedScriptSlots.length === 1, "included script slot is visible");
  assert(view.additionalScriptCandidates.length === 1, "additional script candidate is visible separately");
  assert(view.sections.some((section) => section.id === "script_allocation" && section.body.some((line) => line.includes("No invented prices"))), "script section forbids invented prices and purchase flow");
  assertNoColorOnlyOrHoverOnly(view);
  assertNoUnsafeCopy(view);

  const blocked = await readFixture("verification-pass-scope.requires-validation-path.json");
  blocked.selected_findings[0].eligibility_state = "blocked_pending_validation_path";
  blocked.selected_findings[0].eligibility_reason = "SYNTHETIC_DEMO_DATA record a formal validation path before accepting customer-side evidence. NOT_CUSTOMER_SOURCE.";
  delete blocked.selected_findings[0].validation_path_ref;
  delete blocked.selected_findings[0].reviewer_validation_script_refs;
  blocked.included_script_allocation = { included_slots: [], additional_script_candidates: [] };
  const blockedView = ui.VerificationPassScopeView({ scope: blocked });
  assert(blockedView.selectedFindings[0].eligibility.value === "blocked_pending_validation_path", "blocked pending validation path has text-first state");
  assert(blockedView.selectedFindings[0].nextStep.includes("Record a formal validation path"), "blocked state shows specific next step");

  const malformed = ui.VerificationPassScopeView(null);
  assert(malformed.verificationPassRef === "verification_pass:unavailable", "malformed input returns unavailable view");
  assert(malformed.disclosure.nonDismissible === true, "unavailable view still carries non-dismissible warning");
  const unsafe = { ...scope, limitations: ["SYNTHETIC_DEMO_DATA fixed and verified with no vulnerabilities. NOT_CUSTOMER_SOURCE."] };
  assert(ui.VerificationPassScopeView({ scope: unsafe }).verificationPassRef === "verification_pass:unavailable", "unsafe success copy fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, selected_findings: [{ ...scope.selected_findings[0], eligibility_state: "verified_with_evidence" }] } }).verificationPassRef === "verification_pass:unavailable", "malformed eligibility enum fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, verification_pass_id: "pass:bad" } }).verificationPassRef === "verification_pass:unavailable", "malformed verification pass ref fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_script_allocation: { ...scope.included_script_allocation, included_slots: [{ ...scope.included_script_allocation.included_slots[0], slot: 4 }] } } }).verificationPassRef === "verification_pass:unavailable", "invalid included slot fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], pricing_posture: "included_base_package" }] } } }).verificationPassRef === "verification_pass:unavailable", "invalid additional script pricing posture fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], reason: "SYNTHETIC_DEMO_DATA additional reviewer work is recorded. NOT_CUSTOMER_SOURCE." }] } } }).verificationPassRef === "verification_pass:unavailable", "additional script reason without pricing TBD fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_script_allocation: { ...scope.included_script_allocation, additional_script_candidates: [{ ...scope.included_script_allocation.additional_script_candidates[0], finding_ref: "review_finding_draft:missing" }] } } }).verificationPassRef === "verification_pass:unavailable", "orphaned allocation fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, visibility: "internal_only" } }).verificationPassRef === "verification_pass:unavailable", "internal-only scope fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, pass_deadline: "2026-08-28T00:00:01Z" } }).verificationPassRef === "verification_pass:unavailable", "scope beyond 30 days fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, pass_deadline: "2026-08-28T00:00:00.000000001Z" } }).verificationPassRef === "verification_pass:unavailable", "scope one nanosecond beyond 30 days fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_pass_start_basis: "SYNTHETIC_DEMO_DATA guaranteed within 30 days. NOT_CUSTOMER_SOURCE." } }).verificationPassRef === "verification_pass:unavailable", "SLA-implying deadline basis fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, pass_deadline: scope.included_pass_started_at } }).verificationPassRef === "verification_pass:unavailable", "zero-day scope fails closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_pass_started_at: "2026-02-30T00:00:00Z", scope_recorded_at: "2026-03-02T12:00:00Z", pass_deadline: "2026-04-01T00:00:00Z" } }).verificationPassRef === "verification_pass:unavailable", "calendar-rollover timestamps fail closed");
  assert(ui.VerificationPassScopeView({ scope: { ...scope, included_script_allocation: { ...scope.included_script_allocation, included_slots: [{ ...scope.included_script_allocation.included_slots[0] }, { ...scope.included_script_allocation.included_slots[0], slot: 2 }] } } }).verificationPassRef === "verification_pass:unavailable", "duplicate included script refs fail closed");
  const eligibleWithoutPath = await readFixture("verification-pass-scope.requires-validation-path.json");
  delete eligibleWithoutPath.selected_findings[0].validation_path_ref;
  assert(ui.VerificationPassScopeView({ scope: eligibleWithoutPath }).verificationPassRef === "verification_pass:unavailable", "eligible customer-side validation without a formal path fails closed");
  const blockedWithoutNextStep = { ...blocked, selected_findings: [{ ...blocked.selected_findings[0], eligibility_reason: "SYNTHETIC_DEMO_DATA waiting without a specific action. NOT_CUSTOMER_SOURCE." }] };
  assert(ui.VerificationPassScopeView({ scope: blockedWithoutNextStep }).verificationPassRef === "verification_pass:unavailable", "blocked state without a specific next step fails closed");
  for (const eligibilityReason of [
    "SYNTHETIC_DEMO_DATA no validation path has been recorded yet. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA do not record a formal path yet. NOT_CUSTOMER_SOURCE."
  ]) {
    assert(ui.VerificationPassScopeView({ scope: { ...blocked, selected_findings: [{ ...blocked.selected_findings[0], eligibility_reason: eligibilityReason }] } }).verificationPassRef === "verification_pass:unavailable", "negated blocked-state non-action fails closed");
  }
  const outcomeFormalPath = await readFixture("verification-pass-scope.outcome-eligible-with-formal-path.json");
  const outcomeFormalPathView = ui.VerificationPassScopeView({ scope: outcomeFormalPath });
  assert(outcomeFormalPathView.verificationPassRef === outcomeFormalPath.verification_pass_id, "outcome context with a new formal path remains available");
  assert(outcomeFormalPathView.selectedFindings[0].eligibilityReason === outcomeFormalPath.selected_findings[0].eligibility_reason, "eligible formal-path reason is preserved exactly");
  assert(outcomeFormalPathView.selectedFindings[0].limitations[0] === outcomeFormalPath.selected_findings[0].limitations[0], "eligible formal-path limitation is preserved exactly");
  const uncertainBasis = {
    ...scope,
    verification_pass_id: "verification_pass:synthetic_pass_uncertain_basis_valid_001",
    included_pass_start_basis: "SYNTHETIC_DEMO_DATA estimated fallback timestamp used because review completion was unavailable. NOT_CUSTOMER_SOURCE.",
    limitations: [
      "SYNTHETIC_DEMO_DATA estimated fallback basis is recorded for the included-pass deadline calculation and is not an SLA. NOT_CUSTOMER_SOURCE.",
      "SYNTHETIC_DEMO_DATA this selection is not a complete fresh secure-code review and does not record a verification decision. NOT_CUSTOMER_SOURCE."
    ]
  };
  const uncertainView = ui.VerificationPassScopeView({ scope: uncertainBasis });
  assert(uncertainView.verificationPassRef === uncertainBasis.verification_pass_id, "uncertain basis with explicit limitation remains available");
  const negatedDisclaimer = await readFixture("verification-pass-scope.negated-disclaimer.json");
  const negatedDisclaimerView = ui.VerificationPassScopeView({ scope: negatedDisclaimer });
  assert(negatedDisclaimerView.verificationPassRef === negatedDisclaimer.verification_pass_id, "negated disclaimer remains available through UI projection");
  assert(negatedDisclaimerView.selectedFindings[0].eligibilityReason === negatedDisclaimer.selected_findings[0].eligibility_reason, "negated disclaimer eligibility reason is preserved exactly");
  assert(negatedDisclaimerView.selectedFindings[0].limitations[0] === negatedDisclaimer.selected_findings[0].limitations[0], "negated disclaimer limitation is preserved exactly");
  assert(negatedDisclaimerView.disclosure.body.join(" ").includes("limited to selected findings"), "disclosure keeps selected-findings limitation concept");
  assert(negatedDisclaimerView.disclosure.body.join(" ").includes("not a complete fresh secure-code review"), "disclosure keeps fresh-review disclaimer concept");
  const projectionScope = await readFixture("verification-pass-scope.customer-facing-projection.json");
  const projectionView = ui.VerificationPassScopeView({ scope: projectionScope });
  assert(projectionView.selectedFindings[0].eligibilityReason === projectionScope.selected_findings[0].eligibility_reason, "customer projection eligibility reason is preserved exactly");
  assert(JSON.stringify(projectionView.selectedFindings[0].limitations) === JSON.stringify(projectionScope.selected_findings[0].limitations), "customer projection finding limitations are preserved exactly");
  assert(JSON.stringify(projectionView.sections.find((section) => section.id === "limitations")?.body ?? []) === JSON.stringify(projectionScope.limitations), "top-level limitations are preserved exactly");
  assert(JSON.stringify(projectionView.includedScriptSlots.map((item) => item.value)) === JSON.stringify(projectionScope.included_script_allocation.included_slots.map((slot) => slot.validation_script_ref)), "included script identities are preserved exactly");
  assert(JSON.stringify(projectionView.additionalScriptCandidates.map((item) => item.value)) === JSON.stringify(projectionScope.included_script_allocation.additional_script_candidates.map((candidate) => candidate.validation_script_ref)), "additional script identities are preserved exactly");
  assert(projectionView.sections.find((section) => section.id === "deadline")?.body.some((line) => line.includes(projectionScope.pass_deadline)), "deadline section preserves recorded-at boundary text");
  const outOfScopeView = ui.VerificationPassScopeView({ scope: await readFixture("verification-pass-scope.outcome-visible-out-of-scope.json") });
  assert(outOfScopeView.selectedFindings[0].eligibility.value === "out_of_scope", "out-of-scope outcome visibility stays text-first");
  assert(outOfScopeView.selectedFindings[0].nextStep.includes("Keep the original finding and any prior outcome visible"), "out-of-scope copy keeps visibility warning");
  const sanitizedView = ui.VerificationPassScopeView({ scope: { ...scope, review_id: "review:synthetic-‮maya⁦", selected_findings: [{ ...scope.selected_findings[0], eligibility_reason: "SYNTHETIC_DEMO_DATA record‮ a formal path​ before proceeding. NOT_CUSTOMER_SOURCE." }] } });
  assert(!JSON.stringify(sanitizedView).includes("‮"), "UI strips bidi override controls from visible text");
  assert(!JSON.stringify(sanitizedView).includes("⁦"), "UI strips bidi isolate controls from visible text");
  assert(!JSON.stringify(sanitizedView).includes("​"), "UI strips zero-width controls from visible text");
  const negationBypass = { ...scope, limitations: ["SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review. The selected finding is resolved. NOT_CUSTOMER_SOURCE."] };
  assert(ui.VerificationPassScopeView({ scope: negationBypass }).verificationPassRef === "verification_pass:unavailable", "cross-sentence closure claim fails closed");
  for (const limitation of [
    "SYNTHETIC_DEMO_DATA verification_pass:verified later evidence remains pending. NOT_CUSTOMER_SOURCE.",
    "SYNTHETIC_DEMO_DATA the finding is not verified but now fixed before evidence. NOT_CUSTOMER_SOURCE."
  ]) {
    assert(ui.VerificationPassScopeView({ scope: { ...scope, limitations: [limitation] } }).verificationPassRef === "verification_pass:unavailable", "namespaced or mixed-negation closure claim fails closed");
  }
  for (const currentClassification of ["toString", "constructor"]) {
    assert(ui.VerificationPassScopeView({ scope: { ...scope, selected_findings: [{ ...scope.selected_findings[0], current_classification: currentClassification }] } }).verificationPassRef === "verification_pass:unavailable", "prototype enum names fail closed without throwing");
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("ui verification pass scope tests passed.");

async function readFixture(fileName) {
  return JSON.parse(await readFile(path.join(fixtureRoot, fileName), "utf8"));
}

function assertNoColorOnlyOrHoverOnly(view) {
  assert(view.doesNotRelyOnColor === true, "root view cannot rely on color only");
  assert(view.minTargetSizePx >= 44, "root target metadata is at least 44px");
  for (const chip of view.statusChips.concat(view.selectedFindings.flatMap((finding) => [finding.classification, finding.remediationStatus, finding.requestedVerificationType, finding.eligibility]))) {
    assert(chip.visibleLabel.length > 0 && chip.accessibleLabel.length > 0 && chip.doesNotRelyOnColor === true, "status chips are text-first and accessible");
  }
  for (const action of view.actions.concat(view.sections.flatMap((section) => section.actions))) {
    assert(action.hoverOnly === false, "actions cannot be hover-only");
    assert(action.minTargetSizePx >= 44, "actions expose 44px target metadata");
  }
}

function assertNoUnsafeCopy(value) {
  const text = JSON.stringify(value).toLowerCase();
  for (const phrase of ["fixed and verified", "no vulnerabilities", "soc 2 accepted", "certified", "regulator approved", "auditor accepted", "control satisfied", "independent assurance"]) {
    assert(!text.includes(phrase), `view must not include unsafe phrase ${phrase}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
