import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCargoOrSkip } from "./lib/cargo-gate.mjs";
import { loadSigningWorkspace } from "./lib/load-signing-workspace.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// The end-to-end check compiles the runner binary, so it needs Cargo. Skip with
// the shared Rust-gate convention (PENDING locally, FAIL under CI) when it is
// absent rather than throwing an opaque ENOENT.
const cargoGate = resolveCargoOrSkip("release-trust:signed-runner-release");
if (cargoGate.skip) {
  process.exit(0);
}

const scratch = await mkdtemp(path.join(tmpdir(), "codeattest-signed-runner-test-"));

try {
  const signing = await loadSigningWorkspace(repoRoot);
  const releaseAnchor = signing.generateMlDsa65KeyPair();
  const anchorText = signing.encodeBase64Url(releaseAnchor.publicKey);
  const buildIdentifier = "a".repeat(40);
  const releaseIdentifier = "codeattest-local-runner-synthetic-g6-check";
  const targetDir = path.join(scratch, "cargo-target");
  const releaseDir = path.join(scratch, "runner-release");
  const verificationDir = path.join(releaseDir, ".codeattest");
  const anchorPath = path.join(scratch, "release-anchor.pub");

  execFileSync(
    cargoGate.cargo,
    ["build", "--locked", "-p", "onevps-local-runner-scaffold", "--bin", "onevps-local-runner-scaffold"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
        CODEATTEST_RELEASE_TRUST_ANCHOR_PUBLIC_KEY: anchorText,
        CODEATTEST_RUNNER_BUILD_IDENTIFIER: buildIdentifier,
        CODEATTEST_RUNNER_RELEASE_IDENTIFIER: releaseIdentifier
      },
      stdio: "inherit"
    }
  );

  await mkdir(verificationDir, { recursive: true });
  const builtBinary = path.join(targetDir, "debug", "onevps-local-runner-scaffold");
  const packagedBinary = path.join(releaseDir, "onevps-local-runner-scaffold");
  await copyFile(builtBinary, packagedBinary);
  await chmod(packagedBinary, 0o755);
  const binaryBytes = new Uint8Array(await readFile(packagedBinary));
  const record = {
    protocol_version: "codeattest.v0",
    release_identifier: releaseIdentifier,
    build_identifier: buildIdentifier,
    artifact_digest: `sha256:${createHash("sha256").update(binaryBytes).digest("hex")}`,
    released_at: "2026-08-27T00:00:00Z",
    limitations: [
      signing.SOFTWARE_CUSTODY_LIMITATION,
      "SYNTHETIC_DEMO_DATA End-to-end release-pipeline check. NOT_CUSTOMER_SOURCE."
    ]
  };
  const artifact = signing.signRunnerReleaseArtifact({
    release_record: record,
    key: {
      key_id: "synthetic-release-anchor",
      key_version: "v1",
      privateKeyPkcs8: releaseAnchor.privateKeyPkcs8
    },
    signing_time: record.released_at
  });
  await Promise.all([
    writeFile(path.join(verificationDir, "release-verification.json"), `${JSON.stringify(artifact, null, 2)}\n`),
    writeFile(anchorPath, `${anchorText}\n`)
  ]);

  execFileSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "verify-runner-release.mjs"),
      "--release-dir",
      releaseDir,
      "--trust-anchor",
      anchorPath,
      "--expected-build-identifier",
      buildIdentifier,
      "--expected-release-identifier",
      releaseIdentifier
    ],
    { cwd: repoRoot, stdio: "inherit" }
  );

  const tampered = Buffer.from(binaryBytes);
  tampered[0] ^= 1;
  await writeFile(packagedBinary, tampered);
  const refused = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "verify-runner-release.mjs"),
      "--release-dir",
      releaseDir,
      "--trust-anchor",
      anchorPath,
      "--expected-build-identifier",
      buildIdentifier
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );
  if (refused.status === 0 || !refused.stderr.includes("release_artifact_digest_mismatch")) {
    throw new Error("tampered runner binary was not refused by the deployment verifier");
  }

  console.log("signed runner release end-to-end check passed.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
