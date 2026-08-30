import assert from "node:assert/strict";

function makeGate(overrides = {}) {
  return {
    protocol_version: "codeattest.v0",
    environment_profile: "synthetic_demo",
    allowed_source_derived_classes: ["retained_review_artifact"],
    real_raw_snippet_acceptance: false,
    real_targeted_file_acceptance: false,
    access_control_ready: false,
    access_logging_ready: false,
    encryption_at_rest_ready: false,
    retention_defaults_ready: false,
    deletion_controls_ready: false,
    demo_budget_gate_ready: false,
    signing_release_trust_ready: false,
    retention_period_required: false,
    evidence_boundary: "synthetic-demo-only",
    ...overrides
  };
}

/**
 * Record-store semantics every adapter set must satisfy.
 *
 * `nextId` hands each case a unique stored_object_ref / job_id, and
 * `nextVersion` a unique gate base version, because the Postgres app role
 * cannot DELETE history rows to reset state between cases. Memory stores are
 * fresh per `createStores()` call, so constants are correct there.
 */
export async function runRecordStoreContract({ name, createStores, nextId, nextVersion }) {
  // Classification: recorded once, then idempotent, and findable by ref.
  {
    const { classifications } = await createStores();
    const ref = nextId();
    const classification = {
      protocol_version: "codeattest.v0",
      stored_object_ref: ref,
      object_kind: "evidence_artifact",
      source_derived_class: "retained_review_artifact",
      environment_profile: "synthetic_demo"
    };
    assert.equal((await classifications.record(classification)).outcome, "recorded");
    assert.equal((await classifications.record(classification)).outcome, "already_present");
    const found = await classifications.find(ref);
    assert.equal(found.source_derived_class, "retained_review_artifact", `${name}: classification must round-trip`);
    assert.equal(await classifications.find("stored_object:absent"), undefined);
  }

  {
    const { retentionRecords } = await createStores();
    const due = {
      protocol_version: "codeattest.v0",
      retention_record_id: `retention_record:${nextId().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`,
      source_derived_class: "customer_opt_in_retained_source",
      customer_approval_ref: "approval:synthetic-demo-opt-in-0001",
      retention_period: {
        start_timestamp: "2026-07-19T00:00:00Z",
        end_timestamp: "2026-08-26T00:00:00Z"
      },
      retained_artifact_refs: ["artifact_ref:opt_in_snippet_001"]
    };
    const future = {
      ...due,
      retention_record_id: `retention_record:${nextId().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`,
      retention_period: {
        start_timestamp: "2026-07-19T00:00:00Z",
        end_timestamp: "2026-12-01T00:00:00Z"
      }
    };
    assert.equal((await retentionRecords.record(due)).outcome, "recorded");
    assert.equal((await retentionRecords.record(future)).outcome, "recorded");
    const listed = await retentionRecords.listDue("2026-08-26T00:00:00Z");
    assert.equal(listed.length, 1, `${name}: listDue includes the UTC boundary and excludes later records`);
    assert.equal(listed[0].retention_record_id, due.retention_record_id);
  }

  // Environment gate: append-only and versioned; loadCurrent reads the highest
  // version, so raising the profile is an audit record rather than an update.
  {
    const { environmentGate } = await createStores();
    assert.equal(await environmentGate.loadCurrent(), undefined, `${name}: no gate initially`);

    const v1 = nextVersion();
    assert.equal((await environmentGate.recordVersion({ version: v1, gate: makeGate() })).outcome, "recorded");
    assert.equal((await environmentGate.recordVersion({ version: v1, gate: makeGate() })).outcome, "version_conflict",
      `${name}: a version may never be rewritten`);

    const candidate = makeGate({ environment_profile: "partner_pilot_candidate" });
    assert.equal((await environmentGate.recordVersion({ version: v1 + 1, gate: candidate })).outcome, "recorded");

    const current = await environmentGate.loadCurrent();
    assert.equal(current.version, v1 + 1, `${name}: loadCurrent must read the highest version`);
    assert.equal(current.gate.environment_profile, "partner_pilot_candidate");
  }

  // Job queue: claim hands out a job once, complete removes it.
  {
    const { jobs } = await createStores();
    const jobId = nextId();
    assert.equal((await jobs.enqueue({ job_id: jobId, job_type: "normalize", payload: "{}" })).outcome, "enqueued");
    assert.equal((await jobs.enqueue({ job_id: jobId, job_type: "normalize", payload: "{}" })).outcome, "already_present");

    const claimed = await jobs.claim("normalize");
    assert.equal(claimed.job_id, jobId, `${name}: claim must return the enqueued job`);
    assert.equal(await jobs.claim("normalize"), undefined, `${name}: a claimed job must not be handed out twice`);

    await jobs.complete(jobId);
    assert.equal(await jobs.claim("normalize"), undefined, `${name}: a completed job must not reappear`);
  }

  // A failed job becomes claimable again with its attempt count incremented.
  {
    const { jobs } = await createStores();
    const jobId = nextId();
    await jobs.enqueue({ job_id: jobId, job_type: "normalize", payload: "{}" });
    await jobs.claim("normalize");
    await jobs.fail(jobId);
    const retried = await jobs.claim("normalize");
    assert.equal(retried.job_id, jobId, `${name}: a failed job must be retryable`);
    assert.equal(retried.attempts, 2, `${name}: attempts must increment`);
  }

  console.log(`${name}: record store contract passed.`);
}
