import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
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
  const backupPath = path.join(root, "infra/deploy/backup.sh");
  const restorePath = path.join(root, "infra/deploy/restore.sh");
  const buildReleasePath = path.join(root, "scripts/build-signed-runner-release.mjs");
  const verifyReleasePath = path.join(root, "scripts/verify-runner-release.mjs");
  const [deploy, rollback, backup, restore, buildRelease, verifyRelease] = await Promise.all([
    readFile(deployPath, "utf8"),
    readFile(rollbackPath, "utf8"),
    readFile(backupPath, "utf8"),
    readFile(restorePath, "utf8"),
    readFile(buildReleasePath, "utf8"),
    readFile(verifyReleasePath, "utf8")
  ]);
  const failures = [];
  if (!ordered(deploy, [/verify-runner-release\.mjs/, /npm run build/, /check-host-config\.mjs/, /run-migrations\.mjs --database-url-file "\$migrator_url_file"/, /rsync -a/, /mv -Tf .*current_link/, /systemctl daemon-reload/, /curl .*health_url/])) {
    failures.push("deploy.sh does not preserve release verification -> build -> config check -> migration -> install -> switch -> reload -> readiness order");
  }
  if (/run-migrations\.mjs --config/.test(deploy)) {
    failures.push("deploy.sh must not migrate with the host config's codeattest_app URL; that role cannot run DDL");
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
  // A backup must pause retention purges, refuse an unencrypted pilot
  // destination, and prove itself readable before it is published.
  if (!ordered(backup, [/systemctl stop "\$unit"/, /pg_dump /, /tar -C "\$object_root"/, /pg_restore --list/, /sha256sum /, /mv -T -- "\$partial" "\$final"/])) {
    failures.push("backup.sh does not preserve pause purges -> dump -> archive -> verify -> checksum -> publish order");
  }
  for (const pattern of [/pilot backups must be written to an encrypted device/, /backup root must be outside/, /CODEATTEST_BACKUP_KEEP/]) {
    if (!pattern.test(backup)) failures.push(`backup.sh is missing required behavior: ${pattern}`);
  }
  // A restore must verify the backup and refuse to touch live data before it
  // writes anything.
  if (!ordered(restore, [/sha256sum --check --strict/, /is not empty/, /is not empty/, /systemctl stop "\$unit"/, /pg_restore .*--single-transaction/, /tar -C "\$object_root"/, /run-migrations\.mjs" --database-url-file/, /curl .*health_url/])) {
    failures.push("restore.sh does not preserve verify -> refuse non-empty targets -> stop -> restore -> migrate -> readiness order");
  }
  if (!/pilot object store must be on an encrypted device/.test(restore)) {
    failures.push("restore.sh must refuse an unencrypted pilot object store");
  }
  if ([deploy, rollback, backup, restore].some((text) => text.includes("/mnt/hgfs"))) {
    failures.push("deployment scripts must not target /mnt/hgfs");
  }

  const scripts = [deployPath, rollbackPath, backupPath, restorePath];
  for (const script of scripts) {
    const stats = await stat(script);
    if ((stats.mode & 0o111) === 0) {
      failures.push(`${path.basename(script)} is not executable`);
    }
  }
  for (const script of scripts) {
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
      await execFileAsync("shellcheck", scripts);
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
