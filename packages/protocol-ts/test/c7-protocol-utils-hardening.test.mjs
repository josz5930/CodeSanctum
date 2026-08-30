import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readFile } from "node:fs/promises";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const protocolUtils = await import(pathToFileURL(path.join(repoRoot, "scripts", "lib", "protocol-utils.mjs")).href);
const fixtureRoot = path.join(repoRoot, "protocol", "fixtures");

async function loadFixture(relativePath) {
  return JSON.parse(await readFile(path.join(fixtureRoot, relativePath), "utf8"));
}

async function semanticErrorCodes(value, fixturePath) {
  const errors = await protocolUtils.validateFixtureSemantics(value, { fixtureRoot, fixturePath, expectedFailure: undefined, syntheticMarkers: [] });
  return errors.map((error) => error.code);
}

// C7-03: a required bundle-chain artifact (customer_approval) with no
// content_path used to be silently skipped instead of failing.
{
  const bundle = await loadFixture("v0/valid/bundle-manifest.json");
  const approvalRef = bundle.artifact_references.find((artifact) => artifact.artifact_type === "customer_approval");
  delete approvalRef.content_path;
  delete approvalRef.content_path_anchor;
  const codes = await semanticErrorCodes(bundle, "v0/valid/bundle-manifest.json");
  assert.ok(codes.includes("bundle_referenced_artifact_content_path_required"), "missing content_path on a required bundle-chain artifact must fail");
}

// C7-04: finding_context_snippets / extended coverage modes must require the
// category inventory to actually agree with the snippet policy, not just the
// policy fields in isolation.
{
  const policy = await loadFixture("v0/valid/disclosure-policy.json");
  policy.coverage_mode = "finding_context_snippets";
  policy.snippet_policy = {
    allow_raw_snippets: true,
    selection_behavior: "finding_context",
    max_snippet_chars: 500,
    context_lines: 3,
    selected_files_or_areas: [],
    raw_snippet_default_class: "transient_source_derived"
  };
  policy.warnings = ["source-code disclosure capped redacted"];
  const rawSnippets = policy.evidence_categories.find((category) => category.category === "raw_snippets");
  if (rawSnippets) rawSnippets.included = false;
  const codes = await semanticErrorCodes(policy, "v0/valid/disclosure-policy.json");
  assert.ok(codes.includes("finding_context_requires_caps_redaction"), "finding_context_snippets with raw_snippets excluded must fail even when snippet_policy claims allow_raw_snippets");
}

// C7-05: a source-derived artifact paired with a same-ref cleanup intent
// classed for a DIFFERENT source_derived_class (or not requiring real
// cleanup) must fail, not just pass on ref presence.
{
  const bundle = await loadFixture("v0/valid/bundle-manifest.json");
  const sourceDerivedArtifact = bundle.artifact_references.find(
    (artifact) => artifact.source_derived_class === "transient_source_derived" || artifact.source_derived_class === "customer_opt_in_retained_source"
  );
  assert.ok(sourceDerivedArtifact, "fixture must contain a source-derived artifact to exercise this check");
  bundle.local_cleanup_intent = [
    {
      artifact_ref: sourceDerivedArtifact.artifact_ref,
      source_derived_class: "retained_review_artifact",
      cleanup_state: "not_applicable",
      cleanup_required: false,
      deletion_evidence_state: "not_applicable"
    }
  ];
  const codes = await semanticErrorCodes(bundle, "v0/valid/bundle-manifest.json");
  assert.ok(codes.includes("source_derived_cleanup_intent_required"), "a same-ref cleanup intent classed for the wrong source_derived_class must not satisfy the requirement");
}

// C7-06: readiness must be required whenever retained-source classes are
// allowed, not only when real evidence acceptance booleans are true.
{
  const gate = await loadFixture("v0/valid/environment-evidence-gate.real-snippet-ready.json");
  gate.real_raw_snippet_acceptance = false;
  gate.real_targeted_file_acceptance = false;
  for (const field of [
    "access_control_ready",
    "access_logging_ready",
    "encryption_at_rest_ready",
    "retention_defaults_ready",
    "deletion_controls_ready",
    "demo_budget_gate_ready",
    "signing_release_trust_ready",
    "retention_period_required"
  ]) {
    gate[field] = false;
  }
  const codes = await semanticErrorCodes(gate, "v0/valid/environment-evidence-gate.real-snippet-ready.json");
  assert.ok(codes.includes("environment_gate_readiness_required"), "allowing customer_opt_in_retained_source with every readiness flag false must fail");
}

