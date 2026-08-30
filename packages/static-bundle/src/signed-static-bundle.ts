import { canonicalizeProtocolJson, recomputeExcludedFieldsIdentity, sha256ProtocolText } from "../../protocol-ts/src/index.js";
import { sourceTextForbiddenPhrase } from "../../protocol-ts/src/index.js";
import type {
  AttestationPackageFinalization,
  CustomerApproval,
  DeletionEvidence,
  DisclosurePolicy,
  ReviewEvent,
  SignatureEnvelope,
  SignatureVerificationOutcome,
  StaticBundleManifest as ProtocolStaticBundleManifest,
  StaticPortalProjection,
  SecurityReviewAttestation,
  VendorReceipt
} from "../../protocol-ts/src/index.js";
import {
  createIdentitySigningInput,
  signatureEnvelopeMatchesExpectation,
  signatureOutcomeCovers
} from "../../protocol-ts/src/index.js";
import type { IdentitySigningInput } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import { verifyVendorReceiptRecordSync } from "../../protocol-ts/src/index.js";
import { customerApprovalSemanticIssues, disclosurePolicySemanticIssues } from "../../protocol-ts/src/index.js";
import { generateStaticPortal } from "./static-portal.js";
import type { StaticPortalInput, StaticPortalPackage } from "./static-portal.js";

type ManifestFile = ProtocolStaticBundleManifest["files"][number];
type MinimizationDisposition = ProtocolStaticBundleManifest["minimization_disposition"];
type EvidenceBundleRepresentation = ProtocolStaticBundleManifest["evidence_bundle_representation"];

export type StaticBundleFileInput = ManifestFile & {
  artifact_ref: string;
  export_approved: true;
  content: string;
};

export type StaticBundleGenerationInput = {
  protocol_version: "codeattest.v0";
  static_bundle_id: string;
  review_id: string;
  attestation_ref: string;
  vendor_receipt_ref: string;
  evidence_bundle_representation: EvidenceBundleRepresentation;
  portal_projection_ref: string;
  manifest_version: number;
  created_at: string;
  actor: { actor_type: "vendor_service"; actor_id: string };
  event: { sequence_number: number };
  files: StaticBundleFileInput[];
  minimization_disposition: MinimizationDisposition;
  deletion_records: DeletionEvidence[];
  verification_metadata: ProtocolStaticBundleManifest["verification_metadata"];
  signing_key: StaticBundleSigningKey;
  // C6-23: file admission previously trusted a bare per-file caller assertion
  // (`export_approved: true`) with no upstream record backing it. A verified,
  // content-addressed Disclosure Policy plus the customer approval that
  // actually accepted it are now required and cross-bound.
  disclosure_policy: DisclosurePolicy;
  customer_approval: CustomerApproval;
};

// D3-2: signing happens outside this pure module, so the "signing key" it is
// given is a declaration of who will sign and under which stated limits, and
// the request it hands the signer carries exactly that.
export type StaticBundleSigningKey = {
  key_id: string;
  key_version: string;
  signing_mode: SignatureEnvelope["signing_mode"];
  signing_limitations: [string, ...string[]];
};
export type StaticBundleSigningRequest = {
  signing_input: IdentitySigningInput;
  key_id: string;
  key_version: string;
  signing_time: string;
  signing_mode: SignatureEnvelope["signing_mode"];
  signing_limitations: [string, ...string[]];
};
export type StaticBundleVerificationPackage = {
  protocol_version: "codeattest.v0";
  attachment_index_id: string;
  signed_payload_manifest_id: string;
  signing_input_attachment: { relative_path: "verification/static-bundle-signing-input.json"; artifact_ref: "artifact_ref:static_bundle_signing_input"; media_type: "application/json"; digest: string; size_bytes: number; signing_input: StaticBundleSigningRequest["signing_input"] };
  signature_attachment: { relative_path: "verification/static-bundle-signature.json"; artifact_ref: "artifact_ref:static_bundle_signature"; media_type: "application/json"; digest: string; size_bytes: number; signature_envelope: SignatureEnvelope };
  canonicalization: "rfc8785";
  identity_hash_algorithm: "sha256";
  identity_input_excludes: ["attachment_index_id"];
};

export type StaticBundleFailureCode = "invalid_input" | "required_artifact_missing" | "unverifiable_file" | "digest_mismatch" | "unsafe_path" | "unapproved_export" | "deleted_content_reintroduced" | "portal_incomplete";

// D2-1: host-computed verification outcomes for the signatures this pure
// module's producers encounter but can never verify themselves -- the static
// bundle manifest's own outer signature, the Evidence Bundle's signature
// embedded as one of the manifest's payload files, and (D3-2) the Vendor
// Receipt's own signature, which `verifyVendorReceiptRecordSync` now requires
// because no synthetic form remains for it to recompute.
export type StaticBundleVerificationOutcomes = {
  manifest_signature?: SignatureVerificationOutcome;
  evidence_bundle_signature?: SignatureVerificationOutcome;
  vendor_receipt_signature?: SignatureVerificationOutcome;
};
export type SignedStaticBundleResult =
  | { ok: true; manifest: ProtocolStaticBundleManifest; canonical_manifest: string; signing_request: StaticBundleSigningRequest; signature_envelope: SignatureEnvelope; verification_package: StaticBundleVerificationPackage; generated_event: ReviewEvent }
  | { ok: false; code: StaticBundleFailureCode; affected_identity: string; next_path: "retry" | "support" | "remediate"; message: string };

// C6-44: the portal content pieces that finalization cannot derive from the
// generated manifest, attestation, or signature -- everything else passed to
// generateStaticPortal (review/attestation/bundle/receipt identity, package
// state, signing metadata) is recomputed from the finalized context itself.
export type StaticBundleFinalizationPortalSource = Pick<StaticPortalInput, "portal_id" | "title" | "selected_application" | "sections" | "findings" | "mappings">;

export type StaticBundleFinalizationInput = {
  finalization_record: AttestationPackageFinalization;
  attestation: SecurityReviewAttestation;
  vendor_receipt: VendorReceipt;
  generated_manifest: ProtocolStaticBundleManifest;
  generated_signing_input: StaticBundleSigningRequest["signing_input"];
  generated_signature: SignatureEnvelope;
  portal_projection: StaticPortalProjection;
  portal_source: StaticBundleFinalizationPortalSource;
  deletion_evidence: DeletionEvidence[];
  signing_key: StaticBundleSigningKey;
  event: { sequence_number: number };
  visible_context_confirmed: true;
};
export type FinalizedStaticBundleResult =
  | { ok: true; finalization_record: AttestationPackageFinalization; manifest: ProtocolStaticBundleManifest; canonical_manifest: string; signing_request: StaticBundleSigningRequest; signature_envelope: SignatureEnvelope; verification_package: StaticBundleVerificationPackage; finalized_event: ReviewEvent; portal_package: StaticPortalPackage }
  | { ok: false; code: "invalid_manifest" | "customer_authority_required" | "visible_context_required" | "invalid_context"; message: string };

