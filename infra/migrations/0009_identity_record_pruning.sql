-- Cleanup of identity records that no longer have an effect. Without it,
-- login_attempt gets one row for each sign-in attempt (junk identifiers
-- included) and the session tables get rows for each session, with no limit.
--
-- codeattest_app still gets no DELETE on these tables. It may only execute
-- this function, and the function decides which rows go: the retention period
-- is fixed here, not passed by the caller, so the application role cannot use
-- it to remove a live session or a recent attempt.
--
--   login_attempt   rows older than 30 days. The lockout reads 15 minutes;
--                   the "this network signed in before" check reads 30 days.
--   web_session     sessions whose absolute expiry was more than 30 days ago,
--                   with their activity and revocation rows. Such a session
--                   can never resolve again.
CREATE FUNCTION prune_identity_records()
RETURNS TABLE (login_attempts bigint, web_sessions bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cutoff timestamptz := now() - interval '30 days';
  attempts_removed bigint;
  sessions_removed bigint;
BEGIN
  DELETE FROM login_attempt WHERE occurred_at < cutoff;
  GET DIAGNOSTICS attempts_removed = ROW_COUNT;

  DELETE FROM web_session_activity a
   USING web_session s
   WHERE a.session_handle = s.session_handle AND s.absolute_expires_at < cutoff;
  DELETE FROM web_session_revocation r
   USING web_session s
   WHERE r.session_handle = s.session_handle AND s.absolute_expires_at < cutoff;
  DELETE FROM web_session WHERE absolute_expires_at < cutoff;
  GET DIAGNOSTICS sessions_removed = ROW_COUNT;

  RETURN QUERY SELECT attempts_removed, sessions_removed;
END
$$;

REVOKE ALL ON FUNCTION prune_identity_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prune_identity_records() TO codeattest_app;

-- The cleanup deletes by age; the existing index starts with identifier_hash.
CREATE INDEX login_attempt_occurred_at ON login_attempt (occurred_at);
CREATE INDEX web_session_absolute_expires_at ON web_session (absolute_expires_at);
