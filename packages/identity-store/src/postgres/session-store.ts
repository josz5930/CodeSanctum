import { SESSION_IDLE_TIMEOUT_MS, type SessionStore } from "../ports.js";

type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export function createPostgresSessionStore(sql: SqlExecutor): SessionStore {
  return {
    async issue(input) {
      await sql.query(
        `INSERT INTO web_session (
           session_handle, account_id, issued_at, absolute_expires_at, second_factor_state
         ) VALUES ($1, $2, $3, $4, $5)`,
        [input.session_handle, input.account_id, input.issued_at, input.absolute_expires_at, input.second_factor_state]
      );
      return { outcome: "issued" as const };
    },

    async resolve(handle, now) {
      const idleCutoff = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
      const { rows } = await sql.query(
        `SELECT s.session_handle, s.account_id, s.second_factor_state
           FROM web_session s
           LEFT JOIN web_session_revocation r ON r.session_handle = s.session_handle
          WHERE s.session_handle = $1
            AND r.session_handle IS NULL
            AND s.absolute_expires_at > $2
            AND GREATEST(
                  s.issued_at,
                  COALESCE((SELECT max(a.occurred_at) FROM web_session_activity a
                             WHERE a.session_handle = s.session_handle), s.issued_at)
                ) > $3`,
        [handle, now, idleCutoff]
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      return {
        session_handle: row.session_handle as string,
        account_id: row.account_id as string,
        second_factor_state: row.second_factor_state as "not_required" | "pending" | "satisfied"
      };
    },

    async touch(handle, now) {
      await sql.query(
        `INSERT INTO web_session_activity (session_handle, occurred_at)
         SELECT $1, $2
          WHERE NOT EXISTS (
            SELECT 1 FROM web_session_activity
             WHERE session_handle = $1 AND occurred_at > $2::timestamptz - interval '60 seconds'
          )`,
        [handle, now]
      );
    },

    async revoke(handle, reason) {
      // Gate on the parent row: web_session_revocation.session_handle FKs to
      // web_session, so a VALUES insert of an unknown handle is SQLSTATE 23503.
      // Logout presents whatever cookie the browser has; missing parent is a no-op.
      await sql.query(
        `INSERT INTO web_session_revocation (session_handle, reason)
         SELECT s.session_handle, $2
           FROM web_session s
          WHERE s.session_handle = $1
         ON CONFLICT (session_handle) DO NOTHING`,
        [handle, reason]
      );
    },

    async revokeAllForAccount(accountId, reason) {
      await sql.query(
        `INSERT INTO web_session_revocation (session_handle, reason)
         SELECT s.session_handle, $2
           FROM web_session s
          WHERE s.account_id = $1
         ON CONFLICT (session_handle) DO NOTHING`,
        [accountId, reason]
      );
    }
  };
}
