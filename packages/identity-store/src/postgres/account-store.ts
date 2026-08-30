import type { AccountRecord, AccountStore, RoleGrant } from "../ports.js";

type SqlExecutor = {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

function asAccount(row: Record<string, unknown>): AccountRecord {
  return {
    account_id: row.account_id as string,
    tenant_id: row.tenant_id as string,
    identifier: row.identifier as string,
    secret_hash: row.secret_hash as string,
    totp_secret_box: (row.totp_secret_box as string | null) ?? null
  };
}

export function createPostgresAccountStore(sql: SqlExecutor): AccountStore {
  return {
    async findByIdentifier(identifier: string) {
      const { rows } = await sql.query(
        `SELECT account_id, tenant_id, identifier, secret_hash, totp_secret_box
           FROM account
          WHERE identifier = $1`,
        [identifier]
      );
      const row = rows[0];
      return row === undefined ? undefined : asAccount(row);
    },

    async findById(accountId: string) {
      const { rows } = await sql.query(
        `SELECT account_id, tenant_id, identifier, secret_hash, totp_secret_box
           FROM account
          WHERE account_id = $1`,
        [accountId]
      );
      const row = rows[0];
      return row === undefined ? undefined : asAccount(row);
    },

    async grantsFor(accountId: string) {
      const { rows } = await sql.query(
        `SELECT account_id, role, review_scope
           FROM account_role_grant
          WHERE account_id = $1`,
        [accountId]
      );
      return rows.map((row) => ({
        account_id: row.account_id as string,
        role: row.role as RoleGrant["role"],
        review_scope: (row.review_scope as string | null) ?? null
      }));
    }
  };
}
