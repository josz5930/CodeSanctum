import type { SqlExecutor } from "../../../packages/evidence-store/src/index.js";

export type GrantSelfTestResult = { ok: true } | { ok: false; reason: string };

/**
 * Attempts an UPDATE against a canary append-only table inside a
 * transaction that always rolls back. If the UPDATE succeeds, the database
 * grants are wrong (codeattest_app should hold no UPDATE privilege on
 * review_event — see infra/migrations/0002_roles_and_grants.sql) and the
 * process must not boot. This verifies the grants on every boot rather than
 * trusting that a migration was applied correctly (design doc section 5.6,
 * step 5) — there is no cloud IAM to attest on a self-hosted box's behalf.
 */
export async function runGrantSelfTest(pool: {
  withConnection<T>(fn: (client: SqlExecutor) => Promise<T>): Promise<T>;
}): Promise<GrantSelfTestResult> {
  return pool.withConnection(async (client) => {
    await client.query("BEGIN");
    let updateSucceeded = false;
    let unexpectedError: string | undefined;
    try {
      await client.query("UPDATE review_event SET recorded_at = now() WHERE false");
      updateSucceeded = true;
    } catch (error) {
      // Postgres localizes error messages via lc_messages, so the English
      // "permission denied" text is not reliable on a non-English-locale
      // cluster. SQLSTATE 42501 (insufficient_privilege) is locale-invariant
      // and is the primary check; the regex remains as a fallback for any
      // pg-like error surface that doesn't set `.code`.
      const code = (error as { code?: string }).code;
      if (code !== "42501" && !/permission denied/i.test((error as Error).message)) {
        unexpectedError = (error as Error).message;
      }
    }
    await client.query("ROLLBACK");

    if (updateSucceeded) {
      return { ok: false, reason: "codeattest_app was able to UPDATE review_event; database grants are misconfigured" };
    }
    if (unexpectedError !== undefined) {
      return { ok: false, reason: `grant self-test hit an unexpected error: ${unexpectedError}` };
    }
    return { ok: true };
  });
}
