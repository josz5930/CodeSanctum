#!/usr/bin/env node
// Rewrites the protocol fixture corpus's identity cascade.
//
// D3-2: a change to signing metadata inside an identity input moves that
// document's identity, which moves every identity computed from it, which
// moves every one of the ~50 fixtures that quote one of those identities by
// string. Hand-editing that is neither feasible nor reviewable, so this script
// walks `scripts/lib/fixture-identity-graph.mjs` in dependency order,
// recomputes each identity, substitutes the old digest for the new one across
// the whole corpus, re-signs every signature envelope and verification
// package, and finally refreshes `canonical-manifest.json`'s file hashes.
//
// Run it against an untouched corpus and it must be a byte-for-byte no-op:
// `packages/protocol-ts/test/fixture-regeneration.test.mjs` asserts exactly
// that, which is what makes the tool trustworthy enough to rewrite the corpus.
//
// D3-1 removed the tool's synthetic signing mode along with every other
// synthetic signing path: signatures are only ever real ML-DSA-65 bytes,
// produced by the Rust deterministic signer from the committed test seed.
//
// Usage:
//   node scripts/regenerate-signature-fixtures.mjs
//        [--fixtures-root <dir>] [--check] [--report-json]
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  FIXTURE_IDENTITY_ORDER,
  REGENERATION_EXCLUDED_FILES,
  SIGNATURE_FIXTURES,
  VERIFICATION_PACKAGE_FIXTURES
} from "./lib/fixture-identity-graph.mjs";
import { canonicalize, listFiles, projectRoot, resolveProjectPath, sha256Hex, sha256IdFromCanonical } from "./lib/protocol-utils.mjs";

const RUST_SIGNER_CRATE = "onevps-local-runner-scaffold";
const RUST_SIGNER_TEST_NAME = "regenerate_fixture_signatures";
const ML_DSA_VECTORS_PATH = "v0/support/ml-dsa-65-test-vectors.json";

const options = parseArguments(process.argv.slice(2));
const fixturesRoot = path.resolve(options.fixturesRoot ?? resolveProjectPath("protocol/fixtures"));
const manifestPath = "canonical-manifest.json";

const original = await readCorpus(fixturesRoot);
const corpus = new Map(original);
const protectedFiles = new Set(REGENERATION_EXCLUDED_FILES);

const report = {
  identity_entries: FIXTURE_IDENTITY_ORDER.length,
  identities_recomputed: 0,
  identities_moved: 0,
  signatures_rebuilt: 0,
  verification_packages_rebuilt: 0,
  changed_files: []
};

const slots = maskDeclaredIdentities();

for (const slot of slots) {
  const identityInput = buildIdentityInput(slot.entry, readDocument(slot.entry.fixture));
  const identity = computeIdentity(identityInput, slot.entry.namespace);
  slot.resolvedDigest = digestOf(identity, slot.entry.fixture);
  report.identities_recomputed += 1;
  if (slot.resolvedDigest !== slot.digest) {
    substituteIdentity(slot.digest, slot.resolvedDigest);
    report.identities_moved += 1;
  }
}

for (const slot of slots) {
  corpus.set(slot.entry.fixture, readText(slot.entry.fixture).replaceAll(slot.token, slot.resolvedDigest));
}

const signatureBytes = await computeSignatureBytes();
for (const [index, entry] of SIGNATURE_FIXTURES.entries()) {
  const document = readDocument(entry.fixture);
  const envelope = resolvePointer(document, entry.pointer, entry.fixture);
  envelope.signature_bytes = signatureBytes[index];
  writeDocument(entry.fixture, document);
  report.signatures_rebuilt += 1;
}

for (const entry of VERIFICATION_PACKAGE_FIXTURES) {
  rebuildVerificationPackage(entry);
  report.verification_packages_rebuilt += 1;
}

refreshManifestHashes();
verifyCascadeConverged();

report.changed_files = [...corpus.keys()].filter((file) => corpus.get(file) !== original.get(file)).sort();

