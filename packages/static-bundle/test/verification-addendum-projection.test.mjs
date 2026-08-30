import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-static-verification-addendum-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "static-verification-addendum-test-dist");

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "static.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const bundle = await import(pathToFileURL(path.join(outDir, "packages", "static-bundle", "src", "index.js")).href);
  assert("projectStaticBundleVerificationAddendum" in bundle, "static bundle exports verification addendum projection");

  const manifest = await fixture("static-bundle-manifest.generated.json");
  const addendum = verificationAddendum();
  const projection = bundle.projectStaticBundleVerificationAddendum(addendum, manifest);
  assert(projection !== null, "valid finalized addendum projects");
  assert(projection.selectedCommitRef === `git_commit:${addendum.selected_commit.commit_sha}`, "projection preserves selected commit");
  assert(projection.findings[0].verificationStatus === "verification_complete", "projection preserves canonical bounded outcome");
  assert(["./findings/", "./verification/", "./evidence/", "./validation/", "./outcomes/"].every((prefix) => projection.findings[0].surfaceLinks.some((link) => link.href.startsWith(prefix) && link.printLabel.includes(link.href))), "finding, decision, evidence, validation, and outcome links are print safe");
  assert(projection.retainedEvidence[0].href.startsWith("./artifacts/"), "retained evidence link is relative and print safe");
  assert(projection.historyLinks.every((entry) => entry.href.startsWith("./history/") && entry.printLabel.includes(entry.href)), "history links remain print safe");
  assert(projection.disclosure.join(" ").includes("not presented as success"), "projection explicitly distinguishes incomplete states from success");

  const pending = structuredClone(addendum);
  pending.findings[0].verification_status = "verification_pending";
  pending.findings[0].next_step_summary = "Submit additional bounded evidence for reviewer evaluation.";
  pending.finalization_state = "not_finalized";
  pending.next_step_summary = "Submit additional bounded evidence for reviewer evaluation.";
  const pendingProjection = bundle.projectStaticBundleVerificationAddendum(pending, manifest);
  assert(pendingProjection !== null && pendingProjection.finalizationState === "not_finalized", "pending addendum projects only as not finalized");

  const deleted = structuredClone(addendum);
  deleted.retained_evidence = [];
  deleted.deleted_evidence = [{ artifact_ref: "artifact_ref:scanner_finding_set", deletion_evidence_ref: "deletion_evidence:synthetic_001", deletion_timestamp: "2026-08-01T11:00:00Z", deletion_verification_status: "verified" }];
  const deletedProjection = bundle.projectStaticBundleVerificationAddendum(deleted, manifest);
  assert(deletedProjection !== null && deletedProjection.deletedEvidence[0].deletionEvidenceRef === "deletion_evidence:synthetic_001", "deleted evidence is represented by deletion evidence only");
  assert(deletedProjection.retainedEvidence.length === 0, "deleted evidence is not reconstructed as retained");

  assert(bundle.projectStaticBundleVerificationAddendum({ ...pending, finalization_state: "finalized" }, manifest) === null, "pending finding cannot project as finalized");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, retained_evidence: [...addendum.retained_evidence, addendum.retained_evidence[0]] }, manifest) === null, "duplicate retained evidence fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, limitations: ["SOC 2 accepted by the auditor."] }, manifest) === null, "unsafe assurance copy fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, findings: [{ ...addendum.findings[0], summary: "This finding is fixed under all review contexts." }] }, manifest) === null, "unsupported closure prose fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, findings: [addendum.findings[0], addendum.findings[0]] }, manifest) === null, "duplicate finding and decision chain fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, retained_evidence: [] }, manifest) === null, "unresolved evidence record fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum({ ...addendum, payload: "hidden" }, manifest) === null, "payload-like fields fail closed");
  const cyclic = structuredClone(addendum); cyclic.self = cyclic;
  assert(bundle.projectStaticBundleVerificationAddendum(cyclic, manifest) === null, "cyclic static input fails closed");
  const prototyped = Object.create({ source_code: "hidden" }); Object.assign(prototyped, addendum);
  assert(bundle.projectStaticBundleVerificationAddendum(prototyped, manifest) === null, "prototype source-like input fails closed");
  assert(bundle.projectStaticBundleVerificationAddendum(null, manifest) === null, "malformed addendum fails closed");

  // C6-43: links were previously synthesized from typed refs alone, with no
  // manifest asset registry to check against.
  assert(bundle.projectStaticBundleVerificationAddendum(addendum, null) === null, "addendum requires a real manifest to project");
  assert(bundle.projectStaticBundleVerificationAddendum(addendum, { ...manifest, review_id: "review:unrelated-999" }) === null, "manifest must belong to the same review as the addendum");
  const unpackagedEvidence = structuredClone(addendum);
  unpackagedEvidence.retained_evidence = [{ artifact_ref: "artifact_ref:never_packaged", source_derived_class: "retained_review_artifact", recorded_at: "2026-07-30T12:00:00Z" }];
  assert(bundle.projectStaticBundleVerificationAddendum(unpackagedEvidence, manifest) === null, "retained evidence must resolve to a file the manifest actually packages");
  const unverifiedFinalizedDeletion = structuredClone(deleted);
  unverifiedFinalizedDeletion.deleted_evidence[0].deletion_verification_status = "pending";
  assert(bundle.projectStaticBundleVerificationAddendum(unverifiedFinalizedDeletion, manifest) === null, "a finalized addendum cannot present an unverified deletion as fact");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("static-bundle verification addendum projection tests passed.");

function verificationAddendum() {
  return {
    protocol_version: "codeattest.v0", verification_addendum_id: "verification_addendum:synthetic_001", review_id: "review:synthetic-demo-001", verification_pass_id: "verification_pass:synthetic_pass_001",
    review_scope_ref: `sha256:${"1".repeat(64)}`, verification_pass_ref: "verification_pass:synthetic_pass_001", selected_commit: { commit_sha: "0123456789abcdef0123456789abcdef01234567", source_control_system: "git" }, repository_identity: `sha256:${"2".repeat(64)}`, generated_at: "2026-08-01T12:00:00Z",
    findings: [{ review_finding_draft_ref: "review_finding_draft:demo_finding_context", classification_record_ref: "classification_record:synthetic_confirmed_submitted_001", current_classification: "confirmed", verification_status: "verification_complete", reviewer_actor_category: "reviewer", verification_record_ref: "verification_record:synthetic_decision_001", verification_evidence_record_refs: ["verification_evidence:scanner_finding_set"], remediation_guidance_ref: "remediation_guidance:synthetic_001", validation_path_ref: "validation_path:synthetic_001", accepted_risk_record_ref: "accepted_risk:synthetic_001", timestamp: "2026-07-31T12:00:00Z", summary: "Bounded reviewer decision is recorded for this selected finding and criterion.", remaining_limitations: ["The outcome does not extend beyond the selected finding and criterion."] }],
    // C6-43: this artifact ref must resolve to a file the manifest fixture
    // (static-bundle-manifest.generated.json) actually packages.
    retained_evidence: [{ artifact_ref: "artifact_ref:scanner_finding_set", source_derived_class: "retained_review_artifact", recorded_at: "2026-07-30T12:00:00Z" }], deleted_evidence: [], history_refs: [`sha256:${"3".repeat(64)}`, `sha256:${"4".repeat(64)}`], limitations: ["Standalone addendum preserves original scope and recorded limitations."], finalization_state: "finalized", visibility: "customer_facing", source_derived_class: "retained_review_artifact"
  };
}
async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }
