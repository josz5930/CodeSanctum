import assert from "node:assert/strict";
import { compileWorkspace } from "./helpers/compile.mjs";

const { hashSecret, verifySecret, SCRYPT_PARAMETERS } = await compileWorkspace("secret-hash.js");

assert.deepEqual(SCRYPT_PARAMETERS, { N: 32768, r: 8, p: 1, keyLength: 32 });

const stored = hashSecret("synthetic-demo-password");
assert.match(stored, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/);

// The salt is random, so two hashes of the same secret differ.
assert.notEqual(stored, hashSecret("synthetic-demo-password"));

assert.equal(verifySecret(stored, "synthetic-demo-password"), true);
assert.equal(verifySecret(stored, "synthetic-demo-passwore"), false);
assert.equal(verifySecret(stored, ""), false);

// A malformed stored hash is a verification failure, never a throw: a corrupt
// row must deny access, not crash the login route into a 500 that leaks it.
for (const malformed of ["", "scrypt$", "scrypt$a$b$c$d$e", "argon2$x$y$z$w$v", "scrypt$32768$8$1$zz$00"]) {
  assert.equal(verifySecret(malformed, "synthetic-demo-password"), false, `${malformed} must not verify`);
}

// Parameters live in the string, so a future re-tune reads old hashes.
const weaker = stored.replace("$32768$", "$16384$");
assert.equal(verifySecret(weaker, "synthetic-demo-password"), false, "changing N must invalidate, not silently pass");

console.log("Secret hash test passed.");
