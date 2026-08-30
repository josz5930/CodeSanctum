import pg from "pg";

import { runMigrations } from "../../../../scripts/run-migrations.mjs";

export const MIGRATOR_URL =
  process.env.CODEATTEST_TEST_DATABASE_URL ??
  "postgres://codeattest_migrator:synthetic_demo_local_only@127.0.0.1:55432/codeattest";

export const APP_URL =
  process.env.CODEATTEST_TEST_APP_DATABASE_URL ??
  "postgres://codeattest_app:synthetic_demo_local_only@127.0.0.1:55432/codeattest";

export async function postgresAvailable() {
  const client = new pg.Client({ connectionString: MIGRATOR_URL, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export async function withMigratedPostgres(fn) {
  const admin = new pg.Client({ connectionString: MIGRATOR_URL });
  await admin.connect();
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await admin.end();
  await runMigrations(MIGRATOR_URL);
  return fn();
}
