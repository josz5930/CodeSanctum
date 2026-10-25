-- Reviewer classifications of normalized finding drafts (P3). Append-only:
-- codeattest_app gets SELECT and INSERT, never UPDATE or DELETE. A changed
-- judgment is a new record whose classification_recorded event supersedes the
-- earlier one; nothing here is rewritten.
--
-- record_body is the protocol finding-classification-record as canonical
-- JSON. It holds reviewer text and evidence references, never source-derived
-- bytes: the control-plane rejects source-code content in every text field,
-- and the draft set it classifies stays an encrypted object.
CREATE TABLE finding_classification_record (
  classification_record_id text PRIMARY KEY
    CHECK (classification_record_id ~ '^classification_record:[a-z0-9][a-z0-9_-]{2,63}$'),
  review_id                text NOT NULL CHECK (review_id ~ '^review:[a-z0-9][a-z0-9_-]{2,63}$'),
  review_finding_draft_ref text NOT NULL
    CHECK (review_finding_draft_ref ~ '^review_finding_draft:[a-z0-9][a-z0-9_-]{2,63}$'),
  -- The normalized draft set the record was bound to when it was made.
  draft_set_digest         text NOT NULL CHECK (draft_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  record_body              text NOT NULL,
  recorded_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX finding_classification_record_review ON finding_classification_record (review_id);

GRANT SELECT, INSERT ON finding_classification_record TO codeattest_app;
