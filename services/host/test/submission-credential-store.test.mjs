import assert from "node:assert/strict";
import { scryptSync, randomBytes } from "node:crypto";

import { compileWorkspace as compileIdentity } from "../../../packages/identity-store/test/helpers/compile.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { createMemorySubmissionCredentialStore } = await compileIdentity("memory/submission-credential-store.js");
const { verifyCredentialSecret } = await importCompiled("src/submission/credential-store.js");

const SECRET = "synthetic-demo-submission-secret";
const salt = randomBytes(16).toString("hex");
const hash = `scrypt$32768$8$1$${salt}$${scryptSync(SECRET, Buffer.from(salt, "hex"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("hex")}`;
const t1 = new Date("2026-08-16T12:00:00Z");

const store = createMemorySubmissionCredentialStore();
await store.issue({
  token_key_id: "demo-runner-key-1",
  review_id: "review:synthetic-demo-0001",
  tenant_id: "tenant-synthetic-demo",
  customer_id: "customer-synthetic-demo",
  selected_application_id: "app-synthetic-demo",
  selected_commit: "a".repeat(40),
  repository_identity_hash: `sha256:${"b".repeat(64)}`,
  expected_manifest_id: `sha256:${"c".repeat(64)}`,
  secret_hash: hash,
  issued_at: t1,
  expires_at: new Date(t1.getTime() + 30 * 24 * 60 * 60 * 1000)
});

const found = await store.resolve("demo-runner-key-1", t1);
assert.ok(found, "an issued key id must resolve");
assert.equal(found.review_id, "review:synthetic-demo-0001");

assert.equal(await store.resolve("no-such-key", t1), undefined, "an unknown key id must resolve to undefined");

assert.equal(verifyCredentialSecret(found, SECRET), true, "the correct secret must verify");
assert.equal(verifyCredentialSecret(found, "wrong"), false, "an incorrect secret must not verify");
assert.equal(verifyCredentialSecret(found, ""), false, "an empty secret must not verify");
assert.equal(verifyCredentialSecret({ ...found, secret_hash: "not-a-hash" }, SECRET), false, "a malformed stored hash must not verify");

console.log("Submission credential store test passed.");
