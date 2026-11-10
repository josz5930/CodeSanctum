type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type IdentityPruneResult = { login_attempts: number; web_sessions: number };

/**
 * Removes login attempts and expired sessions that are more than 30 days old.
 * The database function owns the rule (infra/migrations/0009): the application
 * role has no DELETE grant on these tables and cannot choose the rows.
 */
export async function pruneIdentityRecords(sql: SqlExecutor): Promise<IdentityPruneResult> {
  const { rows } = await sql.query("SELECT login_attempts, web_sessions FROM prune_identity_records()");
  return {
    login_attempts: Number(rows[0]?.login_attempts ?? 0),
    web_sessions: Number(rows[0]?.web_sessions ?? 0)
  };
}
