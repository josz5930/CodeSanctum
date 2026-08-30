export type BudgetTier = {
  tier: "normal" | "warning_50" | "warning_75" | "warning_90";
  warn: boolean;
  slowdown_ms: 0 | 1000 | 2000 | 3000;
};

/**
 * Maps the demo spend ratio onto F's staged warning tiers. The slowdowns are
 * deliberately small and deterministic: they provide back-pressure and an
 * operator-visible signal without becoming a general-purpose rate limiter.
 */
export function budgetTierFor(ratio: number): BudgetTier {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new RangeError("budget ratio must be a non-negative finite number");
  }
  if (ratio >= 0.9) {
    return { tier: "warning_90", warn: true, slowdown_ms: 3000 };
  }
  if (ratio >= 0.75) {
    return { tier: "warning_75", warn: true, slowdown_ms: 2000 };
  }
  if (ratio >= 0.5) {
    return { tier: "warning_50", warn: true, slowdown_ms: 1000 };
  }
  return { tier: "normal", warn: false, slowdown_ms: 0 };
}
