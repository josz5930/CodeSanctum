import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { importCompiled } from "./helpers/compile.mjs";
import { buildTestServer, loginAs, SEEDED } from "./helpers/identity-fixtures.mjs";

const { registerReviewerRoutes } = await importCompiled("src/routes/reviewer.js");
const { createMemoryFindingClassificationRecordStore } = await importCompiled("src/reviewer/classification-store.js");
const { createMemoryNormalizationOutcomeStore } = await importCompiled("src/worker/normalization-records.js");
const { errorEnvelope } = await importCompiled("src/error-envelope.js");
const { createMemoryClassificationStore } = await importCompiled("../../packages/evidence-store/src/index.js");
const { validateProtocolSchema } = await importCompiled("../../packages/protocol-ts/src/index.js");

// A review of its own: the shared seeded log holds hand-made events that the
// real append check would refuse to extend.
const REVIEW = "review:synthetic-reviewer-0001";
const fixture = JSON.parse(readFileSync(new URL("../../../protocol/fixtures/v0/valid/review-finding-draft-set.finding-context.json", import.meta.url), "utf8"));
const draftSet = { ...fixture, review_id: REVIEW };
const DRAFT = draftSet.review_finding_drafts[0].review_finding_draft_id;
const bytes = new TextEncoder().encode(JSON.stringify(draftSet));
const DIGEST = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const ATTEMPT = "submission_attempt:reviewer-test-0001";

const objectClassifications = createMemoryClassificationStore();
const outcomes = createMemoryNormalizationOutcomeStore();
const classifications = createMemoryFindingClassificationRecordStore();
const storedObject = {
  protocol_version: "codeattest.v0",
  stored_object_ref: `stored_object:${DIGEST.slice("sha256:".length)}`,
  object_kind: "evidence_artifact",
  source_derived_class: "retained_review_artifact",
  environment_profile: "synthetic_demo"
};
await objectClassifications.record(storedObject);
await outcomes.record({ submission_attempt_id: ATTEMPT, review_id: REVIEW, outcome: "normalized", draft_set_digest: DIGEST });
await outcomes.record({ submission_attempt_id: "submission_attempt:reviewer-test-0002", review_id: REVIEW, outcome: "rejected", rejection_reason: "worker_artifact_unreadable" });

let tick = Date.parse("2026-08-20T00:00:00Z");
const { server, ports } = await buildTestServer({
  now: () => {
    tick += 1000;
    return new Date(tick).toISOString().replace(/\.000Z$/, "Z");
  },
  beforeReady: async (server, ports) => {
    ports.reviewOwnership.seedOwner(REVIEW, SEEDED.reviewer.tenant_id);
    await ports.artifacts.put({ digest: DIGEST, bytes, classification: storedObject, reviewId: REVIEW });
    await registerReviewerRoutes(server, { outcomes, artifacts: ports.artifacts, objectClassifications, classifications, errorEnvelope });
  }
});

const draftsUrl = (review) => `/web/reviewer/reviews/${encodeURIComponent(review)}/drafts`;
const classifyUrl = (review) => `/web/reviewer/reviews/${encodeURIComponent(review)}/classifications`;
const draftSetAccesses = async () => (await ports.evidenceLifecycleLog.loadLog(REVIEW))
  .filter((event) => event.event_type === "evidence_accessed" && event.purpose === "reviewer_classification");
const classificationEvents = async () => (await ports.reviewEventLog.loadLog(REVIEW)).filter((event) => event.event_type === "classification_recorded");
const seededClassificationEvents = (await classificationEvents()).length;

const reviewerCookie = await loginAs(server, SEEDED.reviewer);
const customerCookie = await loginAs(server, SEEDED.customer);
const dualCookie = await loginAs(server, SEEDED.dualRole);

