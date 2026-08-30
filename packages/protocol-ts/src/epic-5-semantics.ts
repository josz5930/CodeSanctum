import { computeCanonicalSha256Id } from "./canonical-identity.js";
import { customerVisibleTextForbidden, sourceTextForbiddenPhrase } from "./claim-safety.js";
import type { StaticBundleManifest, StaticPortalProjection } from "./generated/protocol-v0.js";

const INTERNAL_LEARNING_PATTERN = /(?:pilot[-_. ]?(?:metric|feedback)|internal[-_. ]?learning)/iu;
const REQUIRED_FILE_ROLES = ["attestation", "vendor_receipt", "evidence_bundle_representation", "portal"] as const;
const REQUIRED_PORTAL_SECTIONS = ["overview", "scope", "receipt_chain", "methods", "findings", "validation_remediation", "limitations", "appendices"] as const;

export type StaticBundleManifestSemanticIssue =
  | "static_bundle_identity_excludes_invalid"
  | "static_bundle_manifest_identity_mismatch"
  | "static_bundle_finalization_version_invalid"
  | "static_bundle_duplicate_file"
  | "static_bundle_required_files_missing"
  | "static_bundle_reference_unresolved"
  | "static_bundle_signing_attachment_circular"
  | "static_bundle_minimization_coverage_invalid"
  | "static_bundle_internal_learning_forbidden"
  | "static_bundle_text_forbidden";

/**
 * A faithful TypeScript port of `validateStaticBundleManifestSemantics` in
 * `scripts/lib/protocol-utils.mjs` (C4-23) -- application code must not import
 * that script module, so the same rules are ported here as the single source
 * both the control plane and the script adapter can be checked against.
 * Schema/package-state/actor/ref/identity checks that already run at each
 * call site are intentionally re-verified here too (identity, finalization
 * version) so this helper is safe to call standalone.
 */
export function staticBundleManifestSemanticIssues(manifest: StaticBundleManifest): StaticBundleManifestSemanticIssue[] {
  const issues: StaticBundleManifestSemanticIssue[] = [];

  if (manifest.identity_input_excludes.length !== 1 || manifest.identity_input_excludes[0] !== "static_bundle_manifest_id") {
    issues.push("static_bundle_identity_excludes_invalid");
  }
  const identityInput: Record<string, unknown> = { ...manifest };
  delete identityInput["static_bundle_manifest_id"];
  try {
    if (computeCanonicalSha256Id(identityInput) !== manifest.static_bundle_manifest_id) {
      issues.push("static_bundle_manifest_identity_mismatch");
    }
  } catch {
    issues.push("static_bundle_manifest_identity_mismatch");
  }

  if (
    manifest.package_state === "finalized" &&
    (manifest.manifest_version < 2 ||
      typeof manifest.supersedes_static_bundle_manifest_id !== "string" ||
      manifest.supersedes_static_bundle_manifest_id === manifest.static_bundle_manifest_id)
  ) {
    issues.push("static_bundle_finalization_version_invalid");
  }

  const files = manifest.files;
  const filePaths = files.map((file) => file.relative_path);
  const fileRefs = files.map((file) => file.artifact_ref);
  if (new Set(filePaths).size !== filePaths.length || new Set(fileRefs).size !== fileRefs.length) {
    issues.push("static_bundle_duplicate_file");
  }

  const roles = files.map((file) => file.artifact_role);
  if (
    REQUIRED_FILE_ROLES.some((role) => !roles.includes(role)) ||
    roles.filter((role) => role === "portal_asset").length < 2
  ) {
    issues.push("static_bundle_required_files_missing");
  }
  const portalPaths = new Set(filePaths);
  if (
    !portalPaths.has("portal/index.html") ||
    !portalPaths.has("portal/styles.css") ||
    !portalPaths.has("portal/portal.js") ||
    manifest.verification_metadata.verification_instructions_path !== "VERIFY.txt"
  ) {
    issues.push("static_bundle_required_files_missing");
  }

  const requiredRefs = [
    manifest.evidence_bundle_representation.bundle_manifest_ref,
    manifest.evidence_bundle_representation.signature_ref,
    manifest.evidence_bundle_representation.identity_ref,
    ...manifest.evidence_bundle_representation.retained_export_approved_payload_refs
  ];
  if (requiredRefs.some((ref) => fileRefs.filter((fileRef) => fileRef === ref).length !== 1)) {
    issues.push("static_bundle_reference_unresolved");
  }
  if ([manifest.verification_metadata.manifest_signature_ref, manifest.verification_metadata.signing_input_ref].some((ref) => fileRefs.includes(ref))) {
    issues.push("static_bundle_signing_attachment_circular");
  }

  const includedRefs = manifest.minimization_disposition.included_retained_refs;
  if (
    includedRefs.length !== fileRefs.length ||
    new Set(includedRefs).size !== includedRefs.length ||
    fileRefs.some((ref) => !includedRefs.includes(ref)) ||
    includedRefs.some((ref) => !fileRefs.includes(ref))
  ) {
    issues.push("static_bundle_minimization_coverage_invalid");
  }

  if (
    files.some((file) => INTERNAL_LEARNING_PATTERN.test(`${file.relative_path} ${file.inclusion_reason}`)) ||
    includedRefs.some((ref) => INTERNAL_LEARNING_PATTERN.test(ref))
  ) {
    issues.push("static_bundle_internal_learning_forbidden");
  }

  if (files.some((file) => sourceTextForbiddenPhrase(file.inclusion_reason) !== undefined || customerVisibleTextForbidden(file.inclusion_reason) !== undefined)) {
    issues.push("static_bundle_text_forbidden");
  }

  return issues;
}

