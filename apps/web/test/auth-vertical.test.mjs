import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const HOST = "http://127.0.0.1:8787";
const env = { CODEATTEST_HOST_BASE_URL: HOST };
const SESSION_COOKIE = "codeattest_session_insecure_local=opaque-session";

function headerValue(init, name) {
  return new Headers(init?.headers).get(name);
}

function mockFetch(status, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const headers = new Headers(options.headers ?? {});
    return new Response(options.body ?? null, { status, headers });
  };
  return { calls, fetchImpl };
}

const { ConfigError, loadHostBaseUrl } = await importCompiled("lib/config.js");

assert.equal(loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: HOST }), HOST);
assert.equal(loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://localhost:8080" }), "http://localhost:8080");
assert.equal(loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://[::1]:8080" }), "http://[::1]:8080");
assert.equal(loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "https://127.0.0.1" }), "https://127.0.0.1");
assert.throws(() => loadHostBaseUrl({}), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "" }), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://127.0.0.1:8080,http://127.0.0.1:8081" }), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://example.com" }), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://10.0.0.1:8080" }), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "ftp://127.0.0.1" }), ConfigError);
assert.throws(() => loadHostBaseUrl({ CODEATTEST_HOST_BASE_URL: "http://127.0.0.1:8080/v0" }), ConfigError);

const { hostFetch } = await importCompiled("lib/host-fetch.js");

{
  const { calls, fetchImpl } = mockFetch(200, { body: "{}" });
  const result = await hostFetch({
    path: "/web/context",
    cookie: SESSION_COOKIE,
    fetchImpl,
    env
  });
  assert.equal(result.kind, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/web/context`);
  assert.equal(headerValue(calls[0].init, "cookie"), SESSION_COOKIE);
}

{
  const { calls, fetchImpl } = mockFetch(200, { body: "{}" });
  await hostFetch({
    path: "/web/context",
    fetchImpl,
    env: { CODEATTEST_HOST_BASE_URL: "http://localhost:9999" }
  });
  assert.equal(calls[0].url, "http://localhost:9999/web/context");
}

{
  const fetchImpl = async () => new Response("{\"reason_code\":\"auth_credentials_invalid\"}", { status: 401 });
  const result = await hostFetch({
    path: "/web/context",
    cookie: SESSION_COOKIE,
    fetchImpl,
    env
  });
  assert.equal(result.kind, "session-expired");
}

const { LoginForm } = await importCompiled("src/login-form.js");
const { loginToHost, createLoginPostHandler, createLogoutPostHandler } = await importCompiled("lib/session.js");
const loginRoute = await importCompiled("app/v0/auth/login/route.js");
const { POST } = await importCompiled("app/logout/route.js");
const { SessionExpiredPage } = await importCompiled("app/session-expired/page.js");
const { RiskWarning } = await importCompiled("components/RiskWarning.js");

assert.equal(typeof LoginForm, "function");
assert.equal(typeof loginRoute.POST, "function");
assert.equal(typeof POST, "function");
assert.equal(typeof RiskWarning, "function");

const loginHtml = renderToStaticMarkup(createElement(LoginForm));
assert.match(loginHtml, /action="\/v0\/auth\/login"/);
assert.match(loginHtml, /name="identifier"/);
assert.match(loginHtml, /name="secret"/);

{
  const setCookie = "codeattest_session_insecure_local=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600";
  const { calls, fetchImpl } = mockFetch(204, { headers: { "set-cookie": setCookie } });
  const result = await loginToHost({
    identifier: "customer@example.test",
    secret: "s3cret",
    fetchImpl,
    env
  });
  assert.equal(result.kind, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/v0/auth/login`);
  assert.equal(String(calls[0].init.method).toUpperCase(), "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { identifier: "customer@example.test", secret: "s3cret" });
  assert.match(headerValue(calls[0].init, "content-type") ?? "", /application\/json/i);

  const form = new FormData();
  form.set("identifier", "customer@example.test");
  form.set("secret", "s3cret");
  const loginResponse = await createLoginPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/v0/auth/login", {
    method: "POST",
    body: form
  }));
  assert.equal(loginResponse.headers.get("location"), "/");
  assert.match(loginResponse.headers.getSetCookie().join("\n"), /HttpOnly/);
}

{
  const setCookie = "codeattest_session_insecure_local=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0";
  const { calls, fetchImpl } = mockFetch(204, { headers: { "set-cookie": setCookie } });
  const POSTInjected = createLogoutPostHandler({ fetchImpl, env });
  const response = await POSTInjected(new Request("http://127.0.0.1:3000/logout", {
    method: "POST",
    headers: { cookie: SESSION_COOKIE }
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/v0/auth/logout`);
  assert.equal(String(calls[0].init.method).toUpperCase(), "POST");
  assert.equal(headerValue(calls[0].init, "cookie"), SESSION_COOKIE);
  assert.equal(response.headers.get("location"), "/login");
  assert.match(response.headers.getSetCookie().join("\n"), /Max-Age=0/);
}

const sessionExpiredHtml = renderToStaticMarkup(createElement(SessionExpiredPage));
assert.match(sessionExpiredHtml, /role="alert"/);
assert.match(sessionExpiredHtml, /href="\/login"/);

console.log("@onevps/web auth vertical test passed.");
