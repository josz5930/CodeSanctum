import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const vectors = JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "support", "ml-dsa-65-test-vectors.json"), "utf8"));
const publishedKey = vectors.test_public_key_base64url;

async function* jsonFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "target") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(full);
    else if (entry.name.endsWith(".json")) yield full;
  }
}

let checked = 0;
for await (const file of jsonFiles(repoRoot)) {
  const text = await readFile(file, "utf8");
  if (!text.includes(publishedKey)) continue;
  checked += 1;
  const parsed = JSON.parse(text);
  const records = Array.isArray(parsed?.keys) ? parsed.keys : [parsed];
  for (const record of records) {
    if (record?.public_key !== publishedKey) continue;
    assert.notEqual(record.status, "active", `${file} makes the published test key an active signing key`);
  }
  // A host config must never name it as the trust anchor either.
  assert.notEqual(parsed?.signing?.trust_anchor_public_key, publishedKey, `${file} trusts the published test key as an anchor`);
}

assert.ok(checked > 0, "the published test key must appear in at least one fixture, or this guard is checking nothing");
console.log(`no-active-test-key guard passed over ${checked} files.`);
