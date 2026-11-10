import assert from "node:assert/strict";
import { buildTestServer, SEEDED } from "./helpers/identity-fixtures.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { sessionHandleFor } = await importCompiled("../../packages/identity-store/src/session-token.js");

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

// The lockout counts per identifier AND client network. A stranger who knows
// the username locks it only for their own network; the owner, on another
// network behind the same proxy, can still sign in.
const attacker = { "x-forwarded-for": "198.51.100.66" };
const owner = { "x-forwarded-for": "192.0.2.10" };
for (let attempt = 0; attempt < 5; attempt += 1) {
  await server.inject({
    method: "POST", url: "/v0/auth/login", headers: attacker,
    payload: { identifier: SEEDED.customer.identifier, secret: "wrong" }
  });
}
const attackerWithPassword = await server.inject({
  method: "POST", url: "/v0/auth/login", headers: attacker,
  payload: { identifier: SEEDED.customer.identifier, secret: SEEDED.customer.password }
});
assert.equal(attackerWithPassword.statusCode, 401, "the network that made the failures stays locked");
const ownerLogin = await server.inject({
  method: "POST", url: "/v0/auth/login", headers: owner,
  payload: { identifier: SEEDED.customer.identifier, secret: SEEDED.customer.password }
});
assert.equal(ownerLogin.statusCode, 204, "failures from one network must not lock the account for another network");

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

const firstCodeAt = Math.floor(Date.now() / 1000);
const firstCode = SEEDED.reviewer.totpCodeAt(firstCodeAt);
const upgraded = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: pending },
  payload: { code: firstCode }
});
assert.equal(upgraded.statusCode, 204);
const satisfied = setCookie(upgraded.headers);
assert.notEqual(satisfied, pending, "the session must be re-issued, not upgraded in place");

const session = await server.inject({ method: "GET", url: "/v0/auth/session", headers: { cookie: satisfied } });
assert.equal(session.statusCode, 200);
assert.deepEqual(session.json().roles, ["codeattest_reviewer"]);
assert.equal(session.json().account_id, SEEDED.reviewer.account_id);
assert.equal(JSON.stringify(session.json()).includes(SEEDED.reviewer.password), false);

// --- second factor: a used code cannot sign in again (RFC 6238 section 5.2) ---
async function pendingReviewerCookie() {
  const response = await server.inject({
    method: "POST", url: "/v0/auth/login",
    payload: { identifier: SEEDED.reviewer.identifier, secret: SEEDED.reviewer.password }
  });
  assert.equal(response.statusCode, 202);
  return setCookie(response.headers);
}

const replayPending = await pendingReviewerCookie();
const replayed = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: replayPending },
  payload: { code: firstCode }
});
assert.equal(replayed.statusCode, 401, "a code that already signed in must be refused");
assert.equal(replayed.json().reason_code, "auth_credentials_invalid",
  "a replayed code must look the same as a wrong code");
assert.equal(replayed.headers["set-cookie"], undefined);

const earlier = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: replayPending },
  payload: { code: SEEDED.reviewer.totpCodeAt(firstCodeAt - 30) }
});
assert.equal(earlier.statusCode, 401, "a code from a step before the used step must be refused");

// The code of the next step is new, so the same pending session can still
// finish its sign-in with it.
const nextStep = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: replayPending },
  payload: { code: SEEDED.reviewer.totpCodeAt(firstCodeAt + 30) }
});
assert.equal(nextStep.statusCode, 204, nextStep.body);

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

