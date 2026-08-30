import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-submit-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-submit-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const { validateProtocolSchema } = await import(pathToFileURL(path.join(outDir, "validation.js")).href);

  const attempt = (overrides) => ({
    protocol_version: "codeattest.v0",
    attempt_id: "runner_attempt:submit-synthetic-0001",
    stage: "submit",
    outcome: "succeeded",
    review_state: "signed_bundle_not_submitted",
    approval_state: "approved",
    bundle_state: "ready_not_submitted",
    remote_state: "received_with_receipt",
    occurred_at: "2026-08-16T12:00:00Z",
    runner: { name: "codeattest-local-runner", version: "0.0.0" },
    runner_trust: {
      runner_name: "codeattest-local-runner",
      runner_version: "0.0.0",
      build_identifier: "SYNTHETIC_DEMO_DATA local build",
      release_identifier: "NOT_CUSTOMER_SOURCE unreleased",
      release_signature_status: "unsigned_local_build",
      bundle_signing_mode: "enrolled_runner_key",
      trust_label: "demo_only_unsigned",
      evidence_boundary: "synthetic-demo-only",
      limitations: ["SYNTHETIC_DEMO_DATA demo runner. NOT_CUSTOMER_SOURCE."]
    },
    identities: {
      selected_commit: "a".repeat(40),
      repository_identity: `sha256:${"b".repeat(64)}`,
      manifest_id: `sha256:${"c".repeat(64)}`,
      approval_id: "approval:synthetic-demo-0001",
      evidence_bundle_id: `sha256:${"d".repeat(64)}`,
      bundle_instance_id: "bundle_instance:synthetic-demo-0001",
      submission_attempt_id: "submission_attempt:synthetic-demo-0001",
      vendor_receipt_id: `sha256:${"e".repeat(64)}`,
      submission_outcome_id: "submission_outcome:synthetic-demo-0001"
    },
    approval_metadata: { decision: "approved", decided_at: "2026-08-16T11:00:00Z" },
    diagnostics: {
      message: "SYNTHETIC_DEMO_DATA transport completed. NOT_CUSTOMER_SOURCE.",
      retryable: false,
      sensitive_detail_omitted: true,
      raw_snippets_printed: false,
      support_summary: "Verify the returned receipt locally."
    },
    next_actions: ["verify the receipt"],
    ...overrides
  });

  const errorsFor = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:local-runner-attempt", value);

  assert(errorsFor(attempt({})).length === 0, "a submit attempt with a receipt must validate");
  assert(errorsFor(attempt({ outcome: "failed", remote_state: "submit_attempted", identities: { ...attempt({}).identities, vendor_receipt_id: undefined, submission_outcome_id: undefined } })).length === 0, "an attempted-but-unanswered submit must validate");
  assert(errorsFor(attempt({ remote_state: "rejected_no_receipt", identities: { ...attempt({}).identities, vendor_receipt_id: undefined } })).length === 0, "a rejected submit must validate without a receipt id");

  // The amendment must stay additive: every pre-existing stage still validates.
  assert(errorsFor(attempt({
    stage: "scope_init",
    remote_state: "not_submitted",
    bundle_state: "not_created",
    review_state: "unapproved_not_submitted",
    approval_state: "not_requested",
    approval_metadata: undefined,
    identities: { selected_commit: "a".repeat(40), repository_identity: `sha256:${"b".repeat(64)}` }
  })).length === 0, "existing local-only stages must keep validating");

  // A remote state other than not_submitted is only meaningful on a submit stage.
  assert(errorsFor(attempt({ stage: "bundle_prepare" })).length > 0, "a non-submit stage must not claim a remote state");
  // A receipt id is only meaningful when a receipt was actually issued.
  assert(errorsFor(attempt({ remote_state: "rejected_no_receipt" })).length > 0, "a rejected submit must not carry vendor_receipt_id");

  console.log("Submit transport protocol amendment test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
