#!/usr/bin/env node
// Story 1.8 runner schema conformance gate.
// Builds the local runner scaffold, emits local protocol artifacts, prepares an
// approved signed local Evidence Bundle, validates the approval/bundle/signature
// chain, and proves declined approval creates no signed bundle.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalize,
  loadSchemas,
  readJson,
  resolveProjectPath,
  sha256Hex,
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
    console.error(`[runner-bundle-validate] FAILED: ${title}`);
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
  console.log("[runner-bundle-validate] Building local runner scaffold ...");
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

async function writeMetadataOnlyPolicyConfig(root) {
  await writeFile(
    path.join(root, "policy-config.json"),
    JSON.stringify(
      {
        coverage_mode: "metadata_only",
        include_scanner_findings: false,
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
  console.error(`[runner-bundle-validate] FAILED: ${message}`);
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
    "has been received",
    "vendor receipt",
    "received state",
    "attestation",
    "independent assurance",
  ];

  for (const { literal, label: term } of forbiddenLiterals) {
    if (text.includes(literal)) {
      console.error(
        `[runner-bundle-validate] FAILED: ${label} contains forbidden term '${term}'`,
      );
      process.exit(1);
    }
  }
  const lower = text.toLowerCase();
  for (const phrase of forbiddenPhrases) {
    if (lower.includes(phrase)) {
      console.error(
        `[runner-bundle-validate] FAILED: ${label} contains forbidden phrase '${phrase}'`,
      );
      process.exit(1);
    }
  }
}

async function assertValid(schemaMap, schemaId, value, fixtureRoot, fixturePath) {
  const schema = schemaMap.get(schemaId);
  if (!schema) {
    console.error(`[runner-bundle-validate] FATAL: schema ${schemaId} not loaded.`);
    process.exit(1);
  }
  const errors = [
    ...validateAgainstSchema(value, schema, schemaMap),
    ...(await validateFixtureSemantics(value, {
      fixtureRoot,
      fixturePath,
      syntheticMarkers: MARKERS.split(" "),
    })),
  ];
  if (errors.length > 0) {
    console.error(
      `[runner-bundle-validate] FAILED: ${fixturePath} has ${errors.length} validation error(s):`,
    );
    for (const err of errors) console.error(`  - ${err.message}`);
    process.exit(1);
  }
}

async function main() {
  const binary = await buildRunnerBinary();
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "onevps-story-1.8-"));
  const appRoot = path.join(tmpRoot, "app");
  const scannerRoot = path.join(tmpRoot, "scanner");
  const reviewScopePath = path.join(tmpRoot, "review-scope.json");
  const scannerOutputPath = path.join(tmpRoot, "scanner-findings.json");
  const policyConfigPath = path.join(tmpRoot, "policy-config.json");
  const disclosureOutputPath = path.join(tmpRoot, "disclosure-policy.json");
  const manifestOutputPath = path.join(tmpRoot, "outbound-manifest.json");
  const approvedBundleDir = path.join(tmpRoot, "approved-bundle");
  const declinedBundleDir = path.join(tmpRoot, "declined-bundle");

  try {
    await mkdir(appRoot, { recursive: true });
    await writeSyntheticApp(appRoot);
    await writeScannerConfig(scannerRoot);
    await writeMetadataOnlyPolicyConfig(tmpRoot);

    console.log("[runner-bundle-validate] Invoking scope init ...");
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

    console.log("[runner-bundle-validate] Invoking scan run ...");
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

    console.log("[runner-bundle-validate] Invoking disclosure configure ...");
    run("disclosure configure", [
      binary,
      "disclosure",
      "configure",
      "--scope",
      reviewScopePath,
      "--policy-config",
      policyConfigPath,
      "--output",
      disclosureOutputPath,
    ]);

    console.log("[runner-bundle-validate] Invoking manifest preview ...");
    run("manifest preview", [
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

    const manifest = await readJson(manifestOutputPath);
    console.log("[runner-bundle-validate] Invoking approved bundle prepare ...");
    const approvedOutput = run("bundle prepare approved", [
      binary,
      "bundle",
      "prepare",
      "--scope",
      reviewScopePath,
      "--disclosure-policy",
      disclosureOutputPath,
      "--manifest",
      manifestOutputPath,
      "--approving-actor",
      "maya@example.com",
      "--approval-decision",
      "approve",
      "--approval-confirmation",
      manifest.manifest_id,
      "--output-dir",
      approvedBundleDir,
    ]).stdout;
    assertNoForbiddenText(approvedOutput, "approved bundle summary");
    for (const required of [
      "Approval context",
      "manifest_id: sha256:",
      `Selected commit: ${COMMIT}`,
      "Repository identity hash: sha256:",
      "Coverage Mode: Metadata-only (metadata_only)",
      "Bundle preview summary",
      "Signed local Evidence Bundle prepared",
      "evidence_bundle_id: sha256:",
      "bundle_instance_id:",
      "submission_attempt_id:",
      "signing key: codeattest-local-runner-key",
      "signed with a real ML-DSA-65 signature under runner-held key custody",
      "not_submitted",
    ]) {
      if (!approvedOutput.includes(required)) {
        console.error(
          `[runner-bundle-validate] FAILED: approved summary missing '${required}'`,
        );
        process.exit(1);
      }
    }
    if (
      approvedOutput.indexOf("Approval context") >
      approvedOutput.indexOf("Signed local Evidence Bundle prepared")
    ) {
      failStructural("approval context must be printed before approved bundle result", approvedOutput);
    }

    const approval = await readJson(path.join(approvedBundleDir, "customer-approval.json"));
    const bundle = await readJson(path.join(approvedBundleDir, "bundle_manifest.json"));
    const signature = await readJson(path.join(approvedBundleDir, "signature-envelope.bundle.json"));
    assertNoForbiddenText(JSON.stringify(approval), "approval JSON");
    assertNoForbiddenText(JSON.stringify(bundle), "bundle JSON");
    assertNoForbiddenText(JSON.stringify(signature), "signature JSON");

    const { schemaMap } = await loadSchemas();
    await assertValid(
      schemaMap,
      "urn:codeattest:protocol:v0:customer-approval",
      approval,
      approvedBundleDir,
      "customer-approval.json",
    );
    await assertValid(
      schemaMap,
      "urn:codeattest:protocol:v0:bundle-manifest",
      bundle,
      approvedBundleDir,
      "bundle_manifest.json",
    );
    const signatureSchema = schemaMap.get("urn:codeattest:protocol:v0:signature-envelope");
    const signatureErrors = validateAgainstSchema(signature, signatureSchema, schemaMap);
    if (signatureErrors.length > 0) {
      failStructural("signature envelope must validate against schema", signatureErrors);
    }

    const identityInput = JSON.parse(JSON.stringify(bundle));
    delete identityInput.evidence_bundle_id;
    const canonical = canonicalize(identityInput);
    const computedBundleId = sha256IdFromCanonical(identityInput);
    if (canonical.includes(bundle.evidence_bundle_id)) {
      failStructural("canonical identity input must exclude evidence_bundle_id", bundle);
    }
    if (bundle.evidence_bundle_id !== computedBundleId) {
      failStructural("evidence_bundle_id must match canonical bundle content excluding itself", bundle);
    }
    if (signature.signed_identity !== bundle.evidence_bundle_id) {
      failStructural("signature signed_identity must match evidence_bundle_id", signature);
    }
    if (signature.signing_mode !== "enrolled_runner_key") {
      failStructural("signature must expose the enrolled_runner_key signing mode", signature);
    }
    // C7-22: the schema alone permits any of the 8 signed_identity_type values
    // and any non-empty key/limitation strings; this story gate must pin the
    // runner's actual expected values so a regression emitting the wrong
    // identity type, dropped key metadata, or missing synthetic-limitation
    // markers still fails this gate even though it is schema-valid.
    if (signature.signed_identity_type !== "evidence_bundle") {
      failStructural("signature signed_identity_type must be evidence_bundle", signature);
    }
    if (typeof signature.key_id !== "string" || signature.key_id.length === 0 || typeof signature.key_version !== "string" || signature.key_version.length === 0) {
      failStructural("signature must carry non-empty key_id/key_version", signature);
    }
    const limitationsText = (signature.signing_limitations ?? []).join(" ").toLowerCase();
    for (const requiredToken of ["key custody", "cannot attest that the runner code was unmodified"]) {
      if (!limitationsText.includes(requiredToken)) {
        failStructural(`signature signing_limitations must state "${requiredToken}"`, signature);
      }
    }
    // Real ML-DSA-65 signing is deterministic from the runner's own seed but
    // never byte-hardcoded here (D1's own testing discipline: verify, don't
    // assert exact bytes) -- check shape only. Full cryptographic
    // verification against the generated key is covered by
    // runner/crates/local-runner-scaffold/tests/keys.rs and
    // tests/cli_signed_evidence_bundle.rs.
    if (typeof signature.signature_bytes !== "string" || !/^ml_dsa_65:[A-Za-z0-9_-]{4412}$/u.test(signature.signature_bytes)) {
      failStructural("signature_bytes must be an ml_dsa_65: prefixed real ML-DSA-65 signature", signature);
    }
    if (bundle.bundle_state !== "not_submitted") {
      failStructural("bundle must remain not_submitted", bundle);
    }
    if (existsSync(path.join(approvedBundleDir, "artifacts/source-derived"))) {
      failStructural("metadata-only bundle must not create source-derived artifact directory", bundle);
    }
    for (const artifact of bundle.artifact_references ?? []) {
      const contentPath = artifact.content_path;
      if (typeof contentPath !== "string") continue;
      const artifactPath = path.join(approvedBundleDir, contentPath);
      if (!existsSync(artifactPath)) {
        failStructural(`bundle artifact copy missing for ${artifact.artifact_ref}`, artifact);
      }
      const bytes = await readFile(artifactPath);
      const digest = `sha256:${sha256Hex(bytes)}`;
      if (digest !== artifact.digest || bytes.length !== artifact.size_bytes) {
        failStructural(`bundle artifact copy digest/size mismatch for ${artifact.artifact_ref}`, artifact);
      }
    }

    console.log("[runner-bundle-validate] Invoking declined bundle prepare ...");
    const declinedOutput = run("bundle prepare declined", [
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
      "decline",
      "--output-dir",
      approvedBundleDir,
    ]).stdout;
    assertNoForbiddenText(declinedOutput, "declined bundle summary");
    for (const required of [
      "not_submitted",
      "No signed Evidence Bundle was created",
      "No evidence was sent",
      "revise policy",
      "rerun scan",
      "export manifest",
      "exit",
    ]) {
      if (!declinedOutput.includes(required)) {
        console.error(
          `[runner-bundle-validate] FAILED: declined summary missing '${required}'`,
        );
        process.exit(1);
      }
    }
    const declinedApproval = await readJson(path.join(approvedBundleDir, "customer-approval.json"));
    await assertValid(
      schemaMap,
      "urn:codeattest:protocol:v0:customer-approval",
      declinedApproval,
      declinedBundleDir,
      "customer-approval.json",
    );
    if (existsSync(path.join(approvedBundleDir, "bundle_manifest.json"))) {
      failStructural("declined approval must not write bundle_manifest.json", declinedApproval);
    }
    if (existsSync(path.join(approvedBundleDir, "signature-envelope.bundle.json"))) {
      failStructural("declined approval must not write signature envelope", declinedApproval);
    }
    if (existsSync(path.join(approvedBundleDir, "artifacts"))) {
      failStructural("declined approval must remove stale signed bundle artifacts", declinedApproval);
    }

    console.log(
      "[runner-bundle-validate] OK: approved and declined bundle flows conform to schema, identity, signature, privacy, and claim-safe invariants.",
    );
    console.log(`[runner-bundle-validate]   evidence_bundle_id = ${bundle.evidence_bundle_id}`);
    console.log(`[runner-bundle-validate]   bundle_state = ${bundle.bundle_state}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

await main();
