import {
  SESSION_IDLE_TIMEOUT_MS,
  type IssueSessionInput,
  type ResolvedSession,
  type RevocationReason,
  type SessionStore
} from "../ports.js";

const ACTIVITY_DEBOUNCE_MS = 60 * 1000;

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, IssueSessionInput>();
  const revocations = new Map<string, RevocationReason>();
  const lastActivity = new Map<string, Date>();

  return {
    async issue(input: IssueSessionInput) {
      sessions.set(input.session_handle, input);
      return { outcome: "issued" as const };
    },

    async resolve(handle: string, now: Date): Promise<ResolvedSession | undefined> {
      const row = sessions.get(handle);
      if (row === undefined) {
        return undefined;
      }
      if (!(now < row.absolute_expires_at)) {
        return undefined;
      }
      if (revocations.has(handle)) {
        return undefined;
      }
      const activity = lastActivity.get(handle);
      const last =
        activity !== undefined && activity.getTime() > row.issued_at.getTime() ? activity : row.issued_at;
      if (!(now.getTime() - last.getTime() < SESSION_IDLE_TIMEOUT_MS)) {
        return undefined;
      }
      return {
        session_handle: row.session_handle,
        account_id: row.account_id,
        second_factor_state: row.second_factor_state
      };
    },

    async touch(handle: string, now: Date) {
      const newest = lastActivity.get(handle);
      if (newest !== undefined && newest.getTime() > now.getTime() - ACTIVITY_DEBOUNCE_MS) {
        return;
      }
      lastActivity.set(handle, now);
    },

    async revoke(handle: string, reason: RevocationReason) {
      if (!revocations.has(handle)) {
        revocations.set(handle, reason);
      }
    },

    async revokeAllForAccount(accountId: string, reason: RevocationReason) {
      for (const row of sessions.values()) {
        if (row.account_id === accountId && !revocations.has(row.session_handle)) {
          revocations.set(row.session_handle, reason);
        }
      }
    }
  };
}
