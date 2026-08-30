import canonicalizeJson from "canonicalize";
import { canonicalizeProtocolJson, recomputeExcludedFieldIdentity, recomputeExcludedFieldsIdentity, sha256ProtocolText } from "../../../packages/protocol-ts/src/index.js";
import { claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerVisibleTextForbidden, piiTextForbidden, sourceCodeLikeTextReason, sourceTextForbiddenPhrase } from "../../../packages/protocol-ts/src/index.js";
import { staticBundleManifestSemanticIssues, staticPortalProjectionSemanticIssues } from "../../../packages/protocol-ts/src/index.js";
import { verifyVendorReceiptRecordSync } from "../../../packages/protocol-ts/src/index.js";
import { submissionIdentityValueMatchesGrammar } from "../../../packages/protocol-ts/src/index.js";
import { containsPiiValue, opaquePilotActorIdIsValid } from "../../../packages/protocol-ts/src/index.js";
import type {
  AcceptedRiskRecord as ProtocolAcceptedRiskRecord,
  AttestationPackageFinalization as ProtocolAttestationPackageFinalization,
  BundleManifest as ProtocolBundleManifest,
  DeletionEvidence as ProtocolDeletionEvidence,
  EvidenceLifecycleEvent as ProtocolEvidenceLifecycleEvent,
  EvidenceMinimizationProjection as ProtocolEvidenceMinimizationProjection,
  FalsePositiveRecord as ProtocolFalsePositiveRecord,
  CustomerFacingFindingRecord as ProtocolCustomerFacingFindingRecord,
  CustomerRemediationStatusRecord as ProtocolCustomerRemediationStatusRecord,
  FindingClassificationRecord as ProtocolFindingClassificationRecord,
  FindingRemediationGuidance as ProtocolFindingRemediationGuidance,
  FindingValidationPath as ProtocolFindingValidationPath,
  PilotFeedbackRecord as ProtocolPilotFeedbackRecord,
  PilotMetricRecord as ProtocolPilotMetricRecord,
  ReviewFindingDraftSet as ProtocolReviewFindingDraftSet,
  ReviewScope as ProtocolReviewScope,
  RetentionOptInRecord as ProtocolRetentionOptInRecord,
  ReviewerValidationScript as ProtocolReviewerValidationScript,
  SecurityReviewAttestation as ProtocolSecurityReviewAttestation,
  SignatureEnvelope as ProtocolSignatureEnvelope,
  StaticBundleManifest as ProtocolStaticBundleManifest,
  StaticPortalProjection as ProtocolStaticPortalProjection,
  SupportingEvidenceMapping as ProtocolSupportingEvidenceMapping,
  VendorReceipt as ProtocolVendorReceipt,
  VerificationAddendum as ProtocolVerificationAddendum,
  VerificationEvidenceRecord as ProtocolVerificationEvidenceRecord,
  VerificationPassScope as ProtocolVerificationPassScope,
  VerificationRecord as ProtocolVerificationRecord,
  RetentionSourceDerivedClass,
  ReviewEvent as ProtocolReviewEvent,
  ReviewEventCustomerProjection as ProtocolReviewEventCustomerProjection,
  ReviewEventLog as ProtocolReviewEventLog,
  StoredObjectClassification as ProtocolStoredObjectClassification,
  SubmissionOutcome as ProtocolSubmissionOutcome
} from "../../../packages/protocol-ts/src/index.js";
import { signatureEnvelopeMatchesExpectation, signatureOutcomeCovers } from "../../../packages/protocol-ts/src/index.js";
import type { IdentitySigningInput as ProtocolIdentitySigningInput } from "../../../packages/protocol-ts/src/index.js";
import type { IdentitySignatureExpectation, SignatureVerificationOutcome } from "../../../packages/protocol-ts/src/index.js";
import { validateProtocolSchema } from "../../../packages/protocol-ts/src/index.js";

export const workspaceName = "@onevps/control-plane";
export const workspaceScope = "private-capable-control-plane-scaffold";

export type ReviewEvent = ProtocolReviewEvent;

export type ReviewEventLog = Omit<ProtocolReviewEventLog, "events"> & {
  events: ReviewEvent[];
};

export type ReviewEventCustomerProjectionEntry = NonNullable<ProtocolReviewEventCustomerProjection["entries"][number]>;

export type ReviewEventCustomerProjection = Omit<ProtocolReviewEventCustomerProjection, "entries"> & {
  entries: ReviewEventCustomerProjectionEntry[];
};
export type ReviewFindingDraftSet = ProtocolReviewFindingDraftSet;

export type ReviewEventAppendRejectionReason =
  | "review_event_schema_invalid"
  | "review_event_identity_excludes_invalid"
  | "review_event_identity_mismatch"
  | "review_event_internal_note_requires_internal_only"
  | "review_event_reason_raw_source_text_forbidden"
  | "review_event_reason_claim_unsafe_text_forbidden"
  | "review_event_classification_reviewer_actor_required"
  | "review_event_remediation_guidance_reviewer_actor_required"
  | "review_event_customer_remediation_actor_required"
  | "review_event_validation_reviewer_actor_required"
  | "review_event_false_positive_reviewer_actor_required"
  | "review_event_accepted_risk_customer_evidence_required"
  | "review_event_verification_scope_actor_required"
  | "review_event_verification_scope_customer_backing_required"
  | "review_event_verification_scope_reason_claim_unsafe_text_forbidden"
  | "review_event_verification_evidence_actor_required"
  | "review_event_verification_evidence_customer_backing_required"
  | "review_event_verification_evidence_reason_claim_unsafe_text_forbidden"
  | "review_event_verification_evidence_supersedes_family_mismatch"
  | "review_event_verification_evidence_version_invalid"
  | "review_event_verification_record_reviewer_actor_required"
  | "review_event_verification_record_reason_claim_unsafe_text_forbidden"
  | "review_event_verification_record_supersedes_family_mismatch"
  | "review_event_verification_record_version_invalid"
  | "review_event_epic5_authority_invalid"
  | "review_event_pilot_pii_forbidden"
  | "review_event_epic5_version_invalid"
  | "review_event_epic5_supersedes_family_mismatch"
  | "review_event_outcome_supersedes_family_mismatch"
  | "review_event_verification_scope_supersedes_family_mismatch"
  | "review_event_verification_scope_version_invalid"
  | "review_event_validation_script_included_cap_exceeded"
  | "review_event_missing_source_derived_class"
  | "review_event_sequence_number_invalid"
  | "review_event_log_protocol_version_mismatch"
  | "review_event_log_review_id_mismatch"
  | "review_event_log_duplicate_event_id"
  | "review_event_log_idempotency_key_conflict"
  | "review_event_log_sequence_not_monotonic"
  | "review_event_log_supersedes_unknown_event"
  | "customer_event_cannot_supersede_classification"
  | "customer_event_cannot_supersede_expert_record";

export type ReviewEventAppendResult =
  | { outcome: "appended"; log: ReviewEventLog }
  | { outcome: "idempotent_noop"; log: ReviewEventLog }
  | { outcome: "rejected"; reason: ReviewEventAppendRejectionReason; log: ReviewEventLog };

const RETENTION_STATE_EVENT_TYPES = new Set<ReviewEvent["event_type"]>(["evidence_deleted", "retention_status_changed"]);
const CUSTOMER_CORRECTION_EVENT_TYPES = new Set<ReviewEvent["event_type"]>([
  "customer_remediation_recorded",
  "customer_accepted_risk_recorded"
]);
/**
 * Content-addressed event identity: sha256 over the RFC 8785 canonical event
 * content excluding `event_id`. A future hash chain only has to add
 * `previous_event_id` to that canonical content.
 */
export async function computeReviewEventId(event: ReviewEvent): Promise<string> {
  const identityInput: Record<string, unknown> = { ...event };
  delete identityInput["event_id"];
  const canonical = canonicalizeJson(identityInput);
  if (typeof canonical !== "string") {
    throw new Error("review event content could not be canonicalized under RFC 8785");
  }
  const bytes = new TextEncoder().encode(canonical);
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}

/**
 * The structural/authority checks that decide whether `event` may extend
 * `log`, once idempotency-key replay has already been ruled out: duplicate
 * event ID, sequence monotonicity, same-family version-chain/active-head
 * correctness (verification scope/evidence/decision, Epic 5 families), and
 * supersedes-chain family/authority rules. Shared between `appendReviewEvent`
 * (validating one fresh event against real log state) and
 * `storedReviewEventLogIsAppendValid` (replaying a whole candidate event
 * array from empty) so both enforce byte-identical rules — see C4-21.
 */
function rejectionForEventVersionAndSupersedesChain(log: ReviewEventLog, event: ReviewEvent): ReviewEventAppendRejectionReason | undefined {
  if (log.events.some((existing) => existing.event_id === event.event_id)) {
    return "review_event_log_duplicate_event_id";
  }

  if (log.events.some((existing) => existing.sequence_number >= event.sequence_number)) {
    return "review_event_log_sequence_not_monotonic";
  }

  if (event.event_type === "verification_scope_recorded") {
    const scopeIdentity = verificationScopeIdentityFromEvent(event);
    const activeVerificationScopeEvent = latestVerificationScopeEvent(log.events, event);
    if (
      scopeIdentity === undefined ||
      (activeVerificationScopeEvent !== undefined && event.supersedes_event_id !== activeVerificationScopeEvent.event_id)
    ) {
      return "review_event_verification_scope_version_invalid";
    }
  }
  if (event.event_type === "verification_evidence_recorded") {
    const superseded = event.supersedes_event_id === undefined ? undefined : log.events.find((candidate) => candidate.event_id === event.supersedes_event_id);
    if (superseded !== undefined && superseded.event_type !== "verification_evidence_recorded") {
      return "review_event_verification_evidence_supersedes_family_mismatch";
    }
    const identity = versionedVerificationIdentityFromEvent(event, "verification_evidence_recorded");
    const activeEvidenceEvent = latestVersionedVerificationEvent(log.events, event, "verification_evidence_recorded");
    if (
      (activeEvidenceEvent === undefined && (identity?.recordVersion !== 1 || event.supersedes_event_id !== undefined)) ||
      (activeEvidenceEvent !== undefined && event.supersedes_event_id !== activeEvidenceEvent.event_id)
    ) {
      return "review_event_verification_evidence_version_invalid";
    }
  }
  if (event.event_type === "verification_recorded") {
    const superseded = event.supersedes_event_id === undefined ? undefined : log.events.find((candidate) => candidate.event_id === event.supersedes_event_id);
    if (superseded !== undefined && superseded.event_type !== "verification_recorded") {
      return "review_event_verification_record_supersedes_family_mismatch";
    }
    const identity = versionedVerificationIdentityFromEvent(event, "verification_recorded");
    const activeDecisionEvent = latestVersionedVerificationEvent(log.events, event, "verification_recorded");
    if (
      (activeDecisionEvent === undefined && (identity?.recordVersion !== 1 || event.supersedes_event_id !== undefined)) ||
      (activeDecisionEvent !== undefined && event.supersedes_event_id !== activeDecisionEvent.event_id)
    ) {
      return "review_event_verification_record_version_invalid";
    }
  }
  const epic5Identity = epic5EventIdentity(event);
  if (EPIC5_VERSIONED_EVENT_TYPES.has(event.event_type) && epic5Identity === undefined) {
    return "review_event_epic5_version_invalid";
  }
  if (epic5Identity !== undefined) {
    const activeFamilyHead = latestEpic5FamilyEvent(log.events, epic5Identity);
    const superseded = event.supersedes_event_id === undefined ? undefined : log.events.find((candidate) => candidate.event_id === event.supersedes_event_id);
    if (superseded !== undefined && superseded.event_type !== event.event_type) return "review_event_epic5_supersedes_family_mismatch";
    if ((activeFamilyHead === undefined && (epic5Identity.version !== 1 || event.supersedes_event_id !== undefined)) || (activeFamilyHead !== undefined && (epic5Identity.version <= epic5EventIdentity(activeFamilyHead)!.version || event.supersedes_event_id !== activeFamilyHead.event_id))) return "review_event_epic5_version_invalid";
    if (event.event_type === "attestation_package_finalized") {
      // Must bind to the exact prior `static_bundle_generated` event this
      // finalization's own record claims as its `generated_manifest_ref` —
      // matching review/family/sequence alone would accept a finalization
      // record that was built against a different generated manifest.
      const generatedEvent = log.events.find((candidate) => {
        const candidateIdentity = epic5EventIdentity(candidate);
        return candidate.event_type === "static_bundle_generated" && candidateIdentity !== undefined && candidateIdentity.reviewId === epic5Identity.reviewId && candidateIdentity.familyId === epic5Identity.familyId && candidateIdentity.artifactId === epic5Identity.generatedManifestId && candidate.sequence_number < event.sequence_number;
      });
      if (generatedEvent === undefined || parseUtcTimestampNs(event.event_timestamp)! < parseUtcTimestampNs(generatedEvent.event_timestamp)!) return "review_event_epic5_version_invalid";
    }
    if (event.event_type === "attestation_package_exported") {
      // Must bind to the exact prior finalization: same version, same
      // finalization record id, same finalized manifest, and same generated
      // manifest it was built from — not merely "some finalization exists
      // at this version," which would accept an export built from a
      // finalization record that was replaced or never actually appended.
      const finalizedEvent = log.events.find((candidate) => {
        const candidateIdentity = epic5EventIdentity(candidate);
        return candidate.event_type === "attestation_package_finalized" && candidateIdentity !== undefined && candidateIdentity.reviewId === epic5Identity.reviewId && candidateIdentity.familyId === epic5Identity.familyId && candidateIdentity.version === epic5Identity.version && candidateIdentity.recordId === epic5Identity.recordId && candidateIdentity.artifactId === epic5Identity.artifactId && candidateIdentity.generatedManifestId === epic5Identity.generatedManifestId && candidate.sequence_number < event.sequence_number;
      });
      if (finalizedEvent === undefined || parseUtcTimestampNs(event.event_timestamp)! < parseUtcTimestampNs(finalizedEvent.event_timestamp)!) return "review_event_epic5_version_invalid";
    }
  }

  if (event.supersedes_event_id !== undefined) {
    const chain = supersedesChain(log, event.supersedes_event_id);
    if (chain === undefined) {
      return "review_event_log_supersedes_unknown_event";
    }
    if (
      (CUSTOMER_CORRECTION_EVENT_TYPES.has(event.event_type) || isCustomerActor(event.actor)) &&
      chain.some((superseded) => superseded.event_type === "classification_recorded")
    ) {
      return "customer_event_cannot_supersede_classification";
    }
    if (
      (CUSTOMER_CORRECTION_EVENT_TYPES.has(event.event_type) || isCustomerActor(event.actor)) &&
      chain.some((superseded) => superseded.event_type === "remediation_guidance_recorded" || superseded.event_type === "validation_recorded" || superseded.event_type === "false_positive_recorded")
    ) {
      return "customer_event_cannot_supersede_expert_record";
    }
    if (event.event_type === "verification_scope_recorded" && chain.some((superseded) => superseded.event_type !== "verification_scope_recorded")) {
      return "review_event_verification_scope_supersedes_family_mismatch";
    }
    if (event.event_type === "verification_scope_recorded") {
      const activeVerificationScopeEvent = latestVerificationScopeEvent(log.events, event);
      if (!verificationScopeCorrectionVersionIsValid(event, chain[0], activeVerificationScopeEvent)) {
        return "review_event_verification_scope_version_invalid";
      }
    }
    if (event.event_type !== "verification_scope_recorded" && chain.some((superseded) => superseded.event_type === "verification_scope_recorded")) {
      return "review_event_verification_scope_supersedes_family_mismatch";
    }
    if (event.event_type === "verification_evidence_recorded" && chain.some((superseded) => superseded.event_type !== "verification_evidence_recorded")) {
      return "review_event_verification_evidence_supersedes_family_mismatch";
    }
    if (event.event_type !== "verification_evidence_recorded" && chain.some((superseded) => superseded.event_type === "verification_evidence_recorded")) {
      return "review_event_verification_evidence_supersedes_family_mismatch";
    }
    if (event.event_type === "verification_evidence_recorded") {
      const activeEvidenceEvent = latestVersionedVerificationEvent(log.events, event, "verification_evidence_recorded");
      if (!versionedVerificationCorrectionIsValid(event, chain[0], activeEvidenceEvent, "verification_evidence_recorded")) {
        return "review_event_verification_evidence_version_invalid";
      }
    }
    if (event.event_type === "verification_recorded" && chain.some((superseded) => superseded.event_type !== "verification_recorded")) {
      return "review_event_verification_record_supersedes_family_mismatch";
    }
    if (event.event_type !== "verification_recorded" && chain.some((superseded) => superseded.event_type === "verification_recorded")) {
      return "review_event_verification_record_supersedes_family_mismatch";
    }
    if (event.event_type === "verification_recorded") {
      const activeDecisionEvent = latestVersionedVerificationEvent(log.events, event, "verification_recorded");
      if (!versionedVerificationCorrectionIsValid(event, chain[0], activeDecisionEvent, "verification_recorded")) {
        return "review_event_verification_record_version_invalid";
      }
    }
    if (event.event_type === "false_positive_recorded" && chain.some((superseded) => superseded.event_type !== "false_positive_recorded")) {
      return "review_event_outcome_supersedes_family_mismatch";
    }
    if (event.event_type !== "false_positive_recorded" && chain.some((superseded) => superseded.event_type === "false_positive_recorded")) {
      return "review_event_outcome_supersedes_family_mismatch";
    }
    if (event.event_type === "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type !== "customer_accepted_risk_recorded")) {
      return "review_event_outcome_supersedes_family_mismatch";
    }
    if (event.event_type !== "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type === "customer_accepted_risk_recorded")) {
      return "review_event_outcome_supersedes_family_mismatch";
    }
  }

  if (
    event.supersedes_classification_record_ref !== undefined &&
    (event.event_type === "false_positive_recorded" || event.event_type === "customer_accepted_risk_recorded")
  ) {
    return "review_event_outcome_supersedes_family_mismatch";
  }
  if (
    event.supersedes_classification_record_ref !== undefined &&
    (CUSTOMER_CORRECTION_EVENT_TYPES.has(event.event_type) || isCustomerActor(event.actor))
  ) {
    return "customer_event_cannot_supersede_classification";
  }
  if (event.supersedes_classification_record_ref !== undefined) {
    const expectedArtifactRef = classificationArtifactRefFromRecordRef(event.supersedes_classification_record_ref);
    const priorClassificationExists = log.events.some((existing) =>
      existing.event_type === "classification_recorded" &&
      existing.artifact_refs.includes(expectedArtifactRef)
    );
    if (!priorClassificationExists) {
      return "review_event_log_supersedes_unknown_event";
    }
  }

  return undefined;
}

/**
 * Append-only: the returned log is a new object with a new events array, the
 * input log is never mutated, and no prior event is rewritten, reordered, or
 * removed. Replaying the exact same event under an already-used
 * `idempotency_key` is a no-op; a *different* body under that key is a
 * conflict, never a silent success.
 */
export async function appendReviewEvent(logInput: ReviewEventLog, eventInput: ReviewEvent): Promise<ReviewEventAppendResult> {
  // Snapshot both caller-owned arguments before any check or async work.
  // `rejectionForEvent` below awaits a SHA-256 digest; without a same-tick
  // snapshot a caller could mutate `logInput`/`eventInput` while that promise
  // is suspended and influence validation, hashing, or the returned log.
  const clonedLog = cloneJson(logInput);
  const clonedEvent = cloneJson(eventInput);
  if (clonedLog === undefined || clonedEvent === undefined) {
    return { outcome: "rejected", reason: "review_event_schema_invalid", log: logInput };
  }
  const log = clonedLog;
  const event = clonedEvent;
  // `ReviewEventLog` and `ReviewEvent` are erased at runtime and real input is
  // parsed JSON, so non-objects can reach here and every check below would throw.
  if (!reviewEventLogIsValid(log)) {
    return { outcome: "rejected", reason: "review_event_schema_invalid", log };
  }
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return { outcome: "rejected", reason: "review_event_schema_invalid", log };
  }

  if (event.protocol_version !== log.protocol_version) {
    return { outcome: "rejected", reason: "review_event_log_protocol_version_mismatch", log };
  }

  if (event.review_id !== log.review_id) {
    return { outcome: "rejected", reason: "review_event_log_review_id_mismatch", log };
  }

  if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number < 0) {
    return { outcome: "rejected", reason: "review_event_sequence_number_invalid", log };
  }

  const sameKey = log.events.find((existing) => existing.idempotency_key === event.idempotency_key);
  if (sameKey !== undefined) {
    if (sameKey.event_id === event.event_id) {
      if (!stableEquals(sameKey, event)) {
        return { outcome: "rejected", reason: "review_event_log_idempotency_key_conflict", log };
      }
      return { outcome: "idempotent_noop", log: cloneAndFreezeReviewEventLog(log) };
    }
    return { outcome: "rejected", reason: "review_event_log_idempotency_key_conflict", log };
  }

  const structuralRejection = rejectionForEventVersionAndSupersedesChain(log, event);
  if (structuralRejection !== undefined) {
    return { outcome: "rejected", reason: structuralRejection, log };
  }

  const eventRejection = await rejectionForEvent(event);
  if (eventRejection !== undefined) {
    return { outcome: "rejected", reason: eventRejection, log };
  }

  if (isValidationScriptEvent(event)) {
    const validationCapRejection = rejectionForValidationEventPackageAppend(log, event);
    if (validationCapRejection !== undefined) {
      return { outcome: "rejected", reason: validationCapRejection, log };
    }
  }

  // Backstop schema enforcement for everything the targeted guards do not name
  // — `additionalProperties: false`, `artifact_refs` item shape, field patterns
  // — which the erased `ReviewEvent` type cannot provide at runtime. It runs
  // last so a guard that has a specific reason reports that reason instead of
  // being flattened into a generic schema rejection.
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "review_event_schema_invalid", log };
  }

  return {
    outcome: "appended",
    log: cloneAndFreezeReviewEventLog({ protocol_version: log.protocol_version, review_id: log.review_id, events: [...log.events, event] })
  };
}

function reviewEventLogIsValid(value: unknown): value is ReviewEventLog {
  if (!isRecord(value) || value.protocol_version !== "codeattest.v0" || !isNonEmptyString(value.review_id) || !Array.isArray(value.events) || !value.events.every(isPlainObjectValue)) return false;
  const ids = new Set<string>(); const keys = new Set<string>(); const priorIds = new Set<string>(); let sequence = -1;
  for (const event of value.events as ReviewEvent[]) {
    if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0 || event.protocol_version !== value.protocol_version || event.review_id !== value.review_id || !Number.isSafeInteger(event.sequence_number) || event.sequence_number <= sequence || ids.has(event.event_id) || keys.has(event.idempotency_key) || !isRecord(event.actor) || !isNonEmptyString(event.actor.actor_type) || !isNonEmptyString(event.actor.actor_id) || !typedReviewEventArtifactRefsMatch(event) || rejectionForReviewEventSemantics(event) !== undefined) return false;
    const identityInput: Record<string, unknown> = { ...event }; delete identityInput.event_id;
    let canonical: string | undefined; try { canonical = canonicalizeJson(identityInput); } catch { return false; }
    if (typeof canonical !== "string" || sha256ProtocolText(canonical) !== event.event_id || (event.supersedes_event_id !== undefined && !priorIds.has(event.supersedes_event_id))) return false;
    ids.add(event.event_id); keys.add(event.idempotency_key); priorIds.add(event.event_id); sequence = event.sequence_number;
  }
  return true;
}

/**
 * Replay-validates `events` as an append-only history built entirely from
 * genuine sequential appends into an empty log for `protocolVersion`/`reviewId`
 * -- schema, hash/identity, sequence, actor shape, typed refs, event-local
 * semantic/authority rules (`rejectionForReviewEventSemantics`), unique
 * event IDs and idempotency keys, and the same family-version-chain and
 * supersedes-chain rules `appendReviewEvent` enforces
 * (`rejectionForEventVersionAndSupersedesChain`). Two candidates sharing an
 * idempotency key can never both have arisen from real appends (a genuine
 * replay is a no-op, not a second entry), so that is fail-closed here too,
 * unlike `reviewEventLogIsValid`'s weaker preloaded-log check which predates
 * this validator (C4-21) and does not verify version-chain/supersedes
 * authority for stored events at all.
 */
function storedReviewEventLogIsAppendValid(
  events: readonly unknown[],
  protocolVersion: ReviewEventLog["protocol_version"],
  reviewId: string
): { valid: true; log: ReviewEventLog } | { valid: false } {
  let log: ReviewEventLog = { protocol_version: protocolVersion, review_id: reviewId, events: [] };
  for (const candidate of events) {
    if (!isPlainObjectValue(candidate) || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", candidate).length > 0) {
      return { valid: false };
    }
    const event = candidate as ReviewEvent;
    if (
      event.protocol_version !== protocolVersion ||
      event.review_id !== reviewId ||
      !Number.isSafeInteger(event.sequence_number) ||
      event.sequence_number < 0 ||
      log.events.some((existing) => existing.idempotency_key === event.idempotency_key) ||
      !isRecord(event.actor) ||
      !isNonEmptyString(event.actor.actor_type) ||
      !isNonEmptyString(event.actor.actor_id) ||
      !typedReviewEventArtifactRefsMatch(event) ||
      rejectionForReviewEventSemantics(event) !== undefined
    ) {
      return { valid: false };
    }
    const identityInput: Record<string, unknown> = { ...event };
    delete identityInput.event_id;
    let canonical: string | undefined;
    try {
      canonical = canonicalizeJson(identityInput);
    } catch {
      return { valid: false };
    }
    if (typeof canonical !== "string" || sha256ProtocolText(canonical) !== event.event_id) {
      return { valid: false };
    }
    if (rejectionForEventVersionAndSupersedesChain(log, event) !== undefined) {
      return { valid: false };
    }
    log = { protocol_version: log.protocol_version, review_id: log.review_id, events: [...log.events, event] };
  }
  return { valid: true, log };
}

function cloneAndFreezeReviewEventLog(log: ReviewEventLog): ReviewEventLog {
  const cloned = cloneJson(log) ?? log;
  deepFreeze(cloned);
  return cloned;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child as unknown);
    }
  }
  return value;
}

/**
 * Customer-facing projection: `internal_only` events are omitted entirely,
 * matching the shipped `TimelineEvent` behavior, and the projection shape has
 * no `internal_note` property at all.
 */
export function projectCustomerFacingHistory(log: ReviewEventLog): ReviewEventCustomerProjection {
  if (!reviewEventLogIsValid(log)) return { protocol_version: "codeattest.v0", review_id: "review:invalid", entries: [] };
  const entries = [...log.events]
    .sort((left, right) => left.sequence_number - right.sequence_number)
    .filter((event): event is ReviewEvent & { event_type: ReviewEventCustomerProjectionEntry["event_type"] } =>
      event.visibility === "customer_facing" && event.event_type !== "pilot_metric_recorded" && event.event_type !== "pilot_feedback_recorded"
    )
    .map((event) => {
      const entry: ReviewEventCustomerProjectionEntry = {
        event_id: event.event_id,
        event_type: event.event_type,
        event_timestamp: event.event_timestamp,
        actor_category: event.actor.actor_type,
        artifact_refs: [...event.artifact_refs],
        visibility: "customer_facing"
      };
      return event.reason === undefined ? entry : { ...entry, reason: event.reason };
    });

  return { protocol_version: log.protocol_version, review_id: log.review_id, entries };
}

/**
 * Walks a `supersedes_event_id` chain from its first link to its root so a
 * multi-hop correction cannot reach what a direct correction may not.
 * Returns `undefined` when any link is not an event in this log. Repeated
 * ids terminate the walk, so a malformed cyclic chain cannot spin.
 */
function supersedesChain(log: ReviewEventLog, firstSupersededId: string): ReviewEvent[] | undefined {
  const chain: ReviewEvent[] = [];
  const visited = new Set<string>();
  let nextId: string | undefined = firstSupersededId;

  while (nextId !== undefined) {
    if (visited.has(nextId)) {
      break;
    }
    visited.add(nextId);
    const superseded: ReviewEvent | undefined = log.events.find((existing) => existing.event_id === nextId);
    if (superseded === undefined) {
      return undefined;
    }
    chain.push(superseded);
    nextId = superseded.supersedes_event_id;
  }

  return chain;
}

function rejectionForValidationEventPackageAppend(log: ReviewEventLog, event: ReviewEvent): ReviewEventAppendRejectionReason | undefined {
  if (!isValidationScriptEvent(event)) {
    return undefined;
  }
  const currentPackage = validationScriptPackageFromReason(event.reason);
  if (currentPackage === undefined) {
    return "review_event_schema_invalid";
  }
  if (currentPackage.status !== "included_base_package") {
    return undefined;
  }
  let priorIncludedCount = 0;
  const priorIncludedSlots = new Set<number>();
  for (const existing of log.events) {
    if (!isValidationScriptEvent(existing)) {
      continue;
    }
    const existingPackage = validationScriptPackageFromReason(existing.reason);
    if (existingPackage === undefined) {
      return "review_event_schema_invalid";
    }
    if (existingPackage.status === "included_base_package") {
      priorIncludedCount += 1;
      priorIncludedSlots.add(existingPackage.includedScriptSlot);
    }
  }
  if (priorIncludedCount >= 3 || priorIncludedSlots.has(currentPackage.includedScriptSlot)) {
    return "review_event_validation_script_included_cap_exceeded";
  }
  return undefined;
}

/**
 * Event-local authority/content rules: actor shape, identity-exclude,
 * internal-note visibility, customer/source/claim text, event-family
 * authority, customer backing, typed-ref, and source-derived-class checks.
 * Synchronous and side-effect-free so it can run identically over a fresh
 * append candidate and every event already sitting in a stored log —
 * a rehashed historical event must fail here exactly like a fresh append
 * would, not just when it first arrives through `appendReviewEvent`.
 */
function rejectionForReviewEventSemantics(event: ReviewEvent): ReviewEventAppendRejectionReason | undefined {
  if (!isRecord(event.actor) || !isNonEmptyString(event.actor.actor_type) || !isNonEmptyString(event.actor.actor_id)) return "review_event_schema_invalid";
  if (event.event_type === "customer_remediation_recorded" && (!isRecord(event.actor) || event.actor.actor_type !== "customer_user")) {
    return "review_event_customer_remediation_actor_required";
  }
  if (!Array.isArray(event.identity_input_excludes) || event.identity_input_excludes.length !== 1 || event.identity_input_excludes[0] !== "event_id") {
    return "review_event_identity_excludes_invalid";
  }
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return "review_event_internal_note_requires_internal_only";
  }
  if (event.reason !== undefined) {
    if (sourceTextForbiddenPhrase(event.reason) !== undefined || sourceCodeLikeTextReason(event.reason) !== undefined) {
      return "review_event_reason_raw_source_text_forbidden";
    }
    if (claimSafeForbiddenPhrase(event.reason) !== undefined || (event.visibility === "customer_facing" && customerProseForbidden(event.reason))) {
      return "review_event_reason_claim_unsafe_text_forbidden";
    }
  }
  if (event.event_type === "classification_recorded" && (!isRecord(event.actor) || event.actor.actor_type !== "reviewer")) {
    return "review_event_classification_reviewer_actor_required";
  }
  if (event.event_type === "remediation_guidance_recorded" && (!isRecord(event.actor) || event.actor.actor_type !== "reviewer")) {
    return "review_event_remediation_guidance_reviewer_actor_required";
  }
  if (event.event_type === "validation_recorded" && (!isRecord(event.actor) || event.actor.actor_type !== "reviewer")) {
    return "review_event_validation_reviewer_actor_required";
  }
  if (event.event_type === "false_positive_recorded" && (!isRecord(event.actor) || event.actor.actor_type !== "reviewer")) {
    return "review_event_false_positive_reviewer_actor_required";
  }
  if (event.event_type === "customer_accepted_risk_recorded") {
    const actorType = isRecord(event.actor) ? event.actor.actor_type : undefined;
    if (actorType !== "customer_user" && actorType !== "reviewer" && actorType !== "vendor_service") {
      return "review_event_accepted_risk_customer_evidence_required";
    }
    if (!acceptedRiskEventReasonCarriesCustomerEvidence(event.reason)) {
      return "review_event_accepted_risk_customer_evidence_required";
    }
  }
  if (event.event_type === "verification_scope_recorded") {
    const actorType = isRecord(event.actor) ? event.actor.actor_type : undefined;
    if ((actorType !== "customer_user" && actorType !== "reviewer" && actorType !== "vendor_service") || verificationScopeActorIsForbiddenMachine(event.actor)) {
      return "review_event_verification_scope_actor_required";
    }
    if (actorType !== "customer_user" && !verificationScopeEventCarriesCustomerBacking(event)) {
      return "review_event_verification_scope_customer_backing_required";
    }
    if (verificationScopeTextHasForbiddenContent(event.reason)) {
      return "review_event_verification_scope_reason_claim_unsafe_text_forbidden";
    }
  }
  if (event.event_type === "verification_evidence_recorded") {
    const actorType = isRecord(event.actor) ? event.actor.actor_type : undefined;
    if (actorType !== "customer_user" && actorType !== "vendor_service") {
      return "review_event_verification_evidence_actor_required";
    }
    if (actorType === "vendor_service" && !isNonEmptyString(event.customer_actor_ref)) {
      return "review_event_verification_evidence_customer_backing_required";
    }
    if (verificationArtifactTextHasForbiddenContent(event.reason)) {
      return "review_event_verification_evidence_reason_claim_unsafe_text_forbidden";
    }
  }
  if (event.event_type === "verification_recorded") {
    if (!isRecord(event.actor) || event.actor.actor_type !== "reviewer") {
      return "review_event_verification_record_reviewer_actor_required";
    }
    if (verificationArtifactTextHasForbiddenContent(event.reason)) {
      return "review_event_verification_record_reason_claim_unsafe_text_forbidden";
    }
  }
  if (event.event_type === "attestation_generated" && (!isRecord(event.actor) || !["reviewer", "vendor_service"].includes(String(event.actor.actor_type)) || event.visibility !== "customer_facing")) return "review_event_epic5_authority_invalid";
  if (event.event_type === "static_bundle_generated" && (!isRecord(event.actor) || event.actor.actor_type !== "vendor_service" || event.visibility !== "customer_facing")) return "review_event_epic5_authority_invalid";
  if ((event.event_type === "attestation_package_finalized" || event.event_type === "attestation_package_exported") && (!isRecord(event.actor) || event.actor.actor_type !== "customer_user" || event.visibility !== "customer_facing")) return "review_event_epic5_authority_invalid";
  if ((event.event_type === "pilot_metric_recorded" || event.event_type === "pilot_feedback_recorded") && (!isRecord(event.actor) || !["reviewer", "vendor_service"].includes(String(event.actor.actor_type)) || event.visibility !== "internal_only" || event.reason !== undefined)) return "review_event_epic5_authority_invalid";
  // C4-28: the builder enforces an opaque actor ID, but a resealed/forged
  // event reaching the log directly (bypassing the builder) must fail
  // closed on the same rule -- the record itself isn't part of the event,
  // but the event's own actor.actor_id mirrors record.recorded_by.actor_id
  // (enforced by actorsEqual at build time) so this check is meaningful here.
  if ((event.event_type === "pilot_metric_recorded" || event.event_type === "pilot_feedback_recorded") && isRecord(event.actor) && !opaquePilotActorIdIsValid(event.actor.actor_type, event.actor.actor_id)) return "review_event_pilot_pii_forbidden";
  if ((event.event_type === "false_positive_recorded" || event.event_type === "customer_accepted_risk_recorded") && event.supersedes_classification_record_ref !== undefined) {
    return "review_event_outcome_supersedes_family_mismatch";
  }
  if (!typedReviewEventArtifactRefsMatch(event)) {
    return "review_event_schema_invalid";
  }
  if (RETENTION_STATE_EVENT_TYPES.has(event.event_type) && event.source_derived_class === undefined) {
    return "review_event_missing_source_derived_class";
  }
  return undefined;
}

async function rejectionForEvent(event: ReviewEvent): Promise<ReviewEventAppendRejectionReason | undefined> {
  const semanticRejection = rejectionForReviewEventSemantics(event);
  if (semanticRejection !== undefined) {
    return semanticRejection;
  }
  let computedEventId: string;
  try {
    computedEventId = await computeReviewEventId(event);
  } catch {
    // An event whose content cannot be canonicalized has no verifiable
    // identity; that is a typed rejection, never a thrown append.
    return "review_event_identity_mismatch";
  }
  if (computedEventId !== event.event_id) {
    return "review_event_identity_mismatch";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Story 2.5: evidence storage classification, access controls, deletion events
//
// Pure and dependency-free by design: this boundary produces and enforces
// protocol artifacts in memory only. It performs no encryption, custody, IAM,
// or storage of its own — those are pilot-hardening concerns behind the
// Story 2.0 environment evidence gate — and it never accepts, stores, or emits
// source-derived content. Every rejection is a stable reason code, never a
// message carrying artifact bytes.
// ---------------------------------------------------------------------------

export type StoredObjectClassification = ProtocolStoredObjectClassification;
export type EvidenceLifecycleEvent = ProtocolEvidenceLifecycleEvent;
export type DeletionEvidence = ProtocolDeletionEvidence;
export type RetentionOptInRecord = ProtocolRetentionOptInRecord;
export type EvidenceMinimizationProjection = ProtocolEvidenceMinimizationProjection;
export type EvidenceMinimizationEntry = NonNullable<EvidenceMinimizationProjection["entries"][number]>;
export type EnvironmentProfile = StoredObjectClassification["environment_profile"];

const REAL_SNIPPET_READY_PROFILE: EnvironmentProfile = "partner_pilot_real_snippet_ready";

/** Kinds that must never be able to carry customer source, not even transiently. */
const NON_SOURCE_OBJECT_KINDS = new Set<StoredObjectClassification["object_kind"]>([
  "log_or_trace",
  "analytics_record",
  "crash_report",
  "support_attachment"
]);
const NON_SOURCE_ALLOWED_CLASSES = new Set<RetentionSourceDerivedClass>([
  "never_collected",
  "retained_review_artifact"
]);
const SENSITIVE_SOURCE_CLASSES = new Set<RetentionSourceDerivedClass>([
  "transient_source_derived",
  "customer_opt_in_retained_source"
]);
const LIFECYCLE_CLASS_BEARING_EVENT_TYPES = new Set<EvidenceLifecycleEvent["event_type"]>([
  "evidence_deleted",
  "retention_status_changed"
]);
/**
 * Access control is default-deny: a role that is not one of the MVP roles is
 * not "unrecognized and therefore harmless", it is not permitted.
 */
const EVIDENCE_ACCESS_ROLES = new Set<string>([
  "customer_admin",
  "customer_viewer",
  "codeattest_reviewer",
  "codeattest_ops",
  "evidence_consumer_static"
]);

/** Category -> the single retention/source-derived class that category may declare. */
// A Map, not an object literal: an object literal answers `constructor` and
// `toString` from `Object.prototype`, so the unknown-category branch below
// would never fire for those inputs.
const MINIMIZATION_CATEGORY_SOURCE_CLASS: ReadonlyMap<string, RetentionSourceDerivedClass> = new Map([
  ["retained_finding", "retained_review_artifact"],
  ["retained_metadata", "retained_review_artifact"],
  ["retained_attestation", "retained_review_artifact"],
  ["retained_customer_opt_in_snippet", "customer_opt_in_retained_source"],
  ["deleted_transient", "transient_source_derived"],
  ["never_collected", "never_collected"]
] as const);

export type StoredObjectRejectionReason =
  | "stored_object_schema_invalid"
  | "stored_object_forbidden_source_class"
  | "stored_object_opt_in_not_allowed";

export type StoredObjectClassificationResult =
  | { outcome: "classified"; classification: StoredObjectClassification }
  | { outcome: "rejected"; reason: StoredObjectRejectionReason };

/**
 * Every stored object declares exactly one retention/source-derived class.
 * Log, trace, analytics, crash-report, and support-attachment objects may only
 * ever declare a non-source class, and customer opt-in retained source stays
 * impossible outside the real-snippet-ready pilot profile.
 */
export function classifyStoredObject(candidate: StoredObjectClassification): StoredObjectClassificationResult {
  if (!isRecord(candidate)) {
    return { outcome: "rejected", reason: "stored_object_schema_invalid" };
  }

  if (NON_SOURCE_OBJECT_KINDS.has(candidate.object_kind) && !NON_SOURCE_ALLOWED_CLASSES.has(candidate.source_derived_class)) {
    return { outcome: "rejected", reason: "stored_object_forbidden_source_class" };
  }

  if (candidate.source_derived_class === "customer_opt_in_retained_source" && candidate.environment_profile !== REAL_SNIPPET_READY_PROFILE) {
    return { outcome: "rejected", reason: "stored_object_opt_in_not_allowed" };
  }

  if (validateProtocolSchema("urn:codeattest:protocol:v0:stored-object-classification", candidate).length > 0) {
    return { outcome: "rejected", reason: "stored_object_schema_invalid" };
  }

  const classification = cloneJson(candidate);
  if (classification === undefined) {
    return { outcome: "rejected", reason: "stored_object_schema_invalid" };
  }

  // A clone, so a caller holding the input cannot flip a field after it passed.
  return { outcome: "classified", classification };
}

export type EvidenceLifecycleAppendRejectionReason =
  | "evidence_event_schema_invalid"
  | "evidence_event_not_append_only"
  | "deletion_event_missing_deletion_evidence"
  | "deletion_event_deletion_evidence_unresolved"
  | "access_event_missing_scope"
  | "access_event_scope_mismatch"
  | "evidence_event_missing_source_derived_class"
  | "evidence_event_review_id_mismatch"
  | "retention_event_missing_retention_record"
  | "retention_event_record_unresolved";

export type EvidenceLifecycleAppendResult =
  | { outcome: "appended"; events: EvidenceLifecycleEvent[] }
  | { outcome: "idempotent_noop"; events: EvidenceLifecycleEvent[] }
  | { outcome: "rejected"; reason: EvidenceLifecycleAppendRejectionReason; events: EvidenceLifecycleEvent[] };

/**
 * Companion artifacts a lifecycle event's own references must resolve
 * against at append time — a reference string alone proves nothing. Optional
 * so a malformed JavaScript caller that omits it gets a typed rejection
 * (`retention_event_record_unresolved` / `deletion_event_deletion_evidence_unresolved`)
 * instead of throwing.
 */
export type EvidenceLifecycleAppendContext = {
  retention_opt_in_records?: readonly RetentionOptInRecord[];
  deletion_evidence?: readonly DeletionEvidence[];
};

/**
 * Append-only in memory: the returned array is always new, no prior element is
 * altered, and a new event must carry a `sequence_number` strictly greater than
 * every one already present. Replaying an identical body under an already-used
 * `idempotency_key` is a no-op; a different body under that key would rewrite
 * history and is rejected instead.
 *
 * Deliberately not Story 2.4's log: identities here are stable pattern strings,
 * not content-addressed hashes, and nothing is chained or persisted.
 */
export function appendEvidenceLifecycleEvent(
  events: readonly EvidenceLifecycleEvent[],
  event: EvidenceLifecycleEvent,
  context: EvidenceLifecycleAppendContext = {}
): EvidenceLifecycleAppendResult {
  if (!Array.isArray(events)) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: [] };
  }

  const unchanged = cloneJson(events);
  if (unchanged === undefined) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: [] };
  }

  // Prior entries receive only shallow checks below (shape, sequence numbers)
  // unless validated as one append-only, review-bound log first: schema,
  // event-local semantics, safe strictly-increasing sequence, unique
  // identities, backward-only supersession, and one shared review_id.
  const historyRejection = evidenceLifecycleHistoryRejection(unchanged);
  if (historyRejection !== undefined) {
    return { outcome: "rejected", reason: historyRejection, events: unchanged };
  }

  if (!isRecord(event)) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: unchanged };
  }

  const historyReviewId = unchanged[0]?.review_id;
  if (historyReviewId !== undefined && event.review_id !== historyReviewId) {
    return { outcome: "rejected", reason: "evidence_event_review_id_mismatch", events: unchanged };
  }

  const sameKey = events.find((existing) => existing.idempotency_key === event.idempotency_key);
  if (sameKey !== undefined) {
    if (!stableEquals(sameKey, event)) {
      return { outcome: "rejected", reason: "evidence_event_not_append_only", events: unchanged };
    }
    // An exact-match replay must still resolve its companions with *this
    // call's* context — otherwise a caller could get a trusted-looking
    // `idempotent_noop` for a deletion/retention event by simply omitting
    // the companion data on a later call.
    const replayCompanionRejection = rejectionForLifecycleEventCompanions(event, context);
    if (replayCompanionRejection !== undefined) {
      return { outcome: "rejected", reason: replayCompanionRejection, events: unchanged };
    }
    return { outcome: "idempotent_noop", events: unchanged };
  }

  if (events.some((existing) => existing.event_id === event.event_id)) {
    return { outcome: "rejected", reason: "evidence_event_not_append_only", events: unchanged };
  }

  if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number < 0) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: unchanged };
  }

  if (events.some((existing) => existing.sequence_number >= event.sequence_number)) {
    return { outcome: "rejected", reason: "evidence_event_not_append_only", events: unchanged };
  }

  // A supersedes link that names the event itself, or names nothing already in
  // the log, is a rewrite channel rather than a correction.
  if (event.supersedes_event_id !== undefined) {
    const supersededId = event.supersedes_event_id;
    if (supersededId === event.event_id || !events.some((existing) => existing.event_id === supersededId)) {
      return { outcome: "rejected", reason: "evidence_event_not_append_only", events: unchanged };
    }
  }

  const guardRejection = rejectionForLifecycleEvent(event);
  if (guardRejection !== undefined) {
    return { outcome: "rejected", reason: guardRejection, events: unchanged };
  }

  // Schema backstop runs before companion resolution: an intrinsically
  // malformed event must report as malformed, not shadowed by an unresolved
  // (context-dependent) companion reference it happens to still carry.
  if (validateProtocolSchema("urn:codeattest:protocol:v0:evidence-lifecycle-event", event).length > 0) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: unchanged };
  }

  const companionRejection = rejectionForLifecycleEventCompanions(event, context);
  if (companionRejection !== undefined) {
    return { outcome: "rejected", reason: companionRejection, events: unchanged };
  }

  const appendedEvent = cloneJson(event);
  if (appendedEvent === undefined) {
    return { outcome: "rejected", reason: "evidence_event_schema_invalid", events: unchanged };
  }

  // `unchanged` is already a deep clone, so nothing in the returned log shares a
  // nested object with the caller's input.
  return { outcome: "appended", events: [...unchanged, appendedEvent] };
}

export type RetentionOptInRejectionReason =
  | "retention_opt_in_schema_invalid"
  | "retention_opt_in_not_allowed"
  | "retention_period_invalid";

export type RetentionOptInResult =
  | { outcome: "recorded"; record: RetentionOptInRecord }
  | { outcome: "rejected"; reason: RetentionOptInRejectionReason };

/**
 * Customer opt-in retention is only recordable under the real-snippet-ready
 * pilot profile, and only with a bounded period, a customer approval
 * reference, and the retained artifact identities (the latter two are schema
 * `required`, so the schema backstop is what proves them).
 */
export function recordOptInRetention(
  record: RetentionOptInRecord,
  environmentProfile: EnvironmentProfile
): RetentionOptInResult {
  if (!isRecord(record)) {
    return { outcome: "rejected", reason: "retention_opt_in_schema_invalid" };
  }

  if (environmentProfile !== REAL_SNIPPET_READY_PROFILE) {
    return { outcome: "rejected", reason: "retention_opt_in_not_allowed" };
  }

  const period: RetentionOptInRecord["retention_period"] | undefined = record.retention_period;
  if (period === null || typeof period !== "object" || typeof period.start_timestamp !== "string" || typeof period.end_timestamp !== "string") {
    return { outcome: "rejected", reason: "retention_opt_in_schema_invalid" };
  }

  const start = parseUtcTimestampNs(period.start_timestamp);
  const end = parseUtcTimestampNs(period.end_timestamp);
  if (start === undefined || end === undefined || end <= start) {
    return { outcome: "rejected", reason: "retention_period_invalid" };
  }

  if (validateProtocolSchema("urn:codeattest:protocol:v0:retention-opt-in-record", record).length > 0) {
    return { outcome: "rejected", reason: "retention_opt_in_schema_invalid" };
  }

  const recorded = cloneJson(record);
  if (recorded === undefined) {
    return { outcome: "rejected", reason: "retention_opt_in_schema_invalid" };
  }

  return { outcome: "recorded", record: recorded };
}

/** MVP roles from the minimal-RBAC decision; all reads stay tenant/review scoped. */
export type EvidenceAccessRole =
  | "customer_admin"
  | "customer_viewer"
  | "codeattest_reviewer"
  | "codeattest_ops"
  | "evidence_consumer_static";

export type EvidenceAccessRequest = {
  actor: EvidenceLifecycleEvent["actor"];
  /** Typed for callers; validated at runtime because real callers are JSON. */
  role: EvidenceAccessRole;
  tenant_id: string;
  review_scope: string;
  artifact: {
    artifact_ref: string;
    tenant_id: string;
    review_scope: string;
    source_derived_class: RetentionSourceDerivedClass;
  };
  event_id: string;
  idempotency_key: string;
  event_timestamp: string;
  purpose?: string;
};

export type EvidenceAccessDenialReason =
  | "access_request_invalid"
  | "access_denied_out_of_scope"
  | "access_denied_role_not_permitted"
  | "access_event_not_appendable";

export type EvidenceAccessResult =
  | { decision: "allowed"; event: EvidenceLifecycleEvent; events: EvidenceLifecycleEvent[] }
  | { decision: "denied"; reason: EvidenceAccessDenialReason; events: EvidenceLifecycleEvent[] };

/**
 * Sensitive artifact inspection is tenant/review scoped and leaves a receipt:
 * an allowed inspection appends an `evidence_accessed` event carrying actor,
 * timestamp, artifact reference, scope, and purpose where available. A denial
 * appends nothing, so no event can ever imply an inspection that did not happen.
 */
export function enforceScopedAccess(
  events: readonly EvidenceLifecycleEvent[],
  request: EvidenceAccessRequest
): EvidenceAccessResult {
  if (!Array.isArray(events) || !events.every((existing) => isPlainObjectValue(existing))) {
    return { decision: "denied", reason: "access_request_invalid", events: [] };
  }

  const unchanged = cloneJson(events);
  if (unchanged === undefined) {
    return { decision: "denied", reason: "access_request_invalid", events: [] };
  }

  if (!isRecord(request) || !isRecord(request.artifact) || !isRecord(request.actor)) {
    return { decision: "denied", reason: "access_request_invalid", events: unchanged };
  }

  // Default-deny: only the MVP roles are roles. An unrecognized string is not a
  // role that happens to be unlisted, it is no role at all.
  if (!EVIDENCE_ACCESS_ROLES.has(request.role)) {
    return { decision: "denied", reason: "access_denied_role_not_permitted", events: unchanged };
  }

  // Scope fields must be present before they are compared: `undefined ===
  // undefined` would otherwise pass the scope check vacuously and surface as a
  // downstream append failure rather than as the malformed request it is.
  if (!isNonEmptyString(request.tenant_id) || !isNonEmptyString(request.review_scope)) {
    return { decision: "denied", reason: "access_request_invalid", events: unchanged };
  }

  if (request.artifact.tenant_id !== request.tenant_id || request.artifact.review_scope !== request.review_scope) {
    return { decision: "denied", reason: "access_denied_out_of_scope", events: unchanged };
  }

  // The static evidence consumer reads published attestation surfaces only; it
  // is never a party to source-derived evidence.
  if (request.role === "evidence_consumer_static" && SENSITIVE_SOURCE_CLASSES.has(request.artifact.source_derived_class)) {
    return { decision: "denied", reason: "access_denied_role_not_permitted", events: unchanged };
  }

  // A replay must rebuild the *same* event, so reuse the recorded sequence
  // number when this inspection is already in the log. Deriving a fresh one
  // would make an identical replay look like a different body under a used key.
  const recorded = events.find((existing) => existing.idempotency_key === request.idempotency_key);
  let sequenceNumber: number;
  try {
    sequenceNumber = recorded === undefined ? nextSequenceNumber(events) : recorded.sequence_number;
  } catch {
    return { decision: "denied", reason: "access_event_not_appendable", events };
  }

  const accessEvent: EvidenceLifecycleEvent = {
    protocol_version: "codeattest.v0",
    event_id: request.event_id,
    review_id: request.review_scope,
    sequence_number: sequenceNumber,
    idempotency_key: request.idempotency_key,
    event_type: "evidence_accessed",
    actor: request.actor,
    event_timestamp: request.event_timestamp,
    artifact_refs: [request.artifact.artifact_ref],
    source_derived_class: request.artifact.source_derived_class,
    access_scope: { tenant_id: request.tenant_id, review_scope: request.review_scope },
    ...(request.purpose === undefined ? {} : { purpose: request.purpose })
  };

  const appended = appendEvidenceLifecycleEvent(events, accessEvent);
  if (appended.outcome !== "appended" && appended.outcome !== "idempotent_noop") {
    return { decision: "denied", reason: "access_event_not_appendable", events: unchanged };
  }

  // The receipt handed back is a deep copy like every other artifact this
  // boundary returns: `accessEvent.actor` is the caller's own object, so
  // returning it directly would let a caller mutate an event that already
  // passed validation.
  const emitted = cloneJson(accessEvent);
  if (emitted === undefined) {
    return { decision: "denied", reason: "access_request_invalid", events: unchanged };
  }

  // Replaying an identical in-scope inspection is idempotent, not a denial: the
  // access already happened and is already recorded, so the caller is allowed
  // and the log is returned unchanged.
  return { decision: "allowed", event: emitted, events: appended.events };
}

export type MinimizationProjectionRejectionReason =
  | "minimization_projection_schema_invalid"
  | "minimization_category_class_mismatch"
  | "minimization_deleted_without_evidence"
  | "minimization_deletion_evidence_unresolved"
  | "minimization_artifact_category_conflict";

export type MinimizationProjectionResult =
  | { outcome: "projected"; projection: EvidenceMinimizationProjection }
  | { outcome: "rejected"; reason: MinimizationProjectionRejectionReason };

/**
 * The six minimization categories stay visibly distinct: each pins exactly one
 * retention/source-derived class, and every `deleted_transient` entry must
 * resolve to a Deletion Evidence artifact that was actually supplied — a
 * dangling reference is a rejection, not a rendered claim of deletion.
 */
export function buildEvidenceMinimizationProjection(
  input: {
    protocol_version: EvidenceMinimizationProjection["protocol_version"];
    review_id: string;
    entries: readonly EvidenceMinimizationEntry[];
  },
  deletionEvidence: readonly DeletionEvidence[]
): MinimizationProjectionResult {
  if (!isRecord(input) || !Array.isArray(input.entries)) {
    return { outcome: "rejected", reason: "minimization_projection_schema_invalid" };
  }

  if (!Array.isArray(deletionEvidence) || !everyDeletionEvidenceItemIsSchemaValid(deletionEvidence)) {
    return { outcome: "rejected", reason: "minimization_projection_schema_invalid" };
  }

  const knownDeletionEvidenceIds = new Set(deletionEvidence.map((evidence) => evidence.deletion_evidence_id));
  const categoryByArtifactRef = new Map<string, string>();

  for (const entry of input.entries) {
    if (entry === null || typeof entry !== "object") {
      return { outcome: "rejected", reason: "minimization_projection_schema_invalid" };
    }

    const category: EvidenceMinimizationEntry["minimization_category"] = entry.minimization_category;
    const expectedClass = MINIMIZATION_CATEGORY_SOURCE_CLASS.get(category);
    if (expectedClass === undefined || entry.source_derived_class !== expectedClass) {
      return { outcome: "rejected", reason: "minimization_category_class_mismatch" };
    }

    // One artifact cannot be both deleted and retained: a projection that says
    // so is not a minimization statement, it is two contradictory claims.
    const priorCategory = categoryByArtifactRef.get(entry.artifact_ref);
    if (priorCategory !== undefined && priorCategory !== category) {
      return { outcome: "rejected", reason: "minimization_artifact_category_conflict" };
    }
    categoryByArtifactRef.set(entry.artifact_ref, category);

    if (category === "deleted_transient") {
      if (entry.deletion_evidence_ref === undefined) {
        return { outcome: "rejected", reason: "minimization_deleted_without_evidence" };
      }
      if (!knownDeletionEvidenceIds.has(entry.deletion_evidence_ref)) {
        return { outcome: "rejected", reason: "minimization_deletion_evidence_unresolved" };
      }
    }
  }

  const projection: EvidenceMinimizationProjection = {
    protocol_version: input.protocol_version,
    review_id: input.review_id,
    entries: input.entries.map((entry) => ({ ...entry })) as EvidenceMinimizationProjection["entries"]
  };

  const clonedProjection = cloneJson(projection);
  if (clonedProjection === undefined) {
    return { outcome: "rejected", reason: "minimization_projection_schema_invalid" };
  }

  if (validateProtocolSchema("urn:codeattest:protocol:v0:evidence-minimization-projection", projection).length > 0) {
    return { outcome: "rejected", reason: "minimization_projection_schema_invalid" };
  }

  return { outcome: "projected", projection: clonedProjection };
}

// ---------------------------------------------------------------------------
// Story 2.6: submission failure and quarantine states
//
// Intake produces a first-class submission outcome. This boundary builds the
// review-event that records a failed/quarantined outcome in the existing Story
// 2.4 review-event-log and projects the same outcome into a claim-safe notice.
// It adds no second history artifact and no second append path: callers append
// the returned event with appendReviewEvent.
// ---------------------------------------------------------------------------

export type SubmissionOutcome = ProtocolSubmissionOutcome;
export type SubmissionOutcomeIdentity = NonNullable<SubmissionOutcome["submission_identities"][number]>;
export type SubmissionFailureNoticeAudience = "customer" | "vendor" | "ops";

export type SubmissionOutcomeRejectionReason =
  | "submission_outcome_schema_invalid"
  | "submission_outcome_receipt_required"
  | "submission_outcome_failure_must_not_reference_receipt"
  | "submission_outcome_failure_requires_reason_codes"
  | "submission_outcome_received_must_not_carry_reason_codes"
  | "submission_outcome_next_path_state_mismatch"
  | "submission_outcome_summary_implies_review"
  | "submission_outcome_summary_text_forbidden"
  | "submission_outcome_identity_value_text_forbidden"
  | "submission_outcome_duplicate_identity_type"
  | "submission_outcome_identity_field_mismatch";

export type SubmissionOutcomeEventBuildRejectionReason =
  | SubmissionOutcomeRejectionReason
  | "submission_event_state_not_a_failure"
  | "submission_event_type_state_mismatch"
  | "submission_event_missing_outcome_ref"
  | "submission_event_idempotency_key_not_derived"
  | "submission_event_schema_invalid";

export type SubmissionOutcomeEventEnvelope = {
  event_id: string;
  sequence_number: number;
  actor: ReviewEvent["actor"];
  visibility: ReviewEvent["visibility"];
  /** Optional override used by tests and defensive callers to reject contradictions explicitly. */
  event_type?: ReviewEvent["event_type"];
  event_timestamp?: string;
  artifact_refs?: string[];
  idempotency_key?: string;
};

export type SubmissionOutcomeEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: SubmissionOutcomeEventBuildRejectionReason };

/** Protocol next paths the *system* can offer, keyed by the state that can offer them. */
const SUBMISSION_OUTCOME_STATE_NEXT_PATHS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["received_with_receipt", new Set(["verify_receipt"])],
  ["rejected_no_receipt", new Set(["retry", "contact_support"])],
  ["quarantined_no_receipt", new Set(["quarantine_support", "contact_support"])]
]);

const SUBMISSION_FAILURE_EVENT_TYPE_BY_STATE: ReadonlyMap<string, ReviewEvent["event_type"]> = new Map([
  ["rejected_no_receipt", "submission_rejected"],
  ["quarantined_no_receipt", "submission_quarantined"]
]);

export type SubmissionFailureNotice = {
  outcome_state: "rejected_no_receipt" | "quarantined_no_receipt";
  review_id: string;
  submission_outcome_id: string;
  occurred_at: string;
  submission_identities: SubmissionOutcomeIdentity[];
  failure_reason_codes: string[];
  /** The outcome's own next path plus a support path for audience-gated rendering. */
  next_paths: SubmissionOutcome["next_path"][];
  customer_facing_summary: string;
  audience: SubmissionFailureNoticeAudience;
};

/**
 * Builds the review event that records a failed submission outcome in the
 * existing review-event-log. The returned event still flows through
 * appendReviewEvent, which owns append-only ordering and idempotency conflicts.
 */
export function buildSubmissionOutcomeEvent(
  outcome: SubmissionOutcome,
  envelope: SubmissionOutcomeEventEnvelope
): SubmissionOutcomeEventBuildResult {
  if (!isRecord(outcome) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "submission_outcome_schema_invalid" };
  }

  const outcomeRejection = rejectionForSubmissionOutcome(outcome);
  if (outcomeRejection !== undefined) {
    return { outcome: "rejected", reason: outcomeRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:submission-outcome", outcome).length > 0) {
    return { outcome: "rejected", reason: "submission_outcome_schema_invalid" };
  }

  const expectedEventType = SUBMISSION_FAILURE_EVENT_TYPE_BY_STATE.get(outcome.outcome_state);
  if (expectedEventType === undefined) {
    return { outcome: "rejected", reason: "submission_event_state_not_a_failure" };
  }

  const requestedEventType = envelope.event_type ?? expectedEventType;
  if (requestedEventType !== expectedEventType) {
    return { outcome: "rejected", reason: "submission_event_type_state_mismatch" };
  }

  const expectedArtifactRef = submissionOutcomeArtifactRef(outcome);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!exactSingletonRef(artifactRefs, expectedArtifactRef)) {
    return { outcome: "rejected", reason: "submission_event_missing_outcome_ref" };
  }

  const expectedIdempotencyKey = submissionEventIdempotencyKey(outcome);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "submission_event_idempotency_key_not_derived" };
  }

  const event: ReviewEvent = {
    protocol_version: outcome.protocol_version,
    event_id: envelope.event_id,
    review_id: outcome.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: expectedEventType,
    actor: envelope.actor,
    event_timestamp: envelope.event_timestamp ?? outcome.occurred_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility: envelope.visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason: outcome.customer_facing_summary
  };

  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "submission_event_schema_invalid" };
  }

  return { outcome: "built", event };
}

/**
 * A success never renders as a blocking warning, so `received_with_receipt`
 * projects to `null` rather than to a softened notice.
 */
export function projectSubmissionFailureNotice(
  outcome: SubmissionOutcome,
  audience: SubmissionFailureNoticeAudience = "customer"
): SubmissionFailureNotice | null {
  if (!isRecord(outcome)) {
    return null;
  }
  if (outcome.outcome_state !== "rejected_no_receipt" && outcome.outcome_state !== "quarantined_no_receipt") {
    return null;
  }
  if (rejectionForSubmissionOutcome(outcome) !== undefined) {
    return null;
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:submission-outcome", outcome).length > 0) {
    return null;
  }

  const nextPaths: SubmissionOutcome["next_path"][] = [outcome.next_path];
  if (!nextPaths.includes("contact_support")) {
    nextPaths.push("contact_support");
  }

  return {
    outcome_state: outcome.outcome_state,
    review_id: outcome.review_id,
    submission_outcome_id: outcome.submission_outcome_id,
    occurred_at: outcome.occurred_at,
    submission_identities: outcome.submission_identities.map((identity) => ({ ...identity })),
    failure_reason_codes: [...(outcome.failure_reason_codes ?? [])],
    next_paths: nextPaths,
    customer_facing_summary: outcome.customer_facing_summary,
    audience: isSubmissionFailureNoticeAudience(audience) ? audience : "customer"
  };
}

/**
 * The three outcome states stay mutually exclusive: a failure carries reason
 * codes and no receipt, a receipted success carries a receipt and no reason
 * codes, and neither may offer a next path its state cannot back.
 */
function rejectionForSubmissionOutcome(outcome: SubmissionOutcome): SubmissionOutcomeRejectionReason | undefined {
  if (!isRecord(outcome)) {
    return "submission_outcome_schema_invalid";
  }
  const identityRejection = rejectionForSubmissionIdentities(outcome);
  if (identityRejection !== undefined) {
    return identityRejection;
  }
  const isFailure = outcome.outcome_state === "rejected_no_receipt" || outcome.outcome_state === "quarantined_no_receipt";
  const reasonCodes = Array.isArray(outcome.failure_reason_codes) ? outcome.failure_reason_codes : [];

  if (outcome.outcome_state === "received_with_receipt" && outcome.vendor_receipt_ref === undefined) {
    return "submission_outcome_receipt_required";
  }
  if (isFailure && outcome.vendor_receipt_ref !== undefined) {
    return "submission_outcome_failure_must_not_reference_receipt";
  }
  if (isFailure && reasonCodes.length === 0) {
    return "submission_outcome_failure_requires_reason_codes";
  }
  if (outcome.outcome_state === "received_with_receipt" && reasonCodes.length > 0) {
    return "submission_outcome_received_must_not_carry_reason_codes";
  }
  const allowedNextPaths = SUBMISSION_OUTCOME_STATE_NEXT_PATHS.get(outcome.outcome_state);
  if (allowedNextPaths !== undefined && !allowedNextPaths.has(outcome.next_path)) {
    return "submission_outcome_next_path_state_mismatch";
  }
  if (isFailure && claimSafeForbiddenPhrase(outcome.customer_facing_summary) !== undefined) {
    return "submission_outcome_summary_implies_review";
  }
  // Append-time review-event text checks (raw-source, claim-unsafe, PII) do
  // not run here: this projector is independently callable straight off a
  // stored SubmissionOutcome artifact. Scoped to failure states like the
  // claim-overreach check above — a "received" summary is expected to
  // reference vendor-receipt language that would be claim-unsafe elsewhere.
  if (isFailure && epic5NarrativeTextForbidden(outcome.customer_facing_summary)) {
    return "submission_outcome_summary_text_forbidden";
  }
  if (isFailure && Array.isArray(outcome.submission_identities) && outcome.submission_identities.some((row) => isRecord(row) && epic5NarrativeTextForbidden(row.identity_value))) {
    return "submission_outcome_identity_value_text_forbidden";
  }
  return undefined;
}

/**
 * `submission_identities` rows are schema-`uniqueItems`, which only forbids
 * an exact (type, value) duplicate — two `bundle_instance_id` rows with
 * *different* values, or a `bundle_instance_id`/`submission_attempt_id` row
 * that disagrees with the outcome's own top-level fields, both pass the
 * schema. This requires at most one row per `identity_type`, and requires
 * the `bundle_instance_id`/`submission_attempt_id` rows to be present and
 * equal the top-level fields they name.
 */
function rejectionForSubmissionIdentities(outcome: SubmissionOutcome): SubmissionOutcomeRejectionReason | undefined {
  if (!Array.isArray(outcome.submission_identities)) {
    return "submission_outcome_schema_invalid";
  }
  const countByType = new Map<string, number>();
  for (const row of outcome.submission_identities) {
    if (!isRecord(row) || typeof row.identity_type !== "string") {
      return "submission_outcome_schema_invalid";
    }
    // C5-22 defense in depth: the schema's `identity_value` is untyped
    // regardless of `identity_type` (`manifest_id:"secret=..."` is schema-
    // valid); the control plane must not trust a producer to have already
    // enforced the per-type grammar.
    if (!submissionIdentityValueMatchesGrammar(row.identity_type, row.identity_value)) {
      return "submission_outcome_schema_invalid";
    }
    countByType.set(row.identity_type, (countByType.get(row.identity_type) ?? 0) + 1);
  }
  if ([...countByType.values()].some((count) => count > 1)) {
    return "submission_outcome_duplicate_identity_type";
  }
  const bundleRow = outcome.submission_identities.find((row) => isRecord(row) && row.identity_type === "bundle_instance_id");
  const attemptRow = outcome.submission_identities.find((row) => isRecord(row) && row.identity_type === "submission_attempt_id");
  if (
    bundleRow === undefined || attemptRow === undefined ||
    bundleRow.identity_value !== outcome.bundle_instance_id || attemptRow.identity_value !== outcome.submission_attempt_id
  ) {
    return "submission_outcome_identity_field_mismatch";
  }
  return undefined;
}

function submissionOutcomeArtifactRef(outcome: SubmissionOutcome): string {
  return `artifact_ref:${outcome.submission_outcome_id.slice("submission_outcome:".length)}`;
}

function submissionEventIdempotencyKey(outcome: SubmissionOutcome): string {
  return `submission_attempt:${outcome.bundle_instance_id}:${outcome.submission_attempt_id}`;
}

function isSubmissionFailureNoticeAudience(value: unknown): value is SubmissionFailureNoticeAudience {
  return value === "customer" || value === "vendor" || value === "ops";
}

// ---------------------------------------------------------------------------
// Story 3.2: reviewer classification records
//
// A classification is a typed protocol artifact authored by a CodeAttest
// reviewer. This boundary builds the append-only review event that records that
// artifact, but callers still append it with appendReviewEvent so ordering,
// idempotency, supersedes chains, and customer rewrite protection stay in one
// place.
// ---------------------------------------------------------------------------

export type FindingClassificationRecord = ProtocolFindingClassificationRecord;

export type FindingClassificationRejectionReason =
  | "finding_classification_schema_invalid"
  | "finding_classification_reviewer_actor_required"
  | "finding_classification_confirmed_criteria_required"
  | "finding_classification_confirmed_defensible_criteria_required"
  | "finding_classification_validation_path_required"
  | "finding_classification_evidence_basis_required"
  | "finding_classification_evidence_basis_not_bound_to_draft"
  | "finding_classification_source_reference_state_mismatch"
  | "finding_classification_limitations_required"
  | "finding_classification_forbidden_field"
  | "finding_classification_text_forbidden";

export type FindingClassificationEventBuildRejectionReason =
  | FindingClassificationRejectionReason
  | "classification_event_type_mismatch"
  | "classification_event_missing_record_ref"
  | "classification_event_actor_mismatch"
  | "classification_update_requires_prior_reference"
  | "classification_event_supersedes_mismatch"
  | "classification_event_idempotency_key_not_derived"
  | "classification_event_schema_invalid";

export type FindingClassificationEventEnvelope = {
  event_id: string;
  sequence_number: number;
  event_type?: ReviewEvent["event_type"];
  actor?: ReviewEvent["actor"];
  visibility?: ReviewEvent["visibility"];
  event_timestamp?: string;
  artifact_refs?: string[];
  idempotency_key?: string;
  supersedes_event_id?: string;
  reason?: string;
  internal_note?: string;
};

export type FindingClassificationEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: FindingClassificationEventBuildRejectionReason };

const CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS = new Set<FindingClassificationRecord["evidence_basis"][number]>([
  "scanner_output",
  "metadata_only",
  "deleted_under_policy_reference",
  "not_submitted_by_policy_reference",
  "never_collected_reference",
  "unresolved_reference"
]);

const CLASSIFICATION_FORBIDDEN_FIELDS = new Set([
  "remediation_implementation",
  "remediation_status",
  "customer_owner",
  "customer_status",
  "accepted_risk_record",
  "accepted_risk_rationale",
  "false_positive_rationale",
  "attestation_copy",
  "scanner_execution",
  "scanner_stdout",
  "scanner_stderr",
  "final_validation_script_body",
  "validation_script_body"
]);

const CLASSIFICATION_BASIS_DRAFT_EVIDENCE_RULES = new Map<FindingClassificationRecord["evidence_basis"][number], (ref: Record<string, unknown>) => boolean>([
  ["scanner_output", (ref) =>
    ref.artifact_ref === "artifact_ref:scanner_finding_set" &&
    ref.availability_state === "retained_review_artifact" &&
    ref.available_for_review === true &&
    ref.display_state === "available_reference"
  ],
  ["metadata_only", (ref) =>
    (ref.availability_state === "not_submitted_by_policy" && ref.display_state === "not_submitted") ||
    (ref.availability_state === "never_collected" && ref.display_state === "not_collected") ||
    (ref.availability_state === "retained_review_artifact" && ref.available_for_review === true && ref.display_state === "available_reference")
  ],
  ["finding_context_snippet", (ref) => ref.available_for_review === true && ref.display_state === "available_reference" && ref.source_derived_class !== "retained_review_artifact"],
  ["extended_approved_source_context", (ref) => ref.available_for_review === true && ref.display_state === "available_reference" && ref.source_derived_class === "customer_opt_in_retained_source"],
  ["retained_review_artifact", (ref) => ref.availability_state === "retained_review_artifact" && ref.available_for_review === true && ref.source_derived_class === "retained_review_artifact"],
  ["deleted_under_policy_reference", (ref) => ref.availability_state === "deleted_under_policy" && ref.display_state === "deleted" && isNonEmptyString(ref.deletion_evidence_ref)],
  ["not_submitted_by_policy_reference", (ref) => ref.availability_state === "not_submitted_by_policy" && ref.display_state === "not_submitted"],
  ["never_collected_reference", (ref) => ref.availability_state === "never_collected" && ref.display_state === "not_collected"],
  ["unresolved_reference", (ref) => ref.availability_state === "unresolved_reference" && ref.display_state === "unresolved_reference"]
]);

/**
 * Builds a `classification_recorded` review event that references the typed
 * finding-classification artifact. The record owns classification semantics;
 * the event remains a compact append-only envelope.
 */
export function buildFindingClassificationEvent(
  record: FindingClassificationRecord,
  envelope: FindingClassificationEventEnvelope
): FindingClassificationEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "finding_classification_schema_invalid" };
  }

  const classificationRejection = rejectionForFindingClassificationRecord(record);
  if (classificationRejection !== undefined) {
    return { outcome: "rejected", reason: classificationRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", record).length > 0) {
    return { outcome: "rejected", reason: "finding_classification_schema_invalid" };
  }

  if (envelope.event_type !== undefined && envelope.event_type !== "classification_recorded") {
    return { outcome: "rejected", reason: "classification_event_type_mismatch" };
  }

  const expectedArtifactRef = classificationRecordArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "classification_event_missing_record_ref" };
  }

  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "classification_event_actor_mismatch" };
  }

  const supersedesEventId = envelope.supersedes_event_id ?? record.supersedes_event_id;
  const isUpdate = record.supersedes_event_id !== undefined || record.supersedes_classification_record_ref !== undefined || supersedesEventId !== undefined;
  if (isUpdate && supersedesEventId === undefined && record.supersedes_classification_record_ref === undefined) {
    return { outcome: "rejected", reason: "classification_update_requires_prior_reference" };
  }
  if (envelope.supersedes_event_id !== undefined && record.supersedes_event_id !== undefined && envelope.supersedes_event_id !== record.supersedes_event_id) {
    return { outcome: "rejected", reason: "classification_event_supersedes_mismatch" };
  }

  const expectedIdempotencyKey = classificationEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "classification_event_idempotency_key_not_derived" };
  }

  const reason = classificationEventReason(record);
  if (envelope.reason !== undefined && envelope.reason !== reason) {
    return { outcome: "rejected", reason: "classification_event_schema_invalid" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "classification_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "classification_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.classified_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason,
    ...(supersedesEventId === undefined ? {} : { supersedes_event_id: supersedesEventId }),
    ...(record.supersedes_classification_record_ref === undefined ? {} : { supersedes_classification_record_ref: record.supersedes_classification_record_ref }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };

  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "classification_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "classification_event_schema_invalid" };
  }

  return { outcome: "built", event };
}

function rejectionForFindingClassificationRecord(
  record: FindingClassificationRecord
): FindingClassificationRejectionReason | undefined {
  if (!isRecord(record)) {
    return "finding_classification_schema_invalid";
  }

  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "finding_classification_reviewer_actor_required";
  }

  const evidenceBasis = Array.isArray(record.evidence_basis) ? record.evidence_basis : [];
  if (evidenceBasis.length === 0) {
    return "finding_classification_evidence_basis_required";
  }

  const classificationRecordFields = record as Record<string, unknown>;
  const draftEvidenceRefs = Array.isArray(classificationRecordFields["review_finding_draft_evidence_refs"])
    ? classificationRecordFields["review_finding_draft_evidence_refs"].filter(isRecord)
    : [];
  if (
    isNonEmptyString(classificationRecordFields["review_finding_draft_ref"]) &&
    (draftEvidenceRefs.length === 0 || !draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !classificationEvidenceBasisMatchesDraft(evidenceBasis, draftEvidenceRefs))
  ) {
    return "finding_classification_evidence_basis_not_bound_to_draft";
  }
  if (
    draftEvidenceRefs.length > 0 &&
    !classificationSourceReferenceStateMatchesDraft(record.source_reference_state, draftEvidenceRefs)
  ) {
    return "finding_classification_source_reference_state_mismatch";
  }

  const limitations = Array.isArray(record.limitations) ? record.limitations : [];
  if (limitations.length === 0) {
    return "finding_classification_limitations_required";
  }

  for (const field of CLASSIFICATION_FORBIDDEN_FIELDS) {
    if (classificationRecordFields[field] !== undefined) {
      return "finding_classification_forbidden_field";
    }
  }

  const criteria = Array.isArray(record.confirmation_criteria) ? record.confirmation_criteria : [];
  if (record.classification === "confirmed" && criteria.every((criterion) => !isMeaningfulClassificationText(criterion))) {
    return "finding_classification_confirmed_criteria_required";
  }

  const hasInsufficientBasis = evidenceBasis.some((basis) => CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS.has(basis));
  if (record.classification === "confirmed" && hasInsufficientBasis && !isMeaningfulClassificationText(record.defensible_confirmation_criteria)) {
    return "finding_classification_confirmed_defensible_criteria_required";
  }

  if (
    record.classification === "requires_customer_side_validation" &&
    !isMeaningfulClassificationText(record.validation_path_summary) &&
    !isNonEmptyString(record.validation_path_ref)
  ) {
    return "finding_classification_validation_path_required";
  }

  const textValues = [
    record.rationale,
    record.defensible_confirmation_criteria,
    record.validation_path_summary,
    record.validation_path_ref,
    ...(Array.isArray(record.confirmation_criteria) ? record.confirmation_criteria : []),
    ...(Array.isArray(record.threshold_gaps) ? record.threshold_gaps : []),
    ...(Array.isArray(record.limitations) ? record.limitations : [])
  ];
  if (textValues.some((value) => textHasForbiddenClassificationOrSourceCodeContent(value))) {
    return "finding_classification_text_forbidden";
  }

  return undefined;
}

function classificationEventReason(record: FindingClassificationRecord): string {
  const basis = record.evidence_basis.join(", ");
  const prior = record.supersedes_classification_record_ref === undefined
    ? "No prior classification record is superseded."
    : `Supersedes classification record ${record.supersedes_classification_record_ref}.`;
  return `Classification: ${record.classification}. Evidence basis: ${basis}. Rationale: ${record.rationale} ${prior}`;
}

function classificationRecordArtifactRef(record: FindingClassificationRecord): string {
  return `artifact_ref:${record.classification_record_id.slice("classification_record:".length)}`;
}

function classificationArtifactRefFromRecordRef(recordRef: string): string {
  return `artifact_ref:${recordRef.slice("classification_record:".length)}`;
}

function typedReviewEventArtifactRefsMatch(event: ReviewEvent): boolean {
  if (!Array.isArray(event.artifact_refs) || event.artifact_refs.length !== 1 || typeof event.idempotency_key !== "string") {
    return false;
  }
  const [artifactRef] = event.artifact_refs;
  if (event.event_type === "classification_recorded") {
    const match = /^classification:(review:[a-z0-9][a-z0-9_-]{2,63}):classification_record:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "remediation_guidance_recorded") {
    const match = /^remediation_guidance:(review:[a-z0-9][a-z0-9_-]{2,63}):remediation_guidance:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "customer_remediation_recorded") {
    const match = /^customer_remediation:(review:[a-z0-9][a-z0-9_-]{2,63}):customer_status:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "validation_recorded") {
    const pathMatch = /^validation_path:(review:[a-z0-9][a-z0-9_-]{2,63}):validation_path:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    if (pathMatch !== null) {
      return pathMatch[1] === event.review_id && artifactRef === `artifact_ref:${pathMatch[2]}`;
    }
    const scriptMatch = /^validation_script:(review:[a-z0-9][a-z0-9_-]{2,63}):validation_script:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    if (scriptMatch !== null) {
      return scriptMatch[1] === event.review_id && artifactRef === `artifact_ref:${scriptMatch[2]}`;
    }
    return false;
  }
  if (event.event_type === "verification_scope_recorded") {
    const identity = verificationScopeIdentityFromEvent(event);
    return identity !== undefined && identity.reviewId === event.review_id && artifactRef === `artifact_ref:${identity.verificationPassId}`;
  }
  if (event.event_type === "verification_evidence_recorded") {
    const identity = versionedVerificationIdentityFromEvent(event, "verification_evidence_recorded");
    return identity !== undefined && identity.reviewId === event.review_id && artifactRef === `artifact_ref:${identity.recordId}`;
  }
  if (event.event_type === "verification_recorded") {
    const identity = versionedVerificationIdentityFromEvent(event, "verification_recorded");
    return identity !== undefined && identity.reviewId === event.review_id && artifactRef === `artifact_ref:${identity.recordId}`;
  }
  if (event.event_type === "false_positive_recorded") {
    const match = /^false_positive:(review:[a-z0-9][a-z0-9_-]{2,63}):false_positive:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "customer_accepted_risk_recorded") {
    const match = /^accepted_risk:(review:[a-z0-9][a-z0-9_-]{2,63}):accepted_risk:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  const epic5Identity = epic5EventIdentity(event);
  if (!EPIC5_VERSIONED_EVENT_TYPES.has(event.event_type)) return true;
  if (epic5Identity === undefined || epic5Identity.reviewId !== event.review_id) return false;
  return event.event_type === "attestation_generated" ? artifactRef === `artifact_ref:${epic5Identity.artifactId}` : artifactRef === `sha256:${epic5Identity.artifactId}`;
}

const EPIC5_VERSIONED_EVENT_TYPES = new Set<ReviewEvent["event_type"]>(["attestation_generated", "static_bundle_generated", "attestation_package_finalized", "attestation_package_exported", "pilot_metric_recorded", "pilot_feedback_recorded"]);
type Epic5EventIdentity = {
  eventType: ReviewEvent["event_type"];
  reviewId: string;
  familyId: string;
  artifactId: string;
  version: number;
  /** `attestation_package_finalized`/`attestation_package_exported` only: the finalization record id and the exact generated-manifest id it claims as its prerequisite. */
  recordId?: string;
  generatedManifestId?: string;
};

/**
 * Parses a decimal version segment captured from an idempotency key.
 * `Number(decimal)` silently collapses out-of-range digit strings (e.g. 17+
 * nines) to `Infinity` or an inexact double, which would corrupt the family
 * version comparisons (`<=`, `>`) that gate append/supersession. Requires an
 * exact round trip so no lossy or non-canonical value can pass.
 */
function parseCanonicalSafePositiveInteger(decimal: string): number | undefined {
  const parsed = Number(decimal);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== decimal) {
    return undefined;
  }
  return parsed;
}

function epic5EventIdentity(event: ReviewEvent): Epic5EventIdentity | undefined {
  let match: RegExpExecArray | null = null;
  if (event.event_type === "attestation_generated") {
    match = /^attestation:(review:[a-z0-9][a-z0-9_-]{2,63}):attestation:([a-f0-9]{64}):attestation_version:([1-9][0-9]*)$/u.exec(event.idempotency_key);
    if (match === null) return undefined;
    const version = parseCanonicalSafePositiveInteger(match[3]!);
    return version === undefined ? undefined : { eventType: event.event_type, reviewId: match[1]!, familyId: match[1]!, artifactId: match[2]!, version };
  }
  if (event.event_type === "static_bundle_generated") {
    match = /^static_bundle:(review:[a-z0-9][a-z0-9_-]{2,63}):(static_bundle:[a-z0-9][a-z0-9_-]{2,63}):manifest_version:([1-9][0-9]*):manifest_id:([a-f0-9]{64})$/u.exec(event.idempotency_key);
    if (match === null) return undefined;
    const version = parseCanonicalSafePositiveInteger(match[3]!);
    return version === undefined ? undefined : { eventType: event.event_type, reviewId: match[1]!, familyId: match[2]!, artifactId: match[4]!, version };
  }
  if (event.event_type === "attestation_package_finalized" || event.event_type === "attestation_package_exported") {
    const prefix = event.event_type === "attestation_package_finalized" ? "attestation_package_finalized" : "attestation_package_exported";
    match = new RegExp(`^${prefix}:(review:[a-z0-9][a-z0-9_-]{2,63}):(static_bundle:[a-z0-9][a-z0-9_-]{2,63}):finalization_version:([1-9][0-9]*):record_id:([a-f0-9]{64}):generated_manifest_id:([a-f0-9]{64}):manifest_id:([a-f0-9]{64})$`, "u").exec(event.idempotency_key);
    if (match === null) return undefined;
    const version = parseCanonicalSafePositiveInteger(match[3]!);
    return version === undefined ? undefined : { eventType: event.event_type, reviewId: match[1]!, familyId: match[2]!, artifactId: match[6]!, version, recordId: match[4]!, generatedManifestId: match[5]! };
  }
  if (event.event_type === "pilot_metric_recorded" || event.event_type === "pilot_feedback_recorded") {
    const family = event.event_type === "pilot_metric_recorded" ? "pilot_metric" : "pilot_feedback";
    match = new RegExp(`^${family}:(review:[a-z0-9][a-z0-9_-]{2,63}):${family}:([a-z0-9][a-z0-9_-]{2,63}):record_version:([1-9][0-9]*):content_id:([a-f0-9]{64})$`, "u").exec(event.idempotency_key);
    if (match === null) return undefined;
    const version = parseCanonicalSafePositiveInteger(match[3]!);
    return version === undefined ? undefined : { eventType: event.event_type, reviewId: match[1]!, familyId: `${family}:${match[2]!}`, artifactId: match[4]!, version };
  }
  return undefined;
}

function latestEpic5FamilyEvent(events: readonly ReviewEvent[], identity: Epic5EventIdentity): ReviewEvent | undefined {
  return events.filter((candidate) => { const candidateIdentity = epic5EventIdentity(candidate); return candidateIdentity !== undefined && candidateIdentity.eventType === identity.eventType && candidateIdentity.reviewId === identity.reviewId && candidateIdentity.familyId === identity.familyId; }).toSorted((left, right) => epic5EventIdentity(right)!.version - epic5EventIdentity(left)!.version)[0];
}

function verificationScopeEventCarriesCustomerBacking(event: ReviewEvent): boolean {
  return isNonEmptyString(event.customer_actor_ref) || isNonEmptyString(event.customer_selection_evidence_ref);
}

function acceptedRiskEventReasonCarriesCustomerEvidence(reason: unknown): boolean {
  if (typeof reason !== "string") {
    return false;
  }
  const trimmed = reason.trim();
  if (/Customer (rationale|sign-off):\s*(?:no|none|without|missing|not provided|absent)\b/iu.test(trimmed)) {
    return false;
  }
  return /^(Accepted risk recorded for [^.]+\. Customer (rationale|sign-off): .{12,})$/iu.test(trimmed);
}

function isValidationScriptEvent(event: ReviewEvent): boolean {
  return event.event_type === "validation_recorded" && typeof event.idempotency_key === "string" && /^validation_script:/u.test(event.idempotency_key);
}

type ValidationScriptPackage =
  | { status: "included_base_package"; includedScriptSlot: number }
  | { status: "additional_script_candidate_pricing_tbd" };

function validationScriptPackageFromReason(reason: unknown): ValidationScriptPackage | undefined {
  if (typeof reason !== "string") {
    return undefined;
  }
  const includedMatch = /^Validation script package status: included_base_package; included script slot: ([1-3])\.$/u.exec(reason);
  if (includedMatch !== null) {
    return { status: "included_base_package", includedScriptSlot: Number(includedMatch[1]) };
  }
  if (reason === "Validation script package status: additional_script_candidate_pricing_tbd; pricing TBD.") {
    return { status: "additional_script_candidate_pricing_tbd" };
  }
  return undefined;
}

function validationScriptEventReason(record: ReviewerValidationScript): string {
  if (record.script_package_status === "included_base_package") {
    return `Validation script package status: included_base_package; included script slot: ${record.included_script_slot}.`;
  }
  return "Validation script package status: additional_script_candidate_pricing_tbd; pricing TBD.";
}

function classificationEventIdempotencyKey(record: FindingClassificationRecord): string {
  return `classification:${record.review_id}:${record.classification_record_id}`;
}

function actorsEqual(left: unknown, right: unknown): boolean {
  return (
    isRecord(left) &&
    isRecord(right) &&
    left.actor_type === right.actor_type &&
    left.actor_id === right.actor_id
  );
}

function isCustomerActor(actor: unknown): boolean {
  return isRecord(actor) && actor.actor_type === "customer_user";
}

function classificationEvidenceBasisMatchesDraft(
  evidenceBasis: readonly FindingClassificationRecord["evidence_basis"][number][],
  draftEvidenceRefs: readonly Record<string, unknown>[]
): boolean {
  for (const basis of evidenceBasis) {
    const rule = CLASSIFICATION_BASIS_DRAFT_EVIDENCE_RULES.get(basis);
    if (rule !== undefined && !draftEvidenceRefs.some(rule)) {
      return false;
    }
  }
  return true;
}

function draftEvidenceRefsAreConsistent(draftEvidenceRefs: readonly Record<string, unknown>[]): boolean {
  const statesByArtifact = new Map<string, string>();
  for (const ref of draftEvidenceRefs) {
    if (ref.availability_state !== "retained_review_artifact" && (ref.available_for_review === true || ref.display_state === "available_reference")) {
      return false;
    }
    if (ref.availability_state === "deleted_under_policy" && !isNonEmptyString(ref.deletion_evidence_ref)) {
      return false;
    }
    if (typeof ref.artifact_ref === "string" && typeof ref.availability_state === "string") {
      const existing = statesByArtifact.get(ref.artifact_ref);
      if (existing !== undefined && existing !== ref.availability_state) {
        return false;
      }
      statesByArtifact.set(ref.artifact_ref, ref.availability_state);
    }
  }
  return true;
}

function classificationSourceReferenceStateMatchesDraft(
  sourceReferenceState: unknown,
  draftEvidenceRefs: readonly Record<string, unknown>[]
): boolean {
  const priority: FindingClassificationRecord["source_reference_state"][] = [
    "unresolved_reference",
    "deleted_under_policy",
    "not_submitted_by_policy",
    "never_collected",
    "retained_review_artifact"
  ];
  for (const state of priority) {
    if (draftEvidenceRefs.some((ref) => ref.availability_state === state)) {
      return sourceReferenceState === state;
    }
  }
  return false;
}

function isMeaningfulClassificationText(value: unknown): value is string {
  return typeof value === "string" && /[a-z0-9]+/iu.test(value) && value.trim().split(/\s+/u).filter(Boolean).length >= 3 && value.trim().length >= 12;
}

function isMeaningfulVerificationScopeReason(value: unknown): value is string {
  return isMeaningfulClassificationText(value) && value.trim().split(/\s+/u).filter(Boolean).length >= 3;
}

function textHasForbiddenClassificationContent(value: unknown): boolean {
  return sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined;
}

/**
 * `textHasForbiddenClassificationContent` plus the source-code-like detector.
 * Deliberately not folded into the shared helper: that helper also screens
 * `reviewer-validation-script` text, which intentionally contains code.
 */
function textHasForbiddenClassificationOrSourceCodeContent(value: unknown): boolean {
  return textHasForbiddenClassificationContent(value) || sourceCodeLikeTextReason(value) !== undefined;
}

function verificationArtifactTextHasForbiddenContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => verificationArtifactTextHasForbiddenContent(item));
  }
  return textHasForbiddenClassificationContent(value) || claimSafePositiveClosurePhrase(value) !== undefined;
}

function acceptedRiskTextHasForbiddenContent(value: unknown): boolean {
  if (textHasForbiddenClassificationContent(value)) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  const positiveClaimPattern = /\b(?:is|was|has been|now|already|considered|marked)\s+(?:fixed|verified|remediated|resolved)\b|\b(?:fixed|verified|remediated|resolved)\s+(?:by|with|for)\b/u;
  const safeNegatedPattern = /\b(?:not|no|never|without|does not|do not|cannot|is not|was not|has not been)\s+(?:[^.]{0,40}\s)?(?:fixed|verified|remediated|resolved)\b/u;
  return positiveClaimPattern.test(normalized) && !safeNegatedPattern.test(normalized);
}

// ---------------------------------------------------------------------------
// Story 3.3: remediation guidance, customer remediation status, projections
// ---------------------------------------------------------------------------

export type FindingRemediationGuidance = ProtocolFindingRemediationGuidance;
export type FalsePositiveRecord = ProtocolFalsePositiveRecord;
export type AcceptedRiskRecord = ProtocolAcceptedRiskRecord;
export type FindingValidationPath = ProtocolFindingValidationPath;
export type ReviewerValidationScript = ProtocolReviewerValidationScript;
export type CustomerRemediationStatusRecord = ProtocolCustomerRemediationStatusRecord;
export type CustomerFacingFindingRecord = ProtocolCustomerFacingFindingRecord;
export type ReviewScope = ProtocolReviewScope;
export type VerificationPassScope = ProtocolVerificationPassScope;

export type VerificationEvidenceRecord = ProtocolVerificationEvidenceRecord;
export type VerificationRecord = ProtocolVerificationRecord;
export type VerificationAddendum = ProtocolVerificationAddendum;
export type VerificationEvidenceIntakeState = VerificationEvidenceRecord["intake_state"];
export type VerificationDecisionStatus = VerificationRecord["verification_status"];
export type LegacyVerificationDecisionStatus = "verified_with_evidence" | "verification_failed";
export type VerificationDecisionStatusInput = VerificationDecisionStatus | LegacyVerificationDecisionStatus;

export type VerificationEvidenceBuildContext = {
  verification_scope?: VerificationPassScope;
  verification_scope_history?: readonly VerificationPassScope[];
  trusted_tenant_id?: string;
  review_scope?: ReviewScope;
  classification?: FindingClassificationRecord;
  remediation_guidance?: FindingRemediationGuidance;
  validation_path?: FindingValidationPath;
  validation_paths?: readonly FindingValidationPath[];
  reviewer_validation_script?: ReviewerValidationScript;
  reviewer_validation_scripts?: readonly ReviewerValidationScript[];
  stored_object_classifications?: readonly StoredObjectClassification[];
  retention_opt_in_records?: readonly RetentionOptInRecord[];
};

export type VerificationEvidenceRejectionReason =
  | "verification_evidence_schema_invalid"
  | "verification_evidence_actor_authority_required"
  | "verification_evidence_customer_backing_required"
  | "verification_evidence_scope_ineligible"
  | "verification_evidence_reference_mismatch"
  | "verification_evidence_commit_context_invalid"
  | "verification_evidence_validation_context_invalid"
  | "verification_evidence_lifecycle_invalid"
  | "verification_evidence_payload_forbidden"
  | "verification_evidence_next_step_required"
  | "verification_evidence_text_forbidden";

export type VerificationEvidenceEventBuildRejectionReason = VerificationEvidenceRejectionReason
  | "verification_evidence_event_type_mismatch"
  | "verification_evidence_event_missing_record_ref"
  | "verification_evidence_event_actor_mismatch"
  | "verification_evidence_event_idempotency_key_not_derived"
  | "verification_evidence_event_schema_invalid";

export type VerificationEvidenceEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: VerificationEvidenceEventBuildRejectionReason };

export type VerificationEvidenceProjectionResult =
  | { outcome: "projected"; record: VerificationEvidenceRecord }
  | { outcome: "rejected"; reason: VerificationEvidenceRejectionReason };

export type VerificationDecisionBuildContext = VerificationEvidenceBuildContext & {
  evidence_records?: readonly VerificationEvidenceRecord[];
  evidence_record_history?: readonly VerificationEvidenceRecord[];
};

export type VerificationDecisionRejectionReason =
  | "verification_record_schema_invalid"
  | "verification_record_reviewer_actor_required"
  | "verification_record_reference_mismatch"
  | "verification_record_evidence_insufficient"
  | "verification_record_before_state_mismatch"
  | "verification_record_criteria_mismatch"
  | "verification_record_next_step_required"
  | "verification_record_text_forbidden";

export type VerificationDecisionEventBuildRejectionReason = VerificationDecisionRejectionReason
  | "verification_record_event_type_mismatch"
  | "verification_record_event_missing_record_ref"
  | "verification_record_event_actor_mismatch"
  | "verification_record_event_idempotency_key_not_derived"
  | "verification_record_event_schema_invalid";

export type VerificationDecisionEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: VerificationDecisionEventBuildRejectionReason };

export type VerificationDecisionProjectionResult =
  | { outcome: "projected"; record: VerificationRecord }
  | { outcome: "rejected"; reason: VerificationDecisionRejectionReason };

export type VerificationAddendumBuildContext = VerificationEvidenceBuildContext & {
  classifications?: readonly FindingClassificationRecord[];
  verification_records?: readonly VerificationRecord[];
  evidence_records?: readonly VerificationEvidenceRecord[];
  evidence_record_history?: readonly VerificationEvidenceRecord[];
  deletion_evidence?: readonly DeletionEvidence[];
  lifecycle_events?: readonly EvidenceLifecycleEvent[];
  history_events?: readonly ReviewEvent[];
};

export type VerificationAddendumRejectionReason =
  | "verification_addendum_schema_invalid"
  | "verification_addendum_reference_mismatch"
  | "verification_addendum_required_artifact_missing"
  | "verification_addendum_deletion_evidence_missing"
  | "verification_addendum_finalization_invalid"
  | "verification_addendum_next_step_required"
  | "verification_addendum_text_forbidden";

export type VerificationAddendumProjectionResult =
  | { outcome: "projected"; record: VerificationAddendum }
  | { outcome: "rejected"; reason: VerificationAddendumRejectionReason };

export type FindingRemediationGuidanceRejectionReason =
  | "remediation_guidance_schema_invalid"
  | "remediation_guidance_reviewer_actor_required"
  | "remediation_guidance_classification_ref_required"
  | "remediation_guidance_reference_mismatch"
  | "remediation_guidance_source_reference_state_mismatch"
  | "remediation_guidance_evidence_ref_unbound"
  | "remediation_guidance_inconclusive_not_actionable"
  | "remediation_guidance_actionable_details_required"
  | "remediation_guidance_evidence_ref_required"
  | "remediation_guidance_exploitability_rationale_required"
  | "remediation_guidance_confirmed_criteria_context_required"
  | "remediation_guidance_insufficient_evidence_reason_required"
  | "remediation_guidance_next_step_required"
  | "remediation_guidance_text_forbidden";

/** Authoritative classification the guidance's `classification_context` and bindings must match — see C4-12. */
export type RemediationGuidanceBuildContext = {
  classification?: FindingClassificationRecord;
};

export type FindingRemediationGuidanceEventBuildRejectionReason =
  | FindingRemediationGuidanceRejectionReason
  | "remediation_guidance_event_type_mismatch"
  | "remediation_guidance_event_missing_record_ref"
  | "remediation_guidance_event_actor_mismatch"
  | "remediation_guidance_event_idempotency_key_not_derived"
  | "remediation_guidance_event_schema_invalid";

export type CustomerRemediationStatusRejectionReason =
  | "customer_remediation_status_schema_invalid"
  | "customer_remediation_status_customer_actor_required"
  | "customer_remediation_status_allowed_required"
  | "customer_remediation_status_finding_ref_required"
  | "customer_remediation_status_rewrite_forbidden"
  | "customer_remediation_status_due_date_invalid"
  | "customer_remediation_status_text_forbidden";

export type CustomerRemediationStatusEventBuildRejectionReason =
  | CustomerRemediationStatusRejectionReason
  | "customer_remediation_event_type_mismatch"
  | "customer_remediation_event_missing_record_ref"
  | "customer_remediation_event_actor_mismatch"
  | "customer_remediation_event_idempotency_key_not_derived"
  | "customer_remediation_event_schema_invalid";

export type FalsePositiveRecordRejectionReason =
  | "false_positive_record_schema_invalid"
  | "false_positive_record_reviewer_actor_required"
  | "false_positive_record_reference_mismatch"
  | "false_positive_record_evidence_basis_required"
  | "false_positive_record_source_reference_state_mismatch"
  | "false_positive_record_rationale_required"
  | "false_positive_record_limitations_required"
  | "false_positive_record_text_forbidden";

export type AcceptedRiskRecordRejectionReason =
  | "accepted_risk_record_schema_invalid"
  | "accepted_risk_record_actor_required"
  | "accepted_risk_record_customer_acceptance_required"
  | "accepted_risk_record_reference_mismatch"
  | "accepted_risk_record_evidence_basis_unbound"
  | "accepted_risk_record_source_reference_state_mismatch"
  | "accepted_risk_record_limitations_required"
  | "accepted_risk_record_review_by_date_invalid"
  | "accepted_risk_record_rewrite_forbidden"
  | "accepted_risk_record_text_forbidden";

export type FalsePositiveEventBuildRejectionReason =
  | FalsePositiveRecordRejectionReason
  | "false_positive_event_type_mismatch"
  | "false_positive_event_missing_record_ref"
  | "false_positive_event_actor_mismatch"
  | "false_positive_event_idempotency_key_not_derived"
  | "false_positive_event_schema_invalid";

export type CustomerAcceptedRiskEventBuildRejectionReason =
  | AcceptedRiskRecordRejectionReason
  | "accepted_risk_event_type_mismatch"
  | "accepted_risk_event_missing_record_ref"
  | "accepted_risk_event_actor_mismatch"
  | "accepted_risk_event_idempotency_key_not_derived"
  | "accepted_risk_event_schema_invalid";

export type OutcomeRecordBuildContext = {
  classification?: FindingClassificationRecord;
  remediation_guidance?: FindingRemediationGuidance;
  validation_path?: FindingValidationPath;
  reviewer_validation_scripts?: ReviewerValidationScript[];
};

export type RemediationEventEnvelope = {
  event_id: string;
  sequence_number: number;
  event_type?: ReviewEvent["event_type"];
  actor?: ReviewEvent["actor"];
  visibility?: ReviewEvent["visibility"];
  event_timestamp?: string;
  artifact_refs?: string[];
  idempotency_key?: string;
  supersedes_event_id?: string;
  internal_note?: string;
};

export type FindingRemediationGuidanceEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: FindingRemediationGuidanceEventBuildRejectionReason };

export type CustomerRemediationStatusEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: CustomerRemediationStatusEventBuildRejectionReason };

export type FalsePositiveEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: FalsePositiveEventBuildRejectionReason };

export type CustomerAcceptedRiskEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: CustomerAcceptedRiskEventBuildRejectionReason };

export type CustomerFacingFindingProjectionRejectionReason =
  | "customer_facing_finding_input_invalid"
  | "customer_facing_finding_reference_mismatch"
  | "customer_facing_finding_schema_invalid";

export type VerificationPassScopeRejectionReason =
  | "verification_scope_schema_invalid"
  | "verification_scope_actor_authority_required"
  | "verification_scope_customer_backing_required"
  | "verification_scope_selected_findings_required"
  | "verification_scope_classification_binding_required"
  | "verification_scope_classification_binding_mismatch"
  | "verification_scope_reference_mismatch"
  | "verification_scope_validation_path_required_for_eligible"
  | "verification_scope_blocked_next_step_required"
  | "verification_scope_additional_agreement_next_step_required"
  | "verification_scope_outcome_default_out_of_scope_required"
  | "verification_scope_draft_binding_mismatch"
  | "verification_scope_eligibility_reason_required"
  | "verification_scope_limitations_required"
  | "verification_scope_deadline_basis_limitation_required"
  | "verification_scope_deadline_outside_included_window"
  | "verification_scope_included_script_cap_exceeded"
  | "verification_scope_included_script_slot_duplicate"
  | "verification_scope_script_allocation_ref_mismatch"
  | "verification_scope_additional_script_pricing_tbd_required"
  | "verification_scope_story_4_1_field_forbidden"
  | "verification_scope_text_forbidden";

export type VerificationPassScopeEventBuildRejectionReason =
  | VerificationPassScopeRejectionReason
  | "verification_scope_event_type_mismatch"
  | "verification_scope_event_missing_record_ref"
  | "verification_scope_event_actor_mismatch"
  | "verification_scope_event_idempotency_key_not_derived"
  | "verification_scope_event_reason_mismatch"
  | "verification_scope_event_schema_invalid";

export type VerificationPassScopeEventEnvelope = RemediationEventEnvelope & {
  reason?: string;
};

export type VerificationPassScopeBuildContext = {
  review_finding_drafts?: readonly ReviewFindingDraftSet[];
  classifications?: readonly FindingClassificationRecord[];
  remediation_guidance_records?: readonly FindingRemediationGuidance[];
  customer_status_records?: readonly CustomerRemediationStatusRecord[];
  validation_paths?: readonly FindingValidationPath[];
  reviewer_validation_scripts?: readonly ReviewerValidationScript[];
  accepted_risk_records?: readonly AcceptedRiskRecord[];
  false_positive_records?: readonly FalsePositiveRecord[];
};

export type VerificationPassScopeEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: VerificationPassScopeEventBuildRejectionReason };

export type VerificationPassScopeProjectionRejectionReason =
  | "verification_scope_projection_input_invalid"
  | VerificationPassScopeRejectionReason;

export type VerificationPassScopeProjectionResult =
  | { outcome: "projected"; record: VerificationPassScope }
  | { outcome: "rejected"; reason: VerificationPassScopeProjectionRejectionReason };

export type CustomerFacingFindingProjectionInput = {
  classification: FindingClassificationRecord;
  remediation_guidance?: FindingRemediationGuidance;
  customer_status_records: readonly CustomerRemediationStatusRecord[];
  validation_paths?: readonly FindingValidationPath[];
  reviewer_validation_scripts?: readonly ReviewerValidationScript[];
  accepted_risk_records?: readonly AcceptedRiskRecord[];
  false_positive_records?: readonly FalsePositiveRecord[];
  verification_record?: VerificationRecord;
  verification_record_ref?: string;
  accepted_risk_record_ref?: string;
  false_positive_record_ref?: string;
  evidence_consumer_export?: CustomerFacingFindingRecord["evidence_consumer_export"];
};

export type FindingValidationPathRejectionReason =
  | "validation_path_schema_invalid"
  | "validation_path_reviewer_actor_required"
  | "validation_path_reference_mismatch"
  | "validation_path_source_reference_state_mismatch"
  | "validation_path_evidence_ref_unbound"
  | "validation_path_remote_authorization_required"
  | "validation_path_script_ref_required"
  | "validation_path_branch_field_forbidden"
  | "validation_path_manual_attachment_instructions_required"
  | "validation_path_text_forbidden";

export type ReviewerValidationScriptRejectionReason =
  | "validation_script_schema_invalid"
  | "validation_script_reviewer_actor_required"
  | "validation_script_reference_mismatch"
  | "validation_script_included_slot_required"
  | "validation_script_additional_slot_forbidden"
  | "validation_script_pricing_tbd_required"
  | "validation_script_included_cap_exceeded"
  | "validation_script_text_forbidden";

export type ValidationPathEventBuildRejectionReason =
  | FindingValidationPathRejectionReason
  | "validation_path_event_type_mismatch"
  | "validation_path_event_missing_record_ref"
  | "validation_path_event_actor_mismatch"
  | "validation_path_event_idempotency_key_not_derived"
  | "validation_path_event_schema_invalid";

export type ValidationScriptEventBuildRejectionReason =
  | ReviewerValidationScriptRejectionReason
  | "validation_script_event_type_mismatch"
  | "validation_script_event_missing_record_ref"
  | "validation_script_event_actor_mismatch"
  | "validation_script_event_idempotency_key_not_derived"
  | "validation_script_event_schema_invalid";

export type ValidationEventEnvelope = RemediationEventEnvelope;

export type ValidationPathBuildContext = {
  classification?: FindingClassificationRecord;
  remediation_guidance?: FindingRemediationGuidance;
  reviewer_validation_scripts?: readonly ReviewerValidationScript[];
  prior_included_scripts?: readonly ReviewerValidationScript[];
};

export type ValidationScriptBuildContext = {
  validation_path?: FindingValidationPath;
  prior_included_scripts?: readonly ReviewerValidationScript[];
};

export type FindingValidationPathEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: ValidationPathEventBuildRejectionReason };

export type ReviewerValidationScriptEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: ValidationScriptEventBuildRejectionReason };

export type CustomerFacingFindingProjectionResult =
  | { outcome: "projected"; record: CustomerFacingFindingRecord }
  | { outcome: "rejected"; reason: CustomerFacingFindingProjectionRejectionReason };

const CUSTOMER_REMEDIATION_STATUS_ALLOWED = new Set<CustomerRemediationStatusRecord["customer_remediation_status"]>([
  "not_started",
  "planned",
  "in_progress",
  "remediated_by_customer",
  "validation_pending",
  "deferred",
  "not_applicable"
]);

const CUSTOMER_STATUS_FORBIDDEN_FIELDS = new Set([
  "classification",
  "expert_classification",
  "reviewer_classification",
  "rationale",
  "reviewer_rationale",
  "remediation_rationale",
  "reviewer_remediation_rationale",
  "suggested_remediation",
  "validation_steps",
  "accepted_risk_record",
  "accepted_risk_rationale",
  "false_positive_rationale"
]);

export function buildFindingRemediationGuidanceEvent(
  record: FindingRemediationGuidance,
  envelope: RemediationEventEnvelope,
  context: RemediationGuidanceBuildContext = {}
): FindingRemediationGuidanceEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "remediation_guidance_schema_invalid" };
  }

  const recordRejection = rejectionForFindingRemediationGuidance(record, context);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", record).length > 0) {
    return { outcome: "rejected", reason: "remediation_guidance_schema_invalid" };
  }

  if (envelope.event_type !== undefined && envelope.event_type !== "remediation_guidance_recorded") {
    return { outcome: "rejected", reason: "remediation_guidance_event_type_mismatch" };
  }

  const expectedArtifactRef = remediationGuidanceArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "remediation_guidance_event_missing_record_ref" };
  }

  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "remediation_guidance_event_actor_mismatch" };
  }

  const expectedIdempotencyKey = remediationGuidanceEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "remediation_guidance_event_idempotency_key_not_derived" };
  }

  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "remediation_guidance_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "remediation_guidance_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.authored_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };

  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "remediation_guidance_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "remediation_guidance_event_schema_invalid" };
  }

  return { outcome: "built", event };
}

export function buildCustomerRemediationStatusEvent(
  record: CustomerRemediationStatusRecord,
  envelope: RemediationEventEnvelope
): CustomerRemediationStatusEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "customer_remediation_status_schema_invalid" };
  }

  const recordRejection = rejectionForCustomerRemediationStatus(record);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:customer-remediation-status-record", record).length > 0) {
    return { outcome: "rejected", reason: "customer_remediation_status_schema_invalid" };
  }

  if (envelope.event_type !== undefined && envelope.event_type !== "customer_remediation_recorded") {
    return { outcome: "rejected", reason: "customer_remediation_event_type_mismatch" };
  }

  const expectedArtifactRef = customerStatusArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "customer_remediation_event_missing_record_ref" };
  }

  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "customer_remediation_event_actor_mismatch" };
  }

  const expectedIdempotencyKey = customerRemediationEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "customer_remediation_event_idempotency_key_not_derived" };
  }

  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "customer_remediation_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "customer_remediation_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.recorded_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };

  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "customer_remediation_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "customer_remediation_event_schema_invalid" };
  }

  return { outcome: "built", event };
}

export function buildFalsePositiveEvent(
  record: FalsePositiveRecord,
  envelope: RemediationEventEnvelope,
  context: OutcomeRecordBuildContext = {}
): FalsePositiveEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "false_positive_record_schema_invalid" };
  }
  const buildContext = isRecord(context) ? context as OutcomeRecordBuildContext : {};
  const recordRejection = rejectionForFalsePositiveRecord(record, buildContext);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:false-positive-record", record).length > 0) {
    return { outcome: "rejected", reason: "false_positive_record_schema_invalid" };
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "false_positive_recorded") {
    return { outcome: "rejected", reason: "false_positive_event_type_mismatch" };
  }
  const expectedArtifactRef = falsePositiveArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "false_positive_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "false_positive_event_actor_mismatch" };
  }
  const expectedIdempotencyKey = falsePositiveEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "false_positive_event_idempotency_key_not_derived" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "false_positive_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "false_positive_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.recorded_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason: falsePositiveEventReason(record),
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "false_positive_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "false_positive_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function buildCustomerAcceptedRiskEvent(
  record: AcceptedRiskRecord,
  envelope: RemediationEventEnvelope,
  context: OutcomeRecordBuildContext = {}
): CustomerAcceptedRiskEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "accepted_risk_record_schema_invalid" };
  }
  const buildContext = isRecord(context) ? context as OutcomeRecordBuildContext : {};
  const recordRejection = rejectionForAcceptedRiskRecord(record, buildContext);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:accepted-risk-record", record).length > 0) {
    return { outcome: "rejected", reason: "accepted_risk_record_schema_invalid" };
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "customer_accepted_risk_recorded") {
    return { outcome: "rejected", reason: "accepted_risk_event_type_mismatch" };
  }
  const expectedArtifactRef = acceptedRiskArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "accepted_risk_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "accepted_risk_event_actor_mismatch" };
  }
  const expectedIdempotencyKey = acceptedRiskEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "accepted_risk_event_idempotency_key_not_derived" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "accepted_risk_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "customer_accepted_risk_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.recorded_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason: acceptedRiskEventReason(record),
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "accepted_risk_event_schema_invalid" };
  }
  if (event.supersedes_classification_record_ref !== undefined) {
    return { outcome: "rejected", reason: "accepted_risk_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "accepted_risk_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function buildFindingValidationPathEvent(
  record: FindingValidationPath,
  envelope: ValidationEventEnvelope,
  context: ValidationPathBuildContext = {}
): FindingValidationPathEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "validation_path_schema_invalid" };
  }
  const buildContext = isRecord(context) ? context as ValidationPathBuildContext : {};
  const recordRejection = rejectionForFindingValidationPath(record, buildContext);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", record).length > 0) {
    return { outcome: "rejected", reason: "validation_path_schema_invalid" };
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "validation_recorded") {
    return { outcome: "rejected", reason: "validation_path_event_type_mismatch" };
  }
  const expectedArtifactRef = validationPathArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "validation_path_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "validation_path_event_actor_mismatch" };
  }
  const expectedIdempotencyKey = validationPathEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "validation_path_event_idempotency_key_not_derived" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "validation_path_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "validation_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.authored_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "validation_path_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "validation_path_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function buildReviewerValidationScriptEvent(
  record: ReviewerValidationScript,
  envelope: ValidationEventEnvelope,
  context: ValidationScriptBuildContext = {}
): ReviewerValidationScriptEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "validation_script_schema_invalid" };
  }
  const buildContext = isRecord(context) ? context as ValidationScriptBuildContext : {};
  const recordRejection = rejectionForReviewerValidationScript(record, buildContext);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", record).length > 0) {
    return { outcome: "rejected", reason: "validation_script_schema_invalid" };
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "validation_recorded") {
    return { outcome: "rejected", reason: "validation_script_event_type_mismatch" };
  }
  const expectedArtifactRef = validationScriptArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "validation_script_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "validation_script_event_actor_mismatch" };
  }
  const expectedIdempotencyKey = validationScriptEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "validation_script_event_idempotency_key_not_derived" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "validation_script_event_schema_invalid" };
  }
  const reason = validationScriptEventReason(record);
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "validation_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.authored_at,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason,
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "validation_script_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "validation_script_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function buildVerificationPassScopeEvent(
  record: VerificationPassScope,
  envelope: VerificationPassScopeEventEnvelope,
  context: VerificationPassScopeBuildContext = {}
): VerificationPassScopeEventBuildResult {
  if (!isRecord(record) || !isRecord(envelope)) {
    return { outcome: "rejected", reason: "verification_scope_schema_invalid" };
  }
  const buildContext = isRecord(context) ? context as VerificationPassScopeBuildContext : {};
  const recordRejection = rejectionForVerificationPassScope(record, buildContext);
  if (recordRejection !== undefined) {
    return { outcome: "rejected", reason: recordRejection };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-pass-scope", record).length > 0) {
    return { outcome: "rejected", reason: "verification_scope_schema_invalid" };
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "verification_scope_recorded") {
    return { outcome: "rejected", reason: "verification_scope_event_type_mismatch" };
  }
  const expectedArtifactRef = verificationPassScopeArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [expectedArtifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== expectedArtifactRef) {
    return { outcome: "rejected", reason: "verification_scope_event_missing_record_ref" };
  }
  const actorSource = envelope.actor ?? record.actor;
  if (!actorsEqual(actorSource, record.actor)) {
    return { outcome: "rejected", reason: "verification_scope_event_actor_mismatch" };
  }
  const actor = cloneJson(actorSource) as ReviewEvent["actor"] | undefined;
  if (!isRecord(actor)) {
    return { outcome: "rejected", reason: "verification_scope_event_schema_invalid" };
  }
  const expectedIdempotencyKey = verificationPassScopeEventIdempotencyKey(record);
  const idempotencyKey = envelope.idempotency_key ?? expectedIdempotencyKey;
  if (idempotencyKey !== expectedIdempotencyKey) {
    return { outcome: "rejected", reason: "verification_scope_event_idempotency_key_not_derived" };
  }
  const reason = verificationPassScopeEventReason(record);
  if (envelope.reason !== undefined && envelope.reason !== reason) {
    return { outcome: "rejected", reason: "verification_scope_event_reason_mismatch" };
  }
  const eventTimestamp = envelope.event_timestamp ?? record.scope_recorded_at;
  if (eventTimestamp !== record.scope_recorded_at) {
    return { outcome: "rejected", reason: "verification_scope_event_schema_invalid" };
  }
  const visibility = envelope.visibility ?? record.visibility;
  if (record.visibility === "internal_only" && visibility === "customer_facing") {
    return { outcome: "rejected", reason: "verification_scope_event_schema_invalid" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "verification_scope_recorded",
    actor,
    event_timestamp: eventTimestamp,
    artifact_refs: [...artifactRefs] as ReviewEvent["artifact_refs"],
    visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    reason,
    ...(record.customer_actor_ref === undefined ? {} : { customer_actor_ref: record.customer_actor_ref }),
    ...(record.customer_selection_evidence_ref === undefined ? {} : { customer_selection_evidence_ref: record.customer_selection_evidence_ref }),
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "verification_scope_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "verification_scope_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function projectVerificationPassScope(
  record: VerificationPassScope,
  context: VerificationPassScopeBuildContext = {}
): VerificationPassScopeProjectionResult {
  if (!isRecord(record) || !isRecord(context)) {
    return { outcome: "rejected", reason: "verification_scope_projection_input_invalid" };
  }
  const rejection = rejectionForVerificationPassScope(record, context as VerificationPassScopeBuildContext);
  if (rejection !== undefined) {
    return { outcome: "rejected", reason: rejection };
  }
  if (record.visibility !== "customer_facing" || validateProtocolSchema("urn:codeattest:protocol:v0:verification-pass-scope", record).length > 0) {
    return { outcome: "rejected", reason: "verification_scope_schema_invalid" };
  }
  const projected = cloneJson(record);
  if (projected === undefined) {
    return { outcome: "rejected", reason: "verification_scope_projection_input_invalid" };
  }
  deepFreeze(projected);
  return { outcome: "projected", record: projected };
}

export type VerificationEventEnvelope = RemediationEventEnvelope;

export function buildVerificationEvidenceIntakeRecord(
  record: VerificationEvidenceRecord,
  context: VerificationEvidenceBuildContext = {}
): VerificationEvidenceProjectionResult {
  const recordScan = scanVerificationJson(record);
  const contextScan = scanVerificationJson(context);
  if (!recordScan.valid) {
    return { outcome: "rejected", reason: "verification_evidence_schema_invalid" };
  }
  if (!contextScan.valid) {
    return { outcome: "rejected", reason: "verification_evidence_reference_mismatch" };
  }
  const rejection = rejectionForVerificationEvidenceRecord(record, context as VerificationEvidenceBuildContext);
  if (rejection !== undefined) {
    return { outcome: "rejected", reason: rejection };
  }
  const projected = cloneJson(record);
  if (projected === undefined) {
    return { outcome: "rejected", reason: "verification_evidence_schema_invalid" };
  }
  deepFreeze(projected);
  return { outcome: "projected", record: projected };
}

export function buildVerificationEvidenceEvent(
  record: VerificationEvidenceRecord,
  envelope: VerificationEventEnvelope,
  context: VerificationEvidenceBuildContext = {}
): VerificationEvidenceEventBuildResult {
  if (!scanVerificationJson(envelope).valid) {
    return { outcome: "rejected", reason: "verification_evidence_event_schema_invalid" };
  }
  const projection = buildVerificationEvidenceIntakeRecord(record, context);
  if (projection.outcome === "rejected") {
    return projection;
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "verification_evidence_recorded") {
    return { outcome: "rejected", reason: "verification_evidence_event_type_mismatch" };
  }
  const artifactRef = verificationEvidenceArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [artifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== artifactRef) {
    return { outcome: "rejected", reason: "verification_evidence_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "verification_evidence_event_actor_mismatch" };
  }
  const idempotencyKey = verificationEvidenceEventIdempotencyKey(record);
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) {
    return { outcome: "rejected", reason: "verification_evidence_event_idempotency_key_not_derived" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "verification_evidence_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.recorded_at,
    artifact_refs: [artifactRef],
    visibility: envelope.visibility ?? record.visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    source_derived_class: "retained_review_artifact",
    reason: `Verification evidence metadata recorded. Intake state: ${record.intake_state}.`,
    ...(record.customer_actor_ref === undefined ? {} : { customer_actor_ref: record.customer_actor_ref }),
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.event_timestamp !== record.recorded_at || (record.visibility === "internal_only" && event.visibility === "customer_facing")) {
    return { outcome: "rejected", reason: "verification_evidence_event_schema_invalid" };
  }
  // C4-20: mirrors the same guard already present in `buildVerificationPassScopeEvent`
  // -- a successful builder result must always be appendable, and the authoritative
  // append boundary rejects any `internal_note` on a non-`internal_only` event.
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "verification_evidence_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "verification_evidence_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function projectVerificationEvidenceIntake(
  record: VerificationEvidenceRecord,
  context: VerificationEvidenceBuildContext = {}
): VerificationEvidenceProjectionResult {
  return buildVerificationEvidenceIntakeRecord(record, context);
}

export function buildVerificationDecision(
  record: VerificationRecord,
  context: VerificationDecisionBuildContext = {}
): VerificationDecisionProjectionResult {
  if (!scanVerificationJson(record).valid) {
    return { outcome: "rejected", reason: "verification_record_schema_invalid" };
  }
  if (!scanVerificationJson(context).valid) {
    return { outcome: "rejected", reason: "verification_record_reference_mismatch" };
  }
  const rejection = rejectionForVerificationRecord(record, context as VerificationDecisionBuildContext);
  if (rejection !== undefined) {
    return { outcome: "rejected", reason: rejection };
  }
  const projected = cloneJson(record);
  if (projected === undefined) {
    return { outcome: "rejected", reason: "verification_record_schema_invalid" };
  }
  deepFreeze(projected);
  return { outcome: "projected", record: projected };
}

export function buildVerificationDecisionEvent(
  record: VerificationRecord,
  envelope: VerificationEventEnvelope,
  context: VerificationDecisionBuildContext = {}
): VerificationDecisionEventBuildResult {
  if (!scanVerificationJson(envelope).valid) {
    return { outcome: "rejected", reason: "verification_record_event_schema_invalid" };
  }
  const projection = buildVerificationDecision(record, context);
  if (projection.outcome === "rejected") {
    return projection;
  }
  if (envelope.event_type !== undefined && envelope.event_type !== "verification_recorded") {
    return { outcome: "rejected", reason: "verification_record_event_type_mismatch" };
  }
  const artifactRef = verificationDecisionArtifactRef(record);
  const artifactRefs = envelope.artifact_refs ?? [artifactRef];
  if (!Array.isArray(artifactRefs) || artifactRefs.length !== 1 || artifactRefs[0] !== artifactRef) {
    return { outcome: "rejected", reason: "verification_record_event_missing_record_ref" };
  }
  const actor = envelope.actor ?? record.actor;
  if (!actorsEqual(actor, record.actor)) {
    return { outcome: "rejected", reason: "verification_record_event_actor_mismatch" };
  }
  const idempotencyKey = verificationDecisionEventIdempotencyKey(record);
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) {
    return { outcome: "rejected", reason: "verification_record_event_idempotency_key_not_derived" };
  }
  const event: ReviewEvent = {
    protocol_version: record.protocol_version,
    event_id: envelope.event_id,
    review_id: record.review_id,
    sequence_number: envelope.sequence_number,
    idempotency_key: idempotencyKey,
    event_type: "verification_recorded",
    actor,
    event_timestamp: envelope.event_timestamp ?? record.recorded_at,
    artifact_refs: [artifactRef],
    visibility: envelope.visibility ?? record.visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    source_derived_class: "retained_review_artifact",
    reason: `Reviewer verification decision recorded. Outcome: ${record.verification_status}.`,
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id }),
    ...(envelope.internal_note === undefined ? {} : { internal_note: envelope.internal_note })
  };
  if (event.event_timestamp !== record.recorded_at || (record.visibility === "internal_only" && event.visibility === "customer_facing")) {
    return { outcome: "rejected", reason: "verification_record_event_schema_invalid" };
  }
  // C4-20: mirrors the same guard already present in `buildVerificationPassScopeEvent`
  // -- a successful builder result must always be appendable, and the authoritative
  // append boundary rejects any `internal_note` on a non-`internal_only` event.
  if (event.internal_note !== undefined && event.visibility !== "internal_only") {
    return { outcome: "rejected", reason: "verification_record_event_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "verification_record_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function projectVerificationDecision(
  record: VerificationRecord,
  context: VerificationDecisionBuildContext = {}
): VerificationDecisionProjectionResult {
  return buildVerificationDecision(record, context);
}

export function projectVerificationAddendum(
  record: VerificationAddendum,
  context: VerificationAddendumBuildContext = {}
): VerificationAddendumProjectionResult {
  if (!scanVerificationJson(record).valid) {
    return { outcome: "rejected", reason: "verification_addendum_schema_invalid" };
  }
  if (!scanVerificationJson(context).valid) {
    return { outcome: "rejected", reason: "verification_addendum_reference_mismatch" };
  }
  const rejection = rejectionForVerificationAddendum(record, context as VerificationAddendumBuildContext);
  if (rejection !== undefined) {
    return { outcome: "rejected", reason: rejection };
  }
  const projected = cloneJson(record);
  if (projected === undefined) {
    return { outcome: "rejected", reason: "verification_addendum_schema_invalid" };
  }
  deepFreeze(projected);
  return { outcome: "projected", record: projected };
}

// ---------------------------------------------------------------------------
// Epic 5: Attestation, approved mappings, customer finalization, pilot learning
// ---------------------------------------------------------------------------

export type SecurityReviewAttestation = ProtocolSecurityReviewAttestation;
export type SupportingEvidenceMapping = ProtocolSupportingEvidenceMapping;
export type AttestationPackageFinalization = ProtocolAttestationPackageFinalization;
export type PilotMetricRecord = ProtocolPilotMetricRecord;
export type PilotFeedbackRecord = ProtocolPilotFeedbackRecord;
export type StaticBundleManifest = ProtocolStaticBundleManifest;
export type StaticPortalProjection = ProtocolStaticPortalProjection;
export type BundleManifest = ProtocolBundleManifest;
export type VendorReceipt = ProtocolVendorReceipt;
export type SignatureEnvelope = ProtocolSignatureEnvelope;

export type AttestationBuildContext = {
  review_scope?: ReviewScope;
  bundle_manifest?: BundleManifest;
  vendor_receipt?: VendorReceipt;
  evidence_minimization?: EvidenceMinimizationProjection;
  evidence_minimization_ref?: string;
  deletion_evidence?: readonly DeletionEvidence[];
  verification_addenda?: readonly VerificationAddendum[];
  verification_addendum_contexts?: Readonly<Record<string, VerificationAddendumBuildContext>>;
  classification_records?: readonly FindingClassificationRecord[];
  remediation_guidance?: readonly FindingRemediationGuidance[];
  validation_paths?: readonly FindingValidationPath[];
  validation_scripts?: readonly ReviewerValidationScript[];
  verification_evidence_records?: readonly VerificationEvidenceRecord[];
  verification_records?: readonly VerificationRecord[];
  history_events?: readonly ReviewEvent[];
  supporting_evidence_mapping?: SupportingEvidenceMapping;
};

export type AttestationRejectionReason =
  | "attestation_schema_invalid"
  | "attestation_authority_required"
  | "attestation_reference_mismatch"
  | "attestation_receipt_chain_invalid"
  | "attestation_history_incomplete"
  | "attestation_required_artifact_missing"
  | "attestation_lifecycle_invalid"
  | "attestation_internal_learning_forbidden"
  | "attestation_text_forbidden";

export type AttestationProjectionResult =
  | { outcome: "projected"; record: SecurityReviewAttestation }
  | { outcome: "rejected"; reason: AttestationRejectionReason };

export type Epic5EventEnvelope = RemediationEventEnvelope;

export type AttestationEventBuildRejectionReason = AttestationRejectionReason
  | "attestation_event_type_mismatch"
  | "attestation_event_missing_record_ref"
  | "attestation_event_actor_mismatch"
  | "attestation_event_idempotency_key_not_derived"
  | "attestation_event_schema_invalid";

export type AttestationEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: AttestationEventBuildRejectionReason };

export type SupportingEvidenceMappingRejectionReason =
  | "supporting_evidence_mapping_schema_invalid"
  | "supporting_evidence_mapping_not_approved"
  | "supporting_evidence_mapping_reference_mismatch"
  | "supporting_evidence_mapping_authority_invalid"
  | "supporting_evidence_mapping_duplicate_entry"
  | "supporting_evidence_mapping_internal_learning_forbidden"
  | "supporting_evidence_mapping_text_forbidden";

export type SupportingEvidenceMappingProjectionResult =
  | { outcome: "projected"; record: SupportingEvidenceMapping }
  | { outcome: "omitted"; reason: SupportingEvidenceMappingRejectionReason };

export type StaticBundleGeneratedEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: "static_bundle_event_schema_invalid" | "static_bundle_event_actor_invalid" | "static_bundle_event_reference_invalid" | "static_bundle_event_idempotency_invalid" | "static_bundle_event_semantics_invalid" };

export type FinalizationBuildContext = {
  attestation?: SecurityReviewAttestation;
  vendor_receipt?: VendorReceipt;
  generated_manifest?: StaticBundleManifest;
  generated_manifest_signing_input?: ProtocolIdentitySigningInput;
  generated_manifest_signature?: SignatureEnvelope;
  finalized_manifest?: StaticBundleManifest;
  finalized_manifest_signing_input?: ProtocolIdentitySigningInput;
  finalized_manifest_signature?: SignatureEnvelope;
  portal_projection?: StaticPortalProjection;
  deletion_evidence?: readonly DeletionEvidence[];
  history_events?: readonly ReviewEvent[];
  // D2-1/D3-2: this pure module holds no key material and cannot verify a
  // signature's bytes itself -- "are these bytes good" is answered only by
  // host-computed `SignatureVerificationOutcome`s supplied here, never by
  // trusting the raw signature bytes directly.
  signature_verification_outcomes: { generated_manifest?: SignatureVerificationOutcome; finalized_manifest?: SignatureVerificationOutcome; vendor_receipt?: SignatureVerificationOutcome };
};

export type FinalizationRejectionReason =
  | "attestation_finalization_schema_invalid"
  | "attestation_finalization_customer_actor_required"
  | "attestation_finalization_visible_context_required"
  | "attestation_finalization_reference_mismatch"
  | "attestation_finalization_manifest_chain_invalid"
  | "attestation_finalization_receipt_invalid"
  | "attestation_finalization_signature_invalid"
  | "attestation_finalization_deletion_unresolved"
  | "attestation_finalization_portal_invalid"
  | "attestation_finalization_export_state_invalid"
  | "attestation_finalization_text_forbidden";

export type FinalizationProjectionResult =
  | { outcome: "projected"; record: AttestationPackageFinalization }
  | { outcome: "rejected"; reason: FinalizationRejectionReason };

export type FinalizationEventBuildRejectionReason = FinalizationRejectionReason
  | "attestation_finalization_event_type_mismatch"
  | "attestation_finalization_event_missing_record_ref"
  | "attestation_finalization_event_actor_mismatch"
  | "attestation_finalization_event_idempotency_key_not_derived"
  | "attestation_finalization_event_state_invalid"
  | "attestation_finalization_event_schema_invalid";

export type FinalizationEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: FinalizationEventBuildRejectionReason };

export type PilotLearningRecord = PilotMetricRecord | PilotFeedbackRecord;
export type PilotLearningRejectionReason =
  | "pilot_learning_schema_invalid"
  | "pilot_learning_actor_required"
  | "pilot_learning_internal_only_required"
  | "pilot_learning_content_forbidden"
  | "pilot_learning_pii_forbidden"
  | "pilot_learning_metric_inconsistent"
  | "pilot_learning_time_window_invalid"
  | "pilot_learning_text_forbidden";

export type PilotLearningBuildResult<T extends PilotLearningRecord> =
  | { outcome: "recorded"; record: T }
  | { outcome: "rejected"; reason: PilotLearningRejectionReason };

export type PilotLearningEventBuildRejectionReason = PilotLearningRejectionReason
  | "pilot_learning_event_type_mismatch"
  | "pilot_learning_event_missing_record_ref"
  | "pilot_learning_event_actor_mismatch"
  | "pilot_learning_event_idempotency_key_not_derived"
  | "pilot_learning_event_schema_invalid";

export type PilotLearningEventBuildResult =
  | { outcome: "built"; event: ReviewEvent }
  | { outcome: "rejected"; reason: PilotLearningEventBuildRejectionReason };

export type InternalPilotLearningProjection = {
  protocol_version: PilotLearningRecord["protocol_version"];
  review_id: string;
  metric_records: PilotMetricRecord[];
  feedback_records: PilotFeedbackRecord[];
  visibility: "internal_only";
  content_free: true;
  pii_free: true;
};

export type InternalPilotLearningProjectionResult =
  | { outcome: "projected"; projection: InternalPilotLearningProjection }
  | { outcome: "rejected"; reason: PilotLearningRejectionReason | "pilot_learning_reference_mismatch" };

export function buildSecurityReviewAttestation(
  record: SecurityReviewAttestation,
  context: AttestationBuildContext = {}
): AttestationProjectionResult {
  if (!scanVerificationJson(record).valid || !scanVerificationJson(context).valid) {
    return { outcome: "rejected", reason: "attestation_schema_invalid" };
  }
  const rejection = rejectionForSecurityReviewAttestation(record, context);
  if (rejection !== undefined) return { outcome: "rejected", reason: rejection };
  return cloneAndFreezeEpic5(record, "attestation_schema_invalid");
}

export function projectSecurityReviewAttestation(
  record: SecurityReviewAttestation,
  context: AttestationBuildContext = {}
): AttestationProjectionResult {
  return buildSecurityReviewAttestation(record, context);
}

export function buildAttestationGeneratedEvent(
  record: SecurityReviewAttestation,
  envelope: Epic5EventEnvelope,
  context: AttestationBuildContext = {}
): AttestationEventBuildResult {
  const projection = buildSecurityReviewAttestation(record, context);
  if (projection.outcome === "rejected") return projection;
  if (!scanVerificationJson(envelope).valid) return { outcome: "rejected", reason: "attestation_event_schema_invalid" };
  if (envelope.event_type !== undefined && envelope.event_type !== "attestation_generated") {
    return { outcome: "rejected", reason: "attestation_event_type_mismatch" };
  }
  const artifactRef = prefixedRecordArtifactRef(record.attestation_id, "attestation:");
  const artifactRefs = envelope.artifact_refs ?? [artifactRef];
  if (!exactSingletonRef(artifactRefs, artifactRef)) return { outcome: "rejected", reason: "attestation_event_missing_record_ref" };
  const actor = envelope.actor ?? record.generated_by;
  if (!actorsEqual(actor, record.generated_by)) return { outcome: "rejected", reason: "attestation_event_actor_mismatch" };
  const idempotencyKey = `attestation:${record.review_id}:${record.attestation_id}:attestation_version:${record.attestation_version}`;
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) {
    return { outcome: "rejected", reason: "attestation_event_idempotency_key_not_derived" };
  }
  const event = epic5ReviewEvent(record.protocol_version, record.review_id, envelope, {
    event_type: "attestation_generated",
    actor,
    event_timestamp: record.generated_at,
    artifact_ref: artifactRef,
    idempotency_key: idempotencyKey,
    visibility: "customer_facing",
    reason: "Security Review Attestation generated from retained protocol records and append-only review history."
  });
  if (event === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) {
    return { outcome: "rejected", reason: "attestation_event_schema_invalid" };
  }
  return { outcome: "built", event };
}

export function projectApprovedSupportingEvidenceMapping(
  record: SupportingEvidenceMapping,
  attestation: SecurityReviewAttestation
): SupportingEvidenceMappingProjectionResult {
  if (!scanVerificationJson(record).valid || !scanVerificationJson(attestation).valid) {
    return { outcome: "omitted", reason: "supporting_evidence_mapping_schema_invalid" };
  }
  const rejection = rejectionForSupportingEvidenceMapping(record, attestation);
  if (rejection !== undefined) return { outcome: "omitted", reason: rejection };
  const cloned = cloneJson(record);
  if (cloned === undefined) return { outcome: "omitted", reason: "supporting_evidence_mapping_schema_invalid" };
  deepFreeze(cloned);
  return { outcome: "projected", record: cloned };
}

export function buildStaticBundleGeneratedEvent(manifest: StaticBundleManifest, envelope: Epic5EventEnvelope): StaticBundleGeneratedEventBuildResult {
  if (!scanVerificationJson(manifest).valid || !scanVerificationJson(envelope).valid || validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", manifest).length > 0 || manifest.package_state !== "generated" || recomputeExcludedFieldIdentity(manifest, "static_bundle_manifest_id") !== manifest.static_bundle_manifest_id) return { outcome: "rejected", reason: "static_bundle_event_schema_invalid" };
  // C4-23: schema/package-state/identity checks above say nothing about
  // static-manifest *semantics* -- a correctly rehashed manifest containing
  // internal pilot-learning files, duplicate/unresolved refs, or incomplete
  // minimization coverage would otherwise still receive a valid customer-
  // facing generated event.
  if (staticBundleManifestSemanticIssues(manifest).length > 0) return { outcome: "rejected", reason: "static_bundle_event_semantics_invalid" };
  const actor = envelope.actor ?? { actor_type: "vendor_service", actor_id: "vendor_service:static-bundle-generator" };
  if (!isRecord(actor) || actor.actor_type !== "vendor_service" || !isNonEmptyString(actor.actor_id)) return { outcome: "rejected", reason: "static_bundle_event_actor_invalid" };
  const artifactRef = manifest.static_bundle_manifest_id;
  if (!exactSingletonRef(envelope.artifact_refs ?? [artifactRef], artifactRef)) return { outcome: "rejected", reason: "static_bundle_event_reference_invalid" };
  const idempotencyKey = `static_bundle:${manifest.review_id}:${manifest.static_bundle_id}:manifest_version:${manifest.manifest_version}:manifest_id:${manifest.static_bundle_manifest_id.slice("sha256:".length)}`;
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) return { outcome: "rejected", reason: "static_bundle_event_idempotency_invalid" };
  const event = epic5ReviewEvent(manifest.protocol_version, manifest.review_id, envelope, { event_type: "static_bundle_generated", actor, event_timestamp: manifest.created_at, artifact_ref: artifactRef, idempotency_key: idempotencyKey, visibility: "customer_facing", reason: "Content-addressed static bundle payload manifest generated." });
  return event === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0 ? { outcome: "rejected", reason: "static_bundle_event_schema_invalid" } : { outcome: "built", event };
}

export function buildAttestationPackageFinalization(
  record: AttestationPackageFinalization,
  context: FinalizationBuildContext
): FinalizationProjectionResult {
  if (!scanVerificationJson(record).valid || !scanVerificationJson(context).valid) {
    return { outcome: "rejected", reason: "attestation_finalization_schema_invalid" };
  }
  const rejection = rejectionForAttestationPackageFinalization(record, context);
  if (rejection !== undefined) return { outcome: "rejected", reason: rejection };
  return cloneAndFreezeEpic5(record, "attestation_finalization_schema_invalid");
}

export function projectAttestationPackageFinalization(
  record: AttestationPackageFinalization,
  context: FinalizationBuildContext
): FinalizationProjectionResult {
  return buildAttestationPackageFinalization(record, context);
}

export function buildAttestationPackageFinalizedEvent(
  record: AttestationPackageFinalization,
  envelope: Epic5EventEnvelope,
  context: FinalizationBuildContext
): FinalizationEventBuildResult {
  return buildFinalizationEvent(record, envelope, context, "attestation_package_finalized");
}

export function buildAttestationPackageExportedEvent(
  record: AttestationPackageFinalization,
  envelope: Epic5EventEnvelope,
  context: FinalizationBuildContext
): FinalizationEventBuildResult {
  return buildFinalizationEvent(record, envelope, context, "attestation_package_exported");
}

export function buildPilotMetricRecord(record: PilotMetricRecord): PilotLearningBuildResult<PilotMetricRecord> {
  return buildPilotLearningRecord(record, "metric");
}

export function buildPilotFeedbackRecord(record: PilotFeedbackRecord): PilotLearningBuildResult<PilotFeedbackRecord> {
  return buildPilotLearningRecord(record, "feedback");
}

export function buildPilotMetricEvent(record: PilotMetricRecord, envelope: Epic5EventEnvelope): PilotLearningEventBuildResult {
  const built = buildPilotMetricRecord(record);
  if (built.outcome === "rejected") return built;
  return buildPilotLearningEvent(record, envelope, "pilot_metric_recorded", record.pilot_metric_record_id, record.record_version);
}

export function buildPilotFeedbackEvent(record: PilotFeedbackRecord, envelope: Epic5EventEnvelope): PilotLearningEventBuildResult {
  const built = buildPilotFeedbackRecord(record);
  if (built.outcome === "rejected") return built;
  return buildPilotLearningEvent(record, envelope, "pilot_feedback_recorded", record.pilot_feedback_record_id, record.record_version);
}

export function projectInternalPilotLearning(input: {
  review_id: string;
  metric_records?: readonly PilotMetricRecord[];
  feedback_records?: readonly PilotFeedbackRecord[];
}): InternalPilotLearningProjectionResult {
  if (!isRecord(input) || !isNonEmptyString(input.review_id) || !Array.isArray(input.metric_records ?? []) || !Array.isArray(input.feedback_records ?? [])) {
    return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  }
  const metrics = input.metric_records ?? [];
  const feedback = input.feedback_records ?? [];
  for (const record of metrics) {
    const result = buildPilotMetricRecord(record);
    if (result.outcome === "rejected") return result;
    if (record.review_id !== input.review_id) return { outcome: "rejected", reason: "pilot_learning_reference_mismatch" };
  }
  for (const record of feedback) {
    const result = buildPilotFeedbackRecord(record);
    if (result.outcome === "rejected") return result;
    if (record.review_id !== input.review_id) return { outcome: "rejected", reason: "pilot_learning_reference_mismatch" };
  }
  const protocolVersion = metrics[0]?.protocol_version ?? feedback[0]?.protocol_version;
  if (protocolVersion === undefined || [...metrics, ...feedback].some((record) => record.protocol_version !== protocolVersion)) {
    return { outcome: "rejected", reason: "pilot_learning_reference_mismatch" };
  }
  const projection: InternalPilotLearningProjection = {
    protocol_version: protocolVersion,
    review_id: input.review_id,
    metric_records: metrics.map((record) => cloneJson(record)!).filter((record): record is PilotMetricRecord => record !== undefined),
    feedback_records: feedback.map((record) => cloneJson(record)!).filter((record): record is PilotFeedbackRecord => record !== undefined),
    visibility: "internal_only",
    content_free: true,
    pii_free: true
  };
  if (projection.metric_records.length !== metrics.length || projection.feedback_records.length !== feedback.length) {
    return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  }
  deepFreeze(projection);
  return { outcome: "projected", projection };
}

function rejectionForSecurityReviewAttestation(record: SecurityReviewAttestation, context: AttestationBuildContext): AttestationRejectionReason | undefined {
  if (!isRecord(record) || validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", record).length > 0) return "attestation_schema_invalid";
  try {
    if (recomputeExcludedFieldIdentity(record, "attestation_id", "attestation") !== record.attestation_id) return "attestation_reference_mismatch";
  } catch {
    return "attestation_schema_invalid";
  }
  if (record.generated_by.actor_type !== "reviewer" && record.generated_by.actor_type !== "vendor_service") return "attestation_authority_required";
  if (containsInternalLearning(record)) return "attestation_internal_learning_forbidden";
  // C4-26: every history-chronology check below (addenda, receipt,
  // classification/guidance/validation/verification records, deletions)
  // needs a single trusted upper bound -- no prerequisite event may be
  // dated after the Attestation itself claims to have been generated.
  const attestationGeneratedAt = parseUtcTimestampNs(record.generated_at);
  if (attestationGeneratedAt === undefined) return "attestation_schema_invalid";
  const reviewScope = context.review_scope;
  const bundle = context.bundle_manifest;
  const receipt = context.vendor_receipt;
  const minimization = context.evidence_minimization;
  if (!isRecord(reviewScope) || !isRecord(bundle) || !isRecord(receipt) || !isRecord(minimization)) return "attestation_required_artifact_missing";
  if (
    validateProtocolSchema("urn:codeattest:protocol:v0:review-scope", reviewScope).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:bundle-manifest", bundle).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", receipt).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:evidence-minimization-projection", minimization).length > 0 ||
    record.review_id !== minimization.review_id || record.review_scope_ref !== reviewScope.review_scope_id || bundle.review_scope_ref !== reviewScope.review_scope_id ||
    !stableEquals(record.selected_commit, reviewScope.selected_commit) || record.repository_identity !== reviewScope.repository_identity || record.method.coverage_mode !== bundle.coverage_mode
  ) return "attestation_reference_mismatch";
  if (
    record.receipt_chain.manifest_id !== receipt.manifest_id || record.receipt_chain.manifest_id !== bundle.manifest_id ||
    record.receipt_chain.evidence_bundle_id !== receipt.evidence_bundle_id || record.receipt_chain.evidence_bundle_id !== bundle.evidence_bundle_id ||
    record.receipt_chain.vendor_receipt_id !== receipt.vendor_receipt_id || record.receipt_chain.receipt_timestamp !== receipt.receipt_timestamp ||
    receipt.verification_state !== "received_with_receipt"
  ) return "attestation_receipt_chain_invalid";
  if (context.evidence_minimization_ref !== record.evidence_minimization_ref || minimization.review_id !== record.review_id) return "attestation_lifecycle_invalid";
  if (
    (context.deletion_evidence !== undefined && !Array.isArray(context.deletion_evidence)) ||
    (context.verification_addenda !== undefined && !Array.isArray(context.verification_addenda)) ||
    (context.classification_records !== undefined && !Array.isArray(context.classification_records)) ||
    (context.remediation_guidance !== undefined && !Array.isArray(context.remediation_guidance)) ||
    (context.validation_paths !== undefined && !Array.isArray(context.validation_paths)) ||
    (context.validation_scripts !== undefined && !Array.isArray(context.validation_scripts)) ||
    (context.verification_evidence_records !== undefined && !Array.isArray(context.verification_evidence_records)) ||
    (context.verification_records !== undefined && !Array.isArray(context.verification_records)) ||
    (context.history_events !== undefined && !Array.isArray(context.history_events))
  ) return "attestation_schema_invalid";
  const deletions = context.deletion_evidence ?? [];
  // A skeletal record elsewhere in the supplied array is still context this
  // resolution would otherwise silently trust — every supplied item must
  // independently pass the full schema, not just the one a ref happens to hit.
  if (!everyDeletionEvidenceItemIsSchemaValid(deletions)) {
    return "attestation_lifecycle_invalid";
  }
  const lifecycleDeletionRefs = new Set(minimization.entries.filter((entry) => entry.minimization_category === "deleted_transient").map((entry) => entry.deletion_evidence_ref));
  if (new Set(record.deletion_evidence_refs).size !== record.deletion_evidence_refs.length || record.deletion_evidence_refs.some((ref) => !lifecycleDeletionRefs.has(ref) || !deletions.some((item) => item.deletion_evidence_id === ref && item.verification_status === "verified"))) {
    return "attestation_lifecycle_invalid";
  }
  const addenda = context.verification_addenda ?? [];
  if (new Set(record.verification_addendum_refs).size !== record.verification_addendum_refs.length || record.verification_addendum_refs.length !== addenda.length || record.verification_addendum_refs.some((ref) => !addenda.some((item) => item.verification_addendum_id === ref && item.review_id === record.review_id)) || addenda.some((item) => !record.verification_addendum_refs.includes(item.verification_addendum_id))) {
    return "attestation_reference_mismatch";
  }
  // C4-25: schema/ref/membership validity alone says nothing about an
  // addendum's own semantic soundness -- a skeletal addendum missing
  // required fields/history could previously be cited by the Attestation
  // untouched. Every supplied addendum must now pass the exact same
  // canonical boundary `projectVerificationAddendum` uses, with exactly one
  // caller-supplied context keyed by its own ID (no missing, extra, or
  // ambiguous contexts). All further reads below use only the validated
  // clone this returns, never the raw caller-supplied addendum.
  const addendumContexts = context.verification_addendum_contexts;
  if (addendumContexts !== undefined && !isRecord(addendumContexts)) {
    return "attestation_reference_mismatch";
  }
  if (addenda.length > 0 && (addendumContexts === undefined || Object.keys(addendumContexts).length !== addenda.length)) {
    return "attestation_reference_mismatch";
  }
  const validatedAddenda: VerificationAddendum[] = [];
  for (const addendum of addenda) {
    const addendumContext = addendumContexts === undefined ? undefined : addendumContexts[addendum.verification_addendum_id];
    if (addendumContext === undefined) return "attestation_reference_mismatch";
    const addendumProjection = projectVerificationAddendum(addendum, addendumContext);
    if (addendumProjection.outcome === "rejected") return "attestation_reference_mismatch";
    validatedAddenda.push(addendumProjection.record);
  }
  if (record.supporting_evidence_mapping_ref !== undefined) {
    const mapping = context.supporting_evidence_mapping;
    if (mapping === undefined || mapping.supporting_evidence_mapping_id !== record.supporting_evidence_mapping_ref || rejectionForSupportingEvidenceMapping(mapping, record) !== undefined) {
      return "attestation_reference_mismatch";
    }
  }
  const classifications = context.classification_records ?? [];
  const guidance = context.remediation_guidance ?? [];
  const validationPaths = context.validation_paths ?? [];
  const validationScripts = context.validation_scripts ?? [];
  const verificationEvidence = context.verification_evidence_records ?? [];
  const verificationRecords = context.verification_records ?? [];
  if (
    classifications.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", item).length > 0) ||
    guidance.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", item).length > 0) ||
    validationPaths.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", item).length > 0) ||
    validationScripts.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", item).length > 0) ||
    verificationEvidence.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:verification-evidence-record", item).length > 0) ||
    verificationRecords.some((item) => item.review_id !== record.review_id || validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", item).length > 0)
  ) return "attestation_required_artifact_missing";
  const classificationById = new Map(classifications.map((item) => [item.classification_record_id, item]));
  const guidanceById = new Map(guidance.map((item) => [item.remediation_guidance_id, item]));
  const pathById = new Map(validationPaths.map((item) => [item.validation_path_id, item]));
  const evidenceById = new Map(verificationEvidence.map((item) => [item.verification_evidence_record_id, item]));
  const decisionById = new Map(verificationRecords.map((item) => [item.verification_record_id, item]));
  for (const addendum of validatedAddenda) {
    if (addendum.review_id !== record.review_id || addendum.review_scope_ref !== record.review_scope_ref || !stableEquals(addendum.selected_commit, record.selected_commit) || addendum.repository_identity !== record.repository_identity) return "attestation_reference_mismatch";
    // C4-26: an addendum dated after the Attestation itself claims to have
    // been generated cannot have informed it -- chronology, not just
    // reference matching, must hold.
    const addendumGeneratedAt = parseUtcTimestampNs(addendum.generated_at);
    if (addendumGeneratedAt === undefined || addendumGeneratedAt > attestationGeneratedAt) return "attestation_reference_mismatch";
    for (const finding of addendum.findings) {
      const classification = classificationById.get(finding.classification_record_ref);
      const decision = decisionById.get(finding.verification_record_ref);
      // C4-25: an addendum finding's `current_classification` must match the
      // classification record's own `classification` value, not just share
      // the same `review_finding_draft_ref` -- otherwise a finding could
      // cite a real, valid classification record while claiming a drifted
      // (stale or forged) classification value in its own snapshot.
      if (classification === undefined || classification.review_finding_draft_ref !== finding.review_finding_draft_ref || classification.classification !== finding.current_classification || decision === undefined || decision.review_finding_draft_ref !== finding.review_finding_draft_ref || decision.classification_record_ref !== finding.classification_record_ref || decision.verification_status !== finding.verification_status) return "attestation_reference_mismatch";
      if (finding.remediation_guidance_ref !== undefined) {
        const item = guidanceById.get(finding.remediation_guidance_ref);
        if (item === undefined || item.review_finding_draft_ref !== finding.review_finding_draft_ref || item.classification_record_ref !== finding.classification_record_ref) return "attestation_reference_mismatch";
      }
      if (finding.validation_path_ref !== undefined) {
        const item = pathById.get(finding.validation_path_ref);
        const linkedGuidance = finding.remediation_guidance_ref === undefined ? undefined : guidanceById.get(finding.remediation_guidance_ref);
        if (item === undefined || item.review_finding_draft_ref !== finding.review_finding_draft_ref || item.classification_record_ref !== finding.classification_record_ref || (linkedGuidance !== undefined && linkedGuidance.validation_path_ref !== item.validation_path_id) || (item.remediation_guidance_ref !== undefined && item.remediation_guidance_ref !== finding.remediation_guidance_ref)) return "attestation_reference_mismatch";
      }
      if (finding.verification_evidence_record_refs.some((ref: string) => {
        const item = evidenceById.get(ref);
        if (item === undefined || item.review_finding_draft_ref !== finding.review_finding_draft_ref || item.classification_record_ref !== finding.classification_record_ref || item.verification_pass_id !== addendum.verification_pass_id || item.validation_path_ref !== finding.validation_path_ref) return true;
        if (item.reviewer_validation_script_ref !== undefined) {
          const script = validationScripts.find((candidate) => candidate.validation_script_id === item.reviewer_validation_script_ref);
          if (script === undefined || script.validation_path_ref !== item.validation_path_ref || script.classification_record_ref !== item.classification_record_ref) return true;
        }
        return false;
      }) || decision.verification_evidence_record_refs.some((ref: string) => !finding.verification_evidence_record_refs.includes(ref))) return "attestation_reference_mismatch";
    }
  }
  if (validationScripts.some((script) => {
    const path = pathById.get(script.validation_path_ref);
    return path === undefined || path.classification_record_ref !== script.classification_record_ref || !(path.reviewer_validation_script_refs ?? []).includes(script.validation_script_id);
  })) return "attestation_reference_mismatch";
  const history = context.history_events ?? [];
  // C4-26: reuse the exact same canonical append-replay validator the real
  // append boundary and C4-21's addendum history check use, instead of a
  // hand-maintained subset of append semantics that can drift out of sync.
  const historyReplay = storedReviewEventLogIsAppendValid(history, record.protocol_version, record.review_id);
  if (!historyReplay.valid || history.length === 0) return "attestation_history_incomplete";
  // C4-26: a generic `artifact_ref:vendor_receipt` event only proves *some*
  // receipt was issued for this review, not that it is *this* receipt --
  // bind the receipt-issuance event's own idempotency key to the exact
  // receipt identity, and require its timestamp to equal the receipt's own
  // timestamp and be no later than generation.
  const receiptBareId = receipt.vendor_receipt_id.slice("sha256:".length);
  const receiptEventIsValid = history.some((event) => {
    if (event.event_type !== "receipt_issued" || event.artifact_refs.length !== 1 || event.artifact_refs[0] !== "artifact_ref:vendor_receipt") return false;
    const identity = receiptIssuedIdentityFromEvent(event);
    if (identity === undefined || identity.reviewId !== record.review_id || identity.vendorReceiptId !== receiptBareId) return false;
    if (event.event_timestamp !== receipt.receipt_timestamp) return false;
    const eventAt = parseUtcTimestampNs(event.event_timestamp);
    return eventAt !== undefined && eventAt <= attestationGeneratedAt;
  });
  if (!receiptEventIsValid) return "attestation_history_incomplete";
  const classificationRefs = classifications.map((item) => `artifact_ref:${item.classification_record_id.slice("classification_record:".length)}`);
  // C4-26: for each cited (non-versioned) record, an exact matching event is
  // not enough -- its timestamp must equal the record's own authored
  // timestamp, and be no later than generation.
  const exactTimestampRefHasEvent = (entries: ReadonlyArray<readonly [ref: string, timestamp: string]>, eventType: ReviewEvent["event_type"]): boolean =>
    entries.every(([ref, timestamp]) => history.some((event) => {
      if (event.event_type !== eventType || !event.artifact_refs.includes(ref) || event.event_timestamp !== timestamp) return false;
      const eventAt = parseUtcTimestampNs(event.event_timestamp);
      return eventAt !== undefined && eventAt <= attestationGeneratedAt;
    }));
  if (
    !exactTimestampRefHasEvent(classifications.map((item): readonly [string, string] => [`artifact_ref:${item.classification_record_id.slice("classification_record:".length)}`, item.classified_at]), "classification_recorded") ||
    !exactTimestampRefHasEvent(guidance.map((item): readonly [string, string] => [`artifact_ref:${item.remediation_guidance_id.slice("remediation_guidance:".length)}`, item.authored_at]), "remediation_guidance_recorded") ||
    !exactTimestampRefHasEvent(validationPaths.map((item): readonly [string, string] => [`artifact_ref:${item.validation_path_id.slice("validation_path:".length)}`, item.authored_at]), "validation_recorded") ||
    !exactTimestampRefHasEvent(validationScripts.map((item): readonly [string, string] => [`artifact_ref:${item.validation_script_id.slice("validation_script:".length)}`, item.authored_at]), "validation_recorded")
  ) return "attestation_history_incomplete";
  // C4-26: verification evidence/decisions ARE versioned -- an event
  // matching by ref/type at ANY version is not enough. The cited record's
  // own `record_version` must be the ACTIVE (highest) version the supplied
  // history actually contains, using the same active-family resolution
  // `appendReviewEvent` itself uses for these event types.
  const activeVersionedRecordHasExactEvent = (
    recordId: string,
    recordVersion: number,
    recordTimestamp: string,
    eventType: VersionedVerificationEventType
  ): boolean => {
    const activeEvent = activeVersionedVerificationEventForRecord(history, eventType, record.review_id, recordId);
    if (activeEvent === undefined || activeEvent.event_timestamp !== recordTimestamp) return false;
    const identity = versionedVerificationIdentityFromEvent(activeEvent, eventType);
    if (identity === undefined || identity.recordVersion !== recordVersion) return false;
    const eventAt = parseUtcTimestampNs(activeEvent.event_timestamp);
    return eventAt !== undefined && eventAt <= attestationGeneratedAt;
  };
  if (
    !verificationEvidence.every((item) => activeVersionedRecordHasExactEvent(item.verification_evidence_record_id.slice("verification_evidence:".length), item.record_version, item.recorded_at, "verification_evidence_recorded")) ||
    !verificationRecords.every((item) => activeVersionedRecordHasExactEvent(item.verification_record_id.slice("verification_record:".length), item.record_version, item.recorded_at, "verification_recorded"))
  ) return "attestation_history_incomplete";
  // C4-26: a deletion ref/type match alone doesn't bind WHICH deletion
  // instant backs it -- require the event's timestamp to equal the cited
  // Deletion Evidence's own timestamp and be no later than generation.
  if (record.deletion_evidence_refs.length > 0 && !record.deletion_evidence_refs.every((ref) => {
    const deletionRecord = deletions.find((item) => item.deletion_evidence_id === ref);
    if (deletionRecord === undefined) return false;
    return history.some((event) => {
      if (event.event_type !== "evidence_deleted" || !event.artifact_refs.includes(`artifact_ref:${ref.slice("deletion_evidence:".length)}`) || event.event_timestamp !== deletionRecord.deletion_timestamp) return false;
      const eventAt = parseUtcTimestampNs(event.event_timestamp);
      return eventAt !== undefined && eventAt <= attestationGeneratedAt;
    });
  })) return "attestation_history_incomplete";
  const sectionByType = new Map(record.sections.map((section) => [section.section_type, section]));
  const exactRefs = (sectionType: SecurityReviewAttestation["sections"][number]["section_type"], refs: readonly string[]): boolean => {
    const actual: readonly string[] = sectionByType.get(sectionType)?.supporting_artifact_refs ?? [];
    return new Set(actual).size === actual.length && actual.length === refs.length && refs.every((ref) => actual.includes(ref));
  };
  const scopeRefs: string[] = ["artifact_ref:review_scope"];
  const methodRefs: string[] = bundle.artifact_references.filter((ref) => ref.artifact_type === "scanner_finding_set" && ref.source_derived_class === "retained_review_artifact").map((ref) => ref.artifact_ref);
  const remediationRefs: string[] = [
    ...guidance.map((item) => `artifact_ref:${item.remediation_guidance_id.slice("remediation_guidance:".length)}`),
    ...validationPaths.map((item) => `artifact_ref:${item.validation_path_id.slice("validation_path:".length)}`),
    ...validationScripts.map((item) => `artifact_ref:${item.validation_script_id.slice("validation_script:".length)}`)
  ];
  const outcomeRefs: string[] = [
    ...verificationEvidence.map((item) => `artifact_ref:${item.verification_evidence_record_id.slice("verification_evidence:".length)}`),
    ...verificationRecords.map((item) => `artifact_ref:${item.verification_record_id.slice("verification_record:".length)}`)
  ];
  if (
    new Set(record.sections.map((section) => section.section_type)).size !== 8 ||
    !exactRefs("scope", scopeRefs) ||
    !exactRefs("method", methodRefs) ||
    !exactRefs("receipt_chain", ["artifact_ref:vendor_receipt"]) ||
    !exactRefs("findings_and_classification", classificationRefs) ||
    !exactRefs("remediation_and_validation", remediationRefs) ||
    !exactRefs("verification_outcomes", outcomeRefs) ||
    !exactRefs("evidence_lifecycle", ["artifact_ref:evidence_minimization_projection"]) ||
    !exactRefs("limitations", scopeRefs)
  ) return "attestation_required_artifact_missing";
  const topLevelExpectedRefs = [...new Set([...scopeRefs, "artifact_ref:vendor_receipt", "artifact_ref:evidence_minimization_projection"])] as string[];
  if (record.supporting_artifact_refs.length !== topLevelExpectedRefs.length || topLevelExpectedRefs.some((ref) => !record.supporting_artifact_refs.includes(ref))) return "attestation_required_artifact_missing";
  const narrative = [record.method.tooling_summary, record.method.disclosure_summary, ...record.method.method_limitations, ...record.limitations, ...record.sections.flatMap((section) => [section.title, section.summary, section.scope, ...section.evidence_basis, ...section.limitations])];
  if (narrative.some(customerProseForbidden)) return "attestation_text_forbidden";
  return undefined;
}

type ReceiptIssuedIdentity = { reviewId: string; vendorReceiptId: string };

/**
 * C4-26: parses the exact receipt identity a `receipt_issued` event's own
 * idempotency key derives -- the generic `artifact_ref:vendor_receipt` used
 * across Attestation sections/static manifests for document compatibility
 * cannot itself distinguish one receipt from another, so the event's
 * idempotency key is the only place an exact binding can live.
 */
function receiptIssuedIdentityFromEvent(event: Pick<ReviewEvent, "idempotency_key">): ReceiptIssuedIdentity | undefined {
  if (typeof event.idempotency_key !== "string") return undefined;
  const match = /^receipt_issued:(review:[a-z0-9][a-z0-9_-]{2,63}):vendor_receipt:([a-f0-9]{64})$/u.exec(event.idempotency_key);
  return match === null ? undefined : { reviewId: match[1]!, vendorReceiptId: match[2]! };
}

function rejectionForSupportingEvidenceMapping(record: SupportingEvidenceMapping, attestation: SecurityReviewAttestation): SupportingEvidenceMappingRejectionReason | undefined {
  if (!isRecord(record) || validateProtocolSchema("urn:codeattest:protocol:v0:supporting-evidence-mapping", record).length > 0) return "supporting_evidence_mapping_schema_invalid";
  if (record.approval_state !== "approved" || !["soc_2_supporting_evidence", "generic_technology_risk", "customer_security_review"].includes(record.mapping_profile)) return "supporting_evidence_mapping_not_approved";
  if (record.approved_by.actor_type !== "reviewer") return "supporting_evidence_mapping_authority_invalid";
  if (record.review_id !== attestation.review_id || record.attestation_ref !== attestation.attestation_id) return "supporting_evidence_mapping_reference_mismatch";
  // C4-27: JSON Schema `uniqueItems` compares complete entry objects, so two
  // entries sharing one `mapping_entry_id` but differing in any other field
  // (e.g. topic) pass schema validation -- an ambiguous/duplicate customer-
  // facing mapping entry must still be rejected explicitly.
  const entryIds = record.entries.map((entry) => entry.mapping_entry_id);
  if (new Set(entryIds).size !== entryIds.length) return "supporting_evidence_mapping_duplicate_entry";
  if (containsInternalLearning(record)) return "supporting_evidence_mapping_internal_learning_forbidden";
  const allowedRefs = new Set([...attestation.supporting_artifact_refs, ...attestation.sections.flatMap((section) => section.supporting_artifact_refs)]);
  if (record.entries.some((entry) => entry.evidence_refs.some((ref) => !allowedRefs.has(ref)))) return "supporting_evidence_mapping_reference_mismatch";
  const text = [record.decision_authority, record.acceptance_disclaimer, ...record.limitations, ...record.entries.flatMap((entry) => [entry.topic, entry.supporting_evidence_role, entry.scope_summary, entry.method_summary, entry.receipt_context, ...entry.limitations])];
  if (text.some(customerProseForbidden)) return "supporting_evidence_mapping_text_forbidden";
  return undefined;
}

// D2-1/D3-2: the two pure-tier call sites that used to trust a signature's
// bytes directly. This module holds no key material, so the envelope is
// checked structurally against the identity/key/time it claims to sign, and
// "are these bytes good" is answered only by a host-computed
// `SignatureVerificationOutcome` bound field-by-field to that same envelope --
// never by trusting `result === "verified"` alone.
function staticBundleSignatureValid(
  signingInput: unknown,
  signature: SignatureEnvelope,
  expectation: IdentitySignatureExpectation,
  outcome: SignatureVerificationOutcome | undefined
): boolean {
  return signatureEnvelopeMatchesExpectation(signingInput, signature, expectation) && signatureOutcomeCovers(signature, outcome);
}

function rejectionForAttestationPackageFinalization(record: AttestationPackageFinalization, context: FinalizationBuildContext): FinalizationRejectionReason | undefined {
  if (!isRecord(record) || validateProtocolSchema("urn:codeattest:protocol:v0:attestation-package-finalization", record).length > 0) return "attestation_finalization_schema_invalid";
  try {
    if (recomputeExcludedFieldsIdentity(record, ["attestation_package_finalization_id", "export_state", "exported_at"], "attestation_finalization") !== record.attestation_package_finalization_id) return "attestation_finalization_reference_mismatch";
  } catch {
    return "attestation_finalization_schema_invalid";
  }
  if (record.customer_actor.actor_type !== "customer_user") return "attestation_finalization_customer_actor_required";
  if (!record.visible_context.limitations_visible || !record.visible_context.receipt_context_visible || !record.visible_context.export_consequence_visible) return "attestation_finalization_visible_context_required";
  const attestation = context.attestation;
  const receipt = context.vendor_receipt;
  const generated = context.generated_manifest;
  const generatedSigningInput = context.generated_manifest_signing_input;
  const generatedSignature = context.generated_manifest_signature;
  const finalized = context.finalized_manifest;
  const finalizedSigningInput = context.finalized_manifest_signing_input;
  const signature = context.finalized_manifest_signature;
  const portal = context.portal_projection;
  const deletions = context.deletion_evidence;
  if (attestation === undefined || receipt === undefined || generated === undefined || generatedSigningInput === undefined || generatedSignature === undefined || finalized === undefined || finalizedSigningInput === undefined || signature === undefined || portal === undefined || !Array.isArray(deletions)) return "attestation_finalization_reference_mismatch";
  if (
    validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", attestation).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", receipt).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", generated).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", generatedSigningInput).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", generatedSignature).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:static-bundle-manifest", finalized).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", finalizedSigningInput).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", signature).length > 0 ||
    validateProtocolSchema("urn:codeattest:protocol:v0:static-portal-projection", portal).length > 0 ||
    deletions.some((deletion) => validateProtocolSchema("urn:codeattest:protocol:v0:deletion-evidence", deletion).length > 0)
  ) return "attestation_finalization_reference_mismatch";
  if (record.review_id !== attestation.review_id || record.review_id !== generated.review_id || record.review_id !== finalized.review_id || record.review_id !== portal.review_id || record.static_bundle_id !== generated.static_bundle_id || record.static_bundle_id !== finalized.static_bundle_id || record.static_bundle_id !== portal.static_bundle_id || record.visible_context.attestation_id !== attestation.attestation_id || record.visible_context.static_bundle_id !== record.static_bundle_id) return "attestation_finalization_reference_mismatch";
  // C4-24: schema/cross-ref validity alone means the supplied Attestation
  // could still be a mutated body with a stale ID, or a superseded (non-
  // active) version -- neither was previously checked here. Recompute the
  // Attestation's own identity, then require it to be the unique active
  // `attestation_version` represented by the caller-supplied review-event
  // history (the same versioned-family machinery `appendReviewEvent` uses
  // for `attestation_generated` events).
  try {
    if (recomputeExcludedFieldIdentity(attestation, "attestation_id", "attestation") !== attestation.attestation_id) return "attestation_finalization_reference_mismatch";
  } catch {
    return "attestation_finalization_schema_invalid";
  }
  const attestationHistory = Array.isArray(context.history_events) ? context.history_events : [];
  if (attestationHistory.some((event) => !isRecord(event) || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0)) {
    return "attestation_finalization_reference_mismatch";
  }
  const attestationFamilyEvents = attestationHistory.filter((event) => {
    const identity = epic5EventIdentity(event);
    return identity !== undefined && identity.eventType === "attestation_generated" && identity.reviewId === attestation.review_id;
  });
  const attestationBareId = attestation.attestation_id.slice("attestation:".length);
  const matchingAttestationEvent = attestationFamilyEvents.find((event) => {
    const identity = epic5EventIdentity(event)!;
    return identity.artifactId === attestationBareId && identity.version === attestation.attestation_version;
  });
  if (matchingAttestationEvent === undefined) {
    return "attestation_finalization_reference_mismatch";
  }
  const attestationMaxVersion = Math.max(...attestationFamilyEvents.map((event) => epic5EventIdentity(event)!.version));
  const attestationEventsAtMaxVersion = attestationFamilyEvents.filter((event) => epic5EventIdentity(event)!.version === attestationMaxVersion);
  if (attestationEventsAtMaxVersion.length !== 1 || attestationEventsAtMaxVersion[0] !== matchingAttestationEvent) {
    return "attestation_finalization_reference_mismatch";
  }
  try {
    if (recomputeExcludedFieldIdentity(generated, "static_bundle_manifest_id") !== generated.static_bundle_manifest_id || recomputeExcludedFieldIdentity(finalized, "static_bundle_manifest_id") !== finalized.static_bundle_manifest_id) return "attestation_finalization_manifest_chain_invalid";
  } catch {
    return "attestation_finalization_manifest_chain_invalid";
  }
  // C4-23: identity/schema validity says nothing about static-manifest
  // semantics (duplicate/unresolved refs, minimization coverage, internal
  // pilot-learning content) -- a finalization must not be built on top of
  // either a generated or finalized manifest that fails those rules.
  if (staticBundleManifestSemanticIssues(generated).length > 0 || staticBundleManifestSemanticIssues(finalized).length > 0) {
    return "attestation_finalization_manifest_chain_invalid";
  }
  if (
    generated.package_state !== "generated" || generated.supersedes_static_bundle_manifest_id !== undefined || finalized.package_state !== "finalized" || record.generated_manifest_ref !== generated.static_bundle_manifest_id ||
    record.finalized_manifest_ref !== finalized.static_bundle_manifest_id || record.visible_context.generated_manifest_id !== generated.static_bundle_manifest_id ||
    finalized.supersedes_static_bundle_manifest_id !== generated.static_bundle_manifest_id || finalized.manifest_version !== record.finalized_manifest_version || finalized.manifest_version !== generated.manifest_version + 1 ||
    finalized.attestation_ref !== generated.attestation_ref || finalized.vendor_receipt_ref !== generated.vendor_receipt_ref || !stableEquals(finalized.evidence_bundle_representation, generated.evidence_bundle_representation) ||
    !stableEquals(finalized.files, generated.files) || !stableEquals(finalized.minimization_disposition, generated.minimization_disposition) || !stableEquals(finalized.verification_metadata, generated.verification_metadata) || finalized.portal_projection_ref !== generated.portal_projection_ref
  ) return "attestation_finalization_manifest_chain_invalid";
  // C4-24: `record.receipt_verification_state === "verified"` is a claim the
  // caller supplies, not a fact -- a mutated receipt (drifted content,
  // forged signature bytes, tampered comparison rows) with unchanged
  // top-level identity fields would otherwise still be trusted. Recompute
  // and re-verify the receipt itself rather than trusting the flag.
  if (
    generated.attestation_ref !== attestation.attestation_id ||
    generated.vendor_receipt_ref !== receipt.vendor_receipt_id ||
    record.receipt_verification_state !== "verified" ||
    context.signature_verification_outcomes?.vendor_receipt === undefined ||
    verifyVendorReceiptRecordSync(receipt, { signature_verification_outcome: context.signature_verification_outcomes.vendor_receipt }).state !== "receipt_verified"
  ) return "attestation_finalization_receipt_invalid";
  // C4-24: the portal's own schema/cross-ref validity says nothing about its
  // semantics (fixed eight-section navigation, matching unique documents,
  // no internal-learning references, no remote/runtime dependencies) -- a
  // schema-valid but semantically incomplete or leaky portal must not back a
  // finalized package.
  if (staticPortalProjectionSemanticIssues(portal).length > 0) return "attestation_finalization_portal_invalid";
  const generatedSignatureValid = staticBundleSignatureValid(generatedSigningInput, generatedSignature, {
    protocol_version: "codeattest.v0",
    signing_input_type: "static_bundle_manifest_identity",
    signed_identity_type: "static_bundle_manifest",
    signed_identity: generated.static_bundle_manifest_id,
    identity_input_path: "v0/valid/static-bundle-manifest.identity-input.json",
    key_id: generatedSignature.key_id,
    key_version: generatedSignature.key_version,
    signing_time: generated.created_at
  }, context.signature_verification_outcomes?.generated_manifest);
  const finalizedSignatureValid = staticBundleSignatureValid(finalizedSigningInput, signature, {
    protocol_version: "codeattest.v0",
    signing_input_type: "static_bundle_manifest_identity",
    signed_identity_type: "static_bundle_manifest",
    signed_identity: finalized.static_bundle_manifest_id,
    identity_input_path: "v0/valid/static-bundle-manifest.finalized.identity-input.json",
    key_id: generatedSignature.key_id,
    key_version: generatedSignature.key_version,
    signing_time: finalized.created_at
  }, context.signature_verification_outcomes?.finalized_manifest);
  const generatedAt = parseUtcTimestampNs(generated.created_at);
  const finalizedAt = parseUtcTimestampNs(record.finalized_at);
  const signatureAt = parseUtcTimestampNs(signature.signing_time);
  const prerequisiteTimes = [attestation.generated_at, receipt.receipt_timestamp, portal.generated_at, ...deletions.map((deletion) => deletion.deletion_timestamp)].map(parseUtcTimestampNs);
  if (record.signature_verification_state !== "verified" || !generatedSignatureValid || !finalizedSignatureValid || generatedAt === undefined || finalizedAt === undefined || signatureAt === undefined || prerequisiteTimes.some((time) => time === undefined || time > finalizedAt) || finalizedAt < generatedAt || signatureAt !== finalizedAt || generatedSignature.key_id !== signature.key_id || generatedSignature.key_version !== signature.key_version) return "attestation_finalization_signature_invalid";
  if (record.deletion_evidence_state !== "resolved" || attestation.deletion_evidence_refs.some((ref) => !deletions.some((deletion) => deletion.deletion_evidence_id === ref && deletion.verification_status === "verified"))) return "attestation_finalization_deletion_unresolved";
  if (record.portal_verification_state !== "verified_offline" || finalized.portal_projection_ref !== portal.static_portal_projection_id || portal.static_bundle_manifest_ref !== generated.static_bundle_manifest_id || !portal.customer_safe_projection || portal.visibility !== "customer_facing") return "attestation_finalization_portal_invalid";
  if ((record.export_state === "exported") !== (record.exported_at !== undefined) || (record.exported_at !== undefined && parseUtcTimestampNs(record.exported_at)! < parseUtcTimestampNs(record.finalized_at)!)) return "attestation_finalization_export_state_invalid";
  if (epic5NarrativeTextForbidden(record.customer_control_after_export)) return "attestation_finalization_text_forbidden";
  return undefined;
}

function buildFinalizationEvent(record: AttestationPackageFinalization, envelope: Epic5EventEnvelope, context: FinalizationBuildContext, eventType: "attestation_package_finalized" | "attestation_package_exported"): FinalizationEventBuildResult {
  const projection = buildAttestationPackageFinalization(record, context);
  if (projection.outcome === "rejected") return projection;
  if (!scanVerificationJson(envelope).valid) return { outcome: "rejected", reason: "attestation_finalization_event_schema_invalid" };
  // C4-29: these events are always fixed-visibility customer_facing and never
  // carry a reviewer note -- an envelope-supplied `internal_note` was
  // previously silently dropped (never copied onto the built event) instead
  // of being rejected. Fail closed on the caller-supplied field itself.
  if (envelope.internal_note !== undefined) return { outcome: "rejected", reason: "attestation_finalization_event_schema_invalid" };
  if (envelope.event_type !== undefined && envelope.event_type !== eventType) return { outcome: "rejected", reason: "attestation_finalization_event_type_mismatch" };
  if (eventType === "attestation_package_exported" && (record.export_state !== "exported" || record.exported_at === undefined)) return { outcome: "rejected", reason: "attestation_finalization_event_state_invalid" };
  const artifactRef = record.finalized_manifest_ref;
  const artifactRefs = envelope.artifact_refs ?? [artifactRef];
  if (!exactSingletonRef(artifactRefs, artifactRef)) return { outcome: "rejected", reason: "attestation_finalization_event_missing_record_ref" };
  const actor = envelope.actor ?? record.customer_actor;
  if (!actorsEqual(actor, record.customer_actor)) return { outcome: "rejected", reason: "attestation_finalization_event_actor_mismatch" };
  const action = eventType === "attestation_package_finalized" ? "finalized" : "exported";
  const idempotencyKey = `attestation_package_${action}:${record.review_id}:${record.static_bundle_id}:finalization_version:${record.finalization_version}:record_id:${record.attestation_package_finalization_id.slice("attestation_finalization:".length)}:generated_manifest_id:${record.generated_manifest_ref.slice("sha256:".length)}:manifest_id:${record.finalized_manifest_ref.slice("sha256:".length)}`;
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) return { outcome: "rejected", reason: "attestation_finalization_event_idempotency_key_not_derived" };
  const event = epic5ReviewEvent(record.protocol_version, record.review_id, envelope, {
    event_type: eventType,
    actor,
    event_timestamp: eventType === "attestation_package_exported" ? record.exported_at! : record.finalized_at,
    artifact_ref: artifactRef,
    idempotency_key: idempotencyKey,
    visibility: "customer_facing",
    reason: eventType === "attestation_package_exported" ? "Customer-controlled static Attestation package exported." : "Customer finalized a new signed static Attestation package manifest version."
  });
  if (event === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) return { outcome: "rejected", reason: "attestation_finalization_event_schema_invalid" };
  return { outcome: "built", event };
}

function buildPilotLearningRecord<T extends PilotLearningRecord>(record: T, kind: "metric" | "feedback"): PilotLearningBuildResult<T> {
  if (!scanVerificationJson(record).valid) return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  const schemaId = kind === "metric" ? "urn:codeattest:protocol:v0:pilot-metric-record" : "urn:codeattest:protocol:v0:pilot-feedback-record";
  if (!isRecord(record) || validateProtocolSchema(schemaId, record).length > 0) return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  if (record.recorded_by.actor_type !== "reviewer" && record.recorded_by.actor_type !== "vendor_service") return { outcome: "rejected", reason: "pilot_learning_actor_required" };
  if (record.visibility !== "internal_only") return { outcome: "rejected", reason: "pilot_learning_internal_only_required" };
  if (!record.content_free || containsForbiddenPilotContent(record)) return { outcome: "rejected", reason: "pilot_learning_content_forbidden" };
  // C4-28: `pii_free` now exists on both record kinds (C1-03 closed the
  // schema asymmetry) -- assert it, and back the assertion with real
  // enforcement: an opaque namespaced actor ID (which alone rejects every
  // email/phone/free-text shape, since none of those characters are in the
  // allowed suffix charset) plus a recursive value-level PII scan across the
  // whole record, not just the key-name scan `containsPiiField` performs.
  if (
    !record.pii_free ||
    containsPiiField(record) ||
    !opaquePilotActorIdIsValid(record.recorded_by.actor_type, record.recorded_by.actor_id) ||
    containsPiiValue(record)
  ) {
    return { outcome: "rejected", reason: "pilot_learning_pii_forbidden" };
  }
  if (kind === "metric") {
    const metric = record as PilotMetricRecord;
    if (metric.metrics.classified_finding_count > metric.metrics.candidate_finding_count || metric.metrics.actionable_classification_count > metric.metrics.classified_finding_count) return { outcome: "rejected", reason: "pilot_learning_metric_inconsistent" };
    const start = parseUtcTimestampNs(metric.measurement_window.start_timestamp);
    const end = parseUtcTimestampNs(metric.measurement_window.end_timestamp);
    const recorded = parseUtcTimestampNs(metric.recorded_at);
    if (start === undefined || end === undefined || recorded === undefined || start >= end || end > recorded) return { outcome: "rejected", reason: "pilot_learning_time_window_invalid" };
  } else {
    const feedback = record as PilotFeedbackRecord;
    const profiles = feedback.mapping_feedback.map((entry) => entry.mapping_profile);
    if (new Set(profiles).size !== profiles.length || new Set(feedback.objection_codes).size !== feedback.objection_codes.length) return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  }
  if (record.caveats.some((caveat) => epic5NarrativeTextForbidden(caveat) || piiTextLikely(caveat))) return { outcome: "rejected", reason: "pilot_learning_text_forbidden" };
  const cloned = cloneJson(record);
  if (cloned === undefined) return { outcome: "rejected", reason: "pilot_learning_schema_invalid" };
  deepFreeze(cloned);
  return { outcome: "recorded", record: cloned };
}

function buildPilotLearningEvent(record: PilotLearningRecord, envelope: Epic5EventEnvelope, eventType: "pilot_metric_recorded" | "pilot_feedback_recorded", recordId: string, recordVersion: number): PilotLearningEventBuildResult {
  if (!scanVerificationJson(envelope).valid) return { outcome: "rejected", reason: "pilot_learning_event_schema_invalid" };
  if (envelope.event_type !== undefined && envelope.event_type !== eventType) return { outcome: "rejected", reason: "pilot_learning_event_type_mismatch" };
  const family = eventType === "pilot_metric_recorded" ? "pilot_metric" : "pilot_feedback";
  const contentId = sha256ProtocolText(canonicalizeProtocolJson(record));
  const artifactRef = contentId;
  const artifactRefs = envelope.artifact_refs ?? [artifactRef];
  if (!exactSingletonRef(artifactRefs, artifactRef)) return { outcome: "rejected", reason: "pilot_learning_event_missing_record_ref" };
  const actor = envelope.actor ?? record.recorded_by;
  if (!actorsEqual(actor, record.recorded_by)) return { outcome: "rejected", reason: "pilot_learning_event_actor_mismatch" };
  const idempotencyKey = `${family}:${record.review_id}:${recordId}:record_version:${recordVersion}:content_id:${contentId.slice("sha256:".length)}`;
  if (envelope.idempotency_key !== undefined && envelope.idempotency_key !== idempotencyKey) return { outcome: "rejected", reason: "pilot_learning_event_idempotency_key_not_derived" };
  const event = epic5ReviewEvent(record.protocol_version, record.review_id, envelope, {
    event_type: eventType,
    actor,
    event_timestamp: record.recorded_at,
    artifact_ref: artifactRef,
    idempotency_key: idempotencyKey,
    visibility: "internal_only"
  });
  if (event === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) return { outcome: "rejected", reason: "pilot_learning_event_schema_invalid" };
  return { outcome: "built", event };
}

function epic5ReviewEvent(protocolVersion: ReviewEvent["protocol_version"], reviewId: string, envelope: Epic5EventEnvelope, values: {
  event_type: ReviewEvent["event_type"];
  actor: ReviewEvent["actor"];
  event_timestamp: string;
  artifact_ref: string;
  idempotency_key: string;
  visibility: ReviewEvent["visibility"];
  reason?: string;
}): ReviewEvent | undefined {
  if (envelope.event_timestamp !== undefined && envelope.event_timestamp !== values.event_timestamp) return undefined;
  if (envelope.visibility !== undefined && envelope.visibility !== values.visibility) return undefined;
  const event: ReviewEvent = {
    protocol_version: protocolVersion,
    event_id: envelope.event_id,
    review_id: reviewId,
    sequence_number: envelope.sequence_number,
    idempotency_key: values.idempotency_key,
    event_type: values.event_type,
    actor: values.actor,
    event_timestamp: values.event_timestamp,
    artifact_refs: [values.artifact_ref],
    visibility: values.visibility,
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    source_derived_class: "retained_review_artifact",
    ...(values.reason === undefined ? {} : { reason: values.reason }),
    ...(envelope.supersedes_event_id === undefined ? {} : { supersedes_event_id: envelope.supersedes_event_id })
  };
  return event;
}

function cloneAndFreezeEpic5(value: SecurityReviewAttestation, reason: AttestationRejectionReason): AttestationProjectionResult;
function cloneAndFreezeEpic5(value: AttestationPackageFinalization, reason: FinalizationRejectionReason): FinalizationProjectionResult;
function cloneAndFreezeEpic5(value: SecurityReviewAttestation | AttestationPackageFinalization, reason: AttestationRejectionReason | FinalizationRejectionReason): AttestationProjectionResult | FinalizationProjectionResult {
  const cloned = cloneJson(value);
  if (cloned === undefined) return { outcome: "rejected", reason } as AttestationProjectionResult | FinalizationProjectionResult;
  deepFreeze(cloned);
  if ("attestation_id" in cloned) return { outcome: "projected", record: cloned };
  return { outcome: "projected", record: cloned };
}

function exactSingletonRef(refs: unknown, expected: string): boolean {
  return Array.isArray(refs) && refs.length === 1 && refs[0] === expected;
}

function prefixedRecordArtifactRef(id: string, prefix: string): string {
  return `artifact_ref:${id.slice(prefix.length)}`;
}

function containsInternalLearning(value: unknown): boolean {
  return objectContainsForbiddenKey(value, new Set(["internal_feedback", "pilot_feedback", "pilot_metrics", "unit_economics", "private_notes", "internal_notes"]));
}

function containsForbiddenPilotContent(value: unknown): boolean {
  return objectContainsForbiddenKey(value, new Set(["payload", "content", "body", "raw_text", "raw_source", "source_text", "snippet", "stdout", "stderr", "script_output", "user_content", "evidence_content"]));
}

function containsPiiField(value: unknown): boolean {
  return objectContainsForbiddenKey(value, new Set(["name", "email", "phone", "address", "user_id", "uid", "device_id", "ip_address", "customer_contact", "raw_feedback"]));
}

function piiTextLikely(value: unknown): boolean {
  return piiTextForbidden(value) !== undefined;
}

function objectContainsForbiddenKey(value: unknown, forbidden: ReadonlySet<string>): boolean {
  if (Array.isArray(value)) return value.some((entry) => objectContainsForbiddenKey(entry, forbidden));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => forbidden.has(key.toLowerCase()) || objectContainsForbiddenKey(entry, forbidden));
}

function epic5NarrativeTextForbidden(value: unknown): boolean {
  return sourceTextForbiddenPhrase(value) !== undefined || customerVisibleTextForbidden(value) !== undefined;
}

function customerProseForbidden(value: unknown): boolean {
  return epic5NarrativeTextForbidden(value) || piiTextLikely(value) || (typeof value === "string" && /\b(?:pilot[_ -]?(?:metric|feedback|learning)|internal learning|unit economics|private notes|customer[_ -]?id|device[_ -]?id)\b/iu.test(value));
}

export function projectCustomerFacingFindingRecord(input: CustomerFacingFindingProjectionInput): CustomerFacingFindingProjectionResult {
  if (!isRecord(input) || !isRecord(input.classification) || (input.remediation_guidance !== undefined && !isRecord(input.remediation_guidance)) || (input.verification_record !== undefined && !isRecord(input.verification_record)) || !Array.isArray(input.customer_status_records)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }

  const classification = input.classification;
  const guidance = input.remediation_guidance;
  const verificationRecord = input.verification_record;
  const statuses = input.customer_status_records.filter(isRecord) as CustomerRemediationStatusRecord[];
  const validationPathsInput = input.validation_paths ?? [];
  const validationScriptsInput = input.reviewer_validation_scripts ?? [];
  const acceptedRiskInput = input.accepted_risk_records ?? [];
  const falsePositiveInput = input.false_positive_records ?? [];
  if (!Array.isArray(validationPathsInput) || !Array.isArray(validationScriptsInput) || !Array.isArray(acceptedRiskInput) || !Array.isArray(falsePositiveInput)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  const validationPaths = validationPathsInput.filter(isRecord) as FindingValidationPath[];
  const validationScripts = validationScriptsInput.filter(isRecord) as ReviewerValidationScript[];
  const acceptedRiskRecords = acceptedRiskInput.filter(isRecord) as AcceptedRiskRecord[];
  const falsePositiveRecords = falsePositiveInput.filter(isRecord) as FalsePositiveRecord[];
  if (statuses.length !== input.customer_status_records.length || validationPaths.length !== validationPathsInput.length || validationScripts.length !== validationScriptsInput.length || acceptedRiskRecords.length !== acceptedRiskInput.length || falsePositiveRecords.length !== falsePositiveInput.length) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  const customerFacingValidationPaths = validationPaths.filter((pathRecord) => pathRecord.visibility === "customer_facing");
  const customerFacingValidationScripts = validationScripts.filter((script) => script.visibility === "customer_facing");
  const customerFacingAcceptedRiskRecords = acceptedRiskRecords.filter((record) => record.visibility === "customer_facing");
  const customerFacingFalsePositiveRecords = falsePositiveRecords.filter((record) => record.visibility === "customer_facing");

  if (validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", classification).length > 0) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (guidance !== undefined && validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", guidance).length > 0) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (statuses.some((status) => validateProtocolSchema("urn:codeattest:protocol:v0:customer-remediation-status-record", status).length > 0)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (validationPaths.some((pathRecord) => validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", pathRecord).length > 0)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (validationScripts.some((script) => validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", script).length > 0)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (acceptedRiskRecords.some((record) => validateProtocolSchema("urn:codeattest:protocol:v0:accepted-risk-record", record).length > 0)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (falsePositiveRecords.some((record) => validateProtocolSchema("urn:codeattest:protocol:v0:false-positive-record", record).length > 0)) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (verificationRecord !== undefined && validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", verificationRecord).length > 0) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (
    rejectionForFindingClassificationRecord(classification) !== undefined ||
    (guidance !== undefined && rejectionForFindingRemediationGuidance(guidance, { classification }) !== undefined) ||
    statuses.some((status) => rejectionForCustomerRemediationStatus(status) !== undefined) ||
    validationPaths.some((pathRecord) => rejectionForFindingValidationPath(pathRecord, {
      classification,
      ...(guidance === undefined ? {} : { remediation_guidance: guidance }),
      reviewer_validation_scripts: validationScripts
    }) !== undefined) ||
    validationScripts.some((script) => {
      const validationPath = validationPaths.find((pathRecord) => pathRecord.validation_path_id === script.validation_path_ref);
      return rejectionForReviewerValidationScript(script, {
        ...(validationPath === undefined ? {} : { validation_path: validationPath }),
        prior_included_scripts: validationScripts.filter((candidate) => candidate !== script && candidate.script_package_status === "included_base_package")
      }) !== undefined;
    }) ||
    acceptedRiskRecords.some((record) => {
      const validationPath = record.validation_path_ref === undefined ? undefined : validationPaths.find((pathRecord) => pathRecord.validation_path_id === record.validation_path_ref);
      return rejectionForAcceptedRiskRecord(record, {
        classification,
        ...(guidance === undefined ? {} : { remediation_guidance: guidance }),
        ...(validationPath === undefined ? {} : { validation_path: validationPath }),
        reviewer_validation_scripts: validationScripts
      }) !== undefined;
    }) ||
    falsePositiveRecords.some((record) => rejectionForFalsePositiveRecord(record, { classification }) !== undefined)
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (classification.visibility !== "customer_facing") {
    return { outcome: "rejected", reason: "customer_facing_finding_input_invalid" };
  }
  if (
    verificationRecord !== undefined &&
    (
      verificationRecord.visibility !== "customer_facing" ||
      verificationRecord.review_id !== classification.review_id ||
      verificationRecord.classification_record_ref !== classification.classification_record_id ||
      verificationRecord.review_finding_draft_ref !== classification.review_finding_draft_ref ||
      verificationRecord.before_state.classification !== classification.classification ||
      !stableEquals(verificationRecord.before_state.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs.map((ref) => ref.artifact_ref)) ||
      !stableEquals(verificationRecord.before_state.evidence_basis, classification.evidence_basis) ||
      verificationRecord.before_state.source_reference_state !== classification.source_reference_state ||
      !stableEquals(
        verificationRecord.before_state.confirmation_criteria,
        classification.classification === "requires_customer_side_validation" && classification.confirmation_criteria.length === 0
          ? customerFacingValidationPaths.filter((pathRecord) => pathRecord.classification_record_ref === classification.classification_record_id).map((pathRecord) => pathRecord.expected_result)
          : classification.confirmation_criteria
      ) ||
      !verificationDecisionStatusMatchesCriteria(verificationRecord) ||
      (verificationRecord.verification_status !== "verification_complete" && !isMeaningfulClassificationText(verificationRecord.next_step_summary)) ||
      [verificationRecord.after_state.summary, verificationRecord.rationale, verificationRecord.next_step_summary, ...verificationRecord.remaining_limitations].some((value) => verificationArtifactTextHasForbiddenContent(value)) ||
      (input.verification_record_ref !== undefined && input.verification_record_ref !== verificationRecord.verification_record_id)
    )
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }

  if (
    guidance !== undefined &&
    (
      guidance.review_id !== classification.review_id ||
      guidance.classification_record_ref !== classification.classification_record_id ||
      guidance.review_finding_draft_ref !== classification.review_finding_draft_ref ||
      guidance.source_reference_state !== classification.source_reference_state ||
      !classificationContextMatchesRecord(guidance, classification) ||
      !guidanceEvidenceMatchesClassification(guidance, classification)
    )
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (
    statuses.some((status) =>
      status.review_id !== classification.review_id ||
      (status.finding_ref === undefined && status.classification_record_ref === undefined) ||
      (status.finding_ref !== undefined && status.finding_ref !== classification.review_finding_draft_ref) ||
      (status.classification_record_ref !== undefined && status.classification_record_ref !== classification.classification_record_id) ||
      (guidance === undefined && status.remediation_guidance_ref !== undefined) ||
      (guidance !== undefined && status.remediation_guidance_ref !== undefined && status.remediation_guidance_ref !== guidance.remediation_guidance_id)
    )
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (validationPaths.some((pathRecord) =>
    pathRecord.review_id !== classification.review_id ||
    pathRecord.classification_record_ref !== classification.classification_record_id ||
    pathRecord.review_finding_draft_ref !== classification.review_finding_draft_ref ||
    (guidance !== undefined && pathRecord.remediation_guidance_ref !== undefined && pathRecord.remediation_guidance_ref !== guidance.remediation_guidance_id)
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (validationScripts.some((script) =>
    script.review_id !== classification.review_id ||
    script.classification_record_ref !== classification.classification_record_id ||
    !validationPaths.some((pathRecord) => pathRecord.validation_path_id === script.validation_path_ref)
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  const validationScriptsById = new Map(validationScripts.map((script) => [script.validation_script_id, script]));
  if (validationPaths.some((pathRecord) =>
    (pathRecord.reviewer_validation_script_refs ?? []).some((ref) => validationScriptsById.get(ref)?.validation_path_ref !== pathRecord.validation_path_id)
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (validationScripts.some((script) => {
    const validationPath = validationPaths.find((pathRecord) => pathRecord.validation_path_id === script.validation_path_ref);
    if (validationPath === undefined || validationPath.path_type !== "customer_run_script") {
      return true;
    }
    const validationPathScriptRefs = new Set<string>(validationPath.reviewer_validation_script_refs ?? []);
    return !validationPathScriptRefs.has(script.validation_script_id);
  })) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (acceptedRiskRecords.some((record) =>
    record.review_id !== classification.review_id ||
    record.classification_record_ref !== classification.classification_record_id ||
    record.review_finding_draft_ref !== classification.review_finding_draft_ref ||
    (record.remediation_context_ref !== undefined && (guidance === undefined || record.remediation_context_ref !== guidance.remediation_guidance_id)) ||
    (record.validation_path_ref !== undefined && !validationPaths.some((pathRecord) => pathRecord.validation_path_id === record.validation_path_ref))
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (falsePositiveRecords.some((record) =>
    record.review_id !== classification.review_id ||
    record.classification_record_ref !== classification.classification_record_id ||
    record.review_finding_draft_ref !== classification.review_finding_draft_ref
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  const customerFacingScriptIds = new Set(customerFacingValidationScripts.map((script) => script.validation_script_id));
  const customerFacingPathIds = new Set(customerFacingValidationPaths.map((pathRecord) => pathRecord.validation_path_id));
  if (customerFacingValidationPaths.some((pathRecord) =>
    (pathRecord.reviewer_validation_script_refs ?? []).some((ref) => !customerFacingScriptIds.has(ref))
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  if (customerFacingValidationScripts.some((script) => !customerFacingPathIds.has(script.validation_path_ref))) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }

  const customerFacingGuidance = guidance?.visibility === "customer_facing" ? guidance : undefined;
  const customerFacingStatuses = statuses.filter((status) => status.visibility === "customer_facing");
  const latestStatus = latestCustomerStatus(customerFacingStatuses);
  if (customerFacingAcceptedRiskRecords.some((record) =>
    (record.remediation_context_ref !== undefined && customerFacingGuidance?.remediation_guidance_id !== record.remediation_context_ref) ||
    (record.validation_path_ref !== undefined && !customerFacingValidationPaths.some((pathRecord) => pathRecord.validation_path_id === record.validation_path_ref))
  )) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  const visibleAcceptedRiskRecords = customerFacingAcceptedRiskRecords.filter((record) =>
    (record.remediation_context_ref === undefined || customerFacingGuidance?.remediation_guidance_id === record.remediation_context_ref) &&
    (record.validation_path_ref === undefined || customerFacingValidationPaths.some((pathRecord) => pathRecord.validation_path_id === record.validation_path_ref))
  );
  const selectedAcceptedRiskRecord = selectLatestAcceptedRiskRecord(visibleAcceptedRiskRecords, input.accepted_risk_record_ref);
  const selectedFalsePositiveRecord = selectLatestFalsePositiveRecord(customerFacingFalsePositiveRecords, input.false_positive_record_ref);
  if (
    (input.accepted_risk_record_ref !== undefined && selectedAcceptedRiskRecord === undefined) ||
    (input.false_positive_record_ref !== undefined && selectedFalsePositiveRecord === undefined) ||
    (input.accepted_risk_record_ref === undefined && visibleAcceptedRiskRecords.length > 0 && selectedAcceptedRiskRecord === undefined) ||
    (input.false_positive_record_ref === undefined && customerFacingFalsePositiveRecords.length > 0 && selectedFalsePositiveRecord === undefined)
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_reference_mismatch" };
  }
  const acceptedRiskRecordRef = selectedAcceptedRiskRecord?.accepted_risk_record_id ?? input.accepted_risk_record_ref;
  const falsePositiveRecordRef = selectedFalsePositiveRecord?.false_positive_record_id ?? input.false_positive_record_ref;
  const verificationRecordRef = verificationRecord?.verification_record_id ?? input.verification_record_ref;
  const evidenceRefs = customerFacingGuidance?.evidence_refs?.length
    ? customerFacingGuidance.evidence_refs
    : [...new Set(classification.review_finding_draft_evidence_refs.map((ref) => ref.artifact_ref))];
  const record: CustomerFacingFindingRecord = {
    protocol_version: classification.protocol_version,
    review_id: classification.review_id,
    customer_facing_finding_record_id: `customer_facing_finding:${classification.classification_record_id.slice("classification_record:".length)}`,
    review_finding_draft_ref: classification.review_finding_draft_ref,
    classification_record_ref: classification.classification_record_id,
    ...(customerFacingGuidance === undefined ? {} : { remediation_guidance_ref: customerFacingGuidance.remediation_guidance_id }),
    customer_status_record_refs: customerFacingStatuses.map((status) => status.customer_status_record_id),
    ...(verificationRecordRef === undefined ? {} : { verification_record_ref: verificationRecordRef }),
    ...(acceptedRiskRecordRef === undefined ? {} : { accepted_risk_record_ref: acceptedRiskRecordRef }),
    ...(falsePositiveRecordRef === undefined ? {} : { false_positive_record_ref: falsePositiveRecordRef }),
    expert_classification: {
      classification: classification.classification,
      classification_record_ref: classification.classification_record_id,
      rationale_summary: classification.rationale,
      criteria_summary: classification.confirmation_criteria.length > 0 ? classification.confirmation_criteria.join(" ") : (classification.defensible_confirmation_criteria ?? classification.validation_path_summary ?? "Reviewer classification criteria remain bounded to submitted evidence."),
      limitations: [...classification.limitations]
    },
    evidence_basis: {
      evidence_refs: [...evidenceRefs] as CustomerFacingFindingRecord["evidence_basis"]["evidence_refs"],
      source_reference_state: customerFacingGuidance?.source_reference_state ?? classification.source_reference_state,
      limitations: customerFacingGuidance === undefined ? [...classification.limitations] : [...customerFacingGuidance.limitations]
    },
    reviewer_remediation_guidance: customerFacingGuidance === undefined
      ? {
          guidance_status: "guidance_unavailable_from_submitted_evidence",
          insufficient_evidence_reason: "Reviewer remediation guidance has not been recorded for this finding.",
          next_step_summary: "Record reviewer guidance or a scoped validation path before making remediation decisions.",
          limitations: ["Customer-facing projection does not infer guidance from classification alone."]
        }
      : {
          guidance_status: customerFacingGuidance.guidance_status,
          remediation_guidance_ref: customerFacingGuidance.remediation_guidance_id,
          ...(customerFacingGuidance.exploitability_rationale === undefined ? {} : { exploitability_rationale_summary: customerFacingGuidance.exploitability_rationale }),
          ...(customerFacingGuidance.suggested_remediation === undefined ? {} : { suggested_remediation_summary: customerFacingGuidance.suggested_remediation }),
          ...(customerFacingGuidance.validation_steps === undefined ? {} : { validation_step_summary: customerFacingGuidance.validation_steps }),
          ...(customerFacingGuidance.next_step_summary === undefined ? {} : { next_step_summary: customerFacingGuidance.next_step_summary }),
          ...(customerFacingGuidance.validation_path_summary === undefined ? {} : { validation_path_summary: customerFacingGuidance.validation_path_summary }),
          ...(customerFacingGuidance.validation_path_ref === undefined ? {} : { validation_path_ref: customerFacingGuidance.validation_path_ref }),
          ...(customerFacingGuidance.insufficient_evidence_reason === undefined ? {} : { insufficient_evidence_reason: customerFacingGuidance.insufficient_evidence_reason }),
          limitations: [...customerFacingGuidance.limitations]
        },
    customer_remediation_status: latestStatus === undefined
      ? { latest_status: "not_started", customer_notes_visible: false }
      : customerStatusProjection(latestStatus),
    verification_state: {
      status: verificationRecord?.verification_status ?? (verificationRecordRef === undefined ? "not_verified" : "verification_pending"),
      ...(verificationRecordRef === undefined ? {} : { verification_record_ref: verificationRecordRef }),
      summary: verificationRecord?.rationale ?? (verificationRecordRef === undefined
        ? "Epic 4 verification evidence has not been recorded for this finding."
        : "Verification evidence reference is present and awaits a reviewer decision.")
    },
    ...(customerFacingValidationPaths.length === 0 ? {} : {
      validation_paths: customerFacingValidationPaths.map(validationPathProjection)
    }),
    ...(customerFacingValidationScripts.length === 0 ? {} : {
      reviewer_validation_scripts: customerFacingValidationScripts.map(validationScriptProjection)
    }),
    future_outcome_visibility: {
      accepted_risk_visible: acceptedRiskRecordRef !== undefined,
      ...(acceptedRiskRecordRef === undefined ? {} : { accepted_risk_record_ref: acceptedRiskRecordRef }),
      false_positive_visible: falsePositiveRecordRef !== undefined,
      ...(falsePositiveRecordRef === undefined ? {} : { false_positive_record_ref: falsePositiveRecordRef })
    },
    ...(selectedAcceptedRiskRecord === undefined ? {} : { accepted_risk_outcome: acceptedRiskOutcomeProjection(selectedAcceptedRiskRecord, classification) }),
    ...(selectedFalsePositiveRecord === undefined ? {} : { false_positive_outcome: falsePositiveOutcomeProjection(selectedFalsePositiveRecord) }),
    evidence_consumer_export: input.evidence_consumer_export ?? "exclude",
    visibility: "customer_facing",
    source_derived_class: "retained_review_artifact"
  };

  if (
    customerFacingFindingHasForbiddenText(record) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:customer-facing-finding-record", record).length > 0
  ) {
    return { outcome: "rejected", reason: "customer_facing_finding_schema_invalid" };
  }
  return { outcome: "projected", record };
}

function selectLatestAcceptedRiskRecord(records: readonly AcceptedRiskRecord[], requestedRef: string | undefined): AcceptedRiskRecord | undefined {
  const candidates = requestedRef === undefined ? records : records.filter((record) => record.accepted_risk_record_id === requestedRef);
  return uniqueLatestByRecordedAt(candidates);
}

function selectLatestFalsePositiveRecord(records: readonly FalsePositiveRecord[], requestedRef: string | undefined): FalsePositiveRecord | undefined {
  const candidates = requestedRef === undefined ? records : records.filter((record) => record.false_positive_record_id === requestedRef);
  return uniqueLatestByRecordedAt(candidates);
}

type LatestByUtcTimestampSelection<T> =
  | { outcome: "none" }
  | { outcome: "selected"; record: T }
  | { outcome: "ambiguous"; records: readonly T[] }
  | { outcome: "invalid_timestamp" };

/**
 * Selects the record with the latest nanosecond-precision UTC instant among `records`
 * (optionally bounded to instants `<= bound`). Equal spellings/precisions of the same
 * instant are treated as equal, never ordered by string or array position. A genuine
 * multi-record tie at the latest instant is reported as `ambiguous` (carrying the tied
 * records, for callers with a deliberate tie-break) rather than silently resolved by
 * input order. Any candidate with an unparseable timestamp fails the whole selection
 * closed as `invalid_timestamp` rather than being silently skipped.
 */
function selectLatestByUtcTimestamp<T>(
  records: readonly T[],
  timestamp: (record: T) => string,
  bound?: bigint
): LatestByUtcTimestampSelection<T> {
  if (records.length === 0) {
    return { outcome: "none" };
  }
  const candidates: Array<{ record: T; instant: bigint }> = [];
  for (const record of records) {
    const instant = parseUtcTimestampNs(timestamp(record));
    if (instant === undefined) {
      return { outcome: "invalid_timestamp" };
    }
    if (bound === undefined || instant <= bound) {
      candidates.push({ record, instant });
    }
  }
  if (candidates.length === 0) {
    return { outcome: "none" };
  }
  let latestInstant: bigint | undefined;
  for (const candidate of candidates) {
    if (latestInstant === undefined || candidate.instant > latestInstant) {
      latestInstant = candidate.instant;
    }
  }
  const tied = candidates.filter((candidate) => candidate.instant === latestInstant).map((candidate) => candidate.record);
  const firstTied = tied[0];
  return tied.length === 1 && firstTied !== undefined ? { outcome: "selected", record: firstTied } : { outcome: "ambiguous", records: tied };
}

function uniqueLatestByRecordedAt<T extends { recorded_at: string }>(records: readonly T[]): T | undefined {
  const selection = selectLatestByUtcTimestamp(records, (record) => record.recorded_at);
  return selection.outcome === "selected" ? selection.record : undefined;
}

function acceptedRiskOutcomeProjection(record: AcceptedRiskRecord, classification: FindingClassificationRecord): NonNullable<CustomerFacingFindingRecord["accepted_risk_outcome"]> {
  const evidenceRefs = outcomeEvidenceRefs(record, classification);
  return {
    accepted_risk_record_ref: record.accepted_risk_record_id,
    actor_category: record.actor.actor_type === "customer_user" ? "customer_user" : record.actor.actor_type === "reviewer" ? "reviewer" : "vendor_service",
    evidence_basis_summary: record.field_export_policy?.evidence_basis === "include" ? `Customer accepted residual risk with evidence basis: ${record.evidence_basis.join(", ")}.` : "Accepted-risk evidence basis is recorded but excluded by export policy.",
    evidence_refs: record.field_export_policy?.evidence_basis === "include" ? evidenceRefs as NonNullable<CustomerFacingFindingRecord["accepted_risk_outcome"]>["evidence_refs"] : [] as unknown as NonNullable<CustomerFacingFindingRecord["accepted_risk_outcome"]>["evidence_refs"],
    customer_acceptance_summary: exportableAcceptedRiskCustomerSummary(record),
    ...(record.risk_owner !== undefined && record.field_export_policy?.risk_owner === "include" ? { risk_owner: record.risk_owner } : {}),
    ...(record.scope_of_acceptance !== undefined && record.field_export_policy?.scope_of_acceptance === "include" ? { scope_of_acceptance: record.scope_of_acceptance } : {}),
    ...(record.review_by_date === undefined ? {} : { review_by_date: record.review_by_date }),
    ...(record.remediation_context_ref === undefined ? {} : { remediation_context_ref: record.remediation_context_ref }),
    ...(record.validation_path_ref === undefined ? {} : { validation_path_ref: record.validation_path_ref }),
    limitations: exportableOutcomeLimitations(record.limitations, record.field_export_policy?.limitations),
    source_reference_state: record.source_reference_state,
    evidence_consumer_export: record.field_export_policy?.evidence_consumer_export ?? "exclude"
  };
}

function falsePositiveOutcomeProjection(record: FalsePositiveRecord): NonNullable<CustomerFacingFindingRecord["false_positive_outcome"]> {
  return {
    false_positive_record_ref: record.false_positive_record_id,
    actor_category: "reviewer",
    evidence_basis_summary: record.field_export_policy?.evidence_basis === "include" ? `Reviewer determined false positive with evidence basis: ${record.evidence_basis.join(", ")}.` : "False-positive evidence basis is recorded but excluded by export policy.",
    evidence_refs: record.field_export_policy?.evidence_basis === "include" ? outcomeEvidenceRefs(record) as NonNullable<CustomerFacingFindingRecord["false_positive_outcome"]>["evidence_refs"] : [] as unknown as NonNullable<CustomerFacingFindingRecord["false_positive_outcome"]>["evidence_refs"],
    rationale_summary: record.field_export_policy?.rationale === "include" ? record.rationale : "Reviewer false-positive rationale is excluded by export policy.",
    ...(record.candidate_finding_refs !== undefined && record.field_export_policy?.candidate_finding_refs === "include" ? { candidate_finding_refs: [...record.candidate_finding_refs] } : {}),
    limitations: exportableOutcomeLimitations(record.limitations, record.field_export_policy?.limitations),
    source_reference_state: record.source_reference_state,
    evidence_consumer_export: record.field_export_policy?.evidence_consumer_export ?? "exclude"
  };
}

function exportableAcceptedRiskCustomerSummary(record: AcceptedRiskRecord): string {
  if (record.customer_rationale !== undefined && record.field_export_policy?.customer_rationale === "include") {
    return record.customer_rationale;
  }
  if (record.customer_signoff_summary !== undefined && record.field_export_policy?.customer_signoff_summary === "include") {
    return record.customer_signoff_summary;
  }
  if (record.customer_signoff_ref !== undefined) {
    return `Customer sign-off evidence is recorded at ${record.customer_signoff_ref}; summary is excluded by export policy.`;
  }
  return "Customer rationale is recorded but excluded by export policy.";
}

function exportableOutcomeLimitations(limitations: readonly string[], exportPolicy: "include" | "exclude" | undefined): [string, ...string[]] {
  if (exportPolicy === "include") {
    return [...limitations] as [string, ...string[]];
  }
  return ["Outcome limitations are recorded but excluded by export policy."];
}

function outcomeEvidenceRefs(record: AcceptedRiskRecord | FalsePositiveRecord, classification?: FindingClassificationRecord): string[] {
  const refs = Array.isArray(record.review_finding_draft_evidence_refs) && record.review_finding_draft_evidence_refs.length > 0
    ? record.review_finding_draft_evidence_refs
    : classification?.review_finding_draft_evidence_refs ?? [];
  return [...new Set(refs.map((ref) => ref.artifact_ref).filter((ref): ref is string => typeof ref === "string"))];
}

function validationPathProjection(pathRecord: FindingValidationPath): NonNullable<CustomerFacingFindingRecord["validation_paths"]>[number] {
  return {
    validation_path_ref: pathRecord.validation_path_id,
    path_type: pathRecord.path_type,
    required_evidence: pathRecord.required_evidence,
    steps: pathRecord.steps,
    expected_result: pathRecord.expected_result,
    limitations: [...pathRecord.limitations],
    included_pass_verifiability: pathRecord.included_pass_verifiability,
    ...(pathRecord.reviewer_validation_script_refs === undefined ? {} : { reviewer_validation_script_refs: [...pathRecord.reviewer_validation_script_refs] }),
    ...(pathRecord.output_attachment_instructions === undefined ? {} : { output_attachment_instructions: pathRecord.output_attachment_instructions }),
    ...(pathRecord.target === undefined ? {} : { target: pathRecord.target }),
    ...(pathRecord.authorization_assumption === undefined ? {} : { authorization_assumption: pathRecord.authorization_assumption }),
    ...(pathRecord.method === undefined ? {} : { method: pathRecord.method }),
    ...(pathRecord.safety_constraints === undefined ? {} : { safety_constraints: pathRecord.safety_constraints }),
    ...(pathRecord.evidence_artifacts_to_collect === undefined ? {} : { evidence_artifacts_to_collect: [...pathRecord.evidence_artifacts_to_collect] })
  };
}

function validationScriptProjection(script: ReviewerValidationScript): NonNullable<CustomerFacingFindingRecord["reviewer_validation_scripts"]>[number] {
  return {
    validation_script_ref: script.validation_script_id,
    validation_path_ref: script.validation_path_ref,
    script_package_status: script.script_package_status,
    ...(script.included_script_slot === undefined ? {} : { included_script_slot: script.included_script_slot }),
    ...(script.script_package_status === "additional_script_candidate_pricing_tbd" ? { pricing_note: "Additional reviewer-authored script candidate; pricing TBD." } : {}),
    purpose: script.purpose,
    prerequisites: script.prerequisites,
    execution_steps: script.execution_steps,
    expected_output: script.expected_output,
    safety_notes: script.safety_notes,
    output_attachment_instructions: script.output_attachment_instructions,
    script_content: script.script_content
  };
}

/**
 * Resolves the single, authoritatively-bound `FindingValidationPath` for
 * `expectedPathRef`, so evidence and decision validation always agree on
 * exactly the same object rather than each reading a different context
 * field (C4-16). Prefers `context.validation_paths` when present; the
 * singular `context.validation_path` is a compatibility fallback used only
 * when the array is absent. Returns `undefined` on a missing ref, a
 * duplicate ID, a schema-invalid path, or a path not bound to `classification`.
 */
function resolveVerificationValidationPath(
  context: VerificationEvidenceBuildContext,
  expectedPathRef: string | undefined,
  classification: FindingClassificationRecord
): FindingValidationPath | undefined {
  if (!isNonEmptyString(expectedPathRef)) {
    return undefined;
  }
  const validationPaths = Array.isArray(context.validation_paths)
    ? context.validation_paths
    : context.validation_path === undefined ? [] : [context.validation_path];
  const validationPath = uniqueRecordById(validationPaths, "validation_path_id", expectedPathRef);
  if (
    validationPath === undefined ||
    validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", validationPath).length > 0 ||
    validationPath.review_id !== classification.review_id ||
    validationPath.classification_record_ref !== classification.classification_record_id ||
    validationPath.review_finding_draft_ref !== classification.review_finding_draft_ref
  ) {
    return undefined;
  }
  return validationPath;
}

function rejectionForVerificationEvidenceRecord(
  record: VerificationEvidenceRecord,
  context: VerificationEvidenceBuildContext
): VerificationEvidenceRejectionReason | undefined {
  if (!isRecord(record)) {
    return "verification_evidence_schema_invalid";
  }
  if (verificationPayloadFieldPresent(record)) {
    return "verification_evidence_payload_forbidden";
  }
  const actorType = isRecord(record.actor) ? record.actor.actor_type : undefined;
  if (actorType !== "customer_user" && actorType !== "vendor_service") {
    return "verification_evidence_actor_authority_required";
  }
  if (actorType === "vendor_service" && !isNonEmptyString(record.customer_actor_ref)) {
    return "verification_evidence_customer_backing_required";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-evidence-record", record).length > 0) {
    return "verification_evidence_schema_invalid";
  }
  const scope = context.verification_scope;
  const reviewScope = context.review_scope;
  const classification = context.classification;
  if (!isRecord(scope) || validateProtocolSchema("urn:codeattest:protocol:v0:verification-pass-scope", scope).length > 0) {
    return "verification_evidence_scope_ineligible";
  }
  // C4-15: a schema-valid, self-consistent scope is not necessarily the
  // *current* one -- a corrected (higher scope_version) scope may already
  // exist in the review's history. Require the supplied scope to be byte-
  // identical to the active (maximum scope_version) record in the caller-
  // supplied history, so a stale scope can no longer be used to admit
  // evidence against selection criteria that have since been superseded.
  const activeScope = activeVerificationScope(context.verification_scope_history, scope.review_id, scope.verification_pass_id);
  if (activeScope === undefined || !stableEquals(activeScope, scope)) {
    return "verification_evidence_scope_ineligible";
  }
  const selected = scope.selected_findings.find((finding) => finding.review_finding_draft_ref === record.review_finding_draft_ref);
  if (
    record.review_id !== scope.review_id ||
    record.verification_pass_id !== scope.verification_pass_id ||
    record.verification_pass_ref !== scope.verification_pass_id ||
    record.scope_version !== scope.scope_version ||
    selected === undefined ||
    selected.eligibility_state !== "eligible" ||
    selected.classification_record_ref !== record.classification_record_ref ||
    selected.requested_verification_type !== record.requested_verification_type
  ) {
    return selected === undefined || selected.eligibility_state !== "eligible"
      ? "verification_evidence_scope_ineligible"
      : "verification_evidence_reference_mismatch";
  }
  const recordedAt = parseUtcTimestampNs(record.recorded_at);
  const scopeRecordedAt = parseUtcTimestampNs(scope.scope_recorded_at);
  const deadline = parseUtcTimestampNs(scope.pass_deadline);
  if (recordedAt === undefined || scopeRecordedAt === undefined || deadline === undefined || recordedAt < scopeRecordedAt || recordedAt > deadline) {
    return "verification_evidence_scope_ineligible";
  }
  if (
    !isRecord(classification) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", classification).length > 0 ||
    classification.review_id !== record.review_id ||
    classification.classification_record_id !== record.classification_record_ref ||
    classification.review_finding_draft_ref !== record.review_finding_draft_ref ||
    classification.classification !== selected.current_classification
  ) {
    return "verification_evidence_reference_mismatch";
  }
  if (!isRecord(record.access_scope) || record.access_scope.review_scope !== record.review_id || !isNonEmptyString(record.access_scope.tenant_id)) {
    return "verification_evidence_lifecycle_invalid";
  }
  // C4-17: `access_scope.tenant_id` is evidence-supplied metadata, not an
  // authenticated fact -- nothing above derives it from actor identity,
  // review ID, artifact refs, or stored-object metadata. Require it to match
  // a tenant the caller supplies from authenticated/review context, not
  // inferred from anything in the record itself. This fixes the metadata
  // attribution only; the separate storage access gate still enforces
  // request/artifact tenant scope independently.
  if (!isNonEmptyString(context.trusted_tenant_id) || record.access_scope.tenant_id !== context.trusted_tenant_id) {
    return "verification_evidence_lifecycle_invalid";
  }

  if (record.requested_verification_type === "follow_up_commit") {
    if (!isRecord(reviewScope) || validateProtocolSchema("urn:codeattest:protocol:v0:review-scope", reviewScope).length > 0 || !isRecord(record.follow_up_commit)) {
      return "verification_evidence_commit_context_invalid";
    }
    const commit = record.follow_up_commit;
    if (
      !stableEquals(commit.original_selected_commit, reviewScope.selected_commit) ||
      commit.original_repository_identity !== reviewScope.repository_identity ||
      record.validation_path_ref !== undefined ||
      record.reviewer_validation_script_ref !== undefined ||
      record.validation_artifacts !== undefined
    ) {
      return "verification_evidence_commit_context_invalid";
    }
    if (commit.relationship_to_selected_commit === "same_commit_submitted") {
      if (commit.follow_up_commit.commit_sha !== commit.original_selected_commit.commit_sha || record.intake_state !== "verification_pending" || !isMeaningfulClassificationText(record.next_step_summary)) {
        return "verification_evidence_commit_context_invalid";
      }
    } else if (commit.follow_up_commit.commit_sha === commit.original_selected_commit.commit_sha) {
      return "verification_evidence_commit_context_invalid";
    }
    if (commit.relationship_to_selected_commit === "repository_mismatch") {
      if (commit.follow_up_repository_identity === commit.original_repository_identity || record.intake_state !== "broader_context_required" || !isMeaningfulClassificationText(record.next_step_summary)) {
        return "verification_evidence_commit_context_invalid";
      }
    } else if (commit.follow_up_repository_identity !== commit.original_repository_identity) {
      return "verification_evidence_commit_context_invalid";
    }
  } else {
    if (record.follow_up_commit !== undefined || !Array.isArray(record.validation_artifacts) || record.validation_artifacts.length === 0) {
      return "verification_evidence_validation_context_invalid";
    }
    if (selected.validation_path_ref === undefined || record.validation_path_ref !== selected.validation_path_ref) {
      return "verification_evidence_validation_context_invalid";
    }
    const validationPath = resolveVerificationValidationPath(context, record.validation_path_ref, classification);
    const validationScripts = Array.isArray(context.reviewer_validation_scripts)
      ? context.reviewer_validation_scripts
      : context.reviewer_validation_script === undefined ? [] : [context.reviewer_validation_script];
    const uniqueValidationScripts = uniqueRecordsById(validationScripts, "validation_script_id");
    if (
      validationPath === undefined ||
      uniqueValidationScripts === undefined ||
      rejectionForFindingValidationPath(validationPath, {
        classification,
        ...(context.remediation_guidance === undefined ? {} : { remediation_guidance: context.remediation_guidance }),
        reviewer_validation_scripts: uniqueValidationScripts
      }) !== undefined ||
      !verificationEvidencePathTypeMatchesRequest(record.requested_verification_type, validationPath.path_type)
    ) {
      return "verification_evidence_validation_context_invalid";
    }
    if (record.requested_verification_type === "reviewer_authored_script_output") {
      const validationScript = uniqueRecordById(uniqueValidationScripts, "validation_script_id", record.reviewer_validation_script_ref);
      if (
        record.reviewer_validation_script_ref === undefined ||
        !selected.reviewer_validation_script_refs?.includes(record.reviewer_validation_script_ref) ||
        validationScript === undefined ||
        validationScript.validation_path_ref !== record.validation_path_ref ||
        validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", validationScript).length > 0 ||
        rejectionForReviewerValidationScript(validationScript, { validation_path: validationPath, prior_included_scripts: [] }) !== undefined
      ) {
        return "verification_evidence_validation_context_invalid";
      }
    } else if (record.reviewer_validation_script_ref !== undefined && !selected.reviewer_validation_script_refs?.includes(record.reviewer_validation_script_ref)) {
      return "verification_evidence_validation_context_invalid";
    }
    if (!verificationEvidenceLifecycleIsValid(record, context)) {
      return "verification_evidence_lifecycle_invalid";
    }
  }

  if (record.intake_state !== "accepted_for_review" && !isMeaningfulClassificationText(record.next_step_summary)) {
    return "verification_evidence_next_step_required";
  }
  const texts: unknown[] = [
    record.state_reason,
    record.next_step_summary,
    record.follow_up_commit?.relationship_basis,
    ...(record.limitations ?? [])
  ];
  if (texts.some((value) => verificationArtifactTextHasForbiddenContent(value))) {
    return "verification_evidence_text_forbidden";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-evidence-record", record).length > 0) {
    return "verification_evidence_schema_invalid";
  }
  return undefined;
}

function uniqueRecordsById<T extends Record<string, unknown>>(records: readonly T[], idField: keyof T & string): T[] | undefined {
  if (!Array.isArray(records) || records.some((record) => !isRecord(record))) return undefined;
  const seen = new Set<string>();
  for (const record of records) {
    const id = record[idField];
    if (typeof id !== "string" || seen.has(id)) return undefined;
    seen.add(id);
  }
  return [...records];
}

function uniqueRecordById<T extends Record<string, unknown>>(records: readonly T[], idField: keyof T & string, expectedId: unknown): T | undefined {
  if (typeof expectedId !== "string") return undefined;
  const matches = records.filter((record) => record[idField] === expectedId);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolves the single active (maximum-version) record for a same-family
 * lineage out of a caller-supplied history array. Every candidate must be
 * plain JSON and schema-valid before it may compete for the head; a tie at
 * the maximum version is not a deterministic "active" record, so it fails
 * closed to `undefined` rather than picking one by array order.
 */
function activeVersionedRecord<T extends Record<string, unknown>>(
  history: readonly T[] | undefined,
  schemaId: Parameters<typeof validateProtocolSchema>[0],
  matches: (record: T) => boolean,
  versionField: keyof T & string
): T | undefined {
  if (!Array.isArray(history)) {
    return undefined;
  }
  const candidates = history.filter((record): record is T =>
    isPlainObjectValue(record) &&
    validateProtocolSchema(schemaId, record).length === 0 &&
    matches(record) &&
    Number.isSafeInteger(record[versionField])
  );
  if (candidates.length === 0) {
    return undefined;
  }
  let maxVersion = candidates[0]?.[versionField] as number;
  for (const candidate of candidates) {
    const version = candidate[versionField] as number;
    if (version > maxVersion) {
      maxVersion = version;
    }
  }
  const atMax = candidates.filter((candidate) => (candidate[versionField] as number) === maxVersion);
  return atMax.length === 1 ? atMax[0] : undefined;
}

function activeVerificationScope(
  history: readonly VerificationPassScope[] | undefined,
  reviewId: string,
  verificationPassId: string
): VerificationPassScope | undefined {
  return activeVersionedRecord(
    history,
    "urn:codeattest:protocol:v0:verification-pass-scope",
    (record) => record.review_id === reviewId && record.verification_pass_id === verificationPassId,
    "scope_version"
  );
}

function activeVerificationEvidenceRecord(
  history: readonly VerificationEvidenceRecord[] | undefined,
  reviewId: string,
  verificationEvidenceRecordId: string
): VerificationEvidenceRecord | undefined {
  return activeVersionedRecord(
    history,
    "urn:codeattest:protocol:v0:verification-evidence-record",
    (record) => record.review_id === reviewId && record.verification_evidence_record_id === verificationEvidenceRecordId,
    "record_version"
  );
}

function verificationEvidencePathTypeMatchesRequest(requestedType: VerificationEvidenceRecord["requested_verification_type"], pathType: FindingValidationPath["path_type"]): boolean {
  if (requestedType === "reviewer_authored_script_output") return pathType === "customer_run_script";
  if (requestedType === "manual_validation_record") return pathType === "manual_steps";
  if (requestedType === "remote_dynamic_testing_evidence") return pathType === "remote_dynamic_testing";
  return requestedType === "customer_validation_evidence";
}

function verificationEvidenceLifecycleIsValid(record: VerificationEvidenceRecord, context: VerificationEvidenceBuildContext): boolean {
  const classifications = Array.isArray(context.stored_object_classifications) ? context.stored_object_classifications : [];
  const retentionRecords = Array.isArray(context.retention_opt_in_records) ? context.retention_opt_in_records : [];
  const seen = new Set<string>();
  return (record.validation_artifacts ?? []).every((artifact) => {
    if (artifact.source_derived_class === "never_collected" || seen.has(artifact.artifact_ref)) {
      return false;
    }
    seen.add(artifact.artifact_ref);
    const classification = classifications.find((candidate) => candidate.artifact_ref === artifact.artifact_ref);
    if (
      classification === undefined ||
      classifyStoredObject(classification).outcome !== "classified" ||
      classification.object_kind !== "evidence_artifact" ||
      classification.source_derived_class !== artifact.source_derived_class ||
      classification.environment_profile !== record.environment_profile
    ) {
      return false;
    }
    if (artifact.source_derived_class !== "customer_opt_in_retained_source") {
      return artifact.retention_record_ref === undefined;
    }
    const retention = retentionRecords.find((candidate) => candidate.retention_record_id === artifact.retention_record_ref);
    if (retention === undefined || recordOptInRetention(retention, record.environment_profile).outcome !== "recorded" || !retention.retained_artifact_refs.includes(artifact.artifact_ref)) {
      return false;
    }
    const retentionStart = parseUtcTimestampNs(retention.retention_period.start_timestamp);
    const retentionEnd = parseUtcTimestampNs(retention.retention_period.end_timestamp);
    const recordedAt = parseUtcTimestampNs(record.recorded_at);
    return retentionStart !== undefined && retentionEnd !== undefined && recordedAt !== undefined && retentionStart <= recordedAt && retentionEnd >= recordedAt;
  });
}

function rejectionForVerificationRecord(
  record: VerificationRecord,
  context: VerificationDecisionBuildContext
): VerificationDecisionRejectionReason | undefined {
  if (!isRecord(record)) {
    return "verification_record_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "verification_record_reviewer_actor_required";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", record).length > 0) {
    return "verification_record_schema_invalid";
  }
  const scope = context.verification_scope;
  const classification = context.classification;
  const evidenceRecords = Array.isArray(context.evidence_records) ? context.evidence_records : [];
  if (
    !isRecord(scope) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:verification-pass-scope", scope).length > 0 ||
    !isRecord(classification) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", classification).length > 0
  ) {
    return "verification_record_reference_mismatch";
  }
  const selected = scope.selected_findings.find((finding) => finding.review_finding_draft_ref === record.review_finding_draft_ref);
  if (
    selected === undefined ||
    selected.eligibility_state !== "eligible" ||
    record.review_id !== scope.review_id ||
    record.verification_pass_id !== scope.verification_pass_id ||
    record.verification_pass_ref !== scope.verification_pass_id ||
    record.classification_record_ref !== selected.classification_record_ref ||
    classification.review_id !== record.review_id ||
    classification.classification_record_id !== record.classification_record_ref ||
    classification.review_finding_draft_ref !== record.review_finding_draft_ref
  ) {
    return "verification_record_reference_mismatch";
  }
  if (evidenceRecords.some((evidence) => !isPlainObjectValue(evidence) || rejectionForVerificationEvidenceRecord(evidence, context) !== undefined)) {
    return "verification_record_evidence_insufficient";
  }
  const evidenceById = new Map(evidenceRecords.map((evidence) => [evidence.verification_evidence_record_id, evidence]));
  if (evidenceById.size !== evidenceRecords.length || new Set(record.verification_evidence_record_refs).size !== record.verification_evidence_record_refs.length) {
    return "verification_record_reference_mismatch";
  }
  const boundEvidence = record.verification_evidence_record_refs.map((ref) => evidenceById.get(ref));
  if (boundEvidence.some((evidence) => evidence === undefined)) {
    return "verification_record_reference_mismatch";
  }
  // C4-15: a decision must not be able to bind a superseded evidence record
  // merely because the caller omitted its active (higher record_version)
  // correction from `evidence_records` -- require each bound evidence object
  // to be byte-identical to the active record for its ID in the caller-
  // supplied history.
  if (boundEvidence.some((evidence) => {
    if (evidence === undefined) return true;
    const activeEvidence = activeVerificationEvidenceRecord(context.evidence_record_history, evidence.review_id, evidence.verification_evidence_record_id);
    return activeEvidence === undefined || !stableEquals(activeEvidence, evidence);
  })) {
    return "verification_record_reference_mismatch";
  }
  const decisionAt = parseUtcTimestampNs(record.recorded_at);
  if (decisionAt === undefined || boundEvidence.some((evidence) => {
    if (evidence === undefined) return true;
    const evidenceAt = parseUtcTimestampNs(evidence.recorded_at);
    return evidence.review_id !== record.review_id ||
      evidence.verification_pass_id !== record.verification_pass_id ||
      evidence.verification_pass_ref !== record.verification_pass_ref ||
      evidence.scope_version !== scope.scope_version ||
      evidence.review_finding_draft_ref !== record.review_finding_draft_ref ||
      evidence.classification_record_ref !== record.classification_record_ref ||
      evidenceAt === undefined || evidenceAt > decisionAt;
  })) {
    return "verification_record_reference_mismatch";
  }
  // C4-16: derive the validated-path criterion from the same canonically
  // resolved path evidence validation uses (bound to `selected.validation_path_ref`),
  // never from an unbound singular `context.validation_path` a caller could
  // supply independently of the array actually used to validate evidence.
  const validatedPathCriterion = classification.classification === "requires_customer_side_validation" && classification.confirmation_criteria.length === 0
    ? resolveVerificationValidationPath(context, selected.validation_path_ref, classification)?.expected_result
    : undefined;
  const usableCriteria = validatedPathCriterion === undefined ? classification.confirmation_criteria : [validatedPathCriterion];
  if (
    record.before_state.classification !== classification.classification ||
    !stableEquals(record.before_state.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs.map((ref) => ref.artifact_ref)) ||
    !stableEquals(record.before_state.evidence_basis, classification.evidence_basis) ||
    record.before_state.source_reference_state !== classification.source_reference_state ||
    !stableEquals(record.before_state.confirmation_criteria, usableCriteria)
  ) {
    return "verification_record_before_state_mismatch";
  }
  const expectedCriteria = new Set(record.before_state.confirmation_criteria);
  const actualCriteria = record.after_state.criteria_results.map((result) => result.criterion);
  if (new Set(actualCriteria).size !== actualCriteria.length || actualCriteria.length !== expectedCriteria.size || actualCriteria.some((criterion) => !expectedCriteria.has(criterion))) {
    return "verification_record_criteria_mismatch";
  }
  const allowableEvidenceRefs = new Set(boundEvidence.flatMap((evidence) => evidence === undefined ? [] : [
    verificationEvidenceArtifactRef(evidence),
    ...(evidence.validation_artifacts ?? []).map((artifact: NonNullable<VerificationEvidenceRecord["validation_artifacts"]>[number]) => artifact.artifact_ref)
  ]));
  if (record.after_state.evidence_refs.some((ref) => !allowableEvidenceRefs.has(ref))) {
    return "verification_record_evidence_insufficient";
  }
  // C4-19: `not_verified` is a terminal negative customer outcome exactly
  // like `verification_complete` is a terminal positive one -- both must be
  // backed by fully intake-accepted evidence. Otherwise incomplete intake
  // (e.g. a `verification_pending` evidence record) could substantiate a
  // negative outcome rather than keeping the decision pending or requesting
  // broader context.
  const terminalDecision = record.verification_status === "verification_complete" || record.verification_status === "not_verified";
  const evidenceAccepted = boundEvidence.every((evidence) => evidence?.intake_state === "accepted_for_review");
  if (terminalDecision && !evidenceAccepted) {
    return "verification_record_evidence_insufficient";
  }
  if (!verificationDecisionStatusMatchesCriteria(record)) {
    return record.verification_status === "verification_complete"
      ? "verification_record_evidence_insufficient"
      : "verification_record_criteria_mismatch";
  }
  if (record.verification_status !== "verification_complete" && !isMeaningfulClassificationText(record.next_step_summary)) {
    return "verification_record_next_step_required";
  }
  const texts = [
    record.after_state.summary,
    record.rationale,
    record.next_step_summary,
    ...record.before_state.confirmation_criteria,
    ...record.after_state.criteria_results.map((result) => result.criterion),
    ...record.remaining_limitations
  ];
  if (texts.some((value) => verificationArtifactTextHasForbiddenContent(value))) {
    return "verification_record_text_forbidden";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", record).length > 0) {
    return "verification_record_schema_invalid";
  }
  return undefined;
}

function verificationDecisionStatusMatchesCriteria(record: VerificationRecord): boolean {
  const results = record.after_state.criteria_results.map((result) => result.result);
  if (record.verification_status === "verification_complete") {
    return results.every((result) => result === "satisfied");
  }
  if (record.verification_status === "not_verified") {
    return results.some((result) => result === "not_satisfied");
  }
  if (record.verification_status === "verification_pending") {
    return results.some((result) => result === "not_evaluated");
  }
  return results.some((result) => result === "customer_validation_required");
}

function rejectionForVerificationAddendum(
  record: VerificationAddendum,
  context: VerificationAddendumBuildContext
): VerificationAddendumRejectionReason | undefined {
  if (!isRecord(record)) {
    return "verification_addendum_schema_invalid";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-addendum", record).length > 0) {
    return "verification_addendum_schema_invalid";
  }
  const reviewScope = context.review_scope;
  const scope = context.verification_scope;
  const decisions = Array.isArray(context.verification_records) ? context.verification_records : [];
  const evidenceRecords = Array.isArray(context.evidence_records) ? context.evidence_records : [];
  const deletionEvidence = Array.isArray(context.deletion_evidence) ? context.deletion_evidence : [];
  const lifecycleEvents = Array.isArray(context.lifecycle_events) ? context.lifecycle_events : [];
  const history = Array.isArray(context.history_events) ? context.history_events : [];
  const classifications = Array.isArray(context.classifications)
    ? context.classifications
    : context.classification === undefined ? [] : [context.classification];
  const uniqueClassifications = uniqueRecordsById(classifications, "classification_record_id");
  if (
    !isRecord(reviewScope) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:review-scope", reviewScope).length > 0 ||
    !isRecord(scope) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:verification-pass-scope", scope).length > 0 ||
    record.review_id !== scope.review_id ||
    record.verification_pass_id !== scope.verification_pass_id ||
    record.verification_pass_ref !== scope.verification_pass_id ||
    record.review_scope_ref !== reviewScope.review_scope_id ||
    !stableEquals(record.selected_commit, reviewScope.selected_commit) ||
    record.repository_identity !== reviewScope.repository_identity
  ) {
    return "verification_addendum_reference_mismatch";
  }
  if (record.findings.length !== scope.selected_findings.length || new Set(record.findings.map((finding) => finding.review_finding_draft_ref)).size !== record.findings.length) {
    return "verification_addendum_required_artifact_missing";
  }
  if (
    decisions.some((decision) => !isRecord(decision) || validateProtocolSchema("urn:codeattest:protocol:v0:verification-record", decision).length > 0) ||
    evidenceRecords.some((evidence) => !isRecord(evidence) || validateProtocolSchema("urn:codeattest:protocol:v0:verification-evidence-record", evidence).length > 0) ||
    deletionEvidence.some((deletion) => !isRecord(deletion) || validateProtocolSchema("urn:codeattest:protocol:v0:deletion-evidence", deletion).length > 0) ||
    lifecycleEvents.some((event) => !isRecord(event) || validateProtocolSchema("urn:codeattest:protocol:v0:evidence-lifecycle-event", event).length > 0) ||
    uniqueClassifications === undefined ||
    uniqueClassifications.some((classification) => validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", classification).length > 0)
  ) {
    return "verification_addendum_reference_mismatch";
  }
  // C4-21: per-event schema validity alone does not mean `history` could
  // ever have arisen from real sequential appends -- a lone version-2
  // correction with no version-1 predecessor, an authority-invalid event, or
  // decreasing sequence order all pass schema checks individually. Replay
  // the whole array through the same append-validity rules `appendReviewEvent`
  // enforces before any of it is trusted to resolve active event versions.
  const historyReplay = storedReviewEventLogIsAppendValid(history, record.protocol_version, record.review_id);
  if (!historyReplay.valid) {
    return "verification_addendum_reference_mismatch";
  }
  const decisionById = new Map(decisions.map((decision) => [decision.verification_record_id, decision]));
  const evidenceById = new Map(evidenceRecords.map((evidence) => [evidence.verification_evidence_record_id, evidence]));
  if (decisionById.size !== decisions.length || evidenceById.size !== evidenceRecords.length) {
    return "verification_addendum_reference_mismatch";
  }
  for (const finding of record.findings) {
    const selected = scope.selected_findings.find((candidate) => candidate.review_finding_draft_ref === finding.review_finding_draft_ref);
    const decision = decisionById.get(finding.verification_record_ref);
    const classification = uniqueRecordById(uniqueClassifications ?? [], "classification_record_id", finding.classification_record_ref);
    const boundDecisionEvidence = finding.verification_evidence_record_refs.map((ref) => evidenceById.get(ref)).filter((entry): entry is VerificationEvidenceRecord => entry !== undefined);
    const decisionContext: VerificationDecisionBuildContext = {
      ...context,
      verification_scope: scope,
      review_scope: reviewScope,
      ...(classification === undefined ? {} : { classification }),
      evidence_records: boundDecisionEvidence
    };
    if (
      selected === undefined ||
      decision === undefined ||
      classification === undefined ||
      rejectionForVerificationRecord(decision, decisionContext) !== undefined ||
      selected.classification_record_ref !== finding.classification_record_ref ||
      selected.current_classification !== finding.current_classification ||
      decision.review_id !== record.review_id ||
      decision.verification_pass_id !== record.verification_pass_id ||
      decision.review_finding_draft_ref !== finding.review_finding_draft_ref ||
      decision.classification_record_ref !== finding.classification_record_ref ||
      decision.verification_status !== finding.verification_status ||
      decision.recorded_at !== finding.timestamp ||
      !stableEquals(decision.verification_evidence_record_refs, finding.verification_evidence_record_refs) ||
      decision.actor.actor_type !== finding.reviewer_actor_category ||
      decision.rationale !== finding.summary ||
      !stableEquals(decision.remaining_limitations, finding.remaining_limitations) ||
      decision.next_step_summary !== finding.next_step_summary ||
      selected.remediation_guidance_ref !== finding.remediation_guidance_ref ||
      selected.validation_path_ref !== finding.validation_path_ref ||
      selected.accepted_risk_record_ref !== finding.accepted_risk_record_ref ||
      selected.false_positive_record_ref !== finding.false_positive_record_ref
    ) {
      return "verification_addendum_reference_mismatch";
    }
    if (finding.verification_evidence_record_refs.some((ref) => !evidenceById.has(ref))) {
      return "verification_addendum_required_artifact_missing";
    }
  }
  const referencedEvidenceIds = new Set(record.findings.flatMap((finding) => finding.verification_evidence_record_refs));
  if (referencedEvidenceIds.size !== evidenceRecords.length || evidenceRecords.some((evidence) => !referencedEvidenceIds.has(evidence.verification_evidence_record_id))) {
    return "verification_addendum_reference_mismatch";
  }
  const retained = new Map(record.retained_evidence.map((entry) => [entry.artifact_ref, entry]));
  const deleted = new Map(record.deleted_evidence.map((entry) => [entry.artifact_ref, entry]));
  if (retained.size !== record.retained_evidence.length || deleted.size !== record.deleted_evidence.length || [...retained.keys()].some((ref) => deleted.has(ref))) {
    return "verification_addendum_reference_mismatch";
  }
  for (const evidence of evidenceRecords.filter((candidate) => record.findings.some((finding) => finding.verification_evidence_record_refs.includes(candidate.verification_evidence_record_id)))) {
    const evidenceRecordEntry = retained.get(verificationEvidenceArtifactRef(evidence));
    if (evidenceRecordEntry === undefined || evidenceRecordEntry.source_derived_class !== evidence.source_derived_class || evidenceRecordEntry.recorded_at !== evidence.recorded_at) {
      return "verification_addendum_required_artifact_missing";
    }
    for (const artifact of evidence.validation_artifacts ?? []) {
      if (artifact.source_derived_class === "retained_review_artifact" || artifact.source_derived_class === "customer_opt_in_retained_source") {
        const retainedEntry = retained.get(artifact.artifact_ref);
        if (retainedEntry === undefined || retainedEntry.source_derived_class !== artifact.source_derived_class || retainedEntry.recorded_at !== evidence.recorded_at) {
          return "verification_addendum_required_artifact_missing";
        }
      } else {
        const deletedEntry = deleted.get(artifact.artifact_ref);
        const deletionRecord = deletionEvidence.find((candidate) => candidate.deletion_evidence_id === deletedEntry?.deletion_evidence_ref && candidate.deleted_artifact_digests.includes(artifact.digest));
        const matchingLifecycleEvents = lifecycleEvents.filter((event) => event.review_id === record.review_id && event.event_type === "evidence_deleted" && event.artifact_refs.includes(artifact.artifact_ref) && event.deletion_evidence_ref === deletedEntry?.deletion_evidence_ref);
        const deletionLifecycleEvent = matchingLifecycleEvents.length === 1 ? matchingLifecycleEvents[0] : undefined;
        const expectedDeletionStatus = deletionRecord?.verification_status === "verified" ? "verified" : "pending";
        // C4-22: the deletion, lifecycle event, and addendum entry only had
        // to agree with each other -- nothing bounded the deletion instant
        // itself, so it could predate the evidence it claims to delete or
        // postdate the addendum reporting it. Require
        // evidence.recorded_at <= deletion_timestamp <= addendum.generated_at.
        const evidenceAt = parseUtcTimestampNs(evidence.recorded_at);
        const deletionAt = deletionRecord === undefined ? undefined : parseUtcTimestampNs(deletionRecord.deletion_timestamp);
        const generatedAt = parseUtcTimestampNs(record.generated_at);
        if (
          deletedEntry === undefined ||
          deletionRecord === undefined ||
          deletionLifecycleEvent === undefined ||
          deletionLifecycleEvent.source_derived_class !== artifact.source_derived_class ||
          deletionLifecycleEvent.event_timestamp !== deletionRecord.deletion_timestamp ||
          deletedEntry.deletion_timestamp !== deletionRecord.deletion_timestamp ||
          deletedEntry.deletion_verification_status !== expectedDeletionStatus ||
          evidenceAt === undefined ||
          deletionAt === undefined ||
          generatedAt === undefined ||
          deletionAt < evidenceAt ||
          deletionAt > generatedAt
        ) {
          return "verification_addendum_deletion_evidence_missing";
        }
      }
    }
  }
  const historyById = new Map(history.map((event) => [event.event_id, event]));
  if (historyById.size !== history.length || history.some((event) => event.review_id !== record.review_id) || record.history_refs.some((ref) => !historyById.has(ref))) {
    return "verification_addendum_required_artifact_missing";
  }
  const requiredHistoryRefs = new Set<string>();
  for (const finding of record.findings) {
    const decisionEvent = activeVersionedVerificationEventForRecord(history, "verification_recorded", record.review_id, finding.verification_record_ref.slice("verification_record:".length));
    const decisionIdentity = decisionEvent === undefined ? undefined : versionedVerificationIdentityFromEvent(decisionEvent, "verification_recorded");
    const decisionRecord = decisionById.get(finding.verification_record_ref);
    if (decisionEvent === undefined || decisionRecord === undefined || decisionIdentity?.recordId !== finding.verification_record_ref.slice("verification_record:".length) || decisionIdentity.recordVersion !== decisionRecord.record_version) return "verification_addendum_required_artifact_missing";
    requiredHistoryRefs.add(decisionEvent.event_id);
    for (const evidenceRef of finding.verification_evidence_record_refs) {
      const evidenceEvent = activeVersionedVerificationEventForRecord(history, "verification_evidence_recorded", record.review_id, evidenceRef.slice("verification_evidence:".length));
      const evidenceIdentity = evidenceEvent === undefined ? undefined : versionedVerificationIdentityFromEvent(evidenceEvent, "verification_evidence_recorded");
      const evidenceRecord = evidenceById.get(evidenceRef);
      if (evidenceEvent === undefined || evidenceRecord === undefined || evidenceIdentity?.recordId !== evidenceRef.slice("verification_evidence:".length) || evidenceIdentity.recordVersion !== evidenceRecord.record_version) return "verification_addendum_required_artifact_missing";
      requiredHistoryRefs.add(evidenceEvent.event_id);
    }
  }
  if ([...requiredHistoryRefs].some((ref) => !record.history_refs.includes(ref))) {
    return "verification_addendum_required_artifact_missing";
  }
  const unresolved = record.findings.some((finding) => finding.verification_status === "verification_pending" || finding.verification_status === "requires_customer_side_validation");
  if (unresolved && record.finalization_state !== "not_finalized") {
    return "verification_addendum_finalization_invalid";
  }
  if ((unresolved || record.finalization_state === "not_finalized") && !isMeaningfulClassificationText(record.next_step_summary)) {
    return "verification_addendum_next_step_required";
  }
  const generatedAt = parseUtcTimestampNs(record.generated_at);
  if (generatedAt === undefined || decisions.some((decision) => parseUtcTimestampNs(decision.recorded_at)! > generatedAt)) {
    return "verification_addendum_reference_mismatch";
  }
  const texts = [
    record.next_step_summary,
    ...record.limitations,
    ...record.findings.flatMap((finding) => [finding.summary, finding.next_step_summary, ...finding.remaining_limitations])
  ];
  if (texts.some((value) => verificationArtifactTextHasForbiddenContent(value))) {
    return "verification_addendum_text_forbidden";
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:verification-addendum", record).length > 0) {
    return "verification_addendum_schema_invalid";
  }
  return undefined;
}

const VERIFICATION_JSON_MAX_DEPTH = 64;
const VERIFICATION_JSON_MAX_NODES = 20_000;
const VERIFICATION_PAYLOAD_FIELD_NAMES = new Set(["payload", "content", "body", "raw_text", "raw_source", "source_text", "snippet", "stdout", "stderr", "script_output", "base64"]);

type VerificationJsonScanResult = { valid: boolean; payloadFieldPresent: boolean };

function scanVerificationJson(value: unknown): VerificationJsonScanResult {
  const ancestors = new Set<object>();
  let nodes = 0;
  let payloadFieldPresent = false;

  function visit(current: unknown, depth: number): boolean {
    nodes += 1;
    if (nodes > VERIFICATION_JSON_MAX_NODES || depth > VERIFICATION_JSON_MAX_DEPTH) return false;
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current) && Math.abs(current) <= Number.MAX_SAFE_INTEGER;
    if (typeof current !== "object") return false;
    if (ancestors.has(current)) return false;
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype || Reflect.ownKeys(current).some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return false;
        for (let index = 0; index < current.length; index += 1) {
          if (!Object.prototype.hasOwnProperty.call(current, index)) return false;
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true || !visit(descriptor.value, depth + 1)) return false;
        }
        return true;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) return false;
        if (VERIFICATION_PAYLOAD_FIELD_NAMES.has(key.toLowerCase())) payloadFieldPresent = true;
        if (!visit(descriptor.value, depth + 1)) return false;
      }
      return true;
    } finally {
      ancestors.delete(current);
    }
  }

  return { valid: visit(value, 0), payloadFieldPresent };
}

function verificationPayloadFieldPresent(value: unknown): boolean {
  return scanVerificationJson(value).payloadFieldPresent;
}

function verificationEvidenceArtifactRef(record: VerificationEvidenceRecord): string {
  return `artifact_ref:${record.verification_evidence_record_id.slice("verification_evidence:".length)}`;
}

function verificationDecisionArtifactRef(record: VerificationRecord): string {
  return `artifact_ref:${record.verification_record_id.slice("verification_record:".length)}`;
}

function verificationEvidenceEventIdempotencyKey(record: VerificationEvidenceRecord): string {
  return `verification_evidence:${record.review_id}:${record.verification_evidence_record_id}:record_version:${record.record_version}`;
}

function verificationDecisionEventIdempotencyKey(record: VerificationRecord): string {
  return `verification_record:${record.review_id}:${record.verification_record_id}:record_version:${record.record_version}`;
}

function rejectionForVerificationPassScope(record: VerificationPassScope, context: VerificationPassScopeBuildContext): VerificationPassScopeRejectionReason | undefined {
  if (!isRecord(record)) {
    return "verification_scope_schema_invalid";
  }
  const actorType = isRecord(record.actor) ? record.actor.actor_type : undefined;
  if (actorType !== "customer_user" && actorType !== "reviewer" && actorType !== "vendor_service") {
    return "verification_scope_actor_authority_required";
  }
  // MVP authority is explicit provenance presence (AD-11), not a customer
  // registry lookup. A later identity service can strengthen this binding.
  if (actorType !== "customer_user" && !isNonEmptyString(record.customer_actor_ref) && !isNonEmptyString(record.customer_selection_evidence_ref)) {
    return "verification_scope_customer_backing_required";
  }
  if (verificationScopeActorIsForbiddenMachine(record.actor)) {
    return "verification_scope_actor_authority_required";
  }
  if (record.source_derived_class !== "retained_review_artifact") {
    return "verification_scope_schema_invalid";
  }
  if (!Array.isArray(record.selected_findings) || record.selected_findings.length === 0 || !record.selected_findings.every(isRecord)) {
    return "verification_scope_selected_findings_required";
  }
  const forbiddenFields = ["follow_up_commit_ref", "follow_up_commit", "uploaded_validation_evidence_ref", "validation_evidence_ref", "before_after_outcome", "before_after_decision", "verification_complete", "verified_with_evidence", "verification_decision", "addendum_ref", "attestation_addendum_ref", "fixed", "resolved", "remediated", "accepted_risk_record", "false_positive_record"];
  for (const field of forbiddenFields) {
    if ((record as Record<string, unknown>)[field] !== undefined || record.selected_findings.some((finding) => (finding as Record<string, unknown>)[field] !== undefined)) {
      return "verification_scope_story_4_1_field_forbidden";
    }
  }

  const start = parseUtcTimestampNs(record.included_pass_started_at);
  const recorded = parseUtcTimestampNs(record.scope_recorded_at);
  const deadline = parseUtcTimestampNs(record.pass_deadline);
  if (start === undefined || recorded === undefined || deadline === undefined) {
    return "verification_scope_deadline_outside_included_window";
  }
  const maxWindowNs = 30n * 24n * 60n * 60n * 1_000_000_000n;
  const deadlineDelta = deadline - start;
  if (deadlineDelta <= 0n || deadlineDelta > maxWindowNs || recorded < start || recorded > deadline) {
    return "verification_scope_deadline_outside_included_window";
  }
  if (verificationScopeDeadlineBasisIsUnsafe(record.included_pass_start_basis, record.limitations)) {
    return "verification_scope_deadline_basis_limitation_required";
  }

  const allocation = isRecord(record.included_script_allocation) ? record.included_script_allocation : undefined;
  if (allocation === undefined || !Array.isArray(allocation.included_slots) || !Array.isArray(allocation.additional_script_candidates)) {
    return "verification_scope_schema_invalid";
  }
  const includedSlots = allocation.included_slots.filter(isRecord);
  if (includedSlots.length !== allocation.included_slots.length) {
    return "verification_scope_schema_invalid";
  }
  if (includedSlots.length > 3) {
    return "verification_scope_included_script_cap_exceeded";
  }
  const slotNumbers = new Set<number>();
  for (const slot of includedSlots) {
    const slotNumber = slot.slot;
    if (!Number.isInteger(slotNumber) || typeof slotNumber !== "number" || slotNumber < 1 || slotNumber > 3) {
      return "verification_scope_included_script_cap_exceeded";
    }
    if (slotNumbers.has(slotNumber)) {
      return "verification_scope_included_script_slot_duplicate";
    }
    slotNumbers.add(slotNumber);
  }
  const additionalCandidates = allocation.additional_script_candidates.filter(isRecord);
  if (additionalCandidates.length !== allocation.additional_script_candidates.length) {
    return "verification_scope_schema_invalid";
  }
  for (const candidate of additionalCandidates) {
    if (candidate.pricing_posture !== "pricing_tbd" || !/pricing\s*tbd/iu.test(`${String(candidate.reason ?? "")} ${String(candidate.pricing_posture ?? "")}`)) {
      return "verification_scope_additional_script_pricing_tbd_required";
    }
  }
  const allocationEntries = [...includedSlots, ...additionalCandidates];
  const allocationEntriesByScriptRef = new Map<string, Record<string, unknown>>();
  for (const allocationEntry of allocationEntries) {
    if (typeof allocationEntry.validation_script_ref !== "string") {
      return "verification_scope_script_allocation_ref_mismatch";
    }
    if (allocationEntriesByScriptRef.has(allocationEntry.validation_script_ref)) {
      return "verification_scope_script_allocation_ref_mismatch";
    }
    allocationEntriesByScriptRef.set(allocationEntry.validation_script_ref, allocationEntry);
  }

  const drafts = contextReviewFindingDraftsById(context.review_finding_drafts);
  const classifications = contextRecordsById(context.classifications, "classification_record_id");
  const guidance = contextRecordsById(context.remediation_guidance_records, "remediation_guidance_id");
  const statuses = contextRecordsById(context.customer_status_records, "customer_status_record_id");
  const validationPaths = contextRecordsById(context.validation_paths, "validation_path_id");
  const validationScripts = contextRecordsById(context.reviewer_validation_scripts, "validation_script_id");
  const acceptedRisks = contextRecordsById(context.accepted_risk_records, "accepted_risk_record_id");
  const falsePositives = contextRecordsById(context.false_positive_records, "false_positive_record_id");
  if (
    drafts === undefined ||
    classifications === undefined ||
    guidance === undefined ||
    statuses === undefined ||
    validationPaths === undefined ||
    validationScripts === undefined ||
    acceptedRisks === undefined ||
    falsePositives === undefined
  ) {
    return "verification_scope_reference_mismatch";
  }

  const selectedFindingRefs = new Set<string>();
  const selectedScriptRefs = new Set<string>();
  const contextScripts = Array.isArray(context.reviewer_validation_scripts)
    ? context.reviewer_validation_scripts.filter(isRecord) as ReviewerValidationScript[]
    : [];

  for (const finding of record.selected_findings) {
    if (!isNonEmptyString(finding.classification_record_ref)) {
      return "verification_scope_classification_binding_required";
    }
    if (!isNonEmptyString(finding.review_finding_draft_ref)) {
      return "verification_scope_reference_mismatch";
    }
    if (selectedFindingRefs.has(finding.review_finding_draft_ref)) {
      return "verification_scope_reference_mismatch";
    }
    selectedFindingRefs.add(finding.review_finding_draft_ref);
    if (!isMeaningfulVerificationScopeReason(finding.eligibility_reason)) {
      return "verification_scope_eligibility_reason_required";
    }
    if (!Array.isArray(finding.limitations) || finding.limitations.length === 0 || finding.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation))) {
      return "verification_scope_limitations_required";
    }

    const classification = classifications.get(finding.classification_record_ref) as FindingClassificationRecord | undefined;
    const latestClassification = latestVerificationScopeClassificationRecord(context.classifications, record.review_id, finding.review_finding_draft_ref, recorded);
    if (
      classification === undefined ||
      !validVerificationScopeClassificationRecord(classification, recorded) ||
      !visibilityAllowedInVerificationScope(record.visibility, classification.visibility) ||
      latestClassification === undefined ||
      latestClassification.classification_record_id !== classification.classification_record_id
    ) {
      return "verification_scope_classification_binding_mismatch";
    }
    if (
      classification.review_id !== record.review_id ||
      classification.review_finding_draft_ref !== finding.review_finding_draft_ref ||
      classification.classification !== finding.current_classification
    ) {
      return "verification_scope_classification_binding_mismatch";
    }

    const draft = drafts.get(finding.review_finding_draft_ref);
    if (
      draft === undefined ||
      draft.reviewId !== record.review_id ||
      !draftEvidenceRefsAreConsistent(draft.evidenceRefs) ||
      !stableEquals(draft.evidenceRefs, classification.review_finding_draft_evidence_refs) ||
      !classificationSourceReferenceStateMatchesDraft(classification.source_reference_state, draft.evidenceRefs)
    ) {
      return "verification_scope_draft_binding_mismatch";
    }

    let guidanceRecord: FindingRemediationGuidance | undefined;
    if (isNonEmptyString(finding.remediation_guidance_ref)) {
      guidanceRecord = guidance.get(finding.remediation_guidance_ref) as FindingRemediationGuidance | undefined;
      const latestGuidance = latestVerificationScopeRemediationGuidanceRecord(
        context.remediation_guidance_records,
        record.review_id,
        finding.classification_record_ref,
        finding.review_finding_draft_ref,
        recorded
      );
      if (
        guidanceRecord === undefined ||
        !validVerificationScopeRemediationGuidanceRecord(guidanceRecord, recorded, classification) ||
        !visibilityAllowedInVerificationScope(record.visibility, guidanceRecord.visibility) ||
        latestGuidance === undefined ||
        latestGuidance.remediation_guidance_id !== guidanceRecord.remediation_guidance_id ||
        guidanceRecord.review_id !== record.review_id ||
        guidanceRecord.classification_record_ref !== finding.classification_record_ref ||
        guidanceRecord.review_finding_draft_ref !== finding.review_finding_draft_ref
      ) {
        return "verification_scope_reference_mismatch";
      }
    }

    if (finding.current_customer_remediation_status !== undefined || isNonEmptyString(finding.customer_status_record_ref)) {
      if (!isNonEmptyString(finding.customer_status_record_ref) || finding.current_customer_remediation_status === undefined) {
        return "verification_scope_reference_mismatch";
      }
      const statusRecord = statuses.get(finding.customer_status_record_ref) as CustomerRemediationStatusRecord | undefined;
      const latestStatus = latestVerificationScopeCustomerStatusRecord(
        context.customer_status_records,
        record.review_id,
        finding.classification_record_ref,
        finding.review_finding_draft_ref,
        recorded
      );
      if (
        statusRecord === undefined ||
        !validVerificationScopeCustomerStatusRecord(statusRecord, recorded) ||
        !visibilityAllowedInVerificationScope(record.visibility, statusRecord.visibility) ||
        latestStatus === undefined ||
        latestStatus.customer_status_record_id !== statusRecord.customer_status_record_id ||
        statusRecord.review_id !== record.review_id ||
        statusRecord.classification_record_ref !== finding.classification_record_ref ||
        statusRecord.finding_ref !== finding.review_finding_draft_ref ||
        statusRecord.customer_remediation_status !== finding.current_customer_remediation_status ||
        (guidanceRecord === undefined
          ? statusRecord.remediation_guidance_ref !== undefined
          : statusRecord.remediation_guidance_ref !== undefined && statusRecord.remediation_guidance_ref !== guidanceRecord.remediation_guidance_id)
      ) {
        return "verification_scope_reference_mismatch";
      }
    }

    let validationPath: FindingValidationPath | undefined;
    if (isNonEmptyString(finding.validation_path_ref)) {
      validationPath = validationPaths.get(finding.validation_path_ref) as FindingValidationPath | undefined;
      if (
        validationPath === undefined ||
        !validVerificationScopeValidationPathRecord(validationPath, recorded, {
          classification,
          ...(guidanceRecord === undefined ? {} : { remediation_guidance: guidanceRecord }),
          reviewer_validation_scripts: contextScripts
        }) ||
        !visibilityAllowedInVerificationScope(record.visibility, validationPath.visibility) ||
        validationPath.review_id !== record.review_id ||
        validationPath.classification_record_ref !== finding.classification_record_ref ||
        validationPath.review_finding_draft_ref !== finding.review_finding_draft_ref
      ) {
        return "verification_scope_reference_mismatch";
      }
      if (
        (guidanceRecord === undefined && isNonEmptyString(validationPath.remediation_guidance_ref)) ||
        (guidanceRecord !== undefined && isNonEmptyString(validationPath.remediation_guidance_ref) && validationPath.remediation_guidance_ref !== guidanceRecord.remediation_guidance_id)
      ) {
        return "verification_scope_reference_mismatch";
      }
      if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && validationPath.included_pass_verifiability === "additional_agreement_required") {
        return "verification_scope_validation_path_required_for_eligible";
      }
    }

    const scriptRefs = Array.isArray(finding.reviewer_validation_script_refs) ? finding.reviewer_validation_script_refs : [];
    if (finding.reviewer_validation_script_refs !== undefined && (!Array.isArray(finding.reviewer_validation_script_refs) || scriptRefs.some((ref) => typeof ref !== "string"))) {
      return "verification_scope_schema_invalid";
    }
    if (new Set(scriptRefs).size !== scriptRefs.length) {
      return "verification_scope_script_allocation_ref_mismatch";
    }
    if (validationPath === undefined) {
      if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible") {
        return "verification_scope_validation_path_required_for_eligible";
      }
      if (scriptRefs.length > 0) {
        return "verification_scope_reference_mismatch";
      }
    }
    for (const scriptRef of scriptRefs) {
      const script = validationScripts.get(scriptRef) as ReviewerValidationScript | undefined;
      const allocationEntry = allocationEntriesByScriptRef.get(scriptRef);
      if (script === undefined && allocationEntry === undefined) {
        return "verification_scope_script_allocation_ref_mismatch";
      }
      if (script === undefined) {
        return "verification_scope_reference_mismatch";
      }
      if (allocationEntry === undefined) {
        return "verification_scope_script_allocation_ref_mismatch";
      }
      if (
        validationPath === undefined ||
        !validVerificationScopeValidationScriptRecord(script, recorded, { validation_path: validationPath }) ||
        !visibilityAllowedInVerificationScope(record.visibility, script.visibility) ||
        script.review_id !== record.review_id ||
        script.classification_record_ref !== finding.classification_record_ref ||
        script.validation_path_ref !== validationPath.validation_path_id ||
        ((guidanceRecord === undefined && isNonEmptyString(script.remediation_guidance_ref)) ||
          (guidanceRecord !== undefined && script.remediation_guidance_ref !== guidanceRecord.remediation_guidance_id))
      ) {
        return "verification_scope_reference_mismatch";
      }
      if (allocationEntry === undefined || allocationEntry.finding_ref !== finding.review_finding_draft_ref) {
        return "verification_scope_script_allocation_ref_mismatch";
      }
      if (script.script_package_status === "included_base_package") {
        if (typeof allocationEntry.slot !== "number" || allocationEntry.slot !== script.included_script_slot) {
          return "verification_scope_script_allocation_ref_mismatch";
        }
      } else if (
        script.script_package_status !== "additional_script_candidate_pricing_tbd" ||
        allocationEntry.pricing_posture !== "pricing_tbd" ||
        allocationEntry.slot !== undefined
      ) {
        return "verification_scope_script_allocation_ref_mismatch";
      }
      if (selectedScriptRefs.has(scriptRef)) {
        return "verification_scope_script_allocation_ref_mismatch";
      }
      selectedScriptRefs.add(scriptRef);
    }

    if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && validationPath === undefined) {
      return "verification_scope_validation_path_required_for_eligible";
    }
    if (finding.eligibility_state === "blocked_pending_validation_path" && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) {
      return "verification_scope_blocked_next_step_required";
    }
    if (finding.eligibility_state === "requires_additional_agreement" && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) {
      return "verification_scope_additional_agreement_next_step_required";
    }

    if (isNonEmptyString(finding.accepted_risk_record_ref)) {
      const acceptedRisk = acceptedRisks.get(finding.accepted_risk_record_ref) as AcceptedRiskRecord | undefined;
      if (
        acceptedRisk === undefined ||
        !validVerificationScopeAcceptedRiskRecord(acceptedRisk, recorded, {
          classification,
          ...(guidanceRecord === undefined ? {} : { remediation_guidance: guidanceRecord }),
          ...(validationPath === undefined ? {} : { validation_path: validationPath }),
          reviewer_validation_scripts: contextScripts
        }) ||
        !visibilityAllowedInVerificationScope(record.visibility, acceptedRisk.visibility)
      ) {
        return "verification_scope_reference_mismatch";
      }
    }
    if (isNonEmptyString(finding.false_positive_record_ref)) {
      const falsePositive = falsePositives.get(finding.false_positive_record_ref) as FalsePositiveRecord | undefined;
      if (
        falsePositive === undefined ||
        !validVerificationScopeFalsePositiveRecord(falsePositive, recorded, { classification }) ||
        !visibilityAllowedInVerificationScope(record.visibility, falsePositive.visibility)
      ) {
        return "verification_scope_reference_mismatch";
      }
    }

    if ((isNonEmptyString(finding.false_positive_record_ref) || isNonEmptyString(finding.accepted_risk_record_ref)) && finding.eligibility_state !== "out_of_scope") {
      const hasNewFormalPath = validationPath !== undefined && finding.requested_verification_type !== "follow_up_commit";
      if (!hasNewFormalPath) {
        return "verification_scope_outcome_default_out_of_scope_required";
      }
    }
  }

  if (allocationEntriesByScriptRef.size !== selectedScriptRefs.size) {
    return "verification_scope_script_allocation_ref_mismatch";
  }

  const texts: unknown[] = [
    record.included_pass_start_basis,
    ...(Array.isArray(record.limitations) ? record.limitations : []),
    ...record.selected_findings.flatMap((finding) => [finding.eligibility_reason, ...(Array.isArray(finding.limitations) ? finding.limitations : [])]),
    ...additionalCandidates.map((candidate) => candidate.reason)
  ];
  if (texts.some((value) => verificationScopeTextHasForbiddenContent(value))) {
    return "verification_scope_text_forbidden";
  }
  return undefined;
}

function verificationScopeActorIsForbiddenMachine(actor: unknown): boolean {
  if (!isRecord(actor)) {
    return false;
  }
  const actorType = String(actor.actor_type ?? "").toLowerCase();
  const actorId = String(actor.actor_id ?? "").toLowerCase();
  if (["local_runner", "local-runner", "runner", "worker", "scanner", "static_bundle", "static-bundle"].includes(actorType)) {
    return true;
  }
  return actorId.split(":").some((segment) => verificationScopeActorSegmentIsForbiddenMachine(segment));
}

function verificationScopeActorSegmentIsForbiddenMachine(segment: string): boolean {
  return /^(?:local[_-]?runner(?:[_-].+|\d+)?|runner(?:[_-].+|\d+)?|worker(?:pool(?:[_-].+|\d+)?|[_-].+|\d+)?|scanner(?:[_-].+|\d+)?|static[_-]?bundle(?:[_-].+|\d+)?)$/u.test(segment);
}

function verificationScopeDeadlineBasisIsUnsafe(startBasis: unknown, limitations: unknown): boolean {
  const basis = typeof startBasis === "string" ? startBasis.toLowerCase() : "";
  const limitationText = Array.isArray(limitations) ? limitations.filter((value): value is string => typeof value === "string").join(" ").toLowerCase() : "";
  const uncertainBasis = /unavailable|unknown|estimated|fallback|basis used/u.test(basis);
  const impliesSla = /(?:guaranteed|committed|assured|contractual|promised).{0,40}(?:within|in|delivery|deadline)?\s*30\s*days|30\s*days.{0,40}(?:guaranteed|committed|assured|contractual|promised|delivery|deadline)|\b30-day\s*sla\b|\bcontractual\s+30-day\s+sla\b|\bpromised\s+delivery\s+within\s+30\s+days\b/u.test(`${basis} ${limitationText}`);
  return impliesSla || (uncertainBasis && !/basis|deadline|included pass|30 days|sla/u.test(limitationText));
}

function verificationScopeReasonHasSpecificNextStep(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  if (/\b(?:no|not|without|do not|does not|cannot)\b.{0,40}\b(?:validation path|formal path|next step|additional agreement|obtain|request|record|agree|confirm)\b/u.test(normalized)) {
    return false;
  }
  return /\b(?:obtain|request|record|agree|confirm|create|provide|submit|document|schedule)\b.{0,80}\b(?:validation path|formal path|next step|additional agreement|pricing\s*tbd|customer approval|order form|scope)\b|\b(?:validation path|formal path|additional agreement|pricing\s*tbd)\b.{0,80}\b(?:required|needed|before|must|next)\b/u.test(normalized);
}

type ContextReviewFindingDraft = {
  reviewId: string;
  evidenceRefs: readonly Record<string, unknown>[];
};

function contextReviewFindingDraftsById(records: readonly ReviewFindingDraftSet[] | undefined): Map<string, ContextReviewFindingDraft> | undefined {
  if (records === undefined) {
    return new Map();
  }
  if (!Array.isArray(records) || records.some((record) => !isRecord(record) || !Array.isArray(record.review_finding_drafts))) {
    return undefined;
  }
  const output = new Map<string, ContextReviewFindingDraft>();
  for (const record of records) {
    for (const draft of record.review_finding_drafts) {
      if (!isRecord(draft) || typeof draft.review_finding_draft_id !== "string" || !Array.isArray(draft.evidence_refs) || output.has(draft.review_finding_draft_id)) {
        return undefined;
      }
      const evidenceRefs = draft.evidence_refs.filter(isRecord);
      if (evidenceRefs.length !== draft.evidence_refs.length) {
        return undefined;
      }
      output.set(draft.review_finding_draft_id, { reviewId: record.review_id, evidenceRefs });
    }
  }
  return output;
}

function contextRecordsById<T extends Record<string, unknown>>(records: readonly T[] | undefined, key: keyof T & string): Map<string, T> | undefined {
  if (records === undefined) {
    return new Map();
  }
  if (!Array.isArray(records) || records.some((record) => !isRecord(record))) {
    return undefined;
  }
  const output = new Map<string, T>();
  for (const record of records) {
    const id = record[key];
    if (typeof id !== "string" || output.has(id)) {
      return undefined;
    }
    output.set(id, record);
  }
  return output;
}

function verificationScopeTextHasForbiddenContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => verificationScopeTextHasForbiddenContent(item));
  }
  return textHasForbiddenClassificationContent(value) || claimSafePositiveClosurePhrase(value) !== undefined;
}

function verificationPassScopeArtifactRef(record: VerificationPassScope): string {
  return `artifact_ref:${record.verification_pass_id.slice("verification_pass:".length)}`;
}

function verificationPassScopeEventIdempotencyKey(record: VerificationPassScope): string {
  return `verification_scope:${record.review_id}:${record.verification_pass_id}:scope_version:${record.scope_version}`;
}

type VerificationScopeEventIdentity = {
  reviewId: string;
  verificationPassId: string;
  scopeVersion: number;
};

function verificationScopeIdentityFromEvent(event: Pick<ReviewEvent, "idempotency_key">): VerificationScopeEventIdentity | undefined {
  if (typeof event.idempotency_key !== "string") {
    return undefined;
  }
  const match = /^verification_scope:(review:[a-z0-9][a-z0-9_-]{2,63}):verification_pass:([a-z0-9][a-z0-9_-]{2,63}):scope_version:([1-9][0-9]*)$/u.exec(event.idempotency_key);
  if (match === null) {
    return undefined;
  }
  const scopeVersion = parseCanonicalSafePositiveInteger(match[3]!);
  return scopeVersion === undefined ? undefined : { reviewId: match[1]!, verificationPassId: match[2]!, scopeVersion };
}

function verificationScopeCorrectionVersionIsValid(event: ReviewEvent, superseded: ReviewEvent | undefined, activeVerificationScopeEvent: ReviewEvent | undefined = superseded): boolean {
  const current = verificationScopeIdentityFromEvent(event);
  const prior = superseded === undefined ? undefined : verificationScopeIdentityFromEvent(superseded);
  const active = activeVerificationScopeEvent === undefined ? undefined : verificationScopeIdentityFromEvent(activeVerificationScopeEvent);
  return current !== undefined &&
    prior !== undefined &&
    active !== undefined &&
    current.reviewId === prior.reviewId &&
    current.verificationPassId === prior.verificationPassId &&
    current.reviewId === active.reviewId &&
    current.verificationPassId === active.verificationPassId &&
    current.scopeVersion > prior.scopeVersion &&
    current.scopeVersion > active.scopeVersion;
}

function verificationPassScopeEventReason(record: VerificationPassScope): string {
  const customerBacking = record.actor.actor_type === "customer_user"
    ? "Customer-selected scope recorded by customer actor."
    : "Customer-backed selection provenance is recorded.";
  return `Verification pass scope recorded. Selected findings: ${record.selected_findings.length}. Included pass deadline: ${record.pass_deadline}. ${customerBacking}`;
}

function latestVerificationScopeEvent(events: readonly ReviewEvent[], event: Pick<ReviewEvent, "review_id" | "idempotency_key">): ReviewEvent | undefined {
  const identity = verificationScopeIdentityFromEvent(event);
  if (identity === undefined) {
    return undefined;
  }
  return [...events]
    .filter((candidate) => candidate.event_type === "verification_scope_recorded")
    .filter((candidate) => {
      const candidateIdentity = verificationScopeIdentityFromEvent(candidate);
      return candidateIdentity !== undefined && candidateIdentity.reviewId === identity.reviewId && candidateIdentity.verificationPassId === identity.verificationPassId;
    })
    .sort((left, right) => {
      const leftIdentity = verificationScopeIdentityFromEvent(left)!;
      const rightIdentity = verificationScopeIdentityFromEvent(right)!;
      return leftIdentity.scopeVersion - rightIdentity.scopeVersion || left.sequence_number - right.sequence_number;
    })
    .at(-1);
}

type VersionedVerificationEventType = "verification_evidence_recorded" | "verification_recorded";

type VersionedVerificationEventIdentity = {
  reviewId: string;
  recordId: string;
  recordVersion: number;
};

function versionedVerificationIdentityFromEvent(
  event: Pick<ReviewEvent, "idempotency_key">,
  eventType: VersionedVerificationEventType
): VersionedVerificationEventIdentity | undefined {
  if (typeof event.idempotency_key !== "string") {
    return undefined;
  }
  const family = eventType === "verification_evidence_recorded" ? "verification_evidence" : "verification_record";
  const recordNamespace = eventType === "verification_evidence_recorded" ? "verification_evidence" : "verification_record";
  const pattern = new RegExp(`^${family}:(review:[a-z0-9][a-z0-9_-]{2,63}):${recordNamespace}:([a-z0-9][a-z0-9_-]{2,63}):record_version:([1-9][0-9]*)$`, "u");
  const match = pattern.exec(event.idempotency_key);
  if (match === null) {
    return undefined;
  }
  const recordVersion = parseCanonicalSafePositiveInteger(match[3]!);
  return recordVersion === undefined ? undefined : { reviewId: match[1]!, recordId: match[2]!, recordVersion };
}

function activeVersionedVerificationEventForRecord(
  events: readonly ReviewEvent[],
  eventType: VersionedVerificationEventType,
  reviewId: string,
  recordId: string
): ReviewEvent | undefined {
  const expectedArtifactRef = `artifact_ref:${recordId}`;
  return events
    .filter((event) => event.event_type === eventType && event.review_id === reviewId && event.artifact_refs.length === 1 && event.artifact_refs[0] === expectedArtifactRef)
    .filter((event) => {
      const identity = versionedVerificationIdentityFromEvent(event, eventType);
      return identity !== undefined && identity.reviewId === reviewId && identity.recordId === recordId;
    })
    .sort((left, right) => {
      const leftIdentity = versionedVerificationIdentityFromEvent(left, eventType)!;
      const rightIdentity = versionedVerificationIdentityFromEvent(right, eventType)!;
      return leftIdentity.recordVersion - rightIdentity.recordVersion || left.sequence_number - right.sequence_number;
    })
    .at(-1);
}

function latestVersionedVerificationEvent(
  events: readonly ReviewEvent[],
  event: Pick<ReviewEvent, "review_id" | "idempotency_key">,
  eventType: VersionedVerificationEventType
): ReviewEvent | undefined {
  const identity = versionedVerificationIdentityFromEvent(event, eventType);
  if (identity === undefined || identity.reviewId !== event.review_id) {
    return undefined;
  }
  return [...events]
    .filter((candidate) => candidate.event_type === eventType)
    .filter((candidate) => {
      const candidateIdentity = versionedVerificationIdentityFromEvent(candidate, eventType);
      return candidateIdentity !== undefined && candidateIdentity.reviewId === identity.reviewId && candidateIdentity.recordId === identity.recordId;
    })
    .sort((left, right) => {
      const leftIdentity = versionedVerificationIdentityFromEvent(left, eventType)!;
      const rightIdentity = versionedVerificationIdentityFromEvent(right, eventType)!;
      return leftIdentity.recordVersion - rightIdentity.recordVersion || left.sequence_number - right.sequence_number;
    })
    .at(-1);
}

function versionedVerificationCorrectionIsValid(
  event: ReviewEvent,
  superseded: ReviewEvent | undefined,
  activeEvent: ReviewEvent | undefined,
  eventType: VersionedVerificationEventType
): boolean {
  const current = versionedVerificationIdentityFromEvent(event, eventType);
  const prior = superseded === undefined ? undefined : versionedVerificationIdentityFromEvent(superseded, eventType);
  const active = activeEvent === undefined ? undefined : versionedVerificationIdentityFromEvent(activeEvent, eventType);
  return current !== undefined &&
    prior !== undefined &&
    active !== undefined &&
    current.reviewId === prior.reviewId &&
    current.recordId === prior.recordId &&
    current.reviewId === active.reviewId &&
    current.recordId === active.recordId &&
    current.recordVersion > prior.recordVersion &&
    current.recordVersion > active.recordVersion;
}

function parseUtcTimestampNs(value: unknown): bigint | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/u.exec(value);
  if (match === null || !isCalendarValidUtcTimestamp(value)) {
    return undefined;
  }
  const wholeSeconds = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(wholeSeconds)) {
    return undefined;
  }
  const fractional = BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  return BigInt(wholeSeconds) * 1_000_000n + fractional;
}

function isCalendarValidUtcTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}

function falsePositiveArtifactRef(record: FalsePositiveRecord): string {
  return `artifact_ref:${record.false_positive_record_id.slice("false_positive:".length)}`;
}

function acceptedRiskArtifactRef(record: AcceptedRiskRecord): string {
  return `artifact_ref:${record.accepted_risk_record_id.slice("accepted_risk:".length)}`;
}

function falsePositiveEventIdempotencyKey(record: FalsePositiveRecord): string {
  return `false_positive:${record.review_id}:${record.false_positive_record_id}`;
}

function acceptedRiskEventIdempotencyKey(record: AcceptedRiskRecord): string {
  return `accepted_risk:${record.review_id}:${record.accepted_risk_record_id}`;
}

function falsePositiveEventReason(record: FalsePositiveRecord): string {
  return `False positive recorded for ${record.review_finding_draft_ref}. Evidence basis: ${record.evidence_basis.join(", ")}. Reviewer rationale recorded in false-positive artifact.`;
}

function acceptedRiskEventReason(record: AcceptedRiskRecord): string {
  const signal = isMeaningfulClassificationText(record.customer_rationale)
    ? "Customer rationale: customer rationale recorded in accepted-risk artifact."
    : "Customer sign-off: customer sign-off evidence recorded in accepted-risk artifact.";
  return `Accepted risk recorded for ${record.review_finding_draft_ref}. ${signal}`;
}

function customerFacingFindingHasForbiddenText(record: CustomerFacingFindingRecord): boolean {
  // Classification-derived fields get the source-code-like detector too, on
  // top of the shared phrase/PII check below — the classification builder
  // applies the same combined check to the record this projection derives
  // from. Kept separate from the shared list below because that list also
  // carries `reviewer_validation_scripts` text, which intentionally
  // contains code and must not trip a code-shape detector.
  const classificationFields: unknown[] = [
    record.expert_classification.rationale_summary,
    record.expert_classification.criteria_summary,
    record.expert_classification.limitations
  ];
  if (classificationFields.some((value) => customerFacingProjectionValueHasForbiddenTextOrSourceCode(value))) {
    return true;
  }

  const textFields: unknown[] = [
    record.evidence_basis.limitations,
    record.reviewer_remediation_guidance.exploitability_rationale_summary,
    record.reviewer_remediation_guidance.suggested_remediation_summary,
    record.reviewer_remediation_guidance.validation_step_summary,
    record.reviewer_remediation_guidance.next_step_summary,
    record.reviewer_remediation_guidance.validation_path_summary,
    record.reviewer_remediation_guidance.validation_path_ref,
    record.reviewer_remediation_guidance.insufficient_evidence_reason,
    record.reviewer_remediation_guidance.limitations,
    record.customer_remediation_status.owner,
    record.customer_remediation_status.target_state,
    record.customer_remediation_status.customer_notes_summary,
    record.verification_state.summary,
    record.accepted_risk_outcome?.evidence_basis_summary,
    record.accepted_risk_outcome?.customer_acceptance_summary,
    record.accepted_risk_outcome?.risk_owner,
    record.accepted_risk_outcome?.scope_of_acceptance,
    record.accepted_risk_outcome?.limitations,
    record.false_positive_outcome?.evidence_basis_summary,
    record.false_positive_outcome?.rationale_summary,
    record.false_positive_outcome?.limitations,
    ...(record.validation_paths ?? []).flatMap((pathRecord) => [
      pathRecord.required_evidence,
      pathRecord.steps,
      pathRecord.expected_result,
      pathRecord.limitations,
      pathRecord.output_attachment_instructions,
      pathRecord.target,
      pathRecord.authorization_assumption,
      pathRecord.method,
      pathRecord.safety_constraints,
      pathRecord.evidence_artifacts_to_collect
    ]),
    ...(record.reviewer_validation_scripts ?? []).flatMap((script) => [
      script.purpose,
      script.prerequisites,
      script.execution_steps,
      script.expected_output,
      script.safety_notes,
      script.output_attachment_instructions,
      script.script_content,
      script.pricing_note
    ])
  ];
  return textFields.some((value) => customerFacingProjectionValueHasForbiddenText(value));
}

function classificationContextMatchesRecord(
  guidance: FindingRemediationGuidance,
  classification: FindingClassificationRecord
): boolean {
  return (
    guidance.classification_context.classification === classification.classification &&
    stableEquals(guidance.classification_context.confirmation_criteria, classification.confirmation_criteria) &&
    stableEquals(guidance.classification_context.evidence_basis, classification.evidence_basis) &&
    guidance.classification_context.source_reference_state === classification.source_reference_state &&
    stableEquals(guidance.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs)
  );
}

function guidanceEvidenceMatchesClassification(
  guidance: FindingRemediationGuidance,
  classification: FindingClassificationRecord
): boolean {
  const draftArtifactRefs = new Set(
    classification.review_finding_draft_evidence_refs
      .filter((ref) => ref.available_for_review === true && ref.display_state === "available_reference")
      .map((ref) => ref.artifact_ref)
  );
  return guidance.evidence_refs.length > 0 && guidance.evidence_refs.every((ref) => draftArtifactRefs.has(ref));
}

function customerFacingProjectionValueHasForbiddenText(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => customerFacingProjectionValueHasForbiddenText(item));
  }
  return textHasForbiddenClassificationContent(value);
}

/** `customerFacingProjectionValueHasForbiddenText` plus the source-code-like detector, for classification-derived fields only — see `customerFacingFindingHasForbiddenText`. */
function customerFacingProjectionValueHasForbiddenTextOrSourceCode(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => customerFacingProjectionValueHasForbiddenTextOrSourceCode(item));
  }
  return customerFacingProjectionValueHasForbiddenText(value) || sourceCodeLikeTextReason(value) !== undefined;
}

function rejectionForFindingRemediationGuidance(record: FindingRemediationGuidance, context: RemediationGuidanceBuildContext = {}): FindingRemediationGuidanceRejectionReason | undefined {
  if (!isRecord(record)) {
    return "remediation_guidance_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "remediation_guidance_reviewer_actor_required";
  }
  if (!isNonEmptyString(record.classification_record_ref)) {
    return "remediation_guidance_classification_ref_required";
  }
  // The record's own `classification_context` was previously only checked
  // for internal self-consistency, so guidance could name a classification
  // that never existed. Require the authoritative record and bind both the
  // guidance's top-level references and its embedded classification_context
  // to it exactly.
  if (!isRecord(context) || !validContextClassification(context.classification)) {
    return "remediation_guidance_reference_mismatch";
  }
  const classification = context.classification;
  if (
    record.review_id !== classification.review_id ||
    record.classification_record_ref !== classification.classification_record_id ||
    record.review_finding_draft_ref !== classification.review_finding_draft_ref ||
    !isRecord(record.classification_context) ||
    !classificationContextMatchesRecord(record, classification)
  ) {
    return "remediation_guidance_reference_mismatch";
  }
  if (record.source_reference_state !== record.classification_context.source_reference_state) {
    return "remediation_guidance_source_reference_state_mismatch";
  }
  const guidanceDraftRefs = Array.isArray((record as Record<string, unknown>).review_finding_draft_evidence_refs)
    ? ((record as Record<string, unknown>).review_finding_draft_evidence_refs as unknown[]).filter(isRecord)
    : [];
  if (guidanceDraftRefs.length > 0 && !draftEvidenceRefsAreConsistent(guidanceDraftRefs)) {
    return "remediation_guidance_evidence_ref_unbound";
  }
  const availableGuidanceRefs = new Set(guidanceDraftRefs
    .filter((ref) => ref.available_for_review === true && ref.display_state === "available_reference")
    .map((ref) => ref.artifact_ref)
    .filter((ref): ref is string => typeof ref === "string"));
  const evidenceRefs = Array.isArray(record.evidence_refs) ? record.evidence_refs : [];
  if (evidenceRefs.length > 0 && !evidenceRefs.every((ref) => availableGuidanceRefs.has(ref))) {
    return "remediation_guidance_evidence_ref_unbound";
  }
  if (record.guidance_status === "actionable_guidance_provided") {
    if (record.classification_context.classification === "inconclusive") {
      return "remediation_guidance_inconclusive_not_actionable";
    }
    if (!isMeaningfulClassificationText(record.suggested_remediation) || !isMeaningfulClassificationText(record.validation_steps) || !Array.isArray(record.limitations) || record.limitations.some((limitation) => !isMeaningfulClassificationText(limitation))) {
      return "remediation_guidance_actionable_details_required";
    }
    if (!Array.isArray(record.evidence_refs) || record.evidence_refs.length === 0) {
      return "remediation_guidance_evidence_ref_required";
    }
    if ((record.classification_context.classification === "likely" || record.classification_context.classification === "confirmed") && !isMeaningfulClassificationText(record.exploitability_rationale)) {
      return "remediation_guidance_exploitability_rationale_required";
    }
    if (record.classification_context.classification === "confirmed" && (!Array.isArray(record.classification_context.confirmation_criteria) || record.classification_context.confirmation_criteria.every((criterion) => !isMeaningfulClassificationText(criterion)))) {
      return "remediation_guidance_confirmed_criteria_context_required";
    }
  }
  if (record.guidance_status === "limited_guidance_requires_validation" || record.guidance_status === "guidance_unavailable_from_submitted_evidence") {
    if (!isMeaningfulClassificationText(record.insufficient_evidence_reason)) {
      return "remediation_guidance_insufficient_evidence_reason_required";
    }
    if (!isMeaningfulClassificationText(record.next_step_summary) && !isMeaningfulClassificationText(record.validation_path_summary) && !isNonEmptyString(record.validation_path_ref)) {
      return "remediation_guidance_next_step_required";
    }
  }
  const texts = [
    record.exploitability_rationale,
    record.suggested_remediation,
    record.validation_steps,
    record.insufficient_evidence_reason,
    record.next_step_summary,
    record.validation_path_summary,
    record.validation_path_ref,
    ...(Array.isArray(record.limitations) ? record.limitations : [])
  ];
  if (texts.some((value) => textHasForbiddenClassificationContent(value))) {
    return "remediation_guidance_text_forbidden";
  }
  return undefined;
}

function validContextClassification(value: unknown): value is FindingClassificationRecord {
  return isRecord(value) &&
    validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", value).length === 0 &&
    rejectionForFindingClassificationRecord(value as FindingClassificationRecord) === undefined;
}

function visibilityAllowedInVerificationScope(scopeVisibility: VerificationPassScope["visibility"], contextVisibility: unknown): boolean {
  return scopeVisibility === "internal_only" || contextVisibility === "customer_facing";
}

function latestVerificationScopeClassificationRecord(
  records: readonly FindingClassificationRecord[] | undefined,
  reviewId: string,
  reviewFindingDraftRef: string,
  recordedAtNs: bigint
): FindingClassificationRecord | undefined {
  return latestVerificationScopeRecord(records, (record): record is FindingClassificationRecord =>
    record.review_id === reviewId && record.review_finding_draft_ref === reviewFindingDraftRef,
    (record) => record.classified_at,
    recordedAtNs
  );
}

function latestVerificationScopeRemediationGuidanceRecord(
  records: readonly FindingRemediationGuidance[] | undefined,
  reviewId: string,
  classificationRecordRef: string,
  reviewFindingDraftRef: string,
  recordedAtNs: bigint
): FindingRemediationGuidance | undefined {
  return latestVerificationScopeRecord(records, (record): record is FindingRemediationGuidance =>
    record.review_id === reviewId && record.classification_record_ref === classificationRecordRef && record.review_finding_draft_ref === reviewFindingDraftRef,
    (record) => record.authored_at,
    recordedAtNs
  );
}

function latestVerificationScopeCustomerStatusRecord(
  records: readonly CustomerRemediationStatusRecord[] | undefined,
  reviewId: string,
  classificationRecordRef: string,
  reviewFindingDraftRef: string,
  recordedAtNs: bigint
): CustomerRemediationStatusRecord | undefined {
  return latestVerificationScopeRecord(records, (record): record is CustomerRemediationStatusRecord =>
    record.review_id === reviewId && record.classification_record_ref === classificationRecordRef && record.finding_ref === reviewFindingDraftRef,
    (record) => record.recorded_at,
    recordedAtNs
  );
}

function latestVerificationScopeRecord<T>(
  records: readonly T[] | undefined,
  predicate: (record: T) => boolean,
  timestamp: (record: T) => string,
  recordedAtNs: bigint
): T | undefined {
  if (!Array.isArray(records)) {
    return undefined;
  }
  const selection = selectLatestByUtcTimestamp(records.filter(predicate), timestamp, recordedAtNs);
  return selection.outcome === "selected" ? selection.record : undefined;
}

function validVerificationScopeClassificationRecord(record: FindingClassificationRecord, recordedAtNs: bigint): boolean {
  const classifiedAt = parseUtcTimestampNs(record.classified_at);
  return classifiedAt !== undefined && classifiedAt <= recordedAtNs && validContextClassification(record);
}

function validVerificationScopeRemediationGuidanceRecord(record: FindingRemediationGuidance, recordedAtNs: bigint, classification: FindingClassificationRecord): boolean {
  const authoredAt = parseUtcTimestampNs(record.authored_at);
  return authoredAt !== undefined && authoredAt <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", record).length === 0 && rejectionForFindingRemediationGuidance(record, { classification }) === undefined;
}

function validVerificationScopeCustomerStatusRecord(record: CustomerRemediationStatusRecord, recordedAtNs: bigint): boolean {
  const statusRecordedAt = parseUtcTimestampNs(record.recorded_at);
  return statusRecordedAt !== undefined && statusRecordedAt <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:customer-remediation-status-record", record).length === 0 && rejectionForCustomerRemediationStatus(record) === undefined;
}

function validVerificationScopeValidationPathRecord(record: FindingValidationPath, recordedAtNs: bigint, context: ValidationPathBuildContext): boolean {
  const authoredAt = parseUtcTimestampNs(record.authored_at);
  return authoredAt !== undefined && authoredAt <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", record).length === 0 && rejectionForFindingValidationPath(record, context) === undefined;
}

function validVerificationScopeValidationScriptRecord(record: ReviewerValidationScript, recordedAtNs: bigint, context: ValidationScriptBuildContext): boolean {
  const authoredAt = parseUtcTimestampNs(record.authored_at);
  return authoredAt !== undefined && authoredAt <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", record).length === 0 && rejectionForReviewerValidationScript(record, context) === undefined;
}

function validVerificationScopeAcceptedRiskRecord(record: AcceptedRiskRecord, recordedAtNs: bigint, context: OutcomeRecordBuildContext): boolean {
  const recordTimestamp = parseUtcTimestampNs(record.recorded_at);
  return recordTimestamp !== undefined && recordTimestamp <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:accepted-risk-record", record).length === 0 && rejectionForAcceptedRiskRecord(record, context) === undefined;
}

function validVerificationScopeFalsePositiveRecord(record: FalsePositiveRecord, recordedAtNs: bigint, context: OutcomeRecordBuildContext): boolean {
  const recordTimestamp = parseUtcTimestampNs(record.recorded_at);
  return recordTimestamp !== undefined && recordTimestamp <= recordedAtNs && validateProtocolSchema("urn:codeattest:protocol:v0:false-positive-record", record).length === 0 && rejectionForFalsePositiveRecord(record, context) === undefined;
}

function validRemediationContextForOutcome(value: unknown, classification: FindingClassificationRecord, expectedRef: string): value is FindingRemediationGuidance {
  if (!isRecord(value) || validateProtocolSchema("urn:codeattest:protocol:v0:finding-remediation-guidance", value).length > 0) {
    return false;
  }
  const guidance = value as FindingRemediationGuidance;
  return rejectionForFindingRemediationGuidance(guidance, { classification }) === undefined &&
    guidance.remediation_guidance_id === expectedRef;
}

function validValidationPathContextForOutcome(value: unknown, classification: FindingClassificationRecord, expectedRef: string, remediationRef: string | undefined, reviewerValidationScripts: ReviewerValidationScript[] = []): value is FindingValidationPath {
  if (!isRecord(value) || validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", value).length > 0) {
    return false;
  }
  const path = value as FindingValidationPath;
  return rejectionForFindingValidationPath(path, { classification, reviewer_validation_scripts: reviewerValidationScripts }) === undefined &&
    path.validation_path_id === expectedRef &&
    path.review_id === classification.review_id &&
    path.classification_record_ref === classification.classification_record_id &&
    path.review_finding_draft_ref === classification.review_finding_draft_ref &&
    path.source_reference_state === classification.source_reference_state &&
    stableEquals(path.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs) &&
    (remediationRef === undefined || path.remediation_guidance_ref === remediationRef);
}

function rejectionForFalsePositiveRecord(record: FalsePositiveRecord, context: OutcomeRecordBuildContext): FalsePositiveRecordRejectionReason | undefined {
  if (!isRecord(record)) {
    return "false_positive_record_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "false_positive_record_reviewer_actor_required";
  }
  if (record.source_derived_class !== "retained_review_artifact") {
    return "false_positive_record_schema_invalid";
  }
  if (!validContextClassification(context.classification)) {
    return "false_positive_record_reference_mismatch";
  }
  const classification = context.classification;
  if (
    record.review_id !== classification.review_id ||
    record.classification_record_ref !== classification.classification_record_id ||
    record.review_finding_draft_ref !== classification.review_finding_draft_ref ||
    !stableEquals(record.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs)
  ) {
    return "false_positive_record_reference_mismatch";
  }
  if (record.source_reference_state !== classification.source_reference_state) {
    return "false_positive_record_source_reference_state_mismatch";
  }
  const draftEvidenceRefs = Array.isArray(record.review_finding_draft_evidence_refs)
    ? record.review_finding_draft_evidence_refs.filter(isRecord)
    : [];
  if (draftEvidenceRefs.length === 0 || !draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !classificationEvidenceBasisMatchesDraft(record.evidence_basis, draftEvidenceRefs)) {
    return "false_positive_record_evidence_basis_required";
  }
  if (!isMeaningfulClassificationText(record.rationale)) {
    return "false_positive_record_rationale_required";
  }
  if (!Array.isArray(record.limitations) || record.limitations.length === 0 || record.limitations.some((limitation) => !isMeaningfulClassificationText(limitation))) {
    return "false_positive_record_limitations_required";
  }
  const texts = [record.rationale, ...(Array.isArray(record.limitations) ? record.limitations : [])];
  if (texts.some((value) => textHasForbiddenClassificationContent(value))) {
    return "false_positive_record_text_forbidden";
  }
  return undefined;
}

function rejectionForAcceptedRiskRecord(record: AcceptedRiskRecord, context: OutcomeRecordBuildContext): AcceptedRiskRecordRejectionReason | undefined {
  if (!isRecord(record)) {
    return "accepted_risk_record_schema_invalid";
  }
  const actorType = isRecord(record.actor) ? record.actor.actor_type : undefined;
  if (actorType !== "customer_user" && actorType !== "reviewer" && actorType !== "vendor_service") {
    return "accepted_risk_record_actor_required";
  }
  const hasCustomerRationale = isMeaningfulClassificationText(record.customer_rationale);
  const hasCustomerSignoff = isNonEmptyString(record.customer_signoff_ref) || isMeaningfulClassificationText(record.customer_signoff_summary);
  if (!hasCustomerRationale && !hasCustomerSignoff) {
    return "accepted_risk_record_customer_acceptance_required";
  }
  if (actorType !== "customer_user" && !hasCustomerRationale && !hasCustomerSignoff) {
    return "accepted_risk_record_customer_acceptance_required";
  }
  if (record.source_derived_class !== "retained_review_artifact") {
    return "accepted_risk_record_schema_invalid";
  }
  if (!validContextClassification(context.classification)) {
    return "accepted_risk_record_reference_mismatch";
  }
  const classification = context.classification;
  if (
    record.review_id !== classification.review_id ||
    record.classification_record_ref !== classification.classification_record_id ||
    record.review_finding_draft_ref !== classification.review_finding_draft_ref
  ) {
    return "accepted_risk_record_reference_mismatch";
  }
  const draftEvidenceRefs = Array.isArray(record.review_finding_draft_evidence_refs)
    ? record.review_finding_draft_evidence_refs.filter(isRecord)
    : [];
  if (!Array.isArray(record.evidence_basis) || record.evidence_basis.length === 0 || draftEvidenceRefs.length === 0) {
    return "accepted_risk_record_evidence_basis_unbound";
  }
  if (draftEvidenceRefs.length > 0) {
    if (!stableEquals(record.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs) || !draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !classificationEvidenceBasisMatchesDraft(record.evidence_basis, draftEvidenceRefs)) {
      return "accepted_risk_record_evidence_basis_unbound";
    }
    if (record.source_reference_state !== classification.source_reference_state) {
      return "accepted_risk_record_source_reference_state_mismatch";
    }
  } else if (record.source_reference_state !== classification.source_reference_state) {
    return "accepted_risk_record_source_reference_state_mismatch";
  }
  if (record.remediation_context_ref !== undefined) {
    if (!validRemediationContextForOutcome(context.remediation_guidance, classification, record.remediation_context_ref)) {
      return "accepted_risk_record_reference_mismatch";
    }
  }
  if (record.validation_path_ref !== undefined) {
    if (!validValidationPathContextForOutcome(context.validation_path, classification, record.validation_path_ref, record.remediation_context_ref, context.reviewer_validation_scripts ?? [])) {
      return "accepted_risk_record_reference_mismatch";
    }
  }
  if (typeof record.review_by_date === "string" && !isIsoCalendarDate(record.review_by_date)) {
    return "accepted_risk_record_review_by_date_invalid";
  }
  if (!Array.isArray(record.limitations) || record.limitations.length === 0 || record.limitations.some((limitation) => !isMeaningfulClassificationText(limitation))) {
    return "accepted_risk_record_limitations_required";
  }
  for (const field of ["classification", "expert_classification", "customer_remediation_status", "verification_state", "verified", "fixed", "remediated"]) {
    if ((record as Record<string, unknown>)[field] !== undefined) {
      return "accepted_risk_record_rewrite_forbidden";
    }
  }
  const texts = [
    record.customer_rationale,
    record.customer_signoff_summary,
    record.risk_owner,
    record.scope_of_acceptance,
    ...(Array.isArray(record.limitations) ? record.limitations : [])
  ];
  if (texts.some((value) => acceptedRiskTextHasForbiddenContent(value))) {
    return "accepted_risk_record_text_forbidden";
  }
  return undefined;
}

function rejectionForFindingValidationPath(record: FindingValidationPath, context: ValidationPathBuildContext): FindingValidationPathRejectionReason | undefined {
  if (!isRecord(record)) {
    return "validation_path_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "validation_path_reviewer_actor_required";
  }
  if (context.classification !== undefined) {
    if (!isRecord(context.classification)) {
      return "validation_path_reference_mismatch";
    }
    const classification = context.classification;
    if (
      record.review_id !== classification.review_id ||
      record.classification_record_ref !== classification.classification_record_id ||
      record.review_finding_draft_ref !== classification.review_finding_draft_ref ||
      !stableEquals(record.review_finding_draft_evidence_refs, classification.review_finding_draft_evidence_refs)
    ) {
      return "validation_path_reference_mismatch";
    }
    if (record.source_reference_state !== classification.source_reference_state) {
      return "validation_path_source_reference_state_mismatch";
    }
  }
  if (context.remediation_guidance !== undefined) {
    if (!isRecord(context.remediation_guidance)) {
      return "validation_path_reference_mismatch";
    }
    const remediationGuidance = context.remediation_guidance;
    if (
      record.remediation_guidance_ref !== remediationGuidance.remediation_guidance_id ||
      record.classification_record_ref !== remediationGuidance.classification_record_ref ||
      record.review_finding_draft_ref !== remediationGuidance.review_finding_draft_ref
    ) {
      return "validation_path_reference_mismatch";
    }
  }
  const validationPathDraftRefs = Array.isArray((record as Record<string, unknown>).review_finding_draft_evidence_refs)
    ? ((record as Record<string, unknown>).review_finding_draft_evidence_refs as unknown[]).filter(isRecord)
    : [];
  if (validationPathDraftRefs.length > 0 && !draftEvidenceRefsAreConsistent(validationPathDraftRefs)) {
    return "validation_path_evidence_ref_unbound";
  }
  if (validationPathDraftRefs.length > 0 && !classificationSourceReferenceStateMatchesDraft(record.source_reference_state, validationPathDraftRefs)) {
    return "validation_path_source_reference_state_mismatch";
  }
  const hasRemoteSpecificFields = record.target !== undefined || record.authorization_assumption !== undefined || record.method !== undefined || record.safety_constraints !== undefined || record.evidence_artifacts_to_collect !== undefined;
  if (record.path_type === "remote_dynamic_testing") {
    if (
      !isMeaningfulClassificationText(record.target) ||
      !isMeaningfulClassificationText(record.authorization_assumption) ||
      !isMeaningfulClassificationText(record.method) ||
      !isMeaningfulClassificationText(record.safety_constraints) ||
      !Array.isArray(record.evidence_artifacts_to_collect) ||
      record.evidence_artifacts_to_collect.length === 0
    ) {
      return "validation_path_remote_authorization_required";
    }
  } else if (hasRemoteSpecificFields) {
    return "validation_path_branch_field_forbidden";
  }
  if (record.path_type === "customer_run_script") {
    if (!Array.isArray(record.reviewer_validation_script_refs) || record.reviewer_validation_script_refs.length === 0) {
      return "validation_path_script_ref_required";
    }
    // A schema-invalid script must not become authority merely because its
    // id matches — require every supplied script to independently pass its
    // own schema before any of them may resolve a reviewer_validation_script_ref.
    const providedScripts = Array.isArray(context.reviewer_validation_scripts)
      ? context.reviewer_validation_scripts.filter((script) => isRecord(script) && validateProtocolSchema("urn:codeattest:protocol:v0:reviewer-validation-script", script).length === 0) as ReviewerValidationScript[]
      : [];
    if (providedScripts.length !== (context.reviewer_validation_scripts?.length ?? 0)) {
      return "validation_path_reference_mismatch";
    }
    if (providedScripts.length === 0) {
      return "validation_path_reference_mismatch";
    }
    const scriptsById = new Map(providedScripts.map((script) => [script.validation_script_id, script]));
    if (!record.reviewer_validation_script_refs.every((ref) => scriptsById.has(ref) && scriptsById.get(ref)?.validation_path_ref === record.validation_path_id)) {
      return "validation_path_reference_mismatch";
    }
  } else if (record.reviewer_validation_script_refs !== undefined) {
    return "validation_path_branch_field_forbidden";
  }
  if (record.path_type === "manual_steps" && !isMeaningfulClassificationText(record.output_attachment_instructions)) {
    return "validation_path_manual_attachment_instructions_required";
  }
  const texts = [
    record.required_evidence,
    record.steps,
    record.expected_result,
    record.target,
    record.authorization_assumption,
    record.method,
    record.safety_constraints,
    record.output_attachment_instructions,
    ...(Array.isArray(record.limitations) ? record.limitations : [])
  ];
  if (texts.some((value) => textHasForbiddenClassificationContent(value))) {
    return "validation_path_text_forbidden";
  }
  return undefined;
}

function rejectionForReviewerValidationScript(record: ReviewerValidationScript, context: ValidationScriptBuildContext): ReviewerValidationScriptRejectionReason | undefined {
  if (!isRecord(record)) {
    return "validation_script_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "reviewer") {
    return "validation_script_reviewer_actor_required";
  }
  // A schema-invalid path must not become authority merely because its id
  // matches — require it to independently pass its own schema.
  if (
    context.validation_path === undefined ||
    !isRecord(context.validation_path) ||
    validateProtocolSchema("urn:codeattest:protocol:v0:finding-validation-path", context.validation_path).length > 0
  ) {
    return "validation_script_reference_mismatch";
  }
  const validationPath = context.validation_path;
  if (
    validationPath.path_type !== "customer_run_script" ||
    record.review_id !== validationPath.review_id ||
    record.validation_path_ref !== validationPath.validation_path_id ||
    record.classification_record_ref !== validationPath.classification_record_ref
  ) {
    return "validation_script_reference_mismatch";
  }
  if (record.script_package_status === "included_base_package") {
    const includedSlot = record.included_script_slot;
    if (typeof includedSlot !== "number" || !Number.isInteger(includedSlot) || includedSlot < 1 || includedSlot > 3) {
      return "validation_script_included_slot_required";
    }
    const priorScriptRecords = Array.isArray(context.prior_included_scripts)
      ? context.prior_included_scripts.filter(isRecord) as ReviewerValidationScript[]
      : [];
    if (priorScriptRecords.length !== (context.prior_included_scripts?.length ?? 0)) {
      return "validation_script_reference_mismatch";
    }
    const priorIncluded = priorScriptRecords.filter((script) => script.script_package_status === "included_base_package");
    const priorSlots = new Set(priorIncluded.map((script) => script.included_script_slot));
    if (priorIncluded.length >= 3 || priorSlots.has(includedSlot)) {
      return "validation_script_included_cap_exceeded";
    }
  }
  if (record.script_package_status === "additional_script_candidate_pricing_tbd") {
    if (record.included_script_slot !== undefined) {
      return "validation_script_additional_slot_forbidden";
    }
    const pricingCopy = [record.purpose, record.prerequisites, record.execution_steps, record.expected_output, record.safety_notes, record.output_attachment_instructions, record.script_content].filter((item) => typeof item === "string").join(" ");
    if (!/pricing\s+tbd/iu.test(pricingCopy)) {
      return "validation_script_pricing_tbd_required";
    }
  }
  const texts = [
    record.purpose,
    record.prerequisites,
    record.execution_steps,
    record.expected_output,
    record.safety_notes,
    record.output_attachment_instructions,
    record.script_content
  ];
  if (texts.some((value) => textHasForbiddenClassificationContent(value))) {
    return "validation_script_text_forbidden";
  }
  return undefined;
}

function rejectionForCustomerRemediationStatus(record: CustomerRemediationStatusRecord): CustomerRemediationStatusRejectionReason | undefined {
  if (!isRecord(record)) {
    return "customer_remediation_status_schema_invalid";
  }
  if (!isRecord(record.actor) || record.actor.actor_type !== "customer_user") {
    return "customer_remediation_status_customer_actor_required";
  }
  if (!CUSTOMER_REMEDIATION_STATUS_ALLOWED.has(record.customer_remediation_status)) {
    return "customer_remediation_status_allowed_required";
  }
  if (!isNonEmptyString(record.finding_ref) && !isNonEmptyString(record.classification_record_ref)) {
    return "customer_remediation_status_finding_ref_required";
  }
  for (const field of CUSTOMER_STATUS_FORBIDDEN_FIELDS) {
    if ((record as Record<string, unknown>)[field] !== undefined) {
      return "customer_remediation_status_rewrite_forbidden";
    }
  }
  if (typeof record.due_date === "string" && !isIsoCalendarDate(record.due_date)) {
    return "customer_remediation_status_due_date_invalid";
  }
  if ([record.owner, record.target_state, record.customer_notes].some((value) => textHasForbiddenClassificationContent(value))) {
    return "customer_remediation_status_text_forbidden";
  }
  return undefined;
}

function validationPathArtifactRef(record: FindingValidationPath): string {
  return `artifact_ref:${record.validation_path_id.slice("validation_path:".length)}`;
}

function validationScriptArtifactRef(record: ReviewerValidationScript): string {
  return `artifact_ref:${record.validation_script_id.slice("validation_script:".length)}`;
}

function remediationGuidanceArtifactRef(record: FindingRemediationGuidance): string {
  return `artifact_ref:${record.remediation_guidance_id.slice("remediation_guidance:".length)}`;
}

function customerStatusArtifactRef(record: CustomerRemediationStatusRecord): string {
  return `artifact_ref:${record.customer_status_record_id.slice("customer_status:".length)}`;
}

function validationPathEventIdempotencyKey(record: FindingValidationPath): string {
  return `validation_path:${record.review_id}:${record.validation_path_id}`;
}

function validationScriptEventIdempotencyKey(record: ReviewerValidationScript): string {
  return `validation_script:${record.review_id}:${record.validation_script_id}`;
}

function remediationGuidanceEventIdempotencyKey(record: FindingRemediationGuidance): string {
  return `remediation_guidance:${record.review_id}:${record.remediation_guidance_id}`;
}

function customerRemediationEventIdempotencyKey(record: CustomerRemediationStatusRecord): string {
  return `customer_remediation:${record.review_id}:${record.customer_status_record_id}`;
}

function latestCustomerStatus(records: readonly CustomerRemediationStatusRecord[]): CustomerRemediationStatusRecord | undefined {
  const selection = selectLatestByUtcTimestamp(records, (record) => record.recorded_at);
  if (selection.outcome === "selected") {
    return selection.record;
  }
  if (selection.outcome !== "ambiguous") {
    return undefined;
  }
  // Equal nanosecond-precision instants are genuinely tied; fall back to the
  // existing deliberate record-ID tie-break, but only when every tied record
  // has a distinct, nonempty ID to break on.
  const tieKeys = selection.records.map((record) => record.customer_status_record_id);
  if (tieKeys.some((key) => !isNonEmptyString(key)) || new Set(tieKeys).size !== tieKeys.length) {
    return undefined;
  }
  return [...selection.records].sort((left, right) => right.customer_status_record_id.localeCompare(left.customer_status_record_id))[0];
}

function customerStatusProjection(record: CustomerRemediationStatusRecord): CustomerFacingFindingRecord["customer_remediation_status"] {
  const exportPolicy = record.field_export_policy;
  return {
    latest_status: record.customer_remediation_status,
    latest_status_record_ref: record.customer_status_record_id,
    // Sensitive customer workflow metadata defaults to EXCLUDED unless the
    // record's field_export_policy explicitly opts it in, symmetric with
    // customer_notes below. A missing policy must not leak owner/due-date/
    // target-state into customer-facing or evidence-consumer projections.
    ...(record.owner !== undefined && exportPolicy?.owner === "include" ? { owner: record.owner } : {}),
    ...(record.due_date !== undefined && exportPolicy?.due_date === "include" ? { due_date: record.due_date } : {}),
    ...(record.target_state !== undefined && exportPolicy?.target_state === "include" ? { target_state: record.target_state } : {}),
    ...(record.customer_notes !== undefined && exportPolicy?.customer_notes === "include" ? { customer_notes_summary: record.customer_notes } : {}),
    customer_notes_visible: record.customer_notes !== undefined && exportPolicy?.customer_notes === "include"
  };
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) {
    return false;
  }
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = days[month - 1];
  return maxDay !== undefined && day >= 1 && day <= maxDay;
}

function rejectionForLifecycleEvent(event: EvidenceLifecycleEvent): EvidenceLifecycleAppendRejectionReason | undefined {
  if (event.event_type === "evidence_deleted" && event.deletion_evidence_ref === undefined) {
    return "deletion_event_missing_deletion_evidence";
  }
  if (event.event_type === "evidence_accessed" && event.access_scope === undefined) {
    return "access_event_missing_scope";
  }
  if (event.event_type === "evidence_accessed" && event.access_scope !== undefined && event.access_scope.review_scope !== event.review_id) {
    return "access_event_scope_mismatch";
  }
  if (LIFECYCLE_CLASS_BEARING_EVENT_TYPES.has(event.event_type) && event.source_derived_class === undefined) {
    return "evidence_event_missing_source_derived_class";
  }
  return undefined;
}

/**
 * A `retention_record_ref` / `deletion_evidence_ref` string alone proves
 * nothing — this resolves each against the caller-supplied companion
 * artifacts and checks the substantive claim the reference is standing in
 * for: matching retention class and artifact coverage within the opted-in
 * window, or a verified deletion by the same actor at the same instant.
 * Does not invent a digest-to-`artifact_ref` namespace join the protocol
 * does not define; retention coverage is checked by `artifact_refs`.
 */
function rejectionForLifecycleEventCompanions(
  event: EvidenceLifecycleEvent,
  context: EvidenceLifecycleAppendContext
): EvidenceLifecycleAppendRejectionReason | undefined {
  if (event.event_type === "retention_status_changed" && event.source_derived_class === "customer_opt_in_retained_source") {
    if (event.retention_record_ref === undefined) {
      return "retention_event_missing_retention_record";
    }
    const candidates = Array.isArray(context.retention_opt_in_records) ? context.retention_opt_in_records : [];
    const resolved = candidates.filter((record) =>
      isRecord(record) &&
      validateProtocolSchema("urn:codeattest:protocol:v0:retention-opt-in-record", record).length === 0 &&
      record.retention_record_id === event.retention_record_ref
    );
    if (resolved.length !== 1) {
      return "retention_event_record_unresolved";
    }
    const record = resolved[0]! as RetentionOptInRecord;
    if (record.source_derived_class !== "customer_opt_in_retained_source") {
      return "retention_event_record_unresolved";
    }
    if (!event.artifact_refs.every((ref) => record.retained_artifact_refs.includes(ref))) {
      return "retention_event_record_unresolved";
    }
    const start = parseUtcTimestampNs(record.retention_period.start_timestamp);
    const end = parseUtcTimestampNs(record.retention_period.end_timestamp);
    const at = parseUtcTimestampNs(event.event_timestamp);
    if (start === undefined || end === undefined || at === undefined || at < start || at > end) {
      return "retention_event_record_unresolved";
    }
  }

  if (event.event_type === "evidence_deleted" && event.deletion_evidence_ref !== undefined) {
    const candidates = Array.isArray(context.deletion_evidence) ? context.deletion_evidence : [];
    const resolved = candidates.filter((item) =>
      isRecord(item) &&
      validateProtocolSchema("urn:codeattest:protocol:v0:deletion-evidence", item).length === 0 &&
      item.deletion_evidence_id === event.deletion_evidence_ref
    );
    if (resolved.length !== 1) {
      return "deletion_event_deletion_evidence_unresolved";
    }
    const deletion = resolved[0]! as DeletionEvidence;
    if (deletion.verification_status !== "verified" || !stableEquals(deletion.actor, event.actor)) {
      return "deletion_event_deletion_evidence_unresolved";
    }
    const deletionAt = parseUtcTimestampNs(deletion.deletion_timestamp);
    const eventAt = parseUtcTimestampNs(event.event_timestamp);
    if (deletionAt === undefined || eventAt === undefined || deletionAt !== eventAt) {
      return "deletion_event_deletion_evidence_unresolved";
    }
  }

  return undefined;
}

/**
 * Validates prior lifecycle entries as one append-only, review-bound log
 * rather than trusting them individually: schema, event-local semantics
 * (actor shape, deletion/access requirements, source-derived class), a safe
 * strictly-increasing supplied sequence, unique event ids and idempotency
 * keys, backward-only supersession, and exactly one shared `review_id`
 * across a nonempty history. Malformed input is never sorted into validity.
 */
function evidenceLifecycleHistoryRejection(events: readonly EvidenceLifecycleEvent[]): EvidenceLifecycleAppendRejectionReason | undefined {
  const ids = new Set<string>();
  const keys = new Set<string>();
  let sequence = -1;
  let reviewId: string | undefined;
  for (const event of events) {
    if (!isPlainObjectValue(event) || !isRecord(event) || validateProtocolSchema("urn:codeattest:protocol:v0:evidence-lifecycle-event", event).length > 0) {
      return "evidence_event_schema_invalid";
    }
    const semanticRejection = rejectionForLifecycleEvent(event);
    if (semanticRejection !== undefined) {
      return semanticRejection;
    }
    if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number < 0 || event.sequence_number <= sequence) {
      return "evidence_event_not_append_only";
    }
    if (ids.has(event.event_id) || keys.has(event.idempotency_key)) {
      return "evidence_event_not_append_only";
    }
    if (event.supersedes_event_id !== undefined && (event.supersedes_event_id === event.event_id || !ids.has(event.supersedes_event_id))) {
      return "evidence_event_not_append_only";
    }
    if (reviewId === undefined) {
      reviewId = event.review_id;
    } else if (event.review_id !== reviewId) {
      return "evidence_event_review_id_mismatch";
    }
    ids.add(event.event_id);
    keys.add(event.idempotency_key);
    sequence = event.sequence_number;
  }
  return undefined;
}

function nextSequenceNumber(events: readonly EvidenceLifecycleEvent[]): number {
  let highest = -1;
  for (const event of events) {
    if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number < 0) {
      throw new Error("evidence lifecycle log contains an invalid sequence number");
    }
    highest = Math.max(highest, event.sequence_number);
  }
  if (highest === Number.MAX_SAFE_INTEGER) {
    throw new Error("evidence lifecycle log cannot advance past the maximum safe sequence number");
  }
  return highest + 1;
}

function stableEquals(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return typeof leftCanonical === "string" && leftCanonical === rightCanonical;
}

/**
 * Deep copy, so a returned artifact shares no nested object with the caller's
 * input: `result.events[0].actor.actor_id = "x"` must not reach back into the
 * prior log, and a validated classification must not stay flippable. Returns
 * `undefined` for anything not structured-cloneable, which callers turn into a
 * schema rejection rather than a thrown boundary.
 */
function cloneJson<T>(value: T): T | undefined {
  try {
    return structuredClone(value);
  } catch {
    return undefined;
  }
}

/** Non-narrowing shape check, for use where the declared element type must survive. */
function isPlainObjectValue(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A supplied Deletion Evidence context item is not trustworthy merely
 * because the one item a caller happens to reference is well-formed — a
 * skeletal record elsewhere in the same array is still context a resolution
 * could otherwise silently trust. Every supplied item must independently
 * pass the full schema before any of them may be used to resolve a
 * reference; validating only the referenced item is not enough.
 */
function everyDeletionEvidenceItemIsSchemaValid(items: readonly unknown[]): boolean {
  return items.every((item) => isRecord(item) && validateProtocolSchema("urn:codeattest:protocol:v0:deletion-evidence", item).length === 0);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
