import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractJsSpecifiers, extractRelativePathLiterals, extractRustIncludeMacroPaths, isWithinRoot, resolveRelativeSpecifier, walkFiles } from "./lib/dependency-scan.mjs";

const protocolRoot = path.resolve("protocol");
const scriptsRoot = path.resolve("scripts");
const selfPath = path.resolve("scripts/check-dependency-direction.mjs");
const errors = [];

// protocol/ must stay schema-only: it must not import implementation code
// from any app/service/package, whether by a bare `@onevps/*` specifier or a
// relative path that resolves into one of those trees (however the `../`
// segments are spelled).
const FORBIDDEN_ONEVPS_PACKAGES = new Set([
  "@onevps/control-plane",
  "@onevps/intake-service",
  "@onevps/worker-service",
  "@onevps/protocol-ts",
  "@onevps/ui",
  "@onevps/static-bundle"
]);
const FORBIDDEN_ROOTS_FOR_PROTOCOL = [
  path.resolve("runner"),
  path.resolve("apps"),
  path.resolve("services"),
  path.resolve("packages/protocol-ts"),
  path.resolve("packages/ui"),
  path.resolve("packages/static-bundle")
];

// protocol/ (and the protocol-authority scripts under scripts/) must stay the
// source of truth for protocol semantics. A protocol validation script that
// reads the protocol-ts package's hand-written implementation source as
// string/file input — not just a JS import — would let a runtime
// implementation file silently become protocol authority (see
// protocol/README.md and C8-01). Generated output under .../src/generated/**
// is derived FROM protocol/ and is exempt. The forbidden path is built from
// parts so this checker's own source does not trip itself.
const forbiddenSemanticSourcePattern = new RegExp(`${["packages", "protocol-ts", "src", ""].join("\\/")}(?!generated\\b)`);

// C8-10: packages/protocol-ts/src/index.ts (the barrel) is the sanctioned
// public API; a deep relative import of an internal submodule bypasses that
// boundary the same way a private-package deep import would. Scoped to the
// runtime adapter roots only — protocol-ts's own source/tests legitimately
// reference its internal files directly.
const protocolTsSrcDir = path.resolve("packages/protocol-ts/src");
const allowedProtocolTsBarrelFile = path.join(protocolTsSrcDir, "index.js");
const deepImportBoundaryRoots = [
  path.resolve("apps"),
  path.resolve("services"),
  path.resolve("packages/ui/src"),
  path.resolve("packages/static-bundle/src")
];

// C8-16: `runner/` is intended public/open-source (see runner/README.md) and
// must depend only on protocol contracts, but the dependency-direction gate
// previously walked only `protocol/`, so a Cargo path dependency or Rust
// `include!` pulling in private app/service/package code would stay
// undetected. Rust has no import/require syntax, so this checks the two
// genuine filesystem-coupling mechanisms instead: Cargo.toml `path = "..."`
// dependencies and `include!`/`include_str!`/`include_bytes!` macros — not a
// blanket scan of every quoted string, since runner test fixtures
// legitimately contain incidental relative-path-shaped strings as sample
// scan input data (e.g. "../secrets.rs") that are not real file references.
const runnerRoot = path.resolve("runner");
const FORBIDDEN_ROOTS_FOR_RUNNER = [
  path.resolve("apps"),
  path.resolve("services"),
  path.resolve("packages/protocol-ts"),
  path.resolve("packages/ui"),
  path.resolve("packages/static-bundle")
];

await checkProtocolImports();
await checkProtocolTsSemanticSourceReads();
await checkDeepProtocolTsImports();
await checkRunnerBoundary();

if (errors.length > 0) {
  console.error("Dependency-direction check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Dependency-direction check passed: protocol has no forbidden implementation imports, no protocol script reads protocol-ts implementation source, no adapter deep-imports a protocol-ts internal module, and the public runner tree has no path dependency or file-include on private code.");

async function checkProtocolImports() {
  for (const file of await walkFiles(protocolRoot)) {
    const source = await readFile(file, "utf8");
    for (const specifier of extractJsSpecifiers(source)) {
      if (isForbiddenOnevpsSpecifier(specifier) || isForbiddenResolvedTarget(file, specifier, FORBIDDEN_ROOTS_FOR_PROTOCOL)) {
        errors.push(`${path.relative(process.cwd(), file)} imports implementation code from protocol`);
      }
    }
  }
}

async function checkProtocolTsSemanticSourceReads() {
  for (const file of await walkFiles(scriptsRoot, selfPath)) {
    const source = await readFile(file, "utf8");
    if (forbiddenSemanticSourcePattern.test(source)) {
      errors.push(`${path.relative(process.cwd(), file)} reads protocol-ts implementation source as semantic input; protocol authority must not depend on package implementation code`);
    }
  }
}

async function checkDeepProtocolTsImports() {
  for (const root of deepImportBoundaryRoots) {
    for (const file of await walkFiles(root)) {
      const source = await readFile(file, "utf8");
      for (const specifier of extractJsSpecifiers(source)) {
        const resolved = resolveRelativeSpecifier(file, specifier);
        if (resolved && isWithinRoot(resolved, protocolTsSrcDir) && resolved !== allowedProtocolTsBarrelFile) {
          errors.push(`${path.relative(process.cwd(), file)} deep-imports a protocol-ts internal module; import from packages/protocol-ts/src/index.ts (the public barrel) instead`);
        }
      }
    }
  }
}

async function checkRunnerBoundary() {
  for (const file of await walkFiles(runnerRoot)) {
    const source = await readFile(file, "utf8");
    const basename = path.basename(file);
    const literals = [];
    if (basename === "Cargo.toml" || basename === "build.rs") {
      literals.push(...extractRelativePathLiterals(source));
    }
    if (path.extname(file) === ".rs") {
      literals.push(...extractRustIncludeMacroPaths(source));
    }
    for (const literal of literals) {
      const resolved = resolveRelativeSpecifier(file, literal);
      if (resolved && FORBIDDEN_ROOTS_FOR_RUNNER.some((root) => isWithinRoot(resolved, root))) {
        errors.push(`${path.relative(process.cwd(), file)} references "${literal}", which resolves outside the public runner boundary into private code`);
      }
    }
  }
}

function isForbiddenOnevpsSpecifier(specifier) {
  if (!specifier.startsWith("@onevps/")) {
    return false;
  }
  return [...FORBIDDEN_ONEVPS_PACKAGES].some((packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`));
}

function isForbiddenResolvedTarget(file, specifier, forbiddenRoots) {
  const resolved = resolveRelativeSpecifier(file, specifier);
  if (!resolved) {
    return false;
  }
  return forbiddenRoots.some((root) => isWithinRoot(resolved, root));
}
