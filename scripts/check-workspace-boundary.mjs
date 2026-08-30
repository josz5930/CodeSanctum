import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { extractJsSpecifiers } from "./lib/dependency-scan.mjs";
import { allowedOnevpsTargetsFor } from "./lib/workspace-dependency-matrix.mjs";

const workspaceDir = process.cwd();
const packageJsonPath = path.join(workspaceDir, "package.json");
const tsconfigPath = path.join(workspaceDir, "tsconfig.json");
const sourcePath = path.join(workspaceDir, "src", "index.ts");
const errors = [];

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));
const source = await readFile(sourcePath, "utf8");

expect(packageJson.private === true, "workspace package must be private during scaffold setup");
expect(packageJson.type === "module", "workspace package must declare ESM module mode");
expect(tsconfig.extends === "../../tsconfig.base.json", "workspace tsconfig must extend the root base config");
expect(tsconfig.compilerOptions?.composite === true, "workspace tsconfig must be composite for deterministic project references");
expect(source.includes(`workspaceName = "${packageJson.name}"`), "src/index.ts must expose the package name scaffold marker");

for (const scriptName of ["format", "lint", "typecheck", "build", "test"]) {
  expect(typeof packageJson.scripts?.[scriptName] === "string", `missing ${scriptName} script`);
}

for (const dependencyBlock of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  const entries = Object.entries(packageJson[dependencyBlock] ?? {});
  for (const [dependencyName, version] of entries) {
    expect(version !== "latest", `${dependencyBlock}.${dependencyName} must not use latest`);
  }
}

// C7-14: this used to check only src/index.ts, so a forbidden import placed
// in any other source file (src/validation.ts, src/claim-safety.ts, etc.)
// was invisible to this gate. Scan every .ts/.mts/.js/.mjs file under src/
// instead of just the barrel.
if (packageJson.name === "@onevps/protocol-ts") {
  await checkProtocolTsSourceBoundary();
}

// C8-13: `extends`/`composite` were the only tsconfig fields checked above.
// `include`, `files`, `references[].path`, `rootDir`/`rootDirs`, and
// `compilerOptions.paths` can all pull foreign source into a workspace's
// TypeScript program without ever appearing as a source-level import, so a
// workspace could import forbidden roots while `src/index.ts` stays clean.
// This resolves every path-bearing tsconfig field against the same
// `@onevps/*` allow-set the package-metadata check (C8-12) already enforces.
await checkTsconfigPathBoundaries();

await assertExists(path.join(workspaceDir, "test", "scaffold.test.mjs"), "workspace must include a scaffold test");

if (errors.length > 0) {
  console.error(`${packageJson.name} boundary check failed:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`${packageJson.name} boundary check passed.`);

function expect(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

const FORBIDDEN_PROTOCOL_TS_PACKAGES = new Set(["@onevps/control-plane", "@onevps/intake-service", "@onevps/worker-service", "@onevps/ui", "@onevps/static-bundle"]);

async function checkProtocolTsSourceBoundary() {
  const repoRoot = await findRepoRoot(workspaceDir);
  const forbiddenRelativeRoots = [path.resolve(repoRoot, "apps"), path.resolve(repoRoot, "services")];
  for (const filePath of await collectSourceFiles(path.join(workspaceDir, "src"))) {
    const fileSource = await readFile(filePath, "utf8");
    for (const specifier of extractJsSpecifiers(fileSource)) {
      const forbiddenPackage = specifier.startsWith("@onevps/") && [...FORBIDDEN_PROTOCOL_TS_PACKAGES].some((name) => specifier === name || specifier.startsWith(`${name}/`));
      const resolved = specifier.startsWith(".") ? path.resolve(path.dirname(filePath), specifier) : null;
      const forbiddenRelative = resolved !== null && forbiddenRelativeRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
      if (forbiddenPackage || forbiddenRelative) {
        errors.push(`${path.relative(workspaceDir, filePath)} imports "${specifier}"; protocol-ts must not depend on app, service, UI, or static-bundle code`);
      }
    }
  }
}

async function collectSourceFiles(dir) {
  const output = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await collectSourceFiles(absolutePath)));
    } else if (entry.isFile() && /\.(?:ts|mts|tsx|js|mjs)$/u.test(entry.name)) {
      output.push(absolutePath);
    }
  }
  return output;
}

async function assertExists(filePath, message) {
  try {
    await stat(filePath);
  } catch {
    errors.push(message);
  }
}

async function checkTsconfigPathBoundaries() {
  const repoRoot = await findRepoRoot(workspaceDir);
  const nameToDir = await workspaceNameToDir(repoRoot);
  const allowedTargetNames = allowedOnevpsTargetsFor(packageJson.name);
  const allowedRoots = [workspaceDir, ...[...allowedTargetNames].map((name) => nameToDir.get(name)).filter(Boolean)];

  for (const pattern of tsconfig.include ?? []) {
    checkRootContainment(resolveGlobStaticDir(pattern), allowedRoots, `tsconfig.json include entry "${pattern}"`);
  }
  for (const filePath of tsconfig.files ?? []) {
    checkRootContainment(path.dirname(path.resolve(workspaceDir, filePath)), allowedRoots, `tsconfig.json files entry "${filePath}"`);
  }
  for (const reference of tsconfig.references ?? []) {
    if (reference?.path) {
      checkRootContainment(path.resolve(workspaceDir, reference.path), allowedRoots, `tsconfig.json references entry "${reference.path}"`);
    }
  }
  for (const rootDirValue of [tsconfig.compilerOptions?.rootDir, ...(tsconfig.compilerOptions?.rootDirs ?? [])]) {
    if (rootDirValue) {
      checkRootContainment(path.resolve(workspaceDir, rootDirValue), [repoRoot], `tsconfig.json compilerOptions.rootDir(s) entry "${rootDirValue}"`);
    }
  }
  for (const [alias, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
    for (const target of targets) {
      checkRootContainment(resolveGlobStaticDir(target), allowedRoots, `tsconfig.json compilerOptions.paths["${alias}"] entry "${target}"`);
    }
  }
}

function resolveGlobStaticDir(pattern) {
  const segments = pattern.split("/");
  const staticSegments = [];
  for (const segment of segments) {
    if (/[*?{}[\]]/.test(segment)) {
      break;
    }
    staticSegments.push(segment);
  }
  return path.resolve(workspaceDir, staticSegments.join("/") || ".");
}

function checkRootContainment(resolvedPath, roots, description) {
  const withinRoots = roots.some((root) => resolvedPath === root || resolvedPath.startsWith(root + path.sep));
  expect(withinRoots, `${description} resolves to ${resolvedPath}, which is outside this workspace's allowed roots`);
}

async function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    try {
      const candidate = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
      if (Array.isArray(candidate.workspaces)) {
        return dir;
      }
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`could not locate repo root (a package.json with a "workspaces" array) above ${startDir}`);
    }
    dir = parent;
  }
}

async function workspaceNameToDir(repoRoot) {
  const rootPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const nameToDir = new Map();
  for (const relativePath of rootPackageJson.workspaces ?? []) {
    const dir = path.resolve(repoRoot, relativePath);
    const workspacePackageJson = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
    nameToDir.set(workspacePackageJson.name, dir);
  }
  return nameToDir;
}
