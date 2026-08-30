// C6-01/C6-25: snapshotJsonData must catch every reflection failure (revoked
// Proxy, throwing trap, changing trap) rather than throwing, must reject
// sparse/extra-numeric-property arrays, and must return a frozen, immutable
// value so validation and later render/consume steps can never observe two
// different states of the same input.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const { snapshotJsonData } = await import(pathToFileURL(path.join(outDir, "json-snapshot.js")).href);

  // Valid JSON-shaped input snapshots successfully and stays deeply equal.
  const valid = { a: 1, b: [1, 2, "three", null, true], c: { nested: "value" } };
  const validResult = snapshotJsonData(valid);
  assert.equal(validResult.ok, true, "plain JSON-shaped object must snapshot");
  assert.equal(JSON.stringify(validResult.value), JSON.stringify(valid), "snapshot must be structurally equal to the valid input");
  assert.throws(() => { validResult.value.a = 2; }, "snapshot object must be frozen");
  assert.throws(() => { validResult.value.b.push(1); }, "snapshot array must be frozen");
  assert.equal(Object.getPrototypeOf(validResult.value), null, "snapshot object must be null-prototype");

  // A revoked Proxy throws on every trap; the scan must not throw.
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.doesNotThrow(() => snapshotJsonData(revoked), "a revoked Proxy must not make the scan throw");
  assert.equal(snapshotJsonData(revoked).ok, false, "a revoked Proxy must be rejected");

  // A Proxy whose trap throws on every access must not make the scan throw.
  const throwingProxy = new Proxy({}, {
    ownKeys() { throw new Error("boom"); }
  });
  assert.doesNotThrow(() => snapshotJsonData(throwingProxy), "a throwing ownKeys trap must not make the scan throw");
  assert.equal(snapshotJsonData(throwingProxy).ok, false, "a throwing-trap Proxy must be rejected");

  // The snapshot is a copy taken at scan time, not a live view: mutating the
  // backing object (directly, or via a Proxy whose behavior changes on later
  // access) after the scan must never be observable through the returned
  // value — closing the "benign during validation, different during later
  // render/consume" hazard this helper exists to prevent.
  const statefulTarget = { field: "benign" };
  const statefulResult = snapshotJsonData(statefulTarget);
  assert.equal(statefulResult.ok, true, "a well-behaved-shaped object scans successfully");
  assert.equal(statefulResult.value.field, "benign", "the snapshot must capture the value observed during the scan");
  statefulTarget.field = "mutated-after-snapshot";
  assert.equal(statefulResult.value.field, "benign", "the frozen snapshot must never reflect changes made after it was produced");

  // Extra numeric-looking non-index array properties must not be silently
  // dropped from consideration (C6-25): a dense-array check with an exact
  // key-count comparison rejects them instead of skipping the extra key.
  const sparse = [1, 2, 3];
  Object.defineProperty(sparse, "4294967295", { value: "hidden", enumerable: true, configurable: true });
  assert.equal(snapshotJsonData(sparse).ok, false, "a non-index numeric-looking property must be rejected, not silently ignored");

  const trueSparse = [1, 2, 3];
  delete trueSparse[1];
  assert.equal(snapshotJsonData(trueSparse).ok, false, "a sparse array must be rejected");

  // Cyclic references are rejected rather than infinite-looping.
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(snapshotJsonData(cyclic).ok, false, "a cyclic object must be rejected");

  // Accessor (getter/setter) properties are rejected, not silently invoked.
  const withAccessor = {};
  Object.defineProperty(withAccessor, "danger", { get() { return "computed"; }, enumerable: true, configurable: true });
  assert.equal(snapshotJsonData(withAccessor).ok, false, "an accessor property must be rejected");

  // Symbol keys are rejected.
  const withSymbol = { [Symbol("s")]: "x", ok: "value" };
  assert.equal(snapshotJsonData(withSymbol).ok, false, "a symbol-keyed object must be rejected");

  // Payload-field detection still works over the snapshot.
  const withPayload = { raw_text: "sensitive" };
  const payloadResult = snapshotJsonData(withPayload);
  assert.equal(payloadResult.ok, true);
  assert.equal(payloadResult.payloadFieldPresent, true, "a known payload-shaped key must be flagged");

  console.log("protocol-ts snapshotJsonData tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
