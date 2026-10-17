import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { postgresAvailable, withMigratedPostgres, APP_URL } from "./helpers/postgres-harness.mjs";
import { compileWorkspace } from "./helpers/compile.mjs";
import { importCompiled as importEvidenceStoreCompiled } from "../../../packages/evidence-store/test/helpers/compile.mjs";
import {
  buildTestServer,
  submitSyntheticBundle,
  syntheticBundle,
  syntheticGate,
  testKeyMaterial,
  SYNTHETIC_OBJECT_ENVELOPE
} from "./helpers/submission-fixtures.mjs";

if (!(await postgresAvailable())) {
  console.log("worker-process test skipped: no database reachable.");
  process.exit(0);
}

const { createPostgresPool } = await importEvidenceStoreCompiled("src/index.js");
const { seedEnvironmentGate } = await import("../../../scripts/seed-environment-gate.mjs");
const { encodeBase64Url } = await import(path.join(await compileWorkspace(), "packages", "signing", "src", "index.js"));
const workerMain = path.join(await compileWorkspace(), "services", "host", "src", "worker", "main.js");

/** Runs the compiled worker as a real process; resolves with its exit code and output. */
function runWorker(args, env, { stopWhen } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerMain, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timer;
    const onData = (chunk) => {
      output += chunk;
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    if (stopWhen !== undefined) {
      const poll = async () => {
        if (await stopWhen()) {
          child.kill("SIGTERM");
        } else {
          timer = setTimeout(poll, 200);
        }
      };
      timer = setTimeout(poll, 200);
    }
    const deadline = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`worker ${args[0]} did not finish:\n${output}`));
    }, 60_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      clearTimeout(deadline);
      resolve({ code, output });
    });
  });
}

await withMigratedPostgres(async () => {
  const pool = createPostgresPool(APP_URL);
  const anchorObjects = new Map();
  const anchorServer = createServer((request, response) => {
    if (request.headers.authorization !== "Bearer synthetic-anchor-token") {
      response.writeHead(401).end();
      return;
    }
    if (request.method === "PUT") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        anchorObjects.set(request.url, body);
        response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ anchor_ref: `stub:${request.url}` }));
      });
      return;
    }
    const body = anchorObjects.get(request.url);
    if (body === undefined) {
      response.writeHead(404).end();
    } else {
      response.writeHead(200, { "content-type": "application/json" }).end(body);
    }
  });
  await new Promise((resolve) => anchorServer.listen(0, "127.0.0.1", resolve));
  try {
    await seedEnvironmentGate(pool, { version: 1, gate: await syntheticGate() });
    const work = await mkdtemp(path.join(tmpdir(), "onevps-worker-process-"));
    const objectStoreRoot = path.join(work, "objects");
    const credentials = path.join(work, "credentials");
    await mkdir(objectStoreRoot, { recursive: true, mode: 0o700 });
    await mkdir(credentials, { recursive: true, mode: 0o700 });
    await writeFile(path.join(credentials, SYNTHETIC_OBJECT_ENVELOPE.keyId), SYNTHETIC_OBJECT_ENVELOPE.key);
    await writeFile(path.join(credentials, "anchor-token"), "synthetic-anchor-token\n");

    const { keyDirectory, trustAnchorPublicKey } = await testKeyMaterial();
    const keyDirectoryPath = path.join(work, "key-directory.json");
    await writeFile(keyDirectoryPath, JSON.stringify(keyDirectory));

    const baseConfig = {
      deployment_identity: "demo",
      database_url: APP_URL,
      object_store_root: objectStoreRoot,
      object_store_encrypted: false,
      object_store_envelope_key_ref: SYNTHETIC_OBJECT_ENVELOPE.keyId,
      listen_addr: "127.0.0.1:0",
      encryption_key_ref: "unused-by-the-worker",
      session_cookie_secure: true,
      signing: {
        key_directory_path: keyDirectoryPath,
        trust_anchor_public_key: encodeBase64Url(trustAnchorPublicKey),
        key_id: "unused-by-the-worker",
        key_version: "v1",
        credential_name: "not-loaded-by-the-worker"
      }
    };
    const writeConfig = async (name, body) => {
      const file = path.join(work, name);
      await writeFile(file, JSON.stringify(body));
      await chmod(file, 0o600);
      return file;
    };
    const configPath = await writeConfig("worker.json", baseConfig);
    const env = { CREDENTIALS_DIRECTORY: credentials };

    // A real submission through the routes leaves one normalization job.
    const { server } = await buildTestServer({ pool, objectStoreRoot });
    await submitSyntheticBundle(server, await syntheticBundle());
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM job WHERE job_type = 'normalize_scanner_findings'")).rows[0].n, 1);

    // --- run: drains the job, then stops cleanly on SIGTERM ---------------------
    const ran = await runWorker(["run", configPath], env, {
      stopWhen: async () => (await pool.query("SELECT 1 FROM finding_normalization_outcome")).rows.length > 0
    });
    assert.equal(ran.code, 0, ran.output);
    assert.match(ran.output, /"event":"worker_started"/);
    assert.match(ran.output, /"event":"normalize_job_recorded".*"outcome":"normalized"/);
    assert.equal((await pool.query("SELECT outcome FROM finding_normalization_outcome")).rows[0].outcome, "normalized");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM job")).rows[0].n, 0);
    assert.doesNotMatch(ran.output, /synthetic-anchor-token/);

    // --- retention: nothing is due, the run succeeds ---------------------------
    const retention = await runWorker(["retention", configPath], env);
    assert.equal(retention.code, 0, retention.output);
    assert.match(retention.output, /"event":"retention_run".*"enqueued":0/);

    // --- checkpoint without an anchor fails closed, with a non-zero exit -------
    const noAnchor = await runWorker(["checkpoint", configPath], env);
    assert.equal(noAnchor.code, 1, noAnchor.output);
    assert.match(noAnchor.output, /transparency anchor is not configured/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM transparency_checkpoint_publication")).rows[0].n, 0);

    // --- checkpoint with an anchor publishes and reads back --------------------
    const anchorConfig = await writeConfig("worker-anchor.json", {
      ...baseConfig,
      transparency_anchor: { base_url: `http://127.0.0.1:${anchorServer.address().port}`, token_credential: "anchor-token" }
    });
    const published = await runWorker(["checkpoint", anchorConfig], env);
    assert.equal(published.code, 0, published.output);
    assert.match(published.output, /"event":"checkpoint_run".*"outcome":"published"/);
    assert.equal(anchorObjects.size, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM transparency_checkpoint_publication")).rows[0].n, 1);
    assert.doesNotMatch(published.output, /synthetic-anchor-token/, "the anchor token is never logged");

    // --- a bad key directory stops boot ----------------------------------------
    await writeFile(keyDirectoryPath, JSON.stringify({ ...keyDirectory, directory_version: keyDirectory.directory_version + 1 }));
    const tampered = await runWorker(["retention", configPath], env);
    assert.equal(tampered.code, 1, tampered.output);
    assert.match(tampered.output, /"step":"key_directory".*signing_key_directory_untrusted/);

    // A long-running `run` that fails to boot must exit, not sit idle on its
    // open pool where systemd would never see the failure.
    const runTampered = await runWorker(["run", configPath], env);
    assert.equal(runTampered.code, 1, runTampered.output);
    assert.match(runTampered.output, /"step":"key_directory"/);

    // --- an unknown command is a usage error -----------------------------------
    assert.equal((await runWorker(["purge-everything", configPath], env)).code, 2);
  } finally {
    anchorServer.close();
    await pool.end();
  }
});

console.log("worker-process test passed.");
