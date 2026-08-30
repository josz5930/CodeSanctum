export const REVIEW_ID = "review:synthetic_demo_alpha";

export function makeReviewEvent(overrides = {}) {
  return {
    protocol_version: "codeattest.v0",
    event_id: "sha256:" + "a".repeat(64),
    review_id: REVIEW_ID,
    sequence_number: 0,
    idempotency_key: "receipt:synthetic_demo_alpha:1",
    event_type: "receipt_issued",
    actor: { actor_type: "vendor_service", actor_id: "vendor:synthetic_demo" },
    event_timestamp: "2026-08-16T00:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_demo_receipt"],
    visibility: "internal_only",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["event_id"],
    ...overrides
  };
}

export function makeLifecycleEvent(overrides = {}) {
  return {
    protocol_version: "codeattest.v0",
    event_id: "evidence_event:synthetic_demo_1",
    review_id: REVIEW_ID,
    sequence_number: 0,
    idempotency_key: "evidence:synthetic_demo_alpha:1",
    event_type: "evidence_accessed",
    actor: { actor_type: "reviewer", actor_id: "reviewer:synthetic_demo" },
    event_timestamp: "2026-08-16T00:00:00Z",
    artifact_refs: ["artifact_ref:synthetic_demo_scope"],
    source_derived_class: "retained_review_artifact",
    access_scope: { tenant_id: "tenant:synthetic_demo", review_scope: REVIEW_ID },
    ...overrides
  };
}
