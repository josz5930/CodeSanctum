import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-protocol-ts-test-"));
const outDir = path.join(repoRoot, "node_modules", ".cache", "protocol-ts-test-dist");

try {
  const tscBin = path.resolve(repoRoot, "node_modules", "typescript", "bin", "tsc");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "protocol-ts.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const { canonicalizeProtocolJson, recomputeExcludedFieldIdentity, recomputeExcludedFieldsIdentity, sha256ProtocolText } = await import(pathToFileURL(path.join(outDir, "canonical-identity.js")).href);

  for (const value of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(128), "Unicode: 🔒 café"]) {
    const expected = `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
    assert(sha256ProtocolText(value) === expected, `protocol hashing must delegate UTF-8 SHA-256 to node:crypto for length ${value.length}`);
  }

  assertThrows(() => canonicalizeProtocolJson(Array.from({ length: 20_001 }, (_, index) => index)), "exceeds the supported JSON shape limits", "an array past the node limit must be rejected");

  let deeplyNested = [];
  let cursor = deeplyNested;
  for (let depth = 0; depth < 65; depth += 1) {
    const next = [];
    cursor.push(next);
    cursor = next;
  }
  assertThrows(() => canonicalizeProtocolJson(deeplyNested), "exceeds the supported JSON shape limits", "nesting past the depth limit must be rejected");

  assertThrows(() => canonicalizeProtocolJson("unpaired \uD800 surrogate"), "unpaired surrogate", "an unpaired surrogate must be rejected");
  assertThrows(() => canonicalizeProtocolJson(Number.POSITIVE_INFINITY), "unsafe number", "a non-finite number must be rejected");
  assertThrows(() => canonicalizeProtocolJson(Number.MAX_SAFE_INTEGER + 2), "unsafe number", "a number beyond MAX_SAFE_INTEGER must be rejected");

  const sparseArray = [1, 2, 3];
  delete sparseArray[1];
  assertThrows(() => canonicalizeProtocolJson(sparseArray), "dense", "a sparse array must be rejected");

  const extraPropertyArray = [1, 2, 3];
  extraPropertyArray.extra = "unexpected";
  assertThrows(() => canonicalizeProtocolJson(extraPropertyArray), "extra properties", "an array with an extra own property must be rejected");

  assertThrows(() => canonicalizeProtocolJson({ get value() { return 1; } }), "enumerable data properties", "an accessor property must be rejected");
  assertThrows(() => canonicalizeProtocolJson(Object.defineProperty({}, "hidden", { value: 1, enumerable: false })), "enumerable data properties", "a non-enumerable property must be rejected");
  assertThrows(() => canonicalizeProtocolJson(new (class Custom {})()), "ordinary arrays and plain objects", "a non-plain-object prototype must be rejected");
  assertThrows(() => canonicalizeProtocolJson({ [Symbol("k")]: 1 }), "symbol keys", "symbol-keyed objects must be rejected");
  assertThrows(() => canonicalizeProtocolJson(undefined), "unsupported JSON value type", "an unsupported value type must be rejected with a type-specific message, not the acyclic message");

  const cyclic = {};
  cyclic.self = cyclic;
  assertThrows(() => canonicalizeProtocolJson(cyclic), "acyclic", "a cyclic structure must be rejected with the acyclic message");

  assert(recomputeExcludedFieldIdentity({ id: "x", value: 1 }, "id") !== undefined, "recomputeExcludedFieldIdentity succeeds for a plain record");
  assert(recomputeExcludedFieldIdentity({ id: "x", get value() { return 1; } }, "id") === undefined, "recomputeExcludedFieldIdentity returns undefined instead of throwing for an accessor property");
  assert(recomputeExcludedFieldsIdentity(Object.defineProperty({ id: "x" }, "hidden", { value: 1, enumerable: false }), ["id"]) === undefined, "recomputeExcludedFieldsIdentity returns undefined instead of throwing for a non-enumerable property");

  // C3-04: RFC 8785 requires object keys sorted by UTF-16 *code unit*
  // sequence, not by Unicode codepoint. U+10000 (a supplementary-plane
  // character, encoded as the surrogate pair 0xD800 0xDC00 in UTF-16) has a
  // *higher* codepoint than U+FFFF, but its leading code unit 0xD800 is
  // *lower* than 0xFFFF, so it must sort first.
  const supplementaryPlaneKey = String.fromCodePoint(0x10000);
  const bmpKey = "\uffff";
  const sortedByCodepoint = [bmpKey, supplementaryPlaneKey].toSorted((left, right) => left.codePointAt(0) - right.codePointAt(0));
  assert(sortedByCodepoint[0] === bmpKey, "test setup sanity: codepoint order must disagree with UTF-16 code-unit order for this pair");
  const keyOrderResult = canonicalizeProtocolJson({ [bmpKey]: 1, [supplementaryPlaneKey]: 2 });
  assert(keyOrderResult === `{${JSON.stringify(supplementaryPlaneKey)}:2,${JSON.stringify(bmpKey)}:1}`, `object keys must sort by UTF-16 code unit order, not codepoint order: got ${keyOrderResult}`);

  // C3-04: RFC 8785 (JCS) must not apply Unicode normalization to string
  // content — an NFC-composed character and its NFD-decomposed equivalent
  // are visually identical but must remain distinct byte sequences.
  const nfcComposed = "caf\u00e9";
  const nfdDecomposed = "cafe\u0301";
  assert(nfcComposed !== nfdDecomposed && nfcComposed.normalize("NFC") === nfcComposed && nfdDecomposed.normalize("NFC") === nfcComposed, "test setup sanity: NFC/NFD forms must be distinct JS strings that normalize to the same text");
  assert(canonicalizeProtocolJson(nfcComposed) !== canonicalizeProtocolJson(nfdDecomposed), "RFC 8785 must not normalize string content: NFC and NFD forms must canonicalize differently");
  const normalizationResult = canonicalizeProtocolJson({ [nfcComposed]: 1, [nfdDecomposed]: 2 });
  assert(normalizationResult.includes(JSON.stringify(nfcComposed)) && normalizationResult.includes(JSON.stringify(nfdDecomposed)), "NFC and NFD keys must remain distinct object properties, not collapsed by normalization");

  console.log("protocol-ts canonical identity edge case tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assertThrows(fn, messageFragment, message) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof TypeError && error.message.includes(messageFragment), `${message} (expected message to include "${messageFragment}", got "${error.message}")`);
    return;
  }
  throw new Error(`${message} (expected a throw)`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
