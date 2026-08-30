import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { makeLifecycleEvent } from "./helpers/fixtures.mjs";

// Content is addressed by digest, so every case gets its own bytes and digest.
// A shared digest is globally "already present" after the first case commits its
// artifact_reference row, and a fresh object store cannot undo that — see the
// nextReviewId note below, which is the same shared-state constraint.
function makeArtifact(tag) {
  const bytes = new TextEncoder().encode(`SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE ${tag}`);
  const digest = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  return { digest, bytes };
}

function makeClassification() {
  return {
    protocol_version: "codeattest.v0",
    stored_object_ref: "stored_object:synthetic_demo_1",
    object_kind: "evidence_artifact",
    source_derived_class: "retained_review_artifact",
    environment_profile: "synthetic_demo"
  };
}

function makeDeletionEvidence(digest) {
  return {
    protocol_version: "codeattest.v0",
    deletion_evidence_id: "deletion_evidence:synthetic_demo_1",
    deleted_artifact_digests: [digest],
    deletion_method: "secure_delete",
    deletion_timestamp: "2026-08-16T01:00:00Z",
    actor: { actor_type: "vendor_service", actor_id: "vendor:synthetic_demo" },
    verification_status: "unverified"
  };
}

/**
 * Every ArtifactStore must make access logging a property, not a promise: bytes
 * are unreachable without an allowed decision, and the decision's event is
 * persisted alongside the read.
 *
 * `nextReviewId` hands each case a fresh review id, and `makeArtifact` a fresh
 * digest, because the Postgres app role cannot DELETE history rows to reset
 * state between cases. Memory stores are fresh per `createStore()` call, so a
 * constant would be correct there, but fresh values are correct for both.
 */
export async function runArtifactStoreContract({ name, createStore, nextReviewId }) {
  // Storing then reading with an allowed decision returns the bytes.
  {
    const reviewId = nextReviewId();
    const { digest, bytes } = makeArtifact("read");
    const { store, lifecycleLog } = await createStore();
    await store.put({ digest, bytes, classification: makeClassification(), reviewId });
    const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: reviewId }) };
    const result = await store.get({ access, digest });
    assert.equal(result.outcome, "read", `${name}: allowed access must read bytes`);
    assert.deepEqual(result.bytes, bytes, `${name}: bytes must round-trip unchanged`);

    // The access event is durably recorded, not merely logged to stdout.
    const events = await lifecycleLog.loadLog(reviewId);
    assert.equal(events.length, 1, `${name}: an allowed read must persist one access event`);
    assert.equal(events[0].event_type, "evidence_accessed");
  }

  // Putting the same content twice is a no-op; content addressing makes a
  // duplicate write harmless by construction.
  {
    const reviewId = nextReviewId();
    const { digest, bytes } = makeArtifact("duplicate");
    const { store } = await createStore();
    const first = await store.put({ digest, bytes, classification: makeClassification(), reviewId });
    const second = await store.put({ digest, bytes, classification: makeClassification(), reviewId });
    assert.equal(first.outcome, "stored", `${name}: first put must store`);
    assert.equal(second.outcome, "already_present", `${name}: duplicate put must be a no-op`);
  }

  // An unknown digest is not found, and a miss still must not log an access
  // event implying an inspection that did not happen.
  {
    const reviewId = nextReviewId();
    const { store, lifecycleLog } = await createStore();
    const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: reviewId }) };
    const result = await store.get({ access, digest: "sha256:" + "c".repeat(64) });
    assert.equal(result.outcome, "not_found", `${name}: unknown digest must be not_found`);
    assert.deepEqual(await lifecycleLog.loadLog(reviewId), [], `${name}: a miss must not log an access`);
  }

  // If the access event cannot be persisted, the read fails rather than
  // returning bytes silently. Here a conflicting body under a used key forces
  // the append to be rejected.
  {
    const reviewId = nextReviewId();
    const { digest, bytes } = makeArtifact("unloggable");
    const { store, lifecycleLog } = await createStore();
    await store.put({ digest, bytes, classification: makeClassification(), reviewId });
    await lifecycleLog.append(reviewId, makeLifecycleEvent({ review_id: reviewId }));
    const conflicting = { decision: "allowed", event: makeLifecycleEvent({ review_id: reviewId, event_timestamp: "2026-08-17T00:00:00Z" }) };
    const result = await store.get({ access: conflicting, digest });
    assert.equal(result.outcome, "access_not_logged", `${name}: unloggable access must fail the read`);
    assert.equal(result.bytes, undefined, `${name}: no bytes may be returned when logging failed`);
  }

  // Deletion produces verified deletion evidence and the bytes become
  // unreachable.
  {
    const reviewId = nextReviewId();
    const { digest, bytes } = makeArtifact("deletion");
    const { store } = await createStore();
    await store.put({ digest, bytes, classification: makeClassification(), reviewId });
    const attempt = makeDeletionEvidence(digest);
    const deleted = await store.delete({ digest, evidence: attempt });
    assert.equal(deleted.outcome, "deleted", `${name}: deletion must succeed`);
    assert.equal(deleted.evidence.verification_status, "verified", `${name}: absence must be confirmed by re-read`);
    assert.equal(
      deleted.evidence.supersedes_deletion_evidence_ref,
      attempt.deletion_evidence_id,
      `${name}: verified deletion must supersede the unverified attempt`
    );
    assert.notEqual(deleted.evidence.deletion_evidence_id, attempt.deletion_evidence_id, `${name}: verified deletion is a new append`);
    assert.equal((await store.findDeletionEvidence(attempt.deletion_evidence_id))?.verification_status, "unverified");
    assert.equal((await store.findDeletionEvidence(deleted.evidence.deletion_evidence_id))?.verification_status, "verified");

    const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: reviewId }) };
    assert.equal((await store.get({ access, digest })).outcome, "not_found", `${name}: deleted bytes must be gone`);
  }

  console.log(`${name}: artifact store contract passed.`);
}
