import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ArtifactStore, StoredObjectClassificationStore } from "../../../../packages/evidence-store/src/index.js";
import { selectGrant, type AuthenticatedActor } from "../../../../packages/identity-store/src/index.js";
import type { ReviewFindingDraftSet } from "../../../../packages/protocol-ts/src/index.js";
import { ReviewerClassificationWorkbench } from "../../../../packages/ui/src/index.js";
import { requireEvidenceAccess } from "../auth/require-evidence-access.js";
import type { ErrorEnvelopeBody } from "../error-envelope.js";
import type { FindingClassificationRecordStore } from "../reviewer/classification-store.js";
import {
  buildClassificationEvent,
  buildClassificationRecord,
  currentClassifications,
  draftKey,
  parseDraftSet,
  workbenchDraftInput,
  type ClassificationInput
} from "../reviewer/workbench.js";
import { projectContext } from "../web/project-context.js";
import { ownerTenantFor } from "../web/review-ownership.js";
import type { NormalizationOutcomeStore } from "../worker/normalization-records.js";

export type ReviewerRouteDeps = {
  outcomes: NormalizationOutcomeStore;
  /** The host's artifact store, with the envelope key: draft sets are encrypted objects. */
  artifacts: ArtifactStore;
  objectClassifications: StoredObjectClassificationStore;
  classifications: FindingClassificationRecordStore;
  errorEnvelope: (reasonCode: string) => ErrorEnvelopeBody;
};

type ReviewerGate =
  | { ok: true; actor: AuthenticatedActor; ownerTenant: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * The reviewer surface reads scanner-derived draft sets and records expert
 * judgment, so it asks for more than the customer routes: a reviewer grant
 * for this review (a review-scoped customer grant wins over a tenant-wide
 * reviewer grant, as everywhere), a session confirmed with TOTP, and a review
 * that belongs to the reviewer's tenant. Nothing is read or logged before
 * every check passes.
 */
async function gateReviewer(request: FastifyRequest, reviewScope: string): Promise<ReviewerGate> {
  const actor = request.actor;
  if (actor === undefined) {
    return { ok: false, status: 401, reason: "auth_credentials_invalid" };
  }
  if (selectGrant(actor, reviewScope)?.role !== "codeattest_reviewer") {
    return { ok: false, status: 403, reason: "evidence_access_denied" };
  }
  if (!request.secondFactorSatisfied) {
    return { ok: false, status: 403, reason: "second_factor_required" };
  }
  const ownerTenant = ownerTenantFor(await request.server.ports.reviewOwnership(reviewScope), actor.tenant_id);
  if (ownerTenant === undefined || ownerTenant !== actor.tenant_id) {
    return { ok: false, status: 403, reason: "evidence_access_denied" };
  }
  return { ok: true, actor, ownerTenant };
}

type DraftSetRead =
  | { ok: true; draftSet: ReviewFindingDraftSet }
  | { ok: false; reason: "evidence_access_denied" | "evidence_unavailable" | "draft_set_review_mismatch" };

/**
 * Reads one normalized draft set through the scoped-access boundary. The
 * artifact store persists the `evidence_accessed` event in the same step that
 * returns the bytes, so every read leaves exactly one receipt.
 */
async function readDraftSet(request: FastifyRequest, deps: ReviewerRouteDeps, ownerTenant: string, reviewScope: string, digest: string): Promise<DraftSetRead> {
  const hex = digest.replace(/^sha256:/, "");
  const stored = await deps.objectClassifications.find(`stored_object:${hex}`);
  if (stored === undefined) {
    return { ok: false, reason: "evidence_unavailable" };
  }
  const access = await requireEvidenceAccess(request, {
    artifact: {
      artifact_ref: `artifact_ref:draft_set_${hex.slice(0, 40)}`,
      tenant_id: ownerTenant,
      review_scope: reviewScope,
      source_derived_class: stored.source_derived_class
    },
    purpose: "reviewer_classification",
    idempotencyScope: "reviewer_draft_set"
  });
  if ("denied" in access) {
    return { ok: false, reason: "evidence_access_denied" };
  }
  const read = await deps.artifacts.get({ access, digest });
  if (read.outcome !== "read") {
    return { ok: false, reason: read.outcome === "access_not_logged" ? "evidence_access_denied" : "evidence_unavailable" };
  }
  return parseDraftSet(read.bytes, reviewScope);
}

function deny(reply: FastifyReply, deps: ReviewerRouteDeps, gate: { status: number; reason: string }) {
  return reply.code(gate.status).send(deps.errorEnvelope(gate.reason));
}

const CLASSIFICATIONS = new Set(["likely", "confirmed", "inconclusive", "requires_customer_side_validation"]);
const VISIBILITIES = new Set(["internal_only", "customer_facing"]);
const BODY_KEYS = new Set([
  "draft_set_digest",
  "review_finding_draft_ref",
  "classification",
  "rationale",
  "confirmation_criteria",
  "defensible_confirmation_criteria",
  "threshold_gaps",
  "limitations",
  "validation_path_summary",
  "visibility"
]);
const MAX_TEXT = 4000;
const MAX_LIST = 20;

function isText(value: unknown, required: boolean): boolean {
  return value === undefined ? !required : typeof value === "string" && value.length <= MAX_TEXT && (!required || value.trim().length > 0);
}

function isTextList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= MAX_LIST && value.every((item) => isText(item, false)));
}

