import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const migrationsDir = fileURLToPath(new URL("../infra/migrations", import.meta.url));

export async function runMigrations(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const applied = [];
  try {
    // The tracking table is created by 0001 itself, so the first run has no
    // table to query. Treat that as "nothing applied yet" rather than an error.
    let alreadyApplied = new Set();
    try {
      const { rows } = await client.query("SELECT filename FROM schema_migration");
      alreadyApplied = new Set(rows.map((row) => row.filename));
    } catch {
      alreadyApplied = new Set();
    }

    const filenames = (await readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const filename of filenames) {
      if (alreadyApplied.has(filename)) {
        continue;
      }
      const sql = await readFile(path.join(migrationsDir, filename), "utf8");
      // Each migration is one transaction: a failure leaves no partial schema.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migration (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${filename} failed: ${error.message}`);
      }
      applied.push(filename);
    }
  } finally {
    await client.end();
  }
  return applied;
}

export async function migrationHead() {
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  return filenames.at(-1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = process.argv.indexOf("--database-url");
  const configIndex = process.argv.indexOf("--config");
  let databaseUrl = index === -1 ? process.env.CODEATTEST_DATABASE_URL : process.argv[index + 1];
  if (configIndex !== -1) {
    const configPath = process.argv[configIndex + 1];
    if (configPath === undefined) {
      console.error("--config requires a path");
      process.exit(1);
    }
    const config = JSON.parse(await readFile(configPath, "utf8"));
    databaseUrl = config.database_url;
  }
  if (!databaseUrl) {
    console.error("usage: node scripts/run-migrations.mjs --config <host-config> | --database-url <url>");
    process.exit(1);
  }
  const applied = await runMigrations(databaseUrl);
  console.log(applied.length === 0 ? "No migrations to apply." : `Applied: ${applied.join(", ")}`);
}
