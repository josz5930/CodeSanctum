import { recomputeExcludedFieldIdentity } from "../../protocol-ts/src/index.js";
import type { IdentitySigningInput, SignatureEnvelope, SignatureVerificationOutcome, StaticBundleManifest } from "../../protocol-ts/src/index.js";
import { signatureEnvelopeMatchesExpectation, signatureOutcomeCovers } from "../../protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../protocol-ts/src/index.js";
import type { AccessibleAction } from "./primitives.js";
import { copyActions, epic5Accessibility, epic5Action, epic5InputIsSerializable, epic5TextIsSafe, hasOnlyKeys, isPlainRecord, meaningfulText } from "./epic5-safety.js";

export type StaticBundleGenerationInput = {
  manifest: StaticBundleManifest;
  signingInput: IdentitySigningInput;
  signature: SignatureEnvelope;
  // D3-2: this view holds no key material, so a real signature's bytes are
  // trusted only through an independently produced outcome bound to this
  // exact envelope.
  signatureOutcome: SignatureVerificationOutcome;
};
export type StaticBundleGenerationFailure = { code: string; affected_identity: string; message: string; next_path: "retry" | "support" | "remediate" };
export type StaticBundleGenerationView = {
  kind: "static-bundle-generation";
  available: boolean;
  blocked: boolean;
  statusLabel: string;
  identities: Array<{ label: string; value: string }>;
  files: Array<{ path: string; artifactRole: string; digest: string; sizeBytes: number; sourceDerivedClass: string }>;
  minimization: Array<{ category: "included" | "excluded" | "deleted" | "never_collected"; reference: string }>;
  verificationDetails: Array<{ label: string; value: string }>;
  riskWarning?: { role: "alert"; title: string; message: string; affectedIdentity: string; nextPath: string };
  disclosure: { title: string; body: string[]; nonDismissible: true };
  actions: AccessibleAction[];
  copyActions: Array<AccessibleAction & { value: string }>;
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  reducedMotion: typeof epic5Accessibility.reducedMotion;
  doesNotRelyOnColor: true;
};

export function StaticBundleGenerationView(props: { bundle?: unknown; failure?: unknown; audience?: "customer" | "vendor" } | unknown): StaticBundleGenerationView {
  if (!isPlainRecord(props)) return unavailable();
  if (props.failure !== undefined) {
    if (!failureIsSafe(props.failure)) return unavailable();
    return blocked(props.failure);
  }
  if (!bundleIsSafe(props.bundle)) return unavailable();
  const { manifest, signature } = props.bundle;
  const identities = [
    { label: "Static Bundle", value: manifest.static_bundle_id },
    { label: "Static Bundle Manifest", value: manifest.static_bundle_manifest_id },
    { label: "Attestation", value: manifest.attestation_ref },
    { label: "Evidence Bundle", value: manifest.evidence_bundle_representation.evidence_bundle_id },
    { label: "Evidence Bundle representation", value: manifest.evidence_bundle_representation.identity_ref },
    { label: "Vendor Receipt", value: manifest.vendor_receipt_ref },
    { label: "Static portal projection", value: manifest.portal_projection_ref }
  ];
  const minimization = [
    ...manifest.minimization_disposition.included_retained_refs.map((reference) => ({ category: "included" as const, reference })),
    ...manifest.minimization_disposition.excluded_refs.map((reference) => ({ category: "excluded" as const, reference })),
    ...manifest.minimization_disposition.deleted_refs.map((reference) => ({ category: "deleted" as const, reference })),
    ...manifest.minimization_disposition.never_collected_refs.map((reference) => ({ category: "never_collected" as const, reference }))
  ];
  return {
    kind: "static-bundle-generation",
    available: true,
    blocked: false,
    statusLabel: "Static package generated with verified ML-DSA-65 signature metadata",
    identities,
    files: manifest.files.map((file) => ({ path: file.relative_path, artifactRole: file.artifact_role, digest: file.digest, sizeBytes: file.size_bytes, sourceDerivedClass: file.source_derived_class })),
    minimization,
    verificationDetails: [
      { label: "Signature profile", value: signature.algorithm_profile },
      { label: "Signing key/version", value: `${signature.key_id}/${signature.key_version}` },
      { label: "Signature mode", value: signature.signing_mode },
      { label: "Canonicalization", value: manifest.canonicalization },
      { label: "Verification instructions", value: manifest.verification_metadata.verification_instructions_path },
      { label: "Generated at", value: manifest.created_at }
    ],
    disclosure: {
      title: "Offline static sharing boundary",
      body: ["This package is a projection over retained protocol artifacts and history.", ...signature.signing_limitations],
      nonDismissible: true
    },
    actions: props.audience === "vendor" ? [epic5Action("regenerate_static_bundle", `Regenerate Static Bundle ${manifest.static_bundle_id}`)] : [],
    copyActions: copyActions(identities.map((entry, index) => ({ type: `copy_bundle_identity_${index + 1}`, label: `Copy ${entry.label} identity`, value: entry.value }))),
    ...epic5Accessibility
  };
}

