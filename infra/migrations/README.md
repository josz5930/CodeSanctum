# Migrations

Home for future database migrations, for deployment profiles that use persistent database storage.

## Current State

Numbered SQL migrations live here and are applied by [`scripts/run-migrations.mjs`](../../scripts/run-migrations.mjs), which tracks applied files in a `schema_migration` table and runs each migration in one transaction. [`0001_evidence_store_schema.sql`](0001_evidence_store_schema.sql) creates the evidence-store tables: append-only history (`review_event`, `evidence_lifecycle_event`, `stored_object_classification`, `retention_opt_in_record`, `deletion_evidence`, `artifact_reference`, `environment_evidence_gate`, `chain_head_anchor`) and the mutable `job` queue. [`0005_readiness_records.sql`](0005_readiness_records.sql) adds append-only `environment_readiness_evidence` and `environment_readiness_decision` tables used by G's promotion transaction. Canonical artifact bodies are stored as `text` holding exact RFC 8785 bytes, with a generated `jsonb` column for indexing only. [`0002_roles_and_grants.sql`](0002_roles_and_grants.sql) defines the `codeattest_app` role whose grants enforce append-only history at the database rather than by convention. No live datastore runs by default; the contract tests reach Postgres through a harness that skips cleanly when no database is available.

## Intended Purpose

Event-log structure, evidence storage, and access-control persistence will be introduced here by later stories, once a story actually needs durable storage. When that happens, migrations here should:

- preserve the **append-oriented** review-event model already defined by the protocol and `apps/control-plane` — no in-place rewrites of audit-significant history;
- carry forward the retention/source-derived classification every protocol artifact already declares (see [`protocol/README.md`](../../protocol/README.md#evidence-boundary));
- stay synthetic/demo-safe until the partner-pilot evidence-handling gates referenced in [`infra/README.md`](../README.md) are raised.

## Rules for This Directory

- Do not add a migration or schema speculatively. Wait for the story that scopes real persistence, per [Simplicity First](../../README.md).
