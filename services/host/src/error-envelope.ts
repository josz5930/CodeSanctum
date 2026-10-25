/**
 * Spec section 5.7's stable reason-code -> HTTP status -> claim-safe body
 * mapping. A has no customer-facing endpoints, so B is the first to need
 * this; E inherits it rather than each sub-project inventing its own shape.
 * The route always chooses the HTTP status; this only ever supplies the body.
 */
export type ErrorEnvelopeBody = { reason_code: string; message: string };

const MESSAGES: Record<string, string> = {
  budget_halted: "Demo business routes are temporarily unavailable because the budget ceiling was reached.",
  submission_credential_invalid: "The submission credential could not be authenticated.",
  submission_intake_disabled: "Submission intake is temporarily disabled.",
  submission_schema_invalid: "The submitted artifacts did not match the expected protocol schema.",
  submission_manifest_not_expected: "The submitted manifest does not match what this credential expects.",
  submission_attempt_body_conflict: "This submission attempt id was already opened with different contents.",
  submission_attempt_not_found: "No open submission attempt was found for this request.",
  submission_artifact_not_in_manifest: "The submitted artifact digest is not declared in the opened manifest.",
  submission_artifact_digest_mismatch: "The submitted bytes do not match the declared digest.",
  submission_artifact_body_invalid: "The submitted artifact body could not be read.",
  submission_artifact_classification_refused: "The submitted artifact could not be classified for storage.",
  submission_artifact_too_large: "The submitted artifact exceeded the maximum allowed size.",
  submission_already_finalized: "This submission attempt has already been finalized.",
  submission_artifacts_incomplete: "Not every declared artifact has been received yet.",
  submission_outcome_not_buildable: "The submission outcome could not be constructed.",
  auth_request_invalid: "The authentication request was not valid.",
  auth_credentials_invalid: "The credentials could not be authenticated.",
  evidence_access_denied: "Access to this evidence was denied.",
  evidence_unavailable: "The evidence could not be read; try again later.",
  second_factor_required: "This action requires a session confirmed with an authenticator code.",
  classification_request_invalid: "The classification request was not valid.",
  classification_draft_not_found: "No normalized finding draft matches this request.",
  draft_set_review_mismatch: "This draft set names a different review than the one it was submitted to, so it cannot be classified here.",
  classification_conflict: "The review changed while this classification was being saved; reload and try again.",
  finding_classification_confirmed_criteria_required: "A confirmed classification needs at least one confirmation criterion.",
  finding_classification_confirmed_defensible_criteria_required: "This evidence basis needs defensible confirmation criteria before it can be confirmed.",
  finding_classification_validation_path_required: "A classification that requires customer-side validation needs a validation path.",
  finding_classification_limitations_required: "A classification needs at least one limitation.",
  finding_classification_text_forbidden: "The classification text contains wording or source content that may not be recorded.",
  rate_limited: "Too many requests from this client; retry after a short delay."
};

export function errorEnvelope(reasonCode: string): ErrorEnvelopeBody {
  return { reason_code: reasonCode, message: MESSAGES[reasonCode] ?? "The request could not be completed." };
}
