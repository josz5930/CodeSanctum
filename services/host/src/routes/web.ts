import type { FastifyInstance, FastifyRequest } from "fastify";

import { selectGrant, type AuthenticatedActor, type EvidenceAccessRole } from "../../../../packages/identity-store/src/index.js";
import type { ReviewEvent } from "../../../../packages/protocol-ts/src/index.js";
import { requireEvidenceAccess, type ArtifactScope } from "../auth/require-evidence-access.js";
import type { ErrorEnvelopeBody } from "../error-envelope.js";
import { projectContext } from "../web/project-context.js";
import { projectReviewList } from "../web/project-review-list.js";
import { projectReviewDetail } from "../web/project-review-detail.js";
import { projectFindingRecords } from "../web/project-finding-record.js";
import { projectVerificationScope } from "../web/project-verification-scope.js";
import { projectAttestation } from "../web/project-attestation.js";

export type WebRouteDeps = {
  errorEnvelope: (reasonCode: string) => ErrorEnvelopeBody;
};

function uniqueGrantedReviewIds(actor: AuthenticatedActor): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const grant of actor.grants) {
    if (grant.review_scope === null || seen.has(grant.review_scope)) {
      continue;
    }
    seen.add(grant.review_scope);
    ids.push(grant.review_scope);
  }
  return ids;
}

/**
 * Listing is not a stored-artifact read. `artifact_ref` is derived from the
 * grant's review id so access logging stays scoped without a catalog.
 * Pattern: `^artifact_ref:[a-z0-9][a-z0-9_-]{2,63}$`.
 */
function artifactScopeForReviewList(actor: AuthenticatedActor, reviewId: string): ArtifactScope {
  const slug = reviewId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 64);
  return {
    artifact_ref: `artifact_ref:${slug}`,
    tenant_id: actor.tenant_id,
    review_scope: reviewId,
    source_derived_class: "retained_review_artifact"
  };
}

type ScopeGate = { ok: true; role: EvidenceAccessRole } | { ok: false; status: 401 | 403 };

/**
 * The single scoped-and-logged access gate every review-scoped `web` route
 * shares: it runs C's `requireEvidenceAccess`, persists the one
 * `evidence_accessed` event, and returns the grant's role for audience gating.
 * A denial maps to 401 (unauthenticated) or 403 (out of scope).
 */
async function gateReviewScope(
  request: FastifyRequest,
  actor: AuthenticatedActor,
  reviewScope: string,
  idempotencyScope: "review_detail" | "review_findings" | "review_attestation"
): Promise<ScopeGate> {
  const access = await requireEvidenceAccess(request, {
    artifact: artifactScopeForReviewList(actor, reviewScope),
    purpose: "customer_review_read",
    idempotencyScope
  });
  if ("denied" in access) {
    return { ok: false, status: access.denied === "unauthenticated" ? 401 : 403 };
  }
  const persisted = await request.server.ports.evidenceLifecycleLog.append(reviewScope, access.event);
  if (persisted.outcome === "rejected") {
    return { ok: false, status: 403 };
  }
  const grant = selectGrant(actor, reviewScope);
  if (grant === undefined) {
    return { ok: false, status: 403 };
  }
  return { ok: true, role: grant.role };
}

export async function registerWebRoutes(server: FastifyInstance, deps: WebRouteDeps): Promise<void> {
  server.get("/web/context", async (request, reply) => {
    if (request.actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    return reply.code(200).send(projectContext(request.actor));
  });

  server.get("/web/reviews", async (request, reply) => {
    if (request.actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    const actor = request.actor;
    const allowedLogs: ReviewEvent[][] = [];
    for (const reviewId of uniqueGrantedReviewIds(actor)) {
      const access = await requireEvidenceAccess(request, {
        artifact: artifactScopeForReviewList(actor, reviewId),
        purpose: "customer_review_read",
        idempotencyScope: "review_list"
      });
      if ("denied" in access) {
        continue;
      }
      const persisted = await request.server.ports.evidenceLifecycleLog.append(reviewId, access.event);
      if (persisted.outcome === "rejected") {
        continue;
      }
      allowedLogs.push(await request.server.ports.reviewEventLog.loadLog(reviewId));
    }
    return reply.code(200).send(projectReviewList(actor, allowedLogs));
  });

  server.get<{ Params: { reviewScope: string } }>("/web/reviews/:reviewScope", async (request, reply) => {
    if (request.actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    const actor = request.actor;
    const reviewScope = request.params.reviewScope;
    const gate = await gateReviewScope(request, actor, reviewScope, "review_detail");
    if (!gate.ok) {
      return reply.code(gate.status).send(deps.errorEnvelope(gate.status === 401 ? "auth_credentials_invalid" : "evidence_access_denied"));
    }
    const events = await request.server.ports.reviewEventLog.loadLog(reviewScope);
    const records = await request.server.ports.records.get(reviewScope);
    return reply.code(200).send(projectReviewDetail({ actor, role: gate.role, reviewScope, events, records }));
  });

  server.get<{ Params: { reviewScope: string } }>("/web/reviews/:reviewScope/findings", async (request, reply) => {
    if (request.actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    const actor = request.actor;
    const reviewScope = request.params.reviewScope;
    const gate = await gateReviewScope(request, actor, reviewScope, "review_findings");
    if (!gate.ok) {
      return reply.code(gate.status).send(deps.errorEnvelope(gate.status === 401 ? "auth_credentials_invalid" : "evidence_access_denied"));
    }
    const records = await request.server.ports.records.get(reviewScope);
    return reply.code(200).send({
      shell: projectContext(actor),
      reviewScope,
      findings: projectFindingRecords({ role: gate.role, records }),
      verificationScope: projectVerificationScope({ role: gate.role, records })
    });
  });

  server.get<{ Params: { reviewScope: string } }>("/web/reviews/:reviewScope/attestation", async (request, reply) => {
    if (request.actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    const actor = request.actor;
    const reviewScope = request.params.reviewScope;
    const gate = await gateReviewScope(request, actor, reviewScope, "review_attestation");
    if (!gate.ok) {
      return reply.code(gate.status).send(deps.errorEnvelope(gate.status === 401 ? "auth_credentials_invalid" : "evidence_access_denied"));
    }
    const records = await request.server.ports.records.get(reviewScope);
    return reply.code(200).send(projectAttestation({ actor, role: gate.role, reviewScope, records }));
  });
}
