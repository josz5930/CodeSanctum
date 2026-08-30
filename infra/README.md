# Infrastructure

Home for local development services, demo cloud profile documentation, and future database migrations.

## What's Here

| Directory | Purpose |
| --- | --- |
| [`local/`](./local/README.md) | Local development services and compose-style support files for running CodeAttest's TypeScript workspaces and any future local dependencies. |
| [`migrations/`](./migrations/README.md) | Numbered PostgreSQL migrations, append-only role grants, and migration-head tracking used by the host and deployment workflow. |
| [`gcp-demo/`](./gcp-demo/README.md) | Documentation for a future budget-guarded Google Cloud demo deployment profile. No deployable cloud resources exist yet. |
| [`deploy/`](./deploy/README.md) | Sub-project F's single-VPS systemd/Caddy templates, SLO timer, deploy/rollback scripts, and provisioning runbook. |

## Rules for This Directory

- Infrastructure must preserve the **demo-versus-pilot boundary**: demo resources are synthetic-only and budget-guarded, while partner-pilot evidence handling (real customer data) requires explicit readiness gates to be raised first — see the [protocol evidence boundary](../protocol/README.md#evidence-boundary) and [environment-evidence-gate schema](../protocol/schemas/README.md).
- Nothing here should accept, store, or process real customer source-derived evidence until those gates are raised.
- Prefer adding infrastructure only when a story actually needs it — this directory intentionally stays close to empty until real deployment/persistence work is scoped.

## How To Work Here

There is no `infra`-specific npm workspace; local development commands run from the repository root — see the [root README's command reference](../README.md#4-command-reference) and [Section 5, Try the Local Runner](../README.md#5-try-the-local-runner-end-to-end) for the fully offline runner workflow that doesn't require any infrastructure at all.
