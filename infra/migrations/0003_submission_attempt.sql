-- Sub-project B: in-flight submission attempts. A row here means "a credential
-- opened this attempt and these are the manifests it declared"; it does not
-- mean anything was received or accepted. Nothing in this table is customer
-- source-derived: artifact bytes live in the object store, not here.

CREATE TABLE submission_attempt (
  submission_attempt_id text PRIMARY KEY
    CHECK (submission_attempt_id ~ '^submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$'),
  review_id             text NOT NULL
    CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  tenant_id             text NOT NULL CHECK (length(tenant_id) > 0),
  token_key_id          text NOT NULL CHECK (length(token_key_id) > 0),
  manifest_id           text NOT NULL CHECK (manifest_id ~ '^sha256:[a-f0-9]{64}$'),
  evidence_bundle_id    text NOT NULL CHECK (evidence_bundle_id ~ '^sha256:[a-f0-9]{64}$'),
  bundle_manifest_body  text NOT NULL,
  signature_envelope_body text NOT NULL,
  customer_approval_body  text NOT NULL,
  approved_outbound_manifest_body text NOT NULL,
  opened_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE submission_attempt_outcome (
  submission_attempt_id text PRIMARY KEY
    REFERENCES submission_attempt (submission_attempt_id),
  outcome_body          text NOT NULL,
  outcome_body_query    jsonb GENERATED ALWAYS AS (outcome_body::jsonb) STORED,
  finalized_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON submission_attempt, submission_attempt_outcome TO codeattest_app;
