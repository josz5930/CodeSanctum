import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSigningWorkspace } from "./lib/load-signing-workspace.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function argument(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    if (!required) return undefined;
    throw new Error(`missing required argument --${name}`);
  }
  return process.argv[index + 1];
}

function git(sourceRoot, args) {
  return execFileSync("git", ["-C", sourceRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function main() {
  const sourceRoot = path.resolve(argument("source-root", false) ?? repoRoot);
  const releaseIdentifier = argument("release-identifier");
  const releasedAt = argument("released-at");
  const releaseAnchorPublicKeyPath = path.resolve(argument("release-anchor-public-key"));
  const releaseAnchorPrivateKeyPath = path.resolve(argument("release-anchor-private-key"));
  const releaseAnchorKeyId = argument("release-anchor-key-id");
  const releaseAnchorKeyVersion = argument("release-anchor-key-version");
  const outDir = path.resolve(argument("out-dir"));

  if (git(sourceRoot, ["status", "--porcelain"]) !== "") {
    throw new Error("the signed runner release must be built from a clean checkout");
  }
  const buildIdentifier = git(sourceRoot, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/u.test(buildIdentifier)) throw new Error("git HEAD is not a 40-character lowercase commit identity");
  if (!Number.isFinite(Date.parse(releasedAt))) throw new Error("--released-at must be an RFC 3339 timestamp");
  try {
    await stat(outDir);
    throw new Error(`output directory already exists: ${outDir}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const signing = await loadSigningWorkspace(sourceRoot);
  const releaseAnchorText = (await readFile(releaseAnchorPublicKeyPath, "utf8")).trim();
  const releaseAnchorPublicKey = signing.decodeBase64Url(releaseAnchorText);
  if (releaseAnchorPublicKey?.length !== signing.ML_DSA_65_PUBLIC_KEY_BYTES) {
    throw new Error("--release-anchor-public-key must contain one raw ML-DSA-65 public key in unpadded base64url");
  }
  const releaseAnchorPrivateKey = new Uint8Array(await readFile(releaseAnchorPrivateKeyPath));
  const derivedPublicKey = signing.publicKeyFromPkcs8(releaseAnchorPrivateKey);
  if (
    derivedPublicKey === undefined ||
    !Buffer.from(derivedPublicKey).equals(Buffer.from(releaseAnchorPublicKey))
  ) {
    throw new Error("release anchor public and private key inputs do not form one ML-DSA-65 key pair");
  }

  execFileSync(
    "cargo",
    ["build", "--locked", "--release", "-p", "onevps-local-runner-scaffold"],
    {
      cwd: sourceRoot,
      env: {
        ...process.env,
        CODEATTEST_RELEASE_TRUST_ANCHOR_PUBLIC_KEY: releaseAnchorText,
        CODEATTEST_RUNNER_BUILD_IDENTIFIER: buildIdentifier,
        CODEATTEST_RUNNER_RELEASE_IDENTIFIER: releaseIdentifier
      },
      stdio: "inherit"
    }
  );

  const builtBinary = path.join(sourceRoot, "target", "release", "onevps-local-runner-scaffold");
  const binaryBytes = new Uint8Array(await readFile(builtBinary));
  const artifactDigest = `sha256:${createHash("sha256").update(binaryBytes).digest("hex")}`;
  const record = {
    protocol_version: "codeattest.v0",
    release_identifier: releaseIdentifier,
    build_identifier: buildIdentifier,
    artifact_digest: artifactDigest,
    released_at: releasedAt,
    limitations: [signing.SOFTWARE_CUSTODY_LIMITATION]
  };
  const artifact = signing.signRunnerReleaseArtifact({
    release_record: record,
    key: {
      key_id: releaseAnchorKeyId,
      key_version: releaseAnchorKeyVersion,
      privateKeyPkcs8: releaseAnchorPrivateKey
    },
    signing_time: releasedAt
  });
  const verified = signing.verifyRunnerReleaseArtifact({
    artifact,
    artifact_bytes: binaryBytes,
    trust_anchor_public_key: releaseAnchorPublicKey,
    expected_build_identifier: buildIdentifier,
    expected_release_identifier: releaseIdentifier
  });
  if (!verified.ok) throw new Error(`freshly built runner release did not verify: ${verified.reason}`);

  await mkdir(path.join(outDir, ".codeattest"), { recursive: true, mode: 0o755 });
  const outputBinary = path.join(outDir, "onevps-local-runner-scaffold");
  await copyFile(builtBinary, outputBinary);
  await chmod(outputBinary, 0o755);
  await writeFile(path.join(outDir, ".codeattest", "release-verification.json"), `${JSON.stringify(artifact, null, 2)}\n`, {
    mode: 0o644
  });
  console.log(`Signed runner release ${releaseIdentifier} (${buildIdentifier}) written to ${outDir}`);
  console.log(`Artifact digest: ${artifactDigest}`);
}

await main();
