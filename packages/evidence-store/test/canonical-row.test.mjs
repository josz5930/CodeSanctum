import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { toCanonicalRow, fromCanonicalRow, canonicalRowDigestMatches } = await importCompiled("src/canonical-row.js");

// Key order in the input must not survive into the stored body: JCS sorts by
// UTF-16 code unit, so the stored bytes are canonical regardless of input order.
const unordered = { zeta: 1, alpha: 2, mid: 3 };
const row = toCanonicalRow(unordered);
assert.equal(row.body, '{"alpha":2,"mid":3,"zeta":1}');
assert.match(row.digest, /^sha256:[a-f0-9]{64}$/);

// Round-trip: parsing the body and re-canonicalizing reproduces identical bytes
// and an identical digest. This is the property the text-not-jsonb rule protects.
const reparsed = fromCanonicalRow(row.body);
assert.equal(toCanonicalRow(reparsed).body, row.body);
assert.equal(toCanonicalRow(reparsed).digest, row.digest);
assert.equal(canonicalRowDigestMatches(row), true);

// A body that has been tampered with no longer matches its recorded digest.
assert.equal(canonicalRowDigestMatches({ body: '{"alpha":9}', digest: row.digest }), false);

// Two inputs differing only in key order are the same stored row.
assert.equal(toCanonicalRow({ mid: 3, zeta: 1, alpha: 2 }).digest, row.digest);

console.log("canonical-row test passed.");
