import { createHash } from "node:crypto";

import type { FastifyRequest } from "fastify";

import {
  enforceScopedAccess,
  type EvidenceAccessDenialReason
} from "../../../../apps/control-plane/src/index.js";
import type { AllowedAccess } from "../../../../packages/evidence-store/src/index.js";
import {
  actorTypeForRole,
  selectGrant,
  type AuthenticatedActor
} from "../../../../packages/identity-store/src/index.js";
import type { RetentionSourceDerivedClass } from "../../../../packages/protocol-ts/src/index.js";

export type ArtifactScope = {
  artifact_ref: string;
  tenant_id: string;
  review_scope: string;
  source_derived_class: RetentionSourceDerivedClass;
};

export type EvidenceAccessDenied = { denied: EvidenceAccessDenialReason | "unauthenticated" };

function evidenceIdempotencyKeyFor(
  actor: AuthenticatedActor,
  input: { artifact: ArtifactScope; idempotencyScope: string }
): string {
  return `evidence_accessed:${actor.account_id}:${input.artifact.artifact_ref}:${input.idempotencyScope}`;
}

function evidenceEventIdFor(
  actor: AuthenticatedActor,
  input: { artifact: ArtifactScope; idempotencyScope: string }
): string {
  return `evidence_event:${createHash("sha256").update(evidenceIdempotencyKeyFor(actor, input)).digest("hex").slice(0, 32)}`;
}

export async function requireEvidenceAccess(
  request: FastifyRequest,
  input: { artifact: ArtifactScope; purpose: string; idempotencyScope: string }
): Promise<AllowedAccess | EvidenceAccessDenied> {
  const actor = request.actor;
  if (actor === undefined) {
    return { denied: "unauthenticated" };
  }
  const grant = selectGrant(actor, input.artifact.review_scope);
  if (grant === undefined) {
    return { denied: "access_denied_out_of_scope" };
  }
  const events = await request.server.ports.evidenceLifecycleLog.loadLog(input.artifact.review_scope);
  const idempotencyKey = evidenceIdempotencyKeyFor(actor, input);
  const recorded = events.find((event) => event.idempotency_key === idempotencyKey);
  // Every scope value below comes from `actor` and `grant`. None of them can
  // come from the request: that is the whole point of this function, and the
  // static scan in routes-do-not-call-enforce-scoped-access.test.mjs is what
  // keeps it that way. actor_type is taken from the selected grant, not from
  // session decoration (`grants[0]`), so a dual-role account logs the role
  // that authorized this access.
  const decision = enforceScopedAccess(events, {
    actor: {
      actor_type: actorTypeForRole(grant.role),
      actor_id: actor.actor.actor_id
    },
    role: grant.role,
    tenant_id: actor.tenant_id,
    review_scope: input.artifact.review_scope,
    artifact: input.artifact,
    event_id: evidenceEventIdFor(actor, input),
    idempotency_key: idempotencyKey,
    // Replays must rebuild the exact body already stored under the idempotency
    // key. A fresh timestamp would turn a harmless repeated GET into a rewrite.
    event_timestamp: recorded?.event_timestamp ?? request.server.now(),
    purpose: input.purpose
  });
  if (decision.decision !== "allowed") {
    return { denied: decision.reason };
  }
  return { decision: "allowed", event: decision.event };
}
