import { LOGIN_LOCKOUT_THRESHOLD, LOGIN_LOCKOUT_WINDOW_MS, type LoginThrottle } from "../ports.js";

type Attempt = { outcome: "succeeded" | "failed"; occurred_at: Date };

export function createMemoryLoginThrottle(options?: { now?: () => Date }): LoginThrottle {
  const clock = options?.now ?? (() => new Date());
  const attempts = new Map<string, Attempt[]>();

  return {
    async record(identifierHash: string, outcome: "succeeded" | "failed") {
      const list = attempts.get(identifierHash) ?? [];
      list.push({ outcome, occurred_at: clock() });
      attempts.set(identifierHash, list);
    },

    async state(identifierHash: string, now: Date) {
      const list = attempts.get(identifierHash) ?? [];
      let lastSuccessMs: number | undefined;
      for (const attempt of list) {
        if (attempt.outcome === "succeeded") {
          const ms = attempt.occurred_at.getTime();
          if (lastSuccessMs === undefined || ms > lastSuccessMs) {
            lastSuccessMs = ms;
          }
        }
      }
      const windowStart = now.getTime() - LOGIN_LOCKOUT_WINDOW_MS;
      const cutoff = lastSuccessMs === undefined ? windowStart : Math.max(windowStart, lastSuccessMs);
      let failures = 0;
      for (const attempt of list) {
        if (attempt.outcome === "failed" && attempt.occurred_at.getTime() > cutoff) {
          failures += 1;
        }
      }
      return failures >= LOGIN_LOCKOUT_THRESHOLD ? "locked" : "open";
    }
  };
}