/**
 * Accepts only the fields a reviewer may choose. An unknown field is refused
 * rather than dropped, so a client that sends `evidence_basis` or an actor
 * learns that the server never takes them from a request.
 */
function parseClassifyBody(value: unknown): ClassifyBody | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !BODY_KEYS.has(key))) {
    return undefined;
  }
  const valid =
    typeof body.draft_set_digest === "string" && /^sha256:[a-f0-9]{64}$/.test(body.draft_set_digest) &&
    typeof body.review_finding_draft_ref === "string" && /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/.test(body.review_finding_draft_ref) &&
    typeof body.classification === "string" && CLASSIFICATIONS.has(body.classification) &&
    isText(body.rationale, true) &&
    isTextList(body.confirmation_criteria) && isTextList(body.threshold_gaps) && isTextList(body.limitations) &&
    isText(body.defensible_confirmation_criteria, false) && isText(body.validation_path_summary, false) &&
    (body.visibility === undefined || (typeof body.visibility === "string" && VISIBILITIES.has(body.visibility)));
  return valid ? (body as ClassifyBody) : undefined;
}

type ClassifyBody = ClassificationInput & { draft_set_digest: string; review_finding_draft_ref: string };

export async function registerReviewerRoutes(server: FastifyInstance, deps: ReviewerRouteDeps): Promise<void> {
  // The reviewer's work queue: the reviews of the reviewer's own tenant that
  // have normalized submissions. It reads ids and counts only, never a draft
  // set, and lists a review only when the per-review gate would admit it.
  server.get("/web/reviewer/queue", async (request, reply) => {
    const actor = request.actor;
    if (actor === undefined) {
      return reply.code(401).send(deps.errorEnvelope("auth_credentials_invalid"));
    }
    if (!actor.grants.some((grant) => grant.role === "codeattest_reviewer")) {
      return reply.code(403).send(deps.errorEnvelope("evidence_access_denied"));
    }
    if (!request.secondFactorSatisfied) {
      return reply.code(403).send(deps.errorEnvelope("second_factor_required"));
    }
    const reviews = [];
    for (const summary of await deps.outcomes.listReviewsForTenant(actor.tenant_id)) {
      const ownership = await request.server.ports.reviewOwnership(summary.review_id);
      if (ownership.kind !== "owned" || ownership.tenant_id !== actor.tenant_id) {
        continue;
      }
      if (selectGrant(actor, summary.review_id)?.role !== "codeattest_reviewer") {
        continue;
      }
      reviews.push({ reviewScope: summary.review_id, normalized: summary.normalized, rejected: summary.rejected });
    }
    return reply.code(200).send({ shell: projectContext(actor), reviews });
  });

  server.get<{ Params: { reviewScope: string } }>("/web/reviewer/reviews/:reviewScope/drafts", async (request, reply) => {
    const reviewScope = request.params.reviewScope;
    const gate = await gateReviewer(request, reviewScope);
    if (!gate.ok) {
      return deny(reply, deps, gate);
    }
    const outcomes = await deps.outcomes.listForReview(reviewScope);
    const current = currentClassifications(
      await request.server.ports.reviewEventLog.loadLog(reviewScope),
      await deps.classifications.listForReview(reviewScope)
    );
    const draftSets = [];
    for (const outcome of outcomes) {
      if (outcome.outcome !== "normalized") {
        continue;
      }
      const read = await readDraftSet(request, deps, gate.ownerTenant, reviewScope, outcome.draft_set_digest);
      if (!read.ok) {
        draftSets.push({ submissionAttemptId: outcome.submission_attempt_id, draftSetDigest: outcome.draft_set_digest, available: false, reason: read.reason, drafts: [] });
        continue;
      }
      const { draftSet } = read;
      draftSets.push({
        submissionAttemptId: outcome.submission_attempt_id,
        draftSetDigest: outcome.draft_set_digest,
        available: true,
        normalizationStatus: draftSet.normalization_status,
        coverageMode: draftSet.coverage_mode,
        ...(draftSet.no_findings_statement === undefined ? {} : { noFindingsStatement: draftSet.no_findings_statement }),
        limitations: draftSet.normalization_limitations,
        drafts: draftSet.review_finding_drafts.map((draft) => {
          const inForce = current.get(draftKey(outcome.draft_set_digest, draft.review_finding_draft_id));
          return {
            draftRef: draft.review_finding_draft_id,
            workbench: ReviewerClassificationWorkbench({
              draft: workbenchDraftInput(draftSet, draft),
              ...(inForce === undefined ? {} : { currentClassification: inForce.record })
            }),
            current: inForce === undefined
              ? null
              : { recordRef: inForce.record.classification_record_id, classification: inForce.record.classification, visibility: inForce.record.visibility, classifiedAt: inForce.record.classified_at },
            defaults: { thresholdGaps: draft.threshold_gaps, limitations: draftSet.normalization_limitations }
          };
        })
      });
    }
    return reply.code(200).send({
      shell: projectContext(gate.actor),
      reviewScope,
      draftSets,
      rejectedNormalizations: outcomes
        .filter((outcome) => outcome.outcome === "rejected")
        .map((outcome) => ({ submissionAttemptId: outcome.submission_attempt_id, reason: outcome.outcome === "rejected" ? outcome.rejection_reason : "" }))
    });
  });

  server.post<{ Params: { reviewScope: string } }>(
    "/web/reviewer/reviews/:reviewScope/classifications",
    async (request, reply) => {
      const reviewScope = request.params.reviewScope;
      const gate = await gateReviewer(request, reviewScope);
      if (!gate.ok) {
        return deny(reply, deps, gate);
      }
      const body = parseClassifyBody(request.body);
      if (body === undefined) {
        return reply.code(400).send(deps.errorEnvelope("classification_request_invalid"));
      }
      const normalized = (await deps.outcomes.listForReview(reviewScope))
        .some((outcome) => outcome.outcome === "normalized" && outcome.draft_set_digest === body.draft_set_digest);
      if (!normalized) {
        return reply.code(404).send(deps.errorEnvelope("classification_draft_not_found"));
      }
      const read = await readDraftSet(request, deps, gate.ownerTenant, reviewScope, body.draft_set_digest);
      if (!read.ok) {
        const status = read.reason === "evidence_access_denied" ? 403 : read.reason === "draft_set_review_mismatch" ? 422 : 503;
        return reply.code(status).send(deps.errorEnvelope(read.reason));
      }
      const draft = read.draftSet.review_finding_drafts.find((candidate) => candidate.review_finding_draft_id === body.review_finding_draft_ref);
      if (draft === undefined) {
        return reply.code(404).send(deps.errorEnvelope("classification_draft_not_found"));
      }

      const events = await request.server.ports.reviewEventLog.loadLog(reviewScope);
      const current = currentClassifications(events, await deps.classifications.listForReview(reviewScope));
      const supersedes = current.get(draftKey(body.draft_set_digest, draft.review_finding_draft_id));
      const record = buildClassificationRecord({
        reviewId: reviewScope,
        draftSet: read.draftSet,
        draft,
        reviewerActorId: gate.actor.actor.actor_id,
        classifiedAt: request.server.now(),
        choice: body,
        ...(supersedes === undefined ? {} : { supersedes })
      });
      const built = await buildClassificationEvent(record, events);
      if (built.outcome === "rejected") {
        // A rule on the judgment itself (criteria, wording, evidence binding)
        // is the reviewer's to fix; anything else means the log moved on.
        return built.reason.startsWith("finding_classification_")
          ? reply.code(422).send(deps.errorEnvelope(built.reason))
          : reply.code(409).send(deps.errorEnvelope("classification_conflict"));
      }
      // The record is stored first: until its event lands it is never
      // current, so a lost race leaves an unreferenced record, not a claim.
      await deps.classifications.record({ record, draft_set_digest: body.draft_set_digest });
      const persisted = await request.server.ports.reviewEventLog.append(reviewScope, built.event);
      if (persisted.outcome === "rejected") {
        return reply.code(409).send(deps.errorEnvelope("classification_conflict"));
      }
      return reply.code(201).send({
        classification_record_id: record.classification_record_id,
        event_id: built.event.event_id,
        ...(record.supersedes_classification_record_ref === undefined ? {} : { supersedes_classification_record_ref: record.supersedes_classification_record_ref })
      });
    }
  );
}
