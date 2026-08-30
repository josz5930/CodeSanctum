import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const workspacePath = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const outDir = path.join(repoRoot, "node_modules", ".cache", "identity-store-test-dist");
const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");

let compiled = false;

async function newestMtime(dir, max = 0) {
  let latest = max;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const s = await stat(full);
    if (entry.isDirectory()) {
      latest = await newestMtime(full, latest);
    } else if (s.mtimeMs > latest) {
      latest = s.mtimeMs;
    }
  }
  return latest;
}

async function isFresh() {
  try {
    const built = (await stat(outDir)).mtimeMs;
    const newestSource = Math.max(
      await newestMtime(path.join(workspacePath, "src")),
      await newestMtime(path.join(repoRoot, "packages", "protocol-ts", "src"))
    );
    return built >= newestSource;
  } catch {
    return false;
  }
}

async function ensureCompiled() {
  if (compiled) {
    return outDir;
  }
  if (await isFresh()) {
    compiled = true;
    return outDir;
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(outDir, "identity-store-test.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });
  compiled = true;
  return outDir;
}

/**
 * Compile the workspace (rootDir is packages/) and import a module from
 * identity-store/src/. Brief tests call compileWorkspace("secret-hash.js").
 */
export async function compileWorkspace(relativePath) {
  const dir = await ensureCompiled();
  return import(pathToFileURL(path.join(dir, "identity-store", "src", relativePath)).href);
}
