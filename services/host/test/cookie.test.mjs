import assert from "node:assert/strict";
import { importCompiled } from "./helpers/compile.mjs";

const { serializeSessionCookie, readSessionCookie, SESSION_COOKIE_NAME, SESSION_COOKIE_NAME_INSECURE } =
  await importCompiled("src/auth/cookie.js");

assert.equal(SESSION_COOKIE_NAME, "__Host-codeattest_session");
assert.equal(SESSION_COOKIE_NAME_INSECURE, "codeattest_session_insecure_local");

const secure = serializeSessionCookie("tok", { secure: true, maxAgeSeconds: 43200 });
assert.match(secure, /^__Host-codeattest_session=tok; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200$/);
assert.ok(!secure.includes("Domain="), "__Host- forbids a Domain attribute");

// The insecure local-development form must not borrow the __Host- name, which
// browsers only honour with Secure. A prefix without its guarantee is worse
// than no prefix.
const insecure = serializeSessionCookie("tok", { secure: false, maxAgeSeconds: 43200 });
assert.ok(insecure.startsWith("codeattest_session_insecure_local=tok;"));
assert.ok(!insecure.includes("Secure"));

assert.equal(readSessionCookie("__Host-codeattest_session=tok", true), "tok");
assert.equal(readSessionCookie("other=1; __Host-codeattest_session=tok; more=2", true), "tok");
assert.equal(readSessionCookie("codeattest_session_insecure_local=tok", true), undefined,
  "a secure deployment must ignore the insecure cookie name");
assert.equal(readSessionCookie(undefined, true), undefined);
assert.equal(readSessionCookie("", true), undefined);
assert.equal(readSessionCookie("__Host-codeattest_session=", true), undefined, "an empty value is not a token");

console.log("Cookie test passed.");
