import { createHash, timingSafeEqual } from "node:crypto";

import { canonicalizeProtocolJson, recomputeExcludedFieldIdentity } from "./canonical-identity.js";
import { validateProtocolSchema } from "./validation.js";

const REVIEW_LOG_LEAF_DOMAIN = "codeattest:v0:review-log-leaf";
const REVIEW_LOG_HEAD_DOMAIN = "codeattest:v0:review-log-head";
const REVIEW_LOG_EMPTY_DOMAIN = "codeattest:v0:review-log-empty";
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const ALGORITHM_PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const REVIEW_ID = /^review:[a-z0-9][a-z0-9_-]{2,63}$/u;
const MAX_REVIEW_EVENTS = 10_000;

export type TransparencyVerificationSuccess = { verified: true };

export type ReviewChainVerificationResult =
  | TransparencyVerificationSuccess
  | { verified: false; reason: "invalid_events" | "invalid_claimed_head" | "head_mismatch" };

export type MerkleProofSibling = {
  position: "left" | "right";
  hash: string;
};

export type MerkleProof = {
  review_id: string;
  leaf_index: number;
  tree_size: number;
  siblings: MerkleProofSibling[];
};

export type ReviewHead = {
  review_id: string;
  head_hash: string;
};

export type InclusionProofVerificationResult =
  | TransparencyVerificationSuccess
  | { verified: false; reason: "invalid_review_head" | "invalid_proof" | "invalid_merkle_root" | "root_mismatch" };

export type CheckpointIdentityVerificationResult =
  | TransparencyVerificationSuccess
  | { verified: false; reason: "schema_invalid" | "identity_mismatch" };

/**
 * Recomputes TC-3's per-review projection and compares it with a claimed
 * unprefixed SHA-256 head. Array position is not authoritative: events are
 * sorted by sequence_number, while duplicate or non-uint64-safe sequence
 * numbers fail closed. Event schema and content-addressed identity are also
 * checked so rewriting content beneath an unchanged event_id cannot verify.
 */
export function verifyReviewChainHead(events: unknown, claimedHead: unknown): ReviewChainVerificationResult {
  try {
    if (typeof claimedHead !== "string" || !SHA256_HEX.test(claimedHead)) {
      return { verified: false, reason: "invalid_claimed_head" };
    }
    const computedHead = recomputeReviewChainHead(events);
    if (computedHead === undefined) return { verified: false, reason: "invalid_events" };
    return hashesEqual(computedHead, claimedHead)
      ? { verified: true }
      : { verified: false, reason: "head_mismatch" };
  } catch {
    return { verified: false, reason: "invalid_events" };
  }
}

/** Verifies a TC-3 RFC 6962-style inclusion proof without trusting its directions. */
export function verifyInclusionProof(reviewHead: unknown, proof: unknown, merkleRoot: unknown): InclusionProofVerificationResult {
  try {
    if (!isReviewHead(reviewHead)) return { verified: false, reason: "invalid_review_head" };
    if (typeof merkleRoot !== "string" || !SHA256_HEX.test(merkleRoot)) {
      return { verified: false, reason: "invalid_merkle_root" };
    }
    if (!isMerkleProof(proof) || proof.review_id !== reviewHead.review_id) {
      return { verified: false, reason: "invalid_proof" };
    }

    let node = hashBytes(
      Buffer.from([0x00]),
      Buffer.from(canonicalizeProtocolJson({ review_id: reviewHead.review_id, head_hash: reviewHead.head_hash }), "utf8")
    );
    let index = proof.leaf_index;
    let width = proof.tree_size;
    let siblingIndex = 0;

    while (width > 1) {
      const hasLeftSibling = index % 2 === 1;
      const hasRightSibling = !hasLeftSibling && index + 1 < width;
      if (hasLeftSibling || hasRightSibling) {
        const sibling = proof.siblings[siblingIndex];
        const expectedPosition = hasLeftSibling ? "left" : "right";
        if (sibling === undefined || sibling.position !== expectedPosition) {
          return { verified: false, reason: "invalid_proof" };
        }
        const siblingHash = Buffer.from(sibling.hash, "hex");
        node = hasLeftSibling
          ? hashBytes(Buffer.from([0x01]), siblingHash, node)
          : hashBytes(Buffer.from([0x01]), node, siblingHash);
        siblingIndex += 1;
      }
      index = Math.floor(index / 2);
      width = Math.ceil(width / 2);
    }

    if (siblingIndex !== proof.siblings.length) return { verified: false, reason: "invalid_proof" };
    return hashesEqual(node.toString("hex"), merkleRoot)
      ? { verified: true }
      : { verified: false, reason: "root_mismatch" };
  } catch {
    return { verified: false, reason: "invalid_proof" };
  }
}

