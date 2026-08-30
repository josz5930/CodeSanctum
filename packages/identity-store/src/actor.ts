import type { RoleGrant } from "./ports.js";

export type EvidenceAccessRole =
  | "customer_admin"
  | "customer_viewer"
  | "codeattest_reviewer"
  | "codeattest_ops"
  | "evidence_consumer_static";

export type AuthenticatedActor = {
  account_id: string;
  tenant_id: string;
  actor: {
    actor_type: "customer_user" | "reviewer" | "vendor_service" | "local_runner";
    actor_id: string;
  };
  grants: readonly RoleGrant[];
};

/** MVP roles from the control-plane; copied so the sets cannot drift. */
export const EVIDENCE_ACCESS_ROLES: ReadonlySet<EvidenceAccessRole> = new Set([
  "customer_admin",
  "customer_viewer",
  "codeattest_reviewer",
  "codeattest_ops",
  "evidence_consumer_static"
]);

// A Map, not an object literal: an object literal answers `constructor` from
// Object.prototype (see apps/control-plane/src/index.ts:755).
const ROLE_TO_ACTOR_TYPE: ReadonlyMap<EvidenceAccessRole, AuthenticatedActor["actor"]["actor_type"]> = new Map([
  ["customer_admin", "customer_user"],
  ["customer_viewer", "customer_user"],
  ["codeattest_reviewer", "reviewer"],
  ["codeattest_ops", "vendor_service"],
  ["evidence_consumer_static", "vendor_service"]
]);

export function actorTypeForRole(role: EvidenceAccessRole): AuthenticatedActor["actor"]["actor_type"] {
  const actorType = ROLE_TO_ACTOR_TYPE.get(role);
  if (actorType === undefined) {
    throw new Error(`unknown role: ${String(role)}`);
  }
  return actorType;
}

/**
 * Prefer a review-scoped grant over a tenant-wide one when both apply.
 * Tenant-wide (`review_scope === null`) covers any review; no match → undefined.
 */
export function selectGrant(actor: AuthenticatedActor, reviewScope: string): RoleGrant | undefined {
  let tenantWide: RoleGrant | undefined;
  for (const grant of actor.grants) {
    if (grant.review_scope === reviewScope) {
      return grant;
    }
    if (grant.review_scope === null && tenantWide === undefined) {
      tenantWide = grant;
    }
  }
  return tenantWide;
}
