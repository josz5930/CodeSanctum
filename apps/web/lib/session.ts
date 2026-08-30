import { hostFetch, type FetchLike, type HostFetchDeps, type HostFetchResult } from "./host-fetch.js";

export type { HostFetchResult, SessionExpired } from "./host-fetch.js";
export { isSessionExpired } from "./host-fetch.js";

export async function loginToHost(input: {
  identifier: string;
  secret: string;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}): Promise<HostFetchResult> {
  return hostFetch({
    path: "/v0/auth/login",
    method: "POST",
    body: { identifier: input.identifier, secret: input.secret },
    ...(input.fetchImpl !== undefined ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.env !== undefined ? { env: input.env } : {})
  });
}

export async function logoutFromHost(input: {
  cookie?: string;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
}): Promise<HostFetchResult> {
  return hostFetch({
    path: "/v0/auth/logout",
    method: "POST",
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
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    if (result.kind === "ok" && (result.status === 204 || result.status === 202)) {
      return webResponseFromHostResult(result, { redirectTo: "/" });
    }
    return new Response(null, { status: 303, headers: { location: "/login" } });
  };
}

export function createLogoutPostHandler(deps: HostFetchDeps = {}) {
  return async (request: Request): Promise<Response> => {
    const cookieHeader = request.headers.get("cookie");
    const result = await logoutFromHost({
      ...(cookieHeader !== null && cookieHeader.length > 0 ? { cookie: cookieHeader } : {}),
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.env !== undefined ? { env: deps.env } : {})
    });
    return webResponseFromHostResult(result, { redirectTo: "/login" });
  };
}
