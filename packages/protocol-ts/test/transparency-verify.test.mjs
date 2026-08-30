import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { compileWorkspace } from "../../evidence-store/test/helpers/compile.mjs";

const compiledRoot = await compileWorkspace();
const {
  recomputeExcludedFieldIdentity,
  verifyCheckpointIdentity,
  verifyInclusionProof,
  verifyReviewChainHead
} = await import(pathToFileURL(path.join(compiledRoot, "packages", "protocol-ts", "src", "index.js")).href);

const fixtureRoot = new URL("../../../protocol/fixtures/v0/", import.meta.url);
const reviewLog = JSON.parse(await readFile(new URL("valid/review-event-log.json", fixtureRoot), "utf8"));
const checkpoint = JSON.parse(await readFile(new URL("valid/log-checkpoint.empty.json", fixtureRoot), "utf8"));
const firstThreeEvents = reviewLog.events.slice(0, 3);

const EMPTY_HEAD = "7d0b4e2f2042bfa91031c8c73b056332e35288dc92b943ed5400df26f1dcb811";
const THREE_EVENT_HEAD = "35b76392c50084b004355717cdb9f53c88004be96e6981042db8efc8b0ab91a1";
const THREE_LEAF_ROOT = "2f33a04a1dfe0fe05ef3459ae789811304c9705f5c24c185fcf061a773e6f116";

assert.deepEqual(verifyReviewChainHead([], EMPTY_HEAD), { verified: true }, "the pinned TC-3 empty-log head must verify");
assert.deepEqual(verifyReviewChainHead(firstThreeEvents, THREE_EVENT_HEAD), { verified: true }, "the pinned three-event head must verify");
assert.deepEqual(verifyReviewChainHead([...firstThreeEvents].reverse(), THREE_EVENT_HEAD), { verified: true }, "array position must not override sequence_number order");

const reordered = structuredClone(firstThreeEvents);
[reordered[0].sequence_number, reordered[1].sequence_number] = [reordered[1].sequence_number, reordered[0].sequence_number];
assert.equal(verifyReviewChainHead(reordered, THREE_EVENT_HEAD).verified, false, "changing event sequence bindings must fail closed");

const rewritten = structuredClone(firstThreeEvents);
rewritten[1].internal_note += " rewritten";
assert.equal(verifyReviewChainHead(rewritten, THREE_EVENT_HEAD).verified, false, "rewriting event content beneath the old event_id must fail closed");
const crossReview = structuredClone(firstThreeEvents);
crossReview[1].review_id = "review:synthetic-other";
crossReview[1].event_id = recomputeExcludedFieldIdentity(crossReview[1], "event_id");
assert.equal(verifyReviewChainHead(crossReview, THREE_EVENT_HEAD).verified, false, "mixing events from different reviews must fail closed");
assert.deepEqual(verifyReviewChainHead(firstThreeEvents.slice(0, 2), THREE_EVENT_HEAD), { verified: false, reason: "head_mismatch" }, "truncating the log must not verify against its prior head");
assert.equal(verifyReviewChainHead(firstThreeEvents, "not-a-head").verified, false, "a malformed claimed head must fail closed");
assert.equal(verifyReviewChainHead([{ sequence_number: Number.MAX_SAFE_INTEGER + 1 }], EMPTY_HEAD).verified, false, "an unsafe sequence number must fail closed");
assert.equal(verifyReviewChainHead(Array.from({ length: 10_001 }, () => firstThreeEvents[0]), EMPTY_HEAD).verified, false, "an oversized event array must fail closed");

const reviewHead = {
  review_id: "review:synthetic-beta",
  head_hash: "b3e3e46cbcadb7f57a9a909d59f35516c28c406d3ce1024ccdc1a02c8799805a"
};
const proof = {
  review_id: "review:synthetic-beta",
  leaf_index: 1,
  tree_size: 3,
  siblings: [
    { position: "left", hash: "0370edb2c969c67c365a4562ad70e110de4bd12fedf0b2570c08def0cba688bc" },
    { position: "right", hash: "3b4ba4ba1db930f67cf5806446645bb538eb08cfa353350e2e9fe05bf8bb6da1" }
  ]
};

assert.deepEqual(verifyInclusionProof(reviewHead, proof, THREE_LEAF_ROOT), { verified: true }, "the pinned three-leaf inclusion proof must verify");
const forgedProof = structuredClone(proof);
forgedProof.siblings[0].hash = "0".repeat(64);
assert.equal(verifyInclusionProof(reviewHead, forgedProof, THREE_LEAF_ROOT).verified, false, "a forged inclusion proof must fail closed");
const wrongDirection = structuredClone(proof);
wrongDirection.siblings[0].position = "right";
assert.deepEqual(verifyInclusionProof(reviewHead, wrongDirection, THREE_LEAF_ROOT), { verified: false, reason: "invalid_proof" }, "proof directions must agree with leaf_index and tree_size");
assert.equal(verifyInclusionProof(reviewHead, proof, "f".repeat(63)).verified, false, "a malformed Merkle root must fail closed");

assert.deepEqual(verifyCheckpointIdentity(checkpoint), { verified: true }, "the registered empty checkpoint fixture must verify");
const tamperedCheckpoint = structuredClone(checkpoint);
tamperedCheckpoint.checkpoint_id = `sha256:${"0".repeat(64)}`;
assert.deepEqual(verifyCheckpointIdentity(tamperedCheckpoint), { verified: false, reason: "identity_mismatch" }, "a tampered checkpoint identity must fail closed");

for (const invocation of [
  () => verifyReviewChainHead(null, EMPTY_HEAD),
  () => verifyReviewChainHead(new Array(1), EMPTY_HEAD),
  () => verifyInclusionProof(reviewHead, null, THREE_LEAF_ROOT),
  () => verifyInclusionProof(reviewHead, { ...proof, tree_size: 0 }, THREE_LEAF_ROOT),
  () => verifyCheckpointIdentity(Object.create({ checkpoint_id: checkpoint.checkpoint_id }))
]) {
  assert.doesNotThrow(invocation, "transparency verifiers must return typed failures for hostile input, never throw");
  assert.equal(invocation().verified, false, "hostile input must fail closed");
}

console.log("protocol-ts transparency verifiers pass fail-closed known-answer checks");
