/**
 * F owns the real meter (spec section 5.5: warn at 50/75/90%, disable intake
 * at 95%, shut down at 100%). B needs only the ratio, because
 * `verifyIntakeSubmission` already enforces the 0.95 cut-off itself.
 */
export interface BudgetMeter {
  spendRatio(): Promise<number>;
}

export type BudgetConfig = { demo_budget: { spend_ratio: number } };

export function createConfigBudgetMeter(config: BudgetConfig): BudgetMeter {
  const ratio = config.demo_budget.spend_ratio;
  return {
    async spendRatio(): Promise<number> {
      return ratio;
    }
  };
}
