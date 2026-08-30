import { readFile } from "node:fs/promises";

import canonicalizeJson from "canonicalize";
import pg from "pg";

export async function seedEnvironmentGate(client, input) {
  const body = canonicalizeJson(input.gate);
  const result = await client.query(
    `INSERT INTO environment_evidence_gate (version, body) VALUES ($1, $2)
     ON CONFLICT (version) DO NOTHING
     RETURNING version`,
    [input.version, body]
  );
  return { outcome: result.rows.length > 0 ? "recorded" : "version_conflict" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrlIndex = process.argv.indexOf("--database-url");
  const gateFileIndex = process.argv.indexOf("--gate-file");
  const versionIndex = process.argv.indexOf("--version");
  const databaseUrl = databaseUrlIndex === -1 ? process.env.CODEATTEST_DATABASE_URL : process.argv[databaseUrlIndex + 1];
  const gateFile = gateFileIndex === -1 ? undefined : process.argv[gateFileIndex + 1];
  const version = versionIndex === -1 ? 1 : Number(process.argv[versionIndex + 1]);

  if (!databaseUrl || !gateFile) {
    console.error("usage: node scripts/seed-environment-gate.mjs --database-url <url> --gate-file <path.json> [--version <n>]");
    process.exit(1);
  }

  const gate = JSON.parse(await readFile(gateFile, "utf8"));
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await seedEnvironmentGate(client, { version, gate });
    console.log(result.outcome === "recorded" ? `Seeded environment_evidence_gate version ${version}.` : `Version ${version} already present; no-op.`);
  } finally {
    await client.end();
  }
}
