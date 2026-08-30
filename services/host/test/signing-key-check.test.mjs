import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";
import { importCompiled as importSigning } from "../../../packages/signing/test/helpers/compile.mjs";
import { directory, keyRecord, TEST_LIMITATIONS } from "../../../packages/signing/test/helpers/test-directory.mjs";

const { checkSigningKey } = await importCompiled("src/signing-key-check.js");
const { generateMlDsa65KeyPair, encodeBase64Url, signIdentityEnvelope, keyDirectorySigningInput } = await importSigning("src/index.js");

const anchor = generateMlDsa65KeyPair();
const signer = generateMlDsa65KeyPair();

function signedDirectory(records) {
  const shell = directory(records);
  shell.directory_signature = signIdentityEnvelope({
    signing_input: keyDirectorySigningInput(shell),
    key: { key_id: "codeattest-demo-trust-anchor", key_version: "v1", privateKeyPkcs8: anchor.privateKeyPkcs8 },
    signing_time: "2026-01-01T00:00:00Z",
    signing_mode: "managed_key",
    signing_limitations: [...TEST_LIMITATIONS]
  });
  return shell;
}

const credentialsDirectory = await mkdtemp(path.join(tmpdir(), "onevps-host-credentials-"));
await writeFile(path.join(credentialsDirectory, "signing-key"), Buffer.from(signer.privateKeyPkcs8));
await chmod(path.join(credentialsDirectory, "signing-key"), 0o600);

const config = (overrides = {}) => ({
  signing: {
    key_directory_path: "unused-in-this-test",
    trust_anchor_public_key: encodeBase64Url(anchor.publicKey),
    key_id: "codeattest-demo-signing-key",
    key_version: "v1",
    credential_name: "signing-key",
    ...overrides
  }
});

const readJson = (value) => async () => JSON.stringify(value);

// The happy path returns a usable handle bound to the directory record.
{
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.key.key_id, "codeattest-demo-signing-key");
  assert.equal(result.key.key_version, "v1");
  assert.deepEqual(result.key.privateKeyPkcs8, signer.privateKeyPkcs8);
}

// A directory the configured anchor did not sign is fatal.
{
  const impostor = generateMlDsa65KeyPair();
  const result = await checkSigningKey({
    config: config({ trust_anchor_public_key: encodeBase64Url(impostor.publicKey) }),
    credentialsDirectory,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_directory_untrusted" });
}

// An unreadable or unparseable directory is fatal, not empty.
{
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory,
    readKeyDirectory: async () => { throw new Error("ENOENT"); },
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_directory_unreadable" });
}

// This is the check that matters: the credential must derive the public key
// the directory advertises. A host holding a key the directory does not vouch
// for would sign artifacts no verifier can ever trust.
{
  const stranger = generateMlDsa65KeyPair();
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(stranger.publicKey) })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_public_key_mismatch" });
}

// A retired or revoked key may not be the deployment's signing key.
for (const status of ["retired", "revoked"]) {
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey), status })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_not_active_in_directory" }, `${status} must not boot`);
}

// A key whose window has closed may not sign, even while marked active.
{
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey), valid_until: "2026-02-01T00:00:00Z" })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_not_active_in_directory" });
}

// No credential means no boot. There is no degraded mode.
{
  const result = await checkSigningKey({
    config: config(),
    credentialsDirectory: undefined,
    readKeyDirectory: readJson(signedDirectory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })])),
    now: () => "2026-06-01T00:00:00Z"
  });
  assert.deepEqual(result, { ok: false, reason: "signing_key_credential_directory_missing" });
}

console.log("signing-key-check test passed.");
