import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";

const { loadSigningCredential, generateMlDsa65KeyPair } = await importCompiled("src/index.js");

const pair = generateMlDsa65KeyPair();
const dir = await mkdtemp(path.join(tmpdir(), "onevps-credentials-"));
const credentialPath = path.join(dir, "signing-key");
await writeFile(credentialPath, Buffer.from(pair.privateKeyPkcs8));
await chmod(credentialPath, 0o600);

// The happy path derives the public key, which is what boot compares against
// the directory record.
const loaded = await loadSigningCredential({ credentialsDirectory: dir, credentialName: "signing-key" });
assert.equal(loaded.ok, true);
assert.deepEqual(loaded.publicKey, pair.publicKey);
assert.deepEqual(loaded.privateKeyPkcs8, pair.privateKeyPkcs8);

// No $CREDENTIALS_DIRECTORY at all means systemd did not pass the credential.
assert.deepEqual(
  await loadSigningCredential({ credentialsDirectory: undefined, credentialName: "signing-key" }),
  { ok: false, reason: "credential_directory_missing" }
);

// A named credential that is not there fails closed rather than falling back.
assert.deepEqual(
  await loadSigningCredential({ credentialsDirectory: dir, credentialName: "other-key" }),
  { ok: false, reason: "credential_missing" }
);

// Anything readable beyond the owner is refused: systemd's credential tmpfs
// is per-unit and 0400, so a wider mode means it did not come from systemd.
const loose = path.join(dir, "loose-key");
await writeFile(loose, Buffer.from(pair.privateKeyPkcs8));
await chmod(loose, 0o644);
assert.deepEqual(
  await loadSigningCredential({ credentialsDirectory: dir, credentialName: "loose-key" }),
  { ok: false, reason: "credential_readable_by_others" }
);

// Bytes that are not an ML-DSA-65 PKCS#8 key are malformed, not a throw.
const junk = path.join(dir, "junk-key");
await writeFile(junk, Buffer.from([0, 1, 2, 3]));
await chmod(junk, 0o600);
assert.deepEqual(
  await loadSigningCredential({ credentialsDirectory: dir, credentialName: "junk-key" }),
  { ok: false, reason: "credential_malformed" }
);

console.log("custody test passed.");
