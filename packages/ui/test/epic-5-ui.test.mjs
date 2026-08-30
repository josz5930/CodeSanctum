import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifiedOutcome } from "../../protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-epic-5-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "ui-epic-5-test-dist");
try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "ui.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);
  for (const name of ["AttestationBuilderView", "SupportingEvidenceMappingView", "StaticBundleGenerationView", "AttestationFinalizationView", "PilotLearningView", "excludeInternalLearningFromCustomerArtifact"]) assert(name in ui, `missing UI export ${name}`);

  const attestation = await fixture("security-review-attestation.json");
  const attestationView = ui.AttestationBuilderView({ attestation, audience: "reviewer" });
  assert(attestationView.available && attestationView.sections.length === 8, "Attestation renders every canonical protocol section independently");
  assert(attestationView.sections.map((section) => section.sectionType).includes("verification_outcomes"), "Attestation preserves protocol section taxonomy");
  assert(attestationView.receiptChain.length === 5 && attestationView.copyActions.length >= 7, "Attestation keeps receipt chain and copy controls");
  assert(attestationView.lifecycle.some((entry) => entry.visibleState === "Deleted under policy"), "Attestation distinguishes deletion evidence");
  assert(attestationView.actions[0].label.includes(attestation.attestation_id), "generation action names affected identity");
  assertAccessible(attestationView);
  assert(!ui.AttestationBuilderView({ attestation }).available, "Attestation requires explicit audience");
  assert(!ui.AttestationBuilderView({ attestation: { ...attestation, limitations: [...attestation.limitations, "Changed after identity creation."] }, audience: "customer" }).available, "Attestation identity tampering fails closed");
  assert(!ui.AttestationBuilderView({ attestation: { ...attestation, pilot_feedback: { useful: true } }, audience: "customer" }).available, "internal feedback is excluded from Attestation UI");
  const cyclic = { ...attestation }; cyclic.self = cyclic;
  assert(!ui.AttestationBuilderView({ attestation: cyclic, audience: "customer" }).available, "cyclic input fails closed without throwing");
  const accessor = { ...attestation }; Object.defineProperty(accessor, "review_id", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(!ui.AttestationBuilderView({ attestation: accessor, audience: "customer" }).available, "accessor input fails closed without executing getter");

  const mapping = await fixture("supporting-evidence-mapping.soc2.json");
  const mappingProps = { mapping, reviewId: attestation.review_id, attestationId: attestation.attestation_id };
  const mappingView = ui.SupportingEvidenceMappingView(mappingProps);
  assert(mappingView.available && mappingView.profile === "soc_2_supporting_evidence", "approved mapping preserves canonical profile vocabulary");
  assert(mappingView.acceptanceDisclaimer === mapping.acceptance_disclaimer && mappingView.decisionAuthority === mapping.decision_authority, "mapping leaves acceptance to the named decision authority");
  assert(mappingView.entries[0].evidenceRefs.includes("artifact_ref:vendor_receipt"), "mapping preserves supporting and receipt context references");
  for (const profile of ["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"]) {
    const candidate = { ...structuredClone(mapping), supporting_evidence_mapping_id: `supporting_evidence_mapping:synthetic_${profile.replaceAll("_", "-")}`, mapping_profile: profile };
    assert(ui.SupportingEvidenceMappingView({ mapping: candidate, reviewId: attestation.review_id, attestationId: attestation.attestation_id }).available, `${profile} mapping renders through UI`);
  }
  assert(!ui.SupportingEvidenceMappingView({ ...mappingProps, reviewId: "review:other" }).available, "cross-review mapping is omitted");
  assert(!ui.SupportingEvidenceMappingView({ ...mappingProps, mapping: { ...mapping, approved_by: { actor_type: "vendor_service", actor_id: "vendor:svc" } } }).available, "mapping approval is reviewer-only");

  const [manifest, signingInput, signature] = await Promise.all([fixture("static-bundle-manifest.generated.json"), signingFixture("static-bundle-manifest-identity.json"), fixture("signature-envelope.static-bundle.json")]);
  // D3-2: the UI cannot verify a real ML-DSA-65 signature's bytes, so the
  // caller must hand it the independently produced outcome, which the view
  // binds field-by-field back to the envelope it is shown alongside.
  const signatureOutcome = verifiedOutcome(signature);
  const bundleView = ui.StaticBundleGenerationView({ bundle: { manifest, signingInput, signature, signatureOutcome }, audience: "vendor" });
  assert(bundleView.available && !bundleView.blocked && bundleView.files.length === manifest.files.length, "bundle generation UI exposes canonical manifest files and verification");
  assert(bundleView.identities.some((entry) => entry.value === manifest.evidence_bundle_representation.evidence_bundle_id), "bundle view includes verifiable Evidence Bundle representation identity");
  assert(bundleView.disclosure.body.join(" ").includes("SYNTHETIC_DEMO_DATA"), "synthetic signer limitation is explicit");
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest: { ...manifest, manifest_version: 2 }, signingInput, signature, signatureOutcome }, audience: "vendor" }).available, "manifest identity tampering fails closed");
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest, signingInput, signature: { ...signature, signature_bytes: "synthetic:unverified" }, signatureOutcome }, audience: "vendor" }).available, "a signature whose bytes are not a real ML-DSA-65 signature fails closed");
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest, signingInput: { ...signingInput, signed_identity: digest("f") }, signature, signatureOutcome }, audience: "vendor" }).available, "tampered signing input fails closed");
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest, signingInput, signature: { ...signature, key_version: "v2" }, signatureOutcome }, audience: "vendor" }).available, "tampered signing key version fails closed");
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest, signingInput, signature: { ...signature, signing_time: "2026-08-01T12:16:00Z" }, signatureOutcome }, audience: "vendor" }).available, "tampered signing time fails closed");
  const actionableFailure = ui.StaticBundleGenerationView({ failure: { code: "required_artifact_missing", affected_identity: "artifact_ref:vendor_receipt", message: "ignored", next_path: "remediate" }, audience: "vendor" });
  assert(actionableFailure.blocked && actionableFailure.actions[0].actionable && actionableFailure.actions[0].label.includes("artifact_ref:vendor_receipt"), "generation failure exposes a safe actionable path");
  const sparseFiles = [...manifest.files]; delete sparseFiles[0];
  assert(!ui.StaticBundleGenerationView({ bundle: { manifest: { ...manifest, files: sparseFiles }, signingInput, signature }, audience: "vendor" }).available, "sparse file arrays fail closed");

  const context = finalizationContextFixture(manifest, attestation);
  const finalization = ui.AttestationFinalizationView({ context, actor: { actor_type: "customer_user", actor_id: "customer:maya" } });
  assert(finalization.available && finalization.actions.every((action) => action.label.includes(context.static_bundle_id) || action.label.includes(context.attestation_id)), "customer finalization actions name affected identity");
  assert(finalization.inlineConfirmation.contextRemainsVisible && finalization.eventSeparation.length === 3, "pre-action confirmation keeps context and event separation explicit");
  assert(!ui.AttestationFinalizationView({ context: { ...context, portal_entry_path: "../index.html" }, actor: { actor_type: "customer_user", actor_id: "customer:maya" } }).available, "finalization rejects unsafe portal path");
  assert(!ui.AttestationFinalizationView({ context: { ...context, unexpected: true }, actor: { actor_type: "customer_user", actor_id: "customer:maya" } }).available, "finalization rejects extra context fields");
  const blockedFinalization = ui.AttestationFinalizationView({ context, actor: { actor_type: "customer_user", actor_id: "customer:maya" }, blocker: { code: "missing_receipt", affected_identity: context.vendor_receipt_id, message: "Receipt metadata is unavailable.", next_path: "remediate" } });
  assert(blockedFinalization.blocked && blockedFinalization.blocker.affectedIdentity === context.vendor_receipt_id, "finalization blocker names missing evidence");
  const unknownBlocker = ui.AttestationFinalizationView({ context, actor: { actor_type: "customer_user", actor_id: "customer:maya" }, blocker: { code: "custom", affected_identity: context.vendor_receipt_id, message: "Raw source details follow.", next_path: "support" } });
  assert(!unknownBlocker.available && unknownBlocker.blocked, "an unrecognized blocker must fail closed, not fall through to the success path");
  assert(!unknownBlocker.actions.some((action) => action.type === "export_attestation_package"), "an unrecognized blocker must never leave export offered");
  assert(!unknownBlocker.blocker?.message.includes("Raw source"), "unknown blocker copy is never rendered");

  const [metric, feedback] = await Promise.all([fixture("pilot-metric-record.json"), fixture("pilot-feedback-record.json")]);
  const pilot = ui.PilotLearningView({ metric, feedback, audience: "internal" });
  assert(pilot?.visibility === "internal_only" && pilot.exclusion.portalSearchAndPrint, "pilot learning is internal with explicit exclusions");
  assert(pilot.metrics.some((entry) => entry.value === `${metric.metrics.classified_finding_count}/${metric.metrics.candidate_finding_count}`), "pilot view uses ordered canonical yield aggregation");
  assert(ui.PilotLearningView({ metric, feedback, audience: "customer" }) === null, "customer cannot render pilot learning");
  assert(ui.PilotLearningView({ metric: { ...metric, measurement_window: { start_timestamp: metric.measurement_window.end_timestamp, end_timestamp: metric.measurement_window.end_timestamp } }, audience: "internal" }) === null, "pilot metric rejects empty windows");

  // C6-17: `Date.parse` truncates to milliseconds, so a genuinely valid
  // one-nanosecond-wide window was previously rejected, and reversed
  // sub-millisecond ordering could previously pass.
  const subMillisecondValid = {
    ...metric,
    recorded_at: "2026-08-01T12:25:00.123000003Z",
    measurement_window: { start_timestamp: "2026-08-01T12:25:00.123000001Z", end_timestamp: "2026-08-01T12:25:00.123000002Z" }
  };
  assert(ui.PilotLearningView({ metric: subMillisecondValid, audience: "internal" }) !== null, "a valid one-nanosecond-wide measurement window must be accepted");
  const subMillisecondReversed = {
    ...metric,
    recorded_at: "2026-08-01T12:25:00.123000003Z",
    measurement_window: { start_timestamp: "2026-08-01T12:25:00.123000002Z", end_timestamp: "2026-08-01T12:25:00.123000001Z" }
  };
  assert(ui.PilotLearningView({ metric: subMillisecondReversed, audience: "internal" }) === null, "reversed sub-millisecond ordering must be rejected");
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, mapping_feedback: [feedback.mapping_feedback[0], feedback.mapping_feedback[0]] }, audience: "internal" }) === null, "pilot feedback rejects duplicate mapping codes");
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, caveats: ["Contact person@example.test"] }, audience: "internal" }) === null, "pilot feedback rejects PII-like caveats");

  // C6-18: SSN, unlabeled phone numbers, cloud credentials, and source
  // snippets must all be rejected, not just email.
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, caveats: ["SSN 078-05-1120 on file"] }, audience: "internal" }) === null, "pilot feedback rejects SSN-shaped caveats");
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, caveats: ["Call 555-867-5309 for a follow-up"] }, audience: "internal" }) === null, "pilot feedback rejects unlabeled phone numbers");
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, caveats: ["Found AKIAIOSFODNN7EXAMPLE in logs"] }, audience: "internal" }) === null, "pilot feedback rejects cloud credential patterns");
  assert(ui.PilotLearningView({ metric, feedback: { ...feedback, caveats: ["eval(userInput) leaked into a caveat"] }, audience: "internal" }) === null, "pilot feedback rejects source-code-shaped caveats");
  assert(ui.excludeInternalLearningFromCustomerArtifact({ attestation_id: "attestation:demo", pilot_feedback: feedback }) === null, "customer artifact guard rejects internal feedback");

  // C6-16: separator-variant key aliases and internal-namespace refs nested
  // under an innocuous generic key must not bypass the customer-artifact guard.
  assert(ui.excludeInternalLearningFromCustomerArtifact({ attestation_id: "attestation:demo", pilotFeedback: feedback }) === null, "camelCase key alias must not bypass the internal-learning guard");
  assert(ui.excludeInternalLearningFromCustomerArtifact({ attestation_id: "attestation:demo", "unit-economics": { note: "x" } }) === null, "kebab-case key alias must not bypass the internal-learning guard");
  assert(ui.excludeInternalLearningFromCustomerArtifact({ attestation_id: "attestation:demo", refs: ["pilot_metric:secret_001"] }) === null, "an internal-namespace ref under a generic key must not bypass the guard");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
