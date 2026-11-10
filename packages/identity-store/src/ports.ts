export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const LOGIN_LOCKOUT_THRESHOLD = 5;
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/**
 * Failed password attempts for one identifier, from all client networks
 * together, in one lockout window. At this count the identifier accepts a
 * sign-in only from a client network that signed in to it before.
 */
export const LOGIN_ACCOUNT_FAILURE_THRESHOLD = 20;

export type AccountRecord = {
  account_id: string;
  tenant_id: string;
  identifier: string;
  secret_hash: string;
  totp_secret_box: string | null;
};

export type RoleGrant = {
  account_id: string;
  role: "customer_admin" | "customer_viewer" | "codeattest_reviewer" | "codeattest_ops" | "evidence_consumer_static";
  review_scope: string | null;
};

export type SecondFactorState = "not_required" | "pending" | "satisfied";

export type ResolvedSession = {
  session_handle: string;
  account_id: string;
  second_factor_state: SecondFactorState;
};

export type IssueSessionInput = {
  session_handle: string;
  account_id: string;
  issued_at: Date;
  absolute_expires_at: Date;
  second_factor_state: SecondFactorState;
};

export type RevocationReason = "logout" | "operator_revoked" | "rotated";

export interface AccountStore {
  findByIdentifier(identifier: string): Promise<AccountRecord | undefined>;
  findById(accountId: string): Promise<AccountRecord | undefined>;
  grantsFor(accountId: string): Promise<RoleGrant[]>;
  /**
   * Records that a TOTP time step was used to sign in. Returns "replayed" when
   * this step, or a later one, was already used for the account, so one code
   * can never sign in twice (RFC 6238 section 5.2).
   */
  claimTotpStep(accountId: string, step: number): Promise<"claimed" | "replayed">;
}

export interface SessionStore {
  issue(input: IssueSessionInput): Promise<{ outcome: "issued" }>;
  resolve(handle: string, now: Date): Promise<ResolvedSession | undefined>;
  touch(handle: string, now: Date): Promise<void>;
  revoke(handle: string, reason: RevocationReason): Promise<void>;
  revokeAllForAccount(accountId: string, reason: RevocationReason): Promise<void>;
}

/**
 * Counts failed logins per key. The key is a 64-character lowercase hex
 * SHA-256. The host uses three kinds of key: the identifier together with the
 * client network (one client's failures do not lock the account for every
 * other client), the identifier alone (a cap on guesses from many networks),
 * and the account's second factor.
 */
export interface LoginThrottle {
  /** "locked" when `failures` is at LOGIN_LOCKOUT_THRESHOLD or more. */
  state(throttleKey: string, now: Date): Promise<"open" | "locked">;
  /**
   * The failures recorded for the key in the lockout window that ends at
   * `now`. A success recorded for the key starts the count again.
   */
  failures(throttleKey: string, now: Date): Promise<number>;
  /** True when a success is on record for the key. */
  hasSucceeded(throttleKey: string): Promise<boolean>;
  record(throttleKey: string, outcome: "succeeded" | "failed"): Promise<void>;
}

export type SubmissionCredential = {
  token_key_id: string;
  review_id: string;
  tenant_id: string;
  customer_id: string;
  selected_application_id: string;
  selected_commit: string;
  repository_identity_hash: string;
  expected_manifest_id: string;
  expected_evidence_bundle_id?: string;
  secret_hash: string;
};

export type IssueSubmissionCredentialInput = {
  token_key_id: string;
  review_id: string;
  tenant_id: string;
  customer_id: string;
  selected_application_id: string;
  selected_commit: string;
  repository_identity_hash: string;
  expected_manifest_id: string;
  expected_evidence_bundle_id?: string;
  secret_hash: string;
  issued_at: Date;
  expires_at: Date;
};

export type CredentialRevocationReason = "rotated" | "operator_revoked" | "review_closed";

export interface SubmissionCredentialStore {
  issue(input: IssueSubmissionCredentialInput): Promise<void>;
  resolve(tokenKeyId: string, now: Date): Promise<SubmissionCredential | undefined>;
  revoke(tokenKeyId: string, reason: CredentialRevocationReason): Promise<void>;
}
