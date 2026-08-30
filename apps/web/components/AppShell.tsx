import type { ReactNode } from "react";
import type { AppShellView } from "../../../packages/ui/src/index.js";
import { StatusPill } from "./StatusPill.js";
import { actionableAttributes } from "./a11y.js";

/**
 * Signed-in chrome for an AppShell contract. Renders the navigation label, the
 * resolved actor context, the review-state pill, and the sign-out control that
 * posts to C's revocation route via `/logout`.
 */
export function AppShell({ view, children }: { view: AppShellView; children?: ReactNode }) {
  return (
    <div data-slot={view.dataSlot} className="min-h-screen bg-surface-base text-ink-primary font-product">
      <header>
        <nav aria-label={view.navigationLabel} className="flex items-center gap-4">
          <span data-slot="navigation-label">{view.navigationLabel}</span>
          {view.actorContext === undefined ? null : (
            <span data-slot="actor-context">
              {view.actorContext.label}
              {view.actorContext.id === undefined ? null : ` (${view.actorContext.id})`}
            </span>
          )}
          <StatusPill view={view.reviewState} />
          <form method="post" action="/logout">
            <button type="submit" {...actionableAttributes({ minTargetSizePx: view.minTargetSizePx })}>
              Sign out
            </button>
          </form>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
