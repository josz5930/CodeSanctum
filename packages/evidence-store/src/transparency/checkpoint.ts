import { createHash } from "node:crypto";

import { canonicalizeProtocolJson } from "../../../protocol-ts/src/index.js";

const REVIEW_ID_PATTERN = /^review:[a-z0-9][a-z0-9_-]{2,63}$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export type ReviewHead = Readonly<{
  review_id: string;
  head_hash: string;
}>;

export type MerkleProofStep = Readonly<{
  position: "left" | "right";
  hash: string;
}>;

export type MerkleProof = Readonly<{
  review_id: string;
  leaf_index: number;
  tree_size: number;
  siblings: readonly MerkleProofStep[];
}>;

export type CheckpointProjection = Readonly<{
  merkle_root: string;
  tree_size: number;
}>;

export function computeCheckpoint(heads: readonly ReviewHead[]): CheckpointProjection {
  const orderedHeads = validateAndSortHeads(heads);
  const merkleRoot = computeMerkleRoot(orderedHeads.map(hashReviewHeadLeaf));
  return { merkle_root: merkleRoot.toString("hex"), tree_size: orderedHeads.length };
}

export function inclusionProof(reviewId: string, heads: readonly ReviewHead[]): MerkleProof {
  assertReviewId(reviewId);
  const orderedHeads = validateAndSortHeads(heads);
  let index = orderedHeads.findIndex((head) => head.review_id === reviewId);
  if (index === -1) throw new RangeError(`No review head exists for ${reviewId}.`);

  const leafIndex = index;
  const siblings: MerkleProofStep[] = [];
  let level = orderedHeads.map(hashReviewHeadLeaf);

  while (level.length > 1) {
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;
    const sibling = level[siblingIndex];
    if (sibling !== undefined) {
      siblings.push({
        position: isRightChild ? "left" : "right",
        hash: sibling.toString("hex")
      });
    }
    level = nextMerkleLevel(level);
    index = Math.floor(index / 2);
  }

  return {
    review_id: reviewId,
    leaf_index: leafIndex,
    tree_size: orderedHeads.length,
    siblings
  };
}

function validateAndSortHeads(heads: readonly ReviewHead[]): ReviewHead[] {
  const orderedHeads = [...heads].sort((left, right) => compareReviewIds(left.review_id, right.review_id));
  let previousReviewId: string | undefined;
  for (const head of orderedHeads) {
    assertReviewId(head.review_id);
    if (!SHA256_HEX_PATTERN.test(head.head_hash)) throw new TypeError("Review head_hash must be lowercase 64-character sha256 hex.");
    if (head.review_id === previousReviewId) throw new TypeError("A checkpoint cannot contain duplicate review_id entries.");
    previousReviewId = head.review_id;
  }
  return orderedHeads;
}

function compareReviewIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertReviewId(reviewId: string): void {
  if (!REVIEW_ID_PATTERN.test(reviewId)) throw new TypeError("Checkpoint entries must contain a valid review_id.");
}

function hashReviewHeadLeaf(head: ReviewHead): Buffer {
  const canonicalLeaf = canonicalizeProtocolJson({ review_id: head.review_id, head_hash: head.head_hash });
  return sha256(Uint8Array.of(0x00), Buffer.from(canonicalLeaf, "utf8"));
}

function computeMerkleRoot(leaves: readonly Buffer[]): Buffer {
  if (leaves.length === 0) return sha256(new Uint8Array());
  let level = [...leaves];
  while (level.length > 1) level = nextMerkleLevel(level);
  const root = level[0];
  if (root === undefined) throw new Error("Merkle tree unexpectedly produced no root.");
  return root;
}

function nextMerkleLevel(level: readonly Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let index = 0; index < level.length; index += 2) {
    const left = level[index];
    if (left === undefined) throw new Error("Merkle level unexpectedly omitted a left node.");
    const right = level[index + 1];
    next.push(right === undefined ? left : sha256(Uint8Array.of(0x01), left, right));
  }
  return next;
}

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}
