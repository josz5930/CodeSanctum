#!/usr/bin/env node
// Story 1.9 runner conformance gate.
// Builds the local runner, forces local failure/status/rerun/trust states, and
// validates emitted local-runner-attempt records against protocol semantics.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadSchemas,
  readJson,
  resolveProjectPath,
  validateAgainstSchema,
  validateFixtureSemantics,
} from "./lib/protocol-utils.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const MARKERS = ["SYNTHETIC_DEMO_DATA", "NOT_CUSTOMER_SOURCE"];

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
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    env: RUST_ENV,
    ...opts,
  });
  if (result.error || result.status !== 0) {
    console.error(`[runner-story-1.9] FAILED: ${title}`);
    if (result.error) console.error(`  error: ${result.error.message}`);
    console.error(`  status: ${result.status}`);
    if (result.stderr) console.error(`  stderr:\n${result.stderr}`);
    if (result.stdout) console.error(`  stdout:\n${result.stdout}`);
    process.exit(1);
  }
  return result;
}

function runAllowFailure(title, args, opts = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    encoding: "utf8",
    env: RUST_ENV,
    ...opts,
  });
  if (result.error) {
    console.error(`[runner-story-1.9] FAILED: ${title}`);
    console.error(`  error: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

async function buildRunnerBinary() {
  console.log("[runner-story-1.9] Building local runner scaffold ...");
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
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        _synthetic_marker: MARKERS.join(" "),
        dependencies: { react: "19.2.7" },
        devDependencies: { typescript: "6.0.3" },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    path.join(root, "src/app.ts"),
    `// ${MARKERS.join(" ")}\nexport const result = eval('1 + 1');\n`,
  );
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

async function writePolicyConfig(root, coverageMode, includeScannerFindings) {
  await writeFile(
    path.join(root, "policy-config.json"),
    JSON.stringify(
      {
        coverage_mode: coverageMode,
        include_scanner_findings: includeScannerFindings,
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

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    console.error(`[runner-story-1.9] FAILED: ${label} missing '${expected}'`);
    console.error(text);
    process.exit(1);
  }
}

function assertNoForbiddenText(text, label) {
  const lower = text.toLowerCase();
  for (const forbidden of [
    "eval('1 + 1')",
    "vendor receipt",
    "received state",
    "has been received",
    "review complete",
    "finalized",
    "certified",
    "no vulnerabilities",
    "independent assurance",
  ]) {
    if (lower.includes(forbidden)) {
      console.error(`[runner-story-1.9] FAILED: ${label} contains '${forbidden}'`);
      process.exit(1);
    }
  }
}

async function readAttempts(attemptLogPath) {
  const raw = await readFile(attemptLogPath, "utf8");
  const attempts = [];
  const errors = [];
  raw.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    try {
      attempts.push(JSON.parse(line));
    } catch (parseError) {
      errors.push(`line ${index + 1}: ${parseError.message}`);
    }
  });
  if (errors.length > 0) {
    console.error(
      `[runner-story-1.9] FAILED: attempt log ${attemptLogPath} has ${errors.length} malformed line(s):`
    );
    for (const message of errors) console.error(`  - ${message}`);
    process.exit(1);
  }
  return attempts;
}

async function assertValidAttempt(schemaMap, attempt, label) {
  const schema = schemaMap.get("urn:codeattest:protocol:v0:local-runner-attempt");
  const errors = [
    ...validateAgainstSchema(attempt, schema, schemaMap),
    ...(await validateFixtureSemantics(attempt, {
      fixtureRoot: resolveProjectPath("protocol/fixtures"),
      fixturePath: label,
      syntheticMarkers: MARKERS,
    })),
  ];
  if (errors.length > 0) {
    console.error(`[runner-story-1.9] FAILED: ${label} attempt validation errors:`);
    for (const error of errors) console.error(`  - ${error.message}`);
    console.error(JSON.stringify(attempt, null, 2));
    process.exit(1);
  }
}

async function main() {
  const binary = await buildRunnerBinary();
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.9-"));
  const appRoot = path.join(tmpRoot, "app");
  const scannerRoot = path.join(tmpRoot, "scanner");
  const reviewScopePath = path.join(tmpRoot, "review-scope.json");
  const scannerOutputPath = path.join(tmpRoot, "scanner-findings.json");
  const disclosureOutputPath = path.join(tmpRoot, "disclosure-policy.json");
  const manifestOutputPath = path.join(tmpRoot, "outbound-manifest.json");
  const failureBundleDir = path.join(tmpRoot, "failure-bundle");
  const approvedBundleDir = path.join(tmpRoot, "approved-bundle");
  const rerunBundleDir = path.join(tmpRoot, "rerun-bundle");
  const attemptLogPath = path.join(tmpRoot, "attempts.jsonl");

  try {
    await mkdir(appRoot, { recursive: true });
    await writeSyntheticApp(appRoot);
    await writeScannerConfig(scannerRoot);

    run("scope init", [
      binary,
      "scope",
      "init",
      "--application-path",
      appRoot,
      "--review-id",
      "review:synthetic-demo-001",
      "--commit",
      COMMIT,
      "--output",
      reviewScopePath,
    ]);
    run("scan run", [
      binary,
      "scan",
      "run",
      "--application-path",
      appRoot,
      "--scope",
      reviewScopePath,
      "--scanner-config",
      path.join(scannerRoot, "scanner-config.json"),
      "--output",
      scannerOutputPath,
    ]);

    await writePolicyConfig(tmpRoot, "finding_context_snippets", true);
    run("disclosure configure finding-context", [
      binary,
      "disclosure",
      "configure",
      "--scope",
      reviewScopePath,
      "--scanner-findings",
      scannerOutputPath,
      "--policy-config",
      path.join(tmpRoot, "policy-config.json"),
      "--output",
      disclosureOutputPath,
    ]);
    run("manifest preview finding-context", [
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
    const findingContextManifest = await readJson(manifestOutputPath);

    const failure = runAllowFailure("post-approval packaging failure", [
      binary,
      "bundle",
      "prepare",
      "--scope",
      reviewScopePath,
      "--scanner-findings",
      scannerOutputPath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--manifest",
      manifestOutputPath,
      "--approving-actor",
      "maya@example.com",
      "--approval-decision",
      "approve",
      "--approval-confirmation",
      findingContextManifest.manifest_id,
      "--output-dir",
      failureBundleDir,
      "--attempt-log",
      attemptLogPath,
    ]);
    if (failure.status === 0) {
      console.error("[runner-story-1.9] FAILED: expected packaging failure");
      process.exit(1);
    }
    assertIncludes(failure.stderr, "Stage failed: bundle_packaging", "failure stderr");
    assertIncludes(failure.stderr, "Review state: approved_no_signed_bundle", "failure stderr");
    assertIncludes(failure.stderr, "No signed Evidence Bundle is ready.", "failure stderr");
    assertNoForbiddenText(failure.stderr, "failure stderr");
    if (!existsSync(path.join(failureBundleDir, "customer-approval.json"))) {
      console.error("[runner-story-1.9] FAILED: post-approval failure did not preserve customer-approval.json");
      process.exit(1);
    }
    if (existsSync(path.join(failureBundleDir, "bundle_manifest.json"))) {
      console.error("[runner-story-1.9] FAILED: failed packaging wrote bundle_manifest.json");
      process.exit(1);
    }

    await writePolicyConfig(tmpRoot, "metadata_only", false);
    run("disclosure configure metadata-only", [
      binary,
      "disclosure",
      "configure",
      "--scope",
      reviewScopePath,
      "--policy-config",
      path.join(tmpRoot, "policy-config.json"),
      "--output",
      disclosureOutputPath,
    ]);
    run("manifest preview metadata-only", [
      binary,
      "manifest",
      "preview",
      "--scope",
      reviewScopePath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--output",
      manifestOutputPath,
    ]);
    const metadataManifest = await readJson(manifestOutputPath);
    run("approved metadata bundle", [
      binary,
      "bundle",
      "prepare",
      "--scope",
      reviewScopePath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--manifest",
      manifestOutputPath,
      "--approval-decision",
      "approve",
      "--approval-confirmation",
      metadataManifest.manifest_id,
      "--output-dir",
      approvedBundleDir,
      "--attempt-log",
      attemptLogPath,
    ]);
    const firstBundle = await readJson(path.join(approvedBundleDir, "bundle_manifest.json"));
    const reuse = run("explicit approval reuse", [
      binary,
      "bundle",
      "prepare",
      "--scope",
      reviewScopePath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--manifest",
      manifestOutputPath,
      "--reuse-approval",
      path.join(approvedBundleDir, "customer-approval.json"),
      "--approval-context-choice",
      "reuse-approved-manifest",
      "--output-dir",
      rerunBundleDir,
      "--attempt-log",
      attemptLogPath,
    ]);
    assertIncludes(reuse.stdout, "Approval context reuse selected", "reuse stdout");
    assertIncludes(reuse.stdout, "attempt_id:", "reuse stdout");
    const rerunBundle = await readJson(path.join(rerunBundleDir, "bundle_manifest.json"));
    if (
      firstBundle.bundle_instance_id === rerunBundle.bundle_instance_id ||
      firstBundle.submission_attempt_id === rerunBundle.submission_attempt_id
    ) {
      console.error("[runner-story-1.9] FAILED: rerun did not create distinct bundle attempt identifiers");
      process.exit(1);
    }

    const status = run("bundle status", [
      binary,
      "bundle",
      "status",
      "--scope",
      reviewScopePath,
      "--manifest",
      manifestOutputPath,
      "--output-dir",
      rerunBundleDir,
      "--attempt-log",
      attemptLogPath,
    ]);
    assertIncludes(status.stdout, "Review state: signed_bundle_not_submitted", "status stdout");
    assertIncludes(status.stdout, "Remote state: not_submitted", "status stdout");
    assertNoForbiddenText(status.stdout, "status stdout");

    const trust = run("runner trust", [
      binary,
      "runner",
      "trust",
      "--attempt-log",
      attemptLogPath,
    ]);
    assertIncludes(trust.stdout, "Release signature status: unsigned_local_build", "trust stdout");
    assertIncludes(trust.stdout, "Trust label: demo_only_unsigned", "trust stdout");
    assertIncludes(trust.stdout, "Bundle signing mode: enrolled_runner_key", "trust stdout");

    const attempts = await readAttempts(attemptLogPath);
    const { schemaMap } = await loadSchemas();
    for (const [index, attempt] of attempts.entries()) {
      await assertValidAttempt(schemaMap, attempt, `attempt ${index}`);
      assertNoForbiddenText(JSON.stringify(attempt), `attempt ${index}`);
    }
    if (!attempts.some((attempt) => attempt.stage === "bundle_packaging" && attempt.outcome === "failed")) {
      console.error("[runner-story-1.9] FAILED: attempt log missing bundle_packaging failure");
      process.exit(1);
    }
    if (!attempts.some((attempt) => attempt.stage === "status_inspect")) {
      console.error("[runner-story-1.9] FAILED: attempt log missing status_inspect record");
      process.exit(1);
    }
    if (!attempts.some((attempt) => attempt.stage === "runner_trust")) {
      console.error("[runner-story-1.9] FAILED: attempt log missing runner_trust record");
      process.exit(1);
    }

    // C7-25: the gate only asserted the *packaging failure* was logged; a
    // regression that silently stopped logging successful bundle_prepare
    // attempts (for the original approved bundle or the reused-approval
    // rerun) would still pass as long as files/stdout were produced. Require
    // one distinct successful bundle_prepare record bound to each of the two
    // bundle identities actually produced above.
    const successfulBundlePrepareAttempts = attempts.filter((attempt) =>
      attempt.stage === "bundle_prepare" &&
      attempt.outcome === "succeeded" &&
      attempt.review_state === "signed_bundle_not_submitted" &&
      attempt.bundle_state === "ready_not_submitted" &&
      attempt.remote_state === "not_submitted"
    );
    if (successfulBundlePrepareAttempts.length < 2) {
      console.error("[runner-story-1.9] FAILED: attempt log missing successful bundle_prepare records");
      process.exit(1);
    }
    for (const [label, expectedBundle] of [["first bundle", firstBundle], ["rerun bundle", rerunBundle]]) {
      const bound = successfulBundlePrepareAttempts.some((attempt) =>
        attempt.identities?.evidence_bundle_id === expectedBundle.evidence_bundle_id &&
        attempt.identities?.bundle_instance_id === expectedBundle.bundle_instance_id &&
        attempt.identities?.submission_attempt_id === expectedBundle.submission_attempt_id
      );
      if (!bound) {
        console.error(`[runner-story-1.9] FAILED: no successful bundle_prepare attempt record bound to the ${label} identities`);
        process.exit(1);
      }
    }

    console.log("[runner-story-1.9] OK: failure, rerun, status, trust, and attempt records validated.");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
