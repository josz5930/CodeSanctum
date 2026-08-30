import {
  compareUtcRfc3339Timestamps,
  computeCanonicalSha256Id,
  isUtcRfc3339Timestamp,
  piiTextForbidden,
  sourceCodeLikeTextReason,
  sourceTextForbiddenPhrase,
  validateProtocolSchema,
  verifiedArtifactSemanticIssues,
  verifiedSubmissionChainIssues
} from "../../../packages/protocol-ts/src/index.js";
import type {
  BundleManifest as ProtocolBundleManifest,
  CoverageMode,
  OutboundManifest as ProtocolOutboundManifest,
  RetentionSourceDerivedClass,
  ReviewScope as ProtocolReviewScope,
  ReviewFindingDraftSet as ProtocolReviewFindingDraftSet,
  ScannerFindingSet as ProtocolScannerFindingSet,
  SignatureVerificationOutcome,
  VendorReceipt as ProtocolVendorReceipt,
  VerifiedArtifactSemanticIssue,
  VerifiedSubmissionChainIssue
} from "../../../packages/protocol-ts/src/index.js";
import type { NonEmptyArray } from "../../../packages/protocol-ts/src/index.js";

export const workspaceName = "@onevps/worker-service";
export const workspaceScope = "private-capable-worker-scaffold";

export type ScannerFindingSet = ProtocolScannerFindingSet;
export type BundleManifest = ProtocolBundleManifest;
export type OutboundManifest = ProtocolOutboundManifest;
export type ReviewScope = ProtocolReviewScope;
export type VendorReceipt = ProtocolVendorReceipt;
export type ReviewFindingDraftSet = ProtocolReviewFindingDraftSet;
export type ReviewFindingDraft = ReviewFindingDraftSet["review_finding_drafts"][number];
export type EvidenceAvailabilityState = ReviewFindingDraft["evidence_refs"][number]["availability_state"];
export type EvidenceDisplayState = ReviewFindingDraft["evidence_refs"][number]["display_state"];
export type EvidenceBasis = ReviewFindingDraft["evidence_basis"][number];
export type SourceReferenceState = ReviewFindingDraft["source_reference_state"];

export type ArtifactAvailability = {
  availability_state: EvidenceAvailabilityState;
  source_derived_class: RetentionSourceDerivedClass;
  deletion_evidence_ref?: string;
};

export type ArtifactAvailabilityLookup = Readonly<Record<string, ArtifactAvailability>>;

export type NormalizeCandidateFindingsInput = {
  normalization_run_id: string;
  created_at: string;
  review_scope: ReviewScope;
  scanner_finding_set: ScannerFindingSet;
  bundle_manifest: BundleManifest;
  outbound_manifest: OutboundManifest;
  vendor_receipt: VendorReceipt;
  // D3-2: the receipt's signature is authenticated by an independently
  // produced outcome, never by this pure workspace, which holds no key
  // material and performs no I/O; it is threaded straight through to
  // `verifiedSubmissionChainIssues`.
  vendor_receipt_signature_outcome: SignatureVerificationOutcome;
  artifact_availability?: ArtifactAvailabilityLookup;
};

export type NormalizeCandidateFindingsRejectionReason =
  | "normalization_input_not_object"
  | "normalization_metadata_invalid"
  | "normalization_receipt_absent"
  | "normalization_receipt_not_received"
  | "normalization_review_scope_schema_invalid"
  | "normalization_bundle_manifest_schema_invalid"
  | "normalization_outbound_manifest_schema_invalid"
  | "normalization_scanner_finding_set_schema_invalid"
  | "normalization_vendor_receipt_schema_invalid"
  | "normalization_receipt_bundle_mismatch"
  | "normalization_receipt_manifest_mismatch"
  | "normalization_receipt_coverage_mode_mismatch"
  | "normalization_receipt_attempt_mismatch"
  | "normalization_manifest_bundle_mismatch"
  | "normalization_scanner_finding_set_mismatch"
  | "normalization_bundle_manifest_identity_invalid"
  | "normalization_review_scope_identity_invalid"
  | "normalization_bundle_manifest_semantic_invalid"
  | "normalization_outbound_manifest_semantic_invalid"
  | "normalization_scanner_finding_set_semantic_invalid"
  | "normalization_receipt_unverified"
  | "normalization_review_scope_mismatch"
  | "normalization_disclosure_policy_mismatch"
  | "normalization_selected_application_mismatch"
  | "normalization_selected_commit_mismatch"
  | "normalization_repository_identity_mismatch"
  | "normalization_chronology_invalid"
  | "normalization_availability_invalid"
  | "normalization_candidate_provenance_unsafe"
  | "normalization_candidate_run_coverage_missing"
  | "normalization_scan_coverage_incomplete"
  | "normalization_output_schema_invalid";

