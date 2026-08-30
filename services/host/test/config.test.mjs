import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { importCompiled } from "./helpers/compile.mjs";

const { loadConfig, ConfigError } = await importCompiled("src/config.js");

const SIGNING = {
  key_directory_path: "/var/lib/codeattest/demo/signing-key-directory.json",
  trust_anchor_public_key: "A".repeat(2603),
  key_id: "codeattest-demo-signing-key",
  key_version: "v1",
  credential_name: "signing-key"
};

const VALID = {
  deployment_identity: "demo",
  database_url: "postgres://codeattest_app:x@127.0.0.1:55432/codeattest",
  object_store_root: "/var/lib/codeattest/demo/objects",
  object_store_encrypted: false,
  listen_addr: "127.0.0.1:8080",
  encryption_key_ref: "demo-key-ref-v1",
  session_cookie_secure: true,
  signing: SIGNING
};

// Sub-project B extends the closed config with an optional, defaulted
// demo_budget; a config carrying none must load with the documented default.
const VALID_WITH_DEFAULTS = {
  ...VALID,
  demo_budget: { spend_ratio: 0 },
  demo_budget_meter: { monthly_unit_ceiling: 1, unit_per_billable_event: 1 }
};

async function writeConfig(dir, body, mode = 0o600) {
  const file = path.join(dir, "config.json");
  await writeFile(file, JSON.stringify(body));
  await chmod(file, mode);
  return file;
}

// A valid, correctly-permissioned config loads.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, VALID);
  const config = await loadConfig(file);
  assert.deepEqual(config, VALID_WITH_DEFAULTS);
}

// World-readable config is rejected.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, VALID, 0o644);
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// Unknown keys are rejected (closed schema).
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, extra_field: "nope" });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// A missing required key is rejected.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const { deployment_identity: _omitted, ...rest } = VALID;
  const file = await writeConfig(dir, rest);
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// deployment_identity must be one of the two allowed values.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, deployment_identity: "staging" });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// listen_addr must be loopback-only: A is not internet-exposed.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, listen_addr: "0.0.0.0:8080" });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// Portless IPv6 loopback address is accepted.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, listen_addr: "::1" });
  const config = await loadConfig(file);
  assert.equal(config.listen_addr, "::1");
}

// Bracketed portless IPv6 loopback address is accepted.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, listen_addr: "[::1]" });
  const config = await loadConfig(file);
  assert.equal(config.listen_addr, "[::1]");
}

// A config carrying a well-formed signing block loads it verbatim.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, signing: SIGNING });
  const config = await loadConfig(file);
  assert.deepEqual(config.signing, SIGNING);
}

// session_cookie_secure is required with no default: omitting it would make a
// security property depend on an absence.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const { session_cookie_secure: _omitted, ...rest } = VALID;
  const file = await writeConfig(dir, rest);
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// The signing block is required: a host that cannot sign must not boot.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const { signing: _omitted, ...rest } = VALID;
  const file = await writeConfig(dir, rest);
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// The block is closed, exactly like the top level.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, signing: { ...SIGNING, extra: 1 } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// A trust anchor that is not exactly 2603 base64url characters is not an
// ML-DSA-65 public key, and a truncated one would silently fail every
// verification at runtime instead of failing here.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, signing: { ...SIGNING, trust_anchor_public_key: "A".repeat(2602) } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, signing: { ...SIGNING, trust_anchor_public_key: `${"A".repeat(2602)}+` } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// credential_name is a bare file name, never a path: it is joined onto
// $CREDENTIALS_DIRECTORY, and a traversal would read outside the unit's tmpfs.
for (const credential_name of ["../secrets/key", "/etc/shadow", ""]) {
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, signing: { ...SIGNING, credential_name } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// encryption_key_ref is the same class of name: joined onto
// $CREDENTIALS_DIRECTORY to open the TOTP wrapping key.
for (const encryption_key_ref of ["../secrets/key", "/etc/shadow", ""]) {
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, encryption_key_ref });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// A demo_budget with a malformed spend_ratio is a fatal boot error, never a
// silent 0 -- that would disable the budget guard rather than trip it.
for (const spend_ratio of ["0.5", -0.1, 1.1, Number.NaN]) {
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, demo_budget: { spend_ratio } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// A well-formed demo_budget loads verbatim.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, {
    ...VALID,
    demo_budget: { spend_ratio: 0.42 }
  });
  const config = await loadConfig(file);
  assert.deepEqual(config.demo_budget, { spend_ratio: 0.42 });
}

// Unknown keys inside demo_budget are rejected, matching the closed schema
// discipline the rest of this file already enforces.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, demo_budget: { spend_ratio: 0.1, extra: 1 } });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

// F's event-derived meter configuration is additive, closed, and positive.
{
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, {
    ...VALID,
    demo_budget_meter: { monthly_unit_ceiling: 20, unit_per_billable_event: 0.25 }
  });
  const config = await loadConfig(file);
  assert.deepEqual(config.demo_budget_meter, { monthly_unit_ceiling: 20, unit_per_billable_event: 0.25 });
}
for (const demo_budget_meter of [
  { monthly_unit_ceiling: 0, unit_per_billable_event: 1 },
  { monthly_unit_ceiling: 20, unit_per_billable_event: -1 },
  { monthly_unit_ceiling: 20, unit_per_billable_event: 1, extra: true }
]) {
  const dir = await mkdtemp(path.join(tmpdir(), "onevps-host-config-"));
  const file = await writeConfig(dir, { ...VALID, demo_budget_meter });
  await assert.rejects(() => loadConfig(file), ConfigError);
}

console.log("config test passed.");
