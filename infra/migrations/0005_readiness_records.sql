-- G Task 2: append-only environment readiness evidence and decision records.
-- Canonical bodies are stored as `text` holding exact RFC 8785 bytes. Identity
-- is the content-addressed protocol id; a repeated identity with a different
-- body is a rewrite and is rejected by the adapters rather than overwritten.

CREATE TABLE environment_readiness_evidence (
  readiness_evidence_id text PRIMARY KEY CHECK (readiness_evidence_id ~ '^sha256:[a-f0-9]{64}$'),
  body                  text  NOT NULL,
  body_query            jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE environment_readiness_decision (
  readiness_decision_id text PRIMARY KEY CHECK (readiness_decision_id ~ '^sha256:[a-f0-9]{64}$'),
  body                  text  NOT NULL,
  body_query            jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON
  environment_readiness_evidence,
  environment_readiness_decision
TO codeattest_app;
