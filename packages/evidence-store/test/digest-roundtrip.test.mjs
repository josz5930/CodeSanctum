import assert from "node:assert/strict";

import { postgresAvailable, withPostgres } from "./helpers/postgres-harness.mjs";
import { makeReviewEvent } from "./helpers/fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { toCanonicalRow, canonicalRowDigestMatches } = await importCompiled("src/canonical-row.js");
const { createPostgresReviewEventLogStore } = await importCompiled("src/postgres/review-event-log-store.js");

if (!(await postgresAvailable())) {
  console.log("digest-roundtrip test skipped: no database reachable.");
  process.exit(0);
}

await withPostgres(async ({ appPool }) => {
  const store = createPostgresReviewEventLogStore(appPool);
  const reviewId = "review:synthetic_demo_roundtrip";

  // Deliberately awkward input: unsorted keys, a nested object, and a number
  // that jsonb would renormalize.
  const event = makeReviewEvent({
    review_id: reviewId,
    sequence_number: 7,
    idempotency_key: "roundtrip:1"
  });
  const expected = toCanonicalRow(event);

  await store.append(reviewId, event);

  // Read the raw stored bytes, not the parsed object: the text column must hold
  // byte-identical canonical JSON.
  const { rows } = await appPool.query(
    "SELECT body, event_id FROM review_event WHERE review_id = $1 AND sequence_number = 7",
    [reviewId]
  );
  assert.equal(rows[0].body, expected.body, "stored bytes must be byte-identical canonical JSON");
  assert.equal(rows[0].event_id, expected.digest, "stored digest must match the canonical identity");
  assert.equal(canonicalRowDigestMatches({ body: rows[0].body, digest: rows[0].event_id }), true);

  // The generated jsonb column is for indexing only. Prove it is NOT usable for
  // reconstruction, so nobody is tempted to read from it later.
  const viaJsonb = await appPool.query(
    "SELECT body_query::text AS reconstructed FROM review_event WHERE review_id = $1 AND sequence_number = 7",
    [reviewId]
  );
  assert.notEqual(
    viaJsonb.rows[0].reconstructed,
    expected.body,
    "jsonb reconstruction must differ from canonical bytes; if this ever passes, the storage decision needs revisiting"
  );

  // Every row in the table round-trips to its recorded identity.
  const all = await appPool.query("SELECT body, event_id FROM review_event");
  for (const row of all.rows) {
    assert.equal(
      canonicalRowDigestMatches({ body: row.body, digest: row.event_id }),
      true,
      `row ${row.event_id} failed digest round-trip`
    );
  }

  console.log("digest-roundtrip test passed.");
});
