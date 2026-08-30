import canonicalizeJson from "canonicalize";
import {
  bundleManifestCleanupSemanticIssues,
  compareUtcRfc3339Timestamps,
  customerApprovalSemanticIssues,
  disclosurePolicySemanticIssues,
  outboundManifestSemanticIssues,
  recomputeExcludedFieldIdentity,
  scannerFindingSetSemanticIssues,
  sha256ProtocolText,
  submissionIdentityValueMatchesGrammar,
  validateProtocolSchema,
  verifyVendorReceiptRecordSync
} from "../../../packages/protocol-ts/src/index.js";
import type {
  ArtifactReference as ProtocolArtifactReference,
  BundleManifest as ProtocolBundleManifest,
  CustomerApproval as ProtocolCustomerApproval,
  EnvironmentEvidenceGate as ProtocolEnvironmentEvidenceGate,
  IdentitySigningInput as ProtocolIdentitySigningInput,
  OutboundManifest as ProtocolOutboundManifest,
  ProtocolVersion as GeneratedProtocolVersion,
  SignatureEnvelope as ProtocolSignatureEnvelope,
  SignatureVerificationOutcome,
  SubmissionOutcome as ProtocolSubmissionOutcome,
  VendorReceipt as ProtocolVendorReceipt,
  VendorReceiptVerificationOptions,
  NonEmptyArray
} from "../../../packages/protocol-ts/src/index.js";

export const workspaceName = "@onevps/intake-service";
export const workspaceScope = "private-capable-intake-scaffold";

const ACCEPTED_PROTOCOL_VERSION: GeneratedProtocolVersion = "codeattest.v0";
// D2-2: `algorithm_profile` must never be set independently of `signing_mode`
// -- the two are the same fact told twice, and this is the single place that
// derivation happens.
const RECEIPT_ALGORITHM_PROFILE = {
  managed_key: "ml_dsa_65"
} as const;
const REQUIRED_SYNTHETIC_MARKERS = ["SYNTHETIC_DEMO_DATA", "NOT_CUSTOMER_SOURCE"] as const;
// AD-7 / Story 2.7: intake must be unconditionally disabled at or above 95% of the demo budget ceiling.
const DEMO_BUDGET_INTAKE_DISABLE_THRESHOLD = 0.95;

// C5-07: `environment_evidence_gate` arrived as an ordinary field of the
// untrusted request DTO with no authenticated binding to real deployment
// configuration -- a caller could assert `partner_pilot_real_snippet_ready`
// with every readiness flag `true` while nothing outside the request itself
// vouched for that claim. Sub-project G adds the protocol-owned readiness
// decision reference, but this pure tier still cannot authenticate a persisted
// gate version or fetch the referenced decision. Instead, the submitted gate
// must canonically equal one of a
// small, hard-coded set of trusted configurations -- the same two
// configurations already published as `environment-evidence-gate.synthetic-
// demo.json` / `environment-evidence-gate.real-snippet-ready.json` -- so a
// caller can select a known-good gate but can never mint a new one by
// picking its own combination of booleans. `partner_pilot_candidate` has no
// published trusted configuration and is therefore never accepted.
const TRUSTED_ENVIRONMENT_EVIDENCE_GATES: ReadonlyMap<EnvironmentEvidenceGate["environment_profile"], Omit<EnvironmentEvidenceGate, "notes">> = new Map([
  [
    "synthetic_demo",
    {
      protocol_version: ACCEPTED_PROTOCOL_VERSION,
      environment_profile: "synthetic_demo",
      allowed_source_derived_classes: ["never_collected", "retained_review_artifact", "transient_source_derived"],
      real_raw_snippet_acceptance: false,
      real_targeted_file_acceptance: false,
      access_control_ready: false,
      access_logging_ready: false,
      encryption_at_rest_ready: false,
      retention_defaults_ready: false,
      deletion_controls_ready: false,
      demo_budget_gate_ready: true,
      signing_release_trust_ready: false,
      retention_period_required: false,
      evidence_boundary: "synthetic-demo-only"
    }
  ],
  [
    "partner_pilot_real_snippet_ready",
    {
      protocol_version: ACCEPTED_PROTOCOL_VERSION,
      environment_profile: "partner_pilot_real_snippet_ready",
      allowed_source_derived_classes: ["never_collected", "retained_review_artifact", "transient_source_derived", "customer_opt_in_retained_source"],
      real_raw_snippet_acceptance: true,
      real_targeted_file_acceptance: true,
      access_control_ready: true,
      access_logging_ready: true,
      encryption_at_rest_ready: true,
      retention_defaults_ready: true,
      deletion_controls_ready: true,
      demo_budget_gate_ready: true,
      signing_release_trust_ready: true,
      retention_period_required: true,
      evidence_boundary: "partner-pilot-real-snippet-ready",
      readiness_decision_ref: "sha256:8aa3c2ec6cf635126083b9b643d51e12f405ef4ec8e993e6e1c7b95c092c31ce"
    }
  ]
]);

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const commitShaPattern = /^[a-f0-9]{40}$/;
const UTC_RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/;
const ARTIFACT_COUNT_CATEGORIES = [
  "metadata",
  "dependencies",
  "scanner_findings",
  "raw_snippets",
  "targeted_files",
  "derived_artifacts",
  "never_collected_items"
] as const;

// C5-09/C5-11: maps each `artifact_type` to its evidence category, used to
// look up which artifact type physically backs a given category below.
// (`manifest_entry_ref` is deliberately NOT part of this mapping -- it is a
// protocol-schema-pattern-only field, and an existing, deliberate test
// (`testDecisionResolvedProtocolAuthority`) requires intake to accept any
// protocol-valid `manifest_entry_ref` rather than reject it against a
// private intake-side classifier, so `artifact_type` is the only field this
// mapping may validate against.)
const ARTIFACT_TYPE_CATEGORY: Readonly<Record<ArtifactReference["artifact_type"], (typeof ARTIFACT_COUNT_CATEGORIES)[number]>> = {
  review_scope: "metadata",
  dependency_manifest: "dependencies",
  scanner_finding_set: "scanner_findings",
  scanner_raw_output: "derived_artifacts",
  raw_snippet: "raw_snippets",
  targeted_file: "targeted_files",
  outbound_manifest: "derived_artifacts",
  customer_approval: "derived_artifacts",
  bundle_manifest: "derived_artifacts",
  disclosure_policy: "derived_artifacts",
  signature_envelope: "derived_artifacts"
};

// C5-09: intake never reconciled evidence-category inclusion with the
// *physical* bundle -- both the approved and "received" summaries came from
// outbound-manifest assertions compared only to each other, so a bundle
// could ship an unapproved Raw Snippet (or omit an approved one) while both
// manifests kept agreeing with each other. Scoped to the four categories
// with an unambiguous 1:1 artifact-type mapping in this protocol's own
// fixture convention (see `ARTIFACT_TYPE_CATEGORY`); `dependencies` is
// legitimately represented as data embedded inside the `review_scope`
// artifact rather than a standalone artifact reference in the reference
// fixture corpus, and `derived_artifacts`/`never_collected_items` are
// aggregate/negative categories with no single corresponding artifact type,
// so a physical-presence check cannot be defined for them without guessing
// at semantics the fixture corpus does not establish.
const PHYSICALLY_RECONCILABLE_CATEGORIES: ReadonlySet<(typeof ARTIFACT_COUNT_CATEGORIES)[number]> = new Set(["metadata", "scanner_findings", "raw_snippets", "targeted_files"]);

export type ProtocolVersion = GeneratedProtocolVersion;
export type IntakeResultState = "verified_receipt_eligible" | "rejected_no_receipt" | "quarantined_no_receipt";
export type NextPathHint = "retry" | "quarantine_support" | "contact_support";
export type ArtifactBytes = string | Uint8Array | ArrayBuffer;

export type SelectedApplication = {
  application_id: string;
  display_name: string;
};

export type SelectedCommit = {
  commit_sha: string;
  source_control_system: "git";
};

export type ToolVersion = {
  tool_name: string;
  tool_version: string;
};

export type ArtifactReference = ProtocolArtifactReference;
export type BundleManifest = ProtocolBundleManifest;
export type OutboundManifest = ProtocolOutboundManifest;
export type CustomerApproval = ProtocolCustomerApproval;
export type SignatureEnvelope = ProtocolSignatureEnvelope;
export type EnvironmentEvidenceGate = ProtocolEnvironmentEvidenceGate;

export type AuthenticatedSubmissionContext = {
  customer_id: string;
  review_request_id: string;
  selected_application_id: string;
  selected_commit: string;
  repository_identity_hash: string;
};

export type SubmissionToken = {
  token_key_id: string;
  token_secret_material: string;
};

export type SubmissionTokenExpectation = {
  customer_id: string;
  review_request_id: string;
  selected_application_id: string;
  selected_commit: string;
  repository_identity_hash: string;
  expected_manifest_id: string;
  expected_evidence_bundle_id?: string;
  token_key_id: string;
  token_secret_material: string;
};

export type DemoBudgetEnforcement = {
  spend_ratio: number;
};

export type IntakeVerificationRequest = {
  submitted_bundle_manifest: BundleManifest;
  signature_envelope: SignatureEnvelope;
  artifact_bytes_by_ref: Record<string, ArtifactBytes>;
  customer_approval: CustomerApproval;
  approved_outbound_manifest: OutboundManifest;
  environment_evidence_gate: EnvironmentEvidenceGate;
  authenticated_context: AuthenticatedSubmissionContext;
  submission_token: SubmissionToken;
  submission_token_expectation: SubmissionTokenExpectation;
  demo_budget_enforcement: DemoBudgetEnforcement;
  signature_verification_outcome: SignatureVerificationOutcome;
};

export type IntakeRecordProjection = {
  projection_state: "verified_receipt_eligible";
  approved_outbound_manifest_ref: string;
  manifest_id: string;
  evidence_bundle_id: string;
  selected_application: SelectedApplication;
  selected_commit: SelectedCommit;
  repository_identity_hash: string;
  disclosure_policy_ref: string;
  disclosure_policy_summary: OutboundManifest["disclosure_policy_summary"];
  coverage_mode: OutboundManifest["coverage_mode"];
  runner: {
    name: string;
    version: string;
  };
  tool_versions: ToolVersion[];
  bundle_instance_id: string;
  submission_attempt_id: string;
};

export type AffectedIdentity = {
  manifest_id?: string;
  evidence_bundle_id?: string;
  review_request_id?: string;
};

export type VerifiedIntakeResult = {
  state: "verified_receipt_eligible";
  reason_codes: [];
  verification_summary: "verification_passed_receipt_eligible";
  intake_record: IntakeRecordProjection;
  next_path: "generate_receipt_in_story_2_3";
};

