#!/usr/bin/env node
// Story 1.5 runner schema conformance gate.
// Builds the local runner scaffold, emits a scanner finding set from a
// synthetic fixture tree, validates it against the protocol-owned schema, and
// checks privacy/candidate-only guardrails that are easier to read here than in
// the JSON Schema alone.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertNoSharedForbiddenText,
  loadSchemas,
  readJson,
  resolveProjectPath,
  sha256IdFromCanonical,
  validateAgainstSchema,
} from "./lib/protocol-utils.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MARKERS = "SYNTHETIC_DEMO_DATA NOT_CUSTOMER_SOURCE";

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
    console.error(`[runner-scanner-validate] FAILED: ${title}`);
    if (error) console.error(`  error: ${error.message}`);
    console.error(`  status: ${status}`);
    if (stderr) console.error(`  stderr:\n${stderr}`);
    if (stdout) console.error(`  stdout:\n${stdout}`);
    process.exit(1);
  }
  // A successful command's stderr is still customer/public-visible terminal
  // output; a regression that leaks raw scanner output or claim-unsafe text
  // there while exiting zero must not silently pass (C8-18).
  if (stderr) assertNoForbiddenText(stderr, `${title} stderr`);
  return { stdout, stderr };
}

async function buildRunnerBinary() {
  console.log("[runner-scanner-validate] Building local runner scaffold ...");
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
  return resolveProjectPath("target", "release", binaryName);
}

async function writeSyntheticApp(root) {
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        _synthetic_marker: MARKERS,
        dependencies: { react: "19.2.7" },
        devDependencies: { typescript: "6.0.3" },
      },
      null,
      2,
    ) + "\n",
  );

  const srcDir = path.join(root, "src");
  await mkdir(srcDir, { recursive: true });
  await writeFile(
    path.join(srcDir, "app.ts"),
    `// ${MARKERS}\nexport const result = eval('1 + 1');\n`,
  );
  await writeFile(
    path.join(srcDir, "app.py"),
    `# ${MARKERS}\nprint('hello')\n`,
  );
}