function bundleIsSafe(value: unknown): value is StaticBundleGenerationInput {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) || !isPlainRecord(value) || !manifestIsSafe(value.manifest) || !isPlainRecord(value.signature) || !isPlainRecord(value.signingInput) || !isPlainRecord(value.signatureOutcome)) return false;
  const manifest = value.manifest;
  const signature = value.signature;
  if (!signatureOutcomeCovers(signature as unknown as SignatureEnvelope, value.signatureOutcome as unknown as SignatureVerificationOutcome)) return false;
  return signatureEnvelopeMatchesExpectation(value.signingInput, signature, {
    protocol_version: "codeattest.v0",
    signing_input_type: "static_bundle_manifest_identity",
    signed_identity_type: "static_bundle_manifest",
    signed_identity: manifest.static_bundle_manifest_id,
    identity_input_path: manifest.package_state === "finalized" ? "v0/valid/static-bundle-manifest.finalized.identity-input.json" : "v0/valid/static-bundle-manifest.identity-input.json",
    key_id: String(signature.key_id),
    key_version: String(signature.key_version),
    signing_time: manifest.created_at
  });
}

function manifestIsSafe(value: unknown): value is StaticBundleManifest {
  if (validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", value).length > 0 || !isPlainRecord(value) || value.protocol_version !== "codeattest.v0" || !/^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.static_bundle_id)) || !digest(value.static_bundle_manifest_id) || !Number.isSafeInteger(value.manifest_version) || Number(value.manifest_version) < 1 || !["generated", "finalized"].includes(String(value.package_state)) || !isUtc(value.created_at)) return false;
  try { if (recomputeExcludedFieldIdentity(value, "static_bundle_manifest_id") !== value.static_bundle_manifest_id) return false; } catch { return false; }
  if (!meaningfulText(value.review_id) || !meaningfulText(value.attestation_ref) || !digest(value.vendor_receipt_ref) || !isPlainRecord(value.evidence_bundle_representation) || !digest(value.evidence_bundle_representation.evidence_bundle_id) || !meaningfulText(value.portal_projection_ref)) return false;
  if (!Array.isArray(value.files) || value.files.length < 6 || value.files.some((file) => !isPlainRecord(file) || ![file.relative_path, file.artifact_ref, file.media_type, file.digest, file.artifact_role, file.source_derived_class, file.inclusion_reason].every(meaningfulText) || !Number.isSafeInteger(file.size_bytes) || Number(file.size_bytes) < 0)) return false;
  if (new Set(value.files.map((file) => file.relative_path)).size !== value.files.length || new Set(value.files.map((file) => file.artifact_ref)).size !== value.files.length) return false;
  const roles = new Set(value.files.map((file) => file.artifact_role));
  const paths = new Set(value.files.map((file) => file.relative_path));
  if (!["attestation", "vendor_receipt", "evidence_bundle_representation", "portal", "portal_asset"].every((role) => roles.has(role as StaticBundleManifest["files"][number]["artifact_role"])) || !["portal/index.html", "portal/styles.css", "portal/portal.js"].every((filePath) => paths.has(filePath))) return false;
  if (!isPlainRecord(value.minimization_disposition) || ![value.minimization_disposition.included_retained_refs, value.minimization_disposition.excluded_refs, value.minimization_disposition.deleted_refs, value.minimization_disposition.never_collected_refs].every((entry) => Array.isArray(entry) && entry.every(meaningfulText) && new Set(entry).size === entry.length)) return false;
  return isPlainRecord(value.verification_metadata) && meaningfulText(value.verification_metadata.verification_instructions_path) && value.verification_metadata.offline_verification_supported === true && value.verification_metadata.all_file_digests_verified === true && value.canonicalization === "rfc8785" && value.identity_hash_algorithm === "sha256";
}

const SAFE_FAILURE_MESSAGES: Record<string, string> = {
  invalid_input: "Static bundle input is incomplete or malformed.",
  required_artifact_missing: "A required protocol artifact or reference is unavailable.",
  unverifiable_file: "An included file could not be verified.",
  digest_mismatch: "An included file digest or size does not match its content.",
  unsafe_path: "An included file path is not a safe relative path.",
  unapproved_export: "An included file is not approved for export.",
  deleted_content_reintroduced: "Deleted, excluded, or never-collected evidence cannot be included.",
  portal_incomplete: "The offline portal or verification package is incomplete."
};

function failureIsSafe(value: unknown): value is StaticBundleGenerationFailure {
  return epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) && isPlainRecord(value) && Object.hasOwn(SAFE_FAILURE_MESSAGES, String(value.code)) && hasOnlyKeys(value, ["code", "affected_identity", "message", "next_path"]) && epic5TextIsSafe(value.affected_identity) && ["retry", "support", "remediate"].includes(String(value.next_path));
}

