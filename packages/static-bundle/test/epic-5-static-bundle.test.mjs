import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MANAGED_KEY_LIMITATIONS, createTestSigningKey, realSignatureEnvelope, verifiedOutcome } from "../../protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
// D3-2: this pure module never signs. Every place the suite used to call a
// one-shot `generate`/`finalize` that produced its own synthetic envelope, it
// now plays the external signer with a per-run ML-DSA-65 key and supplies the
// host-computed verification outcomes the module requires for the signatures
// it cannot verify itself.
const testSigningKey = createTestSigningKey({ key_id: "codeattest-static-bundle-test-key", key_version: "v1" });
const staticBundleSigningKey = { key_id: testSigningKey.key_id, key_version: testSigningKey.key_version, signing_mode: "managed_key", signing_limitations: [...MANAGED_KEY_LIMITATIONS] };
function signStaticBundleRequest(signingRequest) {
  return realSignatureEnvelope({ signing_input: signingRequest.signing_input, key: testSigningKey, signing_time: signingRequest.signing_time, signing_mode: signingRequest.signing_mode, signing_limitations: signingRequest.signing_limitations });
}
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-static-epic-5-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "static-epic-5-test-dist");
try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "static.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const bundle = await import(pathToFileURL(path.join(outDir, "packages", "static-bundle", "src", "index.js")).href);
  for (const name of ["prepareSignedStaticBundle", "completeSignedStaticBundle", "createStaticBundleSigningRequest", "prepareFinalizedStaticBundle", "completeFinalizedStaticBundle", "projectFinalizedStaticBundle", "generateStaticPortal", "projectSupportingEvidenceMapping"]) assert(name in bundle, `missing static export ${name}`);
  // D3-1: the one-call wrappers could only exist while this module could sign
  // for itself; real ML-DSA-65 signing now happens outside it.
  for (const name of ["generateSignedStaticBundle", "finalizeStaticBundleManifest", "createSyntheticDemoSignatureEnvelope"]) assert(!(name in bundle), `retired synthetic-signing export still present: ${name}`);
  assert(bundle.sha256Text("") === "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "shared platform SHA-256 adapter matches the empty-input vector");
  assert(bundle.canonicalizeStaticBundleJson({ z: 1, a: "x" }) === '{"a":"x","z":1}', "canonical JSON sorts keys");
  assertThrows(() => bundle.canonicalizeStaticBundleJson(sparseArray()), "canonical JSON rejects sparse arrays");
  assertThrows(() => bundle.canonicalizeStaticBundleJson(cyclic({ a: 1 })), "canonical JSON rejects cycles");
  assertThrows(() => bundle.canonicalizeStaticBundleJson(new Date()), "canonical JSON rejects prototypes");
  assertThrows(() => bundle.canonicalizeStaticBundleJson(Number.POSITIVE_INFINITY), "canonical JSON rejects non-finite numbers");

  const [mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature, finalizationRecord, receipt, portalProjection, deletionEvidence, evidenceBundleManifest, evidenceBundleIdentity, evidenceBundleSignature, disclosurePolicy, metadataOnlyDisclosurePolicy, customerApproval] = await Promise.all([fixture("supporting-evidence-mapping.soc2.json"), fixture("security-review-attestation.json"), fixture("static-bundle-manifest.generated.json"), signingFixture("static-bundle-manifest-identity.json"), fixture("signature-envelope.static-bundle.json"), fixture("attestation-package-finalization.json"), fixture("vendor-receipt.json"), fixture("static-portal-projection.json"), fixture("deletion-evidence.json"), fixture("bundle-manifest.json"), signingFixture("bundle-manifest-identity.json"), fixture("signature-envelope.bundle.json"), fixture("disclosure-policy.json"), fixture("disclosure-policy.metadata-only.json"), fixture("customer-approval.approved.json")]);
  const payloadOutcomes = { evidence_bundle_signature: verifiedOutcome(evidenceBundleSignature), vendor_receipt_signature: verifiedOutcome(receipt.receipt_signature) };
  function generate(value) {
    const prepared = bundle.prepareSignedStaticBundle(value, payloadOutcomes);
    return prepared.ok ? bundle.completeSignedStaticBundle(prepared, signStaticBundleRequest(prepared.signing_request)) : prepared;
  }
  function finalize(value, outcomes = { ...payloadOutcomes, manifest_signature: verifiedOutcome(value.generated_signature) }) {
    const prepared = bundle.prepareFinalizedStaticBundle(value, outcomes);
    return prepared.ok ? bundle.completeFinalizedStaticBundle(prepared, signStaticBundleRequest(prepared.signing_request)) : prepared;
  }
  const mapping = bundle.projectSupportingEvidenceMapping(mappingRecord);
  assert(mapping && mapping.acceptanceDisclaimer.includes("does not determine acceptance"), "approved mapping preserves acceptance disclaimer");

  // C6-35: a disclaimer that merely mentions "accepts" without negating it
  // is a contradictory positive claim, not a real disclaimer, and must be rejected.
  const contradictoryDisclaimer = bundle.projectSupportingEvidenceMapping({ ...structuredClone(mappingRecord), acceptance_disclaimer: "SYNTHETIC_DEMO_DATA CodeAttest accepts every control result. NOT_CUSTOMER_SOURCE." });
  assert(contradictoryDisclaimer === null, "a disclaimer that positively claims acceptance without negating it must be rejected");
  const mappingRecordProfiles = ["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"].map((profile) => ({ ...structuredClone(mappingRecord), supporting_evidence_mapping_id: `supporting_evidence_mapping:synthetic_${profile.replaceAll("_", "-")}`, mapping_profile: profile }));
  const mappingProfiles = mappingRecordProfiles.map((record) => bundle.projectSupportingEvidenceMapping(record));
  assert(mappingProfiles.every(Boolean), "all three approved mapping profiles project through static mapping");
  assert(mapping.entries[0].evidenceLinks[0].href.startsWith("#ref-"), "mapping links resolve to offline targets");
  assert(Object.isFrozen(mapping) && Object.isFrozen(mapping.entries[0]), "mapping projection is deeply immutable");
  assert(bundle.projectSupportingEvidenceMapping({ ...mappingRecord, approved_by: { actor_type: "vendor_service", actor_id: "vendor:svc" } }) === null, "mapping approval is reviewer-only");
  const cyclicMapping = cyclic({ ...mappingRecord });
  assert(bundle.projectSupportingEvidenceMapping(cyclicMapping) === null, "mapping cycles fail closed without throwing");
  // C4-27: this projection is an independent runtime mapping boundary that
  // does not go through the control plane -- it must reject a duplicate
  // mapping_entry_id itself, not merely trust an already-validated caller.
  const duplicateEntryMapping = await fixture("../invalid/supporting-evidence-mapping.duplicate-entry-id.json");
  assert(bundle.projectSupportingEvidenceMapping(duplicateEntryMapping) === null, "duplicate mapping entry ids fail closed");

  const portalInput = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature);
  portalInput.mappings = mappingRecordProfiles;
  const portal = bundle.generateStaticPortal(portalInput);
  assert(portal !== null && portal.assets.length === 3, "portal emits self-contained HTML CSS JS");
  const [html, css, js] = portal.assets.map((entry) => entry.content);
  assert(["overview", "scope", "receipt-chain", "methods", "findings", "validation-remediation", "limitations", "appendices"].every((id) => html.includes(`id="${id}"`)), "portal includes fixed navigation sections");
  // C6-37: manifest identity, key ID, and signing time must be visible, not just key version.
  assert(html.includes(portalInput.static_bundle_manifest_id), "portal renders the bundle manifest identity");
  assert(html.includes(portalInput.signing_key_id), "portal renders the signing key ID");
  assert(html.includes(portalInput.signing_time), "portal renders the signing time");
  // C6-36: target ids are scoped by mappingId, so this must check the
  // mapping objects actually rendered into the portal (`mappingProfiles`,
  // via `portalInput.mappings`) — `mapping` itself (built from the base
  // `mappingRecord`, with a different `supporting_evidence_mapping_id`) was
  // never included in `portalInput.mappings` and its links were never
  // rendered; asserting against it was checking an accidental id collision
  // with an unrelated mapping object, not this mapping's real target.
  assert(html.includes("Supporting artifact targets") && mappingProfiles[0].entries[0].evidenceLinks.every((link) => html.includes(`id="${link.href.slice(1)}"`)), "every mapping link target exists");
  // Two distinct mapping objects that happen to share an artifact ref must
  // resolve to two distinct DOM target ids, not collide on one.
  const sharedArtifactRef = mapping.entries[0].evidenceLinks[0].artifactRef;
  assert(mappingProfiles.every((profile) => profile.entries[0].evidenceLinks[0].artifactRef === sharedArtifactRef), "test setup: all three profile mappings share the same underlying artifact ref");
  const distinctHrefs = new Set(mappingProfiles.map((profile) => profile.entries[0].evidenceLinks[0].href));
  assert(distinctHrefs.size === mappingProfiles.length, "mappings sharing an artifact ref must resolve to distinct target ids, not collide");
  assert(html.includes("Decision authority") && html.includes("Signature limitations"), "portal renders mapping authority and signing limitations");
  assert(["soc 2 supporting evidence", "generic technology risk", "customer security review"].every((profile) => html.includes(profile)), "portal renders all approved mapping profiles");
  assert(["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"].every((profile) => portal.search_index.some((entry) => entry.text.includes(profile))), "portal search indexes all approved mapping profiles");
  assert(js.includes('normalize("NFKC").toLowerCase()') && js.includes("Copy failed"), "portal search normalization and copy failure are deterministic and accurate");
  assert(css.includes("@media print") && css.includes("@media(max-width:44rem)") && css.includes("prefers-reduced-motion"), "portal supports print phone and reduced motion");
  assert(!/https?:\/\//u.test(html + css + js) && !/fetch\(|XMLHttpRequest|WebSocket|analytics|beacon/iu.test(js), "portal has no remote dependencies or analytics");
  assert(Object.isFrozen(portal) && Object.isFrozen(portal.assets) && Object.isFrozen(portal.search_index), "portal output is deeply immutable");
  const piiPortalInput = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature);
  piiPortalInput.sections[0].summary = "Contact reviewer@example.com for details";
  assert(bundle.generateStaticPortal(piiPortalInput) === null, "portal rejects PII through the shared detector");
  assert(bundle.generateStaticPortal({ ...portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature), findings: [portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature).findings[0], portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature).findings[0]] }) === null, "portal rejects duplicate findings");
  // C6-20: a well-formed (non-traversal) `./`-relative href to a file this
  // 3-asset portal package never ships must still be rejected — only the
  // two sibling assets (styles.css, portal.js) are valid `./` targets.
  const undeclaredFileInput = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature);
  undeclaredFileInput.sections[0].details[0].href = "./undeclared-file.json";
  assert(bundle.generateStaticPortal(undeclaredFileInput) === null, "portal rejects a well-formed link to a file outside the declared 3-asset package");
  const siblingAssetInput = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature);
  siblingAssetInput.sections[0].details[0].href = "./styles.css";
  assert(bundle.generateStaticPortal(siblingAssetInput) !== null, "portal allows a link to its own declared sibling asset");
  // C6-21: mapping hrefs are now always computed internally by
  // projectSupportingEvidenceMapping's relativeLink() from the raw signed
  // record -- a caller can no longer hand the portal a pre-projected object
  // carrying an arbitrary attacker-controlled href (e.g. an encoded traversal
  // link) at all, since generateStaticPortal only accepts raw records and
  // re-projects them itself. A hand-built projected-shape object fed into
  // `mappings` fails the raw-record schema check and is rejected.
  const badLinkMapping = structuredClone(mapping); badLinkMapping.entries[0].evidenceLinks[0].href = "./%252e%252e/secret";
  assert(bundle.generateStaticPortal({ ...portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature), mappings: [badLinkMapping] }) === null, "portal rejects a pre-projected mapping object instead of a raw signed record");
  assert(bundle.generateStaticPortal({ ...portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature), signature_profile: "ml_dsa_65_demo_pilot" }) === null, "portal rejects a retired signature profile");
  const accessorPortal = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); Object.defineProperty(accessorPortal, "title", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert(bundle.generateStaticPortal(accessorPortal) === null, "portal rejects accessors without executing them");

  // C6-19: a valid signature/manifest-id pair must not be combinable with
  // unrelated syntactically-valid display fields for review, commit,
  // Attestation, receipt, bundle, or package-state identity.
  const wrongReview = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongReview.review_id = "review:synthetic-unrelated-999";
  assert(bundle.generateStaticPortal(wrongReview) === null, "portal rejects a review_id that does not match the signed manifest/attestation");
  const wrongCommit = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongCommit.selected_commit = "f".repeat(40);
  assert(bundle.generateStaticPortal(wrongCommit) === null, "portal rejects a selected_commit that does not match the Attestation record");
  const wrongAttestationId = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongAttestationId.attestation_id = `attestation:${"0".repeat(64)}`;
  assert(bundle.generateStaticPortal(wrongAttestationId) === null, "portal rejects an attestation_id that does not match the signed manifest/attestation");
  const wrongReceipt = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongReceipt.vendor_receipt_id = `sha256:${"1".repeat(64)}`;
  assert(bundle.generateStaticPortal(wrongReceipt) === null, "portal rejects a vendor_receipt_id that does not match the signed manifest/attestation");
  const wrongBundle = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongBundle.static_bundle_id = "static_bundle:synthetic-unrelated-999";
  assert(bundle.generateStaticPortal(wrongBundle) === null, "portal rejects a static_bundle_id that does not match the signed manifest");
  const wrongPackageState = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); wrongPackageState.package_state = "finalized";
  assert(bundle.generateStaticPortal(wrongPackageState) === null, "portal rejects a package_state that does not match the signed manifest");
  const detachedManifest = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature); detachedManifest.manifest = { ...generatedManifestFixture, review_id: "review:synthetic-unrelated-999" };
  assert(bundle.generateStaticPortal(detachedManifest) === null, "portal rejects a manifest object whose own review_id was tampered independently of its identity");

  const files = [
    generatedPortalFile(portal.assets[0], "artifact_ref:portal_html", "portal"),
    generatedPortalFile(portal.assets[1], "artifact_ref:portal_css", "portal_asset"),
    generatedPortalFile(portal.assets[2], "artifact_ref:portal_js", "portal_asset"),
    generatedJson(bundle, "attestation.json", "attestation", "artifact_ref:security_review_attestation", attestation),
    generatedJson(bundle, "evidence-bundle-representation.json", "evidence_bundle_representation", "artifact_ref:evidence_bundle_representation", evidenceRepresentation(evidenceBundleManifest.evidence_bundle_id)),
    generatedJson(bundle, "vendor-receipt.json", "vendor_receipt", "artifact_ref:vendor_receipt", receipt),
    // C6-22: these three must now be the real, internally-consistent Evidence
    // Bundle manifest/identity-input/signature documents -- schema-valid
    // skeletal stubs are no longer accepted, since generation now recomputes
    // evidence_bundle_id from content and verifies the actual signature.
    generatedJson(bundle, "evidence/bundle-manifest.json", "supporting_evidence", "artifact_ref:bundle_manifest", evidenceBundleManifest),
    generatedJson(bundle, "evidence/bundle-signature.json", "supporting_evidence", "artifact_ref:bundle_signature", evidenceBundleSignature),
    generatedJson(bundle, "evidence/bundle-identity.json", "supporting_evidence", "artifact_ref:bundle_identity", evidenceBundleIdentity),
    generatedText(bundle, "VERIFY.txt", "verification_metadata", "artifact_ref:verification_instructions", "Verify all SHA-256 file digests against this package's canonical manifest before evaluating this synthetic demo package.")
  ];
  const input = generationFixture(files, attestation.attestation_id, receipt.vendor_receipt_id, evidenceBundleManifest.evidence_bundle_id, disclosurePolicy, customerApproval);
  const generated = generate(input);
  assert(generated.ok, `valid retained package generates: ${JSON.stringify(generated)}`);
  assert(generated.manifest.static_bundle_id === "static_bundle:synthetic_001" && generated.manifest.static_bundle_manifest_id.startsWith("sha256:"), "stable bundle identity and content-addressed manifest stay distinct");
  assert(generated.manifest.files.map((file) => file.relative_path).join() === [...files].sort((a, b) => a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0).map((file) => file.relative_path).join(), "manifest ordering is locale independent");
  assert(!generated.manifest.files.some((file) => file.artifact_ref === generated.manifest.verification_metadata.manifest_signature_ref || file.artifact_ref === generated.manifest.verification_metadata.signing_input_ref), "signing attachments are outside the signed payload manifest");
  assert(generated.verification_package.signing_input_attachment.digest === nodeSha256(generated.verification_package.signing_input_attachment.signing_input, bundle) && generated.verification_package.signature_attachment.digest === nodeSha256(generated.verification_package.signature_attachment.signature_envelope, bundle), "outer attachment digests match independent node:crypto RFC8785 bytes");
  assert(generated.signing_request.signing_input.identity_input_path === "v0/valid/static-bundle-manifest.identity-input.json" && /^ml_dsa_65:[A-Za-z0-9_-]{4412}$/u.test(generated.signature_envelope.signature_bytes), "generated signing artifacts are typed and protocol valid");
  assert(generated.generated_event.event_type === "static_bundle_generated" && generated.generated_event.artifact_refs.join() === generated.manifest.static_bundle_manifest_id && generated.generated_event.idempotency_key.includes(generated.manifest.static_bundle_manifest_id.slice(7)), "generated event binds exact content-addressed manifest identity");
  assert(Object.isFrozen(generated) && Object.isFrozen(generated.manifest.files) && Object.isFrozen(generated.signature_envelope), "generated bundle output is deeply immutable");
  const replay = generate(structuredClone(input));
  assert(replay.ok && replay.canonical_manifest === generated.canonical_manifest && replay.generated_event.event_id === generated.generated_event.event_id, "same input deterministically replays");

  // C6-42: minimization_disposition's four ref lists are semantically sets
  // (membership only) -- two inputs with identical membership but different
  // caller order must produce the identical manifest identity.
  const orderedMinimization = { included_retained_refs: [...input.minimization_disposition.included_retained_refs], excluded_refs: ["artifact_ref:internal_pilot_feedback", "artifact_ref:internal_pilot_feedback_2"], deleted_refs: ["deletion_evidence:synthetic", "deletion_evidence:synthetic_2"], never_collected_refs: ["artifact_ref:full_source", "artifact_ref:full_source_2"] };
  const extraDeletionRecord = { protocol_version: "codeattest.v0", deletion_evidence_id: "deletion_evidence:synthetic_2", deleted_artifact_digests: [digest("8")], deletion_method: "crypto_erase", deletion_timestamp: "2026-08-01T11:00:00Z", actor: { actor_type: "vendor_service", actor_id: "vendor_service:retention" }, verification_status: "verified" };
  const orderedInput = structuredClone(input);
  orderedInput.minimization_disposition = orderedMinimization;
  orderedInput.deletion_records = [...input.deletion_records, extraDeletionRecord];
  const reversedInput = structuredClone(orderedInput);
  reversedInput.minimization_disposition = { included_retained_refs: [...orderedMinimization.included_retained_refs].reverse(), excluded_refs: [...orderedMinimization.excluded_refs].reverse(), deleted_refs: [...orderedMinimization.deleted_refs].reverse(), never_collected_refs: [...orderedMinimization.never_collected_refs].reverse() };
  const orderedGenerated = generate(orderedInput);
  const reversedGenerated = generate(reversedInput);
  assert(orderedGenerated.ok && reversedGenerated.ok && orderedGenerated.manifest.static_bundle_manifest_id === reversedGenerated.manifest.static_bundle_manifest_id, "permuting minimization_disposition ref order (same membership) does not change the manifest identity");
  assert(JSON.stringify(orderedGenerated.manifest.minimization_disposition) === JSON.stringify(reversedGenerated.manifest.minimization_disposition), "minimization_disposition is emitted in canonical order regardless of caller order");

  const tampered = structuredClone(input); tampered.files[0].content += " ";
  assertFailure(generate(tampered), "digest_mismatch");
  const sparse = structuredClone(input); delete sparse.files[0];
  assertFailure(generate(sparse), "invalid_input");
  const extra = structuredClone(input); extra.extra = true;
  assertFailure(generate(extra), "invalid_input");
  const duplicateRef = structuredClone(input); duplicateRef.files[1].artifact_ref = duplicateRef.files[0].artifact_ref;
  assertFailure(generate(duplicateRef), "invalid_input");
  const normalizedCollision = structuredClone(input); normalizedCollision.files[1].relative_path = normalizedCollision.files[0].relative_path.toUpperCase();
  assertFailure(generate(normalizedCollision), "invalid_input");
  const missingMinimization = structuredClone(input); missingMinimization.minimization_disposition.included_retained_refs.pop();
  assertFailure(generate(missingMinimization), "invalid_input");
  const staleMinimization = structuredClone(input); staleMinimization.minimization_disposition.included_retained_refs.push("artifact_ref:stale");
  assertFailure(generate(staleMinimization), "invalid_input");
  // C6-40: Evidence Bundle role refs must be pairwise distinct — one file
  // must not be able to satisfy multiple conceptual roles at once.
  const collidingRoleRefs = structuredClone(input); collidingRoleRefs.evidence_bundle_representation.signature_ref = collidingRoleRefs.evidence_bundle_representation.bundle_manifest_ref;
  assertFailure(generate(collidingRoleRefs), "required_artifact_missing");
  // C6-41: `.` segments and double slashes normalize away on extraction and
  // must be rejected, not accepted as distinct from their collapsed form.
  const dotSegmentPath = structuredClone(input); dotSegmentPath.files[6].relative_path = "evidence/./bundle-manifest.json";
  assertFailure(generate(dotSegmentPath), "unsafe_path");
  const doubleSlashPath = structuredClone(input); doubleSlashPath.files[6].relative_path = "evidence//bundle-manifest.json";
  assertFailure(generate(doubleSlashPath), "unsafe_path");
  // C6-23: `export_approved: true` must now be backed by a verified,
  // content-addressed Disclosure Policy and a customer approval that
  // actually accepted it -- not just a bare per-file caller assertion.
  const missingPolicy = structuredClone(input); delete missingPolicy.disclosure_policy;
  assertFailure(generate(missingPolicy), "required_artifact_missing");
  const tamperedPolicyId = structuredClone(input); tamperedPolicyId.disclosure_policy.disclosure_policy_id = `sha256:${"0".repeat(64)}`;
  assertFailure(generate(tamperedPolicyId), "required_artifact_missing");
  const declinedApproval = structuredClone(input); declinedApproval.customer_approval.decision = "declined";
  assertFailure(generate(declinedApproval), "required_artifact_missing");
  const unboundApproval = structuredClone(input); unboundApproval.customer_approval.displayed_context.disclosure_policy_ref = `sha256:${"1".repeat(64)}`;
  assertFailure(generate(unboundApproval), "required_artifact_missing");
  // A metadata-only Disclosure Policy must reject retained supporting
  // evidence outright, even though every other export-approval check passes.
  const metadataOnlyApproval = structuredClone(input);
  metadataOnlyApproval.disclosure_policy = structuredClone(metadataOnlyDisclosurePolicy);
  metadataOnlyApproval.customer_approval.displayed_context.disclosure_policy_ref = metadataOnlyDisclosurePolicy.disclosure_policy_id;
  assertFailure(generate(metadataOnlyApproval), "unapproved_export");
  // C6-38: an empty or irrelevant VERIFY.txt must not back offline_verification_supported:true.
  const verifyIndex = input.files.findIndex((file) => file.relative_path === "VERIFY.txt");
  const emptyVerify = structuredClone(input);
  emptyVerify.files[verifyIndex].content = "ok";
  emptyVerify.files[verifyIndex].digest = bundle.sha256Text("ok");
  emptyVerify.files[verifyIndex].size_bytes = new TextEncoder().encode("ok").length;
  assertFailure(generate(emptyVerify), "unverifiable_file");
  const internalPayload = structuredClone(input); internalPayload.files[0].content = "internal pilot feedback"; internalPayload.files[0].digest = bundle.sha256Text(internalPayload.files[0].content); internalPayload.files[0].size_bytes = new TextEncoder().encode(internalPayload.files[0].content).length;
  assertFailure(generate(internalPayload), "unverifiable_file");
  const wrongAttestation = structuredClone(input); const wrong = JSON.parse(wrongAttestation.files.find((file) => file.artifact_role === "attestation").content); wrong.review_id = "review:other"; const wrongContent = bundle.canonicalizeStaticBundleJson(wrong); const wrongFile = wrongAttestation.files.find((file) => file.artifact_role === "attestation"); wrongFile.content = wrongContent; wrongFile.digest = bundle.sha256Text(wrongContent); wrongFile.size_bytes = new TextEncoder().encode(wrongContent).length;
  assertFailure(generate(wrongAttestation), "unverifiable_file");
  const missingVerify = structuredClone(input); missingVerify.files = missingVerify.files.filter((file) => file.relative_path !== "VERIFY.txt");
  assertFailure(generate(missingVerify), "portal_incomplete");
  const unsafe = structuredClone(input); unsafe.files[0].relative_path = "../outside.html";
  assertFailure(generate(unsafe), "unsafe_path");
  const deleted = structuredClone(input); deleted.deletion_records[0].deleted_artifact_digests.push(deleted.files[0].digest);
  assertFailure(generate(deleted), "deleted_content_reintroduced");

  const portalSource = { portal_id: portalInput.portal_id, title: portalInput.title, selected_application: portalInput.selected_application, sections: portalInput.sections, findings: portalInput.findings, mappings: [mappingRecord] };
  const derivedFinalized = deriveFinalized(bundle, generated.manifest, finalizationRecord.finalized_at, portalSource, attestation, input.signing_key);
  const boundFinalization = withFinalizedIdentity(bundle, { ...finalizationRecord, generated_manifest_ref: generated.manifest.static_bundle_manifest_id, finalized_manifest_ref: derivedFinalized.manifest.static_bundle_manifest_id, finalized_manifest_version: derivedFinalized.manifest.manifest_version, static_bundle_id: generated.manifest.static_bundle_id, review_id: generated.manifest.review_id, visible_context: { ...finalizationRecord.visible_context, attestation_id: attestation.attestation_id, static_bundle_id: generated.manifest.static_bundle_id, generated_manifest_id: generated.manifest.static_bundle_manifest_id } });
  const finalizationInput = { finalization_record: boundFinalization, attestation, vendor_receipt: receipt, generated_manifest: generated.manifest, generated_signing_input: generated.signing_request.signing_input, generated_signature: generated.signature_envelope, portal_projection: { ...portalProjection, static_bundle_id: generated.manifest.static_bundle_id, static_bundle_manifest_ref: generated.manifest.static_bundle_manifest_id, review_id: generated.manifest.review_id }, portal_source: portalSource, deletion_evidence: [deletionEvidence], signing_key: input.signing_key, event: { sequence_number: 22 }, visible_context_confirmed: true };
  assertFailure(finalize({ ...finalizationInput, finalization_record: { ...boundFinalization, customer_actor: { actor_type: "reviewer", actor_id: "reviewer:sam" } } }), "customer_authority_required");
  assertFailure(finalize({ ...finalizationInput, visible_context_confirmed: false }), "visible_context_required");
  assertFailure(finalize({ ...finalizationInput, generated_signature: { ...generated.signature_envelope, key_version: "tampered" } }), "invalid_context");
  // C6-44: a portal_source that generateStaticPortal itself rejects (here, a
  // findings array with a duplicate finding_ref) must fail finalization
  // closed rather than silently falling back to stale generated-state portal
  // bytes.
  assertFailure(finalize({ ...finalizationInput, portal_source: { ...portalSource, findings: [portalSource.findings[0], portalSource.findings[0]] } }), "invalid_manifest");
  const finalized = finalize(finalizationInput);
  assert(finalized.ok && finalized.manifest.manifest_version === generated.manifest.manifest_version + 1 && finalized.manifest.supersedes_static_bundle_manifest_id === generated.manifest.static_bundle_manifest_id, `finalization signs new manifest version without mutation: ${JSON.stringify(finalized)}`);
  // C6-44: finalization must regenerate the portal's HTML/CSS/JS for the
  // finalized identity/signing context, not reuse the generated package's
  // stale portal bytes -- the finalized manifest's portal file digests must
  // match the freshly rendered assets, and those assets must differ from (and
  // embed the finalized signing time, not) the generated portal's.
  const finalizedPortalFiles = new Map(finalized.ok ? finalized.manifest.files.filter((file) => file.artifact_role === "portal" || file.artifact_role === "portal_asset").map((file) => [file.relative_path, file]) : []);
  assert(finalized.ok && finalized.portal_package.assets.length === 3 && finalized.portal_package.assets.every((asset) => finalizedPortalFiles.get(asset.path)?.digest === asset.digest && finalizedPortalFiles.get(asset.path)?.size_bytes === asset.size_bytes), "finalized manifest's portal file digests match the freshly regenerated portal assets");
  const [finalizedHtml] = finalized.ok ? finalized.portal_package.assets.map((entry) => entry.content) : [];
  assert(finalizedHtml !== html, "finalized portal HTML is regenerated, not the stale generated-state bytes");
  assert(finalizedHtml.includes(finalizationRecord.finalized_at), "finalized portal HTML embeds the finalized signing time, not the generated one");
  assert(finalized.ok && finalized.signing_request.signing_input.identity_input_path === "v0/valid/static-bundle-manifest.finalized.identity-input.json", "finalized signing artifacts bind finalized identity path");
  assert(finalized.ok && finalized.finalized_event.artifact_refs.join() === finalized.manifest.static_bundle_manifest_id && finalized.finalized_event.idempotency_key.includes(finalized.finalization_record.static_bundle_id) && finalized.finalized_event.idempotency_key.includes(finalized.manifest.static_bundle_manifest_id.slice(7)), `finalized event binds exact manifest identity and stable bundle family: ${JSON.stringify(finalized)}`);
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: finalized.manifest, signing_input: finalized.signing_request.signing_input, signature: finalized.signature_envelope }, verifiedOutcome(finalized.signature_envelope))?.verificationState === "verified_offline", "finalized projector recomputes identity and accepts a covering outcome");
  // C6-44: the projection must pass through the finalization record's own
  // customer_control_after_export disclaimer text, not a hardcoded claim
  // independent of record state.
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: finalized.manifest, signing_input: finalized.signing_request.signing_input, signature: finalized.signature_envelope }, verifiedOutcome(finalized.signature_envelope))?.customerControlAfterExport === finalized.finalization_record.customer_control_after_export, "finalized projector passes through the record's own customer-control disclaimer text");
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: { ...finalized.manifest, created_at: "2026-08-01T13:00:01Z" }, signing_input: finalized.signing_request.signing_input, signature: finalized.signature_envelope }, verifiedOutcome(finalized.signature_envelope)) === null, "finalized projector rejects manifest tamper");
  // C6-49: a one-character signature tamper, and a wrong signed identity in
  // the signing input, must independently be caught by the finalized
  // projector's own signature verification — a deleted verification
  // condition should not be able to leave this test suite green.
  // D3-2: a real signature's bytes cannot be recomputed by a keyless pure
  // module, so "are these bytes good" is answered only by the supplied
  // outcome -- no outcome, or one that does not cover this exact envelope,
  // must both fail closed.
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: finalized.manifest, signing_input: finalized.signing_request.signing_input, signature: finalized.signature_envelope }) === null, "finalized projector rejects a signature with no verification outcome");
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: finalized.manifest, signing_input: finalized.signing_request.signing_input, signature: finalized.signature_envelope }, { ...verifiedOutcome(finalized.signature_envelope), key_version: "some-other-key-version" }) === null, "finalized projector rejects an outcome that does not cover this envelope");
  assert(finalized.ok && bundle.projectFinalizedStaticBundle({ finalization_record: finalized.finalization_record, manifest: finalized.manifest, signing_input: { ...finalized.signing_request.signing_input, signed_identity: finalized.signing_request.signing_input.signed_identity.replace(/[0-9a-f]$/u, (char) => char === "0" ? "1" : "0") }, signature: finalized.signature_envelope }, verifiedOutcome(finalized.signature_envelope)) === null, "finalized projector rejects a wrong signed identity in the signing input");
  assert(finalized.ok && Object.isFrozen(finalized) && Object.isFrozen(finalized.manifest), "finalized output is deeply immutable");
  // C6-48: the attachment index identity must be independently recomputable
  // (excluding its own id field) and attachment byte sizes must be asserted
  // independently, not just their digests — a constant id or zero size
  // should not be able to regress green.
  const verificationPackage = generated.verification_package;
  const { attachment_index_id: generatedIndexId, ...indexWithoutId } = verificationPackage;
  assert(bundle.sha256Text(bundle.canonicalizeStaticBundleJson(indexWithoutId)) === generatedIndexId, "attachment_index_id is independently recomputable from its own excluded-id content");
  assert(verificationPackage.signing_input_attachment.size_bytes === new TextEncoder().encode(bundle.canonicalizeStaticBundleJson(verificationPackage.signing_input_attachment.signing_input)).length, "signing input attachment size_bytes matches independently computed UTF-8 length");
  assert(verificationPackage.signature_attachment.size_bytes === new TextEncoder().encode(bundle.canonicalizeStaticBundleJson(verificationPackage.signature_attachment.signature_envelope)).length, "signature attachment size_bytes matches independently computed UTF-8 length");
  await executePortalInteractions(js);
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
console.log("Static bundle Epic 5 tests passed.");

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
function portalFixture(mappingRecord, attestation, manifest, signingInput, signature) {
  const sectionIds = ["overview", "scope", "receipt-chain", "methods", "findings", "validation-remediation", "limitations", "appendices"];
  return { protocol_version: "codeattest.v0", portal_id: "static_portal:synthetic_001", title: "Synthetic Security Review Evidence Packet", review_id: attestation.review_id, selected_application: "Synthetic payments API", selected_commit: attestation.selected_commit.commit_sha, attestation_id: attestation.attestation_id, static_bundle_id: manifest.static_bundle_id, static_bundle_manifest_id: manifest.static_bundle_manifest_id, package_state: manifest.package_state, vendor_receipt_id: manifest.vendor_receipt_ref, verification_status: "verified_offline", canonicalization: "rfc8785", signature_profile: "ml_dsa_65", signing_key_id: signature.key_id, signing_key_version: signature.key_version, signing_time: signature.signing_time, signing_input: signingInput, signing_limitations: [...signature.signing_limitations], sections: sectionIds.map((id) => ({ id, title: id.replaceAll("-", " "), summary: `Recorded ${id.replaceAll("-", " ")} information for the selected review scope.`, body: ["This section presents bounded supporting evidence and its recorded limitations."], details: [{ label: "Attestation reference", value: attestation.attestation_id, copyable: true }] })), findings: [{ finding_ref: "review_finding_draft:demo", title: "Synthetic authorization review finding", classification: "confirmed", evidence_basis: "Submitted retained metadata and reviewer criteria.", limitation: "The finding remains bounded to submitted evidence.", validation_path: "Customer executes the recorded validation path.", remediation_status: "validation pending", artifact_refs: ["artifact_ref:finding"] }], mappings: [mappingRecord], manifest, attestation };
}
function generationFixture(files, attestationRef, receiptRef, evidenceBundleId, disclosurePolicy, customerApproval) { return { protocol_version: "codeattest.v0", static_bundle_id: "static_bundle:synthetic_001", review_id: "review:synthetic-demo-001", attestation_ref: attestationRef, vendor_receipt_ref: receiptRef, evidence_bundle_representation: evidenceRepresentation(evidenceBundleId), portal_projection_ref: "static_portal_projection:synthetic_001", manifest_version: 1, created_at: "2026-08-01T12:00:00Z", actor: { actor_type: "vendor_service", actor_id: "vendor_service:static_generator" }, event: { sequence_number: 20 }, files, minimization_disposition: { included_retained_refs: files.map((file) => file.artifact_ref), excluded_refs: ["artifact_ref:internal_pilot_feedback"], deleted_refs: ["deletion_evidence:synthetic"], never_collected_refs: ["artifact_ref:full_source"] }, deletion_records: [{ protocol_version: "codeattest.v0", deletion_evidence_id: "deletion_evidence:synthetic", deleted_artifact_digests: [digest("9")], deletion_method: "crypto_erase", deletion_timestamp: "2026-08-01T11:00:00Z", actor: { actor_type: "vendor_service", actor_id: "vendor_service:retention" }, verification_status: "verified" }], verification_metadata: { manifest_signature_ref: "artifact_ref:static_bundle_signature", signing_input_ref: "artifact_ref:static_bundle_signing_input", verification_instructions_path: "VERIFY.txt", offline_verification_supported: true, all_file_digests_verified: true }, signing_key: staticBundleSigningKey, disclosure_policy: disclosurePolicy, customer_approval: customerApproval }; }
function evidenceRepresentation(evidenceBundleId) { return { evidence_bundle_id: evidenceBundleId, bundle_manifest_ref: "artifact_ref:bundle_manifest", signature_ref: "artifact_ref:bundle_signature", identity_ref: "artifact_ref:bundle_identity", retained_export_approved_payload_refs: [] }; }
function generatedPortalFile(asset, artifactRef, artifactRole) { return { relative_path: asset.path, artifact_role: artifactRole, media_type: asset.media_type, artifact_ref: artifactRef, source_derived_class: "retained_review_artifact", export_approved: true, inclusion_reason: "Generated offline portal asset.", content: asset.content, digest: asset.digest, size_bytes: asset.size_bytes }; }
function generatedJson(bundle, pathName, artifactRole, artifactRef, value) { return generatedText(bundle, pathName, artifactRole, artifactRef, bundle.canonicalizeStaticBundleJson(value), "application/json"); }
function generatedText(bundle, pathName, artifactRole, artifactRef, content, mediaType = "text/plain") { return { relative_path: pathName, artifact_role: artifactRole, media_type: mediaType, artifact_ref: artifactRef, source_derived_class: "retained_review_artifact", export_approved: true, inclusion_reason: "Canonical retained protocol artifact.", content, digest: bundle.sha256Text(content), size_bytes: new TextEncoder().encode(content).length }; }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs", name), "utf8")); }
function nodeSha256(value, bundle) { return `sha256:${createHash("sha256").update(bundle.canonicalizeStaticBundleJson(value), "utf8").digest("hex")}`; }
// C6-44: independently replicates the two-pass identity the production
// finalizeStaticBundleManifest now computes (provisional finalized manifest
// -> regenerated portal assets -> true finalized identity over the swapped
// file digests), so this test predicts the same `finalized_manifest_ref` the
// production code will arrive at, rather than the pre-fix single-pass value.
function deriveFinalized(bundle, generated, finalizedAt, portalSource, attestation, signingKey) {
  const baseDocument = { ...structuredClone(generated), manifest_version: generated.manifest_version + 1, package_state: "finalized", created_at: finalizedAt, supersedes_static_bundle_manifest_id: generated.static_bundle_manifest_id };
  delete baseDocument.static_bundle_manifest_id;
  const provisionalManifestId = bundle.sha256Text(bundle.canonicalizeStaticBundleJson(baseDocument));
  const provisionalManifest = { ...baseDocument, static_bundle_manifest_id: provisionalManifestId };
  const provisionalSigningRequest = bundle.createStaticBundleSigningRequest(provisionalManifest, finalizedAt, signingKey);
  const portal = bundle.generateStaticPortal({
    protocol_version: "codeattest.v0",
    portal_id: portalSource.portal_id,
    title: portalSource.title,
    review_id: provisionalManifest.review_id,
    selected_application: portalSource.selected_application,
    selected_commit: attestation.selected_commit.commit_sha,
    attestation_id: provisionalManifest.attestation_ref,
    static_bundle_id: provisionalManifest.static_bundle_id,
    static_bundle_manifest_id: provisionalManifestId,
    package_state: "finalized",
    vendor_receipt_id: provisionalManifest.vendor_receipt_ref,
    verification_status: "verified_offline",
    canonicalization: "rfc8785",
    signature_profile: "ml_dsa_65",
    signing_key_id: signingKey.key_id,
    signing_key_version: signingKey.key_version,
    signing_time: finalizedAt,
    signing_input: provisionalSigningRequest.signing_input,
    signing_limitations: [...provisionalSigningRequest.signing_limitations],
    sections: portalSource.sections,
    findings: portalSource.findings,
    mappings: portalSource.mappings,
    manifest: provisionalManifest,
    attestation
  });
  if (portal === null) throw new Error("test setup: finalized portal regeneration failed");
  const assetByPath = new Map(portal.assets.map((asset) => [asset.path, asset]));
  const identityDocument = { ...baseDocument, files: baseDocument.files.map((file) => { const asset = assetByPath.get(file.relative_path); return asset === undefined ? file : { ...file, digest: asset.digest, size_bytes: asset.size_bytes }; }) };
  const manifest = { ...identityDocument, static_bundle_manifest_id: bundle.sha256Text(bundle.canonicalizeStaticBundleJson(identityDocument)) };
  return { manifest, portal };
}
function withFinalizedIdentity(bundle, record) { const input = structuredClone(record); delete input.attestation_package_finalization_id; delete input.export_state; delete input.exported_at; return { ...record, attestation_package_finalization_id: `attestation_finalization:${bundle.sha256Text(bundle.canonicalizeStaticBundleJson(input)).slice(7)}` }; }
async function executePortalInteractions(source) {
  class Element { constructor(tag="div") { this.tag=tag; this.children=[]; this.dataset={}; this.textContent=""; this.hidden=false; this.value=""; this.attrs=new Map(); } append(child){this.children.push(child)} replaceChildren(...children){this.children=children} setAttribute(k,v){this.attrs.set(k,v)} getAttribute(k){return this.attrs.get(k)} toggleAttribute(k,on){if(on)this.attrs.set(k,"");else this.attrs.delete(k)} closest(selector){return selector==="[data-copy]"&&this.dataset.copy!==undefined?this:null} select(){} remove(){} }
  class HTMLButtonElement extends Element {}
  const input=new Element("input"),results=new Element(),status=new Element(),copy=new HTMLButtonElement("button");copy.dataset.copy="copy-value";copy.textContent="Copy";const nav=new Element("a");nav.setAttribute("href","#overview");const section=new Element("section");section.id="overview";const listeners={};const document={getElementById:id=>({"portal-search":input,"search-results":results,"search-status":status}[id]),addEventListener:(type,fn)=>listeners[type]=fn,querySelectorAll:sel=>sel==="nav a"?[nav]:[section],createElement:tag=>tag==="button"?new HTMLButtonElement(tag):new Element(tag),body:new Element(),execCommand:()=>false};input.addEventListener=(type,fn)=>listeners[`input:${type}`]=fn;let clipboard="";const context={document,navigator:{clipboard:{writeText:async value=>{clipboard=value}}},Element,HTMLButtonElement,IntersectionObserver:class{constructor(cb){this.cb=cb}observe(target){this.cb([{isIntersecting:true,intersectionRatio:1,target}])}},window:{},setTimeout:fn=>fn()};context.window.IntersectionObserver=context.IntersectionObserver;vm.runInNewContext(source,context);input.value="receipt";listeners["input:input"]();assert(status.textContent.includes("matching"),"generated portal search executes in fake DOM");await listeners.click({target:copy});assert(clipboard==="copy-value","generated portal copy executes in fake DOM");assert(nav.attrs.has("aria-current"),"generated portal navigation executes in fake DOM"); }
function sparseArray() { const value = []; value.length = 1; return value; }
function cyclic(value) { value.self = value; return value; }
function digest(char) { return `sha256:${char.repeat(64)}`; }
function assertFailure(result, code) { assert(!result.ok && result.code === code, `expected ${code}: ${JSON.stringify(result)}`); }
function assertThrows(run, message) { let threw = false; try { run(); } catch { threw = true; } assert(threw, message); }
function assert(condition, message) { if (!condition) throw new Error(message); }
