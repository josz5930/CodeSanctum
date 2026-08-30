# Evidence Store Package

Durable persistence ports and adapters for CodeAttest's pure library tier. This package gives the review/evidence/classification/retention/gate/job logic in `apps/control-plane` (and future host tiers) an append-only, access-logged place to live, without those pure functions ever reaching a database, filesystem, or queue directly.

This is a private-capable vendor package. It is the only `@onevps/*` workspace that may import a database client (`pg`) and Node core I/O modules. The pure tier consumes these ports by interface; it never imports an adapter.

## What lives here

Seven ports, each with a memory adapter (tests and local development) and a durable adapter (Postgres for records, content-addressed filesystem for artifact bytes), proven identical by one shared contract suite:

- `ReviewEventLogStore`, `EvidenceLifecycleLogStore` — append-only event logs.
- `ArtifactStore` — content-addressed bytes; reads require an allowed access decision whose lifecycle event is persisted in the same operation that returns the bytes.
- `StoredObjectClassificationStore`, `RetentionRecordStore` — write-once-by-identity records.
- `EnvironmentGateStore` — append-only, versioned; raising the evidence boundary is an audit record, not an update.
- `ReadinessEvidenceStore`, `ReadinessDecisionStore` — content-addressed, insert-only readiness records; same-body replays are no-ops and a different body under an existing identity is a rewrite.
- `JobQueue` — `FOR UPDATE SKIP LOCKED` claiming with `NOTIFY` wakeups.

See `src/ports.ts` for the interfaces and `src/memory/` and `src/postgres/` for the mirroring adapters. `src/canonical-row.ts` is the JCS text↔row helper that guards the text-not-jsonb storage decision.

## Invariants enforced here, not by convention

- **Append-only history** is enforced by Postgres role grants (`infra/migrations/0002_roles_and_grants.sql`): `codeattest_app` holds `INSERT`/`SELECT` on history tables and `UPDATE`/`DELETE` on `job` alone, and does not own the tables so it cannot `ALTER` away its limits. `test/postgres-grants.test.mjs` proves `UPDATE`, `DELETE`, and `ALTER` are all denied.
- **Text, not jsonb.** Canonical artifact bodies are stored as `text` holding exact RFC 8785 bytes. `jsonb` reorders keys and renormalizes numbers, which would change the bytes and break every sha256 identity. The generated `jsonb` column is for indexing only; `test/digest-roundtrip.test.mjs` asserts stored bytes are byte-identical to the canonical body and that `jsonb` reconstruction differs.
- **Non-bypassable access logging.** `ArtifactStore.get` is the only door to bytes and it demands an `AllowedAccess` decision whose event is appended before any bytes are returned; a rejected append fails the read (`access_not_logged`).
- **Dual-write ordering.** Bytes before records: orphaned bytes are inert, dangling references are not. Deletion is the mirror image — record intent, delete bytes, confirm absence by re-read.
- **Envelope encryption.** `transient_source_derived` and `customer_opt_in_retained_source` bytes are AES-256-GCM wrapped with a deployment-scoped key loaded through the credential boundary and kept outside the object tree. A missing key refuses the put; a wrong key refuses the read. Review artifacts that are not source-derived remain unwrapped.
- **Deletion evidence is append-only.** An unverified attempt is recorded first; a later verified result is a new row with `supersedes_deletion_evidence_ref`. The Postgres adapter never UPDATEs deletion evidence. Retention expiry and operator deletion share that boundary.

## Tests

Tests compile this workspace via `tsc` into a cache (`test/helpers/compile.mjs`, mirroring the pattern in `apps/control-plane/test/`) and import the emitted `.js`, so they run on the system Node without native `.ts` execution. The Postgres tests (`test/postgres-*.test.mjs`, `test/digest-roundtrip.test.mjs`) skip cleanly when no database is reachable, so `npm run ci` passes on a machine without Docker. Start the local database with `docker compose -f infra/local/compose.yaml up -d` to exercise them.

## Dependency direction

Depends only on `@onevps/protocol-ts` (by deep relative path) and `pg` (the only non-workspace runtime dependency, pinned at `8.23.0`). Source adapters take a structural `SqlExecutor` type rather than importing `pg` types, so the port definitions stay free of database specifics.

## Known finding: protocol-ts and the control-plane purity scan

`apps/control-plane/test/evidence-storage.test.mjs` is a textual purity scan over `apps/control-plane/src/` only. Its README names the gap: it does not follow the deep relative import into `packages/protocol-ts/src/`. Closing that gap would surface that `packages/protocol-ts/src/canonical-identity.ts` imports `createHash` from `node:crypto` for deterministic SHA-256 identity computation. That use is a pure, side-effect-free hash (no filesystem, network, process, or entropy) and predates this package; it is not treated as a purity violation in the spirit of the boundary, which guards against I/O and managed-service reach. The scan is therefore left at its documented scope rather than extended into a false positive. This is recorded here so the decision is visible if the scan's scope is revisited.
