import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const { contentSecurityPolicy, mintCspNonce } = await importCompiled("lib/security-headers.js");
const { RootLayout } = await importCompiled("src/root-layout.js");

function directives(policy) {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    })
  );
}

// --- nonce ---------------------------------------------------------------------
const nonce = mintCspNonce();
assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/, "a nonce is 128 random bits in base64");
assert.notEqual(mintCspNonce(), nonce, "each request gets a new nonce");

// --- production policy -----------------------------------------------------------
{
  const policy = directives(contentSecurityPolicy("abc123", { development: false }));
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"], "no site may frame the app");
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("base-uri"), ["'none'"]);
  assert.deepEqual(policy.get("form-action"), ["'self'"], "forms post only to this origin");
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  const scripts = policy.get("script-src");
  assert.ok(scripts.includes("'nonce-abc123'") && scripts.includes("'strict-dynamic'"));
  assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"),
    "production scripts run only by nonce");
  const styles = policy.get("style-src");
  assert.ok(styles.includes("'nonce-abc123'") && !styles.includes("'unsafe-inline'"),
    "production inline styles run only by nonce");
  assert.ok(policy.has("upgrade-insecure-requests"));
}

// --- development policy ------------------------------------------------------------
{
  const policy = directives(contentSecurityPolicy("abc123", { development: true }));
  assert.ok(policy.get("script-src").includes("'unsafe-eval'"), "React dev tooling needs eval");
  assert.ok(!policy.has("upgrade-insecure-requests"), "the dev server is plain http");
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
}

// --- the root layout works under the nonce policy -------------------------------------
{
  const html = renderToStaticMarkup(createElement(RootLayout, { nonce: "abc123" }, "child"));
  assert.doesNotMatch(html, /<html[^>]*\sstyle=/, "a style attribute cannot carry a nonce, so CSP would block it");
  assert.match(html, /<style nonce="abc123">:root\{--ca-surface-base:[^;]+;/, "the tokens are in the nonced <style>");
  assert.match(html, /prefers-reduced-motion/);
  assert.equal((html.match(/<style\b/g) ?? []).length, 1);
}

// --- adapters carry no style attribute either -----------------------------------------
// The 44px minimum target comes from globals.css through data-min-target-size-px;
// an inline style would be blocked by the nonce policy and silently do nothing.
{
  const { actionableAttributes } = await importCompiled("components/a11y.js");
  assert.equal("style" in actionableAttributes({ minTargetSizePx: 44 }), false);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\[data-min-target-size-px\]\s*\{\s*min-width: var\(--ca-min-target\);\s*min-height: var\(--ca-min-target\);/);
}

// --- the layout reads the nonce from proxy.ts --------------------------------------
{
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /headers\(\)\)\.get\("x-nonce"\)/);
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /export function proxy\(/, "Next.js 16 runs proxy.ts as the request proxy");
  assert.match(proxy, /requestHeaders\.set\("x-nonce", nonce\)/);
  assert.match(proxy, /requestHeaders\.set\("Content-Security-Policy", policy\)/,
    "Next.js reads the nonce from the request policy to put it on its scripts");
  assert.match(proxy, /response\.headers\.set\("Content-Security-Policy", policy\)/);
}

// --- static headers on every response ------------------------------------------------
{
  const config = (await import(new URL("../next.config.mjs", import.meta.url).href)).default;
  assert.equal(config.poweredByHeader, false);
  const routes = await config.headers();
  const all = routes.find((route) => route.source === "/:path*");
  assert.ok(all, "the static headers apply to every path");
  const byName = new Map(all.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(byName.get("x-content-type-options"), "nosniff");
  assert.equal(byName.get("x-frame-options"), "DENY");
  assert.equal(byName.get("referrer-policy"), "no-referrer");
  assert.ok(byName.has("permissions-policy"));
}

console.log("@onevps/web security headers test passed.");
