import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-signing-mldsa-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "signing-ml-dsa-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const srcDir = path.join(outDir, "packages", "signing", "src");
  const { generateMlDsa65KeyPair, signMlDsa65, verifyMlDsa65, ML_DSA_65_SIGNATURE_BYTES, ML_DSA_65_PUBLIC_KEY_BYTES } =
    await import(pathToFileURL(path.join(srcDir, "ml-dsa.js")).href);
  const { signedMessage, signedMessageForSigningInput, SIGNED_MESSAGE_DOMAIN } =
    await import(pathToFileURL(path.join(srcDir, "signed-message.js")).href);

  const { publicKey, privateKeyPkcs8 } = generateMlDsa65KeyPair();
  assert(publicKey.length === ML_DSA_65_PUBLIC_KEY_BYTES, "a raw ML-DSA-65 public key is 1952 bytes");

  const message = signedMessage("{\"a\":1}");
  const signature = signMlDsa65(privateKeyPkcs8, message);
  assert(signature.length === ML_DSA_65_SIGNATURE_BYTES, "an ML-DSA-65 signature is 3309 bytes");
  assert(verifyMlDsa65(publicKey, message, signature), "a fresh signature must verify");

  assert(!verifyMlDsa65(publicKey, signedMessage("{\"a\":2}"), signature), "a different message must not verify");
  const other = generateMlDsa65KeyPair();
  assert(!verifyMlDsa65(other.publicKey, message, signature), "a different key must not verify");
  const tampered = Uint8Array.from(signature);
  tampered[0] ^= 0x01;
  assert(!verifyMlDsa65(publicKey, message, tampered), "a flipped bit must not verify");
  assert(!verifyMlDsa65(publicKey.slice(0, 10), message, signature), "a wrong-length key must be rejected, not throw");
  assert(!verifyMlDsa65(publicKey, message, signature.slice(0, 10)), "a wrong-length signature must be rejected, not throw");

  // Node's ML-DSA signing is randomized and exposes no deterministic mode.
  // This is asserted so a future Node change that makes it deterministic is
  // noticed here rather than silently invalidating the fixture strategy.
  const again = signMlDsa65(privateKeyPkcs8, message);
  assert(!Buffer.from(again).equals(Buffer.from(signature)), "Node ML-DSA signing is expected to be randomized");

  const signingInput = {
    protocol_version: "codeattest.v0",
    signing_input_type: "vendor_receipt_identity",
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: "vendor_receipt",
    signed_identity: `sha256:${"a".repeat(64)}`,
    canonicalization: "rfc8785",
    identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
  };
  const inputMessage = Buffer.from(signedMessageForSigningInput(signingInput)).toString("utf8");
  assert(inputMessage.startsWith(`${SIGNED_MESSAGE_DOMAIN}\n{`), "the signed message must be domain-separated canonical JSON");
  assert(inputMessage.includes("\"algorithm_profile\":\"ml_dsa_65\""), "the signed message must carry the canonical signing input");

  console.log("ML-DSA sign/verify test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
