import type { AccessibleAction } from "./primitives.js";
import { copyActions, epic5Accessibility, epic5Action, epic5InputIsSerializable, epic5TextIsSafe, hasOnlyKeys, isPlainRecord, meaningfulText } from "./epic5-safety.js";

export type AttestationFinalizationContext = {
  attestation_id: string;
  static_bundle_id: string;
  static_bundle_manifest_id: string;
  review_id: string;
  selected_application: string;
  selected_commit: string;
  disclosure_policy_summary: string;
  coverage_mode: string;
  vendor_receipt_id: string;
  included_artifact_refs: string[];
  deleted_artifacts: Array<{ artifact_ref: string; deletion_evidence_ref: string }>;
  limitations: string[];
  portal_entry_path: string;
  signature_verification_state: "verified_offline";
  recipient_notes?: string;
  sharing_notes?: string;
};
export type AttestationFinalizationBlocker = { code: string; affected_identity: string; message: string; next_path: "retry" | "support" | "remediate" };
export type AttestationFinalizationView = {
  kind: "attestation-finalization";
  available: boolean;
  blocked: boolean;
  actorAuthority: "customer_user" | "unavailable";
  identities: Array<{ label: string; value: string }>;
  visibleContext: Array<{ label: string; value: string }>;
  includedArtifactRefs: string[];
  deletedArtifacts: AttestationFinalizationContext["deleted_artifacts"];
  limitations: string[];
  recipientNotes?: string;
  sharingNotes?: string;
  inlineConfirmation: { contextRemainsVisible: true; label: string; affectedIdentity: string; confirmField: "visible_context_confirmed" };
  customerControlNotice: string;
  eventSeparation: ["static_bundle_generated", "attestation_package_finalized", "attestation_package_exported"];
  blocker?: { role: "alert"; title: string; message: string; affectedIdentity: string; nextPath: string };
  copyActions: Array<AccessibleAction & { value: string }>;
  actions: AccessibleAction[];
  minTargetSizePx: number;
  focusRing: { widthPx: number; color: string };
  reducedMotion: typeof epic5Accessibility.reducedMotion;
  doesNotRelyOnColor: true;
};

export function AttestationFinalizationView(props: { context?: unknown; actor?: unknown; blocker?: unknown } | unknown): AttestationFinalizationView {
  if (!isPlainRecord(props) || !actorIsCustomer(props.actor)) return unavailable("Only a customer user can finalize or export the Attestation package.");
  if (props.blocker !== undefined) {
    if (!blockerIsSafe(props.blocker)) return unavailable("A blocking condition was reported but could not be presented safely.");
    return blocked(props.blocker);
  }
  if (!contextIsSafe(props.context)) return unavailable("Complete receipt, signature, deletion, portal, and sharing context is required.");
  const context = props.context;
  const identities = [{ label: "Attestation", value: context.attestation_id }, { label: "Static Bundle", value: context.static_bundle_id }, { label: "Static Bundle Manifest", value: context.static_bundle_manifest_id }, { label: "Vendor Receipt", value: context.vendor_receipt_id }];
  return {
    kind: "attestation-finalization",
    available: true,
    blocked: false,
    actorAuthority: "customer_user",
    identities,
    visibleContext: [
      { label: "Selected application", value: context.selected_application },
      { label: "Selected commit", value: context.selected_commit },
      { label: "Disclosure Policy", value: context.disclosure_policy_summary },
      { label: "Coverage Mode", value: context.coverage_mode },
      { label: "Vendor Receipt", value: context.vendor_receipt_id },
      { label: "Portal entry", value: context.portal_entry_path },
      { label: "Signature verification", value: "Real ML-DSA-65 signature verified offline" }
    ],
    includedArtifactRefs: [...context.included_artifact_refs],
    deletedArtifacts: context.deleted_artifacts.map((entry) => ({ ...entry })),
    limitations: [...context.limitations],
    ...(context.recipient_notes === undefined ? {} : { recipientNotes: context.recipient_notes }),
    ...(context.sharing_notes === undefined ? {} : { sharingNotes: context.sharing_notes }),
    inlineConfirmation: { contextRemainsVisible: true, label: `I reviewed the evidence context for ${context.static_bundle_id}`, affectedIdentity: context.static_bundle_id, confirmField: "visible_context_confirmed" },
    customerControlNotice: "After export, the customer controls the static package. CodeAttest runtime authorization does not protect exported contents.",
    eventSeparation: ["static_bundle_generated", "attestation_package_finalized", "attestation_package_exported"],
    copyActions: copyActions(identities.map((entry, index) => ({ type: `copy_finalization_identity_${index + 1}`, label: `Copy ${entry.label} identity`, value: entry.value }))),
    actions: [epic5Action("finalize_attestation_package", `Finalize ${context.attestation_id} as ${context.static_bundle_id}`), epic5Action("export_attestation_package", `Export ${context.static_bundle_id}`)],
    ...epic5Accessibility
  };
}