if (options.check) {
  if (options.reportJson) console.log(JSON.stringify(report, null, 2));
  else if (report.changed_files.length === 0) console.log("Fixture regeneration check passed: the corpus already matches.");
  else console.error(`Fixture regeneration check failed; these files would change:\n- ${report.changed_files.join("\n- ")}`);
  process.exit(report.changed_files.length === 0 ? 0 : 1);
}

for (const file of report.changed_files) {
  await writeFile(path.join(fixturesRoot, file), corpus.get(file), "utf8");
}

if (options.reportJson) console.log(JSON.stringify(report, null, 2));
else console.log(`Fixture regeneration recomputed ${report.identities_recomputed} identities (${report.identities_moved} moved), ${report.signatures_rebuilt} signatures and ${report.verification_packages_rebuilt} verification packages; wrote ${report.changed_files.length} files.`);

function parseArguments(argv) {
  const parsed = { fixturesRoot: undefined, check: false, reportJson: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") parsed.check = true;
    else if (argument === "--report-json") parsed.reportJson = true;
    else if (argument === "--fixtures-root") parsed.fixturesRoot = argv[(index += 1)];
    else throw new Error(`Unknown argument ${argument}`);
  }
  return parsed;
}

async function readCorpus(root) {
  const files = new Map();
  for (const absolutePath of await listFiles(root)) {
    files.set(path.relative(root, absolutePath).split(path.sep).join("/"), await readFile(absolutePath, "utf8"));
  }
  return files;
}

function readText(file) {
  const text = corpus.get(file);
  if (text === undefined) throw new Error(`${file} is not present under ${fixturesRoot}`);
  return text;
}

function readDocument(file) {
  return JSON.parse(readText(file));
}

// Every JSON file in the corpus is exactly `JSON.stringify(value, null, 2)`
// plus a trailing newline, so re-serializing a parsed document is lossless.
function writeDocument(file, value) {
  corpus.set(file, `${JSON.stringify(value, null, 2)}\n`);
}

function buildIdentityInput(entry, fixture) {
  if (entry.identity_input !== undefined && entry.identity_input_derivation === "manual") return readDocument(entry.identity_input);
  const identityInput = dropExcluded(fixture, entry.excludes);
  if (entry.identity_input !== undefined) writeDocument(entry.identity_input, identityInput);
  return identityInput;
}

// `excludes` mirrors each fixture's own `identity_input_excludes` declaration,
// which is a mix of top-level field names and one dotted path
// (`public_verification_metadata.signed_identity`).
function dropExcluded(document, excludes) {
  const result = structuredClone(document);
  for (const excluded of excludes) {
    const segments = excluded.split(".");
    let target = result;
    for (const segment of segments.slice(0, -1)) {
      if (target === undefined || target === null || typeof target !== "object") break;
      target = target[segment];
    }
    if (target !== undefined && target !== null && typeof target === "object") delete target[segments.at(-1)];
  }
  return result;
}

function computeIdentity(identityInput, namespace) {
  const digest = sha256IdFromCanonical(identityInput);
  return namespace === undefined ? digest : `${namespace}:${digest.slice("sha256:".length)}`;
}

// A fixture's own identity is resolved from its own recomputation, never from
// a sibling's substitution. Four fixtures share the vendor receipt's digest
// today and three share the finalization's, so without this masking the last
// entry to move a shared digest would silently rewrite the earlier ones' ids
// back. Masking every occurrence of a fixture's own digest inside its own file
// also covers the excluded restatements of it (`public_verification_metadata
// .signed_identity` and `receipt_signature.signed_identity`) while leaving
// deliberately mismatched values such as `sha256:1111...` alone.
function maskDeclaredIdentities() {
  return FIXTURE_IDENTITY_ORDER.map((entry, index) => {
    const declared = readDocument(entry.fixture)[entry.field];
    if (typeof declared !== "string") throw new Error(`${entry.fixture} has no string ${entry.field} to recompute`);
    const digest = digestOf(declared, entry.fixture);
    const token = `identityslot${index}`.padEnd(64, "x");
    corpus.set(entry.fixture, readText(entry.fixture).replaceAll(digest, token));
    return { entry, digest, token, resolvedDigest: digest };
  });
}

