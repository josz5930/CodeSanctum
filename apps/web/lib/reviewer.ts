import { hostFetch, type HostFetchDeps } from "./host-fetch.js";

const REVIEW_SCOPE = /^review:[a-z0-9][a-z0-9_-]{2,63}$/;
const DRAFT_REF = /^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$/;
const REASON_CODE = /^[a-z][a-z0-9_]{2,95}$/;

/** The host body for one classification; every binding field is the host's to fill in. */
export type ClassifyHostBody = {
  draft_set_digest: string;
  review_finding_draft_ref: string;
  classification: string;
  rationale: string;
  confirmation_criteria?: string[];
  defensible_confirmation_criteria?: string;
  threshold_gaps?: string[];
  limitations?: string[];
  validation_path_summary?: string;
  visibility: "internal_only" | "customer_facing";
};

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** A textarea holds one entry per line; blank lines are dropped. */
function lines(formData: FormData, name: string): string[] | undefined {
  const kept = text(formData, name).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return kept.length === 0 ? undefined : kept;
}

/**
 * Reads the workbench form. Returns the review scope it targets and the JSON
 * body for the host, or undefined when the form does not name a review and a
 * draft. The host checks everything else; this only shapes the request.
 */
export function classifyFormToHostBody(formData: FormData): { reviewScope: string; body: ClassifyHostBody } | undefined {
  const reviewScope = text(formData, "review_scope");
  const draftRef = text(formData, "review_finding_draft_ref");
  if (!REVIEW_SCOPE.test(reviewScope) || !DRAFT_REF.test(draftRef)) {
    return undefined;
  }
  const confirmationCriteria = lines(formData, "confirmation_criteria");
  const thresholdGaps = lines(formData, "threshold_gaps");
  const limitations = lines(formData, "limitations");
  const defensible = text(formData, "defensible_confirmation_criteria");
  const validationPath = text(formData, "validation_path_summary");
  return {
    reviewScope,
    body: {
      draft_set_digest: text(formData, "draft_set_digest"),
      review_finding_draft_ref: draftRef,
      classification: text(formData, "classification"),
      rationale: text(formData, "rationale"),
      ...(confirmationCriteria === undefined ? {} : { confirmation_criteria: confirmationCriteria }),
      ...(defensible.length === 0 ? {} : { defensible_confirmation_criteria: defensible }),
      ...(thresholdGaps === undefined ? {} : { threshold_gaps: thresholdGaps }),
      ...(limitations === undefined ? {} : { limitations }),
      ...(validationPath.length === 0 ? {} : { validation_path_summary: validationPath }),
      // Sharing with the customer is an explicit choice; the default is internal.
      visibility: text(formData, "share_with_customer") === "yes" ? "customer_facing" : "internal_only"
    }
  };
}

export function workbenchPath(reviewScope: string, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  return `/reviews/${encodeURIComponent(reviewScope)}/workbench${search.length === 0 ? "" : `?${search}`}`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function reasonCodeFrom(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { reason_code?: unknown };
    return typeof parsed.reason_code === "string" && REASON_CODE.test(parsed.reason_code) ? parsed.reason_code : "classification_not_saved";
  } catch {
    return "classification_not_saved";
  }
}

/**
 * Posts one workbench form to the host as JSON with the session cookie, then
 * sends the browser back to the workbench with the outcome in the query.
 */
export function createClassifyPostHandler(deps: HostFetchDeps = {}) {
  return async (request: Request): Promise<Response> => {
    const cookie = request.headers.get("cookie");
    if (cookie === null || cookie.length === 0) {
      return redirect("/login");
    }
    const parsed = classifyFormToHostBody(await request.formData());
    if (parsed === undefined) {
      return redirect("/");
    }
    const result = await hostFetch({
      path: `/web/reviewer/reviews/${encodeURIComponent(parsed.reviewScope)}/classifications`,
      method: "POST",
      cookie,
      forwardedFor: request.headers.get("x-forwarded-for"),
      body: parsed.body,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    if (result.kind === "session-expired") {
      return redirect("/login");
    }
    const draft = parsed.body.review_finding_draft_ref;
    if (result.status === 201) {
      return redirect(workbenchPath(parsed.reviewScope, { saved: draft }));
    }
    return redirect(workbenchPath(parsed.reviewScope, { error: reasonCodeFrom(result.bodyText), draft }));
  };
}

const MESSAGES: Record<string, string> = {
  second_factor_required: "Sign in again with your authenticator code to use the workbench.",
  evidence_access_denied: "You do not have reviewer access to this review.",
  evidence_unavailable: "The draft set could not be read. Try again later.",
  draft_set_review_mismatch: "This draft set names a different review than the one it was submitted to, so it cannot be classified here.",
  classification_request_invalid: "The classification was not saved: a required field is missing or too long.",
  classification_draft_not_found: "That finding draft is no longer available.",
  classification_conflict: "Another classification was saved first. Check the current state and try again.",
  finding_classification_confirmed_criteria_required: "A confirmed classification needs at least one confirmation criterion.",
  finding_classification_confirmed_defensible_criteria_required: "This evidence basis needs defensible confirmation criteria before it can be confirmed.",
  finding_classification_validation_path_required: "A classification that needs customer-side validation needs a validation path.",
  finding_classification_limitations_required: "Add at least one limitation.",
  finding_classification_text_forbidden: "The text contains wording or source content that may not be recorded. Describe the finding without quoting code."
};

/** Workbench copy for a host reason code; an unknown code gets a general message. */
export function reviewerMessage(reasonCode: string): string {
  return MESSAGES[reasonCode] ?? "The classification was not saved.";
}
