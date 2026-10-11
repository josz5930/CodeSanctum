import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const deployDir = "infra/deploy";

async function available(command) {
  const paths = (process.env.PATH ?? "").split(path.delimiter);
  return Promise.any(paths.map((entry) => access(path.join(entry, command)))).then(() => true, () => false);
}

function requireMatch(text, expression, message, failures) {
  if (!expression.test(text)) {
    failures.push(message);
  }
}

async function verifySystemd(files, failures) {
  if (!(await available("systemd-analyze"))) {
    return "PENDING: systemd-analyze is unavailable";
  }
  const temp = await mkdtemp(path.join(tmpdir(), "onevps-systemd-"));
  const normalized = [];
  for (const [name, text] of files) {
    const target = path.join(temp, name.replace(/\.tmpl$/u, ""));
    const safe = text
      .replace(/^User=.*$/mu, "User=root")
      .replace(/^Group=.*$/mu, "Group=root")
      .replace(/^WorkingDirectory=.*$/mu, "WorkingDirectory=/tmp")
      .replace(/^ExecStart=.*$/mu, "ExecStart=/bin/true");
    await writeFile(target, safe);
    normalized.push(target);
  }
  try {
    await execFileAsync("systemd-analyze", ["verify", ...normalized]);
  } catch (error) {
    failures.push(`systemd-analyze verify failed: ${error.stderr || error.message}`);
  }
  return "systemd-analyze verify passed";
}

async function verifyCaddy(caddyfile, failures) {
  if (!(await available("caddy"))) {
    return "PENDING: caddy is unavailable";
  }
  const temp = await mkdtemp(path.join(tmpdir(), "onevps-caddy-"));
  const target = path.join(temp, "Caddyfile");
  await writeFile(target, caddyfile);
  try {
    await execFileAsync("caddy", ["validate", "--config", target], {
      env: {
        ...process.env,
        CODEATTEST_DEMO_HOSTNAME: "demo.example.invalid",
        CODEATTEST_PILOT_HOSTNAME: "pilot.example.invalid"
      }
    });
  } catch (error) {
    failures.push(`caddy validate failed: ${error.stderr || error.message}`);
  }
  return "caddy validate passed";
}

// Caddy `path` matchers: a pattern that ends in `*` is a prefix match, any
// other pattern is an exact match.
function caddyHostPathPatterns(caddyfile) {
  const patterns = [];
  for (const match of caddyfile.matchAll(/^\s*@\w+ path (.+)$/gm)) {
    patterns.push(...match[1].trim().split(/\s+/));
  }
  return patterns;
}

function caddySendsToHost(patterns, urlPath) {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? urlPath.startsWith(pattern.slice(0, -1)) : urlPath === pattern
  );
}

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await filesUnder(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every Next.js page and route handler, and every form action in the web app,
 * must reach Next.js through Caddy. A path that Caddy sends to the host never
 * reaches the Next handler, so the deployed app breaks while unit tests that
 * call the handler directly still pass.
 */
async function verifyWebRouting(root, caddyfile, failures) {
  const patterns = caddyHostPathPatterns(caddyfile);
  if (patterns.length === 0) {
    failures.push("Caddyfile has no host path matchers to check web routes against");
    return;
  }
  const webDir = path.join(root, "apps/web");
  const appDir = path.join(webDir, "app");
  const nextRoutes = new Set();
  for (const file of await filesUnder(appDir)) {
    const base = path.basename(file);
    if (!/^(page|route)\.tsx?$/.test(base)) {
      continue;
    }
    const segments = path.relative(appDir, path.dirname(file)).split(path.sep).filter((segment) => segment.length > 0);
    // A dynamic segment such as [scope] stands for any single value.
    const urlPath = `/${segments.map((segment) => (segment.startsWith("[") ? "sample" : segment)).join("/")}`;
    nextRoutes.add(urlPath);
    if (caddySendsToHost(patterns, urlPath)) {
      failures.push(`Caddy sends Next.js ${base === "route.ts" ? "route" : "page"} ${urlPath} to the host`);
    }
  }
  for (const sub of ["app", "components", "src"]) {
    for (const file of await filesUnder(path.join(webDir, sub))) {
      if (!file.endsWith(".tsx")) {
        continue;
      }
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/<form\b[^>]*\baction="([^"]+)"/g)) {
        const action = match[1];
        const where = path.relative(root, file);
        if (caddySendsToHost(patterns, action)) {
          failures.push(`${where}: form action ${action} goes to the host, not to Next.js`);
        } else if (!nextRoutes.has(action)) {
          failures.push(`${where}: form action ${action} has no Next.js route`);
        }
      }
    }
  }
}

