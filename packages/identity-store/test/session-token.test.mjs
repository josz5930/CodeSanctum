import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compileWorkspace } from "./helpers/compile.mjs";

const { mintSessionToken, sessionHandleFor } = await compileWorkspace("session-token.js");

const seen = new Set();
for (let index = 0; index < 512; index += 1) {
  const { token, handle } = mintSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes are 43 base64url characters with no padding");
  assert.equal(handle, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.equal(seen.has(token), false, "minted tokens must not repeat");
  seen.add(token);
}
assert.equal(sessionHandleFor("a"), sessionHandleFor("a"), "handle derivation must be deterministic");

console.log("Session token test passed.");
