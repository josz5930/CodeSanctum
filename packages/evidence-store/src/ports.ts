import type {
  DeletionEvidence,
  EnvironmentEvidenceGate,
  EnvironmentReadinessDecision,
  EnvironmentReadinessEvidence,
  EvidenceLifecycleEvent,
  ReviewEvent,
  RetentionOptInRecord,
  StoredObjectClassification
} from "../../protocol-ts/src/index.js";

/**
 * The allowed branch of `enforceScopedAccess`'s result, declared structurally so
 * this workspace does not depend on `apps/control-plane`. Only a caller that
 * actually ran the access check can produce one, which is what makes
 * `ArtifactStore.get` impossible to reach without an access decision.
 */
export type AllowedAccess = {
  decision: "allowed";
  event: EvidenceLifecycleEvent;
};

/**
 * Mirrors the pure tier's convention: stable outcome strings rather than thrown
 * errors, so the host can map an outcome to an HTTP status without inspecting
 * exception types.
 */
export type AppendOutcome<TEvent> =
  | { outcome: "appended"; event: TEvent }
  | { outcome: "idempotent_noop"; event: TEvent }
  | { outcome: "rejected"; reason: AppendRejectionReason };

export type AppendRejectionReason =
  | "idempotency_key_body_conflict"
  | "sequence_number_not_monotonic"
  | "schema_invalid"
  | "storage_unavailable";

export interface ReviewEventLogStore {
  /** Bounded by contract: `review-event-log` caps `events` at 10000. */
  loadLog(reviewId: string): Promise<ReviewEvent[]>;
  append(reviewId: string, event: ReviewEvent): Promise<AppendOutcome<ReviewEvent>>;
}

/**
 * Read-only deployment-wide projection used by operational consumers such as
 * the demo budget meter. The append-only log remains the source of truth; this
 * adds no ledger and does not expose mutation outside the existing port.
 */
export interface TimestampedReviewEventLogStore extends ReviewEventLogStore {
  loadEventsByTimestampRange(startInclusive: string, endExclusive: string): Promise<ReviewEvent[]>;
}

export interface EvidenceLifecycleLogStore {
  loadLog(reviewId: string): Promise<EvidenceLifecycleEvent[]>;
  append(reviewId: string, event: EvidenceLifecycleEvent): Promise<AppendOutcome<EvidenceLifecycleEvent>>;
}

export type ArtifactPutInput = {
  digest: string;
  bytes: Uint8Array;
  classification: StoredObjectClassification;
  reviewId: string;
};

export type ArtifactGetResult =
  | { outcome: "read"; bytes: Uint8Array }
  | { outcome: "not_found" }
  | { outcome: "access_not_logged" }
  | { outcome: "decryption_failed" };

export type DeletionOutcome =
  | { outcome: "deleted"; evidence: DeletionEvidence }
  | { outcome: "not_verified"; evidence: DeletionEvidence };

export interface ArtifactStore {
  put(input: ArtifactPutInput): Promise<{ outcome: "stored" | "already_present" | "encryption_unavailable" }>;
  /**
   * Reading bytes requires an allowed access decision, and the decision's
   * lifecycle event is persisted in the same transaction that returns the
   * bytes. If the event cannot be written, the read fails.
   */
  get(input: { access: AllowedAccess; digest: string }): Promise<ArtifactGetResult>;
  delete(input: { digest: string; evidence: DeletionEvidence }): Promise<DeletionOutcome>;
  findDeletionEvidence(deletionEvidenceId: string): Promise<DeletionEvidence | undefined>;
}

export interface StoredObjectClassificationStore {
  record(classification: StoredObjectClassification): Promise<{ outcome: "recorded" | "already_present" }>;
  find(storedObjectRef: string): Promise<StoredObjectClassification | undefined>;
}

export interface RetentionRecordStore {
  record(record: RetentionOptInRecord): Promise<{ outcome: "recorded" | "already_present" }>;
  find(retentionRecordId: string): Promise<RetentionOptInRecord | undefined>;
  listDue(now: string): Promise<RetentionOptInRecord[]>;
}

export type JobRecord = {
  job_id: string;
  job_type: string;
  payload: string;
  attempts: number;
};

export interface JobQueue {
  enqueue(input: { job_id: string; job_type: string; payload: string }): Promise<{ outcome: "enqueued" | "already_present" }>;
  claim(jobType: string): Promise<JobRecord | undefined>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string): Promise<void>;
}

export interface EnvironmentGateStore {
  /** Gate records are append-only and versioned; this reads the highest version. */
  loadCurrent(): Promise<{ version: number; gate: EnvironmentEvidenceGate } | undefined>;
  recordVersion(input: { version: number; gate: EnvironmentEvidenceGate }): Promise<{ outcome: "recorded" | "version_conflict" }>;
}

export type IdentityRecordOutcome =
  | { outcome: "recorded" }
  | { outcome: "already_present" }
  | { outcome: "body_conflict" };

export interface ReadinessEvidenceStore {
  record(evidence: EnvironmentReadinessEvidence): Promise<IdentityRecordOutcome>;
  find(readinessEvidenceId: string): Promise<EnvironmentReadinessEvidence | undefined>;
}

export interface ReadinessDecisionStore {
  record(decision: EnvironmentReadinessDecision): Promise<IdentityRecordOutcome>;
  find(readinessDecisionId: string): Promise<EnvironmentReadinessDecision | undefined>;
}

export type EvidenceStorePorts = {
  reviewEventLog: ReviewEventLogStore;
  evidenceLifecycleLog: EvidenceLifecycleLogStore;
  artifacts: ArtifactStore;
  classifications: StoredObjectClassificationStore;
  retentionRecords: RetentionRecordStore;
  jobs: JobQueue;
  environmentGate: EnvironmentGateStore;
  readinessEvidence: ReadinessEvidenceStore;
  readinessDecisions: ReadinessDecisionStore;
};

export type { CanonicalRow } from "./canonical-row.js";
