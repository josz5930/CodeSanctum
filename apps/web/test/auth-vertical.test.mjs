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
const loginRoute = await importCompiled("app/session/login/route.js");
const { POST } = await importCompiled("app/logout/route.js");
const { SessionExpiredPage } = await importCompiled("app/session-expired/page.js");
const { RiskWarning } = await importCompiled("components/RiskWarning.js");

assert.equal(typeof LoginForm, "function");
assert.equal(typeof loginRoute.POST, "function");
assert.equal(typeof POST, "function");
assert.equal(typeof RiskWarning, "function");

const loginHtml = renderToStaticMarkup(createElement(LoginForm));
// Caddy sends /v0/* to the host, so the form must post to a path Next.js serves.
assert.match(loginHtml, /action="\/session\/login"/);
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
  const loginResponse = await createLoginPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/session/login", {
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

// --- second factor ------------------------------------------------------------
{
  const pendingCookie = "codeattest_session_insecure_local=pending; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600";
  const { fetchImpl } = mockFetch(202, {
    body: "{\"second_factor_required\":true}",
    headers: { "set-cookie": pendingCookie }
  });
  const form = new FormData();
  form.set("identifier", "reviewer@example.test");
  form.set("secret", "s3cret");
  const response = await createLoginPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/session/login", {
    method: "POST",
    body: form
  }));
  assert.equal(response.headers.get("location"), "/login/second-factor",
    "a TOTP account must go to the code page, not to a dashboard its pending session cannot open");
  assert.match(response.headers.getSetCookie().join("\n"), /=pending;/, "the pending cookie must reach the browser");
}

const { SecondFactorForm } = await importCompiled("src/second-factor-form.js");
const secondFactorPage = await importCompiled("app/login/second-factor/page.js");
const secondFactorRoute = await importCompiled("app/session/second-factor/route.js");
const { createSecondFactorPostHandler } = await importCompiled("lib/session.js");
assert.equal(typeof secondFactorRoute.POST, "function");

const secondFactorHtml = renderToStaticMarkup(createElement(SecondFactorForm));
// Caddy sends /v0/* to the host, so the form must post to a path Next.js serves.
assert.match(secondFactorHtml, /action="\/session\/second-factor"/);
assert.match(secondFactorHtml, /name="code"/);
assert.match(secondFactorHtml, /autocomplete="one-time-code"/i);
assert.doesNotMatch(secondFactorHtml, /role="alert"/);

const rejectedHtml = renderToStaticMarkup(
  await secondFactorPage.default({ searchParams: Promise.resolve({ error: "code" }) })
);
assert.match(rejectedHtml, /role="alert"/);
assert.match(rejectedHtml, /href="\/login"/);
const plainHtml = renderToStaticMarkup(await secondFactorPage.default({ searchParams: Promise.resolve({}) }));
assert.doesNotMatch(plainHtml, /role="alert"/);

{
  const satisfiedCookie = "codeattest_session_insecure_local=satisfied; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600";
  const { calls, fetchImpl } = mockFetch(204, { headers: { "set-cookie": satisfiedCookie } });
  const form = new FormData();
  form.set("code", "123 456");
  const response = await createSecondFactorPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/session/second-factor", {
    method: "POST",
    headers: { cookie: SESSION_COOKIE },
    body: form
  }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/v0/auth/login/second-factor`);
  assert.equal(String(calls[0].init.method).toUpperCase(), "POST");
  assert.equal(headerValue(calls[0].init, "cookie"), SESSION_COOKIE, "the pending session cookie must be forwarded");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { code: "123456" }, "spaces in the code are removed");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.match(response.headers.getSetCookie().join("\n"), /=satisfied;/);
}

{
  const { fetchImpl } = mockFetch(401, { body: "{\"reason_code\":\"auth_credentials_invalid\"}" });
  const form = new FormData();
  form.set("code", "000000");
  const response = await createSecondFactorPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/session/second-factor", {
    method: "POST",
    headers: { cookie: SESSION_COOKIE },
    body: form
  }));
  assert.equal(response.headers.get("location"), "/login/second-factor?error=code");
  assert.deepEqual(response.headers.getSetCookie(), [], "a refused code must not set a cookie");
}

{
  const { calls, fetchImpl } = mockFetch(204);
  const form = new FormData();
  form.set("code", "123456");
  const response = await createSecondFactorPostHandler({ fetchImpl, env })(new Request("http://127.0.0.1:3000/session/second-factor", {
    method: "POST",
    body: form
  }));
  assert.equal(calls.length, 0, "with no pending session there is nothing to send to the host");
  assert.equal(response.headers.get("location"), "/login");
}

const sessionExpiredHtml = renderToStaticMarkup(createElement(SessionExpiredPage));
assert.match(sessionExpiredHtml, /role="alert"/);
assert.match(sessionExpiredHtml, /href="\/login"/);

console.log("@onevps/web auth vertical test passed.");
