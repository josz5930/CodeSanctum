import type { AccountRecord, AccountStore, RoleGrant } from "../ports.js";

export type IdentitySeed = {
  tenant: { tenant_id: string; display_name: string };
  account: {
    account_id: string;
    tenant_id: string;
    identifier: string;
    secret_hash: string;
    totp_secret_box?: string | null;
  };
  grants: readonly RoleGrant[];
};

export type MemoryAccountStore = AccountStore & {
  seed(input: IdentitySeed): Promise<void>;
};

export function createMemoryAccountStore(): MemoryAccountStore {
  const byId = new Map<string, AccountRecord>();
  const byIdentifier = new Map<string, AccountRecord>();
  const grantsByAccount = new Map<string, RoleGrant[]>();

  return {
    async findByIdentifier(identifier: string) {
      return byIdentifier.get(identifier);
    },
    async findById(accountId: string) {
      return byId.get(accountId);
    },
    async grantsFor(accountId: string) {
      return grantsByAccount.get(accountId) ?? [];
    },
    async seed(input: IdentitySeed) {
      const record: AccountRecord = {
        account_id: input.account.account_id,
        tenant_id: input.account.tenant_id,
        identifier: input.account.identifier,
        secret_hash: input.account.secret_hash,
        totp_secret_box: input.account.totp_secret_box ?? null
      };
      byId.set(record.account_id, record);
      byIdentifier.set(record.identifier, record);
      grantsByAccount.set(
        record.account_id,
        input.grants.map((grant) => ({ ...grant }))
      );
    }
  };
}