export type FailedIntakeResult = {
  state: "rejected_no_receipt" | "quarantined_no_receipt";
  reason_codes: string[];
  affected_identity?: AffectedIdentity;
  next_path: NextPathHint;
};

export type IntakeVerificationResult = VerifiedIntakeResult | FailedIntakeResult;

type VerificationDisposition = "reject" | "quarantine";

type VerificationIssue = {
  code: string;
  disposition: VerificationDisposition;
};

export type VendorReceipt = ProtocolVendorReceipt;

export type VendorReceiptIdentityInput = Omit<VendorReceipt, "vendor_receipt_id" | "receipt_signature" | "public_verification_metadata"> & {
  public_verification_metadata: Omit<VendorReceipt["public_verification_metadata"], "signed_identity">;
};

export type ArtifactCountCategory = {
  category: "metadata" | "dependencies" | "scanner_findings" | "raw_snippets" | "targeted_files" | "derived_artifacts" | "never_collected_items";
  count: number;
};

export type ArtifactCountSummary = {
  count_domain: "evidence_category_counts";
  total_count: number;
  categories: NonEmptyArray<ArtifactCountCategory>;
};

export type ReceiptSigningRequest = {
  key_id?: string;
  key_version?: string;
  signing_mode?: string;
  canonicalization?: string;
  public_key_reference?: string;
  signing_limitations?: NonEmptyArray<string>;
};

type ValidatedReceiptSigning = {
  key_id: string;
  key_version: string;
  signing_mode: "managed_key";
  canonicalization: "rfc8785";
  public_key_reference: string;
  signing_limitations: NonEmptyArray<string>;
};

type ReceiptPreflightResult = {
  issues: string[];
  signing: ValidatedReceiptSigning | undefined;
  artifactCountSummary: ArtifactCountSummary | undefined;
};

export type ReceivingEnvironment = {
  environment_profile: "synthetic_demo" | "partner_pilot_candidate" | "partner_pilot_real_snippet_ready";
  evidence_boundary: string;
};

// C5-02: the original two-phase shape (`verified_intake_result` plus a
// second, independently caller-supplied copy of the manifests/approval/
// bundle/bytes) let a caller mint a receipt from a forged "verified" object
// that never went through `verifyIntakeSubmission`, or from a legitimately
// verified result whose backing objects were mutated afterward. There is now
// exactly one source of truth: the original, untrusted intake request.
// `generateVendorReceipt` re-verifies it from a fresh clone every time.
// C5-16: `receiving_environment` is no longer a separate caller-supplied
// field -- it is derived from `intake_verification_request.environment_evidence_gate`,
// which C5-07 already pins to a trusted configuration.
export type VendorReceiptGenerationRequest = {
  intake_verification_request: IntakeVerificationRequest;
  receipt_timestamp: string;
  signing: ReceiptSigningRequest;
  approved_artifact_count_summary?: ArtifactCountSummary;
  received_artifact_count_summary?: ArtifactCountSummary;
};

export type CopyableIdentifier = {
  label: string;
  value: string;
};

export type ReceiptSummaryProjection = {
  plain_language_summary: string;
  copyable_identifiers: CopyableIdentifier[];
  technical_details: CopyableIdentifier[];
  accessibility: {
    role: "status";
    aria_live: "polite";
    min_target_size_px: 44;
  };
};

export type ReceiptSuccessResult = {
  state: "received_with_receipt";
  reason_codes: [];
  vendor_receipt: VendorReceipt;
  receipt_signature: SignatureEnvelope;
  approved_vs_received_comparison: VendorReceipt["approved_vs_received_comparison"];
  receipt_summary: ReceiptSummaryProjection;
  public_verification_metadata: VendorReceipt["public_verification_metadata"];
  next_path: "begin_review_history_in_story_2_4";
};

export type ReceiptNoReceiptResult = {
  state: "rejected_no_receipt" | "quarantined_no_receipt";
  reason_codes: string[];
  affected_identity?: AffectedIdentity;
  next_path: NextPathHint;
};

export type VendorReceiptGenerationResult = ReceiptSuccessResult | ReceiptNoReceiptResult;

export type VendorReceiptVerificationResult = {
  state: "receipt_verified" | "failed_verification";
  reason_codes: string[];
};

// D2-2: minting used to compute the identity and sign it in one
// uninterruptible pass. Real signing happens outside this pure module, so
// minting is split: `prepareVendorReceipt` computes the identity and hands
// back exactly what a signer needs (and nothing a signer could use to
// change what was verified); the caller signs; `completeVendorReceipt`
// binds the resulting envelope, re-validates, and finishes.
export type PreparedVendorReceipt = {
  state: "receipt_signing_required";
  vendor_receipt_id: string;
  signing_input: ProtocolIdentitySigningInput;
  unsigned_receipt: Omit<VendorReceipt, "receipt_signature">;
  approved_vs_received_comparison: VendorReceipt["approved_vs_received_comparison"];
};

export async function prepareVendorReceipt(request: unknown): Promise<PreparedVendorReceipt | ReceiptNoReceiptResult> {
  const snapshot = cloneReceiptGenerationRequest(request);
  if (snapshot === undefined) {
    return { state: "rejected_no_receipt", reason_codes: ["receipt_schema_validation_failed"], next_path: "retry" };
  }

  const intakeRequest = snapshot.intake_verification_request;
  const verified = await verifyIntakeSubmission(intakeRequest);
  if (verified.state !== "verified_receipt_eligible") {
    return noReceiptResult(
      verified.state,
      ["intake_not_receipt_eligible", ...verified.reason_codes],
      verified.affected_identity ?? {},
      verified.state === "quarantined_no_receipt" ? "quarantine_support" : verified.next_path === "contact_support" ? "contact_support" : "retry"
    );
  }

  const intakeRecord = verified.intake_record;
  const verifiedAffectedIdentity: AffectedIdentity = { manifest_id: intakeRecord.manifest_id, evidence_bundle_id: intakeRecord.evidence_bundle_id };

  const preflight = validateReceiptPreflight(snapshot, intakeRequest);
  if (preflight.issues.length > 0 || preflight.signing === undefined || preflight.artifactCountSummary === undefined) {
    return noReceiptResult("rejected_no_receipt", preflight.issues.length > 0 ? preflight.issues : ["receipt_schema_validation_failed"], verifiedAffectedIdentity, "retry");
  }

  const artifactCountSummary = preflight.artifactCountSummary;
  const signing = preflight.signing;
  // C5-16: derived exclusively from the trusted gate the request was just
  // verified against -- never a separate caller-supplied projection.
  const receivingEnvironment: ReceivingEnvironment = {
    environment_profile: intakeRequest.environment_evidence_gate.environment_profile,
    evidence_boundary: intakeRequest.environment_evidence_gate.evidence_boundary
  };
  const comparison = buildComparison(intakeRecord, artifactCountSummary);
  const publicMetadataWithoutIdentity = {
    protocol_version: ACCEPTED_PROTOCOL_VERSION,
    algorithm_profile: RECEIPT_ALGORITHM_PROFILE[signing.signing_mode],
    canonicalization: "rfc8785",
    key_id: signing.key_id,
    key_version: signing.key_version,
    public_key_reference: signing.public_key_reference,
    signing_time: snapshot.receipt_timestamp,
    signed_identity_type: "vendor_receipt",
    signing_mode: signing.signing_mode,
    signing_limitations: signing.signing_limitations
  } as const;

  const receiptIdentityInput: VendorReceiptIdentityInput = {
    protocol_version: ACCEPTED_PROTOCOL_VERSION,
    evidence_bundle_id: intakeRecord.evidence_bundle_id,
    manifest_id: intakeRecord.manifest_id,
    receipt_timestamp: snapshot.receipt_timestamp,
    receiving_environment: receivingEnvironment,
    verification_state: "received_with_receipt",
    canonicalization: "rfc8785",
    identity_hash_algorithm: "sha256",
    identity_input_excludes: ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"],
    source_derived_class: "retained_review_artifact",
    approved_outbound_manifest_ref: intakeRecord.approved_outbound_manifest_ref,
    bundle_instance_id: intakeRecord.bundle_instance_id,
    submission_attempt_id: intakeRecord.submission_attempt_id,
    selected_application: intakeRecord.selected_application,
    selected_commit: intakeRecord.selected_commit,
    repository_identity_hash: intakeRecord.repository_identity_hash,
    coverage_mode: intakeRecord.coverage_mode,
    disclosure_policy_ref: intakeRecord.disclosure_policy_ref,
    disclosure_policy_summary: intakeRecord.disclosure_policy_summary,
    approved_artifact_count_summary: artifactCountSummary,
    received_artifact_count_summary: artifactCountSummary,
    approved_vs_received_comparison: comparison,
    public_verification_metadata: publicMetadataWithoutIdentity,
    key_rotation_readiness: {
      historical_key_id: signing.key_id,
      historical_key_version: signing.key_version,
      event_append_hint: "future_story_2_4_append_key_rotation_event_without_rewriting_receipt"
    }
  };
  const vendorReceiptId = await identityFromCanonicalObject(receiptIdentityInput);
  return {
    state: "receipt_signing_required",
    vendor_receipt_id: vendorReceiptId,
    signing_input: {
      protocol_version: ACCEPTED_PROTOCOL_VERSION,
      signing_input_type: "vendor_receipt_identity",
      algorithm_profile: RECEIPT_ALGORITHM_PROFILE[signing.signing_mode],
      signed_identity_type: "vendor_receipt",
      signed_identity: vendorReceiptId,
      canonicalization: "rfc8785",
      identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
    },
    unsigned_receipt: {
      vendor_receipt_id: vendorReceiptId,
      ...receiptIdentityInput,
      public_verification_metadata: { ...publicMetadataWithoutIdentity, signed_identity: vendorReceiptId }
    },
    approved_vs_received_comparison: comparison
  };
}