async function writeScannerInputs(root) {
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "semgrep-output.json"),
    JSON.stringify(
      {
        results: [
          {
            check_id: "demo.semgrep.insecure-random",
            path: "src/app.ts",
            start: { line: 2, col: 23 },
            end: { line: 2, col: 36 },
            extra: {
              message: `${MARKERS} demo finding around Math.random()`,
              severity: "WARNING",
              metadata: { confidence: "MEDIUM" },
              fingerprint: "synthetic-fingerprint-001",
            },
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(root, "scanner-config.json"),
    JSON.stringify(
      {
        regex_rules: [
          {
            scanner_name: "regex",
            rule_id: "demo.regex.eval",
            pattern: "eval\\(",
            ruleset_identifier: "local:demo-regex",
            severity: "warning",
            confidence: "medium",
            target_file_group: "typescript_javascript",
            target_include_patterns: ["src/*.ts"],
            retain_raw_output_locally: false,
          },
        ],
        semgrep_json_inputs: [
          {
            scanner_name: "semgrep",
            json_path: "semgrep-output.json",
            ruleset_identifier: "local:semgrep-demo",
            scanner_version: "1.168.0",
            target_file_group: "typescript_javascript",
            target_include_patterns: ["src/*.ts"],
            retain_raw_output_locally: false,
          },
        ],
        semgrep_local_commands: [],
      },
      null,
      2,
    ) + "\n",
  );
}

function failStructural(message, produced) {
  console.error(`[runner-scanner-validate] FAILED: ${message}`);
  console.error(JSON.stringify(produced, null, 2));
  process.exit(1);
}

function assertNoForbiddenText(text, label) {
  // Story-specific terms not already covered by the shared source/claim-safety
  // lists (C7-24). The shared lists are checked separately below via
  // assertNoSharedForbiddenText so both are enforced, not just this narrow set.
  const forbidden = [
    "Math.random()",
    "confirmed",
    "likely",
    "inconclusive",
    "requires_customer_side_validation",
    "expert review",
    "approval",
    "receipt",
    "no vulnerabilities",
  ];
  const lower = text.toLowerCase();
  for (const term of forbidden) {
    const haystack = term === "Math.random()" ? text : lower;
    const needle = term === "Math.random()" ? term : term.toLowerCase();
    if (haystack.includes(needle)) {
      console.error(
        `[runner-scanner-validate] FAILED: ${label} contains forbidden term '${term}'`,
      );
      process.exit(1);
    }
  }
  assertNoSharedForbiddenText(text, label, (message) => {
    console.error(`[runner-scanner-validate] FAILED: ${message}`);
    process.exit(1);
  });
}

async function main() {
  const binary = await buildRunnerBinary();

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.5-"));
  const fixtureRoot = path.join(tmpRoot, "app");
  const scannerRoot = path.join(tmpRoot, "scanner");
  const reviewScopePath = path.join(tmpRoot, "review-scope.json");
  const scannerOutputPath = path.join(tmpRoot, "scanner-findings.json");

  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeSyntheticApp(fixtureRoot);
    await writeScannerInputs(scannerRoot);

    console.log("[runner-scanner-validate] Invoking scope init ...");
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
      reviewScopePath,
    ]);

    console.log("[runner-scanner-validate] Invoking scan run ...");
    const { stdout } = run("scan run", [
      binary,
      "scan",
      "run",
      "--application-path",
      fixtureRoot,
      "--scope",
      reviewScopePath,
      "--scanner-config",
      path.join(scannerRoot, "scanner-config.json"),
      "--output",
      scannerOutputPath,
    ]);
    assertNoForbiddenText(stdout, "scan summary");
    if (!stdout.includes("Local-only boundary:")) {
      console.error(
        "[runner-scanner-validate] FAILED: scan summary must state the local-only boundary",
      );
      process.exit(1);
    }

    const reviewScope = await readJson(reviewScopePath);
    const produced = await readJson(scannerOutputPath);
    assertNoForbiddenText(JSON.stringify(produced), "scanner finding set JSON");

    console.log("[runner-scanner-validate] Loading protocol schemas ...");
    const { schemaMap } = await loadSchemas();
    const schemaId = "urn:codeattest:protocol:v0:scanner-finding-set";
    const schema = schemaMap.get(schemaId);
    if (!schema) {
      console.error(
        `[runner-scanner-validate] FATAL: schema ${schemaId} not loaded; check protocol/schemas/scanner-finding-set.schema.json $id.`,
      );
      process.exit(1);
    }

    console.log("[runner-scanner-validate] Validating emitted JSON against schema ...");
    const errors = validateAgainstSchema(produced, schema, schemaMap);
    if (errors.length > 0) {
      console.error(
        `[runner-scanner-validate] FAILED: ${errors.length} schema validation error(s):`,
      );
      for (const err of errors) {
        console.error(`  - ${err.message} [at ${err.location}]`);
      }
      process.exit(1);
    }

    if (produced.review_scope_ref !== reviewScope.review_scope_id) {
      failStructural("review_scope_ref must match emitted review_scope_id", produced);
    }
    if (!produced.scanner_finding_set_id?.startsWith("sha256:")) {
      failStructural("scanner_finding_set_id must be sha256-prefixed", produced);
    }
    {
      // Matches the runner's own `scanner_finding_set_identity()` (lib.rs):
      // unlike disclosure/manifest identities (which delete the self-id key),
      // the scanner finding set identity blanks it to an empty string before
      // canonicalizing. Recompute the same way the producer does, not the
      // delete-key convention used elsewhere in the protocol.
      const scannerIdentityInput = JSON.parse(JSON.stringify(produced));
      scannerIdentityInput.scanner_finding_set_id = "";
      const expectedScannerId = sha256IdFromCanonical(scannerIdentityInput);
      if (produced.scanner_finding_set_id !== expectedScannerId) {
        failStructural(`scanner_finding_set_id must be ${expectedScannerId}`, produced);
      }
    }
    if (produced.source_derived_class !== "retained_review_artifact") {
      failStructural("scanner finding set must use retained_review_artifact", produced);
    }
    if (!Array.isArray(produced.artifact_references)) {
      failStructural("scanner finding set must include artifact_references array", produced);
    }

    const regexRun = produced.scanner_runs?.find((run) => run.scanner_name === "regex");
    const semgrepRun = produced.scanner_runs?.find((run) => run.scanner_name === "semgrep");
    if (regexRun?.status !== "succeeded" || semgrepRun?.status !== "succeeded") {
      failStructural("regex and Semgrep fixture runs must succeed", produced);
    }
    if (semgrepRun.scanner_version !== "1.168.0") {
      failStructural("Semgrep fixture version must be recorded", produced);
    }
    for (const run of produced.scanner_runs ?? []) {
      if (!Array.isArray(run.scanned_files)) {
        failStructural("scanner runs must include scanned_files", produced);
      }
      if (["succeeded", "no_findings"].includes(run.status) && run.failure_reason !== undefined) {
        failStructural("successful/no_findings scanner runs must not include failure_reason", produced);
      }
      if (["failed", "unavailable", "invalid_output", "skipped"].includes(run.status) && run.failure_reason === undefined) {
        failStructural("non-successful scanner runs must include failure_reason", produced);
      }
    }
    if (!regexRun.scanned_files?.includes("src/app.ts") || !semgrepRun.scanned_files?.includes("src/app.ts")) {
      failStructural("successful scanner runs must record the scanned fixture file", produced);
    }

    const findings = produced.candidate_findings ?? [];
    if (findings.length !== 2) {
      failStructural("expected exactly two candidate findings", produced);
    }
    for (const finding of findings) {
      if (finding.status !== "candidate") {
        failStructural("candidate findings must stay candidate-only", produced);
      }
      if (finding.source_derived_class !== "retained_review_artifact") {
        failStructural("candidate finding source-derived class is required", produced);
      }
      for (const key of ["source", "affected_area", "scanner_rule_id", "original_reference"]) {
        if (typeof finding[key] !== "string" || finding[key].length === 0) {
          failStructural(`candidate finding missing ${key}`, produced);
        }
      }
    }

    if (!produced.coverage_limitations?.some((item) => item.includes("python") && item.includes("not scanned"))) {
      failStructural("expected an explicit unscanned Python file-group limitation", produced);
    }

    console.log(
      "[runner-scanner-validate] OK: produced scanner finding set conforms to schema and structural expectations.",
    );
    console.log(
      `[runner-scanner-validate]   scanner_finding_set_id = ${produced.scanner_finding_set_id}`,
    );
    console.log(
      `[runner-scanner-validate]   review_scope_ref = ${produced.review_scope_ref}`,
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
