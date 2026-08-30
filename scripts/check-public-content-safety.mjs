// Public-surface content-safety gate (C8-20). Public documentation is
// covered by scripts/check-format.mjs for formatting, but nothing previously
// scanned docs/, protocol/, or runner/ prose for leaked secrets/credentials,
// real PII, or hidden/bidi spoofing characters.
//
// Scope note: this intentionally does NOT reuse
// scripts/lib/protocol-utils.mjs's customerVisibleTextForbidden() /
// SECRET_FORBIDDEN_PHRASES wholesale. Those are calibrated for short
// structured protocol FIELD VALUES (Attestation text, customer summaries),
// where a bare phrase like "vendor receipt" or "auditor acceptance"
// represents an improper claim. Running that same detector line-by-line
// against this repo's actual prose documentation produced dozens of false
// positives: protocol terminology used descriptively ("Vendor Receipt",
// "scanner stdout" as a thing the runner does NOT print), audience
// descriptions ("audit-readiness teams"), and — most importantly — negated
// disclaimers ("does not prove absence of vulnerabilities", "should not
// describe it as: a guarantee that code is secure") that the claim-safety
// exact-phrase/family patterns have no negation-awareness for outside a
// single field value. Building genuine negation/discourse understanding for
// arbitrary long-form English prose is out of proportion to this finding, so
// this scanner instead targets categories that are unsafe in ANY sentence
// context: credential-shaped leaks, non-reserved-domain email addresses, and
// hidden/bidi spoofing characters. See Code_Review_2026Aug3.md C8-20 for the
// full scoping note.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { CLAIM_SAFE_TEXT_MAX_LENGTH, PII_EMAIL_ADDRESS_PATTERN_SOURCE } from "./lib/protocol-utils.mjs";

const startPaths = ["docs", "protocol", "runner"];
const ignoredNames = new Set([
  ".agents",
  ".claude",
  ".git",
  ".DS_Store",
  "_bmad",
  "_bmad-output",
  "dist",
  "node_modules",
  "superpowers",
  "target"
]);
const scannedExtensions = new Set([".md", ".txt"]);
// private_key_block and ml_dsa_seed_assignment are the two credential
// patterns with essentially no legitimate-content false-positive risk (a
// real PEM header or a 43-character base64url literal assigned to a
// seed/signing_key_seed/test_seed_base64url field never appears in prose or
// source by accident), so they alone are worth scanning for outside prose
// files — the other credential patterns (secret_assignment,
// token_assignment, etc.) match on common field/variable names and would
// flood source and config files (e.g. the literal claim-safety forbidden-
// phrase lists in protocol/policies/claim-safety.v0.json and
// runner/crates/local-runner-scaffold/src/lib.rs) with false positives.
const KEY_MATERIAL_EXTENSIONS = new Set([...scannedExtensions, ".pem", ".key", ".json", ".rs", ".ts", ".mjs"]);
// protocol/fixtures/** is test payload content with its own dedicated,
// stricter checks (C8-06 leak-scan, C8-19 synthetic-marker fail-closed) —
// out of scope here, which is about documentation prose.
const excludedRoots = [path.resolve("protocol/fixtures")];

// RFC 2606 reserved example/documentation domains — legitimate in docs.
const RESERVED_EXAMPLE_DOMAINS = new Set(["example.com", "example.org", "example.net", "example.edu", "test.com"]);

