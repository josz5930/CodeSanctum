import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { compileWorkspace } from "./helpers/compile.mjs";

const { totpCodeAt, verifyTotpCode, sealTotpSecret, openTotpSecret, mintTotpSecret } =
  await compileWorkspace("totp.js");

// RFC 6238 appendix B, SHA-1, 8 digits, seed "12345678901234567890".
// Truncated to the 6 digits this implementation emits.
const rfcSecret = Buffer.from("12345678901234567890", "ascii");
const vectors = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"]
];
for (const [seconds, eightDigits] of vectors) {
  assert.equal(totpCodeAt(rfcSecret, seconds), eightDigits.slice(-6),
    `RFC 6238 vector at t=${seconds} must match`);
}

// A one-step window either side, and nothing further.
const t = 1111111109;
assert.equal(verifyTotpCode(rfcSecret, totpCodeAt(rfcSecret, t), t), true);
assert.equal(verifyTotpCode(rfcSecret, totpCodeAt(rfcSecret, t - 30), t), true, "one step early is accepted");
assert.equal(verifyTotpCode(rfcSecret, totpCodeAt(rfcSecret, t + 30), t), true, "one step late is accepted");
assert.equal(verifyTotpCode(rfcSecret, totpCodeAt(rfcSecret, t - 90), t), false, "three steps early is rejected");
assert.equal(verifyTotpCode(rfcSecret, "000000", 0), false);
for (const junk of ["", "12345", "1234567", "abcdef", "12 456"]) {
  assert.equal(verifyTotpCode(rfcSecret, junk, t), false, `${JSON.stringify(junk)} must not verify`);
}

// The secret is encrypted at rest and tamper-evident.
const key = randomBytes(32);
const minted = mintTotpSecret();
assert.match(minted.base32, /^[A-Z2-7]{32}$/, "an enrollment secret is 20 bytes of base32 with no padding");
const box = sealTotpSecret(minted.secret, key);
assert.deepEqual(openTotpSecret(box, key), minted.secret);
assert.equal(openTotpSecret(box, randomBytes(32)), undefined, "a wrong key must not open the box");
assert.equal(openTotpSecret(box.slice(0, -2) + "00", key), undefined, "a tampered box must not open");
assert.equal(openTotpSecret("not-a-box", key), undefined);

console.log("TOTP test passed.");
