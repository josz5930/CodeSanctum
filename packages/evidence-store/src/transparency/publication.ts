import { createHash } from "node:crypto";

import { canonicalizeProtocolJson } from "../../../protocol-ts/src/index.js";

import type { CheckpointProjection } from "./checkpoint.js";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * The externally anchored form of a transparency checkpoint (F-9): the Merkle
 * projection plus the publication time and a content-addressed id, so a
 * published checkpoint can be fetched back and matched byte-for-byte.
 */
export type TransparencyCheckpointRecord = Readonly<{
  checkpoint_id: string;
  merkle_root: string;
  tree_size: number;
  published_at: string;
}>;

/**
 * The off-box anchor port. A deployment supplies an HTTP/object-store adapter
 * (endpoint + credentials are human-provisioned per Section 2 §1/§7); this
 * library only publishes through, and reads back from, this interface so the
 * publication and round-trip logic stays testable against a stub anchor.
 */
export type TransparencyAnchor = {
  put(record: TransparencyCheckpointRecord): Promise<{ anchor_ref: string }>;
  get(checkpointId: string): Promise<TransparencyCheckpointRecord | undefined>;
};

/**
 * Thrown when publication or verification is attempted without a configured
 * anchor. A missing anchor must fail closed and loudly — never be treated as a
 * successful (or silently skipped) publication.
 */
export class TransparencyAnchorNotConfiguredError extends Error {
  constructor() {
    super("transparency anchor is not configured; checkpoint publication fails closed");
    this.name = "TransparencyAnchorNotConfiguredError";
  }
}

function assertValidCheckpoint(checkpoint: CheckpointProjection): void {
  if (!SHA256_HEX_PATTERN.test(checkpoint.merkle_root)) {
    throw new TypeError("checkpoint merkle_root must be lowercase 64-character sha256 hex");
  }
  if (!Number.isInteger(checkpoint.tree_size) || checkpoint.tree_size < 0) {
    throw new TypeError("checkpoint tree_size must be a non-negative integer");
  }
}

/** Content-addressed id over the canonical checkpoint, independent of how the anchor stores it. */
export function checkpointId(checkpoint: CheckpointProjection, publishedAt: string): string {
  return createHash("sha256")
    .update(canonicalizeProtocolJson({
      merkle_root: checkpoint.merkle_root,
      published_at: publishedAt,
      tree_size: checkpoint.tree_size
    }))
    .digest("hex");
}

/**
 * Publishes a checkpoint to the off-box anchor. Fails closed if no anchor is
 * configured, and rejects a misbehaving anchor that returns no reference rather
 * than reporting a publication that may not have landed.
 */
export async function publishCheckpoint(input: {
  anchor: TransparencyAnchor | undefined;
  checkpoint: CheckpointProjection;
  publishedAt: string;
}): Promise<{ checkpoint_id: string; anchor_ref: string; record: TransparencyCheckpointRecord }> {
  if (input.anchor === undefined) {
    throw new TransparencyAnchorNotConfiguredError();
  }
  assertValidCheckpoint(input.checkpoint);
  if (!RFC3339_PATTERN.test(input.publishedAt)) {
    throw new TypeError("publishedAt must be an RFC 3339 timestamp");
  }
  const record: TransparencyCheckpointRecord = {
    checkpoint_id: checkpointId(input.checkpoint, input.publishedAt),
    merkle_root: input.checkpoint.merkle_root,
    tree_size: input.checkpoint.tree_size,
    published_at: input.publishedAt
  };
  const { anchor_ref } = await input.anchor.put(record);
  if (typeof anchor_ref !== "string" || anchor_ref.length === 0) {
    throw new Error("transparency anchor returned no reference; publication cannot be confirmed");
  }
  return { checkpoint_id: record.checkpoint_id, anchor_ref, record };
}

export type CheckpointVerification =
  | { verified: true; record: TransparencyCheckpointRecord }
  | { verified: false; reason: "not_found" | "content_mismatch" | "corrupt_record" };

/**
 * Confirms a published checkpoint round-trips: fetches it back from the anchor
 * by id and checks that the returned record is self-consistent (its id matches
 * its own canonical content) and equals what was expected. A missing anchor
 * fails closed; an absent or altered record verifies false with a reason rather
 * than silently.
 */
export async function verifyPublishedCheckpoint(input: {
  anchor: TransparencyAnchor | undefined;
  expected: TransparencyCheckpointRecord;
}): Promise<CheckpointVerification> {
  if (input.anchor === undefined) {
    throw new TransparencyAnchorNotConfiguredError();
  }
  const fetched = await input.anchor.get(input.expected.checkpoint_id);
  if (fetched === undefined) {
    return { verified: false, reason: "not_found" };
  }
  const recomputedId = checkpointId({ merkle_root: fetched.merkle_root, tree_size: fetched.tree_size }, fetched.published_at);
  if (recomputedId !== fetched.checkpoint_id) {
    return { verified: false, reason: "corrupt_record" };
  }
  if (
    fetched.checkpoint_id !== input.expected.checkpoint_id ||
    fetched.merkle_root !== input.expected.merkle_root ||
    fetched.tree_size !== input.expected.tree_size ||
    fetched.published_at !== input.expected.published_at
  ) {
    return { verified: false, reason: "content_mismatch" };
  }
  return { verified: true, record: fetched };
}