// D2-2: real signing happens outside this pure module, so generation is
// split: `prepareSignedStaticBundle` computes the manifest identity and hands
// back exactly what a signer needs; the caller signs; `completeSignedStaticBundle`
// binds the resulting envelope, assembles the verification package and event,
// and re-validates. D3-2 removed the one-call `generateSignedStaticBundle`
// wrapper: it could only exist while this module could sign for itself.
export type PreparedSignedStaticBundle =
  | { ok: true; manifest: ProtocolStaticBundleManifest; signing_request: StaticBundleSigningRequest; actor: StaticBundleGenerationInput["actor"]; event: StaticBundleGenerationInput["event"] }
  | Extract<SignedStaticBundleResult, { ok: false }>;

// D2-1: the manifest/signing-request identity computed here never depends on
// whether any signature -- the static bundle manifest's own, or the Evidence
// Bundle's -- is trusted; only the per-file content check below (for the
// Evidence Bundle's *own* signature, embedded as one of the manifest's
// payload files) needs a verification outcome, since this pure module holds
// no key material and cannot verify a real signature's bytes itself.
export function prepareSignedStaticBundle(rawInput: StaticBundleGenerationInput | unknown, outcomes?: StaticBundleVerificationOutcomes): PreparedSignedStaticBundle {
  const validated = validateGenerationInput(rawInput, outcomes);
  if (validated.ok === false) return validated.failure;
  const input = validated.input;
  const files = [...input.files]
    .sort((left, right) => left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0)
    .map((file): ManifestFile => ({
      relative_path: file.relative_path,
      artifact_ref: file.artifact_ref,
      media_type: file.media_type,
      digest: file.digest,
      size_bytes: file.size_bytes,
      artifact_role: file.artifact_role,
      source_derived_class: file.source_derived_class,
      inclusion_reason: file.inclusion_reason
    })) as ProtocolStaticBundleManifest["files"];
  const identityDocument: Omit<ProtocolStaticBundleManifest, "static_bundle_manifest_id"> = {
    protocol_version: input.protocol_version,
    static_bundle_id: input.static_bundle_id,
    manifest_version: input.manifest_version,
    package_state: "generated",
    review_id: input.review_id,
    created_at: input.created_at,
    attestation_ref: input.attestation_ref,
    vendor_receipt_ref: input.vendor_receipt_ref,
    evidence_bundle_representation: cloneRepresentation(input.evidence_bundle_representation),
    portal_projection_ref: input.portal_projection_ref,
    files,
    minimization_disposition: cloneMinimization(input.minimization_disposition),
    verification_metadata: { ...input.verification_metadata },
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["static_bundle_manifest_id"]
  };
  const manifestId = sha256Text(canonicalizeStaticBundleJson(identityDocument));
  const manifest: ProtocolStaticBundleManifest = { ...identityDocument, static_bundle_manifest_id: manifestId };
  const signingRequest = createStaticBundleSigningRequest(manifest, input.created_at, input.signing_key);
  return { ok: true, manifest, signing_request: signingRequest, actor: input.actor, event: input.event };
}