// --- a cap on guesses from many networks ---------------------------------------
// The owner signs in from a usual network first. Then 20 wrong passwords
// arrive, 4 from each of 5 networks, so no one network reaches its own limit.
const usualNetwork = { "x-forwarded-for": "192.0.2.77" };
const usualLogin = await server.inject({
  method: "POST", url: "/v0/auth/login", headers: usualNetwork,
  payload: { identifier: SEEDED.scopedCustomer.identifier, secret: SEEDED.scopedCustomer.password }
});
assert.equal(usualLogin.statusCode, 204);
for (let network = 0; network < 5; network += 1) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await server.inject({
      method: "POST", url: "/v0/auth/login", headers: { "x-forwarded-for": `203.0.113.${network + 1}` },
      payload: { identifier: SEEDED.scopedCustomer.identifier, secret: "wrong" }
    });
  }
}
const freshNetworkWithPassword = await server.inject({
  method: "POST", url: "/v0/auth/login", headers: { "x-forwarded-for": "203.0.113.200" },
  payload: { identifier: SEEDED.scopedCustomer.identifier, secret: SEEDED.scopedCustomer.password }
});
assert.equal(freshNetworkWithPassword.statusCode, 401,
  "after 20 failures from many networks, a network that never signed in gets no more guesses");
assert.equal(freshNetworkWithPassword.json().reason_code, "auth_credentials_invalid");
assert.equal(freshNetworkWithPassword.headers["set-cookie"], undefined);
const usualAgain = await server.inject({
  method: "POST", url: "/v0/auth/login", headers: usualNetwork,
  payload: { identifier: SEEDED.scopedCustomer.identifier, secret: SEEDED.scopedCustomer.password }
});
assert.equal(usualAgain.statusCode, 204, "the owner's usual network can still sign in");

// --- second factor: wrong codes lock, and a new password sign-in does not reset --
// Before this was fixed, a caller who had the password could try 4 codes, sign
// in again (a success that cleared the count), and continue without end.
let wrongCodeReplies = 0;
for (let cycle = 0; cycle < 3; cycle += 1) {
  const cyclePending = await pendingReviewerCookie();
  for (let guess = 0; guess < 2; guess += 1) {
    const wrongCode = await server.inject({
      method: "POST", url: "/v0/auth/login/second-factor",
      headers: { cookie: cyclePending },
      payload: { code: "abcdef" }
    });
    assert.equal(wrongCode.statusCode, 401);
    wrongCodeReplies += 1;
  }
}
assert.equal(wrongCodeReplies, 6);
const lockedPending = await pendingReviewerCookie();
const correctWhileLocked = await server.inject({
  method: "POST", url: "/v0/auth/login/second-factor",
  headers: { cookie: lockedPending },
  payload: { code: SEEDED.reviewer.currentTotpCode() }
});
assert.equal(correctWhileLocked.statusCode, 401,
  "five wrong codes lock the second factor, also across new password sign-ins");
assert.equal(correctWhileLocked.headers["set-cookie"], undefined);
// The pending session is revoked, so it is of no use when the lock ends.
assert.equal(await ports.sessions.resolve(sessionHandleFor(lockedPending.split(";")[0].split("=")[1]), new Date()), undefined,
  "a pending session that meets the lock must be revoked");

// --- an unexpected failure does not show its text ------------------------------
const realFind = ports.accounts.findByIdentifier;
ports.accounts.findByIdentifier = async () => {
  throw new Error('relation "account" does not exist; role codeattest_app at 10.0.0.5');
};
const failed = await server.inject({
  method: "POST", url: "/v0/auth/login",
  payload: { identifier: "nobody-2@synthetic.invalid", secret: "x" }
});
ports.accounts.findByIdentifier = realFind;
assert.equal(failed.statusCode, 500);
assert.deepEqual(failed.json(), { reason_code: "internal_error", message: "The request could not be completed." });
assert.equal(failed.body.includes("codeattest_app"), false, "the error text must stay in the log");

// A request that Fastify refuses keeps its 4xx status, with a fixed message.
const notJson = await server.inject({
  method: "POST", url: "/v0/auth/login",
  headers: { "content-type": "application/json" }, payload: "{not json"
});
assert.equal(notJson.statusCode, 400);
assert.equal(notJson.json().reason_code, "request_invalid");

await server.close();
console.log("Auth route test passed.");
