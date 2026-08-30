import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)), "..", "..");

export async function testVectors() {
  return JSON.parse(await readFile(path.join(repoRoot, "protocol", "fixtures", "v0", "support", "ml-dsa-65-test-vectors.json"), "utf8"));
}

export const TEST_LIMITATIONS = [
  "SYNTHETIC_DEMO_DATA Published test key. Never trusted by a deployment. NOT_CUSTOMER_SOURCE."
];

export function keyRecord(overrides = {}) {
  return {
    protocol_version: "codeattest.v0",
    key_id: "codeattest-demo-signing-key",
    key_version: "v1",
    algorithm_profile: "ml_dsa_65",
    public_key: overrides.public_key ?? "A".repeat(2603),
    custody_mode: "self_hosted_software",
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: "2027-01-01T00:00:00Z",
    status: "active",
    limitations: [...TEST_LIMITATIONS],
    ...overrides
  };
}

// An unsigned directory shell. Callers that need a verifiable anchor
// signature build one with signIdentityEnvelope (Task 3) instead.
export function directory(records, overrides = {}) {
  return {
    protocol_version: "codeattest.v0",
    directory_version: 1,
    trust_anchor_key_id: "codeattest-demo-trust-anchor",
    published_at: "2026-01-01T00:00:00Z",
    keys: records,
    directory_signature: {
      protocol_version: "codeattest.v0",
      algorithm_profile: "ml_dsa_65",
      key_id: "codeattest-demo-trust-anchor",
      key_version: "v1",
      signing_time: "2026-01-01T00:00:00Z",
      signed_identity_type: "signing_key_directory",
      signed_identity: `sha256:${"0".repeat(64)}`,
      canonicalization: "rfc8785",
      signing_mode: "managed_key",
      signing_limitations: [...TEST_LIMITATIONS],
      signature_bytes: `ml_dsa_65:${"A".repeat(4412)}`
    },
    ...overrides
  };
}
