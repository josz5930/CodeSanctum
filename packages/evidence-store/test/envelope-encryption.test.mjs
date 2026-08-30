import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";
import { makeLifecycleEvent } from "./helpers/fixtures.mjs";

const {
  wrapEnvelope,
  unwrapEnvelope,
  isEnvelope,
  isSourceDerivedClass
} = await importCompiled("src/envelope-encryption.js");
const { createMemoryArtifactStore } = await importCompiled("src/memory/artifact-store.js");
const { createMemoryEvidenceLifecycleLogStore } = await importCompiled("src/memory/evidence-lifecycle-log-store.js");
const { createFilesystemObjectStore } = await importCompiled("src/filesystem/object-store.js");
const { createPostgresArtifactStore } = await importCompiled("src/postgres/artifact-store.js");

const KEY_A = {
  keyId: "pilot-object-envelope-v1",
  key: new Uint8Array(32).fill(7)
};
const KEY_B = {
  keyId: "pilot-object-envelope-v1",
  key: new Uint8Array(32).fill(9)
};

const MARKER = "SYNTHETIC_DEMO_DATA PLAINTEXT_SOURCE_MARKER NOT_CUSTOMER_SOURCE";
const PLAINTEXT = new TextEncoder().encode(MARKER);
const DIGEST = "sha256:" + "e".repeat(64);

function sourceClassification() {
  return {
    protocol_version: "codeattest.v0",
    stored_object_ref: "stored_object:synthetic_demo_source",
    object_kind: "evidence_artifact",
    source_derived_class: "transient_source_derived",
    environment_profile: "synthetic_demo"
  };
}

assert.equal(isSourceDerivedClass("transient_source_derived"), true);
assert.equal(isSourceDerivedClass("customer_opt_in_retained_source"), true);
assert.equal(isSourceDerivedClass("retained_review_artifact"), false);

const wrapped = wrapEnvelope(PLAINTEXT, KEY_A);
assert.equal(isEnvelope(wrapped), true);
assert.equal(Buffer.from(wrapped).includes(Buffer.from(MARKER)), false);
const opened = unwrapEnvelope(wrapped, KEY_A);
assert.equal(opened.ok, true);
assert.deepEqual(opened.plaintext, PLAINTEXT);

const wrong = unwrapEnvelope(wrapped, KEY_B);
assert.equal(wrong.ok, false);

{
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const store = createMemoryArtifactStore(lifecycleLog, { envelope: KEY_A });
  const stored = await store.put({
    digest: DIGEST,
    bytes: PLAINTEXT,
    classification: sourceClassification(),
    reviewId: "review:synthetic_demo_enc"
  });
  assert.equal(stored.outcome, "stored");
  const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: "review:synthetic_demo_enc" }) };
  const read = await store.get({ access, digest: DIGEST });
  assert.equal(read.outcome, "read");
  assert.deepEqual(read.bytes, PLAINTEXT);
}

{
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const store = createMemoryArtifactStore(lifecycleLog);
  const stored = await store.put({
    digest: DIGEST,
    bytes: PLAINTEXT,
    classification: sourceClassification(),
    reviewId: "review:synthetic_demo_enc"
  });
  assert.equal(stored.outcome, "encryption_unavailable");
}

{
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const objects = new Map();
  const store = createMemoryArtifactStore(lifecycleLog, { envelope: KEY_A, objectMap: objects });
  await store.put({
    digest: DIGEST,
    bytes: PLAINTEXT,
    classification: sourceClassification(),
    reviewId: "review:synthetic_demo_enc"
  });
  const onDisk = objects.get(DIGEST);
  assert.equal(isEnvelope(onDisk), true);
  assert.equal(Buffer.from(onDisk).includes(Buffer.from(MARKER)), false);
  const wrongReader = createMemoryArtifactStore(lifecycleLog, { envelope: KEY_B, objectMap: objects });
  const access = { decision: "allowed", event: makeLifecycleEvent({ review_id: "review:synthetic_demo_enc", idempotency_key: "evidence:enc-wrong-key" }) };
  const result = await wrongReader.get({ access, digest: DIGEST });
  assert.equal(result.outcome, "decryption_failed");
  assert.equal(result.bytes, undefined);
}

{
  const root = await mkdtemp(path.join(tmpdir(), "onevps-envelope-objects-"));
  const objects = createFilesystemObjectStore(root);
  const lifecycleLog = createMemoryEvidenceLifecycleLogStore();
  const store = createPostgresArtifactStore({
    sql: {
      async query(text) {
        if (text.startsWith("SELECT digest")) return { rows: [] };
        if (text.startsWith("INSERT")) return { rows: [{ digest: DIGEST }] };
        return { rows: [] };
      }
    },
    objects,
    lifecycleLog,
    envelope: KEY_A
  });
  await store.put({
    digest: DIGEST,
    bytes: PLAINTEXT,
    classification: sourceClassification(),
    reviewId: "review:synthetic_demo_enc"
  });
  const storedBytes = await objects.get(DIGEST);
  assert.equal(isEnvelope(storedBytes), true);
  assert.equal(Buffer.from(storedBytes).includes(Buffer.from(MARKER)), false);
  const leftoverTemps = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".tmp")) leftoverTemps.push(full);
      else {
        const bytes = await readFile(full);
        assert.equal(bytes.includes(Buffer.from(MARKER)), false);
      }
    }
  }
  await walk(root);
  assert.deepEqual(leftoverTemps, []);
}

console.log("envelope-encryption test passed.");
