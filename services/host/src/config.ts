import { readFile, stat } from "node:fs/promises";

export class ConfigError extends Error {}

export type HostSigningConfig = {
  key_directory_path: string;
  trust_anchor_public_key: string;
  key_id: string;
  key_version: string;
  credential_name: string;
};

export type DemoBudgetMeterConfig = {
  monthly_unit_ceiling: number;
  unit_per_billable_event: number;
};

export type HostConfig = {
  deployment_identity: "demo" | "pilot";
  database_url: string;
  object_store_root: string;
  object_store_encrypted: boolean;
  listen_addr: string;
  encryption_key_ref: string;
  object_store_envelope_key_ref?: string;
  session_cookie_secure: boolean;
  signing: HostSigningConfig;
  demo_budget: { spend_ratio: number };
  demo_budget_meter: DemoBudgetMeterConfig;
};

const REQUIRED_KEYS = [
  "deployment_identity",
  "database_url",
  "object_store_root",
  "object_store_encrypted",
  "listen_addr",
  "encryption_key_ref",
  "session_cookie_secure",
  "signing"
] as const;

// Sub-project B: additive to A2's closed config. Optional and default closed
// (no unknown keys), same discipline as the rest of this file.
const OPTIONAL_KEYS = ["demo_budget", "demo_budget_meter", "object_store_envelope_key_ref"] as const;
const ALLOWED_KEYS: readonly string[] = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const BASE64URL_PUBLIC_KEY = /^[A-Za-z0-9_-]{2603}$/;
const CREDENTIAL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SIGNING_KEYS = ["key_directory_path", "trust_anchor_public_key", "key_id", "key_version", "credential_name"] as const;

function validateDemoBudget(value: unknown): { spend_ratio: number } {
  if (value === undefined) {
    return { spend_ratio: 0 };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError('config key "demo_budget" must be an object');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => key !== "spend_ratio");
  if (unknownKeys.length > 0) {
    throw new ConfigError(`demo_budget has unknown keys: ${unknownKeys.join(", ")}`);
  }
  const spendRatio = record.spend_ratio;
  if (typeof spendRatio !== "number" || !Number.isFinite(spendRatio) || spendRatio < 0 || spendRatio > 1) {
    // A missing or malformed ratio silently reading as 0 would disable the
    // budget guard rather than trip it, so this is a fatal boot error.
    throw new ConfigError('config key "demo_budget.spend_ratio" must be a finite number in [0, 1]');
  }
  return { spend_ratio: spendRatio };
}

function validateDemoBudgetMeter(value: unknown): DemoBudgetMeterConfig {
  // Missing F configuration defaults closed: one billable event consumes the
  // entire one-unit ceiling instead of silently disabling enforcement.
  if (value === undefined) {
    return { monthly_unit_ceiling: 1, unit_per_billable_event: 1 };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError('config key "demo_budget_meter" must be an object');
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["monthly_unit_ceiling", "unit_per_billable_event"]);
  const unknownKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(`demo_budget_meter has unknown keys: ${unknownKeys.join(", ")}`);
  }
  const monthlyUnitCeiling = requirePositiveFiniteNumber(record.monthly_unit_ceiling, "demo_budget_meter.monthly_unit_ceiling");
  const unitPerBillableEvent = requirePositiveFiniteNumber(record.unit_per_billable_event, "demo_budget_meter.unit_per_billable_event");
  return {
    monthly_unit_ceiling: monthlyUnitCeiling,
    unit_per_billable_event: unitPerBillableEvent
  };
}