// --- the gate: nothing is read or logged unless every check passes ----------
{
  const anonymous = await server.inject({ method: "GET", url: draftsUrl(REVIEW) });
  assert.equal(anonymous.statusCode, 401, anonymous.body);

  const customer = await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: customerCookie } });
  assert.equal(customer.statusCode, 403, customer.body);
  assert.equal(customer.json().reason_code, "evidence_access_denied");

  // The dual-role account's review-scoped customer grant wins over its
  // tenant-wide reviewer grant for the review that grant names.
  const dualScoped = await server.inject({ method: "GET", url: draftsUrl(SEEDED.reviewInScope), headers: { cookie: dualCookie } });
  assert.equal(dualScoped.statusCode, 403, dualScoped.body);
  assert.equal(dualScoped.json().reason_code, "evidence_access_denied");

  // Here its reviewer grant applies, but its session has no TOTP.
  const dualHere = await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: dualCookie } });
  assert.equal(dualHere.statusCode, 403, dualHere.body);
  assert.equal(dualHere.json().reason_code, "second_factor_required");
  const dualPost = await server.inject({ method: "POST", url: classifyUrl(REVIEW), headers: { cookie: dualCookie }, payload: {} });
  assert.equal(dualPost.json().reason_code, "second_factor_required");

  // A reviewer of this tenant cannot reach another tenant's review.
  const foreign = await server.inject({ method: "GET", url: draftsUrl(SEEDED.reviewOutOfScope), headers: { cookie: reviewerCookie } });
  assert.equal(foreign.statusCode, 403, foreign.body);

  assert.equal((await draftSetAccesses()).length, 0, "no denied request read the draft set");
}

// --- the queue lists only reviews the per-review gate would admit -------------
{
  await outcomes.record({ submission_attempt_id: "submission_attempt:foreign-0001", review_id: SEEDED.reviewOutOfScope, outcome: "normalized", draft_set_digest: DIGEST });
  const queue = await server.inject({ method: "GET", url: "/web/reviewer/queue", headers: { cookie: reviewerCookie } });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.deepEqual(queue.json().reviews, [{ reviewScope: REVIEW, normalized: 1, rejected: 1 }], "the foreign tenant's review is not listed");
  assert.equal((await server.inject({ method: "GET", url: "/web/reviewer/queue" })).statusCode, 401);
  assert.equal((await server.inject({ method: "GET", url: "/web/reviewer/queue", headers: { cookie: customerCookie } })).statusCode, 403);
  const dualQueue = await server.inject({ method: "GET", url: "/web/reviewer/queue", headers: { cookie: dualCookie } });
  assert.equal(dualQueue.json().reason_code, "second_factor_required");
}

// --- a reviewer sees each draft in the workbench ------------------------------
{
  const response = await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.reviewScope, REVIEW);
  assert.equal(body.shell.kind, "app-shell");
  assert.deepEqual(body.rejectedNormalizations, [{ submissionAttemptId: "submission_attempt:reviewer-test-0002", reason: "worker_artifact_unreadable" }]);
  assert.equal(body.draftSets.length, 1);
  const [set] = body.draftSets;
  assert.equal(set.available, true);
  assert.equal(set.draftSetDigest, DIGEST);
  assert.equal(set.drafts.length, 1);
  const [draft] = set.drafts;
  assert.equal(draft.draftRef, DRAFT);
  assert.equal(draft.current, null);
  assert.equal(draft.workbench.kind, "classification-workbench");
  assert.equal(draft.workbench.available, true);
  assert.equal(draft.workbench.affectedArea, draftSet.review_finding_drafts[0].affected_area);
  assert.equal(draft.workbench.currentState.badge, null);
  assert.deepEqual(draft.defaults.limitations, draftSet.normalization_limitations);

  // One access receipt for the draft-set read, scoped to the owning tenant.
  const accesses = await draftSetAccesses();
  assert.equal(accesses.length, 1);
  assert.match(accesses[0].artifact_refs[0], /^artifact_ref:draft_set_[a-f0-9]{40}$/);
  assert.equal(accesses[0].actor.actor_type, "reviewer");
  assert.equal(accesses[0].access_scope.tenant_id, SEEDED.reviewer.tenant_id);
}

const likely = {
  draft_set_digest: DIGEST,
  review_finding_draft_ref: DRAFT,
  classification: "likely",
  rationale: "Reviewer judges the insecure random use as likely from the bounded snippet context.",
  limitations: ["Snippet context does not show how the value is used downstream."]
};

