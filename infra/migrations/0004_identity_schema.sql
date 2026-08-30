-- Sub-project C: identity and session. Every table here is append-only, so
-- codeattest_app never needs an UPDATE grant outside `job` and the boot
-- self-test in the A2 ladder stays meaningful. Logout is a revocation row;
-- idle timeout is the absence of a recent activity row; credential rotation is
-- a new row plus a revocation row. Nothing here is customer source-derived.

CREATE TABLE tenant (
  tenant_id    text PRIMARY KEY CHECK (tenant_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  display_name text NOT NULL CHECK (length(display_name) > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account (
  account_id     text PRIMARY KEY CHECK (account_id ~ '^account:[a-z0-9][a-z0-9_-]{2,63}$'),
  tenant_id      text NOT NULL REFERENCES tenant (tenant_id),
  -- The login identifier, lowercased at write time. It is the only
  -- customer-identifying value in this schema; it is not evidence and never
  -- appears in a protocol artifact.
  identifier     text NOT NULL UNIQUE CHECK (identifier = lower(identifier) AND length(identifier) > 0),
  -- `scrypt$N$r$p$saltHex$hashHex`. Never a plaintext password.
  secret_hash    text NOT NULL CHECK (secret_hash LIKE 'scrypt$%'),
  -- AES-256-GCM box over the TOTP secret, or NULL when not enrolled.
  totp_secret_box text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_role_grant (
  grant_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id   text NOT NULL REFERENCES account (account_id),
  role         text NOT NULL CHECK (role IN (
                 'customer_admin', 'customer_viewer', 'codeattest_reviewer',
                 'codeattest_ops', 'evidence_consumer_static')),
  -- NULL means "every review in this account's tenant". A concrete review id
  -- narrows the grant to that review.
  review_scope text CHECK (review_scope IS NULL OR review_scope ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  granted_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, role, review_scope)
);

CREATE TABLE web_session (
  -- SHA-256 of the cookie token. The token itself is never stored, so a
  -- database read yields nothing usable.
  session_handle      text PRIMARY KEY CHECK (session_handle ~ '^[a-f0-9]{64}$'),
  account_id          text NOT NULL REFERENCES account (account_id),
  issued_at           timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  -- `pending` is a session that authenticated a password but has not yet
  -- satisfied its TOTP factor. It resolves, so the second-factor route can find
  -- it, but Task 8's resolver refuses it for everything else. Upgrading is a new
  -- row plus a revocation of this one, never an UPDATE.
  second_factor_state text NOT NULL CHECK (second_factor_state IN ('not_required', 'pending', 'satisfied'))
);

CREATE TABLE web_session_revocation (
  session_handle text PRIMARY KEY REFERENCES web_session (session_handle),
  revoked_at     timestamptz NOT NULL DEFAULT now(),
  reason         text NOT NULL CHECK (reason IN ('logout', 'operator_revoked', 'rotated'))
);

CREATE TABLE web_session_activity (
  activity_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_handle text NOT NULL REFERENCES web_session (session_handle),
  occurred_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX web_session_activity_recent
  ON web_session_activity (session_handle, occurred_at DESC);

CREATE TABLE login_attempt (
  attempt_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SHA-256 of the lowercased submitted identifier, so a flood of junk logins
  -- cannot fill this table with attacker-chosen text and the counter still
  -- works for identifiers that match no account.
  identifier_hash text NOT NULL CHECK (identifier_hash ~ '^[a-f0-9]{64}$'),
  outcome         text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempt_recent ON login_attempt (identifier_hash, occurred_at DESC);

CREATE TABLE submission_credential (
  token_key_id                text PRIMARY KEY CHECK (length(token_key_id) > 0),
  review_id                   text NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  tenant_id                   text NOT NULL REFERENCES tenant (tenant_id),
  customer_id                 text NOT NULL CHECK (length(customer_id) > 0),
  selected_application_id     text NOT NULL CHECK (length(selected_application_id) > 0),
  selected_commit             text NOT NULL CHECK (selected_commit ~ '^[a-f0-9]{40}$'),
  repository_identity_hash    text NOT NULL CHECK (repository_identity_hash ~ '^sha256:[a-f0-9]{64}$'),
  expected_manifest_id        text NOT NULL CHECK (expected_manifest_id ~ '^sha256:[a-f0-9]{64}$'),
  expected_evidence_bundle_id text CHECK (expected_evidence_bundle_id IS NULL OR expected_evidence_bundle_id ~ '^sha256:[a-f0-9]{64}$'),
  secret_hash                 text NOT NULL CHECK (secret_hash LIKE 'scrypt$%'),
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL
);

CREATE TABLE submission_credential_revocation (
  token_key_id text PRIMARY KEY REFERENCES submission_credential (token_key_id),
  revoked_at   timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL CHECK (reason IN ('rotated', 'operator_revoked', 'review_closed'))
);

GRANT SELECT, INSERT ON
  tenant,
  account,
  account_role_grant,
  web_session,
  web_session_revocation,
  web_session_activity,
  login_attempt,
  submission_credential,
  submission_credential_revocation
TO codeattest_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO codeattest_app;
