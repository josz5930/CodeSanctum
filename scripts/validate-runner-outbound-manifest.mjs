#!/usr/bin/env node
// Story 1.7 runner schema conformance gate.
// Builds the local runner scaffold, emits local review-scope, scanner finding
// set, and disclosure-policy artifacts, runs manifest preview, validates the
// outbound manifest against the protocol schema and semantic checks, and
// verifies the manifest identity excludes manifest_id.

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
    console.error(`[runner-manifest-validate] FAILED: ${title}`);
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
  console.log("[runner-manifest-validate] Building local runner scaffold ...");
  run(
    "cargo build --release",
    [CARGO, "build", "--release", "-p", "onevps-local-runner-scaffold"],
    { cwd: resolveProjectPath() },
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

async function writeScannerConfig(root) {
  await mkdir(root, { recursive: true });
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
        semgrep_json_inputs: [],
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
  console.error(`[runner-manifest-validate] FAILED: ${message}`);
  console.error(JSON.stringify(produced, null, 2));
  process.exit(1);
}

function assertNoForbiddenText(text, label) {
  const forbiddenLiterals = [{ literal: "eval('1 + 1')", label: "eval('1 + 1')" }];
  const forbiddenPhrases = [
    "no vulnerabilities",
    "approved by",
    "signed by",
    "certified by",
    "is certified",
    "is approved",
    "has been signed",
    "has been submitted",
    "has been received",
    "issue a receipt",
    "issued a receipt",
    "vendor receipt",
    "regulator acceptance",
    "auditor acceptance",
  ];
  // Word-boundary terms use JS regex \b (which treats "_" as a word char),
  // so identifiers like "not_submitted" and "submission_attempt_id" do not trip these.
  const forbiddenWordBoundaryTerms = [
    "attestation",
    "submitted",
    "received",
  ];

  for (const { literal, label: term } of forbiddenLiterals) {
    if (text.includes(literal)) {
      console.error(
        `[runner-manifest-validate] FAILED: ${label} contains forbidden term '${term}'`,
      );
      process.exit(1);
    }
  }
  const lower = text.toLowerCase();
  for (const phrase of forbiddenPhrases) {
    if (lower.includes(phrase)) {
      console.error(
        `[runner-manifest-validate] FAILED: ${label} contains forbidden phrase '${phrase}'`,
      );
      process.exit(1);
    }
  }
  for (const term of forbiddenWordBoundaryTerms) {
    const pattern = new RegExp(`\\b${term}\\b`, "i");
    if (pattern.test(text)) {
      console.error(
        `[runner-manifest-validate] FAILED: ${label} contains forbidden term '${term}'`,
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

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.7-"));
  const fixtureRoot = path.join(tmpRoot, "app");
  const scannerRoot = path.join(tmpRoot, "scanner");
  const reviewScopePath = path.join(tmpRoot, "review-scope.json");
  const scannerOutputPath = path.join(tmpRoot, "scanner-findings.json");
  const policyConfigPath = path.join(tmpRoot, "policy-config.json");
  const disclosureOutputPath = path.join(tmpRoot, "disclosure-policy.json");
  const manifestOutputPath = path.join(tmpRoot, "outbound-manifest.json");

  try {
    await mkdir(fixtureRoot, { recursive: true });
    await writeSyntheticApp(fixtureRoot);
    await writeScannerConfig(scannerRoot);
    await writePolicyConfig(tmpRoot);

    console.log("[runner-manifest-validate] Invoking scope init ...");
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

    console.log("[runner-manifest-validate] Invoking scan run ...");
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

    console.log("[runner-manifest-validate] Invoking disclosure configure ...");
    run("disclosure configure", [
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

    console.log("[runner-manifest-validate] Invoking manifest preview ...");
    const { stdout } = run("manifest preview", [
      binary,
      "manifest",
      "preview",
      "--scope",
      reviewScopePath,
      "--scanner-findings",
      scannerOutputPath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--output",
      manifestOutputPath,
    ]);
    assertNoForbiddenText(stdout, "manifest summary");
    for (const required of [
      "Outbound manifest preview generated",
      "manifest_id: sha256:",
      "Selected commit:",
      "Repository identity hash: sha256:",
      "Coverage Mode: Finding-context snippets (finding_context_snippets)",
      "Package preview state: preview_generated send_ready=false local_only=true",
      "Local-only boundary:",
      "source-code disclosure",
      "secret detection cannot prove absence of secrets",
    ]) {
      if (!stdout.includes(required)) {
        console.error(
          `[runner-manifest-validate] FAILED: manifest summary missing '${required}'`,
        );
        process.exit(1);
      }
    }

    const reviewScope = await readJson(reviewScopePath);
    const scannerFindingSet = await readJson(scannerOutputPath);
    const disclosurePolicy = await readJson(disclosureOutputPath);
    const produced = await readJson(manifestOutputPath);
    assertNoForbiddenText(JSON.stringify(produced), "outbound manifest JSON");

    console.log("[runner-manifest-validate] Loading protocol schemas ...");
    const { schemaMap } = await loadSchemas();
    const schemaId = "urn:codeattest:protocol:v0:outbound-manifest";
    const schema = schemaMap.get(schemaId);
    if (!schema) {
      console.error(
        `[runner-manifest-validate] FATAL: schema ${schemaId} not loaded; check protocol/schemas/outbound-manifest.schema.json $id.`,
      );
      process.exit(1);
    }

    console.log("[runner-manifest-validate] Validating emitted JSON against schema ...");
    const errors = [
      ...validateAgainstSchema(produced, schema, schemaMap),
      ...(await validateFixtureSemantics(produced, {
        fixtureRoot: tmpRoot,
        fixturePath: "runner/outbound-manifest.json",
        syntheticMarkers: MARKERS.split(" "),
      })),
    ];
    if (errors.length > 0) {
      console.error(
        `[runner-manifest-validate] FAILED: ${errors.length} validation error(s):`,
      );
      for (const err of errors) {
        console.error(`  - ${err.message}`);
      }
      process.exit(1);
    }

    const identityInput = JSON.parse(JSON.stringify(produced));
    delete identityInput.manifest_id;
    const computedManifestId = sha256IdFromCanonical(identityInput);
    if (produced.manifest_id !== computedManifestId) {
      failStructural("manifest_id must match canonical manifest content excluding manifest_id", produced);
    }
    if (produced.review_scope_ref !== reviewScope.review_scope_id) {
      failStructural("review_scope_ref must match emitted review_scope_id", produced);
    }
    if (produced.disclosure_policy_ref !== disclosurePolicy.disclosure_policy_id) {
      failStructural("disclosure_policy_ref must match emitted disclosure_policy_id", produced);
    }
    if (produced.scanner_finding_set_ref !== scannerFindingSet.scanner_finding_set_id) {
      failStructural("scanner_finding_set_ref must match emitted scanner_finding_set_id", produced);
    }
    if (produced.coverage_mode !== disclosurePolicy.coverage_mode) {
      failStructural("coverage_mode must match disclosure policy coverage_mode", produced);
    }
    if (produced.selected_scope_summary?.selected_commit?.commit_sha !== COMMIT) {
      failStructural("selected commit must be copyable in selected_scope_summary", produced);
    }
    if (produced.package_preview_state?.send_ready !== false || produced.package_preview_state?.local_only !== true) {
      failStructural("package preview state must not be send-ready", produced);
    }
    if (produced.approval?.approval_state !== "not_requested") {
      failStructural("approval state must remain not_requested", produced);
    }
    if (category(produced, "raw_snippets")?.source_code_disclosure !== true) {
      failStructural("Raw Snippets must be labeled source-code disclosure", produced);
    }
    if (category(produced, "targeted_files")?.included !== false) {
      failStructural("targeted files must be excluded in finding-context mode", produced);
    }
    if (!category(produced, "never_collected_items")?.details?.join(" ").includes("local environment secrets")) {
      failStructural("never_collected_items must include local environment secrets", produced);
    }
    if (produced.artifact_references?.some((artifact) => ["raw_snippet", "targeted_file"].includes(artifact.artifact_type))) {
      failStructural("manifest preview must not emit raw snippet or targeted file artifact references", produced);
    }

    console.log(
      "[runner-manifest-validate] OK: produced outbound manifest conforms to schema, semantics, identity, and preview invariants.",
    );
    console.log(`[runner-manifest-validate]   manifest_id = ${produced.manifest_id}`);
    console.log(`[runner-manifest-validate]   coverage_mode = ${produced.coverage_mode}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
