import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildRerunManifest,
  collectObservation,
  loadSyntheticCanaries
} from "./lib/collect-readiness-evidence.mjs";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checkId = argValue("--check-id");
  const command = argValue("--command");
  const stdoutFile = argValue("--stdout-file");
  const stderrFile = argValue("--stderr-file");
  const exitStatus = Number(argValue("--exit-status") ?? "0");
  const toolVersion = argValue("--tool-version") ?? "unknown";
  const collectedAt = argValue("--collected-at") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const releaseDigest = argValue("--release-digest");
  const expectedReleaseDigest = argValue("--expected-release-digest") ?? releaseDigest;
  const deploymentIdentity = argValue("--deployment-identity") ?? "pilot";
  const outputDir = argValue("--output-dir");
  const required = !process.argv.includes("--optional");

  if (!checkId || !command || !stdoutFile || !releaseDigest || !outputDir) {
    console.error("usage: node scripts/collect-readiness-evidence.mjs --check-id <id> --command <text> --stdout-file <path> --release-digest sha256:<hex> --output-dir <dir> [--stderr-file <path>] [--exit-status <n>] [--tool-version <text>] [--expected-release-digest sha256:<hex>] [--deployment-identity pilot] [--collected-at <rfc3339>] [--optional]");
    process.exit(1);
  }

  const stdout = await readFile(stdoutFile, "utf8");
  const stderr = stderrFile === undefined ? "" : await readFile(stderrFile, "utf8");
  const result = collectObservation({
    check_id: checkId,
    command,
    stdout,
    stderr,
    exit_status: exitStatus,
    tool_version: toolVersion,
    collected_at: collectedAt,
    release_digest: releaseDigest,
    expected_release_digest: expectedReleaseDigest,
    deployment_identity: deploymentIdentity,
    required
  });

  if (result.outcome === "refused") {
    console.error(`collect-readiness-evidence refused: ${result.reason}`);
    process.exit(2);
  }

  await mkdir(outputDir, { recursive: true });
  const attachmentPath = path.join(outputDir, `${checkId}.redacted.txt`);
  const observationPath = path.join(outputDir, `${checkId}.observation.json`);
  await writeFile(attachmentPath, `${result.redacted_attachment}\n`);
  await writeFile(observationPath, `${JSON.stringify(result.observation, null, 2)}\n`);

  const canaries = await loadSyntheticCanaries();
  const manifest = buildRerunManifest({
    release_digest: releaseDigest,
    deployment_identity: deploymentIdentity,
    observations: [result.observation],
    canaries
  });
  await writeFile(path.join(outputDir, "rerun-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${result.observation.attachment_digest}\n`);
}
