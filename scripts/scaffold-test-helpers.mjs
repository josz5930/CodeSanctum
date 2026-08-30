import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function assertWorkspaceScaffold(workspaceUrl) {
  const workspaceDir = fileURLToPath(workspaceUrl);
  const packageJsonPath = path.join(workspaceDir, "package.json");
  const sourcePath = path.join(workspaceDir, "src", "index.ts");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const source = await readFile(sourcePath, "utf8");

  assert.equal(packageJson.private, true, `${packageJson.name} must stay private in this scaffold`);
  assert.equal(packageJson.type, "module", `${packageJson.name} must use ESM package metadata`);
  assert.match(source, /workspaceName/, `${packageJson.name} must expose a named scaffold marker`);
  assert.match(source, new RegExp(escapeRegex(packageJson.name)), `${packageJson.name} source marker must match package name`);

  console.log(`${packageJson.name} scaffold test passed.`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
