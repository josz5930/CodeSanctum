import { createHash } from "node:crypto";

import type { AllowedAccess, ArtifactStore, JobQueue, JobRecord, StoredObjectClassificationStore } from "../../../../packages/evidence-store/src/index.js";
import {
  canonicalizeProtocolJson,
  type BundleManifest,
  type IdentitySigningInput,
  type OutboundManifest,
  type RetentionSourceDerivedClass,
  type StoredObjectClassification
} from "../../../../packages/protocol-ts/src/index.js";
import type { SignatureVerifier } from "../../../../packages/signing/src/index.js";
import { normalizeCandidateFindings, type ArtifactAvailability } from "../../../../services/worker/src/index.js";

import type { SubmissionArtifactReference } from "../submission/access.js";
import type { SubmissionAttemptRecord, SubmissionAttemptStore } from "../submission/attempt-state.js";
import { NORMALIZE_SCANNER_FINDINGS_JOB_TYPE } from "../submission/job-types.js";
import type { VendorReceiptStore } from "../submission/receipt-store.js";
import type { ArtifactPresenceReader, NormalizationOutcomeRecord, NormalizationOutcomeStore } from "./normalization-records.js";

/** A job that keeps failing is recorded as rejected after this many claims. */
export const NORMALIZE_MAX_ATTEMPTS = 5;

export const WORKER_ACTOR_ID = "vendor_service:codeattest-worker";

export type NormalizeJobDeps = {
  jobs: JobQueue;
  attempts: SubmissionAttemptStore;
  receipts: VendorReceiptStore;
  artifacts: ArtifactStore;
  classifications: StoredObjectClassificationStore;
  presence: ArtifactPresenceReader;
  outcomes: NormalizationOutcomeStore;
  /** Built from the trust-anchor-signed key directory; holds no private key. */
  verifier: SignatureVerifier;
  /**
   * Mints a logged access decision for one artifact read. Takes the job's
   * claim count so a retried read gets a new idempotency key.
   */
  mintAccess: (jobAttempt: number, attempt: SubmissionAttemptRecord, reference: SubmissionArtifactReference) => Promise<AllowedAccess | undefined>;
  /** From the boot-bound environment gate, never from a job. */
  environmentProfile: StoredObjectClassification["environment_profile"];
  now: () => string;
  log: (entry: Record<string, unknown>) => void;
  maxAttempts?: number;
};

export type NormalizeDrainResult = { normalized: number; rejected: number; failed: string[] };

type ManifestArtifactReference = BundleManifest["artifact_references"][number];

type AttemptResult =
  | { outcome: "normalized"; draft_set_digest: string }
  | { outcome: "rejected"; rejection_reason: string };

const DELETION_EVIDENCE_REF = /^deletion_evidence:[a-z0-9][a-z0-9_-]{2,63}$/;
const RETAINABLE_CLASSES = new Set<RetentionSourceDerivedClass>(["retained_review_artifact", "transient_source_derived", "customer_opt_in_retained_source"]);
const DELETABLE_CLASSES = new Set<RetentionSourceDerivedClass>(["transient_source_derived", "customer_opt_in_retained_source"]);

/**
 * Thrown for a failure that a later try may not hit (a database error, an
 * object the envelope key could not open). The job goes back to the queue.
 * Anything permanent is returned as a rejection instead and never retried.
 */
class RetryableNormalizationError extends Error {}

function storedObjectRefFor(digest: string): string {
  return `stored_object:${digest.replace(/^sha256:/, "")}`;
}

function parsePayload(payload: string): { review_id: string; submission_attempt_id: string } | undefined {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return typeof parsed.review_id === "string" && typeof parsed.submission_attempt_id === "string"
      ? { review_id: parsed.review_id, submission_attempt_id: parsed.submission_attempt_id }
      : undefined;
  } catch {
    return undefined;
  }
}

