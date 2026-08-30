import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const roots = process.argv.slice(2);
const defaultStartPaths = [
  ".github/workflows/ci.yml",
  ".gitignore",
  ".node-version",
  ".nvmrc",
  "Cargo.toml",
  "README.md",
  "apps",
  "infra",
  "package-lock.json",
  "package.json",
  "packages",
  "protocol",
  "runner",
  "rust-toolchain.toml",
  "scripts",
  "services",
  "tsconfig.base.json",
  "tsconfig.json"
];
const startPaths = roots.length > 0 ? roots : defaultStartPaths;
const ignoredNames = new Set([
  ".agents",
  ".claude",
  ".git",
  ".DS_Store",
  "_bmad",
  "_bmad-output",
  "dist",
  "node_modules",
  "target",
  ".next"
]);
// C7-37: this repo has runner/demo Python snippets and .jsonl attempt logs
// where CRLF/trailing-whitespace/missing-final-newline issues matter just as
// much as in the already-checked extensions, but they were silently skipped.
const textExtensions = new Set([
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".py",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".css",
  ".txt",
  ".yml",
  ".yaml"
]);
const textFiles = new Set([".gitignore", ".node-version", ".nvmrc"]);

const failures = [];

for (const startPath of startPaths) {
  await walk(path.resolve(startPath));
}

if (failures.length > 0) {
  console.error("Format check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Format check passed for ${startPaths.join(", ")}.`);

async function walk(absolutePath) {
  const info = await stat(absolutePath);
  const name = path.basename(absolutePath);

  if (ignoredNames.has(name)) {
    return;
  }

  if (info.isDirectory()) {
    const entries = await readdir(absolutePath);
    for (const entry of entries) {
      await walk(path.join(absolutePath, entry));
    }
    return;
  }

  if (!info.isFile() || !isTextFile(absolutePath)) {
    return;
  }

  const relativePath = path.relative(process.cwd(), absolutePath) || path.basename(absolutePath);
  const text = await readFile(absolutePath, "utf8");

  if (text.length > 0 && !text.endsWith("\n")) {
    failures.push(`${relativePath}: missing final newline`);
  }

  if (text.includes("\r\n")) {
    failures.push(`${relativePath}: contains CRLF line endings`);
  }

  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${relativePath}:${index + 1}: trailing whitespace`);
    }
  });
}

function isTextFile(filePath) {
  const baseName = path.basename(filePath);
  return textFiles.has(baseName) || textExtensions.has(path.extname(filePath));
}