const ARTIFACT_SEMANTIC_ISSUE_REASON: Record<VerifiedArtifactSemanticIssue, NormalizeCandidateFindingsRejectionReason> = {
  chain_review_scope_identity_mismatch: "normalization_review_scope_identity_invalid",
  chain_bundle_manifest_identity_mismatch: "normalization_bundle_manifest_identity_invalid",
  chain_bundle_manifest_semantic_invalid: "normalization_bundle_manifest_semantic_invalid",
  chain_outbound_manifest_semantic_invalid: "normalization_outbound_manifest_semantic_invalid",
  chain_scanner_finding_set_semantic_invalid: "normalization_scanner_finding_set_semantic_invalid"
};

const SUBMISSION_CHAIN_ISSUE_REASON: Record<VerifiedSubmissionChainIssue, NormalizeCandidateFindingsRejectionReason> = {
  chain_receipt_unverified: "normalization_receipt_unverified",
  chain_review_scope_mismatch: "normalization_review_scope_mismatch",
  chain_disclosure_policy_mismatch: "normalization_disclosure_policy_mismatch",
  chain_selected_application_mismatch: "normalization_selected_application_mismatch",
  chain_selected_commit_mismatch: "normalization_selected_commit_mismatch",
  chain_repository_identity_mismatch: "normalization_repository_identity_mismatch"
};

export type NormalizeCandidateFindingsResult =
  | { outcome: "normalized"; draft_set: ReviewFindingDraftSet }
  | { outcome: "rejected"; reason: NormalizeCandidateFindingsRejectionReason };

type CandidateFinding = ScannerFindingSet["candidate_findings"][number];

const NO_FINDINGS_STATEMENT = "No findings were produced by the configured inputs";
const NORMALIZATION_RUN_ID_PATTERN = /^normalization_run:[a-z0-9][a-z0-9_-]{2,63}$/;
const DELETION_EVIDENCE_REF_PATTERN = /^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$/;
const REVIEW_FINDING_DRAFT_UNAVAILABLE_STATES = new Set<EvidenceAvailabilityState>([
  "deleted_under_policy",
  "never_collected",
  "not_submitted_by_policy",
  "unresolved_reference"
]);
const REVIEW_FINDING_DRAFT_INSUFFICIENT_BASIS = new Set<EvidenceBasis>([
  "scanner_output",
  "metadata_only",
  "deleted_under_policy_reference",
  "not_submitted_by_policy_reference",
  "never_collected_reference",
  "unresolved_reference"
]);
type ScannerConfidence = NonNullable<ReviewFindingDraft["confidence"]>;

const CONFIDENCE_RANK = new Map<ScannerConfidence, number>([
  ["unknown", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3]
]);
const SEVERITY_RANK = new Map<string, number>([
  ["unknown", 0],
  ["note", 1],
  ["info", 1],
  ["informational", 1],
  ["low", 2],
  ["medium", 3],
  ["moderate", 3],
  ["warning", 3],
  ["warn", 3],
  ["error", 4],
  ["high", 4],
  ["critical", 5]
]);

/**
 * Pure normalization boundary: consumes already-received protocol artifacts and
 * emits protocol-backed Review Finding drafts. It performs no scanner execution,
 * filesystem access, network calls, database writes, receipt minting, or event-log
 * mutation. Scanner fields remain provenance only.
 */
export function normalizeCandidateFindings(input: unknown): NormalizeCandidateFindingsResult {
  // C5-45: sparse arrays, throwing accessors/proxies, and cycles cannot arrive
  // through ordinary JSON parsing, but a direct in-process JavaScript caller
  // could still hand one in. Guard the whole boundary so any such hostile
  // object graph still returns a stable rejection instead of throwing.
  try {
    return normalizeCandidateFindingsChecked(input);
  } catch {
    return { outcome: "rejected", reason: "normalization_input_not_object" };
  }
}

