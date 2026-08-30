import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifiedOutcome } from "./helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");
const signingRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-epic-5-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-epic-5-test-dist");
const schemaIds = [
  "urn:codeattest:protocol:v0:security-review-attestation",
  "urn:codeattest:protocol:v0:supporting-evidence-mapping",
  "urn:codeattest:protocol:v0:static-bundle-manifest",
  "urn:codeattest:protocol:v0:static-portal-projection",
  "urn:codeattest:protocol:v0:attestation-package-finalization",
  "urn:codeattest:protocol:v0:pilot-metric-record",
  "urn:codeattest:protocol:v0:pilot-feedback-record",
  "urn:codeattest:protocol:v0:identity-signing-input",
  "urn:codeattest:protocol:v0:signature-envelope",
  "urn:codeattest:protocol:v0:static-bundle-verification-package"
];

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--outDir", outDir, "--tsBuildInfoFile", path.join(tempDir, "protocol-ts.tsbuildinfo")], { cwd: workspacePath, stdio: "pipe" });
  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);
  const generated = await import(pathToFileURL(path.join(outDir, "generated", "protocol-v0-schemas.js")).href);
  for (const schemaId of schemaIds) assert(schemaId in generated.protocolV0Schemas, `generated schemas include ${schemaId}`);

  const [attestation, mapping, generatedManifest, finalizedManifest, generatedVerificationPackage, finalizedVerificationPackage, portal, finalization, metric, feedback, generatedSigningInput, finalizedSigningInput, finalizationSigningInput, generatedSignature, finalizedSignature, finalizationSignature] = await Promise.all([
    fixture("security-review-attestation.json"), fixture("supporting-evidence-mapping.soc2.json"), fixture("static-bundle-manifest.generated.json"), fixture("static-bundle-manifest.finalized.json"), fixture("static-bundle-verification-package.generated.json"), fixture("static-bundle-verification-package.finalized.json"), fixture("static-portal-projection.json"), fixture("attestation-package-finalization.json"), fixture("pilot-metric-record.json"), fixture("pilot-feedback-record.json"), signingFixture("static-bundle-manifest-identity.json"), signingFixture("static-bundle-manifest-finalized-identity.json"), signingFixture("attestation-package-finalization-identity.json"), fixture("signature-envelope.static-bundle.json"), fixture("signature-envelope.static-bundle-finalized.json"), fixture("signature-envelope.attestation-finalization.json")
  ]);

  for (const [schemaId, value] of [
    [schemaIds[0], attestation], [schemaIds[1], mapping], [schemaIds[2], generatedManifest], [schemaIds[2], finalizedManifest], [schemaIds[3], portal], [schemaIds[4], finalization], [schemaIds[5], metric], [schemaIds[6], feedback], [schemaIds[7], generatedSigningInput], [schemaIds[7], finalizedSigningInput], [schemaIds[7], finalizationSigningInput], [schemaIds[8], generatedSignature], [schemaIds[8], finalizedSignature], [schemaIds[8], finalizationSignature], [schemaIds[9], generatedVerificationPackage], [schemaIds[9], finalizedVerificationPackage]
  ]) assertNoErrors(protocol, schemaId, value);

  assert(protocol.recomputeExcludedFieldIdentity(attestation, "attestation_id", "attestation") === attestation.attestation_id, "Attestation identity is RFC8785 content addressed");
  assert(protocol.recomputeExcludedFieldIdentity(generatedManifest, "static_bundle_manifest_id") === generatedManifest.static_bundle_manifest_id, "generated static manifest identity recomputes");
  assert(protocol.recomputeExcludedFieldIdentity(finalizedManifest, "static_bundle_manifest_id") === finalizedManifest.static_bundle_manifest_id, "finalized static manifest identity recomputes");
  assert(finalizedManifest.manifest_version === generatedManifest.manifest_version + 1 && finalizedManifest.supersedes_static_bundle_manifest_id === generatedManifest.static_bundle_manifest_id, "finalized manifest preserves generated lineage");
  assert(protocol.recomputeExcludedFieldsIdentity(finalization, ["attestation_package_finalization_id", "export_state", "exported_at"], "attestation_finalization") === finalization.attestation_package_finalization_id, "finalization identity remains stable across export timeline state");
  assert(protocol.sha256ProtocolText("abc") === "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "nonempty SHA-256 matches the known abc vector");
  for (const [manifest, input, signature, verificationPackage, identityPath] of [[generatedManifest, generatedSigningInput, generatedSignature, generatedVerificationPackage, "v0/valid/static-bundle-manifest.identity-input.json"], [finalizedManifest, finalizedSigningInput, finalizedSignature, finalizedVerificationPackage, "v0/valid/static-bundle-manifest.finalized.identity-input.json"]]) {
    const expectation = { protocol_version: "codeattest.v0", signing_input_type: "static_bundle_manifest_identity", signed_identity_type: "static_bundle_manifest", signed_identity: manifest.static_bundle_manifest_id, identity_input_path: identityPath, key_id: signature.key_id, key_version: signature.key_version, signing_time: manifest.created_at };
    const outcome = verifiedOutcome(signature);
    assert(protocol.signatureEnvelopeMatchesExpectation(input, signature, expectation) && protocol.signatureOutcomeCovers(signature, outcome), `${manifest.package_state} shared signature verifier succeeds`);
    // C3-04 / D3-2: a tamper matrix for every field the structural verifier is
    // supposed to bind, plus the bytes, which are now bound by the outcome
    // rather than recomputed.
    assert(!protocol.signatureEnvelopeMatchesExpectation(input, { ...signature, key_version: `${signature.key_version}-tampered` }, expectation), `${manifest.package_state} shared verifier rejects tampered key version`);
    assert(!protocol.signatureEnvelopeMatchesExpectation(input, { ...signature, signed_identity: `sha256:${"0".repeat(64)}` }, expectation), `${manifest.package_state} shared verifier rejects tampered envelope signed_identity`);
    assert(!protocol.signatureEnvelopeMatchesExpectation(input, { ...signature, canonicalization: "raw" }, expectation), `${manifest.package_state} shared verifier rejects tampered canonicalization`);
    assert(!protocol.signatureOutcomeCovers({ ...signature, key_id: `${signature.key_id}-tampered` }, outcome), `${manifest.package_state} outcome does not cover a re-keyed envelope`);
    assert(!protocol.signatureOutcomeCovers(signature, { ...outcome, result: "signature_bytes_untrusted" }), `${manifest.package_state} an unverified outcome never authenticates the bytes`);
    assert(!protocol.signatureOutcomeCovers(signature, undefined), `${manifest.package_state} a missing outcome never authenticates the bytes`);
    assert(!protocol.signatureEnvelopeMatchesExpectation(input, { ...signature, signature_bytes: `${signature.signature_bytes}-tampered` }, expectation), `${manifest.package_state} shared verifier rejects malformed signature_bytes`);
    assert(!protocol.signatureEnvelopeMatchesExpectation({ ...input, identity_input_path: "v0/valid/other-path.json" }, signature, expectation), `${manifest.package_state} shared verifier rejects tampered signing-input identity_input_path`);
    assert(!protocol.signatureEnvelopeMatchesExpectation({ ...input, signed_identity: `sha256:${"f".repeat(64)}` }, signature, expectation), `${manifest.package_state} shared verifier rejects tampered signing-input signed_identity`);
    const identityInput = { ...manifest }; delete identityInput.static_bundle_manifest_id;
    assert(`sha256:${createHash("sha256").update(protocol.canonicalizeProtocolJson(identityInput), "utf8").digest("hex")}` === manifest.static_bundle_manifest_id, `${manifest.package_state} manifest matches independent node:crypto hash`);
    const signingBytes = protocol.canonicalizeProtocolJson(verificationPackage.signing_input_attachment.signing_input);
    const signatureBytes = protocol.canonicalizeProtocolJson(verificationPackage.signature_attachment.signature_envelope);
    assert(`sha256:${createHash("sha256").update(signingBytes, "utf8").digest("hex")}` === verificationPackage.signing_input_attachment.digest && Buffer.byteLength(signingBytes) === verificationPackage.signing_input_attachment.size_bytes, "signing input attachment bytes match digest and size");
    assert(`sha256:${createHash("sha256").update(signatureBytes, "utf8").digest("hex")}` === verificationPackage.signature_attachment.digest && Buffer.byteLength(signatureBytes) === verificationPackage.signature_attachment.size_bytes, "signature attachment bytes match digest and size");
  }

  assertHasError(protocol, schemaIds[0], { ...attestation, source_bytes: "forbidden" }, "additional_property");
  assertHasError(protocol, schemaIds[0], { ...attestation, attestation_version: Number.MAX_SAFE_INTEGER + 1 }, "type");
  assertHasError(protocol, schemaIds[1], { ...mapping, approved_by: { actor_type: "vendor_service", actor_id: "vendor:svc" } }, "const");
  for (const profile of ["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"]) assertNoErrors(protocol, schemaIds[1], { ...mapping, supporting_evidence_mapping_id: `supporting_evidence_mapping:synthetic_${profile.replaceAll("_", "-")}`, mapping_profile: profile });
  assert([generatedManifest, finalizedManifest].every((manifest) => !manifest.files.some((file) => file.artifact_ref === manifest.verification_metadata.signing_input_ref || file.artifact_ref === manifest.verification_metadata.manifest_signature_ref)), "payload manifests exclude circular signing attachments");
  assertHasError(protocol, schemaIds[2], { ...generatedManifest, files: [] }, "min_items");
  assertHasError(protocol, schemaIds[3], { ...portal, documents: portal.documents.slice(1) }, "min_items");
  assertHasError(protocol, schemaIds[4], { ...finalization, customer_actor: { actor_type: "vendor_service", actor_id: "vendor:svc" } }, "const");
  assertHasError(protocol, schemaIds[5], { ...metric, metrics: { ...metric.metrics, review_hours: Number.POSITIVE_INFINITY } }, "type");
  assertHasError(protocol, schemaIds[6], { ...feedback, usefulness_rating: Number.MAX_SAFE_INTEGER + 1 }, "type");
  assertHasError(protocol, schemaIds[7], { ...generatedSigningInput, signed_identity_type: "untyped_identity" }, "enum");
  assertHasError(protocol, schemaIds[8], { ...generatedSignature, signature_bytes: "synthetic:untyped" }, "pattern");

  assert(generatedSigningInput.signing_input_type === "static_bundle_manifest_identity" && generatedSigningInput.signed_identity_type === "static_bundle_manifest" && generatedSigningInput.identity_input_path === "v0/valid/static-bundle-manifest.identity-input.json", "generated signing input binds type and path");
  assert(finalizedSigningInput.identity_input_path === "v0/valid/static-bundle-manifest.finalized.identity-input.json" && finalizedSigningInput.signed_identity === finalizedManifest.static_bundle_manifest_id, "finalized signing input binds finalized manifest path");
  assert(finalizationSigningInput.identity_input_path === "v0/valid/attestation-package-finalization.identity-input.json" && finalizationSigningInput.signed_identity === `sha256:${finalization.attestation_package_finalization_id.slice("attestation_finalization:".length)}`, "finalization signing input binds finalization record path");
  assert([generatedSignature, finalizedSignature, finalizationSignature].every((signature) => /^ml_dsa_65:[A-Za-z0-9_-]{4412}$/u.test(signature.signature_bytes) && signature.signing_mode === "managed_key" && signature.signing_limitations.some((entry) => entry.includes("SYNTHETIC_DEMO_DATA")) && signature.signing_limitations.some((entry) => entry.toLowerCase().includes("custody"))), "Epic 5 signatures are real ML-DSA-65 signatures with synthetic-data and custody limitations");

  assert(new Set(portal.navigation.map((entry) => entry.section_id)).size === 8 && portal.documents.length === 8 && portal.navigation.every((entry) => portal.documents.some((document) => document.section_id === entry.section_id && document.relative_path === entry.relative_path)), "portal navigation and documents are complete");
  assert(metric.metrics.actionable_classification_count <= metric.metrics.classified_finding_count && metric.metrics.classified_finding_count <= metric.metrics.candidate_finding_count, "pilot yield counts are ordered");
  assert(new Set(feedback.mapping_feedback.map((entry) => entry.mapping_profile)).size === feedback.mapping_feedback.length && new Set(feedback.objection_codes).size === feedback.objection_codes.length, "pilot feedback codes are unique");
  assert(protocol.attestationClaimUnsafePhrase("SOC-2 accepted for this control") === "soc 2 accepted", "Attestation claim profile blocks normalized acceptance claims");
  assert(protocol.isAttestationClaimSafe("Useful supporting evidence for the consumer's review context") === true, "bounded supporting-evidence wording remains allowed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts Epic 5 protocol tests passed.");

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(signingRoot, name), "utf8")); }
function assertNoErrors(protocol, schema, value) { const errors = protocol.validateProtocolSchema(schema, value); assert(errors.length === 0, `${schema} must validate: ${JSON.stringify(errors)}`); }
function assertHasError(protocol, schema, value, code) { const errors = protocol.validateProtocolSchema(schema, value); assert(errors.some((error) => error.code === code), `${schema} must report ${code}: ${JSON.stringify(errors)}`); }
function assert(condition, message) { if (!condition) throw new Error(message); }
