import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { makeReviewEvent } from "./helpers/fixtures.mjs";

const { computeReviewChainHead } = await importCompiled("src/transparency/review-chain.js");

const event = (sequenceNumber, digestCharacter, overrides = {}) => makeReviewEvent({
  sequence_number: sequenceNumber,
  event_id: `sha256:${digestCharacter.repeat(64)}`,
  idempotency_key: `transparency:${sequenceNumber}:${digestCharacter}`,
  ...overrides
});

const original = [event(0, "a"), event(1, "b"), event(2, "c")];

assert.equal(
  computeReviewChainHead([]),
  "7d0b4e2f2042bfa91031c8c73b056332e35288dc92b943ed5400df26f1dcb811",
  "the empty-log head must remain a stable known-answer vector"
);
assert.equal(
  computeReviewChainHead(original),
  "769c4a7fb5b7355137492223cc8a2145a6f3de85c4cfaab2e2fdd075a7a68dad",
  "the three-event head must remain a stable known-answer vector"
);

assert.equal(
  computeReviewChainHead([original[2], original[0], original[1]]),
  computeReviewChainHead(original),
  "array position is not authoritative; sequence_number order is"
);

const semanticallyReordered = [event(0, "a"), event(2, "b"), event(1, "c")];
assert.equal(
  computeReviewChainHead(semanticallyReordered),
  "75d973e9366bf30255bd70a69dfe39938dfa012f4d4fb0ea4d727b8be41e8ca0"
);
assert.notEqual(computeReviewChainHead(semanticallyReordered), computeReviewChainHead(original));

const rewritten = [event(0, "a"), event(1, "d"), event(2, "c")];
assert.equal(
  computeReviewChainHead(rewritten),
  "0ea041079b18b7f9cf1440bd4d11b93b1bb6f7779ef0e204bd2e028d1ca62137"
);
assert.notEqual(computeReviewChainHead(rewritten), computeReviewChainHead(original));

const correction = event(3, "d", { supersedes_event_id: original[1].event_id });
const correctedLog = [...original, correction];
assert.equal(
  computeReviewChainHead(correctedLog),
  "5026c14981ca9baf6cc906f968efdbc00aa91881e2badf7fed5d1e697ff157f5"
);
assert.notEqual(computeReviewChainHead(correctedLog), computeReviewChainHead(original));
assert.equal(
  computeReviewChainHead(original),
  "769c4a7fb5b7355137492223cc8a2145a6f3de85c4cfaab2e2fdd075a7a68dad",
  "appending a correction must not mutate the prior chain"
);

assert.throws(() => computeReviewChainHead([event(0, "a"), event(0, "b")]), /duplicate sequence numbers/u);
assert.throws(() => computeReviewChainHead([event(-1, "a")]), /unsigned safe integer/u);
assert.throws(() => computeReviewChainHead([event(1.5, "a")]), /unsigned safe integer/u);
assert.throws(() => computeReviewChainHead([event(Number.MAX_SAFE_INTEGER + 1, "a")]), /unsigned safe integer/u);
assert.throws(() => computeReviewChainHead([event(0, "A")]), /algorithm-prefixed sha256/u);
assert.throws(() => computeReviewChainHead([event(0, "a", { event_id: "sha256:abc" })]), /algorithm-prefixed sha256/u);
assert.throws(() => computeReviewChainHead([event(0, "a", { review_id: "bad-review" })]), /valid review_id/u);
assert.throws(() => computeReviewChainHead(Array.from({ length: 10_001 }, () => original[0])), /protocol event limit/u);
assert.throws(
  () => computeReviewChainHead([event(0, "a"), event(1, "b", { review_id: "review:synthetic_demo_beta" })]),
  /different reviews/u
);

console.log("review-chain test passed.");
