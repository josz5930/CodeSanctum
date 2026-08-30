import assert from "node:assert/strict";
import { compileWorkspace } from "./helpers/compile.mjs";
import { runIdentityContract } from "./identity-contract.mjs";

const { createMemoryAccountStore } = await compileWorkspace("memory/account-store.js");
const { createMemorySessionStore } = await compileWorkspace("memory/session-store.js");
const { createMemoryLoginThrottle } = await compileWorkspace("memory/login-throttle.js");
const { createMemorySubmissionCredentialStore } = await compileWorkspace("memory/submission-credential-store.js");

const t0 = new Date("2026-08-16T12:00:00Z");

await runIdentityContract("memory", async () => {
  const accounts = createMemoryAccountStore();
  const sessions = createMemorySessionStore();
  const throttle = createMemoryLoginThrottle({ now: () => t0 });
  const credentials = createMemorySubmissionCredentialStore();
  return {
    accounts,
    sessions,
    throttle,
    credentials,
    seed: (input) => accounts.seed(input)
  };
});

{
  const sessions = createMemorySessionStore();
  const abs = new Date(t0.getTime() + 12 * 60 * 60 * 1000);
  await sessions.issue({
    session_handle: "a".repeat(64),
    account_id: "account:synthetic-one",
    issued_at: t0,
    absolute_expires_at: abs,
    second_factor_state: "satisfied"
  });
  await sessions.issue({
    session_handle: "b".repeat(64),
    account_id: "account:synthetic-one",
    issued_at: t0,
    absolute_expires_at: abs,
    second_factor_state: "pending"
  });
  await sessions.issue({
    session_handle: "c".repeat(64),
    account_id: "account:synthetic-two",
    issued_at: t0,
    absolute_expires_at: abs,
    second_factor_state: "satisfied"
  });
  await sessions.revokeAllForAccount("account:synthetic-one", "operator_revoked");
  assert.equal(await sessions.resolve("a".repeat(64), t0), undefined,
    "reset-secret must revoke live sessions for that account");
  assert.equal(await sessions.resolve("b".repeat(64), t0), undefined,
    "pending sessions are sessions too");
  assert.ok(await sessions.resolve("c".repeat(64), t0),
    "other accounts' sessions stay live");
  console.log("Memory revoke-all-for-account test passed.");
}
