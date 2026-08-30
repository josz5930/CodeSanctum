import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { verifiedOutcome } from "../../../packages/protocol-ts/test/helpers/real-signature.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { createMemoryReviewRecordStore } = await importCompiled("src/web/record-store.js");
const { seedSyntheticDemoReviewRecords, SYNTHETIC_DEMO_REVIEW_SCOPE } = await importCompiled("src/web/seed-record-store.js");

const fixturesRoot = fileURLToPath(new URL("../../../protocol/fixtures/v0", import.meta.url));

// A verifier standing in for a trusted key directory: it produces a genuine
// "verified" outcome bound to the envelope it is handed.
const trustedVerifier = {
  directoryTrusted: true,
  verify: ({ envelope, verified_at }) => verifiedOutcome(envelope, { verified_at })
};

// A verifier for an untrusted directory: exactly what the host's real verifier
// returns in a deployment that does not trust the shipped fixture key.
const untrustedVerifier = {
  directoryTrusted: false,
  verify: ({ envelope, verified_at }) => verifiedOutcome(envelope, { verified_at, result: "signature_key_directory_untrusted" })
};

// A trusted verifier seeds the full record set, including the static bundle with
// a real "verified" outcome bound to the shipped signature envelope.
{
  const store = createMemoryReviewRecordStore();
  seedSyntheticDemoReviewRecords(store, { fixturesRoot, verifier: trustedVerifier, verifiedAt: "2026-08-16T00:00:00Z" });
  const records = await store.get(SYNTHETIC_DEMO_REVIEW_SCOPE);
  assert.ok(records !== undefined, "the demo review scope is seeded");
  assert.ok(records.vendorReceipt !== undefined, "vendor receipt is seeded");
  assert.ok(Array.isArray(records.findingRecords) && records.findingRecords.length === 1, "one finding record is seeded");
  assert.ok(records.verificationPassScope !== undefined, "verification pass scope is seeded");
  assert.ok(records.attestation !== undefined, "attestation is seeded");
  assert.ok(records.attestationFinalization !== undefined, "finalization context is seeded");
  assert.ok(records.supportingEvidenceMapping !== undefined, "supporting evidence mapping is seeded");
  assert.ok(records.staticBundle !== undefined, "static bundle is seeded when the signature verifies");
  assert.equal(records.staticBundle.signatureOutcome.result, "verified");
  // The outcome must be bound to the seeded signature envelope, not fabricated
  // from unrelated identity fields.
  assert.equal(records.staticBundle.signatureOutcome.signed_identity, records.staticBundle.signature.signed_identity);
  assert.equal(records.staticBundle.signatureOutcome.key_id, records.staticBundle.signature.key_id);
}

// An untrusted directory fail-closes the static-bundle sub-view only: the seed
// never asserts a verification that did not happen, but the rest of the record
// set — detail, findings, and attestation content — is still served.
{
  const store = createMemoryReviewRecordStore();
  seedSyntheticDemoReviewRecords(store, { fixturesRoot, verifier: untrustedVerifier, verifiedAt: "2026-08-16T00:00:00Z" });
  const records = await store.get(SYNTHETIC_DEMO_REVIEW_SCOPE);
  assert.ok(records !== undefined);
  assert.equal(records.staticBundle, undefined, "an untrusted signature is not seeded as verified");
  assert.ok(records.vendorReceipt !== undefined, "vendor receipt still served");
  assert.ok(records.attestation !== undefined, "attestation still served");
  assert.ok(Array.isArray(records.findingRecords) && records.findingRecords.length === 1, "findings still served");
}

// Restart durability: the store is in-memory, but re-seeding a fresh store from
// the same fixtures reproduces identical content, so a host restart serves the
// same review.
{
  const first = createMemoryReviewRecordStore();
  const second = createMemoryReviewRecordStore();
  seedSyntheticDemoReviewRecords(first, { fixturesRoot, verifier: trustedVerifier, verifiedAt: "2026-08-16T00:00:00Z" });
  seedSyntheticDemoReviewRecords(second, { fixturesRoot, verifier: trustedVerifier, verifiedAt: "2026-08-16T00:00:00Z" });
  assert.deepEqual(await second.get(SYNTHETIC_DEMO_REVIEW_SCOPE), await first.get(SYNTHETIC_DEMO_REVIEW_SCOPE));
}

console.log("seed-record-store test passed.");
