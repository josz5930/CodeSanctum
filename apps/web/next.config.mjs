import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(workspaceDir, "../.."),
  reactStrictMode: true,
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
