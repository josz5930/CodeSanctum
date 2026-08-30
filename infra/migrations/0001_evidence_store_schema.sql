-- Evidence store schema. Canonical artifact bodies are stored as `text` holding
-- exact RFC 8785 bytes. `body_query` exists only for indexing and filtering:
-- jsonb orders keys by length-then-bytes while JCS orders by UTF-16 code unit,
-- and jsonb renormalizes numbers, so reconstructing from it would change the
-- bytes and break every sha256 identity.

CREATE TABLE schema_migration (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_event (
  review_id        text    NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  sequence_number  integer NOT NULL CHECK (sequence_number >= 0),
  idempotency_key  text    NOT NULL CHECK (length(idempotency_key) > 0),
  event_id         text    NOT NULL CHECK (event_id ~ '^sha256:[a-f0-9]{64}$'),
  body             text    NOT NULL,
  body_query       jsonb   GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, sequence_number),
  UNIQUE (review_id, idempotency_key)
);

CREATE TABLE evidence_lifecycle_event (
  review_id        text    NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  sequence_number  integer NOT NULL CHECK (sequence_number >= 0),
  idempotency_key  text    NOT NULL CHECK (length(idempotency_key) > 0),
  event_digest     text    NOT NULL CHECK (event_digest ~ '^sha256:[a-f0-9]{64}$'),
  body             text    NOT NULL,
  body_query       jsonb   GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, sequence_number),
  UNIQUE (review_id, idempotency_key)
);

CREATE TABLE stored_object_classification (
  stored_object_ref text PRIMARY KEY,
  body              text  NOT NULL,
  body_query        jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retention_opt_in_record (
  retention_record_id text PRIMARY KEY,
  body                text  NOT NULL,
  body_query          jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deletion_evidence (
  deletion_evidence_id text PRIMARY KEY,
  body                 text  NOT NULL,
  body_query           jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifact_reference (
  digest      text PRIMARY KEY CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  review_id   text NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  size_bytes  bigint NOT NULL CHECK (size_bytes >= 0),
  body        text  NOT NULL,
  body_query  jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE environment_evidence_gate (
  version     integer PRIMARY KEY CHECK (version >= 1),
  body        text  NOT NULL,
  body_query  jsonb GENERATED ALWAYS AS (body::jsonb) STORED,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Schema support for the signed chain-head anchors that sub-project F publishes
-- off-box, so a silent history rewrite stays detectable after a box compromise.
CREATE TABLE chain_head_anchor (
  review_id      text NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  head_event_id  text NOT NULL CHECK (head_event_id ~ '^sha256:[a-f0-9]{64}$'),
  anchored_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, head_event_id)
);

-- The only mutable table besides schema_migration: queue state legitimately
-- transitions.
CREATE TABLE job (
  job_id      text PRIMARY KEY,
  job_type    text NOT NULL,
  payload     text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  claimed_at  timestamptz,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_claimable ON job (job_type) WHERE claimed_at IS NULL;
