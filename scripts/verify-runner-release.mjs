import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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

async function main() {
  const releaseDir = path.resolve(argument("release-dir"));
  const trustAnchorPath = path.resolve(argument("trust-anchor"));
  const expectedBuildIdentifier = argument("expected-build-identifier", false);
  const expectedReleaseIdentifier = argument("expected-release-identifier", false);
  const binaryPath = path.join(releaseDir, "onevps-local-runner-scaffold");
  const verificationPath = path.join(releaseDir, ".codeattest", "release-verification.json");
  const [binaryBytes, artifactText, anchorText] = await Promise.all([
    readFile(binaryPath),
    readFile(verificationPath, "utf8"),
    readFile(trustAnchorPath, "utf8")
  ]);
  const signing = await loadSigningWorkspace(repoRoot);
  const trustAnchor = signing.decodeBase64Url(anchorText.trim());
  if (trustAnchor === undefined) throw new Error("release trust anchor is not exact unpadded base64url");
  const verified = signing.verifyRunnerReleaseArtifact({
    artifact: JSON.parse(artifactText),
    artifact_bytes: new Uint8Array(binaryBytes),
    trust_anchor_public_key: trustAnchor,
    ...(expectedBuildIdentifier === undefined ? {} : { expected_build_identifier: expectedBuildIdentifier }),
    ...(expectedReleaseIdentifier === undefined ? {} : { expected_release_identifier: expectedReleaseIdentifier })
  });
  if (!verified.ok) throw new Error(`runner release verification failed: ${verified.reason}`);

  const scratch = await mkdtemp(path.join(tmpdir(), "codeattest-runner-self-check-"));
  try {
    const output = execFileSync(
      binaryPath,
      ["runner", "trust", "--require-trusted-release", "--attempt-log", path.join(scratch, "attempts.jsonl")],
      { cwd: releaseDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (!output.includes("Release signature status: verified_release_signature") || !output.includes("Trust label: trusted_release")) {
      throw new Error("runner self-check did not report verified_release_signature/trusted_release");
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(
    `Verified signed runner release ${verified.release_record.release_identifier} (${verified.release_record.build_identifier}); ${verified.release_record.artifact_digest}`
  );
}

await main();