export async function completeVendorReceipt(
  prepared: PreparedVendorReceipt,
  receiptSignature: SignatureEnvelope,
  signatureVerificationOutcome: SignatureVerificationOutcome
): Promise<ReceiptSuccessResult | ReceiptNoReceiptResult> {
  const metadata = prepared.unsigned_receipt.public_verification_metadata;
  const affected: AffectedIdentity = { evidence_bundle_id: prepared.unsigned_receipt.evidence_bundle_id, manifest_id: prepared.unsigned_receipt.manifest_id };
  if (receiptSignature.signed_identity !== prepared.vendor_receipt_id || receiptSignature.signed_identity_type !== "vendor_receipt") {
    return noReceiptResult("rejected_no_receipt", ["receipt_signature_identity_mismatch"], affected, "retry");
  }
  if (receiptSignature.key_id !== metadata.key_id || receiptSignature.key_version !== metadata.key_version || receiptSignature.signing_mode !== metadata.signing_mode || receiptSignature.algorithm_profile !== metadata.algorithm_profile || receiptSignature.signing_time !== prepared.unsigned_receipt.receipt_timestamp) {
    return noReceiptResult("rejected_no_receipt", ["receipt_signature_key_mismatch"], affected, "retry");
  }
  const vendorReceipt: VendorReceipt = { ...prepared.unsigned_receipt, receipt_signature: receiptSignature };
  const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:vendor-receipt", vendorReceipt);
  if (schemaErrors.length > 0) {
    return noReceiptResult("rejected_no_receipt", ["receipt_schema_validation_failed"], affected, "retry");
  }
  const verification = await verifyVendorReceiptRecord(vendorReceipt, { signature_verification_outcome: signatureVerificationOutcome });
  if (verification.state !== "receipt_verified") {
    return noReceiptResult("rejected_no_receipt", verification.reason_codes, affected, "retry");
  }
  return {
    state: "received_with_receipt",
    reason_codes: [],
    vendor_receipt: vendorReceipt,
    receipt_signature: receiptSignature,
    approved_vs_received_comparison: prepared.approved_vs_received_comparison,
    receipt_summary: buildReceiptSummary(vendorReceipt),
    public_verification_metadata: vendorReceipt.public_verification_metadata,
    next_path: "begin_review_history_in_story_2_4"
  };
}

// C5-02: snapshot the complete request -- including binary artifact bytes,
// which a plain JSON round-trip would corrupt -- before the first `await`,
// so nothing the caller does to its own object after calling this function
// can influence verification or minting. Rejects non-plain/uncloneable input
// as `undefined` rather than throwing.
function cloneReceiptGenerationRequest(request: unknown): VendorReceiptGenerationRequest | undefined {
  if (!isRecord(request) || !isRecord(request.intake_verification_request)) {
    return undefined;
  }
  const intakeRequest = request.intake_verification_request;
  if (!isRecord(intakeRequest.artifact_bytes_by_ref)) {
    return undefined;
  }
  const clonedBytesByRef: Record<string, ArtifactBytes> = {};
  for (const [ref, bytes] of Object.entries(intakeRequest.artifact_bytes_by_ref)) {
    if (!isArtifactBytes(bytes)) {
      return undefined;
    }
    clonedBytesByRef[ref] = cloneArtifactBytes(bytes);
  }
  try {
    const intakeRequestWithoutBytes: Record<string, unknown> = { ...intakeRequest };
    delete intakeRequestWithoutBytes.artifact_bytes_by_ref;
    const clonedIntakeRequest = cloneJsonObject(intakeRequestWithoutBytes) as unknown as IntakeVerificationRequest;
    (clonedIntakeRequest as unknown as Record<string, unknown>).artifact_bytes_by_ref = clonedBytesByRef;

    const requestWithoutIntakeRequest: Record<string, unknown> = { ...request };
    delete requestWithoutIntakeRequest.intake_verification_request;
    const clonedRest = cloneJsonObject(requestWithoutIntakeRequest);

    return {
      ...clonedRest,
      intake_verification_request: clonedIntakeRequest
    } as VendorReceiptGenerationRequest;
  } catch {
    return undefined;
  }
}

function cloneArtifactBytes(bytes: ArtifactBytes): ArtifactBytes {
  if (typeof bytes === "string") {
    return bytes;
  }
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }
  return bytes.slice(0);
}

// C5-14/C5-27: delegate entirely to the shared pure verifier in
// `packages/protocol-ts` so intake, the worker, and the control plane can
// never fall out of sync on what a valid vendor receipt is. This function
// stays `async` (and exported under its original name) only for API
// compatibility with existing callers.
export async function verifyVendorReceiptRecord(receipt: VendorReceipt, options: VendorReceiptVerificationOptions): Promise<VendorReceiptVerificationResult> {
  return verifyVendorReceiptRecordSync(receipt, options);
}

// C5-02: `intakeRequest` has already passed full `verifyIntakeSubmission`
// authority by the time this runs (see `generateVendorReceipt`), so every
// approved/received/record cross-check the old two-phase design needed is
// now guaranteed true by construction -- verification already requires the
// shipped outbound-manifest bytes to canonically equal `approved_outbound_manifest`
// (C5-04) and requires the bundle/manifest/approval chain to agree with
// itself (`validateApprovalAndManifestChain`). Only the receipt-specific
// concerns remain: signing metadata, chronology (C5-15), and the artifact
// count summary derived from the now-authoritative manifest.
function validateReceiptPreflight(request: VendorReceiptGenerationRequest, intakeRequest: IntakeVerificationRequest): ReceiptPreflightResult {
  const issues: string[] = [];
  const signing = validateReceiptSigning(request.signing, issues);

  if (!isUtcRfc3339Timestamp(request.receipt_timestamp)) {
    issues.push("receipt_timestamp_invalid");
  } else if (
    compareUtcRfc3339Timestamps(request.receipt_timestamp, intakeRequest.approved_outbound_manifest.generated_at) < 0 ||
    compareUtcRfc3339Timestamps(request.receipt_timestamp, intakeRequest.customer_approval.decided_at) < 0 ||
    compareUtcRfc3339Timestamps(request.receipt_timestamp, intakeRequest.submitted_bundle_manifest.created_at) < 0
  ) {
    // C5-15: a receipt must not predate the manifest it receipts, the
    // approval that authorized it, or the bundle it was minted from.
    issues.push("receipt_timestamp_precedes_prerequisite");
  }

  const artifactCountSummary = artifactCountSummaryFromOutboundManifest(intakeRequest.approved_outbound_manifest);
  if (artifactCountSummary === undefined) {
    issues.push("artifact_count_not_provable");
  } else {
    pushSuppliedSummaryIssue(request.approved_artifact_count_summary, artifactCountSummary, issues);
    pushSuppliedSummaryIssue(request.received_artifact_count_summary, artifactCountSummary, issues);
  }

  return {
    issues: Array.from(new Set(issues)),
    signing,
    artifactCountSummary
  };
}

function validateReceiptSigning(value: unknown, issues: string[]): ValidatedReceiptSigning | undefined {
  if (!isRecord(value)) {
    issues.push("receipt_signing_key_metadata_missing");
    return undefined;
  }

  const keyId = value.key_id;
  const keyVersion = value.key_version;
  const publicKeyReference = value.public_key_reference;
  const signingLimitations = value.signing_limitations;
  let valid = true;

  if (typeof keyId !== "string" || keyId.length === 0 || typeof keyVersion !== "string" || keyVersion.length === 0 || typeof publicKeyReference !== "string" || publicKeyReference.length === 0) {
    issues.push("receipt_signing_key_metadata_missing");
    valid = false;
  }
  const signingMode = value.signing_mode;
  if (signingMode !== "managed_key") {
    issues.push("receipt_signing_mode_unsupported");
    valid = false;
  }
  if (value.canonicalization !== "rfc8785") {
    issues.push("receipt_canonicalization_unsupported");
    valid = false;
  }
  if (!Array.isArray(signingLimitations) || signingLimitations.length === 0 || !signingLimitations.every((limitation) => typeof limitation === "string" && limitation.length > 0)) {
    issues.push("receipt_signing_key_metadata_missing");
    valid = false;
  } else {
    const limitations = signingLimitations.join(" ").toLowerCase();
    // D2/D3: managed-key custody is real and *limited*; the receipt's stated
    // limitations must describe that custody and the module it lives in
    // (spec Section 1.1), which is what the D2 key service emits.
    if (!limitations.includes("custody") || !limitations.includes(NON_VALIDATED_MODULE_LIMITATION)) {
      issues.push("receipt_signing_key_metadata_missing");
      valid = false;
    }
  }

  if (!valid || typeof keyId !== "string" || typeof keyVersion !== "string" || typeof publicKeyReference !== "string" || !Array.isArray(signingLimitations) || signingMode !== "managed_key") {
    return undefined;
  }
  return {
    key_id: keyId,
    key_version: keyVersion,
    signing_mode: signingMode,
    canonicalization: "rfc8785",
    public_key_reference: publicKeyReference,
    signing_limitations: nonEmptyArray(signingLimitations)
  };
}

function pushSuppliedSummaryIssue(supplied: unknown, derived: ArtifactCountSummary, issues: string[]): void {
  if (supplied === undefined) {
    return;
  }
  if (!isArtifactCountSummary(supplied)) {
    issues.push("artifact_count_not_provable");
    return;
  }
  if (!sameCanonicalJson(supplied, derived)) {
    issues.push("receipt_artifact_count_mismatch");
  }
}

function artifactCountSummaryFromOutboundManifest(manifest: unknown): ArtifactCountSummary | undefined {
  if (!isRecord(manifest) || !Array.isArray(manifest.evidence_categories)) {
    return undefined;
  }
  const categories: ArtifactCountCategory[] = [];
  const seen = new Set<string>();
  for (const expectedCategory of ARTIFACT_COUNT_CATEGORIES) {
    const category = manifest.evidence_categories.find((entry) => isRecord(entry) && entry.category === expectedCategory);
    const count = category?.count;
    if (!isRecord(category) || seen.has(expectedCategory) || !Number.isInteger(count) || count < 0) {
      return undefined;
    }
    seen.add(expectedCategory);
    categories.push({ category: expectedCategory, count });
  }
  if (seen.size !== manifest.evidence_categories.length) {
    return undefined;
  }
  return {
    count_domain: "evidence_category_counts",
    total_count: categories.reduce((sum, category) => sum + category.count, 0),
    categories: nonEmptyArray(categories)
  };
}

