import type { AuthenticatedActor } from "../../../../packages/identity-store/src/index.js";
import { AppShell, type AppShellView } from "../../../../packages/ui/src/index.js";

/**
 * Signed-in shell only. Review knowledge is not on the actor, so AppShell
 * keeps `reviewState` as unknown rather than inventing `not_submitted`.
 */
export function projectContext(actor: AuthenticatedActor): AppShellView {
  const grant = actor.grants[0];
  return AppShell({
    actorContext: {
      label: grant === undefined ? actor.actor.actor_type : grant.role,
      id: actor.actor.actor_id
    }
  });
}
