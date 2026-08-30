import { LOGIN_LOCKOUT_THRESHOLD, type LoginThrottle } from "../ports.js";

type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function createPostgresLoginThrottle(sql: SqlExecutor, options?: { now?: () => Date }): LoginThrottle {
  const clock = options?.now ?? (() => new Date());

  return {
    async record(identifierHash, outcome) {
      await sql.query(
        `INSERT INTO login_attempt (identifier_hash, outcome, occurred_at)
         VALUES ($1, $2, $3)`,
        [identifierHash, outcome, clock()]
      );
    },

    async state(identifierHash, now) {
      const { rows } = await sql.query(
        `SELECT count(*) AS failures
           FROM login_attempt
          WHERE identifier_hash = $1
            AND outcome = 'failed'
            AND occurred_at > GREATEST(
                  $2::timestamptz - interval '15 minutes',
                  COALESCE((SELECT max(occurred_at) FROM login_attempt
                             WHERE identifier_hash = $1 AND outcome = 'succeeded'), '-infinity'::timestamptz)
                )`,
        [identifierHash, now]
      );
      const failures = Number(rows[0]?.failures ?? 0);
      return failures >= LOGIN_LOCKOUT_THRESHOLD ? "locked" : "open";
    }
  };
}
