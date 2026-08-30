-- Append-only is a grant, not a convention. codeattest_app may insert and read
-- history but may never rewrite it, and because it does not own the tables it
-- cannot ALTER away its own restrictions. codeattest_migrator owns all DDL.
--
-- The password here is a synthetic-only local-development literal. Real
-- deployments create this role with credentials from their mode-0600 config.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'codeattest_app') THEN
    CREATE ROLE codeattest_app LOGIN PASSWORD 'synthetic_demo_local_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO codeattest_app;

GRANT SELECT, INSERT ON
  review_event,
  evidence_lifecycle_event,
  stored_object_classification,
  retention_opt_in_record,
  deletion_evidence,
  artifact_reference,
  environment_evidence_gate,
  chain_head_anchor
TO codeattest_app;

-- The queue is the one place where state legitimately transitions.
GRANT SELECT, INSERT, UPDATE, DELETE ON job TO codeattest_app;

GRANT SELECT ON schema_migration TO codeattest_app;
