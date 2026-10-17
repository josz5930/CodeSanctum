import { hostFetch, type FetchLike, type HostFetchDeps, type HostFetchResult } from "./host-fetch.js";

export type { HostFetchResult, SessionExpired } from "./host-fetch.js";
export { isSessionExpired } from "./host-fetch.js";

export async function loginToHost(input: {
  identifier: string;
  secret: string;
  forwardedFor?: string | null;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}): Promise<HostFetchResult> {
  return hostFetch({
    path: "/v0/auth/login",
    method: "POST",
    forwardedFor: input.forwardedFor ?? null,
    body: { identifier: input.identifier, secret: input.secret },
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.env !== undefined ? { env: input.env } : {})
  });
}

export async function secondFactorToHost(input: {
  cookie: string;
  code: string;
  forwardedFor?: string | null;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}): Promise<HostFetchResult> {
  return hostFetch({
    path: "/v0/auth/login/second-factor",
    method: "POST",
    cookie: input.cookie,
    forwardedFor: input.forwardedFor ?? null,
    body: { code: input.code },
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.env !== undefined ? { env: input.env } : {})
  });
}

export async function logoutFromHost(input: {
  cookie?: string;
  forwardedFor?: string | null;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}): Promise<HostFetchResult> {
  return hostFetch({
    path: "/v0/auth/logout",
    method: "POST",
    forwardedFor: input.forwardedFor ?? null,
    ...(input.cookie !== undefined ? { cookie: input.cookie } : {}),
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.env !== undefined ? { env: input.env } : {})
  });
}

export function webResponseFromHostResult(result: HostFetchResult, options: { redirectTo: string }): Response {
  const headers = new Headers();
  headers.set("location", options.redirectTo);
  if (result.kind === "ok") {
    for (const cookie of result.setCookie) {
      headers.append("set-cookie", cookie);
    }
  }
  return new Response(null, { status: 303, headers });
}

export function createLoginPostHandler(deps: HostFetchDeps = {}) {
  return async (request: Request): Promise<Response> => {
    const formData = await request.formData();
    const result = await loginToHost({
      identifier: String(formData.get("identifier") ?? ""),
      secret: String(formData.get("secret") ?? ""),
      forwardedFor: request.headers.get("x-forwarded-for"),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    if (result.kind === "ok" && result.status === 204) {
      return webResponseFromHostResult(result, { redirectTo: "/" });
    }
    // 202: the password is correct and the account has TOTP. The host sets a
    // pending session cookie that only the second-factor step can upgrade.
    if (result.kind === "ok" && result.status === 202) {
      return webResponseFromHostResult(result, { redirectTo: "/login/second-factor" });
    }
    return new Response(null, { status: 303, headers: { location: "/login" } });
  };
}

export function createSecondFactorPostHandler(deps: HostFetchDeps = {}) {
  return async (request: Request): Promise<Response> => {
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader === null || cookieHeader.length === 0) {
      return new Response(null, { status: 303, headers: { location: "/login" } });
    }
    const formData = await request.formData();
    // Authenticator apps often show the code as "123 456".
    const code = String(formData.get("code") ?? "").replace(/\s+/g, "");
    const result = await secondFactorToHost({
      cookie: cookieHeader,
      code,
      forwardedFor: request.headers.get("x-forwarded-for"),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    if (result.kind === "ok" && result.status === 204) {
      return webResponseFromHostResult(result, { redirectTo: "/" });
    }
    // A wrong code, a used code and an expired pending session all get the
    // same host 401, so the page cannot tell them apart. It offers both a retry
    // and a new sign-in.
    return new Response(null, { status: 303, headers: { location: "/login/second-factor?error=code" } });
  };
}

export function createLogoutPostHandler(deps: HostFetchDeps = {}) {
  return async (request: Request): Promise<Response> => {
    const cookieHeader = request.headers.get("cookie");
    const result = await logoutFromHost({
      ...(cookieHeader !== null && cookieHeader.length > 0 ? { cookie: cookieHeader } : {}),
      forwardedFor: request.headers.get("x-forwarded-for"),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    return webResponseFromHostResult(result, { redirectTo: "/login" });
  };
}
