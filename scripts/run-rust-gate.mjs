import { spawnSync } from "node:child_process";

import { resolveCargoOrSkip } from "./lib/cargo-gate.mjs";

const gate = process.argv[2];
const argsByGate = {
  fmt: ["fmt", "--all", "--", "--check"],
  lint: ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  build: ["build", "--workspace"],
  test: ["test", "--workspace"]
};

if (!argsByGate[gate]) {
  console.error(`Unknown Rust gate: ${gate}`);
  process.exit(2);
}

const resolved = resolveCargoOrSkip(`rust:${gate}`);
if (resolved.skip) {
  process.exit(0);
}

const result = spawnSync(resolved.cargo, argsByGate[gate], { stdio: "inherit", env: resolved.env });
process.exit(result.status ?? 1);