// C7-07: duplicate comparison-row fields (a valid row plus a contradictory
// one for the same field) must fail instead of the Map silently collapsing
// them to whichever sorts last.
{
  const receipt = await loadFixture("v0/valid/vendor-receipt.json");
  receipt.approved_vs_received_comparison.rows.push({
    field: "manifest_id",
    approved_value: "tampered",
    received_value: "tampered",
    result: "matched"
  });
  const codes = await semanticErrorCodes(receipt, "v0/valid/vendor-receipt.json");
  assert.ok(codes.includes("receipt_approved_received_mismatch"), "a duplicate comparison row field must fail");
}

// C7-21 / D3-3: a receipt signature must actually bind the receipt's signed
// identity. With real ML-DSA-65 bytes that binding is the signature
// verification itself, so a one-character tamper (still schema-shaped) must
// fail.
{
  const receipt = await loadFixture("v0/valid/vendor-receipt.json");
  const bytes = receipt.receipt_signature.signature_bytes;
  receipt.receipt_signature.signature_bytes = `${bytes.slice(0, -1)}${bytes.endsWith("A") ? "B" : "A"}`;
  const codes = await semanticErrorCodes(receipt, "v0/valid/vendor-receipt.json");
  assert.ok(codes.includes("receipt_signature_bytes_invalid"), "receipt signature bytes that do not verify over the published signing input must fail");
}

// C7-21: vendor receipt public_verification_metadata must mirror the private
// signature's protocol_version/algorithm_profile/canonicalization/signing_mode/
// signing_limitations, not just key/timing/identity fields.
{
  const receipt = await loadFixture("v0/valid/vendor-receipt.json");
  receipt.public_verification_metadata.signing_mode = "enrolled_runner_key";
  const codes = await semanticErrorCodes(receipt, "v0/valid/vendor-receipt.json");
  assert.ok(codes.includes("receipt_key_metadata_required"), "public_verification_metadata.signing_mode diverging from receipt_signature.signing_mode must fail");
}

// C7-26: the first verification_scope_recorded event for a review/pass used
// to be unconstrained when no active prior scope existed, so a log could
// begin at scope_version:2 with no supersedes_event_id.
{
  const log = await loadFixture("v0/valid/review-event-log.verification-scope.json");
  const scopeEvent = log.events.find((event) => event.event_type === "verification_scope_recorded");
  scopeEvent.idempotency_key = scopeEvent.idempotency_key.replace("scope_version:1", "scope_version:2");
  const codes = await semanticErrorCodes(log, "v0/valid/review-event-log.verification-scope.json");
  assert.ok(codes.includes("review_event_verification_scope_version_invalid"), "an initial verification-scope event starting at scope_version 2 must fail");
}

// C7-27: classification/remediation-guidance/validation are each their own
// expert record family; a reviewer-authored correction in one must not
// supersede a record from a different expert family.
{
  const log = await loadFixture("v0/valid/review-event-log.verification-scope.json");
  const classificationEvent = log.events.find((event) => event.event_type === "classification_recorded");
  const guidanceEvent = log.events.find((event) => event.event_type === "remediation_guidance_recorded");
  guidanceEvent.supersedes_event_id = classificationEvent.event_id;
  const codes = await semanticErrorCodes(log, "v0/valid/review-event-log.verification-scope.json");
  assert.ok(codes.includes("review_event_expert_supersedes_family_mismatch"), "remediation_guidance_recorded superseding classification_recorded must fail");
}

// C7-28: untyped/aggregate event types (e.g. submission failure) may
// legitimately carry multiple artifact_refs and must not be rejected by the
// typed-singleton artifact-ref check meant only for the typed families.
{
  const log = await loadFixture("v0/valid/review-event-log.submission-failures.json");
  const failureEvent = log.events.find((event) => event.event_type === "submission_rejected");
  assert.ok(failureEvent, "fixture must contain a submission_rejected event to exercise this check");
  failureEvent.artifact_refs = [...failureEvent.artifact_refs, "artifact_ref:synthetic_extra_ref"];
  const codes = await semanticErrorCodes(log, "v0/valid/review-event-log.submission-failures.json");
  assert.ok(!codes.includes("review_event_typed_artifact_ref_mismatch"), "a multi-ref submission failure event must not trip the typed-singleton artifact-ref check");
}