function normalizeCandidateFindingsChecked(input: unknown): NormalizeCandidateFindingsResult {
  if (!isNormalizationInput(input)) {
    return { outcome: "rejected", reason: "normalization_input_not_object" };
  }
  if (input.vendor_receipt === undefined || input.vendor_receipt === null) {
    return { outcome: "rejected", reason: "normalization_receipt_absent" };
  }
  if (input.vendor_receipt.verification_state !== "received_with_receipt") {
    return { outcome: "rejected", reason: "normalization_receipt_not_received" };
  }

  if (!hasValidNormalizationMetadata(input)) {
    return { outcome: "rejected", reason: "normalization_metadata_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:review-scope", input.review_scope).length > 0) {
    return { outcome: "rejected", reason: "normalization_review_scope_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:bundle-manifest", input.bundle_manifest).length > 0) {
    return { outcome: "rejected", reason: "normalization_bundle_manifest_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:outbound-manifest", input.outbound_manifest).length > 0) {
    return { outcome: "rejected", reason: "normalization_outbound_manifest_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:scanner-finding-set", input.scanner_finding_set).length > 0) {
    return { outcome: "rejected", reason: "normalization_scanner_finding_set_schema_invalid" };
  }
  if (validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", input.vendor_receipt).length > 0) {
    return { outcome: "rejected", reason: "normalization_vendor_receipt_schema_invalid" };
  }
  if (!isValidArtifactAvailabilityInput(input.artifact_availability)) {
    // C5-35/C5-36: a caller-controlled availability entry with an impossible
    // state/class/deletion-evidence tuple, or a non-own (prototype-inherited)
    // entry, must never reach classification.
    return { outcome: "rejected", reason: "normalization_availability_invalid" };
  }

  const artifactSemanticIssues = verifiedArtifactSemanticIssues(input);
  if (artifactSemanticIssues.length > 0) {
    return { outcome: "rejected", reason: ARTIFACT_SEMANTIC_ISSUE_REASON[artifactSemanticIssues[0] as VerifiedArtifactSemanticIssue] };
  }

  const receiptMismatch = validateReceiptBoundary(input);
  if (receiptMismatch !== undefined) {
    return { outcome: "rejected", reason: receiptMismatch };
  }

  const submissionChainIssues = verifiedSubmissionChainIssues(input);
  if (submissionChainIssues.length > 0) {
    return { outcome: "rejected", reason: SUBMISSION_CHAIN_ISSUE_REASON[submissionChainIssues[0] as VerifiedSubmissionChainIssue] };
  }

  // C5-31: normalization must not predate the scanner output or receipt it
  // normalizes -- only timestamp shape was checked before.
  if (
    compareUtcRfc3339Timestamps(input.scanner_finding_set.generated_at, input.vendor_receipt.receipt_timestamp) > 0 ||
    compareUtcRfc3339Timestamps(input.vendor_receipt.receipt_timestamp, input.created_at) > 0
  ) {
    return { outcome: "rejected", reason: "normalization_chronology_invalid" };
  }

  // C5-37: candidate provenance is free-form protocol text with no content
  // safety guard -- secret/token strings, code fragments, or PII embedded in
  // affected_area/scanner_rule_id/original_reference/severity must not reach
  // a retained review artifact.
  if (input.scanner_finding_set.candidate_findings.some((candidate) => candidateProvenanceUnsafeReason(candidate) !== undefined)) {
    return { outcome: "rejected", reason: "normalization_candidate_provenance_unsafe" };
  }

  // C5-39 (best-effort, using only existing protocol fields -- no
  // `scanner_run_ref` exists on candidates to resolve exactly): every
  // candidate's source and affected-file must be corroborated by at least
  // one *successful* scanner run covering that file. A candidate whose only
  // possible run is missing/failed/unavailable/invalid, or whose file never
  // appears in any successful run's scanned_files, is rejected.
  if (
    input.scanner_finding_set.candidate_findings.some(
      (candidate) => !candidateHasSuccessfulRunCoverage(input.scanner_finding_set, candidate)
    )
  ) {
    return { outcome: "rejected", reason: "normalization_candidate_run_coverage_missing" };
  }

  // C5-40: zero candidates because every run failed/was unavailable/invalid/
  // skipped must not be reported the same way as a completed clean scan --
  // reject rather than silently claim "no findings produced" when nothing
  // actually completed successfully over a nonempty file set.
  if (
    input.scanner_finding_set.candidate_findings.length === 0 &&
    !input.scanner_finding_set.scanner_runs.some((run) => COMPLETED_SCANNER_RUN_STATUSES.has(run.status) && run.scanned_files.length > 0)
  ) {
    return { outcome: "rejected", reason: "normalization_scan_coverage_incomplete" };
  }

  const draftSet = buildReviewFindingDraftSet(input);
  if (
    validateProtocolSchema("urn:codeattest:protocol:v0:review-finding-draft-set", draftSet).length > 0 ||
    !validateReviewFindingDraftSetOutputSemantics(draftSet)
  ) {
    return { outcome: "rejected", reason: "normalization_output_schema_invalid" };
  }
  return { outcome: "normalized", draft_set: draftSet };
}

// C5-37: narrow, shared claim-safety guards -- not a full secret scanner,
// but the same source/PII/code-shape detectors already trusted elsewhere in
// the protocol stack.
function candidateProvenanceUnsafeReason(candidate: CandidateFinding): string | undefined {
  for (const text of [candidate.affected_area, candidate.scanner_rule_id, candidate.original_reference, candidate.severity]) {
    if (typeof text !== "string") {
      continue;
    }
    if (sourceTextForbiddenPhrase(text) !== undefined || piiTextForbidden(text) !== undefined || sourceCodeLikeTextReason(text) !== undefined) {
      return "candidate_provenance_unsafe";
    }
  }
  return undefined;
}

