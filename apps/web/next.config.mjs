import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Security headers that do not change per request, sent on every response
 * (static assets included). The per-request Content-Security-Policy, with its
 * frame-ancestors 'none', comes from proxy.ts. Caddy sets these headers again,
 * with HSTS, at the edge.
 */
export const staticSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(workspaceDir, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: staticSecurityHeaders }];
  },
  // `verbatimModuleSyntax` requires explicit `.js` specifiers on the workspace's
  // TypeScript imports; map them back to the real `.ts(x)` sources so the
  // production build resolves them the same way `tsc` does.
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"]
    };
    return config;
  }
};

export default nextConfig;
