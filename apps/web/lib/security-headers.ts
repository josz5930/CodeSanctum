/**
 * The Content-Security-Policy for every page this app renders. `proxy.ts`
 * mints a fresh nonce per request and sends this policy on both the request
 * (so Next.js puts the nonce on its own scripts and styles) and the response
 * (so the browser enforces it). The root layout puts the same nonce on its one
 * `<style>` element. Pages must render dynamically for the nonce to reach them;
 * the root layout reads request headers, which makes every page dynamic.
 *
 * Development needs `'unsafe-eval'` (React debugging) and inline styles (the
 * dev CSS loader); neither is in the production policy.
 */
export function contentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    options.development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  if (!options.development) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

/** A base64 nonce from 128 random bits, as CSP Level 3 recommends. */
export function mintCspNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