export function completeSignedStaticBundle(prepared: Extract<PreparedSignedStaticBundle, { ok: true }>, signatureEnvelope: SignatureEnvelope): SignedStaticBundleResult {
  if (signatureEnvelope.signed_identity !== prepared.manifest.static_bundle_manifest_id || signatureEnvelope.signed_identity_type !== "static_bundle_manifest") {
    return failure("unverifiable_file", prepared.manifest.static_bundle_manifest_id, "The supplied signature is not bound to this manifest identity.");
  }
  const manifest = prepared.manifest;
  const signingRequest = prepared.signing_request;
  const verificationPackage = createVerificationPackage(manifest.static_bundle_manifest_id, signingRequest, signatureEnvelope);
  const generatedEvent = createBundleEvent(
    "static_bundle_generated",
    manifest.review_id,
    manifest.created_at,
    prepared.actor,
    prepared.event,
    manifest.static_bundle_manifest_id,
    `static_bundle:${manifest.review_id}:${manifest.static_bundle_id}:manifest_version:${manifest.manifest_version}:manifest_id:${manifest.static_bundle_manifest_id.slice("sha256:".length)}`,
    "Static bundle projection generated from retained and export-approved protocol artifacts."
  );
  const validationFailures = [
    ["manifest", validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", manifest)],
    ["signing_input", validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", signingRequest.signing_input)],
    ["signature", validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", signatureEnvelope)],
    ["verification_package", validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-verification-package", verificationPackage)],
    ["event", validateProtocolSchema("urn:codeattest:protocol:v0:review-event", generatedEvent)]
  ] as const;
  const failedMetadata = validationFailures.filter(([, errors]) => errors.length > 0).map(([label, errors]) => `${label}[${errors.map((error) => `${error.code}@${error.location}`).join("|")}]`);
  if (failedMetadata.length > 0) return failure("unverifiable_file", manifest.static_bundle_manifest_id, `Generated protocol metadata failed validation: ${failedMetadata.join(", ")}.`);
  const result: Extract<SignedStaticBundleResult, { ok: true }> = { ok: true, manifest, canonical_manifest: canonicalizeStaticBundleJson(manifest), signing_request: signingRequest, signature_envelope: signatureEnvelope, verification_package: verificationPackage, generated_event: generatedEvent };
  deepFreeze(result);
  return result;
}

export function createStaticBundleSigningRequest(manifest: ProtocolStaticBundleManifest, signingTime: string, signingKey: StaticBundleSigningKey): StaticBundleSigningRequest {
  return {
    signing_input: createIdentitySigningInput({
      protocol_version: "codeattest.v0",
      signing_input_type: "static_bundle_manifest_identity",
      signed_identity_type: "static_bundle_manifest",
      signed_identity: manifest.static_bundle_manifest_id,
      identity_input_path: staticBundleIdentityInputPath(manifest.package_state),
      key_id: signingKey.key_id,
      key_version: signingKey.key_version,
      signing_time: signingTime
    }),
    key_id: signingKey.key_id,
    key_version: signingKey.key_version,
    signing_time: signingTime,
    signing_mode: signingKey.signing_mode,
    signing_limitations: [...signingKey.signing_limitations]
  };
}

export function staticBundleIdentityInputPath(packageState: ProtocolStaticBundleManifest["package_state"]): string {
  return packageState === "finalized" ? "v0/valid/static-bundle-manifest.finalized.identity-input.json" : "v0/valid/static-bundle-manifest.identity-input.json";
}

function createVerificationPackage(manifestId: string, request: StaticBundleSigningRequest, signature: SignatureEnvelope): StaticBundleVerificationPackage {
  const signingContent = canonicalizeStaticBundleJson(request.signing_input);
  const signatureContent = canonicalizeStaticBundleJson(signature);
  const indexInput = {
    protocol_version: "codeattest.v0" as const,
    signed_payload_manifest_id: manifestId,
    signing_input_attachment: { relative_path: "verification/static-bundle-signing-input.json" as const, artifact_ref: "artifact_ref:static_bundle_signing_input" as const, media_type: "application/json" as const, digest: sha256Text(signingContent), size_bytes: new TextEncoder().encode(signingContent).length, signing_input: request.signing_input },
    signature_attachment: { relative_path: "verification/static-bundle-signature.json" as const, artifact_ref: "artifact_ref:static_bundle_signature" as const, media_type: "application/json" as const, digest: sha256Text(signatureContent), size_bytes: new TextEncoder().encode(signatureContent).length, signature_envelope: signature },
    canonicalization: "rfc8785" as const,
    identity_hash_algorithm: "sha256" as const,
    identity_input_excludes: ["attachment_index_id"] as ["attachment_index_id"]
  };
  return { ...indexInput, attachment_index_id: sha256Text(canonicalizeStaticBundleJson(indexInput)) };
}

// D2-2: the same prepare/complete split as generation, applied to
// finalization. The provisional manifest computed midway through (to give
// `generateStaticPortal` a self-consistent finalized-state manifest to render
// against) stays entirely inside `prepareFinalizedStaticBundle` and never
// leaves this module. `completeFinalizedStaticBundle` binds the
// caller-supplied signature over the *true* finalized manifest identity
// computed at the end of prepare.
export type PreparedFinalizedStaticBundle =
  | { ok: true; manifest: ProtocolStaticBundleManifest; signing_request: StaticBundleSigningRequest; finalization_record: AttestationPackageFinalization; portal_package: StaticPortalPackage; event: StaticBundleFinalizationInput["event"] }
  | Extract<FinalizedStaticBundleResult, { ok: false }>;

export function prepareFinalizedStaticBundle(rawInput: StaticBundleFinalizationInput | unknown, outcomes?: StaticBundleVerificationOutcomes): PreparedFinalizedStaticBundle {
  if (!isRecord(rawInput) || rawInput.visible_context_confirmed !== true) return { ok: false, code: "visible_context_required", message: "Visible sharing context must be confirmed before finalization." };
  const input = rawInput as unknown as StaticBundleFinalizationInput;
  const record = input.finalization_record;
  if (!isRecord(record) || !isRecord(record.customer_actor) || record.customer_actor.actor_type !== "customer_user" || !meaningful(record.customer_actor.actor_id)) return { ok: false, code: "customer_authority_required", message: "Only the recorded customer user can finalize the static package." };
  if (!finalizationContextIsValid(input, outcomes)) return { ok: false, code: "invalid_context", message: "Finalization requires a verified generated package, receipt, Attestation, deletion, portal, and signature context." };
  const generated = input.generated_manifest;
  const baseDocument: Omit<ProtocolStaticBundleManifest, "static_bundle_manifest_id"> = {
    protocol_version: generated.protocol_version,
    static_bundle_id: generated.static_bundle_id,
    manifest_version: generated.manifest_version + 1,
    package_state: "finalized",
    review_id: generated.review_id,
    created_at: record.finalized_at,
    supersedes_static_bundle_manifest_id: generated.static_bundle_manifest_id,
    attestation_ref: generated.attestation_ref,
    vendor_receipt_ref: generated.vendor_receipt_ref,
    evidence_bundle_representation: cloneRepresentation(generated.evidence_bundle_representation),
    portal_projection_ref: generated.portal_projection_ref,
    files: generated.files.map((file) => ({ ...file })) as ProtocolStaticBundleManifest["files"],
    minimization_disposition: cloneMinimization(generated.minimization_disposition),
    verification_metadata: { ...generated.verification_metadata },
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["static_bundle_manifest_id"]
  };
  // C6-44: the portal's rendered HTML/CSS/JS bake in the manifest identity,
  // package state, and signing metadata they describe -- reusing the
  // *generated* package's stale portal bytes here (as the old identity
  // document did, unconditionally) would ship a "finalized" package whose own
  // offline portal still describes itself as generated, under the superseded
  // manifest identity. A provisional finalized manifest (still carrying the
  // stale portal files) gives generateStaticPortal a self-consistent,
  // signature-verifiable manifest to render finalized-state portal bytes
  // against; those fresh bytes are then swapped in before the true finalized
  // identity below is computed and signed. (The provisional identity ends up
  // baked into the rendered HTML text rather than the true final one -- the
  // same limitation already accepted for the *generated* portal, which is
  // rendered against a manifest object distinct from the one the generation
  // step ultimately signs.)
  const provisionalManifestId = sha256Text(canonicalizeStaticBundleJson(baseDocument));
  const provisionalManifest: ProtocolStaticBundleManifest = { ...baseDocument, static_bundle_manifest_id: provisionalManifestId };
  const provisionalSigningRequest = createStaticBundleSigningRequest(provisionalManifest, record.finalized_at, input.signing_key);
  const portalPackage = generateStaticPortal({
    protocol_version: "codeattest.v0",
    portal_id: input.portal_source.portal_id,
    title: input.portal_source.title,
    review_id: provisionalManifest.review_id,
    selected_application: input.portal_source.selected_application,
    selected_commit: input.attestation.selected_commit.commit_sha,
    attestation_id: provisionalManifest.attestation_ref,
    static_bundle_id: provisionalManifest.static_bundle_id,
    static_bundle_manifest_id: provisionalManifestId,
    package_state: "finalized",
    vendor_receipt_id: provisionalManifest.vendor_receipt_ref,
    verification_status: "verified_offline",
    canonicalization: "rfc8785",
    signature_profile: "ml_dsa_65",
    signing_key_id: input.signing_key.key_id,
    signing_key_version: input.signing_key.key_version,
    signing_time: record.finalized_at,
    signing_input: provisionalSigningRequest.signing_input,
    signing_limitations: [...provisionalSigningRequest.signing_limitations],
    sections: input.portal_source.sections,
    findings: input.portal_source.findings,
    mappings: input.portal_source.mappings,
    manifest: provisionalManifest,
    attestation: input.attestation
  });
  if (portalPackage === null) return { ok: false, code: "invalid_manifest", message: "Finalized portal projection failed to render or verify against the provisional finalized manifest." };
  const assetByPath = new Map(portalPackage.assets.map((asset) => [asset.path, asset]));
  const identityDocument: Omit<ProtocolStaticBundleManifest, "static_bundle_manifest_id"> = {
    ...baseDocument,
    files: baseDocument.files.map((file) => {
      const asset = assetByPath.get(file.relative_path);
      return asset === undefined ? file : { ...file, digest: asset.digest, size_bytes: asset.size_bytes };
    }) as ProtocolStaticBundleManifest["files"]
  };
  const manifestId = sha256Text(canonicalizeStaticBundleJson(identityDocument));
  const finalizedManifest: ProtocolStaticBundleManifest = { ...identityDocument, static_bundle_manifest_id: manifestId };
  if (record.finalized_manifest_ref !== manifestId || record.finalized_manifest_version !== finalizedManifest.manifest_version) return { ok: false, code: "invalid_manifest", message: "Finalization record does not bind the derived finalized manifest identity and version." };
  const signingRequest = createStaticBundleSigningRequest(finalizedManifest, record.finalized_at, input.signing_key);
  return { ok: true, manifest: finalizedManifest, signing_request: signingRequest, finalization_record: cloneJsonValue(record), portal_package: portalPackage, event: input.event };
}

export function completeFinalizedStaticBundle(prepared: Extract<PreparedFinalizedStaticBundle, { ok: true }>, signatureEnvelope: SignatureEnvelope): FinalizedStaticBundleResult {
  if (signatureEnvelope.signed_identity !== prepared.manifest.static_bundle_manifest_id || signatureEnvelope.signed_identity_type !== "static_bundle_manifest") {
    return { ok: false, code: "invalid_manifest", message: "The supplied signature is not bound to this manifest identity." };
  }
  const finalizedManifest = prepared.manifest;
  const manifestId = finalizedManifest.static_bundle_manifest_id;
  const signingRequest = prepared.signing_request;
  const record = prepared.finalization_record;
  const verificationPackage = createVerificationPackage(manifestId, signingRequest, signatureEnvelope);
  const finalizedEvent = createBundleEvent(
    "attestation_package_finalized",
    finalizedManifest.review_id,
    record.finalized_at,
    record.customer_actor,
    prepared.event,
    manifestId,
    `attestation_package_finalized:${record.review_id}:${record.static_bundle_id}:finalization_version:${record.finalization_version}:record_id:${record.attestation_package_finalization_id.slice("attestation_finalization:".length)}:generated_manifest_id:${record.generated_manifest_ref.slice("sha256:".length)}:manifest_id:${manifestId.slice("sha256:".length)}`,
    "Customer finalized a new signed static bundle manifest version."
  );
  // D3-2: the supplied envelope's *bytes* are verified downstream against a
  // host-computed `SignatureVerificationOutcome` (D2-1); this pure module,
  // holding no key material, checks that the envelope is the one this
  // preparation asked for -- same signing input, identity, key and time.
  if (
    validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", finalizedManifest).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:review-event", finalizedEvent).length > 0 ||
    !signatureEnvelopeMatchesExpectation(signingRequest.signing_input, signatureEnvelope, { protocol_version: "codeattest.v0", signing_input_type: "static_bundle_manifest_identity", signed_identity_type: "static_bundle_manifest", signed_identity: manifestId, identity_input_path: staticBundleIdentityInputPath("finalized"), key_id: signingRequest.key_id, key_version: signingRequest.key_version, signing_time: record.finalized_at })
  ) return { ok: false, code: "invalid_manifest", message: "Derived finalized manifest, signature, or event failed protocol verification." };
  const result: Extract<FinalizedStaticBundleResult, { ok: true }> = { ok: true, finalization_record: record, manifest: finalizedManifest, canonical_manifest: canonicalizeStaticBundleJson(finalizedManifest), signing_request: signingRequest, signature_envelope: signatureEnvelope, verification_package: verificationPackage, finalized_event: finalizedEvent, portal_package: prepared.portal_package };
  deepFreeze(result);
  return result;
}

export function projectFinalizedStaticBundle(input: { finalization_record: AttestationPackageFinalization; manifest: ProtocolStaticBundleManifest; signing_input: StaticBundleSigningRequest["signing_input"]; signature: SignatureEnvelope } | unknown, manifestSignatureOutcome?: SignatureVerificationOutcome): { staticBundleId: string; manifestId: string; manifestVersion: number; finalizedAt: string; attestationId: string; receiptId: string; verificationState: "verified_offline"; customerControlAfterExport: string } | null {
  if (!isRecord(input) || !isRecord(input.finalization_record) || !isProtocolManifest(input.manifest) || !isRecord(input.signing_input) || !isRecord(input.signature)) return null;
  const record = input.finalization_record as unknown as AttestationPackageFinalization;
  const manifest = input.manifest;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:attestation-package-finalization", record).length > 0 || manifest.package_state !== "finalized" || recomputeManifestId(manifest) !== manifest.static_bundle_manifest_id || record.finalized_manifest_ref !== manifest.static_bundle_manifest_id || record.finalized_manifest_version !== manifest.manifest_version || record.finalized_at !== manifest.created_at || record.static_bundle_id !== manifest.static_bundle_id || recomputeExcludedFieldsIdentity(record, ["attestation_package_finalization_id", "export_state", "exported_at"], "attestation_finalization") !== record.attestation_package_finalization_id) return null;
  if (!signatureEnvelopeMatchesExpectation(input.signing_input, input.signature, { protocol_version: "codeattest.v0", signing_input_type: "static_bundle_manifest_identity", signed_identity_type: "static_bundle_manifest", signed_identity: manifest.static_bundle_manifest_id, identity_input_path: staticBundleIdentityInputPath("finalized"), key_id: String(input.signature.key_id), key_version: String(input.signature.key_version), signing_time: manifest.created_at })) return null;
  // D3-2: the envelope's bytes are authenticated by the caller-supplied
  // outcome, bound field-by-field to that same envelope.
  if (!signatureOutcomeCovers(input.signature as unknown as SignatureEnvelope, manifestSignatureOutcome)) return null;
  // C6-44: this used to hardcode `true` unconditionally instead of reading
  // the record's own field. `customer_control_after_export` is protocol-
  // required disclaimer prose, not a boolean, and the finalization record is
  // already schema-validated above by this point -- pass its actual text
  // through rather than asserting a fixed claim independent of record state.
  const projection = { staticBundleId: manifest.static_bundle_id, manifestId: manifest.static_bundle_manifest_id, manifestVersion: manifest.manifest_version, finalizedAt: manifest.created_at, attestationId: manifest.attestation_ref, receiptId: manifest.vendor_receipt_ref, verificationState: "verified_offline" as const, customerControlAfterExport: record.customer_control_after_export };
  deepFreeze(projection);
  return projection;
}

function finalizationContextIsValid(input: StaticBundleFinalizationInput, outcomes: StaticBundleVerificationOutcomes | undefined): boolean {
  const record = input.finalization_record;
  const generated = input.generated_manifest;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:attestation-package-finalization", record).length > 0 || validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", input.attestation).length > 0 || validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", input.vendor_receipt).length > 0 || !isProtocolManifest(generated) || generated.package_state !== "generated" || recomputeManifestId(generated) !== generated.static_bundle_manifest_id || validateProtocolSchema("urn:codeattest:protocol:v0:static-portal-projection", input.portal_projection).length > 0 || !Array.isArray(input.deletion_evidence) || input.deletion_evidence.some((item) => validateProtocolSchema("urn:codeattest:protocol:v0:deletion-evidence", item).length > 0)) return false;
  // C6-24: finalization schema-checked the Attestation/receipt but never
  // recomputed their content identities or re-verified the receipt's own
  // signature -- only the finalization record's own *claim* that those
  // states were "verified" was trusted.
  if (recomputeExcludedFieldsIdentity(input.attestation, ["attestation_id"], "attestation") !== input.attestation.attestation_id) return false;
  if (outcomes?.vendor_receipt_signature === undefined || verifyVendorReceiptRecordSync(input.vendor_receipt, { signature_verification_outcome: outcomes.vendor_receipt_signature }).state !== "receipt_verified") return false;
  if (record.review_id !== generated.review_id || record.review_id !== input.attestation.review_id || record.static_bundle_id !== generated.static_bundle_id || record.generated_manifest_ref !== generated.static_bundle_manifest_id || record.visible_context.attestation_id !== input.attestation.attestation_id || record.visible_context.static_bundle_id !== generated.static_bundle_id || record.visible_context.generated_manifest_id !== generated.static_bundle_manifest_id || generated.attestation_ref !== input.attestation.attestation_id || generated.vendor_receipt_ref !== input.vendor_receipt.vendor_receipt_id) return false;
  if (!record.visible_context.limitations_visible || !record.visible_context.receipt_context_visible || !record.visible_context.export_consequence_visible || record.receipt_verification_state !== "verified" || record.signature_verification_state !== "verified" || record.deletion_evidence_state !== "resolved" || record.portal_verification_state !== "verified_offline") return false;
  if (input.portal_projection.review_id !== record.review_id || input.portal_projection.static_bundle_id !== generated.static_bundle_id || input.portal_projection.static_bundle_manifest_ref !== generated.static_bundle_manifest_id || generated.portal_projection_ref !== input.portal_projection.static_portal_projection_id || !input.portal_projection.customer_safe_projection) return false;
  if (input.attestation.deletion_evidence_refs.some((ref) => !input.deletion_evidence.some((item) => item.deletion_evidence_id === ref && item.verification_status === "verified"))) return false;
  if (!signatureEnvelopeMatchesExpectation(input.generated_signing_input, input.generated_signature, { protocol_version: "codeattest.v0", signing_input_type: "static_bundle_manifest_identity", signed_identity_type: "static_bundle_manifest", signed_identity: generated.static_bundle_manifest_id, identity_input_path: staticBundleIdentityInputPath("generated"), key_id: input.signing_key.key_id, key_version: input.signing_key.key_version, signing_time: generated.created_at })) return false;
  if (!signatureOutcomeCovers(input.generated_signature, outcomes?.manifest_signature)) return false;
  const generatedAt = Date.parse(generated.created_at); const finalizedAt = Date.parse(record.finalized_at); const exportedAt = record.exported_at === undefined ? undefined : Date.parse(record.exported_at); const prerequisiteTimes = [input.attestation.generated_at, input.vendor_receipt.receipt_timestamp, input.portal_projection.generated_at, ...input.deletion_evidence.map((item) => item.deletion_timestamp)].map(Date.parse);
  return Number.isFinite(generatedAt) && Number.isFinite(finalizedAt) && prerequisiteTimes.every((time) => Number.isFinite(time) && time <= finalizedAt) && finalizedAt >= generatedAt && (exportedAt === undefined || exportedAt >= finalizedAt) && Number.isSafeInteger(generated.manifest_version + 1) && record.finalized_manifest_version === generated.manifest_version + 1 && recomputeExcludedFieldsIdentity(record, ["attestation_package_finalization_id", "export_state", "exported_at"], "attestation_finalization") === record.attestation_package_finalization_id;
}

function cloneJsonValue<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function canonicalizeStaticBundleJson(value: unknown): string {
  return canonicalizeProtocolJson(value);
}

export function sha256Text(value: string): string {
  return sha256ProtocolText(value);
}

function validateGenerationInput(input: unknown, outcomes: StaticBundleVerificationOutcomes | undefined): { ok: true; input: StaticBundleGenerationInput } | { ok: false; failure: Extract<SignedStaticBundleResult, { ok: false }> } {
  const reject = (code: StaticBundleFailureCode, identity: string, message: string): { ok: false; failure: Extract<SignedStaticBundleResult, { ok: false }> } => ({ ok: false, failure: failure(code, identity, message) });
  try { canonicalizeStaticBundleJson(input); } catch { return reject("invalid_input", "static_bundle:unavailable", "Static bundle input must be strict acyclic JSON with finite safe numbers."); }
  if (!isRecord(input) || !hasOnlyKeys(input, ["protocol_version", "static_bundle_id", "review_id", "attestation_ref", "vendor_receipt_ref", "evidence_bundle_representation", "portal_projection_ref", "manifest_version", "created_at", "actor", "event", "files", "minimization_disposition", "deletion_records", "verification_metadata", "signing_key", "disclosure_policy", "customer_approval"]) || input.protocol_version !== "codeattest.v0" || !isRecord(input.actor) || !hasOnlyKeys(input.actor, ["actor_type", "actor_id"]) || input.actor.actor_type !== "vendor_service") return reject("invalid_input", "static_bundle:unavailable", "Static bundle input and vendor-service actor are required.");
  if (!/^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(input.static_bundle_id)) || !/^review:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(input.review_id)) || !/^attestation:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(input.attestation_ref)) || !digest(input.vendor_receipt_ref) || !/^static_portal_projection:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(input.portal_projection_ref)) || !meaningful(input.actor.actor_id) || !Number.isSafeInteger(input.manifest_version) || Number(input.manifest_version) < 1 || !isUtcTimestamp(input.created_at) || !eventMetadataIsSafe(input.event)) return reject("required_artifact_missing", "static_bundle:unavailable", "Required static bundle identities, event sequence, and creation metadata must resolve.");
  if (!isRecord(input.evidence_bundle_representation) || !representationIsSafe(input.evidence_bundle_representation)) return reject("required_artifact_missing", "evidence_bundle:unavailable", "The verifiable Evidence Bundle representation is required.");
  if (!isRecord(input.signing_key) || !meaningful(input.signing_key.key_id) || !meaningful(input.signing_key.key_version)) return reject("unverifiable_file", String(input.attestation_ref), "Signer metadata is required.");
  // C6-23: `file.export_approved: true` used to be a bare per-file caller
  // assertion with no upstream record backing it. A verified, content-
  // addressed Disclosure Policy and the customer approval that actually
  // accepted it -- bound to each other -- are now required, and retained
  // supporting evidence is rejected outright under a metadata-only policy.
  if (!isRecord(input.disclosure_policy) || !disclosurePolicyIsSafe(input.disclosure_policy)) return reject("required_artifact_missing", "disclosure_policy:unavailable", "A verified, content-addressed Disclosure Policy is required.");
  const disclosurePolicy = input.disclosure_policy;
  if (!isRecord(input.customer_approval) || !customerApprovalIsSafe(input.customer_approval, disclosurePolicy)) return reject("required_artifact_missing", "customer_approval:unavailable", "A verified customer approval bound to the Disclosure Policy is required.");
  if (!isDenseArray(input.files) || input.files.length < 6 || input.files.some((file) => !fileInputIsSafe(file))) return reject("unverifiable_file", "file:unavailable", "Every included file requires canonical manifest metadata, verified content, and an export-approved reference.");
  const files = input.files as StaticBundleFileInput[];
  const normalizedPaths = files.map((file) => file.relative_path.normalize("NFKC").toLowerCase());
  if (new Set(normalizedPaths).size !== files.length || files.some((file, index) => file.relative_path !== file.relative_path.normalize("NFKC") || normalizedPaths[index] === undefined) || new Set(files.map((file) => file.artifact_ref)).size !== files.length) return reject("invalid_input", "file:duplicate", "Included file paths must be NFKC-normalized and collision-free, and artifact refs must be unique.");
  for (const file of files) {
    if (!safeRelativePath(file.relative_path)) return reject("unsafe_path", file.artifact_ref, "Static bundle file paths must be safe relative paths.");
    if (file.export_approved !== true) return reject("unapproved_export", file.artifact_ref, "Only export-approved retained files may be included.");
    if (file.artifact_role === "supporting_evidence" && disclosurePolicy.coverage_mode === "metadata_only") return reject("unapproved_export", file.artifact_ref, "Retained supporting evidence cannot be exported under a metadata-only Disclosure Policy.");
    if (file.source_derived_class === "customer_opt_in_retained_source") return reject("deleted_content_reintroduced", file.artifact_ref, "Source-derived payload bytes cannot be reconstructed by static generation.");
    const bytes = new TextEncoder().encode(file.content);
    if (bytes.length !== file.size_bytes || sha256Text(file.content) !== digestString(file.digest)) return reject("digest_mismatch", file.artifact_ref, "Generated file content does not match its declared digest and size.");
  }
  if (!isRecord(input.verification_metadata) || !verificationMetadataIsSafe(input.verification_metadata)) return reject("portal_incomplete", String(input.portal_projection_ref), "Offline verification metadata and instructions are required.");
  const validatedInput = input as unknown as StaticBundleGenerationInput;
  const roles = new Set(files.map((file) => file.artifact_role));
  const fileByPath = new Map(files.map((file) => [file.relative_path, file]));
  const fileRefCounts = new Map<string, number>();
  for (const file of files) fileRefCounts.set(file.artifact_ref, (fileRefCounts.get(file.artifact_ref) ?? 0) + 1);
  const requiredPayloadRefs = [input.evidence_bundle_representation.bundle_manifest_ref, input.evidence_bundle_representation.signature_ref, input.evidence_bundle_representation.identity_ref, ...input.evidence_bundle_representation.retained_export_approved_payload_refs];
  if (!["attestation", "vendor_receipt", "evidence_bundle_representation", "portal", "portal_asset", "verification_metadata"].every((role) => roles.has(role as ManifestFile["artifact_role"])) || fileByPath.get("portal/index.html")?.artifact_role !== "portal" || fileByPath.get("portal/styles.css")?.artifact_role !== "portal_asset" || fileByPath.get("portal/portal.js")?.artifact_role !== "portal_asset" || fileByPath.get(validatedInput.verification_metadata.verification_instructions_path)?.artifact_role !== "verification_metadata") return reject("portal_incomplete", String(input.portal_projection_ref), "Attestation, receipt, Evidence Bundle representation, exact portal assets, and VERIFY.txt are required.");
  if (files.some((file) => file.relative_path === "verification/static-bundle-signature.json" || file.relative_path === "verification/static-bundle-signing-input.json" || file.artifact_ref === validatedInput.verification_metadata.manifest_signature_ref || file.artifact_ref === validatedInput.verification_metadata.signing_input_ref)) return reject("invalid_input", "verification:outer_attachments", "Signing input and signature must be outer attachments, not circular signed payload files.");
  if (requiredPayloadRefs.some((ref) => fileRefCounts.get(ref) !== 1)) return reject("required_artifact_missing", "artifact_ref:unresolved", "Every Evidence Bundle payload reference must resolve to exactly one digest-covered file.");
  if (!isRecord(input.minimization_disposition) || !minimizationIsSafe(input.minimization_disposition)) return reject("invalid_input", "minimization:unavailable", "Canonical minimization disposition must contain unique, pairwise-disjoint references.");
  const includedRetainedRefs = new Set(input.minimization_disposition.included_retained_refs);
  if (files.some((file) => !includedRetainedRefs.has(file.artifact_ref)) || includedRetainedRefs.size !== files.length) return reject("invalid_input", "minimization:coverage", "Every payload file artifact ref must appear exactly once in included_retained_refs, with no stale included refs.");
  for (const file of files) {
    if (!fileContentMatchesRole(file, validatedInput, outcomes)) return reject("unverifiable_file", file.artifact_ref, "Payload file content or provenance does not match its declared protocol role and bound identity.");
  }
  if (!Array.isArray(input.deletion_records) || input.deletion_records.some((record) => !deletionRecordIsSafe(record))) return reject("invalid_input", "deletion_evidence:unavailable", "Resolved deletion evidence records are required for every deleted reference.");
  const deletionRecords = input.deletion_records as StaticBundleGenerationInput["deletion_records"];
  const declaredDeletionRefs = new Set(input.minimization_disposition.deleted_refs);
  const deletionIds = deletionRecords.map((record) => record.deletion_evidence_id).filter((id): id is string => typeof id === "string");
  if (new Set(deletionIds).size !== deletionRecords.length || deletionRecords.length !== declaredDeletionRefs.size || deletionIds.some((id) => !declaredDeletionRefs.has(id))) return reject("required_artifact_missing", "deletion_evidence:unresolved", "Every deleted reference must resolve to exactly one verified Deletion Evidence record.");
  const includedRefs = new Set(files.map((file) => file.artifact_ref));
  const includedDigests = new Set(files.map((file) => digestString(file.digest)));
  const deletedDigests = new Set(deletionRecords.flatMap((record) => record.deleted_artifact_digests));
  if (input.minimization_disposition.excluded_refs.some((ref) => includedRefs.has(ref)) || input.minimization_disposition.never_collected_refs.some((ref) => includedRefs.has(ref)) || [...deletedDigests].some((item) => includedDigests.has(item))) return reject("deleted_content_reintroduced", "minimization:excluded", "Deleted, excluded, or never-collected artifacts cannot reappear as files.");
  return { ok: true, input: input as unknown as StaticBundleGenerationInput };
}

