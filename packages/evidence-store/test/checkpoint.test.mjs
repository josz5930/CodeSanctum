import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { importCompiled } from "./helpers/compile.mjs";

const { computeCheckpoint, inclusionProof } = await importCompiled("src/transparency/checkpoint.js");

const heads = [
  { review_id: "review:alpha", head_hash: "00".repeat(32) },
  { review_id: "review:beta", head_hash: "11".repeat(32) },
  { review_id: "review:gamma", head_hash: "22".repeat(32) }
];
const knownRoots = [
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "11ba6575df715fddba9326d42dd35ae15f9fcc03d0e3da7ded17aac7d5e91e10",
  "97971e1fcbc82627b910d1748f1f618df720eed63ea6ab23fdd0c61a792f8ba0",
  "a2271a3750f68dc8919d2bf6f78382841552aa6de623ccf965f75100d74cee6e"
];

for (let treeSize = 0; treeSize <= heads.length; treeSize += 1) {
  assert.deepEqual(computeCheckpoint(heads.slice(0, treeSize)), {
    merkle_root: knownRoots[treeSize],
    tree_size: treeSize
  });
}

const shuffled = [heads[2], heads[0], heads[1]];
const shuffledSnapshot = structuredClone(shuffled);
assert.deepEqual(computeCheckpoint(shuffled), computeCheckpoint(heads), "review_id sorting must normalize input order");
assert.deepEqual(shuffled, shuffledSnapshot, "checkpoint computation must not mutate caller-owned input");

const alphaProof = inclusionProof("review:alpha", shuffled);
assert.deepEqual(alphaProof, {
  review_id: "review:alpha",
  leaf_index: 0,
  tree_size: 3,
  siblings: [
    { position: "right", hash: "f221dcb5a70c104b952e838572aef998595675d90c3da84a2eb06f990d1b237e" },
    { position: "right", hash: "2193502dcc07233e8784311f3470f51b20c001524714102d223e09ccc610cf62" }
  ]
});

for (const head of heads) {
  const proof = inclusionProof(head.review_id, heads);
  assert.equal(verifyProof(head, proof), knownRoots[3], `${head.review_id} proof must reconstruct the root`);
}

const changedHead = heads.map((head, index) => index === 1 ? { ...head, head_hash: "33".repeat(32) } : head);
assert.notEqual(computeCheckpoint(changedHead).merkle_root, knownRoots[3], "changing one head must change the root");

const truncated = computeCheckpoint(heads.slice(0, 2));
assert.equal(truncated.tree_size, 2);
assert.notEqual(truncated.merkle_root, knownRoots[3], "removing a leaf must change the root");

assert.throws(() => computeCheckpoint([heads[0], { ...heads[0] }]), /duplicate review_id/u);
assert.throws(() => computeCheckpoint([{ review_id: "not-a-review", head_hash: "00".repeat(32) }]), /valid review_id/u);
assert.throws(() => computeCheckpoint([{ review_id: "review:alpha", head_hash: "AA".repeat(32) }]), /lowercase 64-character/u);
assert.throws(() => computeCheckpoint([{ review_id: "review:alpha", head_hash: "abc" }]), /lowercase 64-character/u);
assert.throws(() => inclusionProof("review:missing", heads), /No review head exists/u);
assert.throws(() => inclusionProof("not-a-review", heads), /valid review_id/u);

function verifyProof(head, proof) {
  const canonicalLeaf = JSON.stringify({ head_hash: head.head_hash, review_id: head.review_id });
  let current = hash(Buffer.from([0x00]), Buffer.from(canonicalLeaf, "utf8"));
  for (const sibling of proof.siblings) {
    const siblingBytes = Buffer.from(sibling.hash, "hex");
    current = sibling.position === "left"
      ? hash(Buffer.from([0x01]), siblingBytes, current)
      : hash(Buffer.from([0x01]), current, siblingBytes);
  }
  return current.toString("hex");
}

function hash(...parts) {
  const digest = createHash("sha256");
  for (const part of parts) digest.update(part);
  return digest.digest();
}

console.log("checkpoint test passed.");
