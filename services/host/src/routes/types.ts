import type {
  AllowedAccess,
  ArtifactStore,
  JobQueue,
  ReviewEventLogStore,
  StoredObjectClassificationStore
} from "../../../../packages/evidence-store/src/index.js";
import type { EnvironmentEvidenceGate } from "../../../../packages/protocol-ts/src/index.js";
import type { ErrorEnvelopeBody } from "../error-envelope.js";
import type { KeyService } from "../signing/key-service.js";
import type { SubmissionCredentialStore } from "../submission/credential-store.js";
import type { BudgetMeter } from "../submission/budget-meter.js";
import type { SubmissionArtifactReference } from "../submission/access.js";
import type { SubmissionAttemptRecord, SubmissionAttemptStore } from "../submission/attempt-state.js";
import type { AppendSubmissionReviewEventInput, AppendSubmissionReviewEventResult } from "../submission/review-events.js";

/**
 * The complete dependency surface every submission route phase uses.
 * Declared once so later phases add handlers rather than re-opening this
 * file's shape; fields are added here only when a phase actually needs them.
 */
export type SubmissionRouteDeps = {
  credentials: SubmissionCredentialStore;
  attempts: SubmissionAttemptStore;
  artifacts: ArtifactStore;
  classifications: StoredObjectClassificationStore;
  reviewEventLog: ReviewEventLogStore;
  jobs: JobQueue;
  budget: BudgetMeter;
  /** Injectable so tier delays are deterministic without slowing tests. */
  slowdown?: (milliseconds: number) => Promise<void>;
  /** Bound at boot (spec section 5.6 step 3). Never read from a request. */
  boundGate: EnvironmentEvidenceGate;
  keyService: KeyService;
  errorEnvelope: (reasonCode: string) => ErrorEnvelopeBody;
  /** Injected so tests can pin timestamps. Returns UTC RFC 3339. */
  now: () => string;
  /**
   * Composed in the boot composition root: runs the scoped-access boundary as
   * the intake service actor. Returns `undefined` when the artifact has not
   * been received yet (or access was denied).
   */
  mintSubmissionAccess: (attempt: SubmissionAttemptRecord, reference: SubmissionArtifactReference) => Promise<AllowedAccess | undefined>;
  /** Composed in the boot composition root: appends through the control-plane's pure appender. */
  appendSubmissionReviewEvent: (input: AppendSubmissionReviewEventInput) => Promise<AppendSubmissionReviewEventResult>;
};
