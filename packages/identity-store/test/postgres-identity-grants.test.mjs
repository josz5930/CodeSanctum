import assert from "node:assert/strict";
import { postgresAvailable, withPostgres } from "../../evidence-store/test/helpers/postgres-harness.mjs";

// UPDATE target columns must exist on each table; Postgres analyzes the
// target list before ACL, so a missing column yields 42703 instead of 42501.
const APPEND_ONLY_UPDATE = {
  tenant: "UPDATE tenant SET display_name = 'x'",
  account: "UPDATE account SET identifier = 'x'",
  account_role_grant: "UPDATE account_role_grant SET role = 'x'",
  web_session: "UPDATE web_session SET second_factor_state = 'x'",
  web_session_revocation: "UPDATE web_session_revocation SET reason = 'x'",
  web_session_activity: "UPDATE web_session_activity SET session_handle = 'x'",
  login_attempt: "UPDATE login_attempt SET outcome = 'x'",
  submission_credential: "UPDATE submission_credential SET customer_id = 'x'",
  submission_credential_revocation: "UPDATE submission_credential_revocation SET reason = 'x'"
};

if (!(await postgresAvailable())) {
  console.log("Identity grants test skipped: no database reachable.");
  process.exit(0);
}

await withPostgres(async ({ appPool }) => {
  for (const [table, updateStatement] of Object.entries(APPEND_ONLY_UPDATE)) {
    for (const statement of [updateStatement, `DELETE FROM ${table}`]) {
      await assert.rejects(
        () => appPool.query(statement),
        (error) => error.code === "42501",
        `${statement} must be permission-denied for codeattest_app (SQLSTATE 42501)`
      );
    }
  }

  // The application role can read and append, or the whole tier is useless.
  await appPool.query(
    "INSERT INTO tenant (tenant_id, display_name) VALUES ('tenant-synthetic-demo', 'SYNTHETIC_DEMO_DATA tenant')"
  );
  const rows = await appPool.query("SELECT tenant_id FROM tenant WHERE tenant_id = 'tenant-synthetic-demo'");
  assert.equal(rows.rowCount, 1);
});

console.log("Identity grants test passed.");
