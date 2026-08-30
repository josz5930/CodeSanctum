import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Protocol-owned source of truth for the forbidden claim families (E-6): E adds
// no static copy implying certification, auditor/regulator acceptance,
// independent assurance, absence of vulnerabilities, or a receipt/closure where
// none exists. Builder-produced text is `packages/ui`'s responsibility; this
// gate covers only the chrome copy E itself authors.
const policyPath = fileURLToPath(new URL("../../../protocol/policies/claim-safety.v0.json", import.meta.url));
const policy = JSON.parse(await readFile(policyPath, "utf8"));
const forbidden = policy.claim_safe_forbidden_phrases.map((phrase) => phrase.toLowerCase());

/** Strip block and line comments so the gate scans visible copy, not the
 * design rationale in JSDoc that necessarily names these forbidden concepts. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

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
    const copy = stripComments(await readFile(file, "utf8")).toLowerCase();
    for (const phrase of forbidden) {
      assert.ok(!copy.includes(phrase), `${path.relative(process.cwd(), file)} contains forbidden claim copy: "${phrase}"`);
    }
  }
}
assert.ok(scanned > 0, "claim-safety scan found no apps/web source files");

console.log(`@onevps/web claim-safety copy test passed over ${scanned} files.`);