// Substitution is by bare 64-hex digest rather than by the full prefixed
// identity, because the same digest is quoted two different ways across the
// corpus: with its own namespace (`attestation_finalization:<hex>`) and with a
// plain `sha256:` prefix in the signing inputs. A 64-hex digest does not occur
// by accident, so one substitution reaches both.
function substituteIdentity(currentDigest, nextDigest) {
  for (const [file, text] of corpus) {
    if (protectedFiles.has(file) || !text.includes(currentDigest)) continue;
    corpus.set(file, text.replaceAll(currentDigest, nextDigest));
  }
}

function digestOf(identity, origin) {
  const digest = identity.slice(identity.indexOf(":") + 1);
  if (!/^[0-9a-f]{64}$/u.test(digest)) throw new Error(`${origin} identity ${identity} is not a prefixed 64-hex digest`);
  return digest;
}

function resolvePointer(document, pointer, origin) {
  let target = document;
  for (const segment of pointer) {
    target = target?.[segment];
    if (target === undefined) throw new Error(`${origin} has no ${pointer.join(".")} signature envelope`);
  }
  return target;
}

async function computeSignatureBytes() {
  return signWithRustDeterministicSigner(SIGNATURE_FIXTURES.map((entry) => canonicalize(readDocument(entry.signing_input))));
}

// D1 signed the committed vectors by dropping a throwaway `#[test]` into the
// scaffold crate and reading its `--nocapture` output; the Global Constraint
// forbids committing Node-produced signature bytes, so this reuses that exact
// mechanism instead of signing in Node.
async function signWithRustDeterministicSigner(canonicalInputs) {
  const vectors = JSON.parse(readText(ML_DSA_VECTORS_PATH));
  const testPath = path.join(projectRoot, "runner", "crates", "local-runner-scaffold", "tests", `${RUST_SIGNER_TEST_NAME}.rs`);
  const payloadPath = path.join(projectRoot, "node_modules", ".cache", "fixture-signing-inputs.json");
  await mkdir(path.dirname(payloadPath), { recursive: true });
  await writeFile(payloadPath, `${JSON.stringify({ seed_base64url: vectors.test_seed_base64url, canonical_inputs: canonicalInputs }, null, 2)}\n`, "utf8");
  await writeFile(testPath, rustSignerSource(), "utf8");
  try {
    const output = execFileSync("cargo", ["test", "-p", RUST_SIGNER_CRATE, "--test", RUST_SIGNER_TEST_NAME, "--", "--nocapture"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CODEATTEST_FIXTURE_SIGNING_INPUTS: payloadPath }
    });
    const signatures = [...output.matchAll(/^SIG (\d+) (\S+)$/gmu)].reduce((accumulator, [, index, signature]) => accumulator.set(Number(index), signature), new Map());
    return canonicalInputs.map((_input, index) => {
      const signature = signatures.get(index);
      if (signature === undefined) throw new Error(`the Rust deterministic signer printed no signature for input ${index}`);
      return `ml_dsa_65:${signature}`;
    });
  } finally {
    await rm(testPath, { force: true });
    await rm(payloadPath, { force: true });
  }
}