const COMPLETED_SCANNER_RUN_STATUSES = new Set<ScannerFindingSet["scanner_runs"][number]["status"]>(["succeeded", "no_findings"]);

// C5-39: a run with status "no_findings" produced zero candidates by
// definition, so it cannot corroborate any candidate -- only "succeeded"
// runs count as coverage for an actual candidate.
function candidateHasSuccessfulRunCoverage(scannerFindingSet: ScannerFindingSet, candidate: CandidateFinding): boolean {
  const filePath = affectedAreaFilePath(candidate.affected_area);
  return scannerFindingSet.scanner_runs.some(
    (run) => run.status === "succeeded" && run.scanner_name === candidate.source && run.scanned_files.includes(filePath)
  );
}

// C5-38: filter (not reject) unsafe coverage-limitation text -- unlike
// candidate provenance, dropping a caveat string is safe-by-omission and
// does not create a false attestation.
function safeCoverageLimitations(scannerFindingSet: ScannerFindingSet): string[] {
  return scannerFindingSet.coverage_limitations.filter(
    (limitation) =>
      sourceTextForbiddenPhrase(limitation) === undefined &&
      piiTextForbidden(limitation) === undefined &&
      sourceCodeLikeTextReason(limitation) === undefined
  );
}

function isNormalizationInput(input: unknown): input is NormalizeCandidateFindingsInput {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function hasValidNormalizationMetadata(input: NormalizeCandidateFindingsInput): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(input, "review_id") &&
    NORMALIZATION_RUN_ID_PATTERN.test(input.normalization_run_id) &&
    // C5-31: the exact-nanosecond chronology check below throws on a value
    // that is lexically shaped but not a real calendar date, so this must
    // use the same calendar-validating parser, not a lexical-only pattern.
    isUtcRfc3339Timestamp(input.created_at)
  );
}

function validateReceiptBoundary(input: NormalizeCandidateFindingsInput): NormalizeCandidateFindingsRejectionReason | undefined {
  const { bundle_manifest, outbound_manifest, scanner_finding_set, vendor_receipt } = input;

  if (vendor_receipt.evidence_bundle_id !== bundle_manifest.evidence_bundle_id) {
    return "normalization_receipt_bundle_mismatch";
  }
  if (vendor_receipt.manifest_id !== bundle_manifest.manifest_id || vendor_receipt.manifest_id !== outbound_manifest.manifest_id) {
    return "normalization_receipt_manifest_mismatch";
  }
  if (bundle_manifest.manifest_id !== outbound_manifest.manifest_id || bundle_manifest.coverage_mode !== outbound_manifest.coverage_mode) {
    return "normalization_manifest_bundle_mismatch";
  }
  if (vendor_receipt.coverage_mode !== bundle_manifest.coverage_mode || vendor_receipt.coverage_mode !== outbound_manifest.coverage_mode) {
    return "normalization_receipt_coverage_mode_mismatch";
  }
  if (
    vendor_receipt.bundle_instance_id !== bundle_manifest.bundle_instance_id ||
    vendor_receipt.submission_attempt_id !== bundle_manifest.submission_attempt_id
  ) {
    return "normalization_receipt_attempt_mismatch";
  }
  if (
    bundle_manifest.scanner_finding_set_ref !== scanner_finding_set.scanner_finding_set_id ||
    outbound_manifest.scanner_finding_set_ref !== scanner_finding_set.scanner_finding_set_id
  ) {
    return "normalization_scanner_finding_set_mismatch";
  }
  return undefined;
}

function buildReviewFindingDraftSet(input: NormalizeCandidateFindingsInput): ReviewFindingDraftSet {
  const drafts = groupCandidateFindings(input).map(([groupKey, candidates]) => buildDraft(input, groupKey, candidates));
  const noFindings = drafts.length === 0;
  const baseLimitations = noFindings
    ? [
        `${NO_FINDINGS_STATEMENT}; this does not prove absence of vulnerabilities.`,
        "Configured inputs and coverage mode bound this statement to submitted scanner outputs only."
      ]
    : [
        "Review Finding drafts are normalized scanner output and retained evidence references only, not expert classifications.",
        "Scanner severity and confidence are preserved as scanner-provided metadata only."
      ];
  // C5-38: the source scanner-finding-set's own coverage limitations (unsupported
  // languages, failed scanners, skipped files, cap limits) used to be replaced
  // entirely by this generic copy -- no adapter downstream ever dereferenced the
  // source set to recover them. Project them (safety-filtered per C5-37) instead
  // of discarding them.
  const limitations = uniqueSorted([...baseLimitations, ...safeCoverageLimitations(input.scanner_finding_set)]);

  const draftSet: ReviewFindingDraftSet = {
    protocol_version: "codeattest.v0",
    review_id: input.review_scope.review_id,
    normalization_run_id: input.normalization_run_id,
    normalization_status: noFindings ? "no_findings_produced" : "drafts_created",
    created_at: input.created_at,
    vendor_receipt_ref: input.vendor_receipt.vendor_receipt_id,
    evidence_bundle_id: input.bundle_manifest.evidence_bundle_id,
    manifest_id: input.bundle_manifest.manifest_id,
    source_scanner_finding_set_ref: input.scanner_finding_set.scanner_finding_set_id,
    coverage_mode: input.bundle_manifest.coverage_mode,
    review_finding_drafts: drafts,
    normalization_limitations: limitations,
    source_derived_class: "retained_review_artifact"
  };

  if (noFindings) {
    draftSet.no_findings_statement = NO_FINDINGS_STATEMENT;
  }

  return draftSet;
}

