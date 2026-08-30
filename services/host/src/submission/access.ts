import { createHash } from "node:crypto";

import { enforceScopedAccess } from "../../../../apps/control-plane/src/index.js";
import type { AllowedAccess, EvidenceLifecycleLogStore } from "../../../../packages/evidence-store/src/index.js";
import type { RetentionSourceDerivedClass } from "../../../../packages/protocol-ts/src/index.js";
import type { SubmissionAttemptRecord } from "./attempt-state.js";

export type SubmissionArtifactReference = {
  artifact_ref: string;
  digest: string;
  source_derived_class: RetentionSourceDerivedClass;
};

/**
 * Composes `enforceScopedAccess` (apps/control-plane's pure boundary) with
 * the persisted lifecycle log to mint an `AllowedAccess` for one artifact.
 * The access decision's event is *not* appended here: `ArtifactStore.get`
 * appends it itself, in the same call that returns the bytes, which is what
 * makes access logging non-bypassable rather than a second call this helper
 * could omit. Composed in `services/host/` rather than the pure tier because
 * the pure tier never touches a store.
 */
export function createSubmissionAccessMinter(evidenceLifecycleLog: EvidenceLifecycleLogStore, now: () => string) {
  return async function mintSubmissionAccess(
    attempt: SubmissionAttemptRecord,
    reference: SubmissionArtifactReference
  ): Promise<AllowedAccess | undefined> {
    const events = await evidenceLifecycleLog.loadLog(attempt.review_id);
    const idempotencyKey = `evidence_accessed:${attempt.submission_attempt_id}:${reference.digest}`;
    // `evidence_lifecycle_event.event_id` is `^evidence_event:[a-z0-9][a-z0-9_-]{2,63}$`,
    // not a sha256-prefixed digest -- unlike a ReviewEvent, this id is not a
    // content-addressed identity the append boundary recomputes.
    const eventId = `evidence_event:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
    const result = enforceScopedAccess(events, {
      actor: { actor_type: "vendor_service", actor_id: "vendor_service:codeattest-intake" },
      role: "codeattest_ops",
      tenant_id: attempt.tenant_id,
      review_scope: attempt.review_id,
      artifact: {
        artifact_ref: reference.artifact_ref,
        tenant_id: attempt.tenant_id,
        review_scope: attempt.review_id,
        source_derived_class: reference.source_derived_class,
      },
      event_id: eventId,
      idempotency_key: idempotencyKey,
      event_timestamp: now(),
      purpose: "intake_verification"
    });
    return result.decision === "allowed" ? { decision: "allowed", event: result.event } : undefined;
  };
}