function isArtifactCountSummary(value: unknown): value is ArtifactCountSummary {
  if (!isRecord(value) || value.count_domain !== "evidence_category_counts" || !Number.isInteger(value.total_count) || !Array.isArray(value.categories)) {
    return false;
  }
  const totalCount = value.total_count;
  if (typeof totalCount !== "number" || totalCount < 0) {
    return false;
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const category of value.categories) {
    if (!isRecord(category) || typeof category.category !== "string" || !ARTIFACT_COUNT_CATEGORIES.includes(category.category as ArtifactCountCategory["category"]) || !Number.isInteger(category.count) || typeof category.count !== "number" || category.count < 0 || seen.has(category.category)) {
      return false;
    }
    seen.add(category.category);
    sum += category.count;
  }
  return seen.size === ARTIFACT_COUNT_CATEGORIES.length && sum === totalCount;
}
// C5-02: "approved" and "received" are now the same trusted values by
// construction -- `intakeRecord` only exists because `verifyIntakeSubmission`
// already proved the submitted bundle matches the approved manifest exactly
// (identity, shipped-bytes equality, and the full approval/manifest chain).
// The comparison retains its schema shape (seven matched rows) as the
// receipt's documented evidence trail, not as a live approved-vs-received
// check that could ever actually disagree post-verification.
function buildComparison(record: IntakeRecordProjection, artifactCountSummary: ArtifactCountSummary): VendorReceipt["approved_vs_received_comparison"] {
  const artifactCountValue = `evidence_category_counts:${artifactCountSummary.total_count}`;
  const disclosureSummaryValue = disclosureSummaryComparisonValue(record.disclosure_policy_summary);
  const rows: VendorReceipt["approved_vs_received_comparison"]["rows"] = [
    comparisonRow("manifest_id", record.manifest_id, record.manifest_id),
    comparisonRow("evidence_bundle_id", record.evidence_bundle_id, record.evidence_bundle_id),
    comparisonRow("selected_commit", record.selected_commit.commit_sha, record.selected_commit.commit_sha),
    comparisonRow("repository_identity_hash", record.repository_identity_hash, record.repository_identity_hash),
    comparisonRow("coverage_mode", record.coverage_mode, record.coverage_mode),
    comparisonRow("artifact_count_summary", artifactCountValue, artifactCountValue),
    comparisonRow("disclosure_policy_summary", disclosureSummaryValue, disclosureSummaryValue)
  ];
  return {
    comparison_state: "matched",
    rows
  };
}

function disclosureSummaryComparisonValue(summary: OutboundManifest["disclosure_policy_summary"]): string {
  return `${summary.disclosure_policy_ref}:${summary.coverage_mode}:${summary.redaction_configuration_version}`;
}

function comparisonRow(field: string, approvedValue: string, receivedValue: string): VendorReceipt["approved_vs_received_comparison"]["rows"][number] {
  return {
    field,
    approved_value: approvedValue,
    received_value: receivedValue,
    result: "matched"
  };
}

function buildReceiptSummary(receipt: VendorReceipt): ReceiptSummaryProjection {
  const keyVersion = `${receipt.receipt_signature.key_id}/${receipt.receipt_signature.key_version}`;
  return {
    plain_language_summary: `CodeAttest received bundle ${receipt.evidence_bundle_id} at ${receipt.receipt_timestamp} under Vendor Receipt ${receipt.vendor_receipt_id}.`,
    copyable_identifiers: [
      { label: "Vendor Receipt", value: receipt.vendor_receipt_id },
      { label: "Evidence Bundle", value: receipt.evidence_bundle_id },
      { label: "Outbound Manifest", value: receipt.manifest_id },
      { label: "Signing key/version", value: keyVersion },
      { label: "Algorithm/profile", value: receipt.receipt_signature.algorithm_profile },
      { label: "Canonicalization", value: receipt.canonicalization },
      { label: "Selected commit", value: receipt.selected_commit.commit_sha },
      { label: "Repository identity hash", value: receipt.repository_identity_hash },
      { label: "Coverage Mode", value: receipt.coverage_mode },
      { label: "Disclosure Policy", value: receipt.disclosure_policy_ref }
    ],
    technical_details: [
      { label: "Receipt identity", value: receipt.vendor_receipt_id },
      { label: "Bundle identity", value: receipt.evidence_bundle_id },
      { label: "Signing key/version", value: keyVersion },
      { label: "Algorithm/profile", value: receipt.receipt_signature.algorithm_profile },
      { label: "Canonicalization", value: receipt.canonicalization },
      { label: "Verification status", value: receipt.verification_state }
    ],
    accessibility: {
      role: "status",
      aria_live: "polite",
      min_target_size_px: 44
    }
  };
}

function noReceiptResult(state: "rejected_no_receipt" | "quarantined_no_receipt", reasonCodes: string[], affectedIdentity: AffectedIdentity, nextPath: NextPathHint): ReceiptNoReceiptResult {
  const result: ReceiptNoReceiptResult = {
    state,
    reason_codes: Array.from(new Set(reasonCodes)),
    next_path: nextPath
  };
  if (Object.keys(affectedIdentity).length > 0) {
    result.affected_identity = affectedIdentity;
  }
  return result;
}

async function identityFromCanonicalObject(value: Record<string, unknown>): Promise<string> {
  const canonical = canonicalizeJson(value);
  if (typeof canonical !== "string") {
    throw new Error("canonical identity input must be JSON-serializable");
  }
  return sha256Digest(new TextEncoder().encode(canonical));
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return typeof leftCanonical === "string" && leftCanonical === rightCanonical;
}

