// C3-01: validateProtocolSchema must not treat inherited (prototype), non-
// enumerable, or accessor properties as real own JSON data. A JSON value can
// never have such properties, so any object shaped that way at the protocol
// boundary must be rejected rather than validated through the prototype
// chain.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createTestSigningKey, identitySigningInput, realSignatureEnvelope } from "./helpers/real-signature.mjs";

const workspacePath = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-prototype-pollution-guard-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-prototype-pollution-guard-test-dist");
const schemaId = "urn:codeattest:protocol:v0:signature-envelope";

try {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], { cwd: workspacePath, stdio: "pipe" });
  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);

  const expectation = {
    protocol_version: "codeattest.v0",
    signing_input_type: "static_bundle_manifest_identity",
    signed_identity_type: "static_bundle_manifest",
    signed_identity: `sha256:${"0".repeat(64)}`,
    identity_input_path: "v0/valid/static-bundle-manifest.identity-input.json",
    key_id: "synthetic-test-key",
    key_version: "v1",
    signing_time: "2026-08-01T12:15:00Z"
  };
  // D3-2: this suite's subject is prototype pollution, not signing, so it now
  // exercises the schema validator and canonicalizer over a real ML-DSA-65
  // envelope instead of the retired synthetic constructor.
  const signingInput = identitySigningInput(expectation);
  const envelope = realSignatureEnvelope({ signing_input: signingInput, key: createTestSigningKey({ key_id: expectation.key_id, key_version: expectation.key_version }), signing_time: expectation.signing_time });

  // Sanity: a plain, real envelope/signing-input pair still validates and canonicalizes.
  assertNoErrors(protocol, schemaId, envelope);
  assert(typeof protocol.canonicalizeProtocolJson(envelope) === "string", "a genuine plain-object envelope canonicalizes");

  // Whole-object prototype bypass: every required field present, but only on
  // the prototype chain — zero own properties.
  const prototypeOnlyEnvelope = Object.create(envelope);
  assert(Object.keys(prototypeOnlyEnvelope).length === 0, "prototype-only envelope must expose no own properties (test setup sanity)");
  assertHasError(protocol, schemaId, prototypeOnlyEnvelope, "type");
  assertCanonicalizeRejects(protocol, prototypeOnlyEnvelope, "canonicalizeProtocolJson must reject a prototype-only signature envelope");

  const prototypeOnlySigningInput = Object.create(signingInput);
  assertHasError(protocol, "urn:codeattest:protocol:v0:identity-signing-input", prototypeOnlySigningInput, "type");
  assertCanonicalizeRejects(protocol, prototypeOnlySigningInput, "canonicalizeProtocolJson must reject a prototype-only signing input");

  // Deeper bypass attempt: a non-plain-prototype object (not Object.create on
  // the valid value directly, but a custom prototype carrying the fields).
  class SignatureEnvelopeLookalike {}
  Object.assign(SignatureEnvelopeLookalike.prototype, envelope);
  assertHasError(protocol, schemaId, new SignatureEnvelopeLookalike(), "type");

  // Accessor-property bypass: `signature_bytes` is present as an own,
  // enumerable *accessor* rather than a data property, so its validated value
  // and a later read of it are not guaranteed to be the same value.
  const accessorEnvelope = { ...envelope };
  delete accessorEnvelope.signature_bytes;
  Object.defineProperty(accessorEnvelope, "signature_bytes", {
    get() { return envelope.signature_bytes; },
    enumerable: true,
    configurable: true
  });
  assertHasError(protocol, schemaId, accessorEnvelope, "accessor_property");
  assertHasError(protocol, schemaId, accessorEnvelope, "required");

  // Non-enumerable own property: invisible to JSON.stringify/Object.keys, so
  // it must be treated as absent, same as a genuinely missing field.
  const hiddenEnvelope = { ...envelope };
  delete hiddenEnvelope.signature_bytes;
  Object.defineProperty(hiddenEnvelope, "signature_bytes", {
    value: envelope.signature_bytes,
    enumerable: false,
    configurable: true
  });
  assertHasError(protocol, schemaId, hiddenEnvelope, "required");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

console.log("protocol-ts prototype-pollution guard tests passed.");

function assertNoErrors(protocol, schema, value) {
  const errors = protocol.validateProtocolSchema(schema, value);
  assert(errors.length === 0, `${schema} must validate: ${JSON.stringify(errors)}`);
}

function assertHasError(protocol, schema, value, code) {
  const errors = protocol.validateProtocolSchema(schema, value);
  assert(errors.some((error) => error.code === code), `${schema} must report ${code}: ${JSON.stringify(errors)}`);
}

function assertCanonicalizeRejects(protocol, value, message) {
  let threw = false;
  try { protocol.canonicalizeProtocolJson(value); } catch { threw = true; }
  assert(threw, message);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
