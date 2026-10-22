import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledConfig = path.join(repoRoot, "services/host/dist/services/host/src/config.js");

/** The loopback port deploy.sh, rollback.sh, Caddy, and the web unit expect. */
export const HOST_PORTS = { demo: 8080, pilot: 8081 };

/**
 * Credential file names under `/etc/codeattest/<identity>/`, keyed by the
 * credential name the systemd units load them as. A wrong name in the host
 * config makes the host look for a file that is not in its
 * CREDENTIALS_DIRECTORY, and a missing source file stops the unit before it
 * runs (systemd exit status 243/CREDENTIALS).
 */
function expectedCredentials(identity) {
  return {
    totp: { name: `${identity}-totp-key`, file: "totp-key", bytes: 32 },
    envelope: { name: `${identity}-envelope-key`, file: "envelope-key", bytes: 32 },
    signing: { name: `${identity}-signing-key`, file: "signing-key.cred" },
    anchor: { name: `${identity}-anchor-token`, file: "anchor-token" }
  };
}

async function checkSecretFile(file, failures, { bytes, nonEmpty = false } = {}) {
  let stats;
  try {
    stats = await stat(file);
  } catch {
    failures.push(`missing credential file: ${file}`);
    return;
  }
  if (!stats.isFile()) {
    failures.push(`credential path is not a regular file: ${file}`);
    return;
  }
  if ((stats.mode & 0o077) !== 0) {
    failures.push(`credential file must not be readable or writable by group or other: ${file} is ${(stats.mode & 0o777).toString(8)}`);
  }
  if (bytes !== undefined && stats.size !== bytes) {
    failures.push(`credential file must hold exactly ${bytes} bytes: ${file} holds ${stats.size}`);
  }
  if (nonEmpty && (await readFile(file, "utf8")).trim().length === 0) {
    failures.push(`credential file is empty: ${file}`);
  }
}

async function checkDirectory(directory, label, failures) {
  const stats = await stat(directory).catch(() => undefined);
  if (stats === undefined || !stats.isDirectory()) {
    failures.push(`${label} is not a directory: ${directory}`);
  }
}

/**
 * Checks a host config against the deployment conventions before deploy.sh
 * changes anything. A bad config otherwise surfaces only as a failed
 * readiness gate after the switch, and the automatic rollback restores the
 * previous release with the same bad config, so neither release comes up.
 */
export async function checkHostConfig({ identity, configPath, credentialsDir, loadConfig }) {
  const failures = [];
  if (identity !== "demo" && identity !== "pilot") {
    return [`identity must be "demo" or "pilot", got "${identity}"`];
  }
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    return [`host config does not load: ${error.message}`];
  }

  const credentials = expectedCredentials(identity);
  if (config.deployment_identity !== identity) {
    failures.push(`deployment_identity is "${config.deployment_identity}", expected "${identity}"`);
  }
  const listenAddr = `127.0.0.1:${HOST_PORTS[identity]}`;
  if (config.listen_addr !== listenAddr) {
    failures.push(`listen_addr is "${config.listen_addr}", expected "${listenAddr}" (the readiness gate and Caddy use this address)`);
  }
  if (config.session_cookie_secure !== true) {
    failures.push("session_cookie_secure must be true behind the TLS proxy");
  }
  if (config.encryption_key_ref !== credentials.totp.name) {
    failures.push(`encryption_key_ref is "${config.encryption_key_ref}", expected "${credentials.totp.name}"`);
  }
  if (config.object_store_envelope_key_ref !== credentials.envelope.name) {
    failures.push(`object_store_envelope_key_ref is "${config.object_store_envelope_key_ref ?? "(unset)"}", expected "${credentials.envelope.name}"`);
  }
  if (config.signing.credential_name !== credentials.signing.name) {
    failures.push(`signing.credential_name is "${config.signing.credential_name}", expected "${credentials.signing.name}"`);
  }
  if (config.transparency_anchor !== undefined && config.transparency_anchor.token_credential !== credentials.anchor.name) {
    failures.push(`transparency_anchor.token_credential is "${config.transparency_anchor.token_credential}", expected "${credentials.anchor.name}"`);
  }

  await checkSecretFile(path.join(credentialsDir, credentials.totp.file), failures, { bytes: credentials.totp.bytes });
  await checkSecretFile(path.join(credentialsDir, credentials.envelope.file), failures, { bytes: credentials.envelope.bytes });
  await checkSecretFile(path.join(credentialsDir, credentials.signing.file), failures, { nonEmpty: true });
  if (config.transparency_anchor !== undefined) {
    await checkSecretFile(path.join(credentialsDir, credentials.anchor.file), failures, { nonEmpty: true });
  }
  await checkDirectory(config.object_store_root, "object_store_root", failures);
  const keyDirectory = await stat(config.signing.key_directory_path).catch(() => undefined);
  if (keyDirectory === undefined || !keyDirectory.isFile()) {
    failures.push(`signing.key_directory_path is not a file: ${config.signing.key_directory_path}`);
  }
  return failures;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = argument("--identity");
  const configPath = argument("--config") ?? (identity === undefined ? undefined : `/etc/codeattest/${identity}-host.json`);
  const credentialsDir = argument("--credentials-dir") ?? (identity === undefined ? undefined : `/etc/codeattest/${identity}`);
  if (identity === undefined || configPath === undefined || credentialsDir === undefined) {
    console.error("usage: node scripts/check-host-config.mjs --identity <demo|pilot> [--config <path>] [--credentials-dir <dir>]");
    process.exit(2);
  }
  let loadConfig;
  try {
    ({ loadConfig } = await import(pathToFileURL(compiledConfig).href));
  } catch {
    console.error(`cannot load ${path.relative(repoRoot, compiledConfig)}; run "npm run build:run --workspace @onevps/host" first`);
    process.exit(2);
  }
  const failures = await checkHostConfig({ identity, configPath, credentialsDir, loadConfig });
  if (failures.length > 0) {
    console.error(`Host config check failed for ${identity}:`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log(`Host config check passed for ${identity}.`);
}