function isUtcRfc3339Timestamp(value: string): boolean {
  const match = UTC_RFC3339_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined || hourText === undefined || minuteText === undefined || secondText === undefined) {
    return false;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const daysByMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = daysByMonth[month - 1];
  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export async function verifyIntakeSubmission(request: IntakeVerificationRequest): Promise<IntakeVerificationResult> {
  const schemaIssues = validateRequestSchemas(request);
  if (schemaIssues.length > 0) {
    return failureResult(request, schemaIssues);
  }

  // C5-01: this must run before any identity hashing or artifact traversal --
  // an otherwise-valid submission must never become receipt-eligible while
  // demo spend is at or above the mandatory disable threshold. Story 2.7
  // built a full protocol-level guardrail-artifact/evaluator apparatus for
  // this (`demo-budget-guardrail`/`demo-environment-profile` schemas, a
  // control-plane evaluator with a five-tier threshold ladder); that
  // implementation was lost to a `git reset` before this repo's git history
  // itself was lost (see `_bmad-output/implementation-artifacts/2-7-demo-budget-guardrails-and-environment-gates.md`)
  // and is not recoverable. This restores only the single fail-closed
  // invariant C5-01 requires -- intake cannot be receipt-eligible at or
  // above 95% spend -- without rebuilding the full lost story.
  const demoBudgetIssues = validateDemoBudgetEnforcement(request.demo_budget_enforcement);
  if (demoBudgetIssues.length > 0) {
    return failureResult(request, demoBudgetIssues);
  }

  const issues: VerificationIssue[] = [];
  let recomputedManifestId: string;
  let recomputedBundleId: string;
  try {
    recomputedManifestId = await canonicalIdentity(request.approved_outbound_manifest, "manifest_id");
    recomputedBundleId = await canonicalIdentity(request.submitted_bundle_manifest, "evidence_bundle_id");
  } catch {
    return failureResult(request, [reject("schema_validation_failed")]);
  }

  if (request.approved_outbound_manifest.manifest_id !== recomputedManifestId) {
    issues.push(reject("manifest_identity_mismatch"));
  }

  if (request.submitted_bundle_manifest.evidence_bundle_id !== recomputedBundleId) {
    issues.push(reject("evidence_bundle_identity_mismatch"));
  }

  issues.push(...validateApprovalAndManifestChain(request));
  issues.push(...validateSignatureEnvelopeTrustBoundary(request, recomputedBundleId));
  issues.push(...validateSubmissionScope(request, recomputedBundleId));
  issues.push(...validateEnvironmentEvidenceGate(request.environment_evidence_gate));
  issues.push(...await validateArtifacts(request));
  issues.push(...validateShippedControlArtifacts(request));
  issues.push(...bundleManifestCleanupSemanticIssues(request.submitted_bundle_manifest).map(reject));
  issues.push(...validatePhysicalEvidenceCategoryInclusion(request));

  if (issues.length > 0) {
    return failureResult(request, issues);
  }

  return {
    state: "verified_receipt_eligible",
    reason_codes: [],
    verification_summary: "verification_passed_receipt_eligible",
    intake_record: buildIntakeRecord(request),
    next_path: "generate_receipt_in_story_2_3"
  };
}

// ---------------------------------------------------------------------------
// Story 2.6: submission failure and quarantine states
//
// The outcome record is produced here because this is where the disposition is
// already decided (`failureResult`) and where the receipt is already minted
// (`prepareVendorReceipt`/`completeVendorReceipt`). Building it anywhere else
// would mean re-deriving state intake already holds.
// ---------------------------------------------------------------------------

export type SubmissionOutcome = ProtocolSubmissionOutcome;
export type SubmissionOutcomeIdentity = NonNullable<SubmissionOutcome["submission_identities"][number]>;

export type SubmissionOutcomeRejectionReason =
  | "submission_outcome_input_invalid"
  | "submission_outcome_receipt_required"
  | "submission_outcome_receipt_invalid"
  | "submission_outcome_receipt_mismatch"
  | "submission_outcome_occurred_before_receipt"
  | "submission_outcome_schema_invalid";

export type BuildSubmissionOutcomeRequest = {
  result: IntakeVerificationResult;
  review_id: string;
  submission_outcome_id: string;
  occurred_at: string;
  /**
   * Required for failed results: `FailedIntakeResult` carries no bundle or
   * attempt identity of its own. Verified results take theirs from the intake
   * record, which is the identity intake actually accepted.
   */
  bundle_instance_id?: string;
  submission_attempt_id?: string;
  vendor_receipt?: VendorReceipt;
  /**
   * D3-2: required whenever `vendor_receipt` is supplied -- the receipt's
   * signature can no longer be authenticated from the receipt alone.
   */
  vendor_receipt_signature_outcome?: SignatureVerificationOutcome;
};

export type BuildSubmissionOutcomeResult =
  | { outcome: SubmissionOutcome }
  | { rejected: true; reason: SubmissionOutcomeRejectionReason };

const SUBMISSION_OUTCOME_SUMMARIES = {
  received_with_receipt: "CodeAttest recorded a Vendor Receipt for this submission.",
  rejected_no_receipt: "This submission was rejected before any receipt was issued.",
  quarantined_no_receipt: "This submission was quarantined before any receipt was issued."
} as const;

/**
 * The ambiguity guard: a verified-but-unreceipted submission is refused rather
 * than downgraded into some softer success, and a failed result can only ever
 * become `rejected_no_receipt` or `quarantined_no_receipt` with no receipt
 * reference. There is no argument shape that produces `received_with_receipt`
 * without a minted receipt.
 */
export async function buildSubmissionOutcome(request: BuildSubmissionOutcomeRequest): Promise<BuildSubmissionOutcomeResult> {
  // C5-19: clone the complete request before the first `await` so nothing
  // the caller does to its own objects after invocation (or across the
  // async receipt-verification boundary below) can influence this result.
  const snapshot = cloneSubmissionOutcomeRequest(request);
  if (snapshot === undefined) {
    return { rejected: true, reason: "submission_outcome_input_invalid" };
  }

  const result = snapshot.result;
  const isVerified = result.state === "verified_receipt_eligible";
  const isAllowedFailure = result.state === "rejected_no_receipt" || result.state === "quarantined_no_receipt";
  if (!isVerified && !isAllowedFailure) {
    return { rejected: true, reason: "submission_outcome_input_invalid" };
  }

  // C5-18: validate the full state-specific result shape before the first
  // `await` -- a verified_receipt_eligible result with a missing/null/
  // partial intake_record used to reach nested reads after the receipt
  // verification await below and throw.
  if (isVerified && !isValidVerifiedIntakeRecord(result.intake_record)) {
    return { rejected: true, reason: "submission_outcome_input_invalid" };
  }

  if (isVerified && !isRecord(snapshot.vendor_receipt)) {
    return { rejected: true, reason: "submission_outcome_receipt_required" };
  }
  if (isVerified) {
    const receipt = snapshot.vendor_receipt as VendorReceipt;
    if (snapshot.vendor_receipt_signature_outcome === undefined) {
      return { rejected: true, reason: "submission_outcome_receipt_invalid" };
    }
    const verification = await verifyVendorReceiptRecord(receipt, { signature_verification_outcome: snapshot.vendor_receipt_signature_outcome });
    if (verification.state !== "receipt_verified") {
      return { rejected: true, reason: "submission_outcome_receipt_invalid" };
    }
    // C5-17: a valid receipt minted for a DIFFERENT submission must never be
    // spliced into this outcome -- the receipt's own identities must bind
    // exactly to the intake record this outcome is being built for.
    if (
      receipt.manifest_id !== result.intake_record.manifest_id ||
      receipt.evidence_bundle_id !== result.intake_record.evidence_bundle_id ||
      receipt.bundle_instance_id !== result.intake_record.bundle_instance_id ||
      receipt.submission_attempt_id !== result.intake_record.submission_attempt_id
    ) {
      return { rejected: true, reason: "submission_outcome_receipt_mismatch" };
    }
    // C5-20: a receipt-backed success must not predate its own receipt.
    if (typeof snapshot.occurred_at !== "string" || !isUtcRfc3339Timestamp(snapshot.occurred_at) || compareUtcRfc3339Timestamps(snapshot.occurred_at, receipt.receipt_timestamp) < 0) {
      return { rejected: true, reason: "submission_outcome_occurred_before_receipt" };
    }
  }

  const bundleInstanceId = isVerified ? result.intake_record.bundle_instance_id : snapshot.bundle_instance_id;
  const submissionAttemptId = isVerified ? result.intake_record.submission_attempt_id : snapshot.submission_attempt_id;
  if (typeof bundleInstanceId !== "string" || typeof submissionAttemptId !== "string") {
    return { rejected: true, reason: "submission_outcome_input_invalid" };
  }

  // C5-22: a present-but-malformed identity value (wrong grammar for its
  // type) must reject the whole outcome, not be silently dropped from it.
  const identities: SubmissionOutcomeIdentity[] = [];
  let identitiesValid = true;
  if (isVerified) {
    identitiesValid = addSubmissionIdentity(identities, "manifest_id", result.intake_record.manifest_id) && identitiesValid;
    identitiesValid = addSubmissionIdentity(identities, "evidence_bundle_id", result.intake_record.evidence_bundle_id) && identitiesValid;
  } else {
    const affected = isRecord(result.affected_identity) ? result.affected_identity : {};
    identitiesValid = addSubmissionIdentity(identities, "manifest_id", affected.manifest_id) && identitiesValid;
    identitiesValid = addSubmissionIdentity(identities, "evidence_bundle_id", affected.evidence_bundle_id) && identitiesValid;
    identitiesValid = addSubmissionIdentity(identities, "review_request_id", affected.review_request_id) && identitiesValid;
  }
  identitiesValid = addSubmissionIdentity(identities, "bundle_instance_id", bundleInstanceId) && identitiesValid;
  identitiesValid = addSubmissionIdentity(identities, "submission_attempt_id", submissionAttemptId) && identitiesValid;
  if (!identitiesValid) {
    return { rejected: true, reason: "submission_outcome_input_invalid" };
  }

  const commonOutcome = {
    protocol_version: ACCEPTED_PROTOCOL_VERSION,
    submission_outcome_id: snapshot.submission_outcome_id,
    review_id: snapshot.review_id,
    bundle_instance_id: bundleInstanceId,
    submission_attempt_id: submissionAttemptId,
    occurred_at: snapshot.occurred_at,
    submission_identities: nonEmptyArray(identities)
  };

  let outcome: SubmissionOutcome;
  if (isVerified) {
    // Non-null by the `isRecord` guard above; a verified result cannot get here
    // without a receipt.
    outcome = {
      ...commonOutcome,
      outcome_state: "received_with_receipt",
      vendor_receipt_ref: (snapshot.vendor_receipt as VendorReceipt).vendor_receipt_id,
      next_path: "verify_receipt",
      customer_facing_summary: SUBMISSION_OUTCOME_SUMMARIES.received_with_receipt
    };
  } else {
    const reasonCodes = Array.from(new Set(Array.isArray(result.reason_codes) ? result.reason_codes : []));
    if (reasonCodes.length === 0) {
      // A failure with nothing to explain it is not a reportable failure.
      return { rejected: true, reason: "submission_outcome_input_invalid" };
    }
    if (result.state === "rejected_no_receipt") {
      outcome = {
        ...commonOutcome,
        outcome_state: "rejected_no_receipt",
        failure_reason_codes: reasonCodes,
        next_path: nextPathForFailure(result),
        customer_facing_summary: SUBMISSION_OUTCOME_SUMMARIES.rejected_no_receipt
      };
    } else if (result.state === "quarantined_no_receipt") {
      outcome = {
        ...commonOutcome,
        outcome_state: "quarantined_no_receipt",
        failure_reason_codes: reasonCodes,
        next_path: nextPathForFailure(result),
        customer_facing_summary: SUBMISSION_OUTCOME_SUMMARIES.quarantined_no_receipt
      };
    } else {
      return { rejected: true, reason: "submission_outcome_input_invalid" };
    }
  }

  if (validateProtocolSchema("urn:codeattest:protocol:v0:submission-outcome", outcome).length > 0) {
    return { rejected: true, reason: "submission_outcome_schema_invalid" };
  }

  return { outcome };
}

function nextPathForFailure(result: FailedIntakeResult): SubmissionOutcome["next_path"] {
  if (result.state === "quarantined_no_receipt") {
    return result.next_path === "contact_support" ? "contact_support" : "quarantine_support";
  }
  return result.next_path === "contact_support" ? "contact_support" : "retry";
}

// C5-22: `identityValue === undefined` (the identity simply was not
// supplied, which is valid for the optional identity types) returns `true`
// with nothing added. A present-but-grammar-invalid value returns `false`,
// which callers must treat as a hard rejection of the whole outcome rather
// than silently building one with the row omitted.
function addSubmissionIdentity(
  identities: SubmissionOutcomeIdentity[],
  identityType: SubmissionOutcomeIdentity["identity_type"],
  identityValue: unknown
): boolean {
  if (identityValue === undefined) {
    return true;
  }
  if (!submissionIdentityValueMatchesGrammar(identityType, identityValue)) {
    return false;
  }
  if (identities.some((identity) => identity.identity_type === identityType)) {
    return true;
  }
  identities.push({ identity_type: identityType, identity_value: identityValue });
  return true;
}

function isValidVerifiedIntakeRecord(value: unknown): value is IntakeRecordProjection {
  return (
    isRecord(value) &&
    isSha256Id(value.manifest_id) &&
    isSha256Id(value.evidence_bundle_id) &&
    typeof value.bundle_instance_id === "string" &&
    value.bundle_instance_id.length > 0 &&
    typeof value.submission_attempt_id === "string" &&
    value.submission_attempt_id.length > 0
  );
}

// C5-19: a plain-JSON clone (both `IntakeVerificationResult` and
// `VendorReceipt` are pure JSON-shaped protocol objects with no binary
// fields) taken synchronously before the first `await`.
function cloneSubmissionOutcomeRequest(request: unknown): BuildSubmissionOutcomeRequest | undefined {
  if (!isRecord(request) || !isRecord(request.result)) {
    return undefined;
  }
  try {
    return cloneJsonObject(request) as unknown as BuildSubmissionOutcomeRequest;
  } catch {
    return undefined;
  }
}

// C5-09 (scoped -- see `PHYSICALLY_RECONCILABLE_CATEGORIES`): the approved
// outbound manifest's evidence-category inclusion state must match the
// physical bundle, not merely agree with a second manifest that could carry
// the same false claim.
function validatePhysicalEvidenceCategoryInclusion(request: IntakeVerificationRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const physicalTypes = new Set(request.submitted_bundle_manifest.artifact_references.map((artifact) => artifact.artifact_type));
  for (const category of request.approved_outbound_manifest.evidence_categories) {
    if (!PHYSICALLY_RECONCILABLE_CATEGORIES.has(category.category)) {
      continue;
    }
    const artifactType = (Object.keys(ARTIFACT_TYPE_CATEGORY) as ArtifactReference["artifact_type"][]).find(
      (type) => ARTIFACT_TYPE_CATEGORY[type] === category.category
    );
    const physicallyPresent = artifactType !== undefined && physicalTypes.has(artifactType);
    if (category.included === true && !physicallyPresent) {
      issues.push(reject("evidence_category_physical_artifact_missing"));
    }
    if (category.included === false && physicallyPresent) {
      issues.push(reject("evidence_category_unapproved_physical_artifact"));
    }
  }
  return issues;
}

function validateApprovalAndManifestChain(request: IntakeVerificationRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const bundle = request.submitted_bundle_manifest;
  const manifest = request.approved_outbound_manifest;
  const approval = request.customer_approval;
  const displayed = approval.displayed_context;
  const selected = manifest.selected_scope_summary;

  if (approval.decision !== "approved") {
    issues.push(reject("customer_approval_not_approved"));
  }
  if (bundle.customer_approval_ref !== approval.approval_id || bundle.customer_approval_decision !== "approved") {
    issues.push(reject("customer_approval_mismatch"));
  }
  if (approval.manifest_id !== manifest.manifest_id || bundle.manifest_id !== manifest.manifest_id) {
    issues.push(reject("customer_approval_mismatch"));
  }
  if (bundle.verification_metadata.approved_manifest_id !== manifest.manifest_id) {
    issues.push(reject("bundle_approved_manifest_mismatch"));
  }
  if (bundle.review_scope_ref !== manifest.review_scope_ref) {
    issues.push(reject("bundle_review_scope_mismatch"));
  }
  if (bundle.disclosure_policy_ref !== manifest.disclosure_policy_ref) {
    issues.push(reject("bundle_disclosure_policy_mismatch"));
  }
  if (bundle.coverage_mode !== manifest.coverage_mode) {
    issues.push(reject("bundle_coverage_mode_mismatch"));
  }
  if (bundle.runner.version !== manifest.runner.version) {
    issues.push(reject("bundle_runner_version_mismatch"));
  }
  if (bundle.scanner_finding_set_ref !== manifest.scanner_finding_set_ref) {
    issues.push(reject("bundle_scanner_finding_set_mismatch"));
  }

  if (displayed.manifest_id !== manifest.manifest_id) {
    issues.push(reject("customer_approval_mismatch"));
  }
  if (
    displayed.selected_application.application_id !== selected.selected_application.application_id ||
    // C5-13: the approval-side display name is a separate required field from
    // `application_id` -- matching only the id let the accepted intake record
    // (which takes its name from the manifest, not the approval) silently
    // diverge from the application name actually shown to the approver.
    displayed.selected_application.display_name !== selected.selected_application.display_name
  ) {
    issues.push(reject("selected_application_mismatch"));
  }
  if (displayed.selected_commit.commit_sha !== selected.selected_commit.commit_sha) {
    issues.push(reject("selected_commit_mismatch"));
  }
  if (displayed.repository_identity !== selected.repository_identity) {
    issues.push(reject("repository_identity_mismatch"));
  }
  if (displayed.coverage_mode !== manifest.coverage_mode) {
    issues.push(reject("coverage_mode_mismatch"));
  }
  if (displayed.disclosure_policy_ref !== manifest.disclosure_policy_ref) {
    issues.push(reject("disclosure_policy_mismatch"));
  }
  if (displayed.scanner_finding_set_ref !== manifest.scanner_finding_set_ref) {
    issues.push(reject("scanner_finding_set_mismatch"));
  }
  // C5-26: warning-order semantics must agree with `scripts/lib/protocol-utils.mjs`
  // and the Rust runner, which both require exact array order for displayed
  // consent -- not merely the same set of warnings in any order.
  if (!sameStringSequence(displayed.disclosure_warnings, approval.warnings_acknowledged)) {
    issues.push(reject("customer_approval_warnings_mismatch"));
  }
  // C5-12: the displayed/acknowledged pair used to be bound only to each
  // other, never to the canonical manifest warnings they are supposed to
  // summarize -- a caller could replace both arrays with harmless text while
  // the manifest retained materially different warnings and stay eligible.
  if (!sameStringSequence(displayed.disclosure_warnings, manifest.warnings)) {
    issues.push(reject("customer_approval_manifest_warnings_mismatch"));
  }

  return issues;
}

/**
 * C5-04/C5-05: previously intake ran identity/approval/semantic logic only
 * over caller-supplied side-channel objects (`approved_outbound_manifest`,
 * `customer_approval`) and never parsed the shipped `review_scope`,
 * `disclosure_policy`, `scanner_finding_set`, `outbound_manifest`, or
 * `customer_approval` artifact bytes as JSON at all -- digest/size checks in
 * `validateArtifacts` only prove the bytes are internally consistent with
 * their own declared digest, not that they are well-formed, semantically
 * valid protocol documents, or that they agree with the side-channel copies
 * intake actually trusts. This decodes each present control artifact,
 * schema- and semantic-validates it, and (for the two types with a
 * side-channel duplicate) requires canonical equality against that
 * duplicate. `scanner_finding_set` is schema-checked only for now: unlike
 * `disclosure_policy`, its fixture is not yet drift-checked against a
 * verified canonical identity (no `canonical_identities` entry), and
 * `review_scope`'s identity is a bespoke field subset rather than
 * "canonical content minus its own id field" -- recomputing either blind
 * risks a wrong guess, so both are left for a follow-up pass rather than
 * rushed here.
 */
function validateShippedControlArtifacts(request: IntakeVerificationRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const bundle = request.submitted_bundle_manifest;
  const bytesByRef = request.artifact_bytes_by_ref;

  const reviewScopeRef = findArtifactRef(bundle, "review_scope");
  if (reviewScopeRef !== undefined) {
    const parsed = parseShippedJson(bytesByRef[reviewScopeRef]);
    if (parsed === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:review-scope", parsed).length > 0) {
      issues.push(reject("shipped_review_scope_invalid"));
    }
  }

  const disclosurePolicyRef = findArtifactRef(bundle, "disclosure_policy");
  if (disclosurePolicyRef !== undefined) {
    const parsed = parseShippedJson(bytesByRef[disclosurePolicyRef]);
    if (!isRecord(parsed)) {
      issues.push(reject("shipped_disclosure_policy_invalid"));
    } else {
      const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:disclosure-policy", parsed);
      const semanticIssues = disclosurePolicySemanticIssues(parsed);
      const identity = recomputeExcludedFieldIdentity(parsed, "disclosure_policy_id");
      if (schemaErrors.length > 0 || semanticIssues.length > 0 || identity === undefined || identity !== parsed["disclosure_policy_id"]) {
        issues.push(reject("shipped_disclosure_policy_invalid"));
      }
    }
  }

  if (bundle.scanner_finding_set_ref !== undefined) {
    const scannerFindingSetRef = findArtifactRef(bundle, "scanner_finding_set");
    if (scannerFindingSetRef !== undefined) {
      const parsed = parseShippedJson(bytesByRef[scannerFindingSetRef]);
      // C5-05: schema shape alone does not catch a scanner run whose
      // failure_reason contradicts its own status, or a candidate finding
      // attributed to a scanner that never actually succeeded.
      if (parsed === undefined || validateProtocolSchema("urn:codeattest:protocol:v0:scanner-finding-set", parsed).length > 0 || scannerFindingSetSemanticIssues(parsed).length > 0) {
        issues.push(reject("shipped_scanner_finding_set_invalid"));
      }
    }
  }

  const outboundManifestRef = findArtifactRef(bundle, "outbound_manifest");
  if (outboundManifestRef !== undefined) {
    const parsed = parseShippedJson(bytesByRef[outboundManifestRef]);
    if (!isRecord(parsed)) {
      issues.push(reject("shipped_outbound_manifest_invalid"));
    } else {
      const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:outbound-manifest", parsed);
      const semanticIssues = outboundManifestSemanticIssues(parsed);
      if (schemaErrors.length > 0 || semanticIssues.length > 0) {
        issues.push(reject("shipped_outbound_manifest_invalid"));
      } else if (!sameCanonicalJson(parsed, request.approved_outbound_manifest)) {
        issues.push(reject("shipped_outbound_manifest_mismatch"));
      }
    }
  }

  const customerApprovalRef = findArtifactRef(bundle, "customer_approval");
  if (customerApprovalRef !== undefined) {
    const parsed = parseShippedJson(bytesByRef[customerApprovalRef]);
    if (!isRecord(parsed)) {
      issues.push(reject("shipped_customer_approval_invalid"));
    } else {
      const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:customer-approval", parsed);
      const semanticIssues = customerApprovalSemanticIssues(parsed);
      if (schemaErrors.length > 0 || semanticIssues.length > 0) {
        issues.push(reject("shipped_customer_approval_invalid"));
      } else if (!sameCanonicalJson(parsed, request.customer_approval)) {
        issues.push(reject("shipped_customer_approval_mismatch"));
      }
    }
  }

  return issues;
}

function findArtifactRef(bundle: BundleManifest, artifactType: string): string | undefined {
  return bundle.artifact_references.find((entry) => entry.artifact_type === artifactType)?.artifact_ref;
}

function parseShippedJson(bytes: ArtifactBytes | undefined): unknown {
  if (bytes === undefined || !isArtifactBytes(bytes)) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytesFromInput(bytes)));
  } catch {
    return undefined;
  }
}

