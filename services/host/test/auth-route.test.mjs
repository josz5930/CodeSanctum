import assert from "node:assert/strict";
import { buildTestServer, SEEDED } from "./helpers/identity-fixtures.mjs";

const { server, ports } = await buildTestServer();

function setCookie(headers) {
  const value = headers["set-cookie"];
  return Array.isArray(value) ? value[0] : value;
}

// --- login ------------------------------------------------------------------
const ok = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: SEEDED.customer.identifier, secret: SEEDED.customer.password }
});
assert.equal(ok.statusCode, 204, ok.body);
const cookie = setCookie(ok.headers);
assert.ok(typeof cookie === "string" && cookie.startsWith("__Host-codeattest_session="));
assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Strict"));
// The token must not appear in any response body.
assert.equal(ok.body, "");

// The identifier is lowercased before lookup, so case does not gate access.
const uppercase = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: SEEDED.customer.identifier.toUpperCase(), secret: SEEDED.customer.password }
});
assert.equal(uppercase.statusCode, 204);

// --- failures are indistinguishable ------------------------------------------
const wrongPassword = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: SEEDED.customer.identifier, secret: "wrong" }
});
const noSuchAccount = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: "nobody@synthetic.invalid", secret: "wrong" }
});
assert.equal(wrongPassword.statusCode, 401);
assert.equal(noSuchAccount.statusCode, 401);
assert.deepEqual(wrongPassword.json(), noSuchAccount.json(),
  "an unknown account and a wrong password must be indistinguishable");
assert.equal(wrongPassword.json().reason_code, "auth_credentials_invalid");
assert.equal(wrongPassword.headers["set-cookie"], undefined);

// --- lockout ------------------------------------------------------------------
for (let attempt = 0; attempt < 5; attempt += 1) {
  await server.inject({ method: "POST", url: "/v0/auth/login", payload: { identifier: SEEDED.locked.identifier, secret: "wrong" } });
}
const lockedOut = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: SEEDED.locked.identifier, secret: SEEDED.locked.password }
});
assert.equal(lockedOut.statusCode, 401);
assert.equal(lockedOut.json().reason_code, "auth_credentials_invalid",
  "a locked account must not announce that it is locked");
assert.equal(lockedOut.headers["set-cookie"], undefined, "the correct password must not open a locked identifier");

// --- second factor ------------------------------------------------------------
const reviewer = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: SEEDED.reviewer.identifier, secret: SEEDED.reviewer.password }
});
assert.equal(reviewer.statusCode, 202);
assert.deepEqual(reviewer.json(), { second_factor_required: true });
const pending = setCookie(reviewer.headers);
assert.ok(pending, "a pending session cookie is issued so the second step has something to upgrade");

const beforeSecondFactor = await server.inject({ method: "GET", url: "/v0/auth/session", headers: { cookie: pending } });
assert.equal(beforeSecondFactor.statusCode, 401,
  "a session awaiting its second factor must not authenticate anything");

const upgraded = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: pending },
  payload: { code: SEEDED.reviewer.currentTotpCode() }
});
assert.equal(upgraded.statusCode, 204);
const satisfied = setCookie(upgraded.headers);
assert.notEqual(satisfied, pending, "the session must be re-issued, not upgraded in place");

const session = await server.inject({ method: "GET", url: "/v0/auth/session", headers: { cookie: satisfied } });
assert.equal(session.statusCode, 200);
assert.deepEqual(session.json().roles, ["codeattest_reviewer"]);
assert.equal(session.json().account_id, SEEDED.reviewer.account_id);
assert.equal(JSON.stringify(session.json()).includes(SEEDED.reviewer.password), false);

// --- logout -------------------------------------------------------------------
const out = await server.inject({ method: "POST", url: "/v0/auth/logout", headers: { cookie: satisfied } });
assert.equal(out.statusCode, 204);
assert.match(setCookie(out.headers) ?? "", /Max-Age=0/);
const afterLogout = await server.inject({ method: "GET", url: "/v0/auth/session", headers: { cookie: satisfied } });
assert.equal(afterLogout.statusCode, 401, "a revoked session must not resolve again");

// A well-formed cookie whose handle was never issued must still clear the
// cookie. Logout is not a probe for whether a session row exists.
const unknown = await server.inject({
  method: "POST", url: "/v0/auth/logout",
  headers: { cookie: "__Host-codeattest_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }
});
assert.equal(unknown.statusCode, 204, unknown.body);
assert.match(setCookie(unknown.headers) ?? "", /Max-Age=0/);

await server.close();
console.log("Auth route test passed.");
