import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importCompiled } from "./compile.mjs";
import { MANAGED_KEY_LIMITATIONS, createTestSigningKey, realSignatureEnvelope, verifiedOutcome } from "../../../protocol-ts/test/helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0", "valid");

// D2-8: extracted from packages/static-bundle/test/epic-5-static-bundle.test.mjs
// so a second test (the prepare/complete signing split) can reuse the same
// passing generation input without duplicating its fixture-assembly logic.
const bundle = await importCompiled("src/index.js");
const testSigningKey = createTestSigningKey({ key_id: "codeattest-static-bundle-test-key", key_version: "v1" });
export const staticBundleSigningKey = { key_id: testSigningKey.key_id, key_version: testSigningKey.key_version, signing_mode: "managed_key", signing_limitations: [...MANAGED_KEY_LIMITATIONS] };

const [
  mappingRecord,
  attestation,
  generatedManifestFixture,
  generatedSigningInput,
  generatedSignature,
  receipt,
  evidenceBundleManifest,
  evidenceBundleIdentity,
  evidenceBundleSignature,
  disclosurePolicy,
  customerApproval
] = await Promise.all([
  fixture("supporting-evidence-mapping.soc2.json"),
  fixture("security-review-attestation.json"),
  fixture("static-bundle-manifest.generated.json"),
  signingFixture("static-bundle-manifest-identity.json"),
  fixture("signature-envelope.static-bundle.json"),
  fixture("vendor-receipt.json"),
  fixture("bundle-manifest.json"),
  signingFixture("bundle-manifest-identity.json"),
  fixture("signature-envelope.bundle.json"),
  fixture("disclosure-policy.json"),
  fixture("customer-approval.approved.json")
]);

const portalInput = portalFixture(mappingRecord, attestation, generatedManifestFixture, generatedSigningInput, generatedSignature);
const portal = bundle.generateStaticPortal(portalInput);
if (portal === null) throw new Error("test setup: static bundle fixture portal generation failed");

const files = [
  generatedPortalFile(portal.assets[0], "artifact_ref:portal_html", "portal"),
  generatedPortalFile(portal.assets[1], "artifact_ref:portal_css", "portal_asset"),
  generatedPortalFile(portal.assets[2], "artifact_ref:portal_js", "portal_asset"),
  generatedJson(bundle, "attestation.json", "attestation", "artifact_ref:security_review_attestation", attestation),
  generatedJson(bundle, "evidence-bundle-representation.json", "evidence_bundle_representation", "artifact_ref:evidence_bundle_representation", evidenceRepresentation(evidenceBundleManifest.evidence_bundle_id)),
  generatedJson(bundle, "vendor-receipt.json", "vendor_receipt", "artifact_ref:vendor_receipt", receipt),
  generatedJson(bundle, "evidence/bundle-manifest.json", "supporting_evidence", "artifact_ref:bundle_manifest", evidenceBundleManifest),
  generatedJson(bundle, "evidence/bundle-signature.json", "supporting_evidence", "artifact_ref:bundle_signature", evidenceBundleSignature),
  generatedJson(bundle, "evidence/bundle-identity.json", "supporting_evidence", "artifact_ref:bundle_identity", evidenceBundleIdentity),
  generatedText(bundle, "VERIFY.txt", "verification_metadata", "artifact_ref:verification_instructions", "Verify all SHA-256 file digests against this package's canonical manifest before evaluating this synthetic demo package.")
];

const cachedInput = generationFixture(files, attestation.attestation_id, receipt.vendor_receipt_id, evidenceBundleManifest.evidence_bundle_id, disclosurePolicy, customerApproval);

// Shared across every static-bundle test that needs a passing
// `StaticBundleGenerationInput` -- a fresh deep clone per call so no test's
// mutations leak into another's.
export function passingGenerationInput() {
  return structuredClone(cachedInput);
}

// D3-2: the two signatures this pure module can never verify itself -- the
// Evidence Bundle's and the Vendor Receipt's, both embedded as payload files
// of the generated package. The committed fixtures now carry real ML-DSA-65
// signatures, so the outcomes are derived from those envelopes directly.
export function passingVerificationOutcomes() {
  return { evidence_bundle_signature: verifiedOutcome(evidenceBundleSignature), vendor_receipt_signature: verifiedOutcome(receipt.receipt_signature) };
}

// D3-2: the module hands a signing *request* to an external signer and gets an
// envelope back. Tests play that signer with a per-run ML-DSA-65 key whose
// key_id/key_version match the declaration in `passingGenerationInput()`.
export function signStaticBundleRequest(signingRequest) {
  return realSignatureEnvelope({ signing_input: signingRequest.signing_input, key: testSigningKey, signing_time: signingRequest.signing_time, signing_mode: signingRequest.signing_mode, signing_limitations: signingRequest.signing_limitations });
}

async function fixture(name) { return JSON.parse(await readFile(path.join(fixtureRoot, name), "utf8")); }
async function signingFixture(name) { return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "signing-inputs", name), "utf8")); }