console.log("UI Epic 5 contract tests passed.");

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs", name), "utf8")); }
function finalizationContextFixture(manifest, attestation) { return { attestation_id: attestation.attestation_id, static_bundle_id: manifest.static_bundle_id, static_bundle_manifest_id: manifest.static_bundle_manifest_id, review_id: manifest.review_id, selected_application: "Synthetic payments API", selected_commit: attestation.selected_commit.commit_sha, disclosure_policy_summary: attestation.method.disclosure_summary, coverage_mode: attestation.method.coverage_mode, vendor_receipt_id: manifest.vendor_receipt_ref, included_artifact_refs: manifest.files.map((file) => file.artifact_ref), deleted_artifacts: manifest.minimization_disposition.deleted_refs.map((deletion_evidence_ref) => ({ artifact_ref: "artifact_ref:deleted_transient", deletion_evidence_ref })), limitations: [...attestation.limitations], portal_entry_path: "portal/index.html", signature_verification_state: "verified_offline", recipient_notes: "Share with the approved evidence consumer.", sharing_notes: "Customer controls the exported copy." }; }
function digest(char) { return `sha256:${char.repeat(64)}`; }
function assertAccessible(view) { assert(view.doesNotRelyOnColor === true && view.minTargetSizePx >= 44 && view.focusRing.widthPx > 0, "view preserves accessibility metadata"); }
function assert(condition, message) { if (!condition) throw new Error(message); }
