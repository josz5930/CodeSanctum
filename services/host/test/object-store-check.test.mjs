import assert from "node:assert/strict";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";

const { verifyObjectStore, backingLooksEncrypted } = await importCompiled("src/object-store-check.js");

const encryptedProbe = async () => ({ encrypted: true, detail: "/dev/mapper/codeattest-pilot-crypt ext4" });

// Root exists, writable, and declared/expected encryption agree.
{
  const root = await mkdtemp(path.join(tmpdir(), "onevps-object-store-check-"));
  const result = await verifyObjectStore({
    root,
    declaredEncrypted: true,
    gateExpectsEncrypted: true,
    probeEncryptedBacking: encryptedProbe
  });
  assert.deepEqual(result, { ok: true });
}

// Root does not exist.
{
  const result = await verifyObjectStore({
    root: path.join(tmpdir(), "onevps-object-store-check-does-not-exist"),
    declaredEncrypted: true,
    gateExpectsEncrypted: true,
    probeEncryptedBacking: encryptedProbe
  });
  assert.equal(result.ok, false);
}

// Root exists but is not writable.
{
  const root = await mkdtemp(path.join(tmpdir(), "onevps-object-store-check-"));
  await chmod(root, 0o500);
  try {
    const result = await verifyObjectStore({
      root,
      declaredEncrypted: true,
      gateExpectsEncrypted: true,
      probeEncryptedBacking: encryptedProbe
    });
    assert.equal(result.ok, false);
  } finally {
    await chmod(root, 0o700);
  }
}

// Gate claims encryption-at-rest readiness but the operator declared the
// volume unencrypted: must not boot (design doc section 5.6, step 4).
{
  const root = await mkdtemp(path.join(tmpdir(), "onevps-object-store-check-"));
  const result = await verifyObjectStore({ root, declaredEncrypted: false, gateExpectsEncrypted: true });
  assert.equal(result.ok, false);
}

assert.equal(backingLooksEncrypted("/dev/mapper/codeattest-pilot-crypt ext4 rw,relatime"), true);
assert.equal(backingLooksEncrypted("/dev/sda1 ext4 rw,relatime"), false);

{
  const root = await mkdtemp(path.join(tmpdir(), "onevps-object-store-check-"));
  const result = await verifyObjectStore({
    root,
    declaredEncrypted: true,
    gateExpectsEncrypted: true,
    probeEncryptedBacking: async () => ({ encrypted: false, detail: "/dev/sda1 ext4" })
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not encrypted/);
}

console.log("object-store-check test passed.");
