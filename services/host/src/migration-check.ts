import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { SqlExecutor } from "../../../packages/evidence-store/src/index.js";

/**
 * `scripts/run-migrations.mjs` resolves its own migrations directory
 * relative to its own file location (`../infra/migrations`). If this module
 * imported it with a plain static specifier, `tsc` would copy it into
 * whatever directory this file gets compiled to (`dist/`, or the test
 * harness's cache dir) — a location with no sibling `infra/migrations`,
 * breaking that self-reference. Walking up from our own compiled location
 * to find the real `scripts/run-migrations.mjs` on disk, and importing it
 * from there via a non-literal specifier (so `tsc` never treats it as a
 * compiled project file), keeps us pointed at the one real copy.
 */
async function resolveMigrationHead(): Promise<string | undefined> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "scripts", "run-migrations.mjs"))) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("could not locate scripts/run-migrations.mjs from migration-check module");
    }
    dir = parent;
  }
  const specifier = pathToFileURL(path.join(dir, "scripts", "run-migrations.mjs")).href;
  const mod: { migrationHead: () => Promise<string | undefined> } = await import(specifier);
  return mod.migrationHead();
}

export type MigrationCheckResult = { ok: true } | { ok: false; reason: string };

/**
 * `codeattest_app` holds SELECT on schema_migration (infra/migrations/0002),
 * so this step needs no elevated connection. A half-migrated box — one whose
 * highest-applied filename is behind what this build ships — refuses to
 * serve rather than run against a schema it does not fully understand.
 */
export async function checkMigrationHead(sql: SqlExecutor): Promise<MigrationCheckResult> {
  let expected: string | undefined;
  try {
    expected = await resolveMigrationHead();
  } catch (error) {
    return { ok: false, reason: `could not determine this build's expected migration head: ${(error as Error).message}` };
  }
  const { rows } = await sql.query("SELECT filename FROM schema_migration ORDER BY filename DESC LIMIT 1");
  const actual = rows[0]?.filename;
  if (actual === undefined) {
    return { ok: false, reason: "no migrations have been applied to this database" };
  }
  if (actual !== expected) {
    return { ok: false, reason: `schema_migration head is "${actual}", this build expects "${expected}"` };
  }
  return { ok: true };
}