// --- refused classifications change nothing -----------------------------------
{
  const customer = await server.inject({ method: "POST", url: classifyUrl(REVIEW), headers: { cookie: customerCookie }, payload: likely });
  assert.equal(customer.statusCode, 403, customer.body);

  // The evidence binding is never taken from a request.
  const injected = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, evidence_basis: ["extended_approved_source_context"] }
  });
  assert.equal(injected.statusCode, 400, injected.body);
  assert.equal(injected.json().reason_code, "classification_request_invalid");

  const blank = await server.inject({ method: "POST", url: classifyUrl(REVIEW), headers: { cookie: reviewerCookie }, payload: { ...likely, rationale: "   " } });
  assert.equal(blank.statusCode, 400, blank.body);

  const unknownSet = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, draft_set_digest: `sha256:${"e".repeat(64)}` }
  });
  assert.equal(unknownSet.statusCode, 404, unknownSet.body);
  assert.equal(unknownSet.json().reason_code, "classification_draft_not_found");

  const unknownDraft = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, review_finding_draft_ref: "review_finding_draft:not_in_this_set" }
  });
  assert.equal(unknownDraft.statusCode, 404, unknownDraft.body);

  const unsupported = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, classification: "confirmed" }
  });
  assert.equal(unsupported.statusCode, 422, unsupported.body);
  assert.equal(unsupported.json().reason_code, "finding_classification_confirmed_criteria_required");

  const noPath = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, classification: "requires_customer_side_validation" }
  });
  assert.equal(noPath.statusCode, 422, noPath.body);
  assert.equal(noPath.json().reason_code, "finding_classification_validation_path_required");

  const sourceText = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, rationale: "const token = Math.random().toString(36); return token;" }
  });
  assert.equal(sourceText.statusCode, 422, sourceText.body);
  assert.equal(sourceText.json().reason_code, "finding_classification_text_forbidden");

  // A shared classification lands in a customer-visible event, so claim-unsafe
  // wording is refused as well as source code.
  const claim = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, visibility: "customer_facing", rationale: "This area has no vulnerabilities after the reviewer looked at it." }
  });
  assert.equal(claim.statusCode, 422, claim.body);
  assert.equal(claim.json().reason_code, "finding_classification_text_forbidden");

  assert.equal((await classificationEvents()).length, seededClassificationEvents, "no refused request appended an event");
}

// --- a classification is recorded, bound to the stored draft -------------------
const first = await server.inject({ method: "POST", url: classifyUrl(REVIEW), headers: { cookie: reviewerCookie }, payload: likely });
assert.equal(first.statusCode, 201, first.body);
const firstBody = first.json();
assert.match(firstBody.classification_record_id, /^classification_record:[a-f0-9]{32}$/);
assert.equal(firstBody.supersedes_classification_record_ref, undefined);
{
  const events = await classificationEvents();
  assert.equal(events.length, seededClassificationEvents + 1);
  const event = events.at(-1);
  assert.equal(event.event_id, firstBody.event_id);
  assert.equal(event.actor.actor_type, "reviewer");
  assert.equal(event.actor.actor_id, SEEDED.reviewer.account_id);
  assert.equal(event.visibility, "internal_only", "a classification stays internal unless the reviewer shares it");
  assert.deepEqual(validateProtocolSchema("urn:codeattest:protocol:v0:review-event", event), []);

  const [stored] = await classifications.listForReview(REVIEW);
  assert.equal(stored.draft_set_digest, DIGEST);
  assert.deepEqual(validateProtocolSchema("urn:codeattest:protocol:v0:finding-classification-record", stored.record), []);
  const sourceDraft = draftSet.review_finding_drafts[0];
  assert.deepEqual(stored.record.evidence_basis, sourceDraft.evidence_basis);
  assert.deepEqual(stored.record.review_finding_draft_evidence_refs, sourceDraft.evidence_refs);
  assert.equal(stored.record.source_reference_state, sourceDraft.source_reference_state);
  assert.deepEqual(stored.record.threshold_gaps, sourceDraft.threshold_gaps, "threshold gaps default to the draft's");
  assert.deepEqual(stored.record.limitations, likely.limitations);
}

const afterFirst = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json();
{
  const [draft] = afterFirst.draftSets[0].drafts;
  assert.equal(draft.current.classification, "likely");
  assert.equal(draft.current.recordRef, firstBody.classification_record_id);
  assert.equal(draft.workbench.currentState.badge.visibleLabel, "Likely");
}

// --- a changed judgment supersedes the earlier one; nothing is rewritten -------
const second = await server.inject({
  method: "POST",
  url: classifyUrl(REVIEW),
  headers: { cookie: reviewerCookie },
  payload: {
    ...likely,
    classification: "inconclusive",
    rationale: "Further review shows the snippet cannot settle how the value is used.",
    visibility: "customer_facing"
  }
});
assert.equal(second.statusCode, 201, second.body);
assert.equal(second.json().supersedes_classification_record_ref, firstBody.classification_record_id);
{
  const events = await classificationEvents();
  assert.equal(events.length, seededClassificationEvents + 2);
  assert.equal(events.at(-1).supersedes_event_id, firstBody.event_id);
  assert.equal(events.at(-1).visibility, "customer_facing");
  assert.equal(events.at(-2).event_id, firstBody.event_id, "the first event is still in the log");
  const [draft] = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json().draftSets[0].drafts;
  assert.equal(draft.current.classification, "inconclusive");
  assert.equal(draft.workbench.currentState.badge.visibleLabel, "Inconclusive");
}