function availabilityFor(references: readonly ManifestArtifactReference[], presence: Awaited<ReturnType<ArtifactPresenceReader>>): Record<string, ArtifactAvailability> {
  const lookup: Record<string, ArtifactAvailability> = {};
  for (const reference of references) {
    const known = presence.get(reference.digest);
    const sourceClass = reference.source_derived_class;
    if (sourceClass === "never_collected") {
      lookup[reference.artifact_ref] = { availability_state: "never_collected", source_derived_class: sourceClass };
    } else if (known?.state === "deleted" && DELETABLE_CLASSES.has(sourceClass) && DELETION_EVIDENCE_REF.test(known.deletion_evidence_id)) {
      lookup[reference.artifact_ref] = {
        availability_state: "deleted_under_policy",
        source_derived_class: sourceClass,
        deletion_evidence_ref: known.deletion_evidence_id
      };
    } else if (known?.state === "stored" && RETAINABLE_CLASSES.has(sourceClass)) {
      lookup[reference.artifact_ref] = { availability_state: "retained_review_artifact", source_derived_class: sourceClass };
    }
    // Anything else is left out, and normalization reports it as an
    // unresolved reference rather than guessing.
  }
  return lookup;
}

async function readJsonArtifact(
  deps: NormalizeJobDeps,
  job: JobRecord,
  attempt: SubmissionAttemptRecord,
  reference: ManifestArtifactReference
): Promise<unknown | "not_found"> {
  const access = await deps.mintAccess(job.attempts, attempt, reference);
  if (access === undefined) {
    throw new RetryableNormalizationError("artifact access was not granted");
  }
  const read = await deps.artifacts.get({ access, digest: reference.digest });
  if (read.outcome === "not_found") {
    return "not_found";
  }
  if (read.outcome !== "read") {
    throw new RetryableNormalizationError(`artifact read failed: ${read.outcome}`);
  }
  try {
    return JSON.parse(new TextDecoder().decode(read.bytes));
  } catch {
    return "not_found";
  }
}

async function normalizeAttempt(deps: NormalizeJobDeps, job: JobRecord, attemptId: string): Promise<AttemptResult> {
  const attempt = await deps.attempts.find(attemptId);
  if (attempt === undefined) {
    return { outcome: "rejected", rejection_reason: "worker_attempt_not_found" };
  }
  const storedOutcome = await deps.attempts.findOutcome(attemptId);
  const outcome = storedOutcome === undefined ? undefined : (JSON.parse(storedOutcome) as { outcome_state?: string; vendor_receipt_ref?: string });
  if (outcome?.outcome_state !== "received_with_receipt" || typeof outcome.vendor_receipt_ref !== "string") {
    return { outcome: "rejected", rejection_reason: "worker_outcome_not_received" };
  }
  const stored = await deps.receipts.find(outcome.vendor_receipt_ref);
  if (stored === undefined || stored.submission_attempt_id !== attemptId) {
    return { outcome: "rejected", rejection_reason: "worker_receipt_not_found" };
  }
  const receipt = stored.receipt;

  // An independently produced outcome, as the normalizer requires (D3-2):
  // the worker checks the stored receipt's signature against the
  // trust-anchor-signed key directory itself.
  const signingInput: IdentitySigningInput = {
    protocol_version: "codeattest.v0",
    signing_input_type: "vendor_receipt_identity",
    algorithm_profile: receipt.receipt_signature.algorithm_profile,
    signed_identity_type: "vendor_receipt",
    signed_identity: receipt.vendor_receipt_id,
    canonicalization: "rfc8785",
    identity_input_path: "v0/valid/vendor-receipt.identity-input.json"
  };
  const signatureOutcome = deps.verifier.verify({ envelope: receipt.receipt_signature, signing_input: signingInput, verified_at: deps.now() });

  const bundle = JSON.parse(attempt.bundle_manifest_body) as BundleManifest;
  const outbound = JSON.parse(attempt.approved_outbound_manifest_body) as OutboundManifest;
  const scopeReference = bundle.artifact_references.find((entry) => entry.artifact_type === "review_scope");
  const findingsReference = bundle.artifact_references.find((entry) => entry.artifact_type === "scanner_finding_set");
  if (scopeReference === undefined) {
    return { outcome: "rejected", rejection_reason: "worker_review_scope_absent" };
  }
  if (findingsReference === undefined) {
    return { outcome: "rejected", rejection_reason: "worker_scanner_finding_set_absent" };
  }
  const reviewScope = await readJsonArtifact(deps, job, attempt, scopeReference);
  const scannerFindingSet = await readJsonArtifact(deps, job, attempt, findingsReference);
  if (reviewScope === "not_found" || scannerFindingSet === "not_found") {
    return { outcome: "rejected", rejection_reason: "worker_artifact_unreadable" };
  }

  const presence = await deps.presence(bundle.artifact_references.map((entry) => entry.digest));
  const result = normalizeCandidateFindings({
    normalization_run_id: `normalization_run:${attemptId.replace(/^submission_attempt:/, "")}`,
    created_at: deps.now(),
    review_scope: reviewScope,
    scanner_finding_set: scannerFindingSet,
    bundle_manifest: bundle,
    outbound_manifest: outbound,
    vendor_receipt: receipt,
    vendor_receipt_signature_outcome: signatureOutcome,
    artifact_availability: availabilityFor(bundle.artifact_references, presence)
  });
  if (result.outcome === "rejected") {
    return { outcome: "rejected", rejection_reason: result.reason };
  }

  // The draft set carries scanner-derived text, so it is an encrypted object
  // like the scanner finding set it came from; SQL keeps only its digest.
  const bytes = new TextEncoder().encode(canonicalizeProtocolJson(result.draft_set));
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const classification: StoredObjectClassification = {
    protocol_version: "codeattest.v0",
    stored_object_ref: storedObjectRefFor(digest),
    object_kind: "evidence_artifact",
    source_derived_class: result.draft_set.source_derived_class,
    environment_profile: deps.environmentProfile
  };
  const put = await deps.artifacts.put({ digest, bytes, classification, reviewId: attempt.review_id });
  if (put.outcome === "encryption_unavailable") {
    throw new RetryableNormalizationError("the object store refused the draft set: encryption unavailable");
  }
  await deps.classifications.record(classification);
  return { outcome: "normalized", draft_set_digest: digest };
}