export function isProtocolManifest(value: unknown): value is ProtocolStaticBundleManifest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["protocol_version", "static_bundle_id", "static_bundle_manifest_id", "manifest_version", "package_state", "review_id", "created_at", "supersedes_static_bundle_manifest_id", "attestation_ref", "vendor_receipt_ref", "evidence_bundle_representation", "portal_projection_ref", "files", "minimization_disposition", "verification_metadata", "canonicalization", "identity_hash_algorithm", "identity_input_excludes"])) return false;
  if (value.protocol_version !== "codeattest.v0" || !/^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.static_bundle_id)) || !digest(value.static_bundle_manifest_id) || !Number.isSafeInteger(value.manifest_version) || Number(value.manifest_version) < 1) return false;
  if ((value.package_state !== "generated" && value.package_state !== "finalized") || !isUtcTimestamp(value.created_at) || !/^review:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.review_id)) || !/^attestation:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.attestation_ref)) || !digest(value.vendor_receipt_ref) || !/^static_portal_projection:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.portal_projection_ref))) return false;
  if (value.package_state === "generated" && value.supersedes_static_bundle_manifest_id !== undefined) return false;
  if (value.package_state === "finalized" && (Number(value.manifest_version) < 2 || !digest(value.supersedes_static_bundle_manifest_id))) return false;
  if (!isDenseArray(value.files) || value.files.length < 6 || !value.files.every(manifestFileIsSafe)) return false;
  const manifestFiles = value.files as ManifestFile[];
  if (manifestFiles.some((file) => Object.keys(file).some((key) => ["export_approved", "content"].includes(key)))) return false;
  const paths = new Map(manifestFiles.map((file) => [file.relative_path, file.artifact_role]));
  if (paths.get("portal/index.html") !== "portal" || paths.get("portal/styles.css") !== "portal_asset" || paths.get("portal/portal.js") !== "portal_asset") return false;
  return isRecord(value.evidence_bundle_representation) && representationIsSafe(value.evidence_bundle_representation) && isRecord(value.minimization_disposition) && minimizationIsSafe(value.minimization_disposition) && isRecord(value.verification_metadata) && verificationMetadataIsSafe(value.verification_metadata) && value.canonicalization === "rfc8785" && value.identity_hash_algorithm === "sha256" && isDenseArray(value.identity_input_excludes) && value.identity_input_excludes.length === 1 && value.identity_input_excludes[0] === "static_bundle_manifest_id";
}