function portalFixture(mappingRecord, attestation, manifest, signingInput, signature) {
  const sectionIds = ["overview", "scope", "receipt-chain", "methods", "findings", "validation-remediation", "limitations", "appendices"];
  return { protocol_version: "codeattest.v0", portal_id: "static_portal:synthetic_001", title: "Synthetic Security Review Evidence Packet", review_id: attestation.review_id, selected_application: "Synthetic payments API", selected_commit: attestation.selected_commit.commit_sha, attestation_id: attestation.attestation_id, static_bundle_id: manifest.static_bundle_id, static_bundle_manifest_id: manifest.static_bundle_manifest_id, package_state: manifest.package_state, vendor_receipt_id: manifest.vendor_receipt_ref, verification_status: "verified_offline", canonicalization: "rfc8785", signature_profile: "ml_dsa_65", signing_key_id: signature.key_id, signing_key_version: signature.key_version, signing_time: signature.signing_time, signing_input: signingInput, signing_limitations: [...signature.signing_limitations], sections: sectionIds.map((id) => ({ id, title: id.replaceAll("-", " "), summary: `Recorded ${id.replaceAll("-", " ")} information for the selected review scope.`, body: ["This section presents bounded supporting evidence and its recorded limitations."], details: [{ label: "Attestation reference", value: attestation.attestation_id, copyable: true }] })), findings: [{ finding_ref: "review_finding_draft:demo", title: "Synthetic authorization review finding", classification: "confirmed", evidence_basis: "Submitted retained metadata and reviewer criteria.", limitation: "The finding remains bounded to submitted evidence.", validation_path: "Customer executes the recorded validation path.", remediation_status: "validation pending", artifact_refs: ["artifact_ref:finding"] }], mappings: [mappingRecord], manifest, attestation };
}

function generationFixture(files, attestationRef, receiptRef, evidenceBundleId, disclosurePolicy, customerApproval) { return { protocol_version: "codeattest.v0", static_bundle_id: "static_bundle:synthetic_001", review_id: "review:synthetic-demo-001", attestation_ref: attestationRef, vendor_receipt_ref: receiptRef, evidence_bundle_representation: evidenceRepresentation(evidenceBundleId), portal_projection_ref: "static_portal_projection:synthetic_001", manifest_version: 1, created_at: "2026-08-01T12:00:00Z", actor: { actor_type: "vendor_service", actor_id: "vendor_service:static_generator" }, event: { sequence_number: 20 }, files, minimization_disposition: { included_retained_refs: files.map((file) => file.artifact_ref), excluded_refs: ["artifact_ref:internal_pilot_feedback"], deleted_refs: ["deletion_evidence:synthetic"], never_collected_refs: ["artifact_ref:full_source"] }, deletion_records: [{ protocol_version: "codeattest.v0", deletion_evidence_id: "deletion_evidence:synthetic", deleted_artifact_digests: [digest("9")], deletion_method: "crypto_erase", deletion_timestamp: "2026-08-01T11:00:00Z", actor: { actor_type: "vendor_service", actor_id: "vendor_service:retention" }, verification_status: "verified" }], verification_metadata: { manifest_signature_ref: "artifact_ref:static_bundle_signature", signing_input_ref: "artifact_ref:static_bundle_signing_input", verification_instructions_path: "VERIFY.txt", offline_verification_supported: true, all_file_digests_verified: true }, signing_key: staticBundleSigningKey, disclosure_policy: disclosurePolicy, customer_approval: customerApproval }; }

function evidenceRepresentation(evidenceBundleId) { return { evidence_bundle_id: evidenceBundleId, bundle_manifest_ref: "artifact_ref:bundle_manifest", signature_ref: "artifact_ref:bundle_signature", identity_ref: "artifact_ref:bundle_identity", retained_export_approved_payload_refs: [] }; }
function generatedPortalFile(asset, artifactRef, artifactRole) { return { relative_path: asset.path, artifact_role: artifactRole, media_type: asset.media_type, artifact_ref: artifactRef, source_derived_class: "retained_review_artifact", export_approved: true, inclusion_reason: "Generated offline portal asset.", content: asset.content, digest: asset.digest, size_bytes: asset.size_bytes }; }
function generatedJson(bundle, pathName, artifactRole, artifactRef, value) { return generatedText(bundle, pathName, artifactRole, artifactRef, bundle.canonicalizeStaticBundleJson(value), "application/json"); }
function generatedText(bundle, pathName, artifactRole, artifactRef, content, mediaType = "text/plain") { return { relative_path: pathName, artifact_role: artifactRole, media_type: mediaType, artifact_ref: artifactRef, source_derived_class: "retained_review_artifact", export_approved: true, inclusion_reason: "Canonical retained protocol artifact.", content, digest: bundle.sha256Text(content), size_bytes: new TextEncoder().encode(content).length }; }
function digest(char) { return `sha256:${char.repeat(64)}`; }
