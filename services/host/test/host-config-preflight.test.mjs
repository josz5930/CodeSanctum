import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkHostConfig } from "../../../scripts/check-host-config.mjs";
import { importCompiled } from "./helpers/compile.mjs";

const { loadConfig } = await importCompiled("src/config.js");
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const example = JSON.parse(await readFile(path.join(repoRoot, "infra/deploy/host-config.example.json"), "utf8"));

// A demo deployment laid out the way PROVISIONING.md describes it, under a
// temporary root, with the shipped example config pointed at it.
async function deployment(overrides = {}, { omit = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "onevps-host-preflight-"));
  const credentialsDir = path.join(root, "etc");
  const objects = path.join(root, "objects");
  const keyDirectory = path.join(root, "signing-key-directory.json");
  await mkdir(credentialsDir);
  await mkdir(objects);
  await writeFile(keyDirectory, "{}");
  const secrets = { "totp-key": Buffer.alloc(32, 1), "envelope-key": Buffer.alloc(32, 2), "signing-key.cred": "sealed" };
  for (const [name, body] of Object.entries(secrets)) {
    if (!omit.includes(name)) {
      await writeFile(path.join(credentialsDir, name), body, { mode: 0o400 });
    }
  }
  const { signing, ...rest } = overrides;
  const config = {
    ...example,
    object_store_root: objects,
    ...rest,
    signing: { ...example.signing, key_directory_path: keyDirectory, trust_anchor_public_key: "A".repeat(2603), ...signing }
  };
  const configPath = path.join(root, "demo-host.json");
  await writeFile(configPath, JSON.stringify(config));
  await chmod(configPath, 0o600);
  return { identity: "demo", configPath, credentialsDir, loadConfig };
}

// The shipped example, with real values in its placeholders, passes.
assert.deepEqual(await checkHostConfig(await deployment()), []);

// The example's placeholders themselves do not load: an operator cannot
// deploy it unedited.
{
  const input = await deployment();
  await writeFile(input.configPath, JSON.stringify(example));
  const failures = await checkHostConfig(input);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /trust_anchor_public_key/);
}

// A config for the other deployment is refused.
{
  const failures = await checkHostConfig({ ...(await deployment()), identity: "pilot" });
  assert.ok(failures.some((failure) => /deployment_identity is "demo", expected "pilot"/.test(failure)));
  assert.ok(failures.some((failure) => /listen_addr .* expected "127\.0\.0\.1:8081"/.test(failure)));
  assert.ok(failures.some((failure) => /expected "pilot-totp-key"/.test(failure)));
}

// Credential names that do not match the systemd units are refused.
{
  const failures = await checkHostConfig(await deployment({
    encryption_key_ref: "totp-key",
    signing: { credential_name: "signing-key" },
    transparency_anchor: { base_url: "https://anchor.example.invalid", token_credential: "anchor-token" }
  }));
  assert.ok(failures.some((failure) => /encryption_key_ref is "totp-key", expected "demo-totp-key"/.test(failure)));
  assert.ok(failures.some((failure) => /signing\.credential_name is "signing-key", expected "demo-signing-key"/.test(failure)));
  assert.ok(failures.some((failure) => /token_credential is "anchor-token", expected "demo-anchor-token"/.test(failure)));
  assert.ok(failures.some((failure) => /missing credential file: .*anchor-token/.test(failure)));
}

// An unset envelope key ref and an insecure cookie are refused.
{
  const input = await deployment({ session_cookie_secure: false });
  const config = JSON.parse(await readFile(input.configPath, "utf8"));
  delete config.object_store_envelope_key_ref;
  await writeFile(input.configPath, JSON.stringify(config));
  const failures = await checkHostConfig(input);
  assert.ok(failures.some((failure) => /object_store_envelope_key_ref is "\(unset\)"/.test(failure)));
  assert.ok(failures.some((failure) => /session_cookie_secure must be true/.test(failure)));
}

// A missing, short, or group-readable key file is refused.
{
  const input = await deployment({}, { omit: ["envelope-key"] });
  await chmod(path.join(input.credentialsDir, "totp-key"), 0o600);
  await writeFile(path.join(input.credentialsDir, "totp-key"), Buffer.alloc(16));
  await chmod(path.join(input.credentialsDir, "signing-key.cred"), 0o640);
  const failures = await checkHostConfig(input);
  assert.ok(failures.some((failure) => /missing credential file: .*envelope-key/.test(failure)));
  assert.ok(failures.some((failure) => /exactly 32 bytes: .*totp-key holds 16/.test(failure)));
  assert.ok(failures.some((failure) => /group or other: .*signing-key\.cred is 640/.test(failure)));
}

// A config that is not mode 0600 never gets past the host's own loader.
{
  const input = await deployment();
  await chmod(input.configPath, 0o644);
  const failures = await checkHostConfig(input);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /mode 0600/);
}

console.log("host config preflight tests passed.");
