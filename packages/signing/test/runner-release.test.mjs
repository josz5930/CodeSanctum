import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { importCompiled } from "./helpers/compile.mjs";

const {
  SOFTWARE_CUSTODY_LIMITATION,
  generateMlDsa65KeyPair,
  runnerReleaseSigningInput,
  signRunnerReleaseArtifact,
  verifyRunnerReleaseArtifact
} = await importCompiled("src/index.js");

const releaseBytes = new TextEncoder().encode("SYNTHETIC_DEMO_DATA signed runner release NOT_CUSTOMER_SOURCE\n");
const digest = `sha256:${createHash("sha256").update(releaseBytes).digest("hex")}`;
const anchor = generateMlDsa65KeyPair();
const record = {
  protocol_version: "codeattest.v0",
  release_identifier: "codeattest-local-runner-v0.1.0",
  build_identifier: "0123456789abcdef0123456789abcdef01234567",
  artifact_digest: digest,
  released_at: "2026-08-27T00:00:00Z",
  limitations: [SOFTWARE_CUSTODY_LIMITATION]
};
const artifact = signRunnerReleaseArtifact({
  release_record: record,
  key: {
    key_id: "codeattest-offline-release-anchor",
    key_version: "v1",
    privateKeyPkcs8: anchor.privateKeyPkcs8
  },
  signing_time: record.released_at
});

assert.deepEqual(runnerReleaseSigningInput(record), artifact.signing_input);
assert.equal(artifact.signature.signing_mode, "managed_key");
assert.deepEqual(artifact.signature.signing_limitations, [SOFTWARE_CUSTODY_LIMITATION]);

const verified = verifyRunnerReleaseArtifact({
  artifact,
  artifact_bytes: releaseBytes,
  trust_anchor_public_key: anchor.publicKey,
  expected_build_identifier: record.build_identifier,
  expected_release_identifier: record.release_identifier
});
assert.equal(verified.ok, true, "the exact binary and exact signed release record must verify");

const tamperedBytes = Uint8Array.from(releaseBytes);
tamperedBytes[0] ^= 1;
assert.deepEqual(
  verifyRunnerReleaseArtifact({
    artifact,
    artifact_bytes: tamperedBytes,
    trust_anchor_public_key: anchor.publicKey
  }),
  { ok: false, reason: "release_artifact_digest_mismatch" }
);

const otherAnchor = generateMlDsa65KeyPair();
assert.deepEqual(
  verifyRunnerReleaseArtifact({
    artifact,
    artifact_bytes: releaseBytes,
    trust_anchor_public_key: otherAnchor.publicKey
  }),
  { ok: false, reason: "release_signature_invalid" }
);

assert.deepEqual(
  verifyRunnerReleaseArtifact({
    artifact,
    artifact_bytes: releaseBytes,
    trust_anchor_public_key: anchor.publicKey,
    expected_build_identifier: "ffffffffffffffffffffffffffffffffffffffff"
  }),
  { ok: false, reason: "release_build_mismatch" }
);

const mismatchedInput = structuredClone(artifact);
mismatchedInput.signing_input.signed_identity = `sha256:${"f".repeat(64)}`;
assert.deepEqual(
  verifyRunnerReleaseArtifact({
    artifact: mismatchedInput,
    artifact_bytes: releaseBytes,
    trust_anchor_public_key: anchor.publicKey
  }),
  { ok: false, reason: "release_signing_input_mismatch" }
);

const unsigned = structuredClone(artifact);
unsigned.signature.signature_bytes = `ml_dsa_65:${"A".repeat(4412)}`;
assert.deepEqual(
  verifyRunnerReleaseArtifact({
    artifact: unsigned,
    artifact_bytes: releaseBytes,
    trust_anchor_public_key: anchor.publicKey
  }),
  { ok: false, reason: "release_signature_invalid" }
);

console.log("runner release signing and verification test passed.");
