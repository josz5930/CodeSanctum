import { readdir } from "node:fs/promises";
import path from "node:path";

// C8-14: the original dependency-direction scanner covered only
// .js/.mjs/.ts/.rs and matched forbidden targets with a regex anchored to
// the start of the quoted specifier, so it never resolved `../` segments.
// A relative specifier that spells the same forbidden target differently
// (e.g. `../protocol/../packages/ui/src/index.js`, which resolves to
// `packages/ui/src/index.js`) could slip past an anchor-at-the-quote regex.
// This module extracts real module specifiers and Rust path literals, then
// hands callers a *resolved* absolute path so root-containment can be
// checked after normalization instead of on raw, unresolved text.
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".rs"]);
const SCANNED_BASENAMES = new Set(["Cargo.toml", "build.rs"]);

export function isScannedFile(fileName) {
  return SCANNED_BASENAMES.has(fileName) || SCANNED_EXTENSIONS.has(path.extname(fileName));
}

export async function walkFiles(directory, excludePath) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (absolutePath === excludePath) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath, excludePath)));
      continue;
    }
    if (entry.isFile() && isScannedFile(entry.name)) {
      files.push(absolutePath);
    }
  }
  return files;
}

// Matches the quoted specifier of real static import/export, dynamic
// import(), and require() syntax only — not arbitrary string literals — to
// avoid false-flagging unrelated strings that merely contain "../".
const JS_SPECIFIER_PATTERNS = [
  /\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
];

export function extractJsSpecifiers(source) {
  const specifiers = [];
  for (const pattern of JS_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

// Cargo.toml `path = "../.."` dependencies and build.rs literals don't use
// import/require syntax, so instead scan for any quoted relative-path-shaped
// literal (starts with "./" or "../").
const RELATIVE_PATH_LITERAL_PATTERN = /["'](\.\.?\/[^"']*)["']/g;

export function extractRelativePathLiterals(source) {
  return [...source.matchAll(RELATIVE_PATH_LITERAL_PATTERN)].map((match) => match[1]);
}

// C8-16: Rust source doesn't use import/require syntax, but `include!`,
// `include_str!`, and `include_bytes!` are real filesystem-inclusion
// mechanisms (unlike an arbitrary string literal, which can incidentally
// look path-shaped in test fixture data without referencing a real file).
const RUST_INCLUDE_MACRO_PATTERN = /\binclude(?:_str|_bytes)?!\s*\(\s*["']([^"']+)["']/g;

export function extractRustIncludeMacroPaths(source) {
  return [...source.matchAll(RUST_INCLUDE_MACRO_PATTERN)].map((match) => match[1]);
}

export function resolveRelativeSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return path.resolve(path.dirname(fromFile), specifier);
}

export function isWithinRoot(resolvedPath, root) {
  return resolvedPath === root || resolvedPath.startsWith(root + path.sep);
}