// --- a write that lands between reading the log and appending is a conflict ----
{
  // The route reads a log that is one event behind, as if another reviewer's
  // classification landed after this request read it.
  const before = (await classificationEvents()).length;
  const realLoadLog = ports.reviewEventLog.loadLog;
  ports.reviewEventLog.loadLog = async (reviewId) => {
    ports.reviewEventLog.loadLog = realLoadLog;
    return (await realLoadLog.call(ports.reviewEventLog, reviewId)).slice(0, -1);
  };
  const raced = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, rationale: "A stale reviewer view tries to record a likely judgment here." }
  });
  assert.equal(raced.statusCode, 409, raced.body);
  assert.equal(raced.json().reason_code, "classification_conflict");
  assert.equal(ports.reviewEventLog.loadLog, realLoadLog);
  assert.equal((await classificationEvents()).length, before, "the losing write appended nothing");
  const [draft] = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json().draftSets[0].drafts;
  assert.equal(draft.current.classification, "inconclusive", "the losing record is never current");
}

// --- a stored record whose event never landed is never current -----------------
{
  const [stored] = await classifications.listForReview(REVIEW);
  await classifications.record({
    draft_set_digest: DIGEST,
    record: { ...stored.record, classification: "likely", classification_record_id: "classification_record:orphan_never_appended" }
  });
  const [draft] = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json().draftSets[0].drafts;
  assert.equal(draft.current.classification, "inconclusive");
}

// --- the customer history shows the shared classification, not the internal one
{
  const detail = await server.inject({ method: "GET", url: `/web/reviews/${encodeURIComponent(REVIEW)}`, headers: { cookie: customerCookie } });
  assert.equal(detail.statusCode, 200, detail.body);
  const shown = detail.json().timeline.filter((entry) => entry.eventType === "classification_recorded");
  assert.equal(shown.length, 1, "only the shared classification reaches the customer history");
  assert.equal(shown[0].visibility.value, "customer_facing");
  assert.doesNotMatch(detail.body, /Reviewer judges the insecure random use/, "internal rationale never reaches the customer");
}

// --- an unreadable draft set is reported, not hidden ---------------------------
{
  const missing = `sha256:${"d".repeat(64)}`;
  await outcomes.record({ submission_attempt_id: "submission_attempt:reviewer-test-0003", review_id: REVIEW, outcome: "normalized", draft_set_digest: missing });
  const body = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json();
  const unreadable = body.draftSets.find((set) => set.draftSetDigest === missing);
  assert.equal(unreadable.available, false);
  assert.equal(unreadable.reason, "evidence_unavailable");
  assert.equal(body.draftSets.find((set) => set.draftSetDigest === DIGEST).available, true);
}

// --- a draft set that names another review is refused, with its own reason ----
{
  const otherBytes = new TextEncoder().encode(JSON.stringify({ ...draftSet, review_id: "review:some-other-review" }));
  const otherDigest = `sha256:${createHash("sha256").update(otherBytes).digest("hex")}`;
  const otherObject = { ...storedObject, stored_object_ref: `stored_object:${otherDigest.slice("sha256:".length)}` };
  await ports.artifacts.put({ digest: otherDigest, bytes: otherBytes, classification: otherObject, reviewId: REVIEW });
  await objectClassifications.record(otherObject);
  await outcomes.record({ submission_attempt_id: "submission_attempt:reviewer-test-0004", review_id: REVIEW, outcome: "normalized", draft_set_digest: otherDigest });
  const body = (await server.inject({ method: "GET", url: draftsUrl(REVIEW), headers: { cookie: reviewerCookie } })).json();
  assert.equal(body.draftSets.find((set) => set.draftSetDigest === otherDigest).reason, "draft_set_review_mismatch");
  const refused = await server.inject({
    method: "POST",
    url: classifyUrl(REVIEW),
    headers: { cookie: reviewerCookie },
    payload: { ...likely, draft_set_digest: otherDigest }
  });
  assert.equal(refused.statusCode, 422, refused.body);
  assert.equal(refused.json().reason_code, "draft_set_review_mismatch");
}

console.log("reviewer workbench route tests passed.");
