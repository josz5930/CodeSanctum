import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-signing-cross-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "signing-cross-test-dist");
const vectorsPath = path.join(repoRoot, "protocol", "fixtures", "v0", "support", "ml-dsa-65-test-vectors.json");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const srcDir = path.join(outDir, "packages", "signing", "src");
  const { decodeBase64Url } = await import(pathToFileURL(path.join(srcDir, "base64url.js")).href);
  const { verifyMlDsa65 } = await import(pathToFileURL(path.join(srcDir, "ml-dsa.js")).href);
  const { signedMessage } = await import(pathToFileURL(path.join(srcDir, "signed-message.js")).href);

  const vectors = JSON.parse(await readFile(vectorsPath, "utf8"));
  const publicKey = decodeBase64Url(vectors.test_public_key_base64url);
  assert(publicKey !== undefined, "the committed public key must decode");

  assert(vectors.rust_deterministic_vectors.length > 0, "at least one Rust vector is required");
  for (const vector of vectors.rust_deterministic_vectors) {
    const signature = decodeBase64Url(vector.signature_base64url);
    assert(signature !== undefined, `vector for ${vector.canonical_input} must decode`);
    assert(
      verifyMlDsa65(publicKey, signedMessage(vector.canonical_input), signature),
      `TypeScript must verify the Rust-produced signature for ${vector.canonical_input}`
    );
    assert(
      !verifyMlDsa65(publicKey, signedMessage(`${vector.canonical_input} `), signature),
      `a Rust-produced signature must not verify against altered bytes for ${vector.canonical_input}`
    );
  }

  const nodeVector = vectors.node_randomized_vector;
  assert(nodeVector !== null && nodeVector !== undefined, "the Node-produced vector must be committed for the Rust side to verify");
  const nodeKey = decodeBase64Url(nodeVector.public_key_base64url);
  const nodeSignature = decodeBase64Url(nodeVector.signature_base64url);
  assert(nodeKey !== undefined && nodeSignature !== undefined, "the Node vector must decode");
  assert(
    verifyMlDsa65(nodeKey, signedMessage(nodeVector.canonical_input), nodeSignature),
    "the committed Node vector must still verify in Node"
  );

  console.log("Cross-implementation verification test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
