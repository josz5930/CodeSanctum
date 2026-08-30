#!/usr/bin/env node
// Story 1.6 runner schema conformance gate.
// Builds the local runner scaffold, emits a disclosure policy from synthetic
// review-scope and scanner-finding-set artifacts, validates it against the
// protocol-owned disclosure-policy schema, and checks disclosure/retention
// invariants that should stay readable at the runner boundary.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadSchemas,
  readJson,
  resolveProjectPath,
  sha256IdFromCanonical,
  validateAgainstSchema,
  validateFixtureSemantics,
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
  const cargoBin = path.dirname(command);
  return command === "cargo"
    ? process.env
    : {
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
    console.error(`[runner-disclosure-validate] FAILED: ${title}`);
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
  console.log("[runner-disclosure-validate] Building local runner scaffold ...");
  run(
    "cargo build --release",
    [CARGO, "build", "--release", "-p", "onevps-local-runner-scaffold"],
    { cwd: resolveProjectPath("runner") },
  );
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
  await writeFile(path.join(srcDir, "app.py"), `# ${MARKERS}\nprint('hello')\n`);
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

async function writePolicyConfig(root) {
  await writeFile(
    path.join(root, "policy-config.json"),
    JSON.stringify(
      {
        redaction: {
          enabled: true,
          profile: "local-demo-redaction",
          configuration_version: "local-demo-redaction-v1",
        },
      },
      null,
      2,
    ) + "\n",
  );
}

function failStructural(message, produced) {
  console.error(`[runner-disclosure-validate] FAILED: ${message}`);
  console.error(JSON.stringify(produced, null, 2));
  process.exit(1);
}

function assertNoForbiddenText(text, label) {
  const forbidden = [
    "Math.random()",
    "no vulnerabilities",
    "receipt",
    "signing",
    "submission",
    "certified",
    "approved by",
  ];
  const lower = text.toLowerCase();
  for (const term of forbidden) {
    const haystack = term === "Math.random()" ? text : lower;
    const needle = term === "Math.random()" ? term : term.toLowerCase();
    if (haystack.includes(needle)) {
      console.error(
        `[runner-disclosure-validate] FAILED: ${label} contains forbidden term '${term}'`,
      );
      process.exit(1);
    }
  }
}

function category(produced, name) {
  return produced.evidence_categories?.find((item) => item.category === name);
}

async function main() {
  const binary = await buildRunnerBinary();

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.6-"));
  const fixtureRoot = path.join(tmpRoot, "app");
  const scannerRoot = path.join(tmpRoot, "scanner");
  const reviewScopePath = path.join(tmpRoot, "review-scope.json");
  const scannerOutputPath = path.join(tmpRoot, "scanner-findings.json");
  const policyConfigPath = path.join(tmpRoot, "policy-config.json");
  const disclosureOutputPath = path.join(tmpRoot, "disclosure-policy.json");

  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeSyntheticApp(fixtureRoot);
    await writeScannerInputs(scannerRoot);
    await writePolicyConfig(tmpRoot);

    console.log("[runner-disclosure-validate] Invoking scope init ...");
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

    console.log("[runner-disclosure-validate] Invoking scan run ...");
    run("scan run", [
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

    console.log("[runner-disclosure-validate] Invoking disclosure configure ...");
    const { stdout } = run("disclosure configure", [
      binary,
      "disclosure",
      "configure",
      "--scope",
      reviewScopePath,
      "--scanner-findings",
      scannerOutputPath,
      "--policy-config",
      policyConfigPath,
      "--output",
      disclosureOutputPath,
    ]);
    assertNoForbiddenText(stdout, "disclosure summary");
    if (!stdout.includes("Local-only boundary:")) {
      console.error(
        "[runner-disclosure-validate] FAILED: disclosure summary must state the local-only boundary",
      );
      process.exit(1);
    }
    if (!stdout.includes("Finding-context snippets balanced default was applied")) {
      console.error(
        "[runner-disclosure-validate] FAILED: disclosure summary must state balanced defaulting",
      );
      process.exit(1);
    }
    if (!stdout.includes("secret detection cannot prove absence of secrets")) {
      console.error(
        "[runner-disclosure-validate] FAILED: disclosure summary must include redaction limitation",
      );
      process.exit(1);
    }

    const reviewScope = await readJson(reviewScopePath);
    const scannerFindingSet = await readJson(scannerOutputPath);
    const produced = await readJson(disclosureOutputPath);
    assertNoForbiddenText(JSON.stringify(produced), "disclosure policy JSON");

    console.log("[runner-disclosure-validate] Loading protocol schemas ...");
    const { schemaMap } = await loadSchemas();
    const schemaId = "urn:codeattest:protocol:v0:disclosure-policy";
    const schema = schemaMap.get(schemaId);
    if (!schema) {
      console.error(
        `[runner-disclosure-validate] FATAL: schema ${schemaId} not loaded; check protocol/schemas/disclosure-policy.schema.json $id.`,
      );
      process.exit(1);
    }

    console.log("[runner-disclosure-validate] Validating emitted JSON against schema ...");
    const errors = [
      ...validateAgainstSchema(produced, schema, schemaMap),
      ...(await validateFixtureSemantics(produced, {
        fixtureRoot: tmpRoot,
        syntheticMarkers: MARKERS.split(" "),
      })),
    ];
    if (errors.length > 0) {
      console.error(
        `[runner-disclosure-validate] FAILED: ${errors.length} validation error(s):`,
      );
      for (const err of errors) {
        console.error(`  - ${err.message}`);
      }
      process.exit(1);
    }

    if (produced.review_scope_ref !== reviewScope.review_scope_id) {
      failStructural("review_scope_ref must match emitted review_scope_id", produced);
    }
    if (produced.scanner_finding_set_ref !== scannerFindingSet.scanner_finding_set_id) {
      failStructural(
        "scanner_finding_set_ref must match emitted scanner_finding_set_id",
        produced,
      );
    }
    {
      const disclosureIdentityInput = JSON.parse(JSON.stringify(produced));
      delete disclosureIdentityInput.disclosure_policy_id;
      const expectedDisclosurePolicyId = sha256IdFromCanonical(disclosureIdentityInput);
      if (produced.disclosure_policy_id !== expectedDisclosurePolicyId) {
        failStructural(`disclosure_policy_id must be ${expectedDisclosurePolicyId}`, produced);
      }
    }
    if (produced.coverage_mode !== "finding_context_snippets") {
      failStructural("coverage mode must default to finding_context_snippets", produced);
    }
    if (category(produced, "raw_snippets")?.source_derived_class !== "transient_source_derived") {
      failStructural("Raw Snippets must default to transient_source_derived", produced);
    }
    if (category(produced, "targeted_files")?.included !== false) {
      failStructural("targeted files must be excluded in finding-context mode", produced);
    }
    if (produced.retention_policy?.retain_source_opt_in !== false) {
      failStructural("retained source opt-in must be false by default", produced);
    }

    console.log(
      "[runner-disclosure-validate] OK: produced disclosure policy conforms to schema and disclosure invariants.",
    );
    console.log(
      `[runner-disclosure-validate]   disclosure_policy_id = ${produced.disclosure_policy_id}`,
    );
    console.log(
      `[runner-disclosure-validate]   coverage_mode = ${produced.coverage_mode}`,
    );
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
