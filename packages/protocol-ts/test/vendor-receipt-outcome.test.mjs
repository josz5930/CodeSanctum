import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const repoRoot = path.resolve(workspacePath, "..", "..");
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures", "v0");
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

  const protocol = await import(pathToFileURL(path.join(outDir, "index.js")).href);

  // D3-2: the committed fixture is itself a real managed_key receipt now, so
  // it is the subject of every case below -- there is no synthetic path left
  // to keep separate.
  const managedReceipt = await readFixtureJson("valid/vendor-receipt.json");
  const matchingOutcome = outcomeFor(managedReceipt, "verified");

  // An outcome whose algorithm profile does not match the receipt's own
  // signature must not be accepted: the outcome could then be one produced
  // against an entirely different signature scheme.
  const wrongProfileResult = protocol.verifyVendorReceiptRecordSync(managedReceipt, {
    signature_verification_outcome: { ...matchingOutcome, algorithm_profile: "ml_dsa_87" }
  });
  assert(wrongProfileResult.state === "failed_verification", "an outcome with a different algorithm_profile must not verify this receipt");
  assert(wrongProfileResult.reason_codes.includes("receipt_signature_unverified"), `expected receipt_signature_unverified; got ${wrongProfileResult.reason_codes.join(", ")}`);

  // An outcome for a different signed_identity must not be accepted for this
  // receipt -- the outcome is untrusted input and is checked field by field.
  const wrongIdentityResult = protocol.verifyVendorReceiptRecordSync(managedReceipt, {
    signature_verification_outcome: { ...matchingOutcome, signed_identity: `sha256:${"9".repeat(64)}` }
  });
  assert(wrongIdentityResult.state === "failed_verification", "an outcome for a different signed_identity must not verify this receipt");
  assert(wrongIdentityResult.reason_codes.includes("receipt_signature_unverified"), `expected receipt_signature_unverified; got ${wrongIdentityResult.reason_codes.join(", ")}`);

  // An outcome with a different key_version must not be accepted either.
  const wrongKeyVersionResult = protocol.verifyVendorReceiptRecordSync(managedReceipt, {
    signature_verification_outcome: { ...matchingOutcome, key_version: "some-other-key-version" }
  });
  assert(wrongKeyVersionResult.state === "failed_verification", "an outcome with a different key_version must not verify this receipt");
  assert(wrongKeyVersionResult.reason_codes.includes("receipt_signature_unverified"), `expected receipt_signature_unverified; got ${wrongKeyVersionResult.reason_codes.join(", ")}`);

  // A matching verified outcome, checked field by field against the
  // receipt's own signature, verifies the receipt.
  const matchingResult = protocol.verifyVendorReceiptRecordSync(managedReceipt, { signature_verification_outcome: matchingOutcome });
  assert(matchingResult.state === "receipt_verified", `a matching verified outcome must verify the receipt; got ${JSON.stringify(matchingResult)}`);
  assert(matchingResult.reason_codes.length === 0, "a verified managed_key receipt must have no reason codes");

  // A matching-but-revoked outcome must not verify: `result` itself is part
  // of what is checked, not just the identifying fields.
  const revokedResult = protocol.verifyVendorReceiptRecordSync(managedReceipt, {
    signature_verification_outcome: { ...matchingOutcome, result: "signature_key_revoked" }
  });
  assert(revokedResult.state === "failed_verification", "a matching but revoked outcome must not verify the receipt");
  assert(revokedResult.reason_codes.includes("receipt_signature_unverified"), `expected receipt_signature_unverified; got ${revokedResult.reason_codes.join(", ")}`);

  console.log("protocol-ts vendor receipt outcome tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function outcomeFor(receipt, result) {
  return {
    protocol_version: "codeattest.v0",
    signed_identity_type: "vendor_receipt",
    signed_identity: receipt.vendor_receipt_id,
    algorithm_profile: "ml_dsa_65",
    key_id: receipt.receipt_signature.key_id,
    key_version: receipt.receipt_signature.key_version,
    key_directory_version: 1,
    verified_at: "2026-07-10T00:21:00Z",
    result
  };
}

async function readFixtureJson(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
