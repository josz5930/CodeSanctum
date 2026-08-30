import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// C8-02: script (protocol-utils.mjs), protocol-ts, and Rust
// (runner/crates/local-runner-scaffold/src/lib.rs is_utc_rfc3339_timestamp)
// must accept/reject the exact same UTC RFC 3339 corpus. The Rust side of
// this corpus is asserted in the runner crate's own `#[cfg(test)] mod tests`
// (utc_rfc3339_timestamp_* cases) against the same literal strings; this test
// covers the JS-side half of the convergence claim in-process.
const CORPUS = [
  ["2026-07-10T00:20:00Z", true],
  ["2026-07-10T00:20:00.123Z", true],
  ["2026-07-10T00:20:00.123456789Z", true],
  ["2026-07-10T00:20:00+00:00", true],
  ["2026-07-10T00:20:00.5+00:00", true],
  ["1969-07-10T00:20:00Z", true],
  ["2028-02-29T00:20:00Z", true],
  ["2026-13-10T00:20:00Z", false],
  ["2026-02-29T00:20:00Z", false],
  ["2026-07-10T24:00:00Z", false],
  ["2026-07-10T00:20:00.1234567890Z", false],
  ["2026-07-10T00:20:00.Z", false],
  ["2026-07-10T00:20:00-00:00", false],
  ["2026-07-10T00:20:00+01:00", false]
];

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const { isUtcRfc3339Timestamp: protocolTsCheck } = await import(pathToFileURL(path.join(outDir, "validation.js")).href);
  const { isUtcRfc3339Timestamp: scriptCheck } = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);

  for (const [value, expected] of CORPUS) {
    assert(protocolTsCheck(value) === expected, `protocol-ts must ${expected ? "accept" : "reject"} ${value}`);
    assert(scriptCheck(value) === expected, `script validator must ${expected ? "accept" : "reject"} ${value}`);
  }

  console.log("protocol-ts / script UTC RFC 3339 timestamp convergence tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