export async function checkDeployTemplates(root = repoRoot) {
  const names = [
    "codeattest-demo.service.tmpl",
    "codeattest-pilot.service.tmpl",
    "codeattest-demo-web.service.tmpl",
    "codeattest-pilot-web.service.tmpl",
    "observability.service.tmpl",
    "observability.timer.tmpl"
  ];
  const files = await Promise.all(names.map(async (name) => [name, await readFile(path.join(root, deployDir, name), "utf8")]));
  const byName = new Map(files);
  const failures = [];

  for (const identity of ["demo", "pilot"]) {
    const host = byName.get(`codeattest-${identity}.service.tmpl`);
    const web = byName.get(`codeattest-${identity}-web.service.tmpl`);
    requireMatch(host, new RegExp(`^User=codeattest-${identity}$`, "m"), `${identity} host has the wrong Unix user`, failures);
    requireMatch(host, new RegExp(`^WorkingDirectory=/opt/codeattest/${identity}/`, "m"), `${identity} host is not on native disk`, failures);
    requireMatch(host, new RegExp(` /etc/codeattest/${identity}-host\\.json$`, "m"), `${identity} host does not use its mode-0600 config path`, failures);
    requireMatch(host, /^Restart=on-failure$/m, `${identity} host is not restart-supervised`, failures);
    requireMatch(host, /^TimeoutStopSec=(?:1[0-9]|[2-9][0-9]+)s$/m, `${identity} host drain deadline is too short`, failures);

    requireMatch(web, new RegExp(`^User=codeattest-${identity}$`, "m"), `${identity} web has the wrong Unix user`, failures);
    requireMatch(web, new RegExp(`^WorkingDirectory=/opt/codeattest/${identity}/web$`, "m"), `${identity} web is not rooted on native disk`, failures);
    const hostBaseUrls = web.match(/^Environment=CODEATTEST_HOST_BASE_URL=.*$/gm) ?? [];
    if (hostBaseUrls.length !== 1) {
      failures.push(`${identity} web must have exactly one host base URL`);
    }
    const expectedHostPort = identity === "demo" ? 8080 : 8081;
    const expectedWebPort = identity === "demo" ? 3000 : 3001;
    requireMatch(web, new RegExp(`CODEATTEST_HOST_BASE_URL=http://127\\.0\\.0\\.1:${expectedHostPort}$`, "m"), `${identity} web points at the wrong host`, failures);
    requireMatch(web, new RegExp(`--hostname 127\\.0\\.0\\.1 --port ${expectedWebPort}$`, "m"), `${identity} web is not bound to its own loopback port`, failures);
  }
  if (files.some(([, text]) => text.includes("/mnt/hgfs"))) {
    failures.push("a systemd template references /mnt/hgfs");
  }

  const caddyfile = await readFile(path.join(root, deployDir, "Caddyfile.tmpl"), "utf8");
  requireMatch(caddyfile, /\{\$CODEATTEST_DEMO_HOSTNAME\}[\s\S]*127\.0\.0\.1:8080[\s\S]*127\.0\.0\.1:3000/, "demo Caddy site is incomplete", failures);
  requireMatch(caddyfile, /\{\$CODEATTEST_PILOT_HOSTNAME\}[\s\S]*127\.0\.0\.1:8081[\s\S]*127\.0\.0\.1:3001/, "pilot Caddy site is incomplete", failures);
  if ((caddyfile.match(/^\{\$CODEATTEST_[A-Z_]+_HOSTNAME\} \{$/gm) ?? []).length !== 2) {
    failures.push("Caddyfile must contain exactly two TLS hostname site blocks");
  }

  await verifyWebRouting(root, caddyfile, failures);

  const toolStatus = [await verifySystemd(files, failures), await verifyCaddy(caddyfile, failures)];
  return { failures, toolStatus };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, toolStatus } = await checkDeployTemplates();
  for (const status of toolStatus) {
    console.log(status);
  }
  if (failures.length > 0) {
    console.error("Deploy template check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
  console.log("Deploy template check passed.");
}