/** Validates a log-checkpoint and recomputes its RFC 8785 identity. */
export function verifyCheckpointIdentity(checkpoint: unknown): CheckpointIdentityVerificationResult {
  try {
    if (validateProtocolSchema("urn:codeattest:protocol:v0:log-checkpoint", checkpoint).length > 0) {
      return { verified: false, reason: "schema_invalid" };
    }
    if (!isPlainRecord(checkpoint) || checkpoint.identity_input_excludes === undefined) {
      return { verified: false, reason: "schema_invalid" };
    }
    const expectedIdentity = recomputeExcludedFieldIdentity(checkpoint, "checkpoint_id");
    return expectedIdentity !== undefined && checkpoint.checkpoint_id === expectedIdentity
      ? { verified: true }
      : { verified: false, reason: "identity_mismatch" };
  } catch {
    return { verified: false, reason: "schema_invalid" };
  }
}

function recomputeReviewChainHead(events: unknown): string | undefined {
  if (!Array.isArray(events) || events.length > MAX_REVIEW_EVENTS) return undefined;
  const eventArrayKeys = Reflect.ownKeys(events);
  if (
    eventArrayKeys.length !== events.length + 1
    || eventArrayKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))
  ) return undefined;
  const ordered: Array<{ sequence_number: number; event_id: string }> = [];
  let reviewId: string | undefined;
  for (let index = 0; index < events.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(events, index)) return undefined;
    const event = events[index];
    if (!isPlainRecord(event)) return undefined;
    if (validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event).length > 0) return undefined;
    if (!Number.isSafeInteger(event.sequence_number) || (event.sequence_number as number) < 0) return undefined;
    if (typeof event.event_id !== "string" || !ALGORITHM_PREFIXED_SHA256.test(event.event_id)) return undefined;
    if (typeof event.review_id !== "string" || !REVIEW_ID.test(event.review_id)) return undefined;
    if (reviewId === undefined) reviewId = event.review_id;
    if (event.review_id !== reviewId) return undefined;
    if (recomputeExcludedFieldIdentity(event, "event_id") !== event.event_id) return undefined;
    ordered.push({ sequence_number: event.sequence_number as number, event_id: event.event_id });
  }
  ordered.sort((left, right) => left.sequence_number - right.sequence_number);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]?.sequence_number === ordered[index - 1]?.sequence_number) return undefined;
  }

  if (ordered.length === 0) return hashBytes(Buffer.from(REVIEW_LOG_EMPTY_DOMAIN, "utf8")).toString("hex");
  let head: Buffer | undefined;
  for (const event of ordered) {
    const sequence = Buffer.alloc(8);
    sequence.writeBigUInt64BE(BigInt(event.sequence_number));
    const leaf = hashBytes(
      Buffer.from(REVIEW_LOG_LEAF_DOMAIN, "utf8"),
      sequence,
      Buffer.from(event.event_id, "utf8")
    );
    head = head === undefined
      ? hashBytes(Buffer.from(REVIEW_LOG_HEAD_DOMAIN, "utf8"), leaf)
      : hashBytes(Buffer.from(REVIEW_LOG_HEAD_DOMAIN, "utf8"), head, leaf);
  }
  return head?.toString("hex");
}

function isReviewHead(value: unknown): value is ReviewHead {
  return isPlainRecordWithExactKeys(value, ["review_id", "head_hash"])
    && typeof value.review_id === "string"
    && REVIEW_ID.test(value.review_id)
    && typeof value.head_hash === "string"
    && SHA256_HEX.test(value.head_hash);
}

function isMerkleProof(value: unknown): value is MerkleProof {
  if (!isPlainRecordWithExactKeys(value, ["review_id", "leaf_index", "tree_size", "siblings"])) return false;
  if (typeof value.review_id !== "string" || !REVIEW_ID.test(value.review_id)) return false;
  if (!Number.isSafeInteger(value.leaf_index) || !Number.isSafeInteger(value.tree_size)) return false;
  if ((value.leaf_index as number) < 0 || (value.tree_size as number) <= 0 || (value.leaf_index as number) >= (value.tree_size as number)) return false;
  if (!Array.isArray(value.siblings)) return false;
  if (value.siblings.length > 53) return false;
  for (let index = 0; index < value.siblings.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value.siblings, index)) return false;
    const sibling = value.siblings[index];
    if (!isPlainRecordWithExactKeys(sibling, ["position", "hash"])) return false;
    if (sibling.position !== "left" && sibling.position !== "right") return false;
    if (typeof sibling.hash !== "string" || !SHA256_HEX.test(sibling.hash)) return false;
  }
  return true;
}

function hashBytes(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function hashesEqual(left: string, right: string): boolean {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainRecordWithExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === expectedKeys.length
    && keys.every((key) => typeof key === "string" && expectedKeys.includes(key));
}
