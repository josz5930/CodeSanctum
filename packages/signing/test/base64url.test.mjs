import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-signing-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "signing-base64url-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const { encodeBase64Url, decodeBase64Url } = await import(pathToFileURL(path.join(outDir, "packages", "signing", "src", "base64url.js")).href);

  for (const length of [0, 1, 2, 3, 1952, 3309]) {
    const bytes = new Uint8Array(length).fill(0xa5);
    const encoded = encodeBase64Url(bytes);
    assert(!encoded.includes("="), `base64url must never pad (length ${length})`);
    assert(/^[A-Za-z0-9_-]*$/.test(encoded), `base64url must stay url-safe (length ${length})`);
    const decoded = decodeBase64Url(encoded);
    assert(decoded !== undefined && Buffer.from(decoded).equals(Buffer.from(bytes)), `base64url must round trip (length ${length})`);
  }

  assert(encodeBase64Url(new Uint8Array(3309)).length === 4412, "a signature must encode to exactly 4412 characters");
  assert(encodeBase64Url(new Uint8Array(1952)).length === 2603, "a public key must encode to exactly 2603 characters");

  assert(decodeBase64Url("A+/B") === undefined, "standard-base64 characters must be rejected");
  assert(decodeBase64Url("AAA=") === undefined, "padding must be rejected");
  assert(decodeBase64Url("A") === undefined, "a lone character cannot encode a whole byte");

  console.log("base64url test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
