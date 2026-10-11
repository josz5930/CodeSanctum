-- TOTP replay protection: one TOTP code must sign in only once (RFC 6238
-- section 5.2). Each accepted time step is a new row; the route accepts a step
-- only when it is later than every step already used for the account. Append-only
-- like the rest of the identity schema, so codeattest_app gets no UPDATE or DELETE.

CREATE TABLE totp_step_use (
  account_id text NOT NULL REFERENCES account (account_id),
  -- RFC 6238 time-step counter: floor(unix seconds / 30).
  step       bigint NOT NULL CHECK (step >= 0),
  used_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, step)
);

GRANT SELECT, INSERT ON totp_step_use TO codeattest_app;
