import assert from "node:assert/strict";

import { importCompiled } from "./helpers/compile.mjs";

const { checkMigrationHead } = await importCompiled("src/migration-check.js");

const realHead = (await import("../../../scripts/run-migrations.mjs")).migrationHead;
const expectedHead = await realHead();

// A box whose highest-applied migration matches the build's compiled-in set passes.
{
  const fakeSql = {
    async query() {
      return { rows: [{ filename: expectedHead }] };
    }
  };
  const result = await checkMigrationHead(fakeSql);
  assert.deepEqual(result, { ok: true });
}

// A half-migrated box (older head, or no rows at all) fails closed.
{
  const fakeSql = {
    async query() {
      return { rows: [] };
    }
  };
  const result = await checkMigrationHead(fakeSql);
  assert.equal(result.ok, false);
  assert.match(result.reason, /migration/i);
}

{
  const fakeSql = {
    async query() {
      return { rows: [{ filename: "0000_nonexistent.sql" }] };
    }
  };
  const result = await checkMigrationHead(fakeSql);
  assert.equal(result.ok, false);
}

console.log("migration-check test passed.");