const SOFTWARE_CUSTODY_LIMITATION = "software custody";
const NON_VALIDATED_MODULE_LIMITATION = "non-validated";

// D3-2: every signature is now real, so there is one path. The manifest's
// declared `bundle_signing_mode` must equal the mode the signature was
// actually made in -- a stronger binding than the retired synthetic
// signing mode check it replaces.
function validateSignatureEnvelopeTrustBoundary(request: IntakeVerificationRequest, recomputedBundleId: string): VerificationIssue[] {
  const signature = request.signature_envelope;
  const issues: VerificationIssue[] = [];

  if (request.submitted_bundle_manifest.verification_metadata.bundle_signing_mode !== signature.signing_mode) {
    issues.push(quarantine("unsupported_signature_mode"));
  }
  if (signature.signed_identity_type !== "evidence_bundle") {
    issues.push(reject("signature_signed_identity_mismatch"));
  }
  if (signature.signed_identity !== request.submitted_bundle_manifest.evidence_bundle_id || signature.signed_identity !== recomputedBundleId) {
    issues.push(reject("signature_signed_identity_mismatch"));
  }
  const custodyDescribed = signature.signing_limitations.some((limitation) => {
    const text = limitation.toLowerCase();
    return text.includes("custody") && (text.includes(SOFTWARE_CUSTODY_LIMITATION) || text.includes("runner custody"));
  });
  const moduleDescribed = signature.signing_limitations.some((limitation) => limitation.toLowerCase().includes(NON_VALIDATED_MODULE_LIMITATION) || limitation.toLowerCase().includes("cannot attest"));
  if (!custodyDescribed || !moduleDescribed) {
    issues.push(reject("signature_limitations_missing"));
  }
  const outcome = request.signature_verification_outcome;
  if (outcome === undefined) {
    issues.push(reject("signature_bytes_untrusted"));
    return issues;
  }
  if (outcome.signed_identity !== recomputedBundleId || outcome.signed_identity_type !== "evidence_bundle") {
    issues.push(reject("signature_bytes_untrusted"));
    return issues;
  }
  if (outcome.key_id !== signature.key_id || outcome.key_version !== signature.key_version || outcome.algorithm_profile !== signature.algorithm_profile) {
    issues.push(reject("signature_key_mismatch"));
    return issues;
  }
  if (outcome.result !== "verified") {
    issues.push(reject(outcome.result));
  }
  return issues;
}

