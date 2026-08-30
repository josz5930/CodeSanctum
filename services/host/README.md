# Host

The Fastify host and composition root for sub-project A, the runtime spine. Turns `@onevps/evidence-store`'s ports and adapters into a running process that boots through six fail-closed steps — config, migration-head check, environment-gate binding, object-store verification, a database grant self-test, then serving — and refuses to start if any step fails. See [`docs/codeattest-technical-architecture.md`](../../docs/codeattest-technical-architecture.md) for how the host fits the overall component map.

## What lives here

Each boot step is a small, independently tested function (`src/config.ts`, `src/migration-check.ts`, `src/gate-binding.ts`, `src/object-store-check.ts`, `src/grant-self-test.ts`), sequenced by `src/boot.ts`. `src/server.ts` is the Fastify host itself — `/healthz` and `/readyz` plus the B and C routes registered from `src/main.ts`. `src/main.ts` is the untested process entry point that wires real Postgres pools together and calls the tested pieces, mirroring `scripts/run-migrations.mjs`'s pattern of "exported functions are tested, the CLI entry point is not".

## Scope

This workspace originally shipped no business endpoints; sub-project B added the submission transport routes and sub-project C added identity/session routes, both documented below. It binds to loopback only. The web application (E) builds a browser surface on top of this host in its own sub-project.

## Sub-project B boundary

B adds the three-phase submission transport: `POST /v0/submissions` (open), `PUT /v0/submissions/{id}/artifacts/{digest}` (one per artifact), and `POST /v0/submissions/{id}/finalize` (mint the receipt, record the outcome, enqueue the worker job). It ships the `SubmissionCredentialStore` and `BudgetMeter` ports (`src/submission/credential-store.ts`, `src/submission/budget-meter.ts`), and composes `enforceScopedAccess` and the review-event append boundary into the finalize route (`src/submission/access.ts`, `src/submission/review-events.ts`). B originally backed credentials from the host config file; C replaced that adapter with the Postgres store in `@onevps/identity-store` behind the same `SubmissionCredentialStore` interface. F replaces the demo deployment's static meter at composition time, as documented below.

What B explicitly does not add: no browser surface, no authentication of humans, no TLS, no internet exposure — the host still binds to loopback only. Receipts are signed with the real ML-DSA-65 managed key D2 wired into boot (`src/signing/key-service.ts`); the boot-bound environment-evidence gate is still read-only here, unwidened by anything in this sub-project.

## Sub-project C boundary

C adds human authentication and session-backed evidence access on this host:

- `POST /v0/auth/login`, `POST /v0/auth/login/second-factor`, `POST /v0/auth/logout`, `GET /v0/auth/session`
- RFC 6238 TOTP for `codeattest_reviewer` (and any account with an enrolled box)
- `__Host-codeattest_session` cookies (`Secure`, `HttpOnly`, `SameSite=Strict`); insecure cookies are loopback-only and refused off loopback at boot
- `requireEvidenceAccess` — the only path from a session to `enforceScopedAccess`; routes under `src/routes/` must not call the access check directly
- Database-backed submission credentials via `@onevps/identity-store`

TOTP secret boxes are opened with 32 raw bytes at `$CREDENTIALS_DIRECTORY/${encryption_key_ref}`. Operators must place that file before first boot; `encryption_key_ref` is a bare credential file name (the same restriction as `signing.credential_name`). A missing file or a file that is not exactly 32 bytes exits the process. Tests inject `totpKey` and do not read this path.

What C explicitly does not add: no self-service signup, no email, no password reset by email, no OAuth/SSO, no TLS termination (F), no browser UI (E). Accounts are operator-provisioned with `scripts/provision-identity.mjs`. C returns JSON and sets cookies; E renders the login form.

## Sub-project E boundary

E adds a **read-only** `web` route group (`src/routes/web.ts`) behind C's `registerActorResolution` preHandler, consumed by the `@onevps/web` browser surface:

