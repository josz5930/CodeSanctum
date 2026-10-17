-- Records the background worker reads and writes. Every table is append-only:
-- codeattest_app gets SELECT and INSERT, never UPDATE or DELETE. None of these
-- rows holds source-derived bytes; the draft set itself is an encrypted object
-- in the object store, and SQL keeps only its digest.

-- The signed Vendor Receipt that a finalize minted. The submission outcome
-- keeps only vendor_receipt_ref, but the worker needs the whole receipt to
-- check its signature and to normalize findings against it. A replayed
-- finalize that crashed before its outcome was recorded mints a new receipt,
-- so one attempt can have more than one row; the outcome's vendor_receipt_ref
-- names the one that counts.
CREATE TABLE submission_vendor_receipt (
  vendor_receipt_id     text PRIMARY KEY CHECK (vendor_receipt_id ~ '^sha256:[a-f0-9]{64}$'),
  submission_attempt_id text NOT NULL REFERENCES submission_attempt (submission_attempt_id),
  receipt_body          text NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now()
);

-- One normalization result per received submission attempt. A rejected run
-- records why; a normalized run records the content-addressed draft set object.
CREATE TABLE finding_normalization_outcome (
  submission_attempt_id text PRIMARY KEY REFERENCES submission_attempt (submission_attempt_id),
  review_id             text NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  outcome               text NOT NULL CHECK (outcome IN ('normalized', 'rejected')),
  rejection_reason      text CHECK (rejection_reason ~ '^[a-z][a-z0-9_]{2,95}$'),
  draft_set_digest      text CHECK (draft_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (outcome = 'normalized' AND draft_set_digest IS NOT NULL AND rejection_reason IS NULL)
    OR (outcome = 'rejected' AND draft_set_digest IS NULL AND rejection_reason IS NOT NULL)
  )
);

CREATE INDEX finding_normalization_outcome_review ON finding_normalization_outcome (review_id);

-- Each transparency checkpoint published to the off-box anchor and read back
-- from it (F-9). chain_head_anchor (0001) holds the review heads it covered.
CREATE TABLE transparency_checkpoint_publication (
  checkpoint_id text PRIMARY KEY CHECK (checkpoint_id ~ '^[a-f0-9]{64}$'),
  merkle_root   text NOT NULL CHECK (merkle_root ~ '^[a-f0-9]{64}$'),
  tree_size     integer NOT NULL CHECK (tree_size >= 0),
  -- Kept as the exact RFC 3339 text that was published: checkpoint_id hashes
  -- this string, so a timestamptz round trip could change it.
  published_at  text NOT NULL CHECK (published_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$'),
  anchor_ref    text NOT NULL CHECK (length(anchor_ref) > 0),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON
  submission_vendor_receipt,
  finding_normalization_outcome,
  transparency_checkpoint_publication
TO codeattest_app;