function validateSubmissionScope(request: IntakeVerificationRequest, recomputedBundleId: string): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const context = request.authenticated_context;
  const expectation = request.submission_token_expectation;
  const token = request.submission_token;
  const manifest = request.approved_outbound_manifest;

  if (context.customer_id !== expectation.customer_id) {
    issues.push(reject("review_scope_customer_mismatch"));
  }
  if (context.review_request_id !== expectation.review_request_id) {
    issues.push(reject("review_scope_request_mismatch"));
  }
  if (context.selected_application_id !== expectation.selected_application_id || expectation.selected_application_id !== manifest.selected_scope_summary.selected_application.application_id) {
    issues.push(reject("review_scope_application_mismatch"));
  }
  if (context.selected_commit !== expectation.selected_commit || expectation.selected_commit !== manifest.selected_scope_summary.selected_commit.commit_sha) {
    issues.push(reject("review_scope_commit_mismatch"));
  }
  if (context.repository_identity_hash !== expectation.repository_identity_hash || expectation.repository_identity_hash !== manifest.selected_scope_summary.repository_identity) {
    issues.push(reject("review_scope_repository_mismatch"));
  }
  if (expectation.expected_manifest_id !== manifest.manifest_id) {
    issues.push(reject("review_scope_manifest_mismatch"));
  }
  if (expectation.expected_evidence_bundle_id !== undefined && expectation.expected_evidence_bundle_id !== recomputedBundleId) {
    issues.push(reject("review_scope_bundle_mismatch"));
  }
  if (token.token_key_id !== expectation.token_key_id) {
    issues.push(reject("review_scope_token_key_mismatch"));
  }
  if (!constantTimeStringEquals(token.token_secret_material, expectation.token_secret_material)) {
    issues.push(reject("review_scope_token_material_mismatch"));
  }

  return issues;
}

function validateDemoBudgetEnforcement(enforcement: DemoBudgetEnforcement): VerificationIssue[] {
  if (!isRecord(enforcement) || typeof enforcement.spend_ratio !== "number" || !Number.isFinite(enforcement.spend_ratio) || enforcement.spend_ratio < 0) {
    return [reject("demo_budget_enforcement_invalid")];
  }
  if (enforcement.spend_ratio >= DEMO_BUDGET_INTAKE_DISABLE_THRESHOLD) {
    return [reject("demo_budget_intake_disabled")];
  }
  return [];
}

// C5-07: the gate is no longer trusted as submitted -- it must canonically
// equal the one trusted configuration published for its claimed profile.
function validateEnvironmentEvidenceGate(gate: EnvironmentEvidenceGate): VerificationIssue[] {
  const trusted = TRUSTED_ENVIRONMENT_EVIDENCE_GATES.get(gate.environment_profile);
  if (trusted === undefined || !sameCanonicalJson(withoutNotes(gate), trusted)) {
    return [quarantine("environment_gate_untrusted")];
  }
  return [];
}

function withoutNotes(gate: EnvironmentEvidenceGate): Omit<EnvironmentEvidenceGate, "notes"> {
  const { notes: _notes, ...rest } = gate;
  return rest;
}

async function validateArtifacts(request: IntakeVerificationRequest): Promise<VerificationIssue[]> {
  const issues: VerificationIssue[] = [];
  const gate = request.environment_evidence_gate;
  const artifacts = request.submitted_bundle_manifest.artifact_references;
  const artifactRefs = new Set<string>();
  const artifactTypeCounts = new Map<string, number>();

  for (const artifact of artifacts) {
    artifactTypeCounts.set(artifact.artifact_type, (artifactTypeCounts.get(artifact.artifact_type) ?? 0) + 1);
    if (artifactRefs.has(artifact.artifact_ref)) {
      issues.push(reject("schema_validation_failed"));
    }
    artifactRefs.add(artifact.artifact_ref);
  }

  // C5-10: a required control artifact type must appear exactly once. Distinct
  // refs sharing the same required type used to pass a presence-only `Set`
  // check, letting `.find()`-based lookups elsewhere (receipt selection,
  // shipped-artifact parsing) silently pick whichever entry happened to sort
  // first -- reordering the same signed artifact set could then change which
  // artifact intake and receipt generation actually used.
  const requiredSingletonTypes = ["review_scope", "disclosure_policy", "outbound_manifest", "customer_approval"];
  if (request.submitted_bundle_manifest.scanner_finding_set_ref !== undefined) {
    requiredSingletonTypes.push("scanner_finding_set");
  }
  for (const requiredType of requiredSingletonTypes) {
    const count = artifactTypeCounts.get(requiredType) ?? 0;
    if (count === 0) {
      issues.push(reject("bundle_required_artifact_missing"));
    } else if (count > 1) {
      issues.push(reject("bundle_required_artifact_duplicated"));
    }
  }

  // C5-08: every byte-map key must be explained by a declared artifact ref --
  // an unexplained extra key (source/secret bytes never inventoried by any
  // artifact reference) must never silently cross this boundary uninspected.
  for (const providedRef of Object.keys(request.artifact_bytes_by_ref)) {
    if (!artifactRefs.has(providedRef)) {
      issues.push(reject("artifact_bytes_unexplained_key"));
    }
  }

  for (const artifact of artifacts) {
    if (!gate.allowed_source_derived_classes.includes(artifact.source_derived_class)) {
      issues.push(quarantine("source_derived_class_not_allowed"));
    }

    const artifactBytes = request.artifact_bytes_by_ref[artifact.artifact_ref];
    if (artifactBytes === undefined) {
      issues.push(reject("artifact_bytes_missing"));
      continue;
    }
    if (!isArtifactBytes(artifactBytes)) {
      issues.push(reject("schema_validation_failed"));
      continue;
    }
    const bytes = bytesFromInput(artifactBytes);
    const digest = await sha256Digest(bytes);
    if (artifact.digest !== digest) {
      issues.push(reject("artifact_digest_mismatch"));
    }
    if (artifact.size_bytes !== bytes.byteLength) {
      issues.push(reject("artifact_size_mismatch"));
    }

    if (isSourceArtifact(artifact)) {
      issues.push(...validateSourceArtifactBoundary(artifact, bytes, gate));
    }
  }

  return issues;
}

// C5-06: the profile name alone must never disable marker enforcement or
// readiness requirements for a given artifact -- only that artifact's own
// per-type acceptance flag may waive the marker requirement, and every
// per-type-accepted artifact requires every real-evidence readiness control,
// independent of whether this particular instance happens to carry markers.
function validateSourceArtifactBoundary(artifact: ArtifactReference, bytes: Uint8Array, gate: EnvironmentEvidenceGate): VerificationIssue[] {
  const issues: VerificationIssue[] = [];
  const isRawSnippet = artifact.artifact_type === "raw_snippet";
  const isTargetedFile = artifact.artifact_type === "targeted_file";
  const markers: readonly string[] = artifact.synthetic_markers ?? [];
  const text = new TextDecoder().decode(bytes);
  const typeAccepted = (isRawSnippet && gate.real_raw_snippet_acceptance === true) || (isTargetedFile && gate.real_targeted_file_acceptance === true);
  const markersWaived = gate.environment_profile === "partner_pilot_real_snippet_ready" && typeAccepted;

  if (!markersWaived) {
    const hasDeclaredMarkers = REQUIRED_SYNTHETIC_MARKERS.every((marker) => markers.includes(marker));
    const hasByteMarkers = REQUIRED_SYNTHETIC_MARKERS.every((marker) => text.includes(marker));
    if (!hasDeclaredMarkers || !hasByteMarkers) {
      issues.push(quarantine("synthetic_demo_source_marker_required"));
    }
  }
  if (gate.environment_profile !== "partner_pilot_real_snippet_ready" && typeAccepted) {
    issues.push(quarantine("environment_gate_real_evidence_not_allowed"));
  }
  if (typeAccepted && !allRealEvidenceReadinessControlsReady(gate)) {
    issues.push(quarantine("environment_gate_readiness_required"));
  }

  return issues;
}

function allRealEvidenceReadinessControlsReady(gate: EnvironmentEvidenceGate): boolean {
  return (
    gate.access_control_ready === true &&
    gate.access_logging_ready === true &&
    gate.encryption_at_rest_ready === true &&
    gate.retention_defaults_ready === true &&
    gate.deletion_controls_ready === true &&
    gate.demo_budget_gate_ready === true &&
    gate.signing_release_trust_ready === true &&
    gate.retention_period_required === true &&
    gate.allowed_source_derived_classes.includes("customer_opt_in_retained_source")
  );
}

function buildIntakeRecord(request: IntakeVerificationRequest): IntakeRecordProjection {
  const outboundManifestRef = requiredArtifactRef(request.submitted_bundle_manifest, "outbound_manifest");
  return {
    projection_state: "verified_receipt_eligible",
    approved_outbound_manifest_ref: outboundManifestRef,
    manifest_id: request.approved_outbound_manifest.manifest_id,
    evidence_bundle_id: request.submitted_bundle_manifest.evidence_bundle_id,
    selected_application: { ...request.approved_outbound_manifest.selected_scope_summary.selected_application },
    selected_commit: { ...request.approved_outbound_manifest.selected_scope_summary.selected_commit },
    repository_identity_hash: request.approved_outbound_manifest.selected_scope_summary.repository_identity,
    disclosure_policy_ref: request.approved_outbound_manifest.disclosure_policy_ref,
    disclosure_policy_summary: { ...request.approved_outbound_manifest.disclosure_policy_summary },
    coverage_mode: request.approved_outbound_manifest.coverage_mode,
    // C5-24: every other nested field here is copied; these two were
    // aliased by reference, so mutating the submitted bundle after a
    // successful call rewrote the supposedly-verified trusted projection.
    runner: { ...request.submitted_bundle_manifest.runner },
    tool_versions: request.submitted_bundle_manifest.tool_versions.map((toolVersion) => ({ ...toolVersion })),
    bundle_instance_id: request.submitted_bundle_manifest.bundle_instance_id,
    submission_attempt_id: request.submitted_bundle_manifest.submission_attempt_id
  };
}

function failureResult(request: IntakeVerificationRequest, issues: VerificationIssue[]): FailedIntakeResult {
  const reasonCodes = Array.from(new Set(issues.map((issue) => issue.code)));
  const hasQuarantine = issues.some((issue) => issue.disposition === "quarantine");
  // C5-01: retrying immediately cannot fix a budget-disabled submission, so
  // it gets its own next_path rather than the generic "retry".
  const hasDemoBudgetDisabled = issues.some((issue) => issue.code === "demo_budget_intake_disabled");
  const affectedIdentity: AffectedIdentity = {};

  if (isSha256Id(request?.submitted_bundle_manifest?.manifest_id)) {
    affectedIdentity.manifest_id = request.submitted_bundle_manifest.manifest_id;
  }
  if (isSha256Id(request?.submitted_bundle_manifest?.evidence_bundle_id)) {
    affectedIdentity.evidence_bundle_id = request.submitted_bundle_manifest.evidence_bundle_id;
  }
  if (typeof request?.authenticated_context?.review_request_id === "string" && request.authenticated_context.review_request_id.length > 0) {
    affectedIdentity.review_request_id = request.authenticated_context.review_request_id;
  }

  const base: FailedIntakeResult = {
    state: hasQuarantine ? "quarantined_no_receipt" : "rejected_no_receipt",
    reason_codes: reasonCodes,
    next_path: hasQuarantine ? "quarantine_support" : hasDemoBudgetDisabled ? "contact_support" : "retry"
  };

  if (Object.keys(affectedIdentity).length > 0) {
    return {
      ...base,
      affected_identity: affectedIdentity
    };
  }
  return base;
}

