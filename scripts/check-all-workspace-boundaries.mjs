// C8-11: root `lint:ts` runs `npm run --workspaces --if-present lint`, and
// scripts/check-workspace-boundary.mjs is only ever invoked because each
// workspace's own `lint` script happens to call it. A workspace that removes
// or renames its `lint` script silently drops out of boundary enforcement
// while `--if-present` keeps root lint green — the checker cannot detect a
// missing invocation of itself. This root script instead enumerates
// package.json's `workspaces` directly and invokes the boundary checker for
// every one of them unconditionally, so a missing/renamed per-workspace
// `lint` script cannot disable boundary enforcement.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { allowedOnevpsTargetsFor } from "./lib/workspace-dependency-matrix.mjs";

const rootPackageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const workspaces = rootPackageJson.workspaces ?? [];
const boundaryScript = path.resolve("scripts/check-workspace-boundary.mjs");
const errors = [];

for (const workspaceRelativePath of workspaces) {
  const workspaceDir = path.resolve(workspaceRelativePath);
  const result = spawnSync(process.execPath, [boundaryScript], {
    cwd: workspaceDir,
    encoding: "utf8",
    stdio: "inherit"
  });
  if (result.status !== 0) {
    errors.push(`${workspaceRelativePath} failed workspace boundary check`);
  }
}

// C8-12: check-workspace-boundary.mjs only ever rejected a literal `latest`
// version string; it never compared *which* @onevps/* packages a workspace
// is allowed to depend on. Dependency direction can be violated at package
// metadata level (declared in dependencies/devDependencies/peerDependencies/
// optionalDependencies) before any source import exists. README.md's
// "Dependency Direction" section is the policy this matrix encodes:
// @onevps/protocol-ts must have no @onevps/* dependencies, and every other
// workspace may depend on protocol-ts only (unless explicitly added below).
// Checked as a full transitive closure, not just direct edges, so a future
// intermediate workspace cannot smuggle a forbidden edge across two hops.
const DEPENDENCY_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

await checkWorkspaceDependencyDirectionMatrix();

if (errors.length > 0) {
  console.error("Workspace boundary check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Workspace boundary check passed for all ${workspaces.length} workspaces.`);

async function checkWorkspaceDependencyDirectionMatrix() {
  const packageJsonByName = new Map();
  for (const workspaceRelativePath of workspaces) {
    const packageJson = JSON.parse(await readFile(path.join(path.resolve(workspaceRelativePath), "package.json"), "utf8"));
    packageJsonByName.set(packageJson.name, { packageJson, workspaceRelativePath });
  }

  const directOnevpsDependenciesByName = new Map();
  for (const [name, { packageJson }] of packageJsonByName) {
    const direct = new Set();
    for (const block of DEPENDENCY_BLOCKS) {
      for (const dependencyName of Object.keys(packageJson[block] ?? {})) {
        if (dependencyName.startsWith("@onevps/")) {
          direct.add(dependencyName);
        }
      }
    }
    directOnevpsDependenciesByName.set(name, direct);
  }

  for (const [name, direct] of directOnevpsDependenciesByName) {
    const allowed = allowedOnevpsTargetsFor(name);
    const { workspaceRelativePath } = packageJsonByName.get(name);
    for (const dependencyName of direct) {
      if (!allowed.has(dependencyName)) {
        errors.push(`${workspaceRelativePath} (${name}) declares a disallowed direct dependency on ${dependencyName}`);
      }
    }
  }

  for (const [name] of packageJsonByName) {
    const reachable = transitiveClosure(name, directOnevpsDependenciesByName);
    const allowed = allowedOnevpsTargetsFor(name);
    const { workspaceRelativePath } = packageJsonByName.get(name);
    for (const reachableName of reachable) {
      if (reachableName === name) {
        continue;
      }
      if (!allowed.has(reachableName)) {
        errors.push(`${workspaceRelativePath} (${name}) transitively depends on ${reachableName}, which is outside its allowed dependency set`);
      }
    }
  }
}

function transitiveClosure(startName, directOnevpsDependenciesByName) {
  const visited = new Set([startName]);
  const queue = [startName];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of directOnevpsDependenciesByName.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}
