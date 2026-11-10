import assert from "node:assert/strict";
import { postgresAvailable, withPostgres } from "../../evidence-store/test/helpers/postgres-harness.mjs";
import { compileWorkspace } from "./helpers/compile.mjs";

if (!(await postgresAvailable())) {
  console.log("Identity prune test skipped: no database reachable.");
  process.exit(0);
}

const { pruneIdentityRecords } = await compileWorkspace("postgres/prune.js");

const OLD = "now() - interval '31 days'";
const RECENT = "now() - interval '29 days'";
const oldSession = "a".repeat(64);
const recentSession = "b".repeat(64);
const liveSession = "c".repeat(64);

await withPostgres(async ({ migratorPool, appPool }) => {
  // The migrator seeds rows with past timestamps.
  await migratorPool.query("INSERT INTO tenant (tenant_id, display_name) VALUES ('tenant-synthetic-demo', 'SYNTHETIC_DEMO_DATA tenant')");
  await migratorPool.query(
    `INSERT INTO account (account_id, tenant_id, identifier, secret_hash)
     VALUES ('account:synthetic-prune', 'tenant-synthetic-demo', 'prune@synthetic.invalid', 'scrypt$1$1$1$00$00')`
  );
  await migratorPool.query(
    `INSERT INTO login_attempt (identifier_hash, outcome, occurred_at) VALUES
       ($1, 'failed', ${OLD}), ($1, 'succeeded', ${OLD}), ($1, 'failed', ${RECENT}), ($1, 'succeeded', now())`,
    ["d".repeat(64)]
  );
  await migratorPool.query(
    `INSERT INTO web_session (session_handle, account_id, issued_at, absolute_expires_at, second_factor_state) VALUES
       ($1, 'account:synthetic-prune', ${OLD} - interval '12 hours', ${OLD}, 'not_required'),
       ($2, 'account:synthetic-prune', ${RECENT} - interval '12 hours', ${RECENT}, 'not_required'),
       ($3, 'account:synthetic-prune', now(), now() + interval '12 hours', 'not_required')`,
    [oldSession, recentSession, liveSession]
  );
  for (const handle of [oldSession, recentSession, liveSession]) {
    await migratorPool.query("INSERT INTO web_session_activity (session_handle) VALUES ($1), ($1)", [handle]);
  }
  await migratorPool.query(
    "INSERT INTO web_session_revocation (session_handle, reason) VALUES ($1, 'logout'), ($2, 'logout')",
    [oldSession, recentSession]
  );

  // The application role runs the cleanup; it has no DELETE grant of its own.
  await assert.rejects(() => appPool.query("DELETE FROM login_attempt"), (error) => error.code === "42501");
  assert.deepEqual(await pruneIdentityRecords(appPool), { login_attempts: 2, web_sessions: 1 });

  const count = async (text, values) => Number((await migratorPool.query(text, values)).rows[0].n);
  assert.equal(await count("SELECT count(*) AS n FROM login_attempt"), 2, "attempts under 30 days old stay");
  assert.equal(await count("SELECT count(*) AS n FROM web_session"), 2);
  assert.equal(await count("SELECT count(*) AS n FROM web_session WHERE session_handle = $1", [oldSession]), 0);
  assert.equal(await count("SELECT count(*) AS n FROM web_session_activity"), 4, "only the removed session's activity goes");
  assert.equal(await count("SELECT count(*) AS n FROM web_session_revocation"), 1);
  assert.equal(await count("SELECT count(*) AS n FROM web_session WHERE session_handle = $1", [liveSession]), 1,
    "a live session is never removed");

  // A second run finds nothing more.
  assert.deepEqual(await pruneIdentityRecords(appPool), { login_attempts: 0, web_sessions: 0 });
});

console.log("Identity prune test passed.");