function groupCandidateFindings(input: NormalizeCandidateFindingsInput): Array<[string, CandidateFinding[]]> {
  const groups = new Map<string, CandidateFinding[]>();
  const candidates = [...input.scanner_finding_set.candidate_findings].sort((left, right) =>
    compareCodeUnit(left.candidate_finding_id, right.candidate_finding_id)
  );

  for (const candidate of candidates) {
    const groupKey = groupKeyForCandidate(candidate);
    const group = groups.get(groupKey) ?? [];
    group.push(candidate);
    groups.set(groupKey, group);
  }

  return [...groups.entries()].sort(([left], [right]) => compareCodeUnit(left, right));
}

function groupKeyForCandidate(candidate: CandidateFinding): string {
  return JSON.stringify(["affected_area_path", normalizeAffectedArea(candidate.affected_area)]);
}

// C5-42: `affected_area` is protocol-opaque text, not a guaranteed
// `path:line:column` triple -- the worker may not assume the first colon
// ends a path. `C:\Users\demo\app.ts:10:5` (a Windows drive letter) and a
// POSIX name with an internal colon both need their real path preserved.
// Only a trailing numeric `:line` or `:line:column` suffix is stripped, from
// the right; everything before it (including internal colons) is kept.
const TRAILING_LINE_COLUMN_PATTERN = /:\d+(?::\d+)?$/;

function affectedAreaFilePath(affectedArea: string): string {
  const match = TRAILING_LINE_COLUMN_PATTERN.exec(affectedArea);
  return match === null ? affectedArea : affectedArea.slice(0, match.index);
}

function normalizeAffectedArea(affectedArea: string): string {
  const filePath = affectedAreaFilePath(affectedArea);
  return filePath.length > 0 ? filePath : affectedArea;
}

function buildDraft(input: NormalizeCandidateFindingsInput, groupKey: string, candidates: CandidateFinding[]): ReviewFindingDraft {
  const firstCandidate = candidates[0] as CandidateFinding;
  const evidenceRefs = evidenceRefsForDraft(input, candidates);
  const evidenceBasis = evidenceBasisForDraft(input.bundle_manifest.coverage_mode, evidenceRefs);
  const candidateFindingRefs = nonEmptyArray(candidates.map((candidate) => candidate.candidate_finding_id));
  const sources = nonEmptyArray(uniqueSorted(candidates.map((candidate) => candidate.source)));
  const scannerRuleIds = nonEmptyArray(uniqueSorted(candidates.map((candidate) => candidate.scanner_rule_id)));
  const draft: ReviewFindingDraft = {
    review_finding_draft_id: `review_finding_draft:${draftIdSlug(input.review_scope.review_id, input.normalization_run_id, groupKey, candidateFindingRefs)}`,
    candidate_finding_refs: candidateFindingRefs,
    group_key: groupKey,
    sources,
    affected_area: firstCandidate.affected_area,
    evidence_refs: evidenceRefs,
    scanner_rule_ids: scannerRuleIds,
    status: "draft",
    review_lifecycle_state: "under_review",
    coverage_mode: input.bundle_manifest.coverage_mode,
    evidence_basis: evidenceBasis,
    threshold_gaps: thresholdGapsForDraft(input.bundle_manifest.coverage_mode, evidenceBasis, evidenceRefs),
    source_reference_state: sourceReferenceStateForEvidenceRefs(evidenceRefs),
    source_derived_class: "retained_review_artifact"
  };

  const severity = highestScannerSeverity(candidates.map((candidate) => candidate.severity));
  if (severity !== undefined) {
    draft.severity = severity;
  }
  const confidence = highestScannerConfidence(candidates.map((candidate) => candidate.confidence));
  if (confidence !== undefined) {
    draft.confidence = confidence;
  }

  return draft;
}