const CREDENTIAL_PATTERNS = [
  { id: "secret_assignment", pattern: /\bsecret\s*[:=]\s*\S/iu },
  { id: "password_assignment", pattern: /\bpassword\s*[:=]\s*\S/iu },
  { id: "api_key_assignment", pattern: /\bapi[_-]key\s*[:=]\s*\S/iu },
  { id: "token_assignment", pattern: /\btoken\s*[:=]\s*\S/iu },
  { id: "authorization_bearer", pattern: /\bauthorization\s*:\s*bearer\s+\S/iu },
  { id: "access_token_assignment", pattern: /\baccess_token\s*[:=]\s*\S/iu },
  { id: "refresh_token_assignment", pattern: /\brefresh_token\s*[:=]\s*\S/iu },
  { id: "client_secret_assignment", pattern: /\bclient_secret\s*[:=]\s*\S/iu },
  { id: "private_key_assignment", pattern: /\bprivate_key\s*[:=]\s*\S/iu },
  { id: "secret_key_assignment", pattern: /\bsecret_key\s*[:=]\s*\S/iu },
  { id: "private_key_block", pattern: /-----BEGIN (?:ENCRYPTED |OPENSSH |EC |RSA )?PRIVATE KEY-----/u },
  { id: "ml_dsa_seed_assignment", pattern: /\b(?:seed|signing_key_seed|test_seed_base64url)\s*[:=]\s*["'][A-Za-z0-9_-]{43}["']/u }
];
const PRIVATE_KEY_BLOCK_PATTERN = CREDENTIAL_PATTERNS.find(({ id }) => id === "private_key_block").pattern;
const ML_DSA_SEED_PATTERN = CREDENTIAL_PATTERNS.find(({ id }) => id === "ml_dsa_seed_assignment").pattern;
const EMAIL_PATTERN = new RegExp(PII_EMAIL_ADDRESS_PATTERN_SOURCE, "giu");
const HIDDEN_CONTROL_CODEPOINT_RANGES = [
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0x202a, 0x202e],
  [0xfeff, 0xfeff]
];

const failures = [];

for (const startPath of startPaths) {
  await walk(path.resolve(startPath));
}

if (failures.length > 0) {
  console.error("Public content-safety check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Public content-safety check passed for ${startPaths.join(", ")}.`);

async function walk(absolutePath) {
  const name = path.basename(absolutePath);
  if (ignoredNames.has(name) || excludedRoots.includes(absolutePath)) {
    return;
  }

  const info = await stat(absolutePath);
  if (info.isDirectory()) {
    const entries = await readdir(absolutePath);
    for (const entry of entries) {
      await walk(path.join(absolutePath, entry));
    }
    return;
  }

  const extension = path.extname(absolutePath);
  if (!info.isFile() || !KEY_MATERIAL_EXTENSIONS.has(extension)) {
    return;
  }

  await scanFile(absolutePath, scannedExtensions.has(extension));
}

async function scanFile(absolutePath, fullScan) {
  const relativePath = path.relative(process.cwd(), absolutePath);
  const text = await readFile(absolutePath, "utf8");
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const reason = publicProseLeakReason(line, fullScan);
    if (reason !== undefined) {
      failures.push(`${relativePath}:${index + 1}: forbidden content (${reason})`);
    }
  });
}

function publicProseLeakReason(line, fullScan) {
  if (fullScan) {
    if (line.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
      return "text_too_long";
    }
    if (containsHiddenControlCharacter(line)) {
      return "hidden_control_character";
    }
    const credential = CREDENTIAL_PATTERNS.find(({ pattern }) => pattern.test(line));
    if (credential !== undefined) {
      return credential.id;
    }
    EMAIL_PATTERN.lastIndex = 0;
    let emailMatch;
    while ((emailMatch = EMAIL_PATTERN.exec(line)) !== null) {
      if (!RESERVED_EXAMPLE_DOMAINS.has(emailMatch[1].toLowerCase())) {
        return "email_address";
      }
    }
    return undefined;
  }

  // Non-prose extensions (.pem, .key, .json, .rs, .ts, .mjs) are only
  // scanned for actual key material — the other credential patterns key off
  // common field/variable names and are too broad to run against source and
  // config files without flooding on legitimate content.
  if (PRIVATE_KEY_BLOCK_PATTERN.test(line)) {
    return "private_key_block";
  }
  return ML_DSA_SEED_PATTERN.test(line) ? "ml_dsa_seed_assignment" : undefined;
}

function containsHiddenControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (HIDDEN_CONTROL_CODEPOINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return true;
    }
  }
  return false;
}
