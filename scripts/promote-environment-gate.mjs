import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pg from "pg";

import { evaluateEnvironmentGatePromotion, formatPromotionReport, persistEnvironmentGatePromotion } from "./lib/promote-environment-gate.mjs";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function argValues(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1] !== undefined) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadEvidenceRecords(files, directory) {
  const records = [];
  for (const file of files) {
    records.push(await loadJson(file));
  }
  if (directory !== undefined) {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    for (const name of names) {
      records.push(await loadJson(path.join(directory, name)));
    }
  }
  return records;
}

export async function promoteEnvironmentGate(options) {
  const evaluation = evaluateEnvironmentGatePromotion({
    current: options.current,
    evidenceRecords: options.evidenceRecords,
    decision: options.decision,
    proposedGate: options.proposedGate,
    now: options.now,
    signatureResult: options.signatureResult
  });
  const report = formatPromotionReport(evaluation);
  if (options.dryRun || options.sql === undefined) {
    return { evaluation, report, persist: { outcome: "dry_run" } };
  }
  const persist = await persistEnvironmentGatePromotion({
    sql: options.sql,
    evaluation,
    evidenceRecords: options.evidenceRecords,
    decision: options.decision,
    proposedGate: options.proposedGate,
    dryRun: false
  });
  return { evaluation, report, persist };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = argValue("--database-url") ?? process.env.CODEATTEST_MIGRATOR_DATABASE_URL;
  const decisionFile = argValue("--decision-file");
  const gateFile = argValue("--gate-file");
  const evidenceDir = argValue("--evidence-dir");
  const evidenceFiles = argValues("--evidence-file");
  const verificationOutcomeFile = argValue("--verification-outcome-file");
  const now = argValue("--now") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const dryRun = process.argv.includes("--dry-run");

  if (!decisionFile || !gateFile || (evidenceFiles.length === 0 && evidenceDir === undefined)) {
    console.error("usage: node scripts/promote-environment-gate.mjs --decision-file <path> --gate-file <path> (--evidence-file <path> | --evidence-dir <path>) [--database-url <migrator-url>] [--verification-outcome-file <path>] [--now <rfc3339>] [--dry-run]");
    process.exit(1);
  }

  const decision = await loadJson(decisionFile);
  const proposedGate = await loadJson(gateFile);
  const evidenceRecords = await loadEvidenceRecords(evidenceFiles, evidenceDir);
  const signatureResult = verificationOutcomeFile === undefined
    ? { result: "missing" }
    : (await loadJson(verificationOutcomeFile));

  let sql;
  let current;
  if (databaseUrl !== undefined && !dryRun) {
    sql = new pg.Client({ connectionString: databaseUrl });
    await sql.connect();
  }
  try {
    if (sql !== undefined) {
      const { rows } = await sql.query("SELECT version, body FROM environment_evidence_gate ORDER BY version DESC LIMIT 1");
      if (rows[0] !== undefined) {
        current = { version: Number(rows[0].version), gate: JSON.parse(rows[0].body) };
      }
    } else if (argValue("--current-gate-file") !== undefined) {
      current = {
        version: Number(argValue("--current-version") ?? "1"),
        gate: await loadJson(argValue("--current-gate-file"))
      };
    }

    const result = await promoteEnvironmentGate({
      current,
      evidenceRecords,
      decision,
      proposedGate,
      now,
      signatureResult,
      sql,
      dryRun
    });
    process.stdout.write(result.report);
    process.stdout.write(`persist: ${result.persist.outcome}\n`);
    process.exit(result.evaluation.ok && (dryRun || result.persist.outcome === "promoted") ? 0 : 1);
  } finally {
    if (sql !== undefined) {
      await sql.end();
    }
  }
}
