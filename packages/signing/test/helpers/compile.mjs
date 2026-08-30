import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("../..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");

/**
 * Compiles the `@onevps/signing` workspace (which, via its tsconfig
 * `include`, also pulls in `@onevps/protocol-ts`) with `tsc`, then
 * dynamically imports the given compiled module. `relativeModulePath` is
 * relative to the workspace root, e.g. `"src/key-directory.js"`.
 *
 * Every test file needs the same compile-then-import boilerplate, so it
 * lives here once rather than inlined per test.
 */
export async function importCompiled(relativeModulePath) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-signing-test-"));
  const outDir = path.join(repoRoot, "node_modules", ".cache", `signing-test-dist-${randomUUID()}`);

  try {
    const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    execFileSync(process.execPath, [
      tscBin, "-p", "tsconfig.json", "--outDir", outDir,
      "--tsBuildInfoFile", path.join(tempDir, "signing.tsbuildinfo")
    ], { cwd: workspacePath, stdio: "pipe" });

    return await import(pathToFileURL(path.join(outDir, "packages", "signing", relativeModulePath)).href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
}
