import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, mintCspNonce } from "./lib/security-headers.js";

/**
 * Sends a nonce-based Content-Security-Policy on every page. The policy goes
 * on the forwarded request too: Next.js reads the nonce from it and puts it on
 * the scripts and styles it renders. The root layout reads `x-nonce`.
 */
export function proxy(request: NextRequest) {
  const nonce = mintCspNonce();
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Static build output and prefetches need no page policy.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