function contextIsSafe(value: unknown): value is AttestationFinalizationContext {
  if (!epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) || !isPlainRecord(value) || !hasOnlyKeys(value, ["attestation_id", "static_bundle_id", "static_bundle_manifest_id", "review_id", "selected_application", "selected_commit", "disclosure_policy_summary", "coverage_mode", "vendor_receipt_id", "included_artifact_refs", "deleted_artifacts", "limitations", "portal_entry_path", "signature_verification_state", "recipient_notes", "sharing_notes"]) || value.signature_verification_state !== "verified_offline") return false;
  const required = [value.attestation_id, value.static_bundle_id, value.static_bundle_manifest_id, value.review_id, value.selected_application, value.selected_commit, value.disclosure_policy_summary, value.coverage_mode, value.vendor_receipt_id, value.portal_entry_path];
  if (!required.every(epic5TextIsSafe) || !/^attestation:[a-f0-9]{64}$/u.test(String(value.attestation_id)) || !/^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.static_bundle_id)) || !/^sha256:[a-f0-9]{64}$/u.test(String(value.static_bundle_manifest_id)) || !/^review:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.review_id)) || !/^[a-f0-9]{40}$/u.test(String(value.selected_commit)) || !/^sha256:[a-f0-9]{64}$/u.test(String(value.vendor_receipt_id)) || !["metadata_only", "finding_context_snippets", "extended_approved_snippets_or_targeted_files"].includes(String(value.coverage_mode)) || value.portal_entry_path !== "portal/index.html") return false;
  if (!Array.isArray(value.included_artifact_refs) || value.included_artifact_refs.length === 0 || new Set(value.included_artifact_refs).size !== value.included_artifact_refs.length || !value.included_artifact_refs.every((entry) => typeof entry === "string" && /^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$/u.test(entry))) return false;
  if (!Array.isArray(value.deleted_artifacts) || value.deleted_artifacts.some((entry) => !isPlainRecord(entry) || !hasOnlyKeys(entry, ["artifact_ref", "deletion_evidence_ref"]) || typeof entry.artifact_ref !== "string" || !/^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$/u.test(entry.artifact_ref) || typeof entry.deletion_evidence_ref !== "string" || !/^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$/u.test(entry.deletion_evidence_ref))) return false;
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || !value.limitations.every(epic5TextIsSafe)) return false;
  return (value.recipient_notes === undefined || epic5TextIsSafe(value.recipient_notes)) && (value.sharing_notes === undefined || epic5TextIsSafe(value.sharing_notes));
}

function actorIsCustomer(value: unknown): value is { actor_type: "customer_user"; actor_id: string } {
  return isPlainRecord(value) && hasOnlyKeys(value, ["actor_type", "actor_id"]) && value.actor_type === "customer_user" && meaningfulText(value.actor_id);
}

const SAFE_BLOCKER_CODES = new Set(["missing_receipt", "signature_invalid", "deletion_unresolved", "portal_invalid", "manifest_invalid"]);

function blockerIsSafe(value: unknown): value is AttestationFinalizationBlocker {
  return epic5InputIsSerializable(value, { rejectInternalLearning: true, rejectPayloadFields: true }) && isPlainRecord(value) && hasOnlyKeys(value, ["code", "affected_identity", "message", "next_path"]) && SAFE_BLOCKER_CODES.has(String(value.code)) && [value.affected_identity, value.message].every(epic5TextIsSafe) && ["retry", "support", "remediate"].includes(String(value.next_path));
}

function blocked(blocker: AttestationFinalizationBlocker): AttestationFinalizationView {
  return { kind: "attestation-finalization", available: false, blocked: true, actorAuthority: "customer_user", identities: [], visibleContext: [], includedArtifactRefs: [], deletedArtifacts: [], limitations: [], inlineConfirmation: { contextRemainsVisible: true, label: "Finalization blocked", affectedIdentity: blocker.affected_identity, confirmField: "visible_context_confirmed" }, customerControlNotice: "No package is exported while required evidence remains incomplete.", eventSeparation: ["static_bundle_generated", "attestation_package_finalized", "attestation_package_exported"], blocker: { role: "alert", title: "Attestation package cannot be finalized", message: blocker.message, affectedIdentity: blocker.affected_identity, nextPath: blocker.next_path }, copyActions: [], actions: [epic5Action(blocker.next_path, `${blocker.next_path === "remediate" ? "Resolve" : blocker.next_path === "retry" ? "Retry" : "Contact support about"} ${blocker.affected_identity}`)], ...epic5Accessibility };
}

function unavailable(message: string): AttestationFinalizationView {
  return { kind: "attestation-finalization", available: false, blocked: true, actorAuthority: "unavailable", identities: [], visibleContext: [], includedArtifactRefs: [], deletedArtifacts: [], limitations: [], inlineConfirmation: { contextRemainsVisible: true, label: "Finalization unavailable", affectedIdentity: "attestation_package:unavailable", confirmField: "visible_context_confirmed" }, customerControlNotice: "No package is finalized or exported from unavailable context.", eventSeparation: ["static_bundle_generated", "attestation_package_finalized", "attestation_package_exported"], blocker: { role: "alert", title: "Attestation package unavailable", message, affectedIdentity: "attestation_package:unavailable", nextPath: "remediate" }, copyActions: [], actions: [], ...epic5Accessibility };
}
