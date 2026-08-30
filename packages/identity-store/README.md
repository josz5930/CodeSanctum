# Identity Store Package

Accounts, sessions, login throttling, TOTP enrollment, and runner submission credentials for CodeAttest. Memory and Postgres adapters implement one shared port suite (`src/ports.ts`); the host consumes those ports and never talks to the identity tables directly.

This is a private-capable vendor package. **Nothing here is a protocol artifact**, and nothing here may become one without starting in `protocol/`. Identifiers, hashes, session handles, and credential material stay on this side of the evidence boundary.

## What lives here

Four ports, each with a memory adapter (tests) and a Postgres adapter (durable), proven identical by `test/identity-contract.mjs`:

- `AccountStore` — tenant, account, and role-grant lookup. Accounts are operator-provisioned (`scripts/provision-identity.mjs`); there is no self-service signup.
- `SessionStore` — issue, resolve, touch, and revoke opaque sessions. The cookie carries 32 random bytes; the database stores only their SHA-256 (`session_handle`).
- `LoginThrottle` — five failed logins within fifteen minutes lock an identifier. A locked identifier is indistinguishable from a wrong password.
- `SubmissionCredentialStore` — issue, resolve, and revoke runner submission credentials. Replaces B's config-file adapter behind the same interface.

Supporting modules:

- `src/secret-hash.ts` — scrypt password hashing. Parameters live in `SCRYPT_PARAMETERS` (`N=32768`, `r=8`, `p=1`, `keyLength=32`) and are written into the hash string (`scrypt$N$r$p$saltHex$hashHex`), so raising them later is a write-time change with no migration.
- `src/session-token.ts` — mint a cookie token and its stored handle.
- `src/totp.ts` — RFC 6238 TOTP (HMAC-SHA1, 30s step, ±1 window) and AES-256-GCM boxing of the enrollment secret.
- `src/actor.ts` — map an account's grants onto a protocol `actor` reference for `enforceScopedAccess`. That mapping is projection, not a new protocol type.

## Invariants enforced here, not by convention

- **Every identity table is append-only.** `tenant`, `account`, `account_role_grant`, `web_session`, `web_session_revocation`, `web_session_activity`, `login_attempt`, `submission_credential`, and `submission_credential_revocation` accept `INSERT`/`SELECT` only for `codeattest_app`. Logout is a revocation row; idle timeout is the absence of a recent activity row; credential rotation is a new row plus a revocation row. `test/postgres-identity-grants.test.mjs` proves `UPDATE` and `DELETE` are permission-denied.
- **No plaintext secrets at rest.** Passwords and submission secrets are scrypt hashes. TOTP secrets are AES-256-GCM boxes. Session tokens are never stored.
- **Not protocol.** These records are operator/runtime state. They must not appear in fixtures, schemas, Attestations, or customer-visible projections unless a later sub-project starts that change in `protocol/`.

## Tests

Tests compile this workspace via `tsc` into a cache (`test/helpers/compile.mjs`) and import the emitted `.js`. The Postgres tests skip cleanly when no database is reachable, so `npm run ci` passes on a machine without Docker. Start the local database with `docker compose -f infra/local/compose.yaml up -d` to exercise them.

## Dependency direction

Depends only on `@onevps/protocol-ts` (by deep relative path) and `pg` (already in this monorepo; no new dependency). Source adapters take the same structural `SqlExecutor` type evidence-store uses, rather than importing `pg` types.
