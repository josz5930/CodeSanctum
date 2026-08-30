import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadSigningWorkspace(repoRoot) {
  const scratch = await mkdtemp(path.join(tmpdir(), "codeattest-signing-tool-"));
  const outDir = path.join(repoRoot, "node_modules", ".cache", `signing-tool-${randomUUID()}`);
  try {
    await mkdir(outDir, { recursive: true });
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        path.join(repoRoot, "packages", "signing", "tsconfig.json"),
        "--outDir",
        outDir,
        "--tsBuildInfoFile",
        path.join(scratch, "signing.tsbuildinfo")
      ],
      { cwd: repoRoot, stdio: "pipe" }
    );
    return await import(pathToFileURL(path.join(outDir, "packages", "signing", "src", "index.js")).href);
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
}
