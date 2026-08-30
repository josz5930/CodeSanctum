import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const routesDir = fileURLToPath(new URL("../src/routes/", import.meta.url));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

let scanned = 0;
for await (const file of walk(routesDir)) {
  scanned += 1;
  const source = await readFile(file, "utf8");
  assert.ok(
    !source.includes("enforceScopedAccess"),
    `${path.relative(routesDir, file)} references enforceScopedAccess directly. ` +
      "Routes must call requireEvidenceAccess, which sources tenant_id, review_scope, " +
      "and role from the resolved session actor. A route that builds its own access " +
      "request can take those values from a request body, and the access check " +
      "becomes advisory."
  );
  // The same hole, reached a different way.
  assert.ok(!/\bcontrol-plane\/src\/index\.js/.test(source),
    `${path.relative(routesDir, file)} imports the control-plane barrel directly.`);
}
assert.ok(scanned > 0, "the scan found no route files, so it proved nothing");

console.log(`Route access-check scan passed over ${scanned} files.`);
