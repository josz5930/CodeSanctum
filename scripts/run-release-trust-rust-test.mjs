import { spawnSync } from "node:child_process";

import { resolveCargoOrSkip } from "./lib/cargo-gate.mjs";

// Runs the runner-crate `release_trust` integration test. Skips with the shared
// Rust-gate convention (PENDING locally, FAIL under CI) when Cargo is absent so
// `npm run ci` degrades the same way `rust:test` does.
const resolved = resolveCargoOrSkip("release-trust:rust-test");
if (resolved.skip) {
  process.exit(0);
}

const result = spawnSync(
  resolved.cargo,
  ["test", "-p", "onevps-local-runner-scaffold", "--test", "release_trust"],
  { stdio: "inherit", env: resolved.env }
);
process.exit(result.status ?? 1);