// C5-44: canonical scanner-first evidence-ref ordering, matching the
// canonical fixtures and the order-sensitive downstream arrays in the
// control plane -- lexicographic sorting could disagree with them for
// semantically identical evidence sets.
function evidenceRefsForDraft(input: NormalizeCandidateFindingsInput, candidates: CandidateFinding[]): ReviewFindingDraft["evidence_refs"] {
  const availabilityLookup = artifactAvailabilityLookup(input.artifact_availability);
  const evidenceRefs = [evidenceRefForArtifact(availabilityLookup, "artifact_ref:scanner_finding_set")];

  const sourceRefs = uniqueSorted(candidates.flatMap((candidate) => candidate.source_artifact_refs));
  for (const sourceRef of sourceRefs) {
    const matches = input.bundle_manifest.artifact_references.filter((artifact) => artifact.artifact_ref === sourceRef);
    const resolvesToShippedSource =
      matches.length === 1 && (matches[0]?.artifact_type === "raw_snippet" || matches[0]?.artifact_type === "targeted_file");
    evidenceRefs.push(evidenceRefForArtifact(resolvesToShippedSource ? availabilityLookup : new Map(), sourceRef));
  }

  return evidenceRefs;
}

// C5-35: the full state/class/deletion-evidence contract every artifact
// availability entry must satisfy -- an impossible tuple (for example
// retained+available paired with never_collected's class, or a deletion
// evidence ref on a state that was never deleted) must never reach
// classification.
const AVAILABILITY_STATE_CONTRACT: Readonly<Record<EvidenceAvailabilityState, {
  displayState: EvidenceDisplayState;
  allowedSourceDerivedClasses: ReadonlySet<RetentionSourceDerivedClass>;
  deletionEvidenceRequired: boolean;
  deletionEvidenceAllowed: boolean;
}>> = {
  retained_review_artifact: {
    displayState: "available_reference",
    allowedSourceDerivedClasses: new Set(["retained_review_artifact", "transient_source_derived", "customer_opt_in_retained_source"]),
    deletionEvidenceRequired: false,
    deletionEvidenceAllowed: false
  },
  never_collected: {
    displayState: "not_collected",
    allowedSourceDerivedClasses: new Set(["never_collected"]),
    deletionEvidenceRequired: false,
    deletionEvidenceAllowed: false
  },
  not_submitted_by_policy: {
    displayState: "not_submitted",
    allowedSourceDerivedClasses: new Set(["never_collected"]),
    deletionEvidenceRequired: false,
    deletionEvidenceAllowed: false
  },
  deleted_under_policy: {
    displayState: "deleted",
    allowedSourceDerivedClasses: new Set(["transient_source_derived", "customer_opt_in_retained_source"]),
    deletionEvidenceRequired: true,
    deletionEvidenceAllowed: true
  },
  unresolved_reference: {
    displayState: "unresolved_reference",
    allowedSourceDerivedClasses: new Set(["never_collected", "retained_review_artifact", "transient_source_derived", "customer_opt_in_retained_source"]),
    deletionEvidenceRequired: false,
    deletionEvidenceAllowed: false
  }
};

function isValidArtifactAvailability(value: unknown): value is ArtifactAvailability {
  if (!isPlainRecord(value)) {
    return false;
  }
  const contract = isEvidenceAvailabilityState(value.availability_state) ? AVAILABILITY_STATE_CONTRACT[value.availability_state] : undefined;
  if (contract === undefined || !contract.allowedSourceDerivedClasses.has(value.source_derived_class as RetentionSourceDerivedClass)) {
    return false;
  }
  const deletionRef = value.deletion_evidence_ref;
  if (deletionRef !== undefined) {
    return contract.deletionEvidenceAllowed && typeof deletionRef === "string" && DELETION_EVIDENCE_REF_PATTERN.test(deletionRef);
  }
  return !contract.deletionEvidenceRequired;
}

