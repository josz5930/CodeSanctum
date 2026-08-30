import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { compileWorkspace } from "../../evidence-store/test/helpers/compile.mjs";

const compiledRoot = await compileWorkspace();
const {
  computeCheckpoint,
  computeReviewChainHead,
  inclusionProof
} = await import(pathToFileURL(path.join(compiledRoot, "packages", "evidence-store", "src", "index.js")).href);
const {
  verifyInclusionProof,
  verifyReviewChainHead
} = await import(pathToFileURL(path.join(compiledRoot, "packages", "protocol-ts", "src", "index.js")).href);

const protocolRoot = new URL("../../../protocol/", import.meta.url);
const reviewEventSchema = JSON.parse(await readFile(new URL("schemas/review-event.schema.json", protocolRoot), "utf8"));
const evidenceLifecycleEventSchema = JSON.parse(await readFile(new URL("schemas/evidence-lifecycle-event.schema.json", protocolRoot), "utf8"));

for (const [name, schema] of [
  ["review-event", reviewEventSchema],
  ["evidence-lifecycle-event", evidenceLifecycleEventSchema]
]) {
  const fieldNames = collectPropertyNames(schema);
  const chainFields = [...fieldNames].filter((field) => /(?:prev(?:ious)?_hash|chain_(?:hash|head)|(?:hash|head)_chain)/u.test(field));
  assert.deepEqual(chainFields, [], `${name} must remain unchanged by the projection-only transparency chain; found ${chainFields.join(", ")}`);
}

const reviewLog = JSON.parse(await readFile(new URL("fixtures/v0/valid/review-event-log.json", protocolRoot), "utf8"));
const EMPTY_HEAD = "7d0b4e2f2042bfa91031c8c73b056332e35288dc92b943ed5400df26f1dcb811";
const THREE_EVENT_HEAD = "35b76392c50084b004355717cdb9f53c88004be96e6981042db8efc8b0ab91a1";

const computedEmptyHead = computeReviewChainHead([]);
assert.equal(computedEmptyHead, EMPTY_HEAD, "evidence-store must retain the pinned empty-log vector");
assert.deepEqual(verifyReviewChainHead([], computedEmptyHead), { verified: true }, "protocol-ts and evidence-store must agree on the empty-log vector");

const firstThreeEvents = reviewLog.events.slice(0, 3);
const computedThreeEventHead = computeReviewChainHead(firstThreeEvents);
assert.equal(computedThreeEventHead, THREE_EVENT_HEAD, "evidence-store must retain the pinned three-event vector");
assert.deepEqual(verifyReviewChainHead(firstThreeEvents, computedThreeEventHead), { verified: true }, "protocol-ts and evidence-store must agree on the three-event vector");

const emptyCheckpoint = JSON.parse(await readFile(new URL("fixtures/v0/valid/log-checkpoint.empty.json", protocolRoot), "utf8"));
const singleCheckpoint = JSON.parse(await readFile(new URL("fixtures/v0/valid/log-checkpoint.single-review.json", protocolRoot), "utf8"));
const multiCheckpoint = JSON.parse(await readFile(new URL("fixtures/v0/valid/log-checkpoint.multi-review.json", protocolRoot), "utf8"));
const reviewHeads = [
  { review_id: "review:alpha", head_hash: "00".repeat(32) },
  { review_id: "review:beta", head_hash: "11".repeat(32) },
  { review_id: "review:gamma", head_hash: "22".repeat(32) }
];

assert.deepEqual(computeCheckpoint([]), { merkle_root: emptyCheckpoint.merkle_root, tree_size: 0 });
assert.deepEqual(computeCheckpoint(reviewHeads.slice(0, 1)), { merkle_root: singleCheckpoint.merkle_root, tree_size: 1 });
assert.deepEqual(computeCheckpoint(reviewHeads), { merkle_root: multiCheckpoint.merkle_root, tree_size: 3 });
for (const reviewHead of reviewHeads) {
  const proof = inclusionProof(reviewHead.review_id, reviewHeads);
  assert.deepEqual(
    verifyInclusionProof(reviewHead, proof, multiCheckpoint.merkle_root),
    { verified: true },
    `${reviewHead.review_id} proof must agree across evidence-store and protocol-ts`
  );
}

console.log("transparency remains a projection over unchanged event schemas and shared vectors");

function collectPropertyNames(value, output = new Set()) {
  if (value === null || typeof value !== "object") return output;
  if (value.properties !== null && typeof value.properties === "object" && !Array.isArray(value.properties)) {
    for (const name of Object.keys(value.properties)) output.add(name);
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value)) collectPropertyNames(nested, output);
  return output;
}
