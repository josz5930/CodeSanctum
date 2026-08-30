# Local Infrastructure

Home for local development services and compose-style support files.

## Current State

`compose.yaml` provides a local Postgres 17 service (image `postgres:17.2-alpine`) on port `55432` for development and the evidence-store contract tests. The database `codeattest` is owned by the `codeattest_migrator` role; `codeattest_app` is granted by [`infra/migrations/0002_roles_and_grants.sql`](../migrations/0002_roles_and_grants.sql). The password is a synthetic-only local-development literal. Pilot and demo deployments supply credentials from their mode-0600 config file, never from a compose file. Tests reach Postgres through a harness that skips cleanly when no database is reachable, so `npm run ci` passes on a machine without Docker.

## Intended Purpose

As stories introduce components that need a local dependency (for example, a database once persistence is scoped in [`infra/migrations/`](../migrations/README.md)), the corresponding compose file, environment template, or startup script belongs here rather than being invented ad hoc inside an app or service directory.

## Rules for This Directory

- Keep any future local services **synthetic and fixture-driven** unless a later story explicitly raises evidence-handling scope (see the [protocol evidence boundary](../../protocol/README.md#evidence-boundary)).
- Do not add a local service here speculatively — wait for the story that actually needs it, per [Simplicity First](../../README.md).
