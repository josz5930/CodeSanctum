import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { computeCheckpoint } = await importCompiled("src/transparency/checkpoint.js");
const { publishCheckpoint, verifyPublishedCheckpoint, checkpointId, TransparencyAnchorNotConfiguredError } =
  await importCompiled("src/transparency/publication.js");

const heads = [
  { review_id: "review:alpha", head_hash: "00".repeat(32) },
  { review_id: "review:beta", head_hash: "11".repeat(32) }
];
const checkpoint = computeCheckpoint(heads);
const publishedAt = "2026-08-21T12:00:00Z";

/** In-memory stub anchor standing in for the human-provisioned off-box endpoint. */
function stubAnchor() {
  const store = new Map();
  return {
    puts: 0,
    store,
    async put(record) {
      this.puts += 1;
      store.set(record.checkpoint_id, { ...record });
      return { anchor_ref: `anchor://stub/${record.checkpoint_id}` };
    },
    async get(id) {
      const record = store.get(id);
      return record === undefined ? undefined : { ...record };
    }
  };
}

// End-to-end round trip: a checkpoint is published and re-verified against the anchor.
{
  const anchor = stubAnchor();
  const published = await publishCheckpoint({ anchor, checkpoint, publishedAt });
  assert.equal(anchor.puts, 1);
  assert.equal(published.checkpoint_id, checkpointId(checkpoint, publishedAt));
  assert.match(published.anchor_ref, /^anchor:\/\/stub\//);
  const verification = await verifyPublishedCheckpoint({ anchor, expected: published.record });
  assert.equal(verification.verified, true);
  assert.deepEqual(verification.record, published.record);
}

// Missing anchor config fails closed, loudly — not a silent success — for both
// publication and verification.
{
  await assert.rejects(
    publishCheckpoint({ anchor: undefined, checkpoint, publishedAt }),
    (error) => error instanceof TransparencyAnchorNotConfiguredError
  );
  await assert.rejects(
    verifyPublishedCheckpoint({ anchor: undefined, expected: { checkpoint_id: "x", merkle_root: "0".repeat(64), tree_size: 1, published_at: publishedAt } }),
    (error) => error instanceof TransparencyAnchorNotConfiguredError
  );
}

// A checkpoint that was never published verifies false with a reason.
{
  const anchor = stubAnchor();
  const published = await publishCheckpoint({ anchor, checkpoint, publishedAt });
  const emptyAnchor = stubAnchor();
  const verification = await verifyPublishedCheckpoint({ anchor: emptyAnchor, expected: published.record });
  assert.deepEqual(verification, { verified: false, reason: "not_found" });
}

// An anchor that hands back an altered record is caught: a tampered root no
// longer matches the record's own id (corrupt) and, when the id is adjusted too,
// no longer matches what was expected (content mismatch).
{
  const anchor = stubAnchor();
  const published = await publishCheckpoint({ anchor, checkpoint, publishedAt });
  const stored = anchor.store.get(published.checkpoint_id);
  anchor.store.set(published.checkpoint_id, { ...stored, merkle_root: "f".repeat(64) });
  const corrupt = await verifyPublishedCheckpoint({ anchor, expected: published.record });
  assert.deepEqual(corrupt, { verified: false, reason: "corrupt_record" });

  const otherPublishedAt = "2026-08-22T12:00:00Z";
  const reId = checkpointId({ merkle_root: "f".repeat(64), tree_size: checkpoint.tree_size }, otherPublishedAt);
  anchor.store.set(published.checkpoint_id, { checkpoint_id: reId, merkle_root: "f".repeat(64), tree_size: checkpoint.tree_size, published_at: otherPublishedAt });
  const mismatch = await verifyPublishedCheckpoint({ anchor, expected: published.record });
  assert.deepEqual(mismatch, { verified: false, reason: "content_mismatch" });
}

// A misbehaving anchor that confirms nothing (no reference) is rejected, not
// reported as a successful publication.
{
  const anchor = { async put() { return { anchor_ref: "" }; }, async get() { return undefined; } };
  await assert.rejects(publishCheckpoint({ anchor, checkpoint, publishedAt }), /no reference/);
}

console.log("transparency-publication test passed.");