function fileInputIsSafe(value: unknown): value is StaticBundleFileInput {
  if (!isRecord(value) || !artifactRef(value.artifact_ref) || value.export_approved !== true || typeof value.content !== "string") return false;
  return manifestFileIsSafe(value);
}
function manifestFileIsSafe(value: unknown): value is ManifestFile {
  if (!isRecord(value) || !hasOnlyKeys(value, ["relative_path", "media_type", "digest", "size_bytes", "artifact_role", "source_derived_class", "inclusion_reason", "artifact_ref", "export_approved", "content"])) return false;
  return meaningful(value.relative_path) && artifactRef(value.artifact_ref) && meaningful(value.media_type) && artifactDigestIsSafe(value.digest) && Number.isSafeInteger(value.size_bytes) && Number(value.size_bytes) >= 0 && ["attestation", "vendor_receipt", "evidence_bundle_representation", "supporting_evidence", "portal", "portal_asset", "verification_metadata"].includes(String(value.artifact_role)) && ["never_collected", "retained_review_artifact", "customer_opt_in_retained_source"].includes(String(value.source_derived_class)) && meaningful(value.inclusion_reason);
}
function fileContentMatchesRole(file: StaticBundleFileInput, input: StaticBundleGenerationInput, outcomes: StaticBundleVerificationOutcomes | undefined): boolean {
  const lowerText = file.content.normalize("NFKC").toLowerCase();
  if (/(?:pilot[-_. ]?(?:metric|feedback)|internal[-_. ]?learning|unit[-_. ]?economics|private[-_. ]?notes)/u.test(lowerText) || sourceTextForbiddenPhrase(file.content) !== undefined) return false;
  if (file.source_derived_class !== "retained_review_artifact") return false;
  // C6-38: `VERIFY.txt` presence/media-type was checked, but not that it
  // actually names a verification procedure — an empty or irrelevant text
  // file could previously back `offline_verification_supported:true`.
  if (file.relative_path === "VERIFY.txt") return file.media_type.startsWith("text/") && !portalContentHasRemoteChannel(file.content) && file.content.trim().length >= 40 && /sha-?256/iu.test(file.content) && /digest/iu.test(file.content) && /manifest/iu.test(file.content);
  if (file.artifact_role === "portal" || file.artifact_role === "portal_asset") return file.media_type.startsWith("text/") && !portalContentHasRemoteChannel(file.content);
  if (file.media_type !== "application/json") return false;
  let parsed: unknown;
  try { parsed = JSON.parse(file.content); } catch { return false; }
  if (canonicalizeStaticBundleJson(parsed) !== file.content) return false;
  // C6-22: the checks below used to accept a matching *declared* identity
  // field (attestation_id/vendor_receipt_id/evidence_bundle_id/signed_identity)
  // without ever schema-validating the shipped document or recomputing its
  // content-addressed identity from the actual bytes -- a well-formed-looking
  // stub with the right id field but arbitrary other content would pass.
  if (file.artifact_role === "attestation") {
    if (validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", parsed).length > 0) return false;
    const attestation = parsed as SecurityReviewAttestation;
    return recomputeExcludedFieldsIdentity(attestation, ["attestation_id"], "attestation") === input.attestation_ref && attestation.attestation_id === input.attestation_ref && attestation.review_id === input.review_id;
  }
  if (file.artifact_role === "vendor_receipt") {
    if (outcomes?.vendor_receipt_signature === undefined || verifyVendorReceiptRecordSync(parsed, { signature_verification_outcome: outcomes.vendor_receipt_signature }).state !== "receipt_verified") return false;
    return isRecord(parsed) && parsed.vendor_receipt_id === input.vendor_receipt_ref;
  }
  if (file.artifact_role === "evidence_bundle_representation") return canonicalizeStaticBundleJson(parsed) === canonicalizeStaticBundleJson(input.evidence_bundle_representation);
  if (file.artifact_role === "supporting_evidence") {
    if (file.artifact_ref === input.evidence_bundle_representation.bundle_manifest_ref) {
      if (validateProtocolSchema("urn:codeattest:protocol:v0:bundle-manifest", parsed).length > 0) return false;
      return recomputeExcludedFieldsIdentity(parsed, ["evidence_bundle_id"]) === input.evidence_bundle_representation.evidence_bundle_id;
    }
    if (file.artifact_ref === input.evidence_bundle_representation.identity_ref) {
      if (validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", parsed).length > 0) return false;
      const signingInput = parsed as { signing_input_type?: unknown; signed_identity_type?: unknown; signed_identity?: unknown };
      return signingInput.signing_input_type === "bundle_manifest_identity" && signingInput.signed_identity_type === "evidence_bundle" && signingInput.signed_identity === input.evidence_bundle_representation.evidence_bundle_id;
    }
    if (file.artifact_ref === input.evidence_bundle_representation.signature_ref) {
      if (validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", parsed).length > 0) return false;
      const signature = parsed as SignatureEnvelope;
      if (signature.signed_identity_type !== "evidence_bundle" || signature.signed_identity !== input.evidence_bundle_representation.evidence_bundle_id) return false;
      // D2-1: the Evidence Bundle's signature is not verifiable by this pure
      // module -- it trusts only a host-computed
      // `SignatureVerificationOutcome` that is itself bound field-by-field to
      // this exact identity and key, never the raw signature bytes.
      return signatureOutcomeCovers(signature, outcomes?.evidence_bundle_signature);
    }
    return input.evidence_bundle_representation.retained_export_approved_payload_refs.includes(file.artifact_ref);
  }
  return file.artifact_role === "verification_metadata" && file.relative_path === "VERIFY.txt";
}

// C6-23: only a narrow `<script src="https?:|//">` pattern was blocked, so
// remote images/iframes/forms/links, CSS @import/url() reaching off-host,
// and script-level remote-fetch APIs were all still signable as trusted
// "self-contained offline" portal content.
function portalContentHasRemoteChannel(content: string): boolean {
  return /<script[^>]+src\s*=\s*["'](?:https?:)?\/\//iu.test(content)
    || /\b(?:src|href|action|formaction)\s*=\s*["'](?:https?:)?\/\//iu.test(content)
    || /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//iu.test(content)
    || /\burl\(\s*["']?(?:https?:)?\/\//iu.test(content)
    || /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket|sendBeacon|new\s+Image)\s*\(/iu.test(content);
}
function representationIsSafe(value: Record<string, unknown>): value is EvidenceBundleRepresentation {
  if (!hasOnlyKeys(value, ["evidence_bundle_id", "bundle_manifest_ref", "signature_ref", "identity_ref", "retained_export_approved_payload_refs"]) || !digest(value.evidence_bundle_id) || !artifactRef(value.bundle_manifest_ref) || !artifactRef(value.signature_ref) || !artifactRef(value.identity_ref) || !isDenseArray(value.retained_export_approved_payload_refs) || !value.retained_export_approved_payload_refs.every(artifactRef)) return false;
  // C6-40: the three core role refs, plus every retained payload ref, must
  // be pairwise distinct — otherwise one file can satisfy multiple
  // conceptual roles (e.g. bundle_manifest_ref === signature_ref) and count
  // checks elsewhere ("exactly one file per ref") pass vacuously.
  const allRefs = [value.bundle_manifest_ref, value.signature_ref, value.identity_ref, ...value.retained_export_approved_payload_refs];
  return new Set(allRefs).size === allRefs.length;
}
// C6-23: `disclosure_policy_id` is content-addressed the same way as every
// other plain `sha256:` identity in this protocol -- recompute it, don't
// just schema-check the field's shape.
function disclosurePolicyIsSafe(value: Record<string, unknown>): value is DisclosurePolicy {
  return validateProtocolSchema("urn:codeattest:protocol:v0:disclosure-policy", value).length === 0
    && disclosurePolicySemanticIssues(value).length === 0
    && recomputeExcludedFieldsIdentity(value, ["disclosure_policy_id"]) === value.disclosure_policy_id;
}
function customerApprovalIsSafe(value: Record<string, unknown>, disclosurePolicy: DisclosurePolicy): value is CustomerApproval {
  if (validateProtocolSchema("urn:codeattest:protocol:v0:customer-approval", value).length > 0 || customerApprovalSemanticIssues(value).length > 0) return false;
  const approval = value as unknown as CustomerApproval;
  return approval.decision === "approved" && approval.displayed_context.disclosure_policy_ref === disclosurePolicy.disclosure_policy_id;
}
function minimizationIsSafe(value: Record<string, unknown>): value is MinimizationDisposition {
  if (!hasOnlyKeys(value, ["included_retained_refs", "excluded_refs", "deleted_refs", "never_collected_refs"])) return false;
  const categories = [value.included_retained_refs, value.excluded_refs, value.deleted_refs, value.never_collected_refs];
  if (!categories.every((entry) => isDenseArray(entry) && entry.every(meaningful) && new Set(entry).size === entry.length)) return false;
  const flattened = categories.flat();
  return new Set(flattened).size === flattened.length;
}
// C6-39: `manifest_signature_ref`/`signing_input_ref` must equal the exact
// refs `createVerificationPackage` emits for its outer attachments, not just
// be *some* well-formed artifact ref — otherwise the manifest's verification
// metadata can point at a ref the actual package never attaches under.
function verificationMetadataIsSafe(value: Record<string, unknown>): value is ProtocolStaticBundleManifest["verification_metadata"] {
  return hasOnlyKeys(value, ["manifest_signature_ref", "signing_input_ref", "verification_instructions_path", "offline_verification_supported", "all_file_digests_verified"]) && value.manifest_signature_ref === "artifact_ref:static_bundle_signature" && value.signing_input_ref === "artifact_ref:static_bundle_signing_input" && value.verification_instructions_path === "VERIFY.txt" && value.offline_verification_supported === true && value.all_file_digests_verified === true;
}
function eventMetadataIsSafe(value: unknown): value is { sequence_number: number } {
  return isRecord(value) && Number.isSafeInteger(value.sequence_number) && Number(value.sequence_number) >= 0;
}
function deletionRecordIsSafe(value: unknown): value is StaticBundleGenerationInput["deletion_records"][number] {
  return isRecord(value) && hasOnlyKeys(value, ["protocol_version", "deletion_evidence_id", "deleted_artifact_digests", "deletion_method", "deletion_timestamp", "actor", "verification_status"]) && value.protocol_version === "codeattest.v0" && /^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.deletion_evidence_id)) && isDenseArray(value.deleted_artifact_digests) && value.deleted_artifact_digests.length > 0 && value.deleted_artifact_digests.every(digest) && new Set(value.deleted_artifact_digests).size === value.deleted_artifact_digests.length && ["crypto_erase", "secure_delete", "key_destruction", "expiry_purge"].includes(String(value.deletion_method)) && isUtcTimestamp(value.deletion_timestamp) && isRecord(value.actor) && meaningful(value.actor.actor_id) && value.verification_status === "verified";
}
// C6-42: these ref lists are semantically sets (membership, not caller order,
// is what they mean -- `minimizationIsSafe`/`representationIsSafe` already
// require every entry unique). Cloning them in whatever order the caller
// happened to supply meant two callers with identical membership but
// different insertion order produced different `static_bundle_manifest_id`s.
// Sorting here, at the one place both producers clone these arrays before
// identity computation, makes membership (not order) the identity input.
function sortedUnique(values: readonly string[]): string[] { return [...values].sort(); }
function cloneRepresentation(value: EvidenceBundleRepresentation): EvidenceBundleRepresentation { return { ...value, retained_export_approved_payload_refs: sortedUnique(value.retained_export_approved_payload_refs) }; }
function cloneMinimization(value: MinimizationDisposition): MinimizationDisposition { return { included_retained_refs: sortedUnique(value.included_retained_refs), excluded_refs: sortedUnique(value.excluded_refs), deleted_refs: sortedUnique(value.deleted_refs), never_collected_refs: sortedUnique(value.never_collected_refs) }; }

function createBundleEvent(
  eventType: "static_bundle_generated" | "attestation_package_finalized",
  reviewId: string,
  eventTimestamp: string,
  actor: ReviewEvent["actor"],
  eventMetadata: { sequence_number: number },
  artifactRef: string,
  idempotencyKey: string,
  reason: string
): ReviewEvent {
  const identity = {
    protocol_version: "codeattest.v0" as const,
    review_id: reviewId,
    sequence_number: eventMetadata.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: eventType,
    actor,
    event_timestamp: eventTimestamp,
    artifact_refs: [artifactRef] as [string],
    visibility: "customer_facing" as const,
    canonicalization: "rfc8785" as const,
    identity_hash_algorithm: "sha256" as const,
    identity_input_excludes: ["event_id"] as ["event_id"],
    source_derived_class: "retained_review_artifact" as const,
    reason
  };
  return { ...identity, event_id: sha256Text(canonicalizeStaticBundleJson(identity)) };
}
function failure(code: StaticBundleFailureCode, affectedIdentity: string, message: string): Extract<SignedStaticBundleResult, { ok: false }> { return { ok: false, code, affected_identity: affectedIdentity, next_path: code === "digest_mismatch" || code === "unverifiable_file" ? "retry" : code === "required_artifact_missing" || code === "portal_incomplete" ? "remediate" : "support", message }; }
export function recomputeManifestId(manifest: ProtocolStaticBundleManifest): string {
  const { static_bundle_manifest_id: _manifestId, ...identityInput } = manifest;
  return sha256Text(canonicalizeStaticBundleJson(identityInput));
}
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const allowed = new Set(keys); return Object.keys(value).every((key) => allowed.has(key)); }
function isDenseArray(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length && value.every((_entry, index) => Object.prototype.hasOwnProperty.call(value, index)); }
function artifactRef(value: unknown): value is string { return typeof value === "string" && /^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$/u.test(value); }
// C6-41: `.` segments and `//` both normalize away on extraction, so
// `evidence/a/./b.json` and `evidence/a//b.json` are distinct strings here
// but collide with `evidence/a/b.json` on disk — reject both forms outright
// rather than trying to detect the resulting collision after the fact.
function safeRelativePath(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.startsWith("\\") && !/^[a-z]+:/iu.test(value) && !value.includes("//") && !value.split(/[\\/]/u).some((segment) => segment === "." || segment === "..") && /^[a-z0-9][a-z0-9._/-]*$/iu.test(value); }
function digest(value: unknown): value is string { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value); }
function digestString(value: ManifestFile["digest"]): string { return value; }
function artifactDigestIsSafe(value: unknown): value is ManifestFile["digest"] { return digest(value); }
function meaningful(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
const UTC_CALENDAR_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u;

/**
 * C6-32: `Date.parse` silently normalizes out-of-range dates (e.g. February
 * 30 rolls forward to March), so `!Number.isNaN(Date.parse(...))` accepts
 * calendar-invalid timestamps. This validates day-of-month against the
 * actual month/leap-year instead.
 */
function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_CALENDAR_PATTERN.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2: return isLeapYear(year) ? 29 : 28;
    case 4: case 6: case 9: case 11: return 30;
    default: return 31;
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function deepFreeze(value: unknown): void { if (value === null || typeof value !== "object" || Object.isFrozen(value)) return; for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
