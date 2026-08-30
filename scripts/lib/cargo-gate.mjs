import { spawnSync } from "node:child_process";
import path from "node:path";

export const CARGO_MISSING_MESSAGE =
  "Rust/Cargo is not installed locally. Install Rust 1.96.1 with rustfmt and clippy, or rely on CI where the pinned toolchain is installed before npm run ci.";

// C7-37: `CI === "true"` only caught the exact GitHub Actions convention. CI
// automation that sets `CI=1`, `GITHUB_ACTIONS=true`, or a Buildkite/Azure
// Pipelines marker instead could silently report PENDING/exit 0 with no Rust
// checks run at all. Treat any non-empty, non-"false"/"0" CI-like marker as CI,
// and only allow the local skip when explicitly requested.
export function isCiLike() {
  const markers = [process.env.CI, process.env.GITHUB_ACTIONS, process.env.BUILDKITE, process.env.TF_BUILD];
  return markers.some((value) => value !== undefined && value !== "" && value !== "false" && value !== "0");
}

export function findCargoCommand() {
  for (const candidate of ["cargo", "/opt/homebrew/opt/rustup/bin/cargo"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return "cargo";
}

export function makeRustEnv(command, extra = {}) {
  if (command === "cargo") {
    return { ...process.env, ...extra };
  }
  const cargoBin = path.dirname(command);
  return {
    ...process.env,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
    ...extra
  };
}

// Resolve a usable cargo command, or report the shared skip/fail decision when
// the toolchain is absent. Returns `{ cargo, env }` when cargo is available.
// Returns `{ skip: true }` after printing a PENDING line for a local skip, and
// exits the process with the FAIL convention when running under CI.
export function resolveCargoOrSkip(label, extraEnv = {}) {
  const cargo = findCargoCommand();
  const env = makeRustEnv(cargo, extraEnv);
  const version = spawnSync(cargo, ["--version"], { encoding: "utf8", env });
  if (version.error || version.status !== 0) {
    if (isCiLike() && process.env.ONEVPS_ALLOW_MISSING_RUST !== "1") {
      console.error(`FAIL ${label}: ${CARGO_MISSING_MESSAGE}`);
      process.exit(1);
    }
    console.log(`PENDING ${label}: ${CARGO_MISSING_MESSAGE}`);
    return { skip: true };
  }
  console.log(version.stdout.trim());
  return { cargo, env };
}