// C7-30: a draft's evidence_basis must be supported by its own evidence_refs,
// not just declared independently of them.
{
  const draftSet = await loadFixture("v0/valid/review-finding-draft-set.finding-context.json");
  draftSet.review_finding_drafts[0].evidence_basis = ["extended_approved_source_context"];
  const codes = await semanticErrorCodes(draftSet, "v0/valid/review-finding-draft-set.finding-context.json");
  assert.ok(codes.includes("review_finding_draft_evidence_basis_not_bound_to_refs"), "an evidence_basis unsupported by any evidence_ref must fail");
}

// C7-31: a genuinely retained evidence ref must display as an available
// reference, not e.g. "deleted" while still marked available_for_review.
{
  const draftSet = await loadFixture("v0/valid/review-finding-draft-set.finding-context.json");
  const retainedRef = draftSet.review_finding_drafts[0].evidence_refs.find((ref) => ref.availability_state === "retained_review_artifact");
  assert.ok(retainedRef, "fixture must contain a retained_review_artifact evidence ref to exercise this check");
  retainedRef.display_state = "deleted";
  const codes = await semanticErrorCodes(draftSet, "v0/valid/review-finding-draft-set.finding-context.json");
  assert.ok(codes.includes("review_finding_draft_retained_evidence_display_inconsistent"), "a retained evidence ref displayed as deleted must fail");
}

// C7-31: finding_context_snippet must be reserved for transient_source_derived
// evidence; customer_opt_in_retained_source belongs only to
// extended_approved_source_context.
{
  const draftSet = await loadFixture("v0/valid/review-finding-draft-set.finding-context.json");
  const draft = draftSet.review_finding_drafts[0];
  const snippetRef = draft.evidence_refs.find((ref) => ref.source_derived_class === "transient_source_derived");
  assert.ok(snippetRef, "fixture must contain a transient_source_derived evidence ref to exercise this check");
  snippetRef.source_derived_class = "customer_opt_in_retained_source";
  const codes = await semanticErrorCodes(draftSet, "v0/valid/review-finding-draft-set.finding-context.json");
  assert.ok(codes.includes("review_finding_draft_evidence_basis_not_bound_to_refs"), "finding_context_snippet basis must reject a customer_opt_in_retained_source ref");
}

// C7-32: an outcome record whose classification_record_ref does not resolve
// to any known classification fixture must fail, not pass vacuously.
{
  const record = await loadFixture("v0/valid/false-positive-record.reviewer.json");
  record.classification_record_ref = "classification_record:synthetic_does_not_exist_001";
  const codes = await semanticErrorCodes(record, "v0/valid/false-positive-record.reviewer.json");
  assert.ok(codes.includes("false_positive_record_reference_mismatch"), "a false-positive record referencing an unknown classification must fail");
}

// C7-33: only reviewer_authored_script_output evidence may carry
// reviewer_validation_script_ref; other verification-evidence types must not.
{
  const record = await loadFixture("v0/valid/verification-evidence-record.manual-validation.json");
  record.reviewer_validation_script_ref = "validation_script:synthetic_included_001";
  const codes = await semanticErrorCodes(record, "v0/valid/verification-evidence-record.manual-validation.json");
  assert.ok(codes.includes("verification_evidence_type_fields_mismatch"), "manual_validation_record carrying a reviewer_validation_script_ref must fail");
}

// C7-20: shared forbidden-text normalization must catch realistic
// bearer-token and API-key variants, not just the exact punctuation on the
// canonical phrase list.
{
  assert.ok(protocolUtils.forbiddenPublicContentReason("Authorization Bearer ey12345") !== undefined, "an unpunctuated Authorization Bearer variant must be forbidden text");
  assert.ok(protocolUtils.forbiddenPublicContentReason("api key = demo-value") !== undefined, "a spaced 'api key =' variant must be forbidden text");
}

