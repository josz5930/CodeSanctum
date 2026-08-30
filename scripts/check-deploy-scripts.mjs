import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function available(command) {
  return Promise.any((process.env.PATH ?? "").split(path.delimiter).map((entry) => access(path.join(entry, command))))
    .then(() => true, () => false);
}

function ordered(text, patterns) {
  let cursor = 0;
  for (const pattern of patterns) {
    const match = pattern.exec(text.slice(cursor));
    if (match === null) {
      return false;
    }
    cursor += match.index + match[0].length;
  }
  return true;
}

export async function checkDeployScripts(root = repoRoot) {
  const deployPath = path.join(root, "infra/deploy/deploy.sh");
  const rollbackPath = path.join(root, "infra/deploy/rollback.sh");
  const buildReleasePath = path.join(root, "scripts/build-signed-runner-release.mjs");
  const verifyReleasePath = path.join(root, "scripts/verify-runner-release.mjs");
  const [deploy, rollback, buildRelease, verifyRelease] = await Promise.all([
    readFile(deployPath, "utf8"),
    readFile(rollbackPath, "utf8"),
    readFile(buildReleasePath, "utf8"),
    readFile(verifyReleasePath, "utf8")
  ]);
  const failures = [];
  if (!ordered(deploy, [/verify-runner-release\.mjs/, /npm run build/, /run-migrations\.mjs --config/, /rsync -a/, /mv -Tf .*current_link/, /systemctl daemon-reload/, /curl .*health_url/])) {
    failures.push("deploy.sh does not preserve release verification -> build -> migration -> install -> switch -> reload -> readiness order");
  }
  for (const pattern of [/release_trust_anchor=/, /expected-build-identifier/, /runner-release/, /previous_link=/, /previous_release=/, /rollback_failed_deploy/, /mv -Tf .*current_link/]) {
    if (!pattern.test(deploy)) {
      failures.push(`deploy.sh is missing rollback safety: ${pattern}`);
    }
  }
  for (const pattern of [/previous_link=/, /mv -Tf .*current_link/, /systemctl restart/, /\/readyz/]) {
    if (!pattern.test(rollback)) {
      failures.push(`rollback.sh is missing required behavior: ${pattern}`);
    }
  }
  if (!ordered(rollback, [/verify-runner-release\.mjs/, /mv -Tf .*current_link/])) {
    failures.push("rollback.sh must verify the retained signed runner release before switching current");
  }
  for (const pattern of [
    /CODEATTEST_RELEASE_TRUST_ANCHOR_PUBLIC_KEY/,
    /CODEATTEST_RUNNER_BUILD_IDENTIFIER/,
    /cargo[\s\S]*build/,
    /signRunnerReleaseArtifact/,
    /verifyRunnerReleaseArtifact/
  ]) {
    if (!pattern.test(buildRelease)) failures.push(`signed runner release builder is missing required behavior: ${pattern}`);
  }
  for (const pattern of [/verifyRunnerReleaseArtifact/, /require-trusted-release/, /expected-build-identifier/]) {
    if (!pattern.test(verifyRelease)) failures.push(`signed runner release verifier is missing required behavior: ${pattern}`);
  }
  if (deploy.includes("/mnt/hgfs") || rollback.includes("/mnt/hgfs")) {
    failures.push("deployment scripts must not target /mnt/hgfs");
  }

  for (const script of [deployPath, rollbackPath]) {
    try {
      await execFileAsync("sh", ["-n", script]);
    } catch (error) {
      failures.push(`sh -n failed for ${path.basename(script)}: ${error.stderr || error.message}`);
    }
  }

  let toolStatus = "PENDING: shellcheck is unavailable";
  if (await available("shellcheck")) {
    toolStatus = "shellcheck passed";
    try {
      await execFileAsync("shellcheck", [deployPath, rollbackPath]);
    } catch (error) {
      failures.push(`shellcheck failed: ${error.stderr || error.message}`);
    }
  }
  return { failures, toolStatus };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, toolStatus } = await checkDeployScripts();
  console.log(toolStatus);
  if (failures.length > 0) {
    console.error("Deploy script check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("Deploy script check passed.");
}