function isEvidenceAvailabilityState(value: unknown): value is EvidenceAvailabilityState {
  return typeof value === "string" && Object.hasOwn(AVAILABILITY_STATE_CONTRACT, value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// C5-35/C5-36: every entry (if the input is present at all) must satisfy the
// full availability contract before normalization proceeds -- this runs
// once, up front, over the caller's own plain-JSON-shaped keys only.
function isValidArtifactAvailabilityInput(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isPlainRecord(value)) {
    return false;
  }
  return Object.keys(value).every((key) => isValidArtifactAvailability(value[key]));
}

// C5-36: builds an own-property-only snapshot from a caller object already
// confirmed valid by `isValidArtifactAvailabilityInput` -- `Object.keys`
// never returns inherited properties, and every value read here is read by
// a key that came from `Object.keys`, so a prototype-chain entry (for
// example `Object.create({...})` with no own keys) can never be seen. The
// returned `Map` is then the only thing callers may look up against;
// looking up an arbitrary caller-supplied string against the original
// object would reopen the same prototype-chain exposure.
function artifactAvailabilityLookup(value: ArtifactAvailabilityLookup | undefined): ReadonlyMap<string, ArtifactAvailability> {
  const snapshot = new Map<string, ArtifactAvailability>();
  if (!isPlainRecord(value)) {
    return snapshot;
  }
  for (const key of Object.keys(value)) {
    const candidate = value[key];
    if (isValidArtifactAvailability(candidate)) {
      snapshot.set(key, candidate);
    }
  }
  return snapshot;
}

function evidenceRefForArtifact(availabilityLookup: ReadonlyMap<string, ArtifactAvailability>, artifactRef: string): ReviewFindingDraft["evidence_refs"][number] {
  const availability = availabilityLookup.get(artifactRef) ?? {
    availability_state: "unresolved_reference",
    source_derived_class: "retained_review_artifact"
  } satisfies ArtifactAvailability;

  const evidenceRef: ReviewFindingDraft["evidence_refs"][number] = {
    artifact_ref: artifactRef,
    availability_state: availability.availability_state,
    available_for_review: availability.availability_state === "retained_review_artifact",
    display_state: AVAILABILITY_STATE_CONTRACT[availability.availability_state].displayState,
    source_derived_class: availability.source_derived_class
  };

  if (availability.deletion_evidence_ref !== undefined) {
    evidenceRef.deletion_evidence_ref = availability.deletion_evidence_ref;
  }

  return evidenceRef;
}

// C5-34/C5-43: a positive coverage-mode evidence basis (finding_context_snippet /
// extended_approved_source_context) is a claim that actual source content is
// available and was used -- it must only be added when the source evidence
// ref (not the ever-present scanner-finding-set provenance ref) is actually
// available. `metadata_only` is a fact about the coverage mode itself, not a
// content-availability claim, so it stays unconditional. Likewise
// `retained_review_artifact` corroborating basis must never be derived from
// the scanner-set provenance ref alone.
function evidenceBasisForDraft(coverageMode: CoverageMode, evidenceRefs: ReviewFindingDraft["evidence_refs"]): NonEmptyArray<EvidenceBasis> {
  const basis: EvidenceBasis[] = ["scanner_output"];
  const sourceRef = evidenceRefs.find((ref) => ref.artifact_ref !== "artifact_ref:scanner_finding_set");

  if (coverageMode === "metadata_only") {
    basis.push("metadata_only");
  } else if (sourceRef?.availability_state === "retained_review_artifact") {
    basis.push(coverageMode === "finding_context_snippets" ? "finding_context_snippet" : "extended_approved_source_context");
  }

  for (const ref of evidenceRefs) {
    const isProvenanceOnly = ref.artifact_ref === "artifact_ref:scanner_finding_set";
    if (ref.availability_state === "retained_review_artifact") {
      if (!isProvenanceOnly) {
        basis.push("retained_review_artifact");
      }
    } else if (ref.availability_state === "deleted_under_policy") {
      basis.push("deleted_under_policy_reference");
    } else if (ref.availability_state === "not_submitted_by_policy") {
      basis.push("not_submitted_by_policy_reference");
    } else if (ref.availability_state === "never_collected") {
      basis.push("never_collected_reference");
    } else if (ref.availability_state === "unresolved_reference") {
      basis.push("unresolved_reference");
    }
  }

  return nonEmptyArray(uniqueSorted(basis));
}

function thresholdGapsForDraft(
  coverageMode: CoverageMode,
  evidenceBasis: EvidenceBasis[],
  evidenceRefs: ReviewFindingDraft["evidence_refs"]
): string[] {
  const gaps: string[] = [];
  if (coverageMode === "metadata_only") {
    gaps.push("Metadata-only coverage cannot confirm a finding without customer-approved source or runtime context.");
  } else if (coverageMode === "finding_context_snippets") {
    gaps.push("Finding-context snippets are bounded and may omit broader runtime or architectural context needed for confirmation.");
  } else {
    gaps.push("Extended approved context is available, but normalization still requires reviewer judgment before classification.");
  }

  if (evidenceBasis.includes("scanner_output")) {
    gaps.push("Scanner output is provenance only and requires reviewer confirmation before classification.");
  }
  if (evidenceRefs.some((ref) => ref.availability_state === "deleted_under_policy")) {
    gaps.push("Source-derived evidence was deleted under policy; retained references and deletion evidence are available instead of content.");
  }
  if (evidenceRefs.some((ref) => ref.availability_state === "not_submitted_by_policy" || ref.availability_state === "never_collected")) {
    gaps.push("Some source-derived context was not submitted or collected under policy.");
  }
  if (evidenceRefs.some((ref) => ref.availability_state === "unresolved_reference")) {
    gaps.push("At least one evidence reference is unresolved and cannot be reviewed as available content.");
  }
  return uniqueSorted(gaps);
}

function validateReviewFindingDraftSetOutputSemantics(draftSet: ReviewFindingDraftSet): boolean {
  if (draftSet.source_derived_class !== "retained_review_artifact") {
    return false;
  }
  if (draftSet.normalization_status === "no_findings_produced") {
    if (draftSet.review_finding_drafts.length !== 0 || draftSet.no_findings_statement !== NO_FINDINGS_STATEMENT) {
      return false;
    }
    if (!draftSet.normalization_limitations.join(" ").toLowerCase().includes("does not prove absence of vulnerabilities")) {
      return false;
    }
  }
  if (draftSet.normalization_status === "drafts_created" && draftSet.review_finding_drafts.length === 0) {
    return false;
  }

  const draftIds = new Set<string>();
  for (const draft of draftSet.review_finding_drafts) {
    if (draftIds.has(draft.review_finding_draft_id)) {
      return false;
    }
    draftIds.add(draft.review_finding_draft_id);
    if (!validateReviewFindingDraftOutputSemantics(draft, draftSet.coverage_mode)) {
      return false;
    }
  }
  return true;
}

function validateReviewFindingDraftOutputSemantics(draft: ReviewFindingDraft, coverageMode: CoverageMode): boolean {
  if (draft.status !== "draft" || draft.review_lifecycle_state !== "under_review") {
    return false;
  }
  if (draft.coverage_mode !== coverageMode || draft.candidate_finding_refs.length === 0) {
    return false;
  }
  if (draft.evidence_basis.some((basis) => REVIEW_FINDING_DRAFT_INSUFFICIENT_BASIS.has(basis)) && draft.threshold_gaps.length === 0) {
    return false;
  }
  if (draft.source_reference_state !== sourceReferenceStateForEvidenceRefs(draft.evidence_refs)) {
    return false;
  }
  for (const evidenceRef of draft.evidence_refs) {
    if (REVIEW_FINDING_DRAFT_UNAVAILABLE_STATES.has(evidenceRef.availability_state) && evidenceRef.available_for_review) {
      return false;
    }
    if (
      evidenceRef.availability_state === "deleted_under_policy" &&
      (evidenceRef.display_state !== "deleted" || typeof evidenceRef.deletion_evidence_ref !== "string")
    ) {
      return false;
    }
  }
  return true;
}

function sourceReferenceStateForEvidenceRefs(evidenceRefs: ReviewFindingDraft["evidence_refs"]): SourceReferenceState {
  const sourceRefs = evidenceRefs.filter((ref) => ref.artifact_ref !== "artifact_ref:scanner_finding_set");
  if (sourceRefs.length === 0) {
    return "unresolved_reference";
  }
  const priority: SourceReferenceState[] = [
    "unresolved_reference",
    "deleted_under_policy",
    "not_submitted_by_policy",
    "never_collected",
    "retained_review_artifact"
  ];
  for (const state of priority) {
    if (sourceRefs.some((ref) => ref.availability_state === state)) {
      return state;
    }
  }
  return "unresolved_reference";
}

function highestScannerSeverity(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => value !== undefined).sort(compareSeverity).at(0);
}

