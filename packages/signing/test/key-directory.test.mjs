import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";
import { directory, keyRecord, testVectors } from "./helpers/test-directory.mjs";

const { resolveSigningKey, keyDirectorySigningInput, verifyKeyDirectory } = await importCompiled("src/key-directory.js");

const vectors = await testVectors();
const publicKey = vectors.test_public_key_base64url;

const active = keyRecord({ public_key: publicKey });
const retired = keyRecord({ key_version: "v0", status: "retired", valid_from: "2025-01-01T00:00:00Z", valid_until: "2026-01-01T00:00:00Z", public_key: publicKey });
const revoked = keyRecord({ key_version: "vx", status: "revoked", public_key: publicKey });
const dir = directory([active, retired, revoked]);

const query = (overrides) => ({ key_id: "codeattest-demo-signing-key", key_version: "v1", signing_time: "2026-06-01T00:00:00Z", purpose: "verify", ...overrides });

// An active key inside its window resolves, for both purposes.
assert.deepEqual(resolveSigningKey(dir, query({})), { ok: true, record: active });
assert.deepEqual(resolveSigningKey(dir, query({ purpose: "sign" })), { ok: true, record: active });

// A key the directory has never heard of is unknown, and so is a known key_id
// at an unknown key_version -- rotation must not make an old version resolve
// to the new record.
assert.deepEqual(resolveSigningKey(dir, query({ key_id: "someone-elses-key" })), { ok: false, reason: "signature_key_unknown" });
assert.deepEqual(resolveSigningKey(dir, query({ key_version: "v99" })), { ok: false, reason: "signature_key_unknown" });

// A retired key still verifies history inside its own window ...
assert.deepEqual(
  resolveSigningKey(dir, query({ key_version: "v0", signing_time: "2025-06-01T00:00:00Z" })),
  { ok: true, record: retired }
);
// ... rejects a signing_time outside it ...
assert.deepEqual(
  resolveSigningKey(dir, query({ key_version: "v0", signing_time: "2026-06-01T00:00:00Z" })),
  { ok: false, reason: "signature_key_outside_validity_window" }
);
// ... and may never mint a new signature.
assert.deepEqual(
  resolveSigningKey(dir, query({ key_version: "v0", signing_time: "2025-06-01T00:00:00Z", purpose: "sign" })),
  { ok: false, reason: "signature_key_outside_validity_window" }
);

// Revocation is unconditional: it ignores the window and it invalidates
// history that was legitimately signed at the time.
assert.deepEqual(
  resolveSigningKey(dir, query({ key_version: "vx", signing_time: "2026-06-01T00:00:00Z" })),
  { ok: false, reason: "signature_key_revoked" }
);

// valid_from is inclusive, valid_until is exclusive: an instant belongs to
// exactly one key across a rotation boundary.
assert.equal(resolveSigningKey(dir, query({ signing_time: "2026-01-01T00:00:00Z" })).ok, true);
assert.deepEqual(resolveSigningKey(dir, query({ signing_time: "2027-01-01T00:00:00Z" })), { ok: false, reason: "signature_key_outside_validity_window" });

// A record with no valid_until never expires.
const openEnded = directory([keyRecord({ public_key: publicKey, valid_until: undefined })]);
delete openEnded.keys[0].valid_until;
assert.equal(resolveSigningKey(openEnded, query({ signing_time: "2099-01-01T00:00:00Z" })).ok, true);

// A malformed signing_time is a window failure, not a crash.
assert.deepEqual(resolveSigningKey(dir, query({ signing_time: "yesterday" })), { ok: false, reason: "signature_key_outside_validity_window" });

// The directory's own identity is computed over everything but its signature.
const input = keyDirectorySigningInput(dir);
assert.equal(input.signing_input_type, "signing_key_directory_identity");
assert.equal(input.signed_identity_type, "signing_key_directory");
assert.equal(input.algorithm_profile, "ml_dsa_65");
assert.match(input.signed_identity, /^sha256:[a-f0-9]{64}$/);
// Changing a key changes the identity; changing the signature does not.
const withOtherSignature = { ...dir, directory_signature: { ...dir.directory_signature, signing_time: "2026-01-02T00:00:00Z" } };
assert.equal(keyDirectorySigningInput(withOtherSignature).signed_identity, input.signed_identity);
const withOtherKey = { ...dir, keys: [keyRecord({ public_key: publicKey, key_version: "v2" })] };
assert.notEqual(keyDirectorySigningInput(withOtherKey).signed_identity, input.signed_identity);

// A directory whose anchor signature is filler bytes is untrusted.
const anchorKey = new Uint8Array(1952);
assert.equal(verifyKeyDirectory(dir, anchorKey), false);
// So is anything that is not a schema-valid directory.
assert.equal(verifyKeyDirectory({ nope: true }, anchorKey), false);
assert.equal(verifyKeyDirectory(null, anchorKey), false);

console.log("key-directory test passed.");
