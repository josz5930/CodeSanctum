import { RiskWarning as buildRiskWarning } from "../../../../packages/ui/src/index.js";
import { RiskWarning } from "../../components/RiskWarning.js";

/**
 * Rendered when the host answers a `web` fetch with C's 401 (missing, expired,
 * or pending-2FA session). The RiskWarning contract is built here — this state
 * has no host round-trip to project it — and paired with a link back to login
 * (E-7). `failed_verification` is the neutral default `@onevps/ui` itself uses
 * for a warning with no domain-specific risk type.
 */
export function SessionExpiredPage() {
  const view = buildRiskWarning({
    title: "Session expired",
    message: "Sign in again to continue.",
    riskType: "failed_verification",
    audience: "customer"
  });
  return (
    <main className="min-h-screen bg-surface-base text-ink-primary">
      <RiskWarning view={view} />
      <a href="/login">Sign in</a>
    </main>
  );
}

export default SessionExpiredPage;
