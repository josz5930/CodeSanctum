import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import canonicalizePackage from "canonicalize";

import {
  canonicalize,
  sha256IdFromCanonical
} from "./lib/protocol-utils.mjs";

const decomposed = "é";
const composed = "é";
assert.notEqual(decomposed, composed, "test setup requires distinct Unicode spellings");
assert.equal(canonicalize(decomposed), JSON.stringify(decomposed), "JCS must not normalize Unicode strings");
assert.notEqual(canonicalize(decomposed), canonicalize(composed), "JCS output must preserve original Unicode code points");

const utf16SortInput = {
  "": 1,
  "😀": 2,
  "a": 3
};
const expectedUtf16Sort = '{"a":3,"😀":2,"":1}';
assert.equal(canonicalize(utf16SortInput), expectedUtf16Sort, "object keys must sort by UTF-16 code units per RFC 8785");

const nested = [{ z: 1, a: { y: 2, x: [3, { b: true, a: false }] } }];
assert.equal(canonicalize(nested), canonicalizePackage(nested), "nested object sorting inside arrays must match the npm JCS package");

for (const bad of [NaN, Infinity, -Infinity]) {
  assert.throws(() => canonicalize(bad), /non-finite|Unsupported|NaN|Infinity/i, "non-I-JSON numbers must be rejected");
}

assert.equal(
  sha256IdFromCanonical(utf16SortInput),
  `sha256:${createHash("sha256").update(expectedUtf16Sort, "utf8").digest("hex")}`,
  "sha256 id must hash canonical UTF-8 bytes from the library-backed JCS output"
);
