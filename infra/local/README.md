# Local Infrastructure

Home for local development services and compose-style support files.

## Current State

`compose.yaml` provides a local Postgres 17 service (image `postgres:17.2-alpine`) on `127.0.0.1:55432` for development and the evidence-store contract tests. The database `codeattest` is owned by the `codeattest_migrator` role; its password must be supplied through `POSTGRES_PASSWORD`. Compose rejects an unset or empty password rather than using a shared default. Pilot and demo deployments supply credentials from their mode-0600 config file, never from a compose file.

## Start the Local Database

For a **new** local database, run from the repository root in a POSIX shell:

```sh
export POSTGRES_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
export CODEATTEST_TEST_DATABASE_URL="$(node -e 'const u = new URL("postgres://codeattest_migrator@127.0.0.1:55432/codeattest"); u.password = encodeURIComponent(process.env.POSTGRES_PASSWORD); process.stdout.write(u.href)')"
docker compose -f infra/local/compose.yaml up -d --wait
```

Keep these variables in the same shell when running tests. Save the password in your password manager if you will reuse the database; restore that password in future sessions instead of generating another one. The URL construction above also encodes special characters if you supply your own password. Never commit the password or the resulting URL. Local `.env` files are ignored, but Compose loading an `.env` file does not export the test URL into the shell running Node.

After installing the workspace dependencies, verify the connection through the published host port before running tests (not from inside the container):

```sh
(cd packages/evidence-store && node --input-type=module -e 'import pg from "pg"; const client = new pg.Client({ connectionString: process.env.CODEATTEST_TEST_DATABASE_URL, connectionTimeoutMillis: 5000 }); try { await client.connect(); await client.query("SELECT 1"); console.log("Postgres connection succeeded"); } finally { await client.end(); }')
npm run test --workspace @onevps/evidence-store
npm run test --workspace @onevps/identity-store
```

The test harnesses skip when the database cannot be reached, including authentication failures. A green run with skipped Postgres tests does not validate the connection.

`codeattest_app` is created by [`infra/migrations/0002_roles_and_grants.sql`](../migrations/0002_roles_and_grants.sql) with a synthetic fixture password; the test harnesses and ephemeral CI service retain their fixture defaults. This local stack remains **synthetic-data-only**. Do not expose it through a non-loopback port mapping, proxy, or tunnel, or reuse its fixture credentials in a deployment.

## Existing Databases

Changing `POSTGRES_PASSWORD` does **not** rotate the password stored in an initialized database. Before recreating an existing container, supply your new password in the shell and open the local administrative session:

```sh
docker compose -f infra/local/compose.yaml exec postgres psql -U codeattest_migrator -d codeattest
```

At the `psql` prompt, run `\password codeattest_migrator`, enter the same new password at the hidden prompts, and then `\q`. Rebuild `CODEATTEST_TEST_DATABASE_URL` using the command above, recreate the service with `docker compose -f infra/local/compose.yaml up -d --wait --force-recreate`, and repeat the authentication check. Recreating the service also applies the loopback-only port binding; editing the YAML alone does not change a running container. Do not delete database volumes to rotate credentials.

## Intended Purpose

As stories introduce components that need a local dependency (for example, a database once persistence is scoped in [`infra/migrations/`](../migrations/README.md)), the corresponding compose file, environment template, or startup script belongs here rather than being invented ad hoc inside an app or service directory.

## Rules for This Directory

- Keep any future local services **synthetic and fixture-driven** unless a later story explicitly raises evidence-handling scope (see the [protocol evidence boundary](../../protocol/README.md#evidence-boundary)).
- Do not add a local service here speculatively — wait for the story that actually needs it, per [Simplicity First](../../README.md).