export type StaticPortalProjectionSemanticIssue =
  | "static_portal_navigation_incomplete"
  | "static_portal_document_incomplete"
  | "static_portal_internal_learning_forbidden"
  | "static_portal_remote_dependency_forbidden"
  | "static_portal_text_forbidden";

/**
 * A faithful TypeScript port of `validateStaticPortalProjectionSemantics` in
 * `scripts/lib/protocol-utils.mjs` (C4-24): fixed eight-section navigation in
 * order, exactly one matching offline document per section with a unique
 * relative path, no internal pilot-learning references in customer
 * documents, and a fully self-contained asset policy (no remote assets,
 * analytics, live API calls, or runtime authorization; relative links only).
 */
export function staticPortalProjectionSemanticIssues(portal: StaticPortalProjection): StaticPortalProjectionSemanticIssue[] {
  const issues: StaticPortalProjectionSemanticIssue[] = [];

  const navigation = portal.navigation;
  const sections = navigation.map((entry) => entry.section_id);
  const orders = navigation.map((entry) => entry.order);
  if (
    navigation.length !== 8 ||
    new Set(sections).size !== 8 ||
    REQUIRED_PORTAL_SECTIONS.some((section) => !sections.includes(section)) ||
    new Set(orders).size !== 8 ||
    orders.some((order, index) => order !== index + 1)
  ) {
    issues.push("static_portal_navigation_incomplete");
  }

  const documents = portal.documents;
  const documentSections = documents.map((document) => document.section_id);
  const documentPaths = documents.map((document) => document.relative_path);
  if (
    documents.length !== 8 ||
    new Set(documentSections).size !== 8 ||
    REQUIRED_PORTAL_SECTIONS.some((section) => !documentSections.includes(section)) ||
    new Set(documentPaths).size !== documents.length ||
    navigation.some((entry) => !documents.some((document) => document.section_id === entry.section_id && document.relative_path === entry.relative_path))
  ) {
    issues.push("static_portal_document_incomplete");
  }

  if (documents.some((document) => document.source_artifact_refs.some((ref) => INTERNAL_LEARNING_PATTERN.test(ref)))) {
    issues.push("static_portal_internal_learning_forbidden");
  }

  if (
    portal.asset_policy.remote_assets_allowed !== false ||
    portal.asset_policy.analytics_allowed !== false ||
    portal.asset_policy.live_api_calls_allowed !== false ||
    portal.asset_policy.runtime_authorization_required !== false ||
    portal.asset_policy.relative_links_only !== true
  ) {
    issues.push("static_portal_remote_dependency_forbidden");
  }

  if (documents.some((document) => [document.title, document.summary, document.phone_summary].some((text) => sourceTextForbiddenPhrase(text) !== undefined || customerVisibleTextForbidden(text) !== undefined))) {
    issues.push("static_portal_text_forbidden");
  }

  return issues;
}