function validateRequestSchemas(request: IntakeVerificationRequest): VerificationIssue[] {
  const issues: VerificationIssue[] = [];

  if (!isRecord(request)) {
    return [reject("schema_validation_failed")];
  }

  pushProtocolSchemaIssues(issues, "urn:codeattest:protocol:v0:bundle-manifest", request.submitted_bundle_manifest);
  pushSignatureSchemaIssues(issues, request.signature_envelope);
  pushProtocolSchemaIssues(issues, "urn:codeattest:protocol:v0:customer-approval", request.customer_approval);
  pushProtocolSchemaIssues(issues, "urn:codeattest:protocol:v0:outbound-manifest", request.approved_outbound_manifest);
  pushProtocolSchemaIssues(issues, "urn:codeattest:protocol:v0:environment-evidence-gate", request.environment_evidence_gate);
  validateUniqueArtifactRefs(request.submitted_bundle_manifest, issues);
  validateServiceLocalRequestSchema(request, issues);

  return dedupeIssues(issues);
}

function pushSignatureSchemaIssues(issues: VerificationIssue[], value: unknown): void {
  const schemaErrors = validateProtocolSchema("urn:codeattest:protocol:v0:signature-envelope", value);
  if (schemaErrors.length === 0) return;
  const onlySignatureBytesPattern = schemaErrors.every((error) => error.code === "pattern" && error.location === "$.signature_bytes");
  issues.push(reject(onlySignatureBytesPattern ? "signature_bytes_untrusted" : "schema_validation_failed"));
}

function pushProtocolSchemaIssues(issues: VerificationIssue[], schemaId: Parameters<typeof validateProtocolSchema>[0], value: unknown): void {
  const schemaErrors = validateProtocolSchema(schemaId, value);
  if (schemaErrors.length === 0) {
    return;
  }
  if (isRecord(value) && typeof value.protocol_version === "string" && value.protocol_version !== ACCEPTED_PROTOCOL_VERSION) {
    issues.push(reject("protocol_version_invalid"));
    return;
  }
  issues.push(reject("schema_validation_failed"));
}

function validateUniqueArtifactRefs(value: unknown, issues: VerificationIssue[]): void {
  if (!isRecord(value) || !Array.isArray(value.artifact_references)) {
    return;
  }
  const seen = new Set<string>();
  for (const artifact of value.artifact_references) {
    if (!isRecord(artifact) || typeof artifact.artifact_ref !== "string") {
      continue;
    }
    if (seen.has(artifact.artifact_ref)) {
      issues.push(reject("schema_validation_failed"));
      return;
    }
    seen.add(artifact.artifact_ref);
  }
}

function validateServiceLocalRequestSchema(request: Record<string, unknown>, issues: VerificationIssue[]): void {
  if (!isRecord(request.artifact_bytes_by_ref)) {
    issues.push(reject("schema_validation_failed"));
  } else {
    for (const bytes of Object.values(request.artifact_bytes_by_ref)) {
      if (!isArtifactBytes(bytes)) {
        issues.push(reject("schema_validation_failed"));
      }
    }
  }
  validateContextShape(request.authenticated_context, issues);
  validateTokenShape(request.submission_token, issues);
  validateExpectationShape(request.submission_token_expectation, issues);
}

function validateContextShape(value: unknown, issues: VerificationIssue[]): void {
  const allowed = new Set(["customer_id", "review_request_id", "selected_application_id", "selected_commit", "repository_identity_hash"]);
  if (!validateObjectShape(value, allowed, Array.from(allowed), issues)) {
    return;
  }
  expectNonEmptyString(value.customer_id, issues);
  expectNonEmptyString(value.review_request_id, issues);
  expectNonEmptyString(value.selected_application_id, issues);
  expectPattern(value.selected_commit, commitShaPattern, issues);
  expectPattern(value.repository_identity_hash, sha256Pattern, issues);
}

function validateTokenShape(value: unknown, issues: VerificationIssue[]): void {
  const allowed = new Set(["token_key_id", "token_secret_material"]);
  if (!validateObjectShape(value, allowed, Array.from(allowed), issues)) {
    return;
  }
  expectNonEmptyString(value.token_key_id, issues);
  expectNonEmptyString(value.token_secret_material, issues);
}

function validateExpectationShape(value: unknown, issues: VerificationIssue[]): void {
  const allowed = new Set([
    "customer_id",
    "review_request_id",
    "selected_application_id",
    "selected_commit",
    "repository_identity_hash",
    "expected_manifest_id",
    "expected_evidence_bundle_id",
    "token_key_id",
    "token_secret_material"
  ]);
  const required = [
    "customer_id",
    "review_request_id",
    "selected_application_id",
    "selected_commit",
    "repository_identity_hash",
    "expected_manifest_id",
    "token_key_id",
    "token_secret_material"
  ];
  if (!validateObjectShape(value, allowed, required, issues)) {
    return;
  }
  expectNonEmptyString(value.customer_id, issues);
  expectNonEmptyString(value.review_request_id, issues);
  expectNonEmptyString(value.selected_application_id, issues);
  expectPattern(value.selected_commit, commitShaPattern, issues);
  expectPattern(value.repository_identity_hash, sha256Pattern, issues);
  expectPattern(value.expected_manifest_id, sha256Pattern, issues);
  expectOptionalPattern(value.expected_evidence_bundle_id, sha256Pattern, issues);
  expectNonEmptyString(value.token_key_id, issues);
  expectNonEmptyString(value.token_secret_material, issues);
}

function validateObjectShape(
  value: unknown,
  allowedProperties: Set<string>,
  requiredProperties: string[],
  issues: VerificationIssue[]
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(reject("schema_validation_failed"));
    return false;
  }
  for (const requiredProperty of requiredProperties) {
    if (value[requiredProperty] === undefined) {
      issues.push(reject("schema_validation_failed"));
    }
  }
  for (const property of Object.keys(value)) {
    if (!allowedProperties.has(property) || !isSnakeCase(property)) {
      issues.push(reject("schema_validation_failed"));
    }
  }
  return true;
}

function expectPattern(value: unknown, pattern: RegExp, issues: VerificationIssue[]): void {
  if (typeof value !== "string" || !pattern.test(value)) {
    issues.push(reject("schema_validation_failed"));
  }
}

function expectOptionalPattern(value: unknown, pattern: RegExp, issues: VerificationIssue[]): void {
  if (value !== undefined) {
    expectPattern(value, pattern, issues);
  }
}

function expectNonEmptyString(value: unknown, issues: VerificationIssue[]): void {
  if (typeof value !== "string" || value.length < 1) {
    issues.push(reject("schema_validation_failed"));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSnakeCase(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

function isSha256Id(value: unknown): value is string {
  return typeof value === "string" && sha256Pattern.test(value);
}

// C5-11: `artifact_type` is the only field source-safety controls may key
// on (see the `ARTIFACT_TYPE_CATEGORY` comment), so the controls themselves
// must not be skippable merely by declaring an artifact under some *other*
// artifact_type. Every type whose content is not already independently
// schema/semantic-validated elsewhere (`review_scope`, `disclosure_policy`,
// `scanner_finding_set`, `outbound_manifest`, `customer_approval` all go
// through `validateShippedControlArtifacts`; `bundle_manifest` and
// `signature_envelope` are structural, not free text) must pass the same
// synthetic-marker safety boundary as `raw_snippet`/`targeted_file` --
// otherwise real source bytes relabeled as, for example,
// `dependency_manifest` would bypass every marker and gate control.
const CONTENT_UNSAFE_ARTIFACT_TYPES: ReadonlySet<ArtifactReference["artifact_type"]> = new Set(["raw_snippet", "targeted_file", "dependency_manifest", "scanner_raw_output"]);

function isSourceArtifact(artifact: ArtifactReference): boolean {
  return CONTENT_UNSAFE_ARTIFACT_TYPES.has(artifact.artifact_type);
}

function isArtifactBytes(value: unknown): value is ArtifactBytes {
  return typeof value === "string" || value instanceof Uint8Array || value instanceof ArrayBuffer;
}

function nonEmptyArray<T>(values: T[]): NonEmptyArray<T> {
  if (values.length === 0) {
    throw new Error("expected non-empty protocol array after validation");
  }
  return values as NonEmptyArray<T>;
}

function sameStringSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requiredArtifactRef(bundle: BundleManifest, artifactType: string): string {
  const artifact = bundle.artifact_references.find((entry) => entry.artifact_type === artifactType);
  if (artifact === undefined) {
    throw new Error(`required artifact is missing after validation: ${artifactType}`);
  }
  return artifact.artifact_ref;
}

async function canonicalIdentity(value: Record<string, unknown>, excludedField: string): Promise<string> {
  const identityInput = cloneJsonObject(value);
  delete identityInput[excludedField];
  const canonical = canonicalizeJson(identityInput);
  if (typeof canonical !== "string") {
    throw new Error("canonical identity input must be JSON-serializable");
  }
  return sha256Digest(new TextEncoder().encode(canonical));
}

async function sha256Digest(bytes: Uint8Array): Promise<string> {
  const digestInput = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256:${hex}`;
}

function bytesFromInput(input: ArtifactBytes): Uint8Array {
  if (typeof input === "string") {
    return new TextEncoder().encode(input);
  }
  if (input instanceof Uint8Array) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

function cloneJsonObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

// C5-25: comparing raw token bytes up to a fixed 4096-unit window always set
// a mismatch bit for any input over that length, so two equal tokens longer
// than 4096 UTF-16 units were unconditionally rejected. Comparing fixed-length
// SHA-256 digests instead removes the length-dependent branch entirely --
// both digests are always exactly 71 characters ("sha256:" + 64 hex digits),
// so the loop bound is a true constant regardless of the original token length.
function constantTimeStringEquals(left: string, right: string): boolean {
  const leftDigest = sha256ProtocolText(left);
  const rightDigest = sha256ProtocolText(right);
  let difference = 0;
  for (let index = 0; index < leftDigest.length; index += 1) {
    difference |= leftDigest.charCodeAt(index) ^ rightDigest.charCodeAt(index);
  }
  return difference === 0;
}

function reject(code: string): VerificationIssue {
  return { code, disposition: "reject" };
}

function quarantine(code: string): VerificationIssue {
  return { code, disposition: "quarantine" };
}

function dedupeIssues(issues: VerificationIssue[]): VerificationIssue[] {
  const seen = new Set<string>();
  const deduped: VerificationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.disposition}:${issue.code}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(issue);
    }
  }
  return deduped;
}
