import type { FastifyInstance } from "fastify";

import type { EvidenceLifecycleLogStore, ReviewEventLogStore } from "../../../../packages/evidence-store/src/index.js";
import type { ReviewRecordStore } from "../web/record-store.js";
import {
  actorTypeForRole,
  sessionHandleFor,
  type AccountStore,
  type AuthenticatedActor,
  type SessionStore
} from "../../../../packages/identity-store/src/index.js";
import { readSessionCookie } from "./cookie.js";

export type ActorResolutionDeps = {
  accounts: AccountStore;
  sessions: SessionStore;
  sessionCookieSecure: boolean;
  now?: () => Date;
};

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthenticatedActor | undefined;
  }
  interface FastifyInstance {
    ports: {
      evidenceLifecycleLog: EvidenceLifecycleLogStore;
      reviewEventLog: ReviewEventLogStore;
      records: ReviewRecordStore;
    };
    now: () => string;
  }
}

function clock(deps: ActorResolutionDeps): Date {
  return deps.now === undefined ? new Date() : deps.now();
}

function actorFor(
  accountId: string,
  tenantId: string,
  grants: AuthenticatedActor["grants"]
): AuthenticatedActor {
  const first = grants[0];
  return {
    account_id: accountId,
    tenant_id: tenantId,
    actor: {
      actor_type: first === undefined ? "customer_user" : actorTypeForRole(first.role),
      actor_id: accountId
    },
    grants
  };
}

/**
 * Missing or pending sessions leave `request.actor` undefined; the route
 * decides whether anonymity is acceptable.
 */
export function registerActorResolution(server: FastifyInstance, deps: ActorResolutionDeps): void {
  server.decorateRequest("actor", undefined);
  server.addHook("preHandler", async (request) => {
    request.actor = undefined;
    const header = request.headers.cookie;
    const token = readSessionCookie(typeof header === "string" ? header : undefined, deps.sessionCookieSecure);
    if (token === undefined) {
      return;
    }
    const now = clock(deps);
    const session = await deps.sessions.resolve(sessionHandleFor(token), now);
    if (session === undefined || session.second_factor_state === "pending") {
      return;
    }
    const account = await deps.accounts.findById(session.account_id);
    if (account === undefined) {
      return;
    }
    const grants = await deps.accounts.grantsFor(account.account_id);
    request.actor = actorFor(account.account_id, account.tenant_id, grants);
    await deps.sessions.touch(session.session_handle, now);
  });
}