function compareSeverity(left: string, right: string): number {
  const rankDifference = (SEVERITY_RANK.get(right.toLowerCase()) ?? 0) - (SEVERITY_RANK.get(left.toLowerCase()) ?? 0);
  return rankDifference === 0 ? compareCodeUnit(left, right) : rankDifference;
}

function highestScannerConfidence(values: Array<ReviewFindingDraft["confidence"] | undefined>): ReviewFindingDraft["confidence"] | undefined {
  return values.filter((value): value is ScannerConfidence => value !== undefined).sort(compareConfidence).at(0);
}

function compareConfidence(left: ScannerConfidence, right: ScannerConfidence): number {
  const rankDifference = (CONFIDENCE_RANK.get(right) ?? 0) - (CONFIDENCE_RANK.get(left) ?? 0);
  return rankDifference === 0 ? compareCodeUnit(left, right) : rankDifference;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort(compareCodeUnit);
}

function nonEmptyArray<T>(values: T[]): NonEmptyArray<T> {
  if (values.length === 0) {
    throw new Error("expected non-empty normalized review finding draft field");
  }
  return values as NonEmptyArray<T>;
}

function compareCodeUnit(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

// C5-41: derived from a canonical content hash over the tuple that actually
// identifies a draft group, not truncated run-id text plus ordinal
// position -- a truncated long run id could collide with another, and an
// ordinal suffix renumbered every unchanged draft whenever an unrelated
// earlier-sorting group was inserted. The hash is exactly 64 hex characters,
// which fits the `[a-z0-9][a-z0-9_-]{2,63}` id pattern's maximum length.
function draftIdSlug(reviewId: string, normalizationRunId: string, groupKey: string, candidateFindingRefs: readonly string[]): string {
  const identityInput = {
    review_id: reviewId,
    normalization_run_id: normalizationRunId,
    group_key: groupKey,
    candidate_finding_refs: [...candidateFindingRefs].sort(compareCodeUnit)
  };
  return computeCanonicalSha256Id(identityInput).slice("sha256:".length);
}
