import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { createHttpTransparencyAnchor, createMemoryCheckpointPublicationStore, runTransparencyCheckpoint } = await importCompiled("src/worker/transparency.js");
const { runNormalizeLoop } = await importCompiled("src/worker/main.js");
const { TransparencyAnchorNotConfiguredError, computeCheckpoint } = await importCompiled("../../packages/evidence-store/src/index.js");

const BASE_URL = "https://anchor.example.invalid/codeattest";
const TOKEN = "synthetic-anchor-token";

/** A stub anchor endpoint: PUT stores the body, GET returns it, 404 otherwise. */
function stubAnchorEndpoint() {
  const objects = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method, redirect: init.redirect, authorization: new Headers(init.headers).get("authorization") });
    if (init.method === "PUT") {
      objects.set(url, init.body);
      return new Response(JSON.stringify({ anchor_ref: `anchor:${objects.size}` }), { status: 201 });
    }
    const body = objects.get(url);
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  };
  return { objects, calls, fetchImpl };
}

const HEADS = [
  { review_id: "review:synthetic-demo-0001", head_hash: "a".repeat(64), head_event_id: `sha256:${"1".repeat(64)}` },
  { review_id: "review:synthetic-demo-0002", head_hash: "b".repeat(64), head_event_id: `sha256:${"2".repeat(64)}` }
];

let tick = 0;
const now = () => `2026-10-17T00:0${tick++}:00Z`;

// --- no anchor configured: the run fails closed, loudly --------------------------
await assert.rejects(
  runTransparencyCheckpoint({ anchor: undefined, heads: HEADS, publications: createMemoryCheckpointPublicationStore(), now }),
  TransparencyAnchorNotConfiguredError
);

// --- publish, read back, record ----------------------------------------------------
const endpoint = stubAnchorEndpoint();
const anchor = createHttpTransparencyAnchor({ baseUrl: BASE_URL, token: TOKEN, fetchImpl: endpoint.fetchImpl });
const publications = createMemoryCheckpointPublicationStore();

const first = await runTransparencyCheckpoint({ anchor, heads: HEADS, publications, now });
assert.equal(first.outcome, "published");
assert.equal(first.anchor_ref, "anchor:1");
assert.equal(first.tree_size, 2);
assert.equal(publications.published.length, 1);
assert.equal(publications.published[0].merkle_root, computeCheckpoint(HEADS).merkle_root);
assert.deepEqual(endpoint.calls.map((call) => call.method), ["PUT", "GET"], "a publication is always read back");
assert.ok(endpoint.calls.every((call) => call.authorization === `Bearer ${TOKEN}`));
assert.ok(endpoint.calls.every((call) => call.redirect === "error"), "a request carrying the token never follows a redirect");
assert.equal(endpoint.calls[0].url, `${BASE_URL}/checkpoints/${first.checkpoint_id}`);

// --- same heads: no duplicate publication, but the last one is re-verified --------
const second = await runTransparencyCheckpoint({ anchor, heads: HEADS, publications, now });
assert.deepEqual(second, { outcome: "unchanged", checkpoint_id: first.checkpoint_id, tree_size: 2 });
assert.equal(publications.published.length, 1);
assert.equal(endpoint.calls.at(-1).method, "GET");

// --- a record changed at the anchor is caught on the next run ---------------------
const storedUrl = `${BASE_URL}/checkpoints/${first.checkpoint_id}`;
const tampered = { ...JSON.parse(endpoint.objects.get(storedUrl)), tree_size: 3 };
endpoint.objects.set(storedUrl, JSON.stringify(tampered));
await assert.rejects(runTransparencyCheckpoint({ anchor, heads: HEADS, publications, now }), /no longer verifies at the anchor/);

// --- new heads: a new checkpoint is published ---------------------------------------
const grown = [...HEADS, { review_id: "review:synthetic-demo-0003", head_hash: "c".repeat(64), head_event_id: `sha256:${"3".repeat(64)}` }];
const third = await runTransparencyCheckpoint({ anchor, heads: grown, publications, now });
assert.equal(third.outcome, "published");
assert.equal(third.tree_size, 3);
assert.equal(publications.published.length, 2);

// --- an anchor that accepts the PUT but loses the record is never "published" -----
{
  const forgetful = stubAnchorEndpoint();
  const losing = async (url, init = {}) => (init.method === "PUT" ? forgetful.fetchImpl(url, init) : new Response("", { status: 404 }));
  const store = createMemoryCheckpointPublicationStore();
  await assert.rejects(
    runTransparencyCheckpoint({ anchor: createHttpTransparencyAnchor({ baseUrl: BASE_URL, token: TOKEN, fetchImpl: losing }), heads: HEADS, publications: store, now }),
    /did not read back from the anchor: not_found/
  );
  assert.equal(store.published.length, 0, "nothing is recorded for a publication that did not read back");
}

// --- an anchor that refuses the PUT fails the run -----------------------------------
await assert.rejects(
  runTransparencyCheckpoint({
    anchor: createHttpTransparencyAnchor({ baseUrl: BASE_URL, token: TOKEN, fetchImpl: async () => new Response("", { status: 503 }) }),
    heads: HEADS,
    publications: createMemoryCheckpointPublicationStore(),
    now
  }),
  /refused the checkpoint: HTTP 503/
);

// --- the normalize loop survives a failing pass and stops when asked ----------------
{
  let passes = 0;
  let stop = false;
  const logs = [];
  await runNormalizeLoop({
    pass: async () => {
      passes += 1;
      if (passes === 1) {
        throw new Error("database unavailable");
      }
      if (passes === 3) {
        stop = true;
      }
    },
    sleep: async () => {},
    stopping: () => stop,
    log: (entry) => logs.push(entry)
  });
  assert.equal(passes, 3, "a failing pass is retried on the next tick");
  assert.deepEqual(logs, [{ event: "normalize_pass_failed", error: "database unavailable" }]);
}

console.log("worker transparency test passed.");
