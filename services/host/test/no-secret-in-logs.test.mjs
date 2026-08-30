import assert from "node:assert/strict";
import { buildTestServer, SEEDED } from "./helpers/identity-fixtures.mjs";

const captured = [];
const { server } = await buildTestServer({
  logger: { stream: { write: (line) => captured.push(line) }, level: "trace" }
});

await server.inject({ method: "POST", url: "/v0/auth/login", payload: { identifier: SEEDED.customer.identifier, secret: SEEDED.customer.password } });
await server.inject({ method: "POST", url: "/v0/auth/login", payload: { identifier: SEEDED.customer.identifier, secret: "wrong-but-distinctive-value" } });
await server.close();

const log = captured.join("\n");
for (const secret of [
  SEEDED.customer.password,
  "wrong-but-distinctive-value",
  SEEDED.reviewer.totpBase32,
  SEEDED.submissionSecret
]) {
  assert.equal(log.includes(secret), false, `a secret appeared in the log output: ${secret.slice(0, 6)}...`);
}
// Nor may a session token: it is as good as the password while it lives.
assert.equal(/__Host-codeattest_session=[A-Za-z0-9_-]{43}/.test(log), false,
  "a session cookie value appeared in the log output");
assert.ok(captured.length > 0, "the logger captured nothing, so this test proved nothing");

console.log("No-secret-in-logs test passed.");
