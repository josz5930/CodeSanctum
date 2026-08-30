#!/usr/bin/env node
// Story 1.4 code review decision DN-3 (A): Node-side schema conformance test.
// Invokes the compiled `onevps-local-runner-scaffold` CLI against a synthetic
// fixture tree, captures the emitted review-scope JSON, and validates it
// against protocol/schemas/review-scope.schema.json using the project's
// existing schema validator. Returns non-zero on any failure.
//
// Invoked via `npm run runner:story-1.4-schema-check`.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadSchemas,
  readJson,
  resolveProjectPath,
  validateAgainstSchema,
} from "./lib/protocol-utils.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function findCargoCommand() {
  for (const candidate of ["cargo", "/opt/homebrew/opt/rustup/bin/cargo"]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!result.error && result.status === 0) return candidate;
  }
  return "cargo";
}

function makeRustEnv(command) {
  if (command === "cargo") return process.env;
  const cargoBin = path.dirname(command);
  return {
    ...process.env,
    PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
  };
}

const CARGO = findCargoCommand();
const RUST_ENV = makeRustEnv(CARGO);

function run(title, args, opts = {}) {
  const { status, stdout, stderr, error } = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    env: RUST_ENV,
    ...opts,
  });
  if (error || status !== 0) {
    console.error(`[runner-validate] FAILED: ${title}`);
    if (error) console.error(`  error: ${error.message}`);
    console.error(`  status: ${status}`);
    if (stderr) console.error(`  stderr:\n${stderr}`);
    if (stdout) console.error(`  stdout:\n${stdout}`);
    process.exit(1);
  }
  return { stdout, stderr };
}

async function buildRunnerBinary() {
  // Build the local runner scaffold in release profile to produce a stable
  // binary path.
  console.log("[runner-validate] Building local runner scaffold ...");
  run("cargo build --release", [
    CARGO,
    "build",
    "--release",
    "-p",
    "onevps-local-runner-scaffold",
  ], { cwd: resolveProjectPath("runner") });
  const binaryName =
    process.platform === "win32"
      ? "onevps-local-runner-scaffold.exe"
      : "onevps-local-runner-scaffold";
  // Workspace Cargo.toml lives at the project root; `target/` is always
  // resolved relative to that, regardless of the cwd used to invoke cargo.
  return resolveProjectPath("target", "release", binaryName);
}

async function writeFixtures(root) {
  // Mirror the test/fixtures/synthetic-scope-app structure with the required
  // synthetic-data markers so we exercise a "realistic" project tree, plus an
  // additional requirements/*.txt file to exercise the subdirectory-glob
  // detection patched in by the code review.
  const markers = "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE";

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        _synthetic_marker: markers,
        dependencies: {
          next: "16.2.10",
          react: "19.2.7",
        },
        devDependencies: {
          typescript: "6.0.3",
        },
      },
      null,
      2,
    ) + "\n",
  );

  await writeFile(
    path.join(root, "requirements.txt"),
    `# ${markers}\nfastapi==0.1.0\ndjango>=5.0\n`,
  );

  const reqsDir = path.join(root, "requirements");
  await mkdir(reqsDir, { recursive: true });
  await writeFile(
    path.join(reqsDir, "dev.txt"),
    `# ${markers}\npytest==7.0.0\nFlask>=2.0\n`,
  );

  await writeFile(
    path.join(root, "pyproject.toml"),
    `# ${markers}\n[project]\ndependencies = ['django']\n`,
  );

  const srcDir = path.join(root, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "app.ts"),
    `// ${markers}\nexport const greet = (name: string): string => \`hello, \${name}\`;\n`,
  );
  await writeFile(
    path.join(srcDir, "app.py"),
    `# ${markers}\ndef greet(name):\n    return f"hello, {name}"\n`,
  );
}

