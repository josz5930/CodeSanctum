import { loadHostBaseUrl } from "./config.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SessionExpired = {
  kind: "session-expired";
};

export type HostFetchSuccess = {
  kind: "ok";
  status: number;
  bodyText: string;
  setCookie: readonly string[];
};

export type HostFetchResult = HostFetchSuccess | SessionExpired;

export type HostFetchDeps = {
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
};

export type HostFetchRequest = HostFetchDeps & {
  path: string;
  method?: string;
  cookie?: string;
  /**
   * The incoming X-Forwarded-For header (set by Caddy to the real client
   * address). The host trusts it only from loopback, so per-client rate limits
   * and the login lockout count the browser's client, not this server.
   */
  forwardedFor?: string | null;
  body?: unknown;
};

function assertServerOnly(): void {
  if (typeof globalThis.window !== "undefined") {
    throw new Error("host-fetch is server-only");
  }
}

function resolveHostUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("host fetch path must be an absolute path");
  }
  return `${baseUrl}${path}`;
}

function readSetCookie(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const header = response.headers.get("set-cookie");
  return header === null ? [] : [header];
}

export function isSessionExpired(result: HostFetchResult): result is SessionExpired {
  return result.kind === "session-expired";
}

/**
 * Forwards the incoming Cookie and X-Forwarded-For headers to this
 * deployment's host. A 401 becomes `{ kind: "session-expired" }` instead of a
 * thrown status.
 */
export async function hostFetch(request: HostFetchRequest): Promise<HostFetchResult> {
  assertServerOnly();
  const baseUrl = loadHostBaseUrl(request.env);
  const url = resolveHostUrl(baseUrl, request.path);
  const headers = new Headers();
  if (request.cookie !== undefined && request.cookie.length > 0) {
    headers.set("cookie", request.cookie);
  }
  if (typeof request.forwardedFor === "string" && request.forwardedFor.length > 0) {
    headers.set("x-forwarded-for", request.forwardedFor);
  }
  const init: RequestInit = {
    method: request.method ?? "GET",
    headers
  };
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(request.body);
  }
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url, init);
  if (response.status === 401) {
    return { kind: "session-expired" };
  }
  return {
    kind: "ok",
    status: response.status,
    bodyText: await response.text(),
    setCookie: readSetCookie(response)
  };
}

/**
 * Next passes a dynamic segment such as `[scope]` still percent-encoded, so a
 * link to `/reviews/review%3Aabc` arrives as `review%3Aabc`. Callers encode the
 * value again for the host path, so it is decoded once here first. A value
 * that is not valid percent-encoding is passed on as it is; the host refuses
 * a review id it does not know.
 */
export function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
