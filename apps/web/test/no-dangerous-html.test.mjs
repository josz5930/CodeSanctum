import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// E-6: text crosses the render boundary only through React's default escaping.
// No adapter may inject raw HTML, so no page in apps/web can smuggle unescaped
// evidence-derived text into the DOM.
const FORBIDDEN = ["dangerouslySetInnerHTML", "innerHTML", "insertAdjacentHTML", "document.write", "outerHTML"];

async function collectSourceFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

const roots = ["app", "components", "lib"].map((name) => fileURLToPath(new URL(`../${name}`, import.meta.url)));
let scanned = 0;
for (const root of roots) {
  for (const file of await collectSourceFiles(root)) {
    scanned += 1;
    const source = await readFile(file, "utf8");
    for (const token of FORBIDDEN) {
      assert.ok(!source.includes(token), `${path.relative(process.cwd(), file)} must not use raw-HTML insertion: "${token}"`);
    }
  }
}
assert.ok(scanned > 0, "render-boundary scan found no apps/web source files");

console.log(`@onevps/web no-dangerous-html test passed over ${scanned} files.`);