function validateSigning(value: unknown): HostSigningConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConfigError('config key "signing" must be an object');
  }
  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !(SIGNING_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(`signing has unknown keys: ${unknownKeys.join(", ")}`);
  }
  const signing: HostSigningConfig = {
    key_directory_path: requireNonEmptyString(record.key_directory_path, "signing.key_directory_path"),
    trust_anchor_public_key: requireNonEmptyString(record.trust_anchor_public_key, "signing.trust_anchor_public_key"),
    key_id: requireNonEmptyString(record.key_id, "signing.key_id"),
    key_version: requireNonEmptyString(record.key_version, "signing.key_version"),
    credential_name: requireCredentialFileName(record.credential_name, "signing.credential_name")
  };
  if (!BASE64URL_PUBLIC_KEY.test(signing.trust_anchor_public_key)) {
    throw new ConfigError("signing.trust_anchor_public_key must be 2603 unpadded base64url characters");
  }
  return signing;
}

function extractHost(listenAddr: string): string {
  if (LOOPBACK_HOSTS.has(listenAddr)) {
    return listenAddr;
  }
  if (listenAddr.startsWith("[")) {
    const closeBracket = listenAddr.indexOf("]");
    return closeBracket === -1 ? listenAddr : listenAddr.slice(0, closeBracket + 1);
  }
  return listenAddr.includes(":") ? listenAddr.slice(0, listenAddr.lastIndexOf(":")) : listenAddr;
}

/**
 * Loaded from a mode-0600 file owned by the deployment's Unix user rather
 * than environment variables, which leak into /proc and crash dumps
 * (design doc section 5.6, step 1).
 */
export async function loadConfig(configPath: string): Promise<HostConfig> {
  const stats = await stat(configPath).catch((error: unknown) => {
    throw new ConfigError(`cannot stat config file: ${(error as Error).message}`);
  });
  const mode = stats.mode & 0o777;
  if (mode !== 0o600) {
    throw new ConfigError(`config file must be mode 0600, got ${mode.toString(8)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new ConfigError(`config file is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError("config file must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new ConfigError(`config has unknown keys: ${unknownKeys.join(", ")}`);
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in record)) {
      throw new ConfigError(`config is missing required key "${key}"`);
    }
  }

  const deploymentIdentity = record.deployment_identity;
  if (deploymentIdentity !== "demo" && deploymentIdentity !== "pilot") {
    throw new ConfigError('deployment_identity must be "demo" or "pilot"');
  }
  const listenAddr = requireNonEmptyString(record.listen_addr, "listen_addr");
  const host = extractHost(listenAddr);
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ConfigError(`listen_addr host "${host}" is not loopback; A must not be internet-exposed`);
  }

  const loaded: HostConfig = {
    deployment_identity: deploymentIdentity,
    database_url: requireNonEmptyString(record.database_url, "database_url"),
    object_store_root: requireNonEmptyString(record.object_store_root, "object_store_root"),
    object_store_encrypted: requireBoolean(record.object_store_encrypted, "object_store_encrypted"),
    listen_addr: listenAddr,
    encryption_key_ref: requireCredentialFileName(record.encryption_key_ref, "encryption_key_ref"),
    session_cookie_secure: requireBoolean(record.session_cookie_secure, "session_cookie_secure"),
    signing: validateSigning(record.signing),
    demo_budget: validateDemoBudget(record.demo_budget),
    demo_budget_meter: validateDemoBudgetMeter(record.demo_budget_meter)
  };
  if (record.object_store_envelope_key_ref !== undefined) {
    loaded.object_store_envelope_key_ref = requireCredentialFileName(
      record.object_store_envelope_key_ref,
      "object_store_envelope_key_ref"
    );
  }
  return loaded;
}

function requireNonEmptyString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`config key "${key}" must be a non-empty string`);
  }
  return value;
}

function requireCredentialFileName(value: unknown, key: string): string {
  const name = requireNonEmptyString(value, key);
  if (!CREDENTIAL_NAME.test(name)) {
    throw new ConfigError(`${key} must be a bare credential file name`);
  }
  return name;
}

function requireBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigError(`config key "${key}" must be a boolean`);
  }
  return value;
}

function requirePositiveFiniteNumber(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`config key "${key}" must be a positive finite number`);
  }
  return value;
}
