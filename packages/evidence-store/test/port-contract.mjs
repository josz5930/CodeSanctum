import assert from "node:assert/strict";

/**
 * Append-only semantics every log store must satisfy, regardless of adapter.
 * Run against memory in Task 4 and against Postgres in Task 9; if the two ever
 * diverge, one of these assertions fails.
 *
 * `nextReviewId` hands each case a fresh review id, because the Postgres app
 * role cannot DELETE history rows to reset state between cases. Memory stores
 * are fresh per `createStore()` call, so a constant is correct there.
 */
export async function runAppendOnlyLogContract({ name, createStore, makeEvent, nextReviewId }) {
  // An empty log loads as an empty array, not undefined.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    assert.deepEqual(await store.loadLog(reviewId), [], `${name}: empty log must load as []`);
  }

  // A first append is recorded and readable.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    const event = makeEvent({ review_id: reviewId });
    const result = await store.append(reviewId, event);
    assert.equal(result.outcome, "appended", `${name}: first append must succeed`);
    const loaded = await store.loadLog(reviewId);
    assert.equal(loaded.length, 1, `${name}: log must contain the appended event`);
    assert.equal(loaded[0].idempotency_key, event.idempotency_key);
  }

  // Replaying an identical body under the same idempotency key is a no-op.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    const event = makeEvent({ review_id: reviewId });
    await store.append(reviewId, event);
    const replay = await store.append(reviewId, event);
    assert.equal(replay.outcome, "idempotent_noop", `${name}: identical replay must be a no-op`);
    assert.equal((await store.loadLog(reviewId)).length, 1, `${name}: replay must not duplicate`);
  }

  // A DIFFERENT body under an already-used idempotency key is a rewrite and is
  // rejected. This is the Architecture Rule 9 requirement.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    await store.append(reviewId, makeEvent({ review_id: reviewId }));
    const conflicting = makeEvent({ review_id: reviewId, event_timestamp: "2026-08-17T00:00:00Z" });
    const result = await store.append(reviewId, conflicting);
    assert.equal(result.outcome, "rejected", `${name}: differing body under used key must be rejected`);
    assert.equal(result.reason, "idempotency_key_body_conflict");
    assert.equal((await store.loadLog(reviewId)).length, 1, `${name}: rejection must not append`);
  }

  // sequence_number must be strictly greater than every one already present.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 5, idempotency_key: "k:5" }));
    const stale = await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 5, idempotency_key: "k:5b" }));
    assert.equal(stale.outcome, "rejected", `${name}: equal sequence number must be rejected`);
    assert.equal(stale.reason, "sequence_number_not_monotonic");

    const older = await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 1, idempotency_key: "k:1" }));
    assert.equal(older.outcome, "rejected", `${name}: lower sequence number must be rejected`);

    const next = await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 6, idempotency_key: "k:6" }));
    assert.equal(next.outcome, "appended", `${name}: higher sequence number must be accepted`);
  }

  // Prior events are never altered by a later append.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 0, idempotency_key: "k:0" }));
    const before = JSON.stringify(await store.loadLog(reviewId));
    await store.append(reviewId, makeEvent({ review_id: reviewId, sequence_number: 1, idempotency_key: "k:1" }));
    const after = await store.loadLog(reviewId);
    assert.equal(JSON.stringify(after.slice(0, 1)), before, `${name}: prior events must be untouched`);
  }

  // Logs are isolated per review.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    await store.append(reviewId, makeEvent({ review_id: reviewId }));
    assert.deepEqual(await store.loadLog("review:synthetic_demo_other"), [], `${name}: logs must be per-review`);
  }

  // Operational projections can read one UTC timestamp range across reviews
  // without creating a second ledger. Both adapters must preserve the same
  // inclusive-start/exclusive-end boundary and timestamp order.
  {
    const reviewId = nextReviewId();
    const store = await createStore();
    await store.append(reviewId, makeEvent({
      review_id: reviewId,
      sequence_number: 0,
      idempotency_key: "range:july",
      event_timestamp: "2026-07-31T23:59:59Z"
    }));
    await store.append(reviewId, makeEvent({
      review_id: reviewId,
      sequence_number: 1,
      idempotency_key: "range:september",
      event_timestamp: "2026-09-01T00:00:00Z"
    }));
    await store.append(reviewId, makeEvent({
      review_id: reviewId,
      sequence_number: 2,
      idempotency_key: "range:august",
      event_timestamp: "2026-08-15T12:00:00Z"
    }));
    const august = await store.loadEventsByTimestampRange(
      "2026-08-01T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z"
    );
    assert.deepEqual(
      august.filter((event) => event.review_id === reviewId).map((event) => event.review_id),
      [reviewId],
      `${name}: timestamp range must span reviews and exclude both neighbouring months`
    );
  }

  console.log(`${name}: append-only log contract passed.`);
}
