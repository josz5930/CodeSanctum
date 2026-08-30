import assert from "node:assert/strict";

const HOUR = 60 * 60 * 1000;

export async function runIdentityContract(name, makePorts) {
  const { accounts, sessions, throttle, credentials, seed } = await makePorts();
  const t0 = new Date("2026-08-16T12:00:00Z");

  await seed({
    tenant: { tenant_id: "tenant-synthetic-demo", display_name: "SYNTHETIC_DEMO_DATA tenant" },
    account: {
      account_id: "account:synthetic-reviewer",
      tenant_id: "tenant-synthetic-demo",
      identifier: "reviewer@synthetic.invalid",
      secret_hash: "scrypt$32768$8$1$" + "0".repeat(32) + "$" + "0".repeat(64)
    },
    grants: [
      { account_id: "account:synthetic-reviewer", role: "codeattest_reviewer", review_scope: null },
      { account_id: "account:synthetic-reviewer", role: "customer_viewer", review_scope: "review:synthetic-demo-0001" }
    ]
  });

  // --- accounts -------------------------------------------------------------
  const found = await accounts.findByIdentifier("reviewer@synthetic.invalid");
  assert.ok(found, `${name}: a seeded identifier must resolve`);
  assert.equal(found.tenant_id, "tenant-synthetic-demo");
  assert.equal(await accounts.findByIdentifier("REVIEWER@SYNTHETIC.INVALID"), undefined,
    `${name}: lookup is exact; the route lowercases before calling, the store does not guess`);
  assert.equal(await accounts.findByIdentifier("nobody@synthetic.invalid"), undefined);

  const grants = await accounts.grantsFor("account:synthetic-reviewer");
  assert.equal(grants.length, 2, `${name}: every grant must come back`);

  // --- sessions -------------------------------------------------------------
  await sessions.issue({
    session_handle: "a".repeat(64),
    account_id: "account:synthetic-reviewer",
    issued_at: t0,
    absolute_expires_at: new Date(t0.getTime() + 12 * HOUR),
    second_factor_state: "satisfied"
  });

  // Issued_at is the idle origin; t0+1h would already be past the 30-minute idle window.
  const live = await sessions.resolve("a".repeat(64), t0);
  assert.ok(live, `${name}: a fresh session must resolve`);
  assert.equal(live.account_id, "account:synthetic-reviewer");
  assert.equal(live.second_factor_state, "satisfied");

  assert.equal(await sessions.resolve("b".repeat(64), t0), undefined,
    `${name}: an unknown handle must resolve to undefined, not throw`);

  // Idle timeout: no activity for over 30 minutes closes the session even
  // though its absolute expiry is hours away.
  assert.equal(await sessions.resolve("a".repeat(64), new Date(t0.getTime() + 31 * 60 * 1000)), undefined,
    `${name}: an idle session must not resolve`);

  // Activity keeps it alive.
  await sessions.touch("a".repeat(64), new Date(t0.getTime() + 20 * 60 * 1000));
  assert.ok(await sessions.resolve("a".repeat(64), new Date(t0.getTime() + 40 * 60 * 1000)),
    `${name}: recorded activity must extend the idle window`);

  // Absolute expiry is not extendable by activity.
  await sessions.touch("a".repeat(64), new Date(t0.getTime() + 12 * HOUR - 1000));
  assert.equal(await sessions.resolve("a".repeat(64), new Date(t0.getTime() + 12 * HOUR + 1000)), undefined,
    `${name}: activity must never push past the absolute expiry`);

  // Revocation is immediate and irreversible.
  await sessions.issue({
    session_handle: "c".repeat(64),
    account_id: "account:synthetic-reviewer",
    issued_at: t0,
    absolute_expires_at: new Date(t0.getTime() + 12 * HOUR),
    second_factor_state: "satisfied"
  });
  assert.ok(await sessions.resolve("c".repeat(64), t0));
  await sessions.revoke("c".repeat(64), "logout");
  assert.equal(await sessions.resolve("c".repeat(64), t0), undefined,
    `${name}: a revoked session must never resolve again`);
  await sessions.touch("c".repeat(64), t0);
  assert.equal(await sessions.resolve("c".repeat(64), t0), undefined,
    `${name}: activity must not resurrect a revoked session`);

  // Logout presents whatever cookie the browser has. A stale or forged token
  // hashes to a handle the store never issued; revoke must not throw.
  await sessions.revoke("f".repeat(64), "logout");
  assert.equal(await sessions.resolve("f".repeat(64), t0), undefined,
    `${name}: revoking an unknown handle is a no-op`);

  await sessions.issue({
    session_handle: "e".repeat(64),
    account_id: "account:synthetic-reviewer",
    issued_at: t0,
    absolute_expires_at: new Date(t0.getTime() + 12 * HOUR),
    second_factor_state: "pending"
  });
  const awaiting = await sessions.resolve("e".repeat(64), t0);
  assert.ok(awaiting, `${name}: a pending session must resolve so it can be upgraded`);
  assert.equal(awaiting.second_factor_state, "pending",
    `${name}: the pending state must survive resolution, or the resolver cannot refuse it`);

  // --- throttle -------------------------------------------------------------
  const hash = "d".repeat(64);
  assert.equal(await throttle.state(hash, t0), "open");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await throttle.record(hash, "failed");
  }
  assert.equal(await throttle.state(hash, t0), "open", `${name}: four failures must not lock`);
  await throttle.record(hash, "failed");
  assert.equal(await throttle.state(hash, t0), "locked", `${name}: the fifth failure locks`);
  assert.equal(await throttle.state(hash, new Date(t0.getTime() + 16 * 60 * 1000)), "open",
    `${name}: the lock expires after fifteen minutes`);
  await throttle.record(hash, "succeeded");
  assert.equal(await throttle.state(hash, t0), "open", `${name}: a success clears the count`);

  // --- submission credentials -------------------------------------------------
  const t1 = new Date("2026-08-16T12:00:00Z");
  await credentials.issue({
    token_key_id: "demo-runner-key-1",
    review_id: "review:synthetic-demo-0001",
    tenant_id: "tenant-synthetic-demo",
    customer_id: "customer-synthetic-demo",
    selected_application_id: "app-synthetic-demo",
    selected_commit: "a".repeat(40),
    repository_identity_hash: `sha256:${"b".repeat(64)}`,
    expected_manifest_id: `sha256:${"c".repeat(64)}`,
    secret_hash: "scrypt$32768$8$1$" + "0".repeat(32) + "$" + "0".repeat(64),
    issued_at: t1,
    expires_at: new Date(t1.getTime() + 30 * 24 * 60 * 60 * 1000)
  });

  assert.ok(await credentials.resolve("demo-runner-key-1", t1), `${name}: a live credential resolves`);
  assert.equal(await credentials.resolve("no-such-key", t1), undefined);

  // Expiry is enforced by the store, not by whoever remembers to check.
  assert.equal(await credentials.resolve("demo-runner-key-1", new Date(t1.getTime() + 31 * 24 * 60 * 60 * 1000)), undefined,
    `${name}: an expired credential must not resolve`);

  // Revocation is immediate.
  await credentials.revoke("demo-runner-key-1", "operator_revoked");
  assert.equal(await credentials.resolve("demo-runner-key-1", t1), undefined,
    `${name}: a revoked credential must not resolve, even before its expiry`);

  // Re-issuing under a revoked key id is refused: rotation mints a new id, so a
  // revoked credential can never come back to life.
  await assert.rejects(
    () =>
      credentials.issue({
        token_key_id: "demo-runner-key-1",
        review_id: "review:synthetic-demo-0001",
        tenant_id: "tenant-synthetic-demo",
        customer_id: "customer-synthetic-demo",
        selected_application_id: "app-synthetic-demo",
        selected_commit: "a".repeat(40),
        repository_identity_hash: `sha256:${"b".repeat(64)}`,
        expected_manifest_id: `sha256:${"c".repeat(64)}`,
        secret_hash: "scrypt$32768$8$1$" + "1".repeat(32) + "$" + "1".repeat(64),
        issued_at: t1,
        expires_at: new Date(t1.getTime() + 30 * 24 * 60 * 60 * 1000)
      }),
    `${name}: a revoked key id must not be reusable`
  );

  // Rotation is a new key id alongside the revoked one, and it resolves.
  await credentials.issue({
    token_key_id: "demo-runner-key-2",
    review_id: "review:synthetic-demo-0001",
    tenant_id: "tenant-synthetic-demo",
    customer_id: "customer-synthetic-demo",
    selected_application_id: "app-synthetic-demo",
    selected_commit: "a".repeat(40),
    repository_identity_hash: `sha256:${"b".repeat(64)}`,
    expected_manifest_id: `sha256:${"c".repeat(64)}`,
    secret_hash: "scrypt$32768$8$1$" + "2".repeat(32) + "$" + "2".repeat(64),
    issued_at: t1,
    expires_at: new Date(t1.getTime() + 30 * 24 * 60 * 60 * 1000)
  });
  assert.ok(await credentials.resolve("demo-runner-key-2", t1), `${name}: a rotated-in credential resolves`);
  assert.equal(await credentials.resolve("demo-runner-key-1", t1), undefined,
    `${name}: rotation must not resurrect the credential it replaced`);

  console.log(`Identity contract passed for ${name}.`);
}
