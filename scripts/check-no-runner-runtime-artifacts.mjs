import { readdir } from "node:fs/promises";
import path from "node:path";

// C8-17: `runner/` is intended public/open-source, and `.codeattest/` is the
// runner's own local, append-only runtime output directory (attempt logs,
// captured scope/scanner/manifest/bundle artifacts) — real usage can and did
// leave one checked into the source tree, including customer-shaped actor
// metadata. `.gitignore` keeps a future one from being committed via `git
// add`, but this repo predates that guarantee being testable by git status
// (no `.git` here yet), so this gate fails closed independent of git by
// walking the tree directly for any `.codeattest` directory under `runner/`.
const runnerRoot = path.resolve("runner");
const errors = [];

await walk(runnerRoot);

if (errors.length > 0) {
  console.error("Runner runtime-artifact check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Runner runtime-artifact check passed: no checked-in .codeattest/ runtime output under runner/.");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === ".codeattest") {
      errors.push(`${path.relative(process.cwd(), absolutePath)} is a checked-in runtime output directory; runner/ must stay free of local .codeattest/ artifacts`);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(absolutePath);
    }
  }
}
