import { LOGIN_LOCKOUT_THRESHOLD, type LoginThrottle } from "../ports.js";

type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function createPostgresLoginThrottle(sql: SqlExecutor, options?: { now?: () => Date }): LoginThrottle {
  const clock = options?.now ?? (() => new Date());

  const throttle: LoginThrottle = {
    async record(identifierHash, outcome) {
      await sql.query(
        `INSERT INTO login_attempt (identifier_hash, outcome, occurred_at)
         VALUES ($1, $2, $3)`,
        [identifierHash, outcome, clock()]
      );
    },

    async failures(identifierHash, now) {
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
      return Number(rows[0]?.failures ?? 0);
    },
    async state(identifierHash, now) {
      return (await throttle.failures(identifierHash, now)) >= LOGIN_LOCKOUT_THRESHOLD ? "locked" : "open";
    },
    async hasSucceeded(identifierHash) {
      const { rows } = await sql.query(
        `SELECT 1 FROM login_attempt WHERE identifier_hash = $1 AND outcome = 'succeeded' LIMIT 1`,
        [identifierHash]
      );
      return rows.length > 0;
    }
  };
  return throttle;
}
