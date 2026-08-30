#!/usr/bin/env node
// Regenerates the Node half of protocol/fixtures/v0/support/ml-dsa-65-test-vectors.json.
//
// Node's ML-DSA signing is randomized and offers no deterministic mode, so this
// vector cannot be re-derived by a test the way the Rust vectors can. It is
// generated once here and committed as a static fixture that the Rust side
// verifies. Re-run this only when `canonical_input` changes, then commit the
// updated fixture and its new hash in canonical-manifest.json.
//
// Usage: node scripts/generate-ml-dsa-test-vectors.mjs
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const signingWorkspace = path.join(repoRoot, "packages", "signing");
const vectorsPath = path.join(repoRoot, "protocol", "fixtures", "v0", "support", "ml-dsa-65-test-vectors.json");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-vector-gen-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "signing-vector-gen-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
  ], { cwd: signingWorkspace, stdio: "pipe" });

  const srcDir = path.join(outDir, "packages", "signing", "src");
  const { encodeBase64Url } = await import(pathToFileURL(path.join(srcDir, "base64url.js")).href);
  const { generateMlDsa65KeyPair, signMlDsa65 } = await import(pathToFileURL(path.join(srcDir, "ml-dsa.js")).href);
  const { signedMessage } = await import(pathToFileURL(path.join(srcDir, "signed-message.js")).href);

  const vectors = JSON.parse(await readFile(vectorsPath, "utf8"));
  const canonicalInput = vectors.rust_deterministic_vectors[0].canonical_input;
  const { publicKey, privateKeyPkcs8 } = generateMlDsa65KeyPair();
  const signature = signMlDsa65(privateKeyPkcs8, signedMessage(canonicalInput));

  vectors.node_randomized_vector = {
    public_key_base64url: encodeBase64Url(publicKey),
    canonical_input: canonicalInput,
    signature_base64url: encodeBase64Url(signature)
  };

  await writeFile(vectorsPath, `${JSON.stringify(vectors, null, 2)}\n`, "utf8");
  console.log(`Wrote node_randomized_vector to ${path.relative(repoRoot, vectorsPath)}.`);
  console.log("Now update the sha256 for this file in protocol/fixtures/canonical-manifest.json and commit both.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}