async function main() {
  const binary = await buildRunnerBinary();

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.4-"));
  const fixtureRoot = path.join(tmpRoot, "app");
  const outputPath = path.join(tmpRoot, "review-scope.json");
  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeFixtures(fixtureRoot);

    console.log(
      "[runner-validate] Invoking scope init (synthetic fixture) ...",
    );
    run("scope init", [
      binary,
      "scope",
      "init",
      "--application-path",
      fixtureRoot,
      "--review-id",
      "review:synthetic-demo-001",
      "--commit",
      COMMIT,
      "--output",
      outputPath,
    ]);

    const produced = await readJson(outputPath);

    console.log("[runner-validate] Loading protocol schemas ...");
    const { schemaMap } = await loadSchemas();
    const schemaId = "urn:codeattest:protocol:v0:review-scope";
    const schema = schemaMap.get(schemaId);
    if (!schema) {
      console.error(
        `[runner-validate] FATAL: schema ${schemaId} not loaded; check protocol/schemas/review-scope.schema.json $id.`,
      );
      process.exit(1);
    }

    console.log("[runner-validate] Validating emitted JSON against schema ...");
    const errors = validateAgainstSchema(produced, schema, schemaMap);
    if (errors.length > 0) {
      console.error(
        `[runner-validate] FAILED: ${errors.length} schema validation error(s):`,
      );
      for (const err of errors) {
        console.error(`  - ${err.message} [at ${err.location}]`);
      }
      process.exit(1);
    }

    // A few structural sanity checks beyond pure schema validation.
    const required = [
      produced.protocol_version === "codeattest.v0",
      produced.review_id === "review:synthetic-demo-001",
      produced.selected_commit?.commit_sha === COMMIT,
      typeof produced.repository_identity === "string" &&
        produced.repository_identity.startsWith("sha256:"),
      typeof produced.review_scope_id === "string" &&
        produced.review_scope_id.startsWith("sha256:"),
      produced.technical_context?.length > 0,
      produced.dependency_manifests?.length > 0,
    ];
    if (required.some((v) => !v)) {
      console.error(
        "[runner-validate] FAILED: structural sanity checks did not pass; emitted object:",
      );
      console.error(JSON.stringify(produced, null, 2));
      process.exit(1);
    }

    const expectedDepNames = new Set([
      "next",
      "react",
      "typescript",
      "fastapi",
      "django",
      "pytest",
      "flask",
    ]);
    const found = new Set();
    for (const manifest of produced.dependency_manifests ?? []) {
      for (const dep of manifest.dependencies ?? []) found.add(dep);
    }
    for (const dep of expectedDepNames) {
      if (!found.has(dep)) {
        console.error(
          `[runner-validate] FAILED: expected dependency '${dep}' not captured in any manifest. Captured: ${[
            ...found,
          ].join(", ")}`,
        );
        process.exit(1);
      }
    }

    const ctx = (type, value) =>
      produced.technical_context?.find(
        (c) => c.context_type === type && c.value === value,
      );
    const wantCtx = [
      ["language", "typescript", "detected"],
      ["language", "javascript", "detected"],
      ["language", "python", "detected"],
      ["framework", "react", "detected"],
      ["framework", "next", "detected"],
      ["framework", "django", "detected"],
      ["framework", "fastapi", "detected"],
      ["framework", "flask", "detected"],
      ["framework", "svelte", "not_detected"],
    ];
    for (const [type, value, wantStatus] of wantCtx) {
      const entry = ctx(type, value);
      if (!entry) {
        console.error(
          `[runner-validate] FAILED: missing technical_context entry ${type}/${value}`,
        );
        process.exit(1);
      }
      if (entry.status !== wantStatus) {
        console.error(
          `[runner-validate] FAILED: ${type}/${value} expected status=${wantStatus}, got status=${entry.status}`,
        );
        process.exit(1);
      }
    }

    console.log(
      "[runner-validate] OK: produced review-scope conforms to schema and structural expectations.",
    );
    console.log(
      `[runner-validate]   review_scope_id = ${produced.review_scope_id}`,
    );
    console.log(
      `[runner-validate]   repository_identity = ${produced.repository_identity}`,
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