/**
 * Drains every queued `normalize_scanner_findings` job. Each job ends in one
 * recorded result: normalized (the draft set is stored) or rejected (with a
 * reason). A retryable failure returns the job to the queue and ends this pass,
 * because `fail()` un-claims the job and continuing would claim it again. A
 * job that has failed `maxAttempts` times is recorded as rejected.
 */
export async function drainNormalizeJobs(deps: NormalizeJobDeps): Promise<NormalizeDrainResult> {
  const maxAttempts = deps.maxAttempts ?? NORMALIZE_MAX_ATTEMPTS;
  const result: NormalizeDrainResult = { normalized: 0, rejected: 0, failed: [] };
  for (;;) {
    const job = await deps.jobs.claim(NORMALIZE_SCANNER_FINDINGS_JOB_TYPE);
    if (job === undefined) {
      return result;
    }
    const payload = parsePayload(job.payload);
    if (payload === undefined) {
      deps.log({ event: "normalize_job_payload_invalid", job_id: job.job_id });
      await deps.jobs.complete(job.job_id);
      continue;
    }
    if ((await deps.outcomes.find(payload.submission_attempt_id)) !== undefined) {
      await deps.jobs.complete(job.job_id);
      continue;
    }

    let attemptResult: AttemptResult;
    if (job.attempts > maxAttempts) {
      attemptResult = { outcome: "rejected", rejection_reason: "worker_attempts_exhausted" };
    } else {
      try {
        attemptResult = await normalizeAttempt(deps, job, payload.submission_attempt_id);
      } catch (error) {
        deps.log({ event: "normalize_job_failed", job_id: job.job_id, attempts: job.attempts, error: (error as Error).message });
        await deps.jobs.fail(job.job_id);
        result.failed.push(job.job_id);
        return result;
      }
    }

    const record: NormalizationOutcomeRecord = attemptResult.outcome === "normalized"
      ? { submission_attempt_id: payload.submission_attempt_id, review_id: payload.review_id, outcome: "normalized", draft_set_digest: attemptResult.draft_set_digest }
      : { submission_attempt_id: payload.submission_attempt_id, review_id: payload.review_id, outcome: "rejected", rejection_reason: attemptResult.rejection_reason };
    await deps.outcomes.record(record);
    await deps.jobs.complete(job.job_id);
    deps.log({ event: "normalize_job_recorded", job_id: job.job_id, ...record });
    if (attemptResult.outcome === "normalized") {
      result.normalized += 1;
    } else {
      result.rejected += 1;
    }
  }
}
