import { createHash } from "node:crypto";

import type { ReviewEvent } from "../../../protocol-ts/src/index.js";

const REVIEW_LOG_LEAF_DOMAIN = Buffer.from("codeattest:v0:review-log-leaf", "utf8");
const REVIEW_LOG_HEAD_DOMAIN = Buffer.from("codeattest:v0:review-log-head", "utf8");
const REVIEW_LOG_EMPTY_DOMAIN = Buffer.from("codeattest:v0:review-log-empty", "utf8");
const SHA256_ID_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVIEW_ID_PATTERN = /^review:[a-z0-9][a-z0-9_-]{2,63}$/u;
const MAX_REVIEW_EVENTS = 10_000;

export function computeReviewChainHead(events: readonly ReviewEvent[]): string {
  if (events.length > MAX_REVIEW_EVENTS) throw new RangeError("A review chain cannot exceed the protocol event limit.");
  if (events.length === 0) return sha256(REVIEW_LOG_EMPTY_DOMAIN).toString("hex");

  const orderedEvents = [...events].sort((left, right) => left.sequence_number - right.sequence_number);
  let reviewId: string | undefined;
  let previousSequence: number | undefined;
  let head: Buffer | undefined;

  for (const event of orderedEvents) {
    assertReviewEventChainInput(event);
    if (reviewId === undefined) reviewId = event.review_id;
    if (event.review_id !== reviewId) throw new TypeError("A review chain cannot contain events from different reviews.");
    if (event.sequence_number === previousSequence) throw new TypeError("A review chain cannot contain duplicate sequence numbers.");

    const sequenceBytes = Buffer.alloc(8);
    sequenceBytes.writeBigUInt64BE(BigInt(event.sequence_number));
    const leaf = sha256(REVIEW_LOG_LEAF_DOMAIN, sequenceBytes, Buffer.from(event.event_id, "utf8"));
    head = head === undefined
      ? sha256(REVIEW_LOG_HEAD_DOMAIN, leaf)
      : sha256(REVIEW_LOG_HEAD_DOMAIN, head, leaf);
    previousSequence = event.sequence_number;
  }

  return head?.toString("hex") ?? sha256(REVIEW_LOG_EMPTY_DOMAIN).toString("hex");
}

function assertReviewEventChainInput(event: ReviewEvent): void {
  if (!REVIEW_ID_PATTERN.test(event.review_id)) throw new TypeError("Review events must contain a valid review_id.");
  if (!SHA256_ID_PATTERN.test(event.event_id)) throw new TypeError("Review events must contain a lowercase algorithm-prefixed sha256 event_id.");
  if (!Number.isSafeInteger(event.sequence_number) || event.sequence_number < 0) {
    throw new RangeError("Review event sequence_number must be an unsigned safe integer.");
  }
}

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}
