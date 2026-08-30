import { execFileSync } from "node:child_process";
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

  const { CLAIM_SAFE_TEXT_MAX_LENGTH, PII_EMAIL_ADDRESS_PATTERN_SOURCE, attestationClaimUnsafePhrase, claimSafeForbiddenPhrase, claimSafePositiveClosurePhrase, customerVisibleTextForbidden, isAttestationClaimSafe, piiTextForbidden, sourceTextForbiddenPhrase } = await import(pathToFileURL(path.join(outDir, "claim-safety.js")).href);

  for (const [text, expectedFamily] of [
    ["SYNTHETIC_DEMO_DATA contact alice@example.com for details. NOT_CUSTOMER_SOURCE.", "email_address"],
    ["SYNTHETIC_DEMO_DATA user_id: 12345 was affected. NOT_CUSTOMER_SOURCE.", "customer_identifier_field"],
    ["SYNTHETIC_DEMO_DATA device_id=demo-device was affected. NOT_CUSTOMER_SOURCE.", "customer_identifier_field"],
    ["SYNTHETIC_DEMO_DATA customer_id: acme-prod-001 was affected. NOT_CUSTOMER_SOURCE.", "customer_identifier_field"],
    ["SYNTHETIC_DEMO_DATA phone: 555-123-4567 on file. NOT_CUSTOMER_SOURCE.", "phone_number"],
    ["SYNTHETIC_DEMO_DATA access_token=demo-token-value in the log. NOT_CUSTOMER_SOURCE.", "credential_variant"]
  ]) {
    assert(piiTextForbidden(text) === expectedFamily, `${expectedFamily} PII family must be blocked for: ${text}`);
    assert(customerVisibleTextForbidden(text) === expectedFamily, `${expectedFamily} PII family must be blocked via customerVisibleTextForbidden for: ${text}`);
  }
  assert(piiTextForbidden("review:abc123") === undefined, "typed review reference must remain allowed");
  assert(piiTextForbidden("artifact_ref:demo-001") === undefined, "typed artifact_ref reference must remain allowed");
  assert(piiTextForbidden("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === undefined, "typed sha256 reference must remain allowed");
  assert(CLAIM_SAFE_TEXT_MAX_LENGTH === 65_536, "claim-safety scans must use the protocol-owned text ceiling");
  assert(PII_EMAIL_ADDRESS_PATTERN_SOURCE.includes("{0,63}@"), "the shared email pattern must bound the local part so failed scans cannot retry an unbounded prefix at every word boundary");
  assert(piiTextForbidden(`${"a".repeat(64)}@sub-domain.example.com`) === "email_address", "a valid 64-character local part and multi-label domain must remain blocked as PII");
  assert(piiTextForbidden("reviewer@xn--bcher-kva.example") === "email_address", "valid punycode labels with consecutive internal hyphens must remain blocked as PII");
  assert(piiTextForbidden(`${"a".repeat(65)}@example.com`) === undefined, "an overlong email local part must not be reinterpreted as a valid address suffix");
  const adversarialEmailCandidate = `a@${"a.".repeat((CLAIM_SAFE_TEXT_MAX_LENGTH - 2) / 2)}`;
  const adversarialStartedAt = performance.now();
  assert(piiTextForbidden(adversarialEmailCandidate) === undefined, "a long unterminated domain candidate must remain non-matching");
  const adversarialElapsedMs = performance.now() - adversarialStartedAt;
  assert(adversarialElapsedMs < 500, `the maximum-size unterminated email candidate must be handled linearly (took ${adversarialElapsedMs.toFixed(1)} ms)`);
  const oversizedText = "x".repeat(CLAIM_SAFE_TEXT_MAX_LENGTH + 1);
  assert(piiTextForbidden(oversizedText) === "text_too_long", "the PII boundary must reject text above the shared scan ceiling before matching");
  assert(sourceTextForbiddenPhrase(oversizedText) === "text_too_long", "the source-text boundary must reject text above the shared scan ceiling before matching");
  assert(customerVisibleTextForbidden(oversizedText) === "text_too_long", "the customer-visible boundary must reject text above the shared scan ceiling before matching");
  assert(customerVisibleTextForbidden(`SYNTHETIC_DEMO_DATA hidden${String.fromCodePoint(0x202e)}text. NOT_CUSTOMER_SOURCE.`) === "hidden_control_character", "a right-to-left override character must be rejected");
  assert(customerVisibleTextForbidden(`SYNTHETIC_DEMO_DATA zero${String.fromCodePoint(0x200b)}width. NOT_CUSTOMER_SOURCE.`) === "hidden_control_character", "a zero-width space must be rejected");

  for (const [text, expectedFamily] of [
    ["SYNTHETIC_DEMO_DATA CodeAttest certifies the code. NOT_CUSTOMER_SOURCE.", "certifies_code_claim"],
    ["SYNTHETIC_DEMO_DATA this package is audit-safe. NOT_CUSTOMER_SOURCE.", "audit_ready_claim"],
    ["SYNTHETIC_DEMO_DATA this proves SOC 2 readiness. NOT_CUSTOMER_SOURCE.", "soc2_readiness_claim"],
    ["SYNTHETIC_DEMO_DATA this confirms the application is secure. NOT_CUSTOMER_SOURCE.", "secure_conclusion_claim"],
    ["SYNTHETIC_DEMO_DATA CodeAttest guarantees compliance. NOT_CUSTOMER_SOURCE.", "compliance_guarantee_claim"],
    ["SYNTHETIC_DEMO_DATA the application has zero vulnerabilities. NOT_CUSTOMER_SOURCE.", "zero_vulnerability_claim"],
    ["SYNTHETIC_DEMO_DATA the application is vulnerability-free. NOT_CUSTOMER_SOURCE.", "vulnerability_free_claim"]
  ]) {
    assert(customerVisibleTextForbidden(text) === expectedFamily, `${expectedFamily} assurance-overclaim family must be blocked for: ${text}`);
  }
  assert(customerVisibleTextForbidden("SYNTHETIC_DEMO_DATA CodeAttest provides structured supporting evidence for a scoped secure-code review. NOT_CUSTOMER_SOURCE.") === undefined, "bounded supporting-evidence wording must remain allowed");
  assert(customerVisibleTextForbidden("SYNTHETIC_DEMO_DATA evidence is limited to submitted artifacts. NOT_CUSTOMER_SOURCE.") === undefined, "bounded evidence-limitation wording must remain allowed");
  assert(customerVisibleTextForbidden("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") === undefined, "typed sha256 references must remain allowed");
  assert(customerVisibleTextForbidden("SYNTHETIC_DEMO_DATA accepted risk is not remediation, verification, audit acceptance, or control satisfaction. NOT_CUSTOMER_SOURCE.") === undefined, "a negated enumerated disclaimer must not be treated as the claim it disclaims");
  assert(customerVisibleTextForbidden("SYNTHETIC_DEMO_DATA guidance is limited to submitted retained evidence and does not imply audit acceptance. NOT_CUSTOMER_SOURCE.") === undefined, "a direct audit-acceptance disclaimer must remain allowed");

  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA SOC2 certification is forbidden. NOT_CUSTOMER_SOURCE.") === "soc 2 certification", "no-space SOC 2 certification must be blocked");
  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA SOC-2 certification is forbidden. NOT_CUSTOMER_SOURCE.") === "soc 2 certification", "hyphenated SOC-2 certification must be blocked");
  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA SOC‑2 certification is forbidden. NOT_CUSTOMER_SOURCE.") === "soc 2 certification", "Unicode-hyphen SOC-2 certification must be blocked");
  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA SOC  2 accepted is forbidden. NOT_CUSTOMER_SOURCE.") === "soc 2 accepted", "whitespace-normalized SOC 2 acceptance must be blocked");
  // C3-02: a zero-width separator mid-phrase is no longer silently stripped and
  // re-matched (stripping can erase a word boundary and *cause* a bypass, e.g.
  // "auditor[ZWSP]approved" -> "auditorapproved"); it is rejected outright.
  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA SOC 2​ certified is forbidden. NOT_CUSTOMER_SOURCE.") === "hidden_control_character", "zero-width separators must not bypass claim safety");
  assert(claimSafeForbiddenPhrase("SYNTHETIC_DEMO_DATA certified training fixture is ordinary reviewer context. NOT_CUSTOMER_SOURCE.") === undefined, "ordinary certified prose must remain allowed");
  assert(sourceTextForbiddenPhrase("SYNTHETIC_DEMO_DATA bearer of the award is not a credential. NOT_CUSTOMER_SOURCE.") === undefined, "ordinary bearer prose must not be treated as a credential");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review. NOT_CUSTOMER_SOURCE.") === undefined, "a local explicit fresh-review negation must remain allowed");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA the finding is not fixed under this pass. NOT_CUSTOMER_SOURCE.") === undefined, "a local explicit fixed negation must remain allowed");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA the reviewer has not verified customer remediation. NOT_CUSTOMER_SOURCE.") === undefined, "a local explicit verified negation must remain allowed");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA the customer status is not remediated by this selection. NOT_CUSTOMER_SOURCE.") === undefined, "a local explicit remediated negation must remain allowed");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this issue is fixed. It was not verified. NOT_CUSTOMER_SOURCE.") === "fixed", "a later negation must not suppress an earlier closure claim");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review. The finding is resolved. NOT_CUSTOMER_SOURCE.") === "resolved", "a valid disclaimer must not suppress a later closure claim");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA not applicable here; the control is satisfied and certified. NOT_CUSTOMER_SOURCE.") !== undefined, "a clause-level unrelated negation must not suppress a closure claim");
  assert(claimSafePositiveClosurePhrase("customer:verified") === undefined, "typed identity references are not customer-facing closure prose");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA verification_pass:verified later evidence still pending. NOT_CUSTOMER_SOURCE.") === "verified", "typed-reference exemption must not mask prose after a namespaced token prefix");

  // C3-03: the exact-phrase list didn't cover the natural combined phrase
  // "complete fresh secure-code review" (only its negated form was tested).
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this was a complete fresh secure-code review. NOT_CUSTOMER_SOURCE.") === "complete fresh secure-code review", "the combined fresh-review phrase must be blocked");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this is not a complete fresh secure-code review of this change. NOT_CUSTOMER_SOURCE.") === undefined, "a same-clause negation of the combined fresh-review phrase must remain allowed");
  // C3-03: colon/dash must act as clause boundaries in the negation-window
  // scan, same as comma/semicolon/conjunctions, so an unrelated negation on
  // one side of a "label: value" or "clause - clause" construction cannot
  // suppress a real closure claim on the other side.
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA not applicable: verified. NOT_CUSTOMER_SOURCE.") === "verified", "a colon boundary must not let an unrelated negation suppress a closure claim");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA not applicable - resolved. NOT_CUSTOMER_SOURCE.") === "resolved", "a dash boundary must not let an unrelated negation suppress a closure claim");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this is not verified: still pending review. NOT_CUSTOMER_SOURCE.") === undefined, "a genuine same-side negation immediately before a colon must still suppress");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA this is not audit-ready certified. NOT_CUSTOMER_SOURCE.") === undefined, "a hyphenated compound word between a negation and the claim must not be mistaken for a dash clause boundary");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA not verified and fixed before evidence. NOT_CUSTOMER_SOURCE.") === "fixed", "same-clause negation must not mask a later fixed claim after and");
  assert(claimSafePositiveClosurePhrase("SYNTHETIC_DEMO_DATA not verified but now fixed before evidence. NOT_CUSTOMER_SOURCE.") === "fixed", "same-clause negation must not mask a later fixed claim after but");
  assert(sourceTextForbiddenPhrase("SYNTHETIC_DEMO_DATA Authorization:   Bearer token must not enter text. NOT_CUSTOMER_SOURCE.") === "authorization: bearer", "authorization bearer credentials must be blocked after whitespace normalization");
  assert(attestationClaimUnsafePhrase("SYNTHETIC_DEMO_DATA the auditor approved this package. NOT_CUSTOMER_SOURCE.") === "auditor approved", "Attestation claim profile blocks auditor approval conclusions");
  assert(attestationClaimUnsafePhrase("SYNTHETIC_DEMO_DATA controls are effective. NOT_CUSTOMER_SOURCE.") === "controls are effective", "Attestation claim profile blocks control-effectiveness conclusions");
  assert(isAttestationClaimSafe("SYNTHETIC_DEMO_DATA useful supporting evidence for the consumer review context. NOT_CUSTOMER_SOURCE.") === true, "Attestation claim profile permits bounded supporting-evidence wording");
  assert(isAttestationClaimSafe("SYNTHETIC_DEMO_DATA source content secret=abc. NOT_CUSTOMER_SOURCE.") === false, "Attestation claim profile rejects source or credential content");
  for (const [text, expected] of [
    ["SYNTHETIC_DEMO_DATA secret=abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "secret="],
    ["SYNTHETIC_DEMO_DATA password=hunter2 must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "password="],
    ["SYNTHETIC_DEMO_DATA api_key=abc123 must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "api_key="],
    ["SYNTHETIC_DEMO_DATA token=xyz must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "token="],
    ["SYNTHETIC_DEMO_DATA secret : abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "secret:"],
    ["SYNTHETIC_DEMO_DATA s e c r e t = abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.", "secret="]
  ]) {
    assert(sourceTextForbiddenPhrase(text) === expected, `${expected} followed immediately by a value must be blocked`);
  }

  // C3-02: multi-word forbidden phrases must be recognized however their
  // words are separated, as long as the field is real prose (has a space
  // elsewhere) rather than a bare protocol identifier.
  for (const [text, expected] of [
    ["SYNTHETIC_DEMO_DATA the vendor's release is auditor-approved this quarter. NOT_CUSTOMER_SOURCE.", "auditor approved"],
    ["SYNTHETIC_DEMO_DATA this deployment is regulator-approved for release. NOT_CUSTOMER_SOURCE.", "regulator approved"],
    ["SYNTHETIC_DEMO_DATA the platform is security-guaranteed by this pass. NOT_CUSTOMER_SOURCE.", "security guaranteed"],
    ["SYNTHETIC_DEMO_DATA this package is SOC 2-certified as of today. NOT_CUSTOMER_SOURCE.", "soc 2 certified"],
    ["SYNTHETIC_DEMO_DATA the scan reports no-vulnerabilities in this build. NOT_CUSTOMER_SOURCE.", "no vulnerabilities"],
    ["SYNTHETIC_DEMO_DATA the environment is SOC_2 accepted by the reviewer. NOT_CUSTOMER_SOURCE.", "soc 2 accepted"]
  ]) {
    assert(claimSafeForbiddenPhrase(text) === expected, `${expected} must be blocked regardless of hyphen/underscore separators: ${text}`);
  }
  // Identifier-shaped values must stay exempt: they never contain a real
  // space, so separator tolerance must not fire on them even though they
  // share literal substrings with a forbidden phrase (e.g. "vendor_receipt").
  for (const identifier of ["artifact_ref:vendor_receipt", "vendor_receipt_id", "vendor-receipt.json", "codeattest-vendor-receipt-demo-key", "vendor_receipt"]) {
    assert(claimSafeForbiddenPhrase(identifier) === undefined, `bare protocol identifier must remain allowed: ${identifier}`);
  }
  // Plain (non-letter-spaced) "api key" and fully letter-spaced forms must
  // both be recognized as the same credential-shaped assignment as "api_key:".
  assert(sourceTextForbiddenPhrase("SYNTHETIC_DEMO_DATA api key: abc123 must not enter reviewer text. NOT_CUSTOMER_SOURCE.") === "api_key:", "plain 'api key:' must be blocked");
  assert(sourceTextForbiddenPhrase("SYNTHETIC_DEMO_DATA a p i k e y = abc123 must not enter reviewer text. NOT_CUSTOMER_SOURCE.") === "api_key=", "fully letter-spaced 'a p i k e y =' must be blocked");
  // Default-ignorable/bidi characters mid-phrase must be rejected outright
  // rather than silently stripped (stripping can erase a word boundary and
  // itself cause a bypass, e.g. "auditor[ZWSP]approved" -> "auditorapproved").
  for (const [label, text] of [
    ["soft hyphen inside secret=", `SYNTHETIC_DEMO_DATA sec${String.fromCodePoint(0xad)}ret=abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.`],
    ["left-to-right isolate inside secret=", `SYNTHETIC_DEMO_DATA sec${String.fromCodePoint(0x2066)}ret=abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.`],
    ["bidi embedding inside secret=", `SYNTHETIC_DEMO_DATA sec${String.fromCodePoint(0x202a)}ret=abc must not enter reviewer text. NOT_CUSTOMER_SOURCE.`],
    ["zero-width space between words", `SYNTHETIC_DEMO_DATA the release is auditor${String.fromCodePoint(0x200b)}approved today. NOT_CUSTOMER_SOURCE.`]
  ]) {
    assert(sourceTextForbiddenPhrase(text) === "hidden_control_character" || claimSafeForbiddenPhrase(text) === "hidden_control_character", `${label} must be rejected, not silently stripped: ${text}`);
  }

  console.log("protocol-ts claim safety tests passed.");
} finally {
  await rm(tempDir, { recursive: true, force: true });
  await rm(outDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
