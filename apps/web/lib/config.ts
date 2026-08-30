const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export const HOST_BASE_URL_ENV = "CODEATTEST_HOST_BASE_URL";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * E-8: one loopback origin for this deployment's host. Reject lists,
 * non-loopback hosts, non-http(s) schemes, and path-bearing values.
 */
export function loadHostBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[HOST_BASE_URL_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ConfigError(`${HOST_BASE_URL_ENV} is required`);
  }
  const trimmed = raw.trim();
  if (trimmed.includes(",") || /\s/.test(trimmed)) {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must be a single loopback origin`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must be an http(s) origin`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must not include credentials`);
  }
  if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must not include a path, query, or fragment`);
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new ConfigError(`${HOST_BASE_URL_ENV} must be a loopback origin`);
  }
  return parsed.origin;
}