function blocked(failure: StaticBundleGenerationFailure): StaticBundleGenerationView {
  const message = SAFE_FAILURE_MESSAGES[failure.code]!;
  return { kind: "static-bundle-generation", available: false, blocked: true, statusLabel: "Static package generation blocked", identities: [], files: [], minimization: [], verificationDetails: [], riskWarning: { role: "alert", title: "Static package cannot be generated", message, affectedIdentity: failure.affected_identity, nextPath: failure.next_path }, disclosure: { title: "Incomplete evidence package", body: ["Generation remains blocked until the affected identity is available and verifiable."], nonDismissible: true }, actions: [epic5Action(failure.next_path, `${failure.next_path === "remediate" ? "Resolve" : failure.next_path === "retry" ? "Retry" : "Contact support about"} ${failure.affected_identity}`)], copyActions: [], ...epic5Accessibility };
}

function unavailable(): StaticBundleGenerationView {
  return { kind: "static-bundle-generation", available: false, blocked: true, statusLabel: "Static package unavailable", identities: [], files: [], minimization: [], verificationDetails: [], riskWarning: { role: "alert", title: "Static package unavailable", message: "Complete Attestation, receipt, Evidence Bundle representation, portal, and verification metadata are required.", affectedIdentity: "static_bundle:unavailable", nextPath: "remediate" }, disclosure: { title: "Incomplete evidence package", body: ["No static sharing or integrity claim is made from malformed input."], nonDismissible: true }, actions: [], copyActions: [], ...epic5Accessibility };
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

const UTC_CALENDAR_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u;

/**
 * C6-32: `Date.parse` silently normalizes out-of-range dates (e.g. February
 * 30 rolls forward to March), so `!Number.isNaN(Date.parse(...))` accepts
 * calendar-invalid timestamps. This validates day-of-month against the
 * actual month/leap-year instead.
 */
function isUtc(value: unknown): value is string {
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
