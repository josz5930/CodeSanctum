import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const vectorsPath = path.join(repoRoot, "protocol", "fixtures", "v0", "support", "ml-dsa-65-test-vectors.json");
const vectors = JSON.parse(await readFile(vectorsPath, "utf8"));
const testPublicKey = vectors.test_public_key_base64url;

assert(typeof testPublicKey === "string" && testPublicKey.length === 2603, "the committed test public key must be present");

const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-signing-published-test-key-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "signing-published-test-key-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const { decodeBase64Url } = await import(
    pathToFileURL(path.join(outDir, "packages", "signing", "src", "base64url.js")).href
  );

  const testPublicKeyBytes = decodeBase64Url(testPublicKey);
  assert(testPublicKeyBytes !== undefined, "the committed test public key must be valid base64url");

  // The published seed is a test vector, exactly as an RFC publishes one. A
  // directory that marks its derived key `active` would make the published
  // private key a trusted signer, so that combination is forbidden outright.
  // This scans both valid/ and invalid/ fixtures: a fixture can be "invalid"
  // for an unrelated reason (a bad enum, a bad timestamp) while still embedding
  // a well-formed, currently-active key record for the published key.
  //
  // Keys are compared by decoded bytes, not by raw base64url string: a
  // lenient base64url decoder (Rust's, historically) can accept more than
  // one string representation for the same bytes, so a string-only
  // comparison here could miss a directory embedding the published key under
  // a differently-encoded (but byte-identical) representation.
  const fixtureDirs = [
    path.join(repoRoot, "protocol", "fixtures", "v0", "valid"),
    path.join(repoRoot, "protocol", "fixtures", "v0", "invalid")
  ];
  for (const dir of fixtureDirs) {
    for (const name of await readdir(dir)) {
      if (!name.startsWith("signing-key-directory")) continue;
      const directory = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      for (const key of directory.keys ?? []) {
        const keyBytes = typeof key.public_key === "string" ? decodeBase64Url(key.public_key) : undefined;
        const isPublishedKey = keyBytes !== undefined && Buffer.from(keyBytes).equals(Buffer.from(testPublicKeyBytes));
        assert(
          !(isPublishedKey && key.status === "active"),
          `${name} marks the published test key active; the published seed must never be a trusted signer`
        );
      }
    }
  }

  console.log("Published test key guard passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
