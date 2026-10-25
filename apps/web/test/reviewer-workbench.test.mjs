import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const HOST = "http://127.0.0.1:8787";
const env = { CODEATTEST_HOST_BASE_URL: HOST };
const REVIEW = "review:synthetic-reviewer-0001";
const DRAFT = "review_finding_draft:demo_finding_context";
const DIGEST = `sha256:${"a".repeat(64)}`;

const ui = await importCompiled("../../packages/ui/src/index.js");
const { ClassificationWorkbench } = await importCompiled("components/ClassificationWorkbench.js");
const { classifyFormToHostBody, createClassifyPostHandler, reviewerMessage, workbenchPath } = await importCompiled("lib/reviewer.js");

function form(fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const filled = {
  review_scope: REVIEW,
  draft_set_digest: DIGEST,
  review_finding_draft_ref: DRAFT,
  classification: "likely",
  rationale: "  Bounded snippet context makes this likely.  ",
  confirmation_criteria: "",
  threshold_gaps: "First gap\n\n  Second gap  \r\n",
  limitations: "One limitation",
  defensible_confirmation_criteria: "   ",
  validation_path_summary: ""
};

// --- the form becomes the host body; textareas are one entry per line --------
{
  const parsed = classifyFormToHostBody(form(filled));
  assert.equal(parsed.reviewScope, REVIEW);
  assert.deepEqual(parsed.body, {
    draft_set_digest: DIGEST,
    review_finding_draft_ref: DRAFT,
    classification: "likely",
    rationale: "Bounded snippet context makes this likely.",
    threshold_gaps: ["First gap", "Second gap"],
    limitations: ["One limitation"],
    visibility: "internal_only"
  });
  assert.equal(classifyFormToHostBody(form({ ...filled, share_with_customer: "yes" })).body.visibility, "customer_facing");
  assert.equal(classifyFormToHostBody(form({ ...filled, review_scope: "review:../../etc" })), undefined);
  assert.equal(classifyFormToHostBody(form({ ...filled, review_finding_draft_ref: "" })), undefined);
}

// --- the handler forwards JSON with the session and reports the outcome ------
function mockHost(status, body = "") {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  };
  return { calls, fetchImpl };
}

function post(fields, headers = { cookie: "__Host-codeattest_session=opaque", "x-forwarded-for": "198.51.100.7" }) {
  return new Request("http://web.invalid/reviewer/classify", { method: "POST", headers, body: form(fields) });
}

