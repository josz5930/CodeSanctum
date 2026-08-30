import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ml-dsa-protocol-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-ml-dsa-test-dist");

const SIGNATURE_CHARS = 4412;
const PUBLIC_KEY_CHARS = 2603;

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin, "-p", "tsconfig.json", "--outDir", outDir,
    "--tsBuildInfoFile", path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });

  const { validateProtocolSchema } = await import(pathToFileURL(path.join(outDir, "validation.js")).href);

  const envelope = (overrides) => ({
    protocol_version: "codeattest.v0",
    algorithm_profile: "ml_dsa_65",
    key_id: "codeattest-vendor-signing-key",
    key_version: "v1",
    signing_time: "2026-08-16T12:00:00Z",
    signed_identity_type: "vendor_receipt",
    signed_identity: `sha256:${"a".repeat(64)}`,
    canonicalization: "rfc8785",
    signing_mode: "managed_key",
    signing_limitations: ["SYNTHETIC_DEMO_DATA Test envelope. NOT_CUSTOMER_SOURCE."],
    signature_bytes: `ml_dsa_65:${"A".repeat(SIGNATURE_CHARS)}`,
    ...overrides
  });

  const errorsFor = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", value);

  assert(errorsFor(envelope({})).length === 0, "a well-formed ml_dsa_65 envelope must validate");
  assert(errorsFor(envelope({ signing_mode: "enrolled_runner_key" })).length === 0, "enrolled_runner_key must be an accepted signing mode");
  // D3-1: the demo profile, the synthetic signing mode, and the synthetic
  // signature-bytes form are retired -- each must now be rejected on its own.
  assert(errorsFor(envelope({ algorithm_profile: "ml_dsa_65_demo_pilot" })).length > 0, "the retired demo algorithm profile must be rejected");
  assert(errorsFor(envelope({ signing_mode: "synthetic_demo" })).length > 0, "the retired synthetic_demo signing mode must be rejected");
  assert(errorsFor(envelope({ signing_mode: "demo_file_backed" })).length > 0, "the retired demo_file_backed signing mode must be rejected");
  assert(errorsFor(envelope({ signature_bytes: `synthetic_demo_sha256:${"a".repeat(64)}` })).length > 0, "retired synthetic signature bytes must be rejected");

  // Exact-length enforcement: 3309 bytes is divisible by 3, so 4412 is the
  // only valid length and a padding character can never appear.
  for (const wrong of [SIGNATURE_CHARS - 1, SIGNATURE_CHARS + 1]) {
    assert(errorsFor(envelope({ signature_bytes: `ml_dsa_65:${"A".repeat(wrong)}` })).length > 0, `a ${wrong}-character signature must be rejected`);
  }
  assert(errorsFor(envelope({ signature_bytes: `ml_dsa_65:${"A".repeat(SIGNATURE_CHARS - 1)}=` })).length > 0, "base64 padding must be rejected");
  assert(errorsFor(envelope({ signature_bytes: `ml_dsa_65:${"+".repeat(SIGNATURE_CHARS)}` })).length > 0, "standard-base64 alphabet must be rejected; base64url only");
  assert(errorsFor(envelope({ signature_bytes: "A".repeat(SIGNATURE_CHARS) })).length > 0, "an unprefixed signature must be rejected");

  const signingInput = {
    protocol_version: "codeattest.v0",
    signing_input_type: "vendor_receipt_identity",
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: "vendor_receipt",
    signed_identity: `sha256:${"a".repeat(64)}`,
    canonicalization: "rfc8785",
    identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
  };
  assert(validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", signingInput).length === 0, "identity-signing-input must accept the ml_dsa_65 profile");

  // `PUBLIC_KEY_CHARS` is used by the Task 6 assertions appended to this file.
  // `ml_dsa_65_public_key` is not asserted directly here: validateProtocolSchema
  // resolves only top-level schema IDs, not `#/$defs/` fragments, so a $def is
  // exercised through a schema that $refs it — which `signing-key-record` does
  // in Task 6.
  assert(PUBLIC_KEY_CHARS === 2603, "an ML-DSA-65 raw public key is 1952 bytes, or 2603 base64url characters");

  const keyRecord = (overrides) => ({
    protocol_version: "codeattest.v0",
    key_id: "codeattest-vendor-signing-key",
    key_version: "v1",
    algorithm_profile: "ml_dsa_65",
    public_key: "A".repeat(PUBLIC_KEY_CHARS),
    custody_mode: "self_hosted_software",
    valid_from: "2026-08-16T00:00:00Z",
    valid_until: "2027-08-16T00:00:00Z",
    status: "active",
    limitations: ["SYNTHETIC_DEMO_DATA Test key record. NOT_CUSTOMER_SOURCE."],
    ...overrides
  });

  const keyRecordErrors = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:signing-key-record", value);
  assert(keyRecordErrors(keyRecord({})).length === 0, "a well-formed signing-key-record must validate");
  for (const status of ["retired", "revoked"]) {
    assert(keyRecordErrors(keyRecord({ status })).length === 0, `${status} must be an accepted key status`);
  }
  assert(keyRecordErrors(keyRecord({ status: "expired" })).length > 0, "an unknown key status must be rejected");
  assert(keyRecordErrors(keyRecord({ custody_mode: "hardware_security_module" })).length > 0, "custody modes the deployment cannot provide must be rejected");
  assert(keyRecordErrors(keyRecord({ public_key: "A".repeat(PUBLIC_KEY_CHARS - 1) })).length > 0, "a wrong-length public key must be rejected");
  assert(keyRecordErrors(keyRecord({ valid_until: undefined })).length === 0, "valid_until must be optional for a key with no scheduled expiry");

  const directory = {
    protocol_version: "codeattest.v0",
    directory_version: 1,
    trust_anchor_key_id: "codeattest-offline-trust-anchor",
    published_at: "2026-08-16T00:00:00Z",
    keys: [keyRecord({})],
    directory_signature: {
      protocol_version: "codeattest.v0",
      algorithm_profile: "ml_dsa_65",
      key_id: "codeattest-offline-trust-anchor",
      key_version: "v1",
      signing_time: "2026-08-16T00:00:00Z",
      signed_identity_type: "signing_key_directory",
      signed_identity: `sha256:${"a".repeat(64)}`,
      canonicalization: "rfc8785",
      signing_mode: "managed_key",
      signing_limitations: ["SYNTHETIC_DEMO_DATA Test directory. NOT_CUSTOMER_SOURCE."],
      signature_bytes: `ml_dsa_65:${"A".repeat(SIGNATURE_CHARS)}`
    }
  };
  const directoryErrors = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:signing-key-directory", value);
  assert(directoryErrors(directory).length === 0, "a well-formed signing-key-directory must validate");
  assert(directoryErrors({ ...directory, directory_version: 0 }).length > 0, "directory_version must start at 1");
  assert(directoryErrors({ ...directory, keys: [] }).length > 0, "an empty directory must be rejected");

  const enrollment = {
    protocol_version: "codeattest.v0",
    enrollment_id: "runner_enrollment:pilot-partner-one",
    review_id: "review:pilot-partner-one",
    runner_key_id: "codeattest-runner-pilot-partner-one",
    runner_key_version: "v1",
    algorithm_profile: "ml_dsa_65",
    public_key: "A".repeat(PUBLIC_KEY_CHARS),
    enrollment_method: "operator_verified",
    enrolled_at: "2026-08-16T00:00:00Z",
    limitations: ["SYNTHETIC_DEMO_DATA Test enrollment. NOT_CUSTOMER_SOURCE."]
  };
  const enrollmentErrors = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:runner-key-enrollment-record", value);
  assert(enrollmentErrors(enrollment).length === 0, "a well-formed runner-key-enrollment-record must validate");
  assert(enrollmentErrors({ ...enrollment, enrollment_method: "implicit" }).length > 0, "an unknown enrollment method must be rejected");
  assert(enrollmentErrors({ ...enrollment, review_id: "not-a-review-id" }).length > 0, "review_id must match the protocol identity grammar");

  const release = (overrides) => ({
    protocol_version: "codeattest.v0",
    release_identifier: "codeattest-local-runner-v0.1.0",
    build_identifier: "ci-build-0001",
    artifact_digest: `sha256:${"c".repeat(64)}`,
    released_at: "2026-08-16T00:00:00Z",
    limitations: ["SYNTHETIC_DEMO_DATA Test release record. NOT_CUSTOMER_SOURCE."],
    ...overrides
  });
  const releaseErrors = (value) => validateProtocolSchema("urn:codeattest:protocol:v0:runner-release-record", value);
  assert(releaseErrors(release({})).length === 0, "a well-formed runner-release-record must validate");
  assert(releaseErrors(release({ artifact_digest: "sha1:abc" })).length > 0, "the artifact digest must be an algorithm-prefixed sha256 id");
  assert(releaseErrors(release({ released_at: "2026-02-30T00:00:00Z" })).length > 0, "an impossible calendar date must be rejected");
  assert(releaseErrors({ ...release({}), extra_field: 1 }).length > 0, "the schema must be closed");

  const releaseSigningInput = {
    protocol_version: "codeattest.v0",
    signing_input_type: "runner_release_identity",
    algorithm_profile: "ml_dsa_65",
    signed_identity_type: "runner_release",
    signed_identity: `sha256:${"d".repeat(64)}`,
    canonicalization: "rfc8785",
    identity_input_path: "v0/valid/runner-release-record.identity-input.json"
  };
  assert(validateProtocolSchema("urn:codeattest:protocol:v0:identity-signing-input", releaseSigningInput).length === 0, "runner_release must be a signable identity type");

  console.log("ML-DSA signing protocol amendment test passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
