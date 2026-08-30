import { postgresAvailable, withPostgres } from "../../evidence-store/test/helpers/postgres-harness.mjs";
import { compileWorkspace } from "./helpers/compile.mjs";
import { runIdentityContract } from "./identity-contract.mjs";

if (!(await postgresAvailable())) {
  console.log("postgres-identity test skipped: no database reachable.");
  process.exit(0);
}

const { createPostgresAccountStore } = await compileWorkspace("postgres/account-store.js");
const { createPostgresSessionStore } = await compileWorkspace("postgres/session-store.js");
const { createPostgresLoginThrottle } = await compileWorkspace("postgres/login-throttle.js");
const { createPostgresSubmissionCredentialStore } = await compileWorkspace("postgres/submission-credential-store.js");

const t0 = new Date("2026-08-16T12:00:00Z");

await withPostgres(async ({ appPool }) => {
  await runIdentityContract("postgres", async () => {
    const accounts = createPostgresAccountStore(appPool);
    const sessions = createPostgresSessionStore(appPool);
    const throttle = createPostgresLoginThrottle(appPool, { now: () => t0 });
    const credentials = createPostgresSubmissionCredentialStore(appPool);
    return {
      accounts,
      sessions,
      throttle,
      credentials,
      async seed(input) {
        await appPool.query(
          "INSERT INTO tenant (tenant_id, display_name) VALUES ($1, $2)",
          [input.tenant.tenant_id, input.tenant.display_name]
        );
        await appPool.query(
          "INSERT INTO account (account_id, tenant_id, identifier, secret_hash) VALUES ($1, $2, $3, $4)",
          [input.account.account_id, input.account.tenant_id, input.account.identifier, input.account.secret_hash]
        );
        for (const grant of input.grants) {
          await appPool.query(
            "INSERT INTO account_role_grant (account_id, role, review_scope) VALUES ($1, $2, $3)",
            [grant.account_id, grant.role, grant.review_scope]
          );
        }
      }
    };
  });
});
