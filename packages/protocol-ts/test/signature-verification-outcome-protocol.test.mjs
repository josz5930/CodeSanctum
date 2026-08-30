import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const outDir = await mkdtemp(path.join(tmpdir(), "onevps-verification-outcome-"));

try {
  execFileSync("npx", ["tsc", "-p", path.join(workspacePath, "tsconfig.json"), "--outDir", outDir, "--noEmit", "false"], { stdio: "inherit" });
  const { validateProtocolSchema } = await import(pathToFileURL(path.join(outDir, "index.js")).href);

  const outcome = (overrides) => ({
    protocol_version: "codeattest.v0",
    signed_identity_type: "vendor_receipt",
    signed_identity: `sha256:${"a".repeat(64)}`,
    algorithm_profile: "ml_dsa_65",
    key_id: "codeattest-demo-signing-key",
    key_version: "v1",
    key_directory_version: 1,
    verified_at: "2026-08-16T00:00:00Z",
    result: "verified",
    ...overrides
  });

  const errors = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:signature-verification-outcome", value);

  assert.equal(errors(outcome({})).length, 0, "a well-formed verified outcome must validate");

  for (const result of [
    "signature_bytes_untrusted",
    "signature_key_unknown",
    "signature_key_revoked",
    "signature_key_outside_validity_window",
    "signature_key_algorithm_mismatch",
    "signature_key_directory_untrusted",
    "signature_signing_input_mismatch"
  ]) {
    assert.equal(errors(outcome({ result })).length, 0, `${result} must be an accepted outcome`);
    // Every failure result is also a legal submission-outcome reason code, so
    // the pure tier can forward it without a translation table.
    assert.match(result, /^[a-z][a-z0-9_]{2,63}$/, `${result} must satisfy the reason-code grammar`);
  }

  assert.ok(errors(outcome({ result: "probably_fine" })).length > 0, "an unknown result must be rejected");
  assert.ok(errors(outcome({ algorithm_profile: "ml_dsa_65_demo_pilot" })).length > 0, "an outcome may only describe a real ml_dsa_65 verification");
  assert.ok(errors(outcome({ key_directory_version: 0 })).length > 0, "key_directory_version must start at 1");
  assert.ok(errors(outcome({ verified_at: "2026-02-30T00:00:00Z" })).length > 0, "an impossible calendar date must be rejected");
  assert.ok(errors(outcome({ signed_identity: "not-a-digest" })).length > 0, "signed_identity must be an algorithm-prefixed sha256 id");
  assert.ok(errors({ ...outcome({}), extra_field: true }).length > 0, "the schema must be closed");

  console.log("signature-verification-outcome protocol test passed.");
} finally {
  await rm(outDir, { recursive: true, force: true });
}