// The protocol policy is the single source for the runtime and public-prose
// email scanners. The bounded local part prevents a failed candidate from
// re-running an unbounded prefix scan at each subsequent word boundary.
{
  const policy = JSON.parse(await readFile(path.join(repoRoot, "protocol", "policies", "claim-safety.v0.json"), "utf8"));
  assert.equal(protocolUtils.PII_EMAIL_ADDRESS_PATTERN_SOURCE, policy.pii_email_address_pattern, "scripts must load the protocol-owned email pattern without a local mirror");
  assert.equal(protocolUtils.CLAIM_SAFE_TEXT_MAX_LENGTH, policy.claim_safe_text_max_length, "scripts must load the protocol-owned text ceiling without a local mirror");
  assert.match(protocolUtils.PII_EMAIL_ADDRESS_PATTERN_SOURCE, /\{0,63\}@/u, "the protocol-owned email pattern must bound its local part");
  const publicEmailPattern = new RegExp(protocolUtils.PII_EMAIL_ADDRESS_PATTERN_SOURCE, "iu");
  assert.equal(publicEmailPattern.exec("Contact Reviewer@Sub.Example.COM")?.[1]?.toLowerCase(), "sub.example.com", "the public-prose scanner must preserve its domain capture for reserved-domain handling");
  const adversarialEmailCandidate = `a@${"a.".repeat((protocolUtils.CLAIM_SAFE_TEXT_MAX_LENGTH - 2) / 2)}`;
  const startedAt = performance.now();
  assert.equal(protocolUtils.piiTextForbidden(adversarialEmailCandidate), undefined, "a maximum-size unterminated email candidate must remain non-matching");
  const elapsedMs = performance.now() - startedAt;
  assert.ok(elapsedMs < 500, `the scripts PII scanner must handle the unterminated email candidate linearly (took ${elapsedMs.toFixed(1)} ms)`);
  assert.equal(protocolUtils.piiTextForbidden("x".repeat(protocolUtils.CLAIM_SAFE_TEXT_MAX_LENGTH + 1)), "text_too_long", "scripts must reject over-ceiling text before pattern matching");
}

// C7-35: a generated static bundle manifest must not carry
// supersedes_static_bundle_manifest_id -- that field records finalization
// lineage and only applies once the package has been finalized.
{
  const manifest = await loadFixture("v0/valid/static-bundle-manifest.generated.json");
  manifest.supersedes_static_bundle_manifest_id = manifest.static_bundle_manifest_id;
  const codes = await semanticErrorCodes(manifest, "v0/valid/static-bundle-manifest.generated.json");
  assert.ok(codes.includes("static_bundle_finalization_version_invalid"), "a generated manifest carrying supersedes_static_bundle_manifest_id must fail");
}

// C7-35: static portal navigation must bind each array index to its
// canonical section, not merely contain a permutation of the 8 sections with
// unique sequential order numbers.
{
  const projection = await loadFixture("v0/valid/static-portal-projection.json");
  const [first, second] = projection.navigation;
  const swappedIdentity = { section_id: first.section_id, label: first.label, relative_path: first.relative_path };
  first.section_id = second.section_id; first.label = second.label; first.relative_path = second.relative_path;
  second.section_id = swappedIdentity.section_id; second.label = swappedIdentity.label; second.relative_path = swappedIdentity.relative_path;
  const codes = await semanticErrorCodes(projection, "v0/valid/static-portal-projection.json");
  assert.ok(codes.includes("static_portal_navigation_incomplete"), "navigation sections swapped between array positions (orders otherwise valid) must fail");
}

// C7-34: pilot metric measurement windows must be compared at nanosecond
// precision, not millisecond-truncating Date.parse().
{
  const metric = await loadFixture("v0/valid/pilot-metric-record.json");
  metric.measurement_window.start_timestamp = "2026-07-30T00:00:00.000000001Z";
  metric.measurement_window.end_timestamp = "2026-07-30T00:00:00.000000002Z";
  metric.recorded_at = "2026-07-30T00:00:00.000000003Z";
  const codes = await semanticErrorCodes(metric, "v0/valid/pilot-metric-record.json");
  assert.ok(!codes.includes("pilot_metric_window_invalid"), "a genuinely valid one-nanosecond-wide window must not fail");
}

console.log("protocol-ts / scripts C7 protocol-utils hardening tests passed.");