function rustSignerSource() {
  return [
    "use onevps_local_runner_scaffold::ml_dsa;",
    "use serde_json::Value;",
    "use std::fs;",
    "",
    "// Written and deleted by scripts/regenerate-signature-fixtures.mjs.",
    "#[test]",
    "fn print_fixture_signatures() {",
    '    let payload_path = std::env::var("CODEATTEST_FIXTURE_SIGNING_INPUTS").expect("input path");',
    '    let payload: Value = serde_json::from_str(&fs::read_to_string(payload_path).expect("inputs readable")).expect("inputs parse");',
    '    let decoded = ml_dsa::base64url_decode(payload["seed_base64url"].as_str().expect("seed")).expect("seed decodes");',
    "    let mut seed = [0u8; 32];",
    "    seed.copy_from_slice(&decoded);",
    '    for (index, canonical) in payload["canonical_inputs"].as_array().expect("inputs are an array").iter().enumerate() {',
    '        let message = ml_dsa::signed_message(canonical.as_str().expect("canonical input"));',
    '        println!("SIG {index} {}", ml_dsa::base64url_encode(&ml_dsa::sign_deterministic_from_seed(&seed, &message)));',
    "    }",
    "}",
    ""
  ].join("\n");
}

// `createVerificationPackage` in packages/static-bundle/src/signed-static-bundle.ts
// derives four values from the embedded documents: each attachment's canonical
// digest and byte length, and the `attachment_index_id` over everything else.
function rebuildVerificationPackage(entry) {
  const document = readDocument(entry.fixture);
  for (const [attachment, embedded, source] of [["signing_input_attachment", "signing_input", entry.signing_input], ["signature_attachment", "signature_envelope", entry.signature_envelope]]) {
    document[attachment][embedded] = readDocument(source);
    if (embedded === "signature_envelope" && entry.tamper_signature_bytes === true) {
      document[attachment][embedded].signature_bytes = tamperSignatureBytes(document[attachment][embedded].signature_bytes, entry.fixture);
    }
    document[attachment].digest = sha256IdFromCanonical(document[attachment][embedded]);
    document[attachment].size_bytes = Buffer.byteLength(canonicalize(document[attachment][embedded]), "utf8");
  }
  // No other fixture quotes an `attachment_index_id`, so it needs no
  // corpus-wide substitution -- only its own file has to be rewritten.
  const { attachment_index_id: _replaced, ...indexInput } = document;
  document.attachment_index_id = sha256IdFromCanonical(indexInput);
  writeDocument(entry.fixture, document);
}

// A one-character change to the base64url payload, which leaves the schema
// pattern satisfied and the signature unverifiable.
function tamperSignatureBytes(signatureBytes, origin) {
  if (typeof signatureBytes !== "string" || !signatureBytes.startsWith("ml_dsa_65:")) throw new Error(`${origin} has no ml_dsa_65 signature to tamper with`);
  const last = signatureBytes.at(-1);
  return `${signatureBytes.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

function refreshManifestHashes() {
  const manifest = readDocument(manifestPath);
  for (const file of manifest.files ?? []) {
    file.sha256 = sha256Hex(readText(file.path));
  }
  writeDocument(manifestPath, manifest);
}

// A single pass cannot prove convergence on its own: substituting one digest
// rewrites every other fixture, so an entry settled early can be disturbed by
// an entry settled later (two fixtures that share a digest today but stop
// sharing one is the realistic way that happens). Recheck every entry against
// the final corpus and fail loudly rather than committing a plausible-looking
// corpus with wrong identities.
function verifyCascadeConverged() {
  const failures = [];
  for (const entry of FIXTURE_IDENTITY_ORDER) {
    const fixture = readDocument(entry.fixture);
    const identityInput = entry.identity_input_derivation === "manual" ? readDocument(entry.identity_input) : dropExcluded(fixture, entry.excludes);
    const identity = computeIdentity(identityInput, entry.namespace);
    if (fixture[entry.field] !== identity) failures.push(`${entry.fixture} ${entry.field} settled at ${fixture[entry.field]} but recomputes to ${identity}`);
    if (entry.identity_input !== undefined && entry.identity_input_derivation !== "manual" && corpus.get(entry.identity_input) !== `${JSON.stringify(identityInput, null, 2)}\n`) {
      failures.push(`${entry.identity_input} does not match ${entry.fixture} minus its identity excludes`);
    }
  }
  if (failures.length > 0) throw new Error(`The identity cascade did not converge:\n- ${failures.join("\n- ")}`);
}
