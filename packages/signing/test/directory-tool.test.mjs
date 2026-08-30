import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { importCompiled } from "./helpers/compile.mjs";
import { directory, keyRecord } from "./helpers/test-directory.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const { generateMlDsa65KeyPair, encodeBase64Url, verifyKeyDirectory } = await importCompiled("src/index.js");

const anchor = generateMlDsa65KeyPair();
const signer = generateMlDsa65KeyPair();

const work = await mkdtemp(path.join(tmpdir(), "onevps-directory-tool-"));
const anchorKeyPath = path.join(work, "anchor.pkcs8.der");
await writeFile(anchorKeyPath, Buffer.from(anchor.privateKeyPkcs8));
await chmod(anchorKeyPath, 0o600);

const unsigned = directory([keyRecord({ public_key: encodeBase64Url(signer.publicKey) })]);
delete unsigned.directory_signature;
const inputPath = path.join(work, "directory.json");
const outputPath = path.join(work, "directory.signed.json");
await writeFile(inputPath, `${JSON.stringify(unsigned, null, 2)}\n`);

execFileSync("node", [
  path.join(repoRoot, "scripts", "sign-key-directory.mjs"),
  "--directory", inputPath,
  "--anchor-key", anchorKeyPath,
  "--anchor-key-id", "codeattest-demo-trust-anchor",
  "--anchor-key-version", "v1",
  "--signing-time", "2026-01-01T00:00:00Z",
  "--out", outputPath
], { stdio: "inherit" });

const signed = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(verifyKeyDirectory(signed, anchor.publicKey), true, "the tool's output must verify against the anchor public key");

// Tampering with any key record breaks the anchor signature, which is the
// only property that makes the directory worth pinning.
const tampered = { ...signed, keys: [{ ...signed.keys[0], key_version: "v2" }] };
assert.equal(verifyKeyDirectory(tampered, anchor.publicKey), false);

// A directory that already carries a signature is refused rather than
// re-signed: re-signing in place is how a version silently gets two histories.
let refused = false;
try {
  execFileSync("node", [
    path.join(repoRoot, "scripts", "sign-key-directory.mjs"),
    "--directory", outputPath,
    "--anchor-key", anchorKeyPath,
    "--anchor-key-id", "codeattest-demo-trust-anchor",
    "--anchor-key-version", "v1",
    "--signing-time", "2026-01-01T00:00:00Z",
    "--out", path.join(work, "again.json")
  ], { stdio: "pipe" });
} catch {
  refused = true;
}
assert.equal(refused, true, "an already-signed directory must be refused");

console.log("directory-tool test passed.");