- `GET /web/context`, `GET /web/reviews`, `GET /web/reviews/:reviewScope`, `GET /web/reviews/:reviewScope/findings`, `GET /web/reviews/:reviewScope/attestation`
- Every review-scoped route runs the same `gateReviewScope` helper: C's `requireEvidenceAccess`, one persisted `evidence_accessed` event, then `selectGrant` for the audience — routes never call `enforceScopedAccess` directly
- Each route resolves `request.actor`, runs `@onevps/ui` builders server-side (`src/web/project-*.ts`), and returns the serializable view **contract** as JSON; the browser never receives raw evidence, the database, or the session secret
- Audience is derived from the grant's role, never the request, so `internal_only` timeline entries and the internal-only pilot-learning contract never reach a customer

What E explicitly does not add: no new evidence vocabulary, no protocol records, and no mutation surface. The finding/verification/attestation/static-bundle records these routes project come from a read-only `ReviewRecordSet` port (`src/web/record-store.ts`); production wires an empty in-memory store, and tests seed it from the synthetic-demo protocol fixtures.

## Sub-project F boundary

F's budget phase replaces the demo deployment's config-backed spend ratio with
`createEventDerivedBudgetMeter`. It counts the current UTC calendar month's
finalized submission projections (`receipt_issued`, `submission_rejected`, and
`submission_quarantined`) from the append-only review-event log, multiplies by
the configured unit cost, divides by `demo_budget_meter.monthly_unit_ceiling`,
and clamps the result to `[0, 1]`. The additive meter config defaults closed:
without explicit values, one billable event consumes the one-unit ceiling.

Submission intake emits structured warnings and applies a modest, testable
slowdown with `Retry-After` at 50%, 75%, and 90%. The existing 95% intake
cutoff remains unchanged. At 100%, the demo host returns a `budget_halted` 503
envelope from `/v0/*` and `/web/*` while `/healthz` and `/readyz` stay up.
Pilot uses a no-op meter and never evaluates the halt guard. Every served
request emits a structured, low-cardinality metric carrying its route template,
status, and latency; `/readyz` state transitions emit a separate availability
metric. [`SLO.md`](./SLO.md) defines readiness, intake-success, and submission
latency objectives. The loopback checker and per-deployment timer evaluate
those records without adding a metrics stack.

The focused `delivery:f-check` command proves the meter, tiers, halt wiring, a
valid demo budget config through the boot ladder, metric redaction, the SLO
evaluator, and the deployment templates/scripts without editing an environment-
gate row. The deploy surface under `infra/deploy/` runs separate demo/pilot
host and web processes behind Caddy on native disk. Live provisioning remains
an operator action, and the pilot stays metadata-only until G records the
separate evidence-backed gate raise.

## Dependency direction

Depends on `@onevps/evidence-store`, `@onevps/identity-store`, `@onevps/protocol-ts`, `@onevps/signing`, `@onevps/control-plane`, and `@onevps/intake-service`. Does not import `pg` directly — `@onevps/evidence-store` and `@onevps/identity-store` are the sanctioned `pg` consumers; this workspace gets a Postgres-backed `SqlExecutor` from evidence-store's `createPostgresPool`.

## Known limitations

- **`/readyz` does not probe Postgres liveness per request.** It currently reports ready based only on whether the boot sequence completed and SIGTERM hasn't been received. A database that becomes unreachable after boot is not reflected until the process notices some other way. Design doc section 5.7 calls for `/readyz` to fail when Postgres is unavailable; this is a follow-up for whichever sub-project first adds routes that actually read/write evidence.
- **The object-store encryption check (boot step 4) now probes the backing mount.** It still requires the operator's `object_store_encrypted` flag to match `encryption_at_rest_ready`, and when either is true it also requires `findmnt` to report a mapper/crypt backing device for the object root. A declaration without an encrypted mount fails closed. Source-derived object bytes are additionally envelope-encrypted when `object_store_envelope_key_ref` is present in the host config.