{
  const { calls, fetchImpl } = mockHost(201, "{}");
  const response = await createClassifyPostHandler({ fetchImpl, env })(post(filled));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), workbenchPath(REVIEW, { saved: DRAFT }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/web/reviewer/reviews/${encodeURIComponent(REVIEW)}/classifications`);
  assert.equal(calls[0].init.method, "POST");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("cookie"), "__Host-codeattest_session=opaque");
  assert.equal(headers.get("x-forwarded-for"), "198.51.100.7");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(JSON.parse(calls[0].init.body).classification, "likely");
}
{
  const { fetchImpl } = mockHost(422, JSON.stringify({ reason_code: "finding_classification_confirmed_criteria_required", message: "x" }));
  const response = await createClassifyPostHandler({ fetchImpl, env })(post(filled));
  assert.equal(response.headers.get("location"), workbenchPath(REVIEW, { error: "finding_classification_confirmed_criteria_required", draft: DRAFT }));
}
{
  // A host body that is not a reason code never reaches the query string.
  const { fetchImpl } = mockHost(500, "<html>boom</html>");
  const response = await createClassifyPostHandler({ fetchImpl, env })(post(filled));
  assert.equal(new URL(response.headers.get("location"), "http://web.invalid").searchParams.get("error"), "classification_not_saved");
}
{
  const { fetchImpl } = mockHost(401, "{}");
  assert.equal((await createClassifyPostHandler({ fetchImpl, env })(post(filled))).headers.get("location"), "/login");
}
{
  const { calls, fetchImpl } = mockHost(201, "{}");
  const handler = createClassifyPostHandler({ fetchImpl, env });
  assert.equal((await handler(post(filled, {}))).headers.get("location"), "/login", "no session, no host call");
  assert.equal((await handler(post({ ...filled, review_scope: "nope" }))).headers.get("location"), "/");
  assert.equal(calls.length, 0);
}

assert.match(reviewerMessage("second_factor_required"), /authenticator/);
assert.equal(reviewerMessage("unheard_of_code"), "The classification was not saved.");

// --- the component renders the ui contract and a plain HTML form -------------
const draftSet = JSON.parse(readFileSync(new URL("../../../protocol/fixtures/v0/valid/review-finding-draft-set.finding-context.json", import.meta.url), "utf8"));
const draft = draftSet.review_finding_drafts[0];
const workbench = ui.ReviewerClassificationWorkbench({
  draft: {
    reviewFindingDraftId: draft.review_finding_draft_id,
    title: draft.scanner_rule_ids.join(", "),
    affectedArea: "<script>alert(1)</script> src/app.ts:4:7",
    scannerContext: draft.scanner_rule_ids.map((rule) => ({ label: "Rule", value: rule })),
    evidenceReferences: draft.evidence_refs.map((ref) => ({ label: "Available evidence", value: ref.artifact_ref, availabilityState: ref.display_state })),
    evidenceBasis: draft.evidence_basis,
    thresholdGaps: draft.threshold_gaps,
    limitations: draftSet.normalization_limitations,
    sourceReferenceState: draft.source_reference_state
  }
});
assert.equal(workbench.available, true);
const view = { draftRef: draft.review_finding_draft_id, workbench, current: null, defaults: { thresholdGaps: draft.threshold_gaps, limitations: draftSet.normalization_limitations } };
const html = renderToStaticMarkup(createElement(ClassificationWorkbench, { view, reviewScope: REVIEW, draftSetDigest: DIGEST }));
assert.match(html, /<form[^>]*action="\/reviewer\/classify"/);
assert.match(html, /<form[^>]*method="post"/);
assert.match(html, new RegExp(`name="review_scope" value="${REVIEW}"`));
assert.match(html, new RegExp(`name="draft_set_digest" value="${DIGEST}"`));
assert.match(html, new RegExp(`name="review_finding_draft_ref" value="${DRAFT}"`));
for (const choice of ["likely", "confirmed", "inconclusive", "requires_customer_side_validation"]) {
  assert.match(html, new RegExp(`<input type="radio"[^>]*name="classification" value="${choice}"`));
}
assert.match(html, /name="rationale"[^>]*required/);
assert.match(html, /name="share_with_customer" value="yes"/);
assert.doesNotMatch(html, /name="share_with_customer"[^>]*checked/, "sharing is never preselected");
assert.match(html, /data-min-target-size-px="44"/);
assert.match(html, /Not classified yet\./);
assert.doesNotMatch(html, /<script>/, "evidence-derived text is escaped");
assert.match(html, /&lt;script&gt;/);
for (const label of ["Rationale", "Limitations", "Threshold gaps"]) {
  assert.match(html, new RegExp(`<label for="[^"]+">${label}</label>`), `${label} has a label`);
}

// A current classification shows its badge and is preselected for the next one.
{
  const record = JSON.parse(readFileSync(new URL("../../../protocol/fixtures/v0/valid/finding-classification-record.likely.json", import.meta.url), "utf8"));
  const current = ui.ReviewerClassificationWorkbench({ draft: { ...view.workbench, ...{
    reviewFindingDraftId: record.review_finding_draft_ref,
    title: "Rule",
    affectedArea: "src/app.ts:4:7",
    scannerContext: [],
    evidenceReferences: [],
    evidenceBasis: record.evidence_basis,
    thresholdGaps: [],
    limitations: record.limitations,
    sourceReferenceState: record.source_reference_state
  } }, currentClassification: record });
  const withCurrent = renderToStaticMarkup(createElement(ClassificationWorkbench, {
    view: { ...view, workbench: current, current: { recordRef: record.classification_record_id, classification: "likely", visibility: "internal_only", classifiedAt: record.classified_at } },
    reviewScope: REVIEW,
    draftSetDigest: DIGEST
  }));
  assert.match(withCurrent, /data-classification="likely"/);
  const checked = [...withCurrent.matchAll(/<input type="radio"[^>]*>/g)].map(([tag]) => tag).filter((tag) => tag.includes('checked=""'));
  assert.equal(checked.length, 1);
  assert.match(checked[0], /value="likely"/);
  assert.match(withCurrent, /supersedes the current one/);
  assert.match(withCurrent, /internal only/);
}

// An unavailable draft renders no form at all.
{
  const unavailable = ui.ReviewerClassificationWorkbench(null);
  assert.equal(unavailable.available, false);
  const markup = renderToStaticMarkup(createElement(ClassificationWorkbench, { view: { ...view, workbench: unavailable }, reviewScope: REVIEW, draftSetDigest: DIGEST }));
  assert.doesNotMatch(markup, /<form/);
  assert.match(markup, /cannot be classified/);
}

console.log("@onevps/web reviewer workbench test passed.");
