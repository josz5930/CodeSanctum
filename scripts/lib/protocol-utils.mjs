import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import canonicalizeJson from "canonicalize";

export const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const claimSafetyPolicy = JSON.parse(readFileSync(resolveProjectPath("protocol/policies/claim-safety.v0.json"), "utf8"));
export const CLAIM_SAFE_FORBIDDEN_PHRASES = loadSharedPhraseArray("claim_safe_forbidden_phrases");
export const CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES = loadSharedPhraseArray("positive_closure_phrases");
export const CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES = loadSharedPhraseArray("typed_reference_namespaces");
export const CLAIM_SAFE_TEXT_MAX_LENGTH = loadSharedPositiveInteger("claim_safe_text_max_length");
export const PII_EMAIL_ADDRESS_PATTERN_SOURCE = loadSharedNonEmptyString("pii_email_address_pattern");
export const SECRET_FORBIDDEN_PHRASES = loadSharedPhraseArray("source_text_forbidden_phrases");

// Sub-project B: the local-runner-attempt schema's own protocol tokens for a
// submit-stage remote_state. Stripped from a submit attempt's text before the
// claim-safety scan below -- see validateLocalRunnerAttemptSemantics.
const SUBMIT_REMOTE_STATE_TOKENS = ["submit_attempted", "received_with_receipt", "rejected_no_receipt", "quarantined_no_receipt"];

// Distinct sentinel for "text exceeded CLAIM_SAFE_TEXT_MAX_LENGTH", returned from
// the same slot that otherwise carries a matched phrase or PII-family id. Compare
// against this constant rather than the string literal so callers that interpolate
// the return value into a message don't read it as an offending phrase.
export const TEXT_TOO_LONG_REASON = "text_too_long";

// Protocol-owned policy artifact: protocol/ must remain the source of truth for
// claim-safety semantics, so this reads only protocol/policies/**, never the
// protocol-ts package's hand-written implementation source. See
// protocol/README.md and the dependency-direction guard in
// check-dependency-direction.mjs.
function loadSharedPhraseArray(policyKey) {
  const phrases = claimSafetyPolicy[policyKey];
  if (!Array.isArray(phrases) || phrases.length === 0 || phrases.some((phrase) => typeof phrase !== "string" || phrase.length === 0)) {
    throw new Error(`Shared ${policyKey} list is empty or malformed in protocol/policies/claim-safety.v0.json`);
  }
  return phrases;
}

function loadSharedNonEmptyString(policyKey) {
  const value = claimSafetyPolicy[policyKey];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Shared ${policyKey} is empty or malformed in protocol/policies/claim-safety.v0.json`);
  }
  return value;
}

function loadSharedPositiveInteger(policyKey) {
  const value = claimSafetyPolicy[policyKey];
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Shared ${policyKey} is empty or malformed in protocol/policies/claim-safety.v0.json`);
  }
  return value;
}

function normalizeSharedForbiddenText(value) {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−﹣－]/gu, "-")
    .replace(/[​-‏⁠﻿]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\bsoc\s*-\s*2\b/gu, "soc 2")
    .replace(/\bsoc2\b/gu, "soc 2")
    .replace(/\s*([:=])\s*/gu, "$1")
    .replace(/\bs\s+e\s+c\s+r\s+e\s+t([=:])/gu, "secret$1")
    .replace(/\bp\s+a\s+s\s+s\s+w\s+o\s+r\s+d([=:])/gu, "password$1")
    .replace(/\bt\s+o\s+k\s+e\s+n([=:])/gu, "token$1")
    // C7-20: the original api_key normalization only recognized the
    // individually-letter-spaced form immediately followed by a separator
    // (`a p i k e y=`), so realistic variants like "api key", "apikey", and
    // spaced letters with no trailing `=`/`:` sailed through unnormalized.
    // Every inter-letter gap accepts whitespace/underscore/dash (mirrors
    // protocol-ts's normalizeForbiddenText) so "a_p_i_k_e_y" and
    // "a-p-i-k-e-y" normalize the same as "a p i k e y" — keep both in sync.
    .replace(/\ba[\s_-]*p[\s_-]*i[\s_-]*k[\s_-]*e[\s_-]*y\b/gu, "api_key")
    .replace(/\bapi[\s_-]*key\b/gu, "api_key")
    .replace(/\bauthorization\s*[:=]?\s*bearer\b/gu, "authorization:bearer")
    .replace(/\b(secret|password|api_key|api-key|token)([=:])\s+/gu, "$1$2");
}

function sharedForbiddenPhrasePresent(value, phrase) {
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return false;
  }
  const normalizedValue = normalizeSharedForbiddenText(value);
  const normalizedPhrase = normalizeSharedForbiddenText(phrase);
  const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const prefix = /^[a-z0-9]/u.test(normalizedPhrase) ? "(?:^|[^a-z0-9])" : "";
  const suffix = /[a-z0-9]$/u.test(normalizedPhrase) ? "(?:$|[^a-z0-9])" : "";
  return new RegExp(`${prefix}${escapedPhrase}${suffix}`, "u").test(normalizedValue);
}

// C7-24: runner story gates each maintained their own narrow local forbidden-text
// list instead of reusing the shared, normalization-aware source/claim-safety
// phrase lists, so credential-shaped or claim-unsafe text outside a gate's local
// list could still be emitted. `fail` receives one message per violation so
// callers can format/exit however their script already does.
export function assertNoSharedForbiddenText(text, label, fail) {
  if (typeof text === "string" && text.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    fail(`${label} exceeds the maximum allowed text length (${TEXT_TOO_LONG_REASON})`);
    return;
  }
  for (const phrase of [...SECRET_FORBIDDEN_PHRASES, ...CLAIM_SAFE_FORBIDDEN_PHRASES]) {
    if (sharedForbiddenPhrasePresent(text, phrase)) {
      fail(`${label} contains forbidden term "${phrase}"`);
    }
  }
}

// Mirrors the protocol-ts claim-safety module's CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS.
// Each pattern requires a claim-shaped construction, not a bare policy word,
// so ordinary reviewer prose stays allowed. Keep both lists in sync.
const CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS = [
  { id: "certifies_code_claim", pattern: /\bcertif(?:y|ies|ied|ication)\b[^.!?]{0,60}\b(?:code|application|package|product|deployment|system|software)\b/u },
  { id: "audit_ready_claim", pattern: /\baudit[- ]?(?:safe|ready|readiness|accepted|acceptance)\b/u },
  { id: "soc2_readiness_claim", pattern: /\bsoc 2\b[^.!?]{0,30}\b(?:read(?:y|iness)|accept(?:ed|ance)|certif(?:y|ies|ied|ication)|complian(?:t|ce))\b/u },
  { id: "secure_conclusion_claim", pattern: /\b(?:confirms?|proves?|guarantees?|ensures?)\b[^.!?]{0,60}\b(?:is\s+)?secure\b/u },
  { id: "compliance_guarantee_claim", pattern: /\bguarantees?\b[^.!?]{0,60}\bcomplian(?:t|ce)\b/u },
  { id: "zero_vulnerability_claim", pattern: /\b(?:zero|no|without\s+any|free\s+of|absence\s+of)\b[^.!?]{0,40}\bvulnerab(?:le|ilit(?:y|ies))\b/u },
  { id: "vulnerability_free_claim", pattern: /\bvulnerab(?:le|ility|ilities)[- ]free\b/u }
];

function splitSharedNormalizedClauses(value) {
  return value.split(/[.;!?]+/u).map((clause) => clause.trim()).filter(Boolean);
}

const FAMILY_NEGATION_CUE_PATTERN = /\b(?:not|no|never|without|does not|do not|cannot|is not|are not|was not|were not|has not been|have not been)\b/u;

// Mirrors the protocol-ts claim-safety module's familyClaimAppearsPositively.
// Scans the whole sub-clause bounded by strong conjunctions (and/but/however/
// though/yet) for a negation cue, so enumerated disclaimers like "is not
// remediation, verification, audit acceptance, or control satisfaction"
// negate every listed item, not just the one nearest the negation word.
function sharedFamilyClaimAppearsPositively(clause, pattern) {
  const occurrence = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const strongBoundaryPattern = /\band\b|\bbut\b|\bhowever\b|\bthough\b|\byet\b/gu;
  let match;
  while ((match = occurrence.exec(clause)) !== null) {
    let segmentStart = 0;
    let boundaryMatch;
    strongBoundaryPattern.lastIndex = 0;
    while ((boundaryMatch = strongBoundaryPattern.exec(clause)) !== null) {
      if (boundaryMatch.index >= match.index) {
        break;
      }
      segmentStart = boundaryMatch.index + boundaryMatch[0].length;
    }
    const segment = clause.slice(segmentStart, match.index);
    if (FAMILY_NEGATION_CUE_PATTERN.test(segment)) {
      continue;
    }
    return true;
  }
  return false;
}

// Mirrors the protocol-ts claim-safety module's PII_FAMILY_PATTERNS. The
// email pattern itself is loaded from the protocol-owned policy above, so
// protocol-ts, this gate, and the public-prose scanner cannot drift.
const PII_FAMILY_PATTERNS = [
  { id: "email_address", pattern: new RegExp(PII_EMAIL_ADDRESS_PATTERN_SOURCE, "u") },
  { id: "phone_number", pattern: /\b(?:phone|telephone|mobile|cell|fax|contact)\s*(?:number)?\s*[:=]\s*\+?[\d\s().-]{7,}\d\b/u },
  { id: "unlabeled_phone_number", pattern: /\b(?:\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4})\b/u },
  { id: "customer_identifier_field", pattern: /\b(?:user|uid|customer|device|account|session)[_-]?id\s*[:=]/u },
  { id: "ip_address", pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/u },
  { id: "street_address", pattern: /\b\d{1,5}\s+[a-z](?:[a-z.']*\s+){0,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|way|court|ct)\b/u },
  { id: "credential_variant", pattern: /\b(?:access_token|refresh_token|client_secret|private_key|secret_key)\s*[:=]/u },
  { id: "cloud_credential", pattern: /\bakia[0-9a-z]{16}\b/u },
  { id: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/u }
];

// Mirrors the protocol-ts claim-safety module's HIDDEN_CONTROL_CODEPOINT_RANGES.
// See that module for the codepoint list and rationale (bidi/default-ignorable
// spoofing characters). Numeric ranges, not literal/escaped source characters.
const HIDDEN_CONTROL_CODEPOINT_RANGES = [
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0x202a, 0x202e],
  [0xfeff, 0xfeff]
];

function containsSharedHiddenControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (HIDDEN_CONTROL_CODEPOINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return true;
    }
  }
  return false;
}

function isSharedTypedIdentityReference(value) {
  const match = /^([a-z_]+):([a-z0-9][a-z0-9_-]{2,63})$/u.exec(value.trim());
  return match !== null && CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES.includes(match[1]);
}

// Mirrors the protocol-ts claim-safety module's piiTextForbidden. Not
// negation-aware: an email address or identifier is still PII regardless of
// surrounding phrasing.
export function piiTextForbidden(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  const normalized = normalizeSharedForbiddenText(value);
  if (isSharedTypedIdentityReference(normalized)) {
    return undefined;
  }
  const family = PII_FAMILY_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return family?.id;
}

export function customerVisibleTextForbidden(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  for (const phrase of CLAIM_SAFE_FORBIDDEN_PHRASES) {
    if (sharedForbiddenPhrasePresent(value, phrase)) {
      return phrase;
    }
  }
  if (containsSharedHiddenControlCharacter(value)) {
    return "hidden_control_character";
  }
  const piiMatch = piiTextForbidden(value);
  if (piiMatch !== undefined) {
    return piiMatch;
  }
  const normalized = normalizeSharedForbiddenText(value);
  for (const clause of splitSharedNormalizedClauses(normalized)) {
    const family = CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS.find(({ pattern }) => sharedFamilyClaimAppearsPositively(clause, pattern));
    if (family !== undefined) {
      return family.id;
    }
  }
  return undefined;
}

// Combines the raw source/secret scan with customerVisibleTextForbidden for
// external callers (e.g. scripts/check-public-content-safety.mjs) that need
// one entry point covering source-derived leaks, claim-safety, and PII.
export function forbiddenPublicContentReason(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  const secretPhrase = SECRET_FORBIDDEN_PHRASES.find((phrase) => sharedForbiddenPhrasePresent(value, phrase));
  if (secretPhrase !== undefined) {
    return secretPhrase;
  }
  return customerVisibleTextForbidden(value);
}

// Source-code-like prose that the finite SECRET_FORBIDDEN_PHRASES list cannot
// catch. Mirrors the protocol-ts package's claim-safety module (sourceCodeLikeTextReason)
// — keep both in sync. Deliberately not folded into a shared text check that
// also screens reviewer-validation-script text, which intentionally contains code.
const DYNAMIC_EXECUTION_PATTERN = /\b(?:eval|exec|new\s+Function)\s*\(/u;
const CODE_FENCE_OR_SHEBANG_PATTERN = /```|^#!/mu;
const FILE_LINE_REFERENCE_PATTERN = /\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|kt|c|cc|cpp|h|hpp|cs|php|rs|sh)\s*:\s*\d+\b/iu;
const CODE_SYNTAX_PATTERN = /\b(?:if|for|while|switch|function)\s*\(|\bclass\s+[A-Za-z_$][\w$]*|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|=>|[^=!<>]=[^=]|\b[a-zA-Z_$][\w.$]*\([^()]*\)/u;
const AUTHORIZATION_CONDITIONAL_PATTERN = /\bif\s*\([^{}]{0,200}?\)\s*\{/u;
const AUTHORIZATION_KEYWORD_PATTERN = /\b(?:admin|authorize[ds]?|authorizing|authorization|permission|role|is[_-]?admin|is[_-]?authorized|access[_-]?control)\b/iu;

export function sourceCodeLikeTextReason(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  if (CODE_FENCE_OR_SHEBANG_PATTERN.test(value)) {
    return "code_fence_or_shebang";
  }
  if (DYNAMIC_EXECUTION_PATTERN.test(value)) {
    return "dynamic_execution_call";
  }
  if (AUTHORIZATION_CONDITIONAL_PATTERN.test(value) && AUTHORIZATION_KEYWORD_PATTERN.test(value)) {
    return "authorization_conditional_with_executable_syntax";
  }
  if (FILE_LINE_REFERENCE_PATTERN.test(value) && CODE_SYNTAX_PATTERN.test(value)) {
    return "source_location_with_code_syntax";
  }
  return undefined;
}

export function resolveProjectPath(...segments) {
  return path.join(projectRoot, ...segments);
}

// C7-13/C7-14: fixture-index and canonical-manifest entries are attacker-influenced
// relative paths that get joined onto a trusted root and read from disk. Without
// containment, a `../`-escaping or absolute entry could read (and, via drift/report
// tooling, leak) files outside the intended fixture/schema root.
export function resolveUnderRoot(root, relativePath, label = "path") {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error(`${label} must be a non-empty portable relative path`);
  }
  const invalid =
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    /^[A-Za-z]:/u.test(relativePath) ||
    relativePath.startsWith("/") ||
    path.isAbsolute(relativePath) ||
    relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (invalid) {
    throw new Error(`${label} must be portable, relative, slash-separated, and non-traversing: ${JSON.stringify(relativePath)}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(path.join(resolvedRoot, relativePath));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside ${resolvedRoot}: ${JSON.stringify(relativePath)}`);
  }
  return resolved;
}

// C7-17: invariant coverage markers were only checked for being non-empty,
// non-placeholder strings, so a marker naming a function/test that never
// existed (a typo, a renamed/removed check) would still pass. This builds a
// one-time corpus of source-file contents under `roots` so callers can check
// many markers against it cheaply instead of re-walking the filesystem once
// per marker.
export async function buildCoverageMarkerCorpus(roots) {
  const sources = [];
  const fileBasenames = new Set();
  for (const root of roots) {
    for (const filePath of await listFiles(resolveProjectPath(root))) {
      if (!/\.(?:mjs|js|ts|rs|json)$/u.test(filePath)) {
        continue;
      }
      sources.push(await readFile(filePath, "utf8"));
      fileBasenames.add(path.basename(filePath));
    }
  }
  return { sources, fileBasenames };
}

export function corpusContainsMarker(sources, marker) {
  return sources.some((source) => source.includes(marker));
}

// Coverage markers in protocol/fixtures/v0/invariants.json are a mix of bare
// code identifiers (e.g. a function name) and human-readable descriptions
// that lead with a real file name (e.g. "foo.test.mjs receipt boundary
// cases"). Requiring the full free-text description to appear verbatim in
// source would flag the majority of legitimate descriptive markers; instead,
// when a marker names a file, only that file's existence is checked. Bare
// identifiers still require an exact-token match in the corpus.
const COVERAGE_MARKER_FILE_PATTERN = /[\w.-]+\.(?:test\.mjs|mjs|ts|json)\b/u;

export function coverageMarkerResolved(marker, corpus) {
  const fileMatch = marker.match(COVERAGE_MARKER_FILE_PATTERN);
  if (fileMatch) {
    return corpus.fileBasenames.has(fileMatch[0]);
  }
  return corpusContainsMarker(corpus.sources, marker);
}

export async function readJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

export function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function sha256IdFromCanonical(value) {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}

export function canonicalize(value) {
  const canonical = canonicalizeJson(value);
  if (typeof canonical !== "string") {
    throw new Error(`Unsupported JSON value for RFC 8785 canonicalization: ${typeof value}`);
  }
  return canonical;
}

// C7-15: symlinks under a fixture/schema root can point outside the root (or
// into a cycle); walking them let gate scripts read/validate content the root
// was never meant to contain and, for cycles, would recurse forever. Skip
// symlinks entirely rather than following them.
export async function listFiles(directory) {
  const output = [];
  const entries = await readdir(directory);
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      continue;
    }
    if (info.isDirectory()) {
      output.push(...await listFiles(absolutePath));
    } else if (info.isFile()) {
      output.push(absolutePath);
    }
  }
  return output.sort();
}

// C7-01: two schema files declaring the same `$id` previously overwrote each
// other silently in `schemaMap` -- whichever file sorted last became the
// validator for every `$ref`/fixture lookup, while CI still validated both
// documents individually as if nothing were wrong. Track which relative path
// first claimed each `$id` and fail loudly on a second claim.
export async function loadSchemas(schemaRoot = resolveProjectPath("protocol/schemas")) {
  const schemaFiles = (await listFiles(schemaRoot)).filter((filePath) => filePath.endsWith(".schema.json"));
  const schemas = [];
  const schemaMap = new Map();
  const schemaPathById = new Map();

  for (const filePath of schemaFiles) {
    const schema = await readJson(filePath);
    const relativePath = path.relative(projectRoot, filePath);
    schemas.push({ filePath, relativePath, schema });
    if (typeof schema.$id === "string") {
      const firstPath = schemaPathById.get(schema.$id);
      if (firstPath !== undefined) {
        throw new Error(`duplicate schema $id ${schema.$id} in ${firstPath} and ${relativePath}`);
      }
      schemaPathById.set(schema.$id, relativePath);
      schemaMap.set(schema.$id, schema);
    }
  }

  return { schemas, schemaMap };
}

export function validateSchemaDocument(schema, relativePath) {
  const errors = [];
  if (schema.$schema !== JSON_SCHEMA_2020_12) {
    errors.push({ code: "schema_dialect", message: `${relativePath} must declare JSON Schema 2020-12` });
  }
  if (typeof schema.$id !== "string" || !schema.$id.startsWith("urn:codeattest:protocol:v0:")) {
    errors.push({ code: "schema_id", message: `${relativePath} must use a stable urn:codeattest:protocol:v0 schema id` });
  }
  inspectSchemaNode(schema, relativePath, errors);
  return errors;
}

export function validateAgainstSchema(value, schema, schemaMap, location = "$", errors = []) {
  validateSchemaValue(value, schema, schemaMap, location, errors);
  return errors;
}

export async function validateFixtureSemantics(value, options) {
  const errors = [];
  const markers = options.syntheticMarkers ?? [];

  const isSelfReferentialFixture =
    options.expectedFailure === "self_referential_identity" ||
    (options.expectedFailure === undefined &&
      typeof options.fixturePath === "string" &&
      options.fixturePath.includes("outbound-manifest") &&
      options.fixturePath.includes("identity-input"));

  if (
    isSelfReferentialFixture &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.manifest_id !== undefined
  ) {
    errors.push({
      code: "self_referential_identity",
      message: `${options.fixturePath} must exclude manifest_id from outbound manifest identity input`
    });
  }

  if (
    isSelfReferentialFixture &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.evidence_bundle_id !== undefined
  ) {
    errors.push({
      code: "self_referential_identity",
      message: `${options.fixturePath} must exclude evidence_bundle_id from bundle manifest identity input`
    });
  }

  if (
    isSelfReferentialFixture &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.vendor_receipt_id !== undefined
  ) {
    errors.push({
      code: "self_referential_identity",
      message: `${options.fixturePath} must exclude vendor_receipt_id from vendor receipt identity input`
    });
  }

  collectCamelCaseFixtureFields(value, "$", errors);

  validateDisclosurePolicySemantics(value, errors);
  validateOutboundManifestSemantics(value, options, errors);
  validateCustomerApprovalSemantics(value, errors);
  await validateBundleManifestSemantics(value, options, errors);
  validateLocalRunnerAttemptSemantics(value, errors);
  validateEnvironmentReadinessEvidenceSemantics(value, errors);
  await validateEnvironmentReadinessDecisionSemantics(value, options, errors);
  await validateEnvironmentEvidenceGateSemantics(value, options, errors);
  validateVendorReceiptSemantics(value, options, errors);
  validateLogCheckpointSemantics(value, errors);
  await validateSignatureEnvelopeSemantics(value, options, errors);
  validateReviewEventSemantics(value, errors);
  validateReviewEventLogSemantics(value, errors);
  validateReviewEventCustomerProjectionSemantics(value, errors);
  validateStoredObjectClassificationSemantics(value, errors);
  validateEvidenceLifecycleEventSemantics(value, errors);
  validateRetentionOptInRecordSemantics(value, errors);
  validateDeletionEvidenceSemantics(value, errors);
  validateEvidenceMinimizationProjectionSemantics(value, errors);
  validateSubmissionOutcomeSemantics(value, errors);
  await validateReviewFindingDraftSetSemantics(value, options, errors);
  validateFindingClassificationRecordSemantics(value, errors);
  validateFindingRemediationGuidanceSemantics(value, errors);
  validateFalsePositiveRecordSemantics(value, errors);
  validateAcceptedRiskRecordSemantics(value, errors);
  await validateOutcomeRecordFixtureReferenceSemantics(value, options, errors);
  validateFindingValidationPathSemantics(value, errors);
  validateReviewerValidationScriptSemantics(value, errors);
  await validateVerificationPassScopeFixtureReferenceSemantics(value, options, errors);
  validateVerificationPassScopeSemantics(value, errors);
  validateVerificationEvidenceRecordSemantics(value, errors);
  validateVerificationRecordSemantics(value, errors);
  validateVerificationAddendumSemantics(value, errors);
  await validateEpic4FixtureChainSemantics(value, options, errors);
  validateSecurityReviewAttestationSemantics(value, errors);
  validateIdentitySigningInputSemantics(value, errors);
  validateSupportingEvidenceMappingSemantics(value, errors);
  validateStaticBundleManifestSemantics(value, errors);
  validateStaticBundleVerificationPackageSemantics(value, errors);
  validateStaticPortalProjectionSemantics(value, errors);
  validateAttestationPackageFinalizationSemantics(value, errors);
  validatePilotMetricRecordSemantics(value, errors);
  validatePilotFeedbackRecordSemantics(value, errors);
  await validateEpic5FixtureChainSemantics(value, options, errors);
  validateCustomerRemediationStatusRecordSemantics(value, errors);
  validateCustomerFacingFindingRecordSemantics(value, errors);
  await validateSubmissionReviewEventOutcomeReferences(value, options, errors);

  if (typeof options.companionLogPath === "string") {
    const companionLog = await readJson(resolveUnderRoot(options.fixtureRoot, options.companionLogPath, "companion log path"));
    validateReviewEventCustomerProjectionAgainstLog(value, companionLog, errors, options.fixturePath);
  }

  for (const artifact of collectArtifactReferences(value)) {
    const portablePath = validatePortableArtifactContentPath(artifact, errors);

    if (["raw_snippet", "targeted_file"].includes(artifact.artifact_type)) {
      if (!portablePath) {
        continue;
      }
      if (artifact.source_derived_class !== "transient_source_derived") {
        errors.push({
          code: "raw_snippet_wrong_source_class",
          message: `${artifact.artifact_ref ?? "artifact"} must default to transient_source_derived in Story 1.3 fixtures`
        });
      }

      for (const marker of markers) {
        if (!Array.isArray(artifact.synthetic_markers) || !artifact.synthetic_markers.includes(marker)) {
          errors.push({
            code: "raw_snippet_missing_synthetic_markers",
            message: `${artifact.artifact_ref ?? "artifact"} is missing synthetic marker ${marker}`
          });
        }
      }

      if (typeof artifact.content_path !== "string") {
        errors.push({
          code: "raw_snippet_missing_content_path",
          message: `${artifact.artifact_ref ?? "artifact"} must declare content_path pointing to marked synthetic content`
        });
        continue;
      }

      const contentPath = path.join(options.fixtureRoot, artifact.content_path);
      const resolvedRoot = path.resolve(options.fixtureRoot);
      const resolvedContent = path.resolve(contentPath);
      const relative = path.relative(resolvedRoot, resolvedContent);
      if (relative.startsWith("..") || path.isAbsolute(artifact.content_path)) {
        errors.push({
          code: "raw_snippet_content_path_escape",
          message: `${artifact.artifact_ref ?? "artifact"} content_path must stay within fixture root: ${artifact.content_path}`
        });
        continue;
      }
      let content;
      try {
        content = await readFile(contentPath, "utf8");
      } catch {
        errors.push({
          code: "raw_snippet_missing_content",
          message: `${artifact.artifact_ref ?? "artifact"} content path does not exist: ${artifact.content_path}`
        });
        continue;
      }

      for (const marker of markers) {
        if (!content.includes(marker)) {
          errors.push({
            code: "raw_snippet_missing_synthetic_markers",
            message: `${artifact.content_path} does not contain synthetic marker ${marker}`
          });
        }
      }

      // Synthetic markers only prove the fixture was authored for testing;
      // they do not prove the file body itself is safe. Public fixture files
      // are source-derived content and must be leak-scanned like any other
      // customer-visible/source-adjacent sink (C8-06).
      if (SECRET_FORBIDDEN_PHRASES.some((phrase) => sharedForbiddenPhrasePresent(content, phrase)) || customerVisibleTextForbidden(content) !== undefined) {
        errors.push({
          code: "raw_snippet_forbidden_source_text",
          message: `${artifact.content_path} content must not include raw source, scanner output, secrets, credentials, PII, or claim-unsafe text`
        });
      }
    }
  }

  return errors;
}

export function validateDisclosurePolicySemantics(value, errors) {
  if (!isDisclosurePolicyLike(value)) {
    return;
  }

  const validModes = new Set([
    "metadata_only",
    "finding_context_snippets",
    "extended_approved_snippets_or_targeted_files"
  ]);
  if (!validModes.has(value.coverage_mode)) {
    return;
  }

  const categories = categoryMap(value.evidence_categories);
  const requiredCategories = [
    "metadata",
    "dependencies",
    "scanner_findings",
    "raw_snippets",
    "targeted_files",
    "derived_artifacts",
    "never_collected_items"
  ];
  for (const category of requiredCategories) {
    if (!categories.has(category)) {
      errors.push({
        code: "disclosure_policy_missing_evidence_category",
        message: `disclosure policy must include evidence category ${category}`
      });
    }
  }
  if (categories.size !== (value.evidence_categories ?? []).length) {
    errors.push({
      code: "disclosure_policy_duplicate_evidence_category",
      message: "disclosure policy evidence_categories must not duplicate categories"
    });
  }

  if (value.include_scanner_findings === true && typeof value.scanner_finding_set_ref !== "string") {
    errors.push({
      code: "scanner_finding_set_ref_required",
      message: "disclosure policy must include scanner_finding_set_ref when scanner findings are included"
    });
  }

  if (!includedCategory(categories, "metadata", value.include_metadata)) {
    errors.push({
      code: "metadata_category_mismatch",
      message: "metadata evidence category must match include_metadata"
    });
  }
  if (!includedCategory(categories, "dependencies", value.include_dependency_information)) {
    errors.push({
      code: "dependency_category_mismatch",
      message: "dependencies evidence category must match include_dependency_information"
    });
  }
  if (!includedCategory(categories, "scanner_findings", value.include_scanner_findings)) {
    errors.push({
      code: "scanner_findings_category_mismatch",
      message: "scanner findings evidence category must match include_scanner_findings"
    });
  }

  for (const categoryName of ["metadata", "dependencies", "scanner_findings", "derived_artifacts"]) {
    const category = categories.get(categoryName);
    if (category?.included === true && category.source_derived_class !== "retained_review_artifact") {
      errors.push({
        code: "retained_review_artifact_class_required",
        message: `${categoryName} must use retained_review_artifact when included`
      });
    }
  }

  const snippetPolicy = value.snippet_policy ?? {};
  const redactionPolicy = value.redaction_policy ?? {};
  const retentionPolicy = value.retention_policy ?? {};
  const warningsText = joinedLower(value.warnings);
  const limitationsText = joinedLower(value.limitations);

  if (value.coverage_mode === "metadata_only") {
    if (
      snippetPolicy.allow_raw_snippets !== false ||
      snippetPolicy.max_snippet_chars !== 0 ||
      snippetPolicy.context_lines !== 0 ||
      snippetPolicy.selection_behavior !== "none" ||
      (snippetPolicy.selected_files_or_areas ?? []).length !== 0 ||
      categories.get("raw_snippets")?.included === true ||
      categories.get("targeted_files")?.included === true
    ) {
      errors.push({
        code: "metadata_only_must_not_include_snippets",
        message: "metadata_only policies must not allow Raw Snippets or targeted files"
      });
    }
    if (!warningsText.includes("expert confidence may be lower") || !warningsText.includes("snippets were not provided")) {
      errors.push({
        code: "metadata_only_warning_required",
        message: "metadata_only policy must warn about lower confidence and Attestation snippet absence"
      });
    }
  }

  if (value.coverage_mode === "finding_context_snippets") {
    // C7-04: only the snippet_policy fields were checked here, so a policy
    // could declare allow_raw_snippets: true while the raw_snippets evidence
    // category itself stayed excluded (or targeted_files was included), a
    // contradiction between what the policy claims and what the category
    // inventory says is actually available.
    if (
      snippetPolicy.allow_raw_snippets !== true ||
      snippetPolicy.selection_behavior !== "finding_context" ||
      !positiveNumber(snippetPolicy.max_snippet_chars) ||
      !Number.isInteger(snippetPolicy.context_lines) ||
      snippetPolicy.context_lines < 0 ||
      (snippetPolicy.selected_files_or_areas ?? []).length !== 0 ||
      categories.get("raw_snippets")?.included !== true ||
      categories.get("targeted_files")?.included === true
    ) {
      errors.push({
        code: "finding_context_requires_caps_redaction",
        message: "finding_context_snippets policies must allow capped finding-context snippets without selected files"
      });
    }
    if (!warningsText.includes("source-code disclosure") || !warningsText.includes("capped") || !warningsText.includes("redacted")) {
      errors.push({
        code: "finding_context_warning_required",
        message: "finding_context_snippets policy must warn that Raw Snippets remain source-code disclosure when capped or redacted"
      });
    }
  }

  if (value.coverage_mode === "extended_approved_snippets_or_targeted_files") {
    // C7-04: this required targeted_files to be included but never checked
    // raw_snippets, even though the mode name and snippet_policy both approve
    // source snippets -- a policy could claim extended source-context scope
    // while the raw_snippets category said none was actually included.
    if (
      snippetPolicy.allow_raw_snippets !== true ||
      snippetPolicy.selection_behavior !== "extended_selected_files_or_areas" ||
      !Array.isArray(snippetPolicy.selected_files_or_areas) ||
      snippetPolicy.selected_files_or_areas.length === 0 ||
      categories.get("targeted_files")?.included !== true ||
      categories.get("raw_snippets")?.included !== true
    ) {
      errors.push({
        code: "extended_requires_selected_files_or_areas",
        message: "extended policies must record selected files or areas"
      });
    }
    if (!warningsText.includes("improve review confidence") || !warningsText.includes("increases disclosure")) {
      errors.push({
        code: "extended_warning_required",
        message: "extended policy must warn that broader context may improve confidence but increases disclosure"
      });
    }
  }

  if (snippetPolicy.raw_snippet_default_class !== "transient_source_derived") {
    errors.push({
      code: "raw_snippet_wrong_source_class",
      message: "Raw Snippet default source-derived class must be transient_source_derived"
    });
  }

  if (
    categories.get("raw_snippets")?.included === true &&
    retentionPolicy.raw_snippet_class !== "transient_source_derived" &&
    retentionPolicy.raw_snippet_class !== "customer_opt_in_retained_source"
  ) {
    errors.push({
      code: "raw_snippet_wrong_source_class",
      message: "Raw Snippets must default to transient_source_derived unless retained source opt-in is explicit"
    });
  }
  if (
    categories.get("targeted_files")?.included === true &&
    retentionPolicy.targeted_file_class !== "transient_source_derived" &&
    retentionPolicy.targeted_file_class !== "customer_opt_in_retained_source"
  ) {
    errors.push({
      code: "targeted_file_wrong_source_class",
      message: "targeted files must default to transient_source_derived unless retained source opt-in is explicit"
    });
  }

  if (
    retentionPolicy.raw_snippet_class === "customer_opt_in_retained_source" ||
    retentionPolicy.targeted_file_class === "customer_opt_in_retained_source"
  ) {
    const period = typeof retentionPolicy.retention_period === "string" ? retentionPolicy.retention_period.trim() : "";
    if (retentionPolicy.retain_source_opt_in !== true || period === "" || period === "not_applicable") {
      errors.push({
        code: "retained_source_requires_opt_in_and_period",
        message: "customer_opt_in_retained_source requires explicit opt-in and a defined retention period"
      });
    }
  }

  if (redactionPolicy.enabled === true) {
    const redactionText = `${String(redactionPolicy.limitation ?? "").toLowerCase()} ${warningsText} ${limitationsText}`;
    if (!redactionText.includes("cannot prove absence") && !redactionText.includes("cannot prove the absence")) {
      errors.push({
        code: "redaction_limitation_required",
        message: "configured redaction must state that secret detection cannot prove absence of secrets"
      });
    }
  }
}

function isDisclosurePolicyLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.disclosure_policy_id === "string" &&
      typeof value.coverage_mode === "string" &&
      value.snippet_policy &&
      value.retention_policy
  );
}

export function validateOutboundManifestSemantics(value, optionsOrErrors, maybeErrors) {
  const options = Array.isArray(optionsOrErrors) ? {} : optionsOrErrors;
  const errors = Array.isArray(optionsOrErrors) ? optionsOrErrors : maybeErrors;
  if (!isOutboundManifestLike(value)) {
    return;
  }

  const validModes = new Set([
    "metadata_only",
    "finding_context_snippets",
    "extended_approved_snippets_or_targeted_files"
  ]);
  if (!validModes.has(value.coverage_mode)) {
    return;
  }

  const categories = categoryMap(value.evidence_categories);
  const shouldVerifyIdentity =
    !options?.expectedFailure ||
    options.expectedFailure === "outbound_manifest_identity_mismatch";
  if (shouldVerifyIdentity) {
    const identityInput = JSON.parse(JSON.stringify(value));
    delete identityInput.manifest_id;
    const expectedManifestId = sha256IdFromCanonical(identityInput);
    if (value.manifest_id !== expectedManifestId) {
      errors.push({
        code: "outbound_manifest_identity_mismatch",
        message: `outbound manifest manifest_id must match canonical content excluding manifest_id: expected ${expectedManifestId}`
      });
    }
  }
  const requiredCategories = [
    "metadata",
    "dependencies",
    "scanner_findings",
    "raw_snippets",
    "targeted_files",
    "derived_artifacts",
    "never_collected_items"
  ];
  for (const category of requiredCategories) {
    if (!categories.has(category)) {
      errors.push({
        code: "outbound_manifest_missing_evidence_category",
        message: `outbound manifest must include evidence category ${category}`
      });
    }
  }
  if (categories.size !== (value.evidence_categories ?? []).length) {
    errors.push({
      code: "outbound_manifest_duplicate_evidence_category",
      message: "outbound manifest evidence_categories must not duplicate categories"
    });
  }

  if (value.disclosure_policy_summary?.coverage_mode !== value.coverage_mode) {
    errors.push({
      code: "outbound_manifest_policy_coverage_mode_mismatch",
      message: "outbound manifest coverage_mode must match disclosure_policy_summary.coverage_mode"
    });
  }
  if (value.disclosure_policy_summary?.disclosure_policy_ref !== value.disclosure_policy_ref) {
    errors.push({
      code: "outbound_manifest_policy_ref_mismatch",
      message: "outbound manifest disclosure_policy_ref must match disclosure_policy_summary.disclosure_policy_ref"
    });
  }

  const packageState = value.package_preview_state ?? {};
  if (packageState.state !== "preview_generated" || packageState.send_ready !== false || packageState.local_only !== true) {
    errors.push({
      code: "preview_safe_package_state_required",
      message: "outbound manifest package state must be preview_generated, local_only, and not send-ready"
    });
  }
  if (value.approval?.approval_state !== "not_requested") {
    errors.push({
      code: "preview_safe_approval_state_required",
      message: "outbound manifest approval_state must remain not_requested in Story 1.7"
    });
  }

  const warningsText = joinedLower(value.warnings);
  const limitationsText = joinedLower(value.limitations);
  const rawSnippets = categories.get("raw_snippets");
  const targetedFiles = categories.get("targeted_files");

  if (value.coverage_mode === "metadata_only") {
    if (rawSnippets?.included === true || targetedFiles?.included === true) {
      errors.push({
        code: "metadata_only_must_not_include_snippets",
        message: "metadata_only manifests must not include Raw Snippets or targeted files"
      });
    }
    if (!warningsText.includes("expert confidence may be lower") || !warningsText.includes("snippets were not provided")) {
      errors.push({
        code: "metadata_only_warning_required",
        message: "metadata_only manifest must warn about lower confidence and record that snippets were not provided"
      });
    }
  }

  if (value.coverage_mode === "finding_context_snippets") {
    if (rawSnippets?.included !== true || targetedFiles?.included === true) {
      errors.push({
        code: "finding_context_requires_caps_redaction",
        message: "finding_context_snippets manifests must include capped Raw Snippet metadata without targeted files"
      });
    }
  }

  if (value.coverage_mode === "extended_approved_snippets_or_targeted_files") {
    if (rawSnippets?.included !== true || targetedFiles?.included !== true) {
      errors.push({
        code: "extended_requires_selected_files_or_areas",
        message: "extended manifests must include approved Raw Snippet and targeted-file metadata"
      });
    }
    if (!Array.isArray(targetedFiles?.snippet_controls?.selected_files_or_areas) || targetedFiles.snippet_controls.selected_files_or_areas.length === 0) {
      errors.push({
        code: "extended_requires_selected_files_or_areas",
        message: "extended manifest targeted_files row must record selected files or areas"
      });
    }
  }

  for (const categoryName of ["metadata", "dependencies", "scanner_findings", "derived_artifacts"]) {
    const category = categories.get(categoryName);
    if (category?.included === true && category.source_derived_class !== "retained_review_artifact") {
      errors.push({
        code: "retained_review_artifact_class_required",
        message: `${categoryName} must use retained_review_artifact when included`
      });
    }
  }

  for (const categoryName of ["raw_snippets", "targeted_files"]) {
    const category = categories.get(categoryName);
    if (category?.included !== true) {
      continue;
    }
    if (category.source_code_disclosure !== true) {
      errors.push({
        code: "source_code_disclosure_label_required",
        message: `${categoryName} must be visibly labeled as source-code disclosure when included`
      });
    }
    if (!sourceRetentionClass(category.source_derived_class)) {
      errors.push({
        code: `${categoryName === "raw_snippets" ? "raw_snippet" : "targeted_file"}_wrong_source_class`,
        message: `${categoryName} must use a source-derived retention class when included`
      });
    }
    const controls = category.snippet_controls ?? {};
    if (!positiveNumber(controls.max_snippet_chars) || !Number.isInteger(controls.context_lines) || controls.context_lines < 0) {
      errors.push({
        code: "source_code_disclosure_controls_required",
        message: `${categoryName} must include snippet caps and context-line metadata`
      });
    }
    const categoryText = joinedLower([...(category.details ?? []), category.limitation, category.retention_handling, warningsText]);
    if (!categoryText.includes("source-code disclosure")) {
      errors.push({
        code: "source_code_disclosure_label_required",
        message: `${categoryName} must use visible source-code disclosure wording`
      });
    }
  }

  for (const category of value.evidence_categories ?? []) {
    if (category?.included === true && category.inclusion_state !== "included") {
      errors.push({
        code: "outbound_manifest_inclusion_state_mismatch",
        message: `${category.category} inclusion_state must be included when included=true`
      });
    }
    if (category?.redaction_state === "redaction_configured") {
      const version = typeof category.redaction_configuration_version === "string" ? category.redaction_configuration_version.trim() : "";
      const redactionText = joinedLower([category.limitation, ...(category.details ?? []), warningsText, limitationsText]);
      if (version === "" || version === "not_configured" || version === "not_applicable") {
        errors.push({
          code: "redaction_limitation_required",
          message: `${category.category} configured redaction must identify a redaction configuration version`
        });
      }
      if (!redactionText.includes("cannot prove absence") && !redactionText.includes("cannot prove the absence")) {
        errors.push({
          code: "redaction_limitation_required",
          message: `${category.category} configured redaction must state that secret detection cannot prove absence of secrets`
        });
      }
    }
  }

  // Manifest-level redaction wording gate (AC 5): if the disclosure policy summary
  // records a real redaction profile, the manifest's top-level warnings/limitations
  // must include the "cannot prove absence" wording — regardless of whether any
  // individual evidence category carries redaction_state=redaction_configured
  // (metadata-only manifests won't).
  const summaryProfile = typeof value.disclosure_policy_summary?.redaction_profile === "string"
    ? value.disclosure_policy_summary.redaction_profile.trim()
    : "";
  const summaryConfigVersion = typeof value.disclosure_policy_summary?.redaction_configuration_version === "string"
    ? value.disclosure_policy_summary.redaction_configuration_version.trim()
    : "";
  const redactionConfiguredAtPolicy = summaryProfile !== "" &&
    summaryProfile !== "not_applicable" &&
    summaryProfile !== "not_configured" &&
    summaryConfigVersion !== "" &&
    summaryConfigVersion !== "not_applicable" &&
    summaryConfigVersion !== "not_configured";
  if (redactionConfiguredAtPolicy) {
    const topLevelRedactionText = joinedLower([warningsText, limitationsText]);
    if (!topLevelRedactionText.includes("cannot prove absence") && !topLevelRedactionText.includes("cannot prove the absence")) {
      errors.push({
        code: "redaction_limitation_required",
        message: "outbound manifest top-level warnings/limitations must state that secret detection cannot prove absence of secrets when disclosure policy redaction is configured"
      });
    }
  }

  const neverCollectedText = joinedLower(categories.get("never_collected_items")?.details ?? []);
  for (const requiredText of [
    "complete repository archive",
    "full git history",
    "unapproved source files",
    "unapproved raw snippets",
    "local environment secrets"
  ]) {
    if (!neverCollectedText.includes(requiredText)) {
      errors.push({
        code: "outbound_manifest_data_minimization_required",
        message: `never_collected_items must list ${requiredText}`
      });
    }
  }
}

function isOutboundManifestLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.manifest_id === "string" &&
      typeof value.coverage_mode === "string" &&
      Array.isArray(value.evidence_categories) &&
      value.package_preview_state &&
      value.approval
  );
}

export function validateCustomerApprovalSemantics(value, errors) {
  if (!isCustomerApprovalLike(value)) {
    return;
  }

  if (value.displayed_context?.manifest_id !== value.manifest_id) {
    errors.push({
      code: "approval_manifest_context_mismatch",
      message: "customer approval displayed_context.manifest_id must match manifest_id"
    });
  }

  const displayed = value.displayed_context ?? {};
  for (const field of [
    "manifest_id",
    "selected_application",
    "selected_commit",
    "repository_identity",
    "coverage_mode",
    "disclosure_policy_ref",
    "disclosure_warnings",
    "bundle_preview_summary"
  ]) {
    if (displayed[field] === undefined) {
      errors.push({
        code: "approval_displayed_context_required",
        message: `customer approval must record displayed context field ${field}`
      });
    }
  }

  const summary = String(displayed.bundle_preview_summary ?? "").toLowerCase();
  if (!summary.includes("not_submitted") || !summary.includes("no evidence is sent")) {
    errors.push({
      code: "approval_displayed_context_required",
      message: "customer approval bundle preview summary must state not_submitted and no evidence is sent"
    });
  }

  if (value.decision === "approved" && value.not_submitted_state !== undefined) {
    errors.push({
      code: "approval_state_mismatch",
      message: "approved customer approvals must not include declined not_submitted_state"
    });
  }
  if (value.decision === "approved" && Array.isArray(displayed.disclosure_warnings)) {
    const displayedWarnings = JSON.stringify(displayed.disclosure_warnings ?? []);
    const acknowledgedWarnings = JSON.stringify(value.warnings_acknowledged ?? []);
    if (displayedWarnings !== acknowledgedWarnings) {
      errors.push({
        code: "approval_warnings_acknowledgement_mismatch",
        message: "approved customer approvals must acknowledge exactly the warnings displayed before approval"
      });
    }
  }
  if (value.decision === "declined") {
    const state = value.not_submitted_state ?? {};
    if (state.state !== "not_submitted" || state.evidence_bundle_created !== false || state.evidence_sent !== false) {
      errors.push({
        code: "approval_not_submitted_state_required",
        message: "declined customer approvals must record not_submitted with no bundle and no send"
      });
    }
    const nextActions = new Set(state.next_actions ?? []);
    for (const action of ["revise policy", "rerun scan", "export manifest", "exit"]) {
      if (!nextActions.has(action)) {
        errors.push({
          code: "approval_not_submitted_state_required",
          message: `declined customer approvals must include next action ${action}`
        });
      }
    }
  }
}

function isCustomerApprovalLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.approval_id === "string" &&
      typeof value.manifest_id === "string" &&
      typeof value.decision === "string"
  );
}

async function validateBundleManifestSemantics(value, options, errors) {
  if (!isBundleManifestLike(value)) {
    return;
  }

  if (value.customer_approval_decision !== "approved") {
    errors.push({
      code: "bundle_requires_approved_customer_approval",
      message: "bundle manifests require an approved customer approval decision"
    });
  }
  if (value.bundle_state !== "not_submitted") {
    errors.push({
      code: "bundle_state_not_submitted_required",
      message: "Story 1.8 bundle manifests must remain not_submitted"
    });
  }
  if (value.verification_metadata?.approved_manifest_id !== value.manifest_id) {
    errors.push({
      code: "bundle_manifest_id_mismatch",
      message: "bundle verification_metadata.approved_manifest_id must match manifest_id"
    });
  }
  if (!Array.isArray(value.verification_metadata?.identity_input_excludes) || !value.verification_metadata.identity_input_excludes.includes("evidence_bundle_id")) {
    errors.push({
      code: "bundle_identity_input_exclusion_required",
      message: "bundle verification metadata must record that evidence_bundle_id is excluded from identity input"
    });
  }

  const artifactTypes = new Set((value.artifact_references ?? []).map((artifact) => artifact.artifact_type));
  for (const requiredType of ["review_scope", "disclosure_policy", "outbound_manifest", "customer_approval"]) {
    if (!artifactTypes.has(requiredType)) {
      errors.push({
        code: "bundle_required_artifact_missing",
        message: `bundle manifest must reference artifact type ${requiredType}`
      });
    }
  }
  if (value.scanner_finding_set_ref !== undefined && !artifactTypes.has("scanner_finding_set")) {
    errors.push({
      code: "bundle_required_artifact_missing",
      message: "bundle manifest with scanner_finding_set_ref must reference scanner_finding_set artifact"
    });
  }

  // C7-05: the old presence-only check (`cleanupRefs.has(artifact.artifact_ref)`)
  // let a source-derived artifact pair with ANY cleanup intent for the same
  // ref, including one classed retained_review_artifact/cleanup_required:false
  // for a different artifact that merely happens to share the ref. Require
  // exactly one intent per source-derived artifact ref, and require that
  // intent to match the artifact's own source_derived_class and declare a
  // real pending local cleanup, not just any intent with a matching ref. This
  // also closes the second gap: the old intent loop only enforced correctness
  // for transient_source_derived, so a customer_opt_in_retained_source
  // artifact's intent was never checked at all.
  const intentsByRef = new Map();
  for (const intent of value.local_cleanup_intent ?? []) {
    if (!intentsByRef.has(intent.artifact_ref)) {
      intentsByRef.set(intent.artifact_ref, []);
    }
    intentsByRef.get(intent.artifact_ref).push(intent);
  }
  for (const artifact of value.artifact_references ?? []) {
    const sourceDerived = artifact.source_derived_class === "transient_source_derived" || artifact.source_derived_class === "customer_opt_in_retained_source";
    if (!sourceDerived) {
      continue;
    }
    const intents = intentsByRef.get(artifact.artifact_ref) ?? [];
    const matching = intents.filter((intent) =>
      intent.source_derived_class === artifact.source_derived_class &&
      intent.cleanup_required === true &&
      intent.deletion_evidence_state === "pending" &&
      intent.cleanup_state === "pending_local_cleanup"
    );
    if (matching.length !== 1) {
      errors.push({
        code: "source_derived_cleanup_intent_required",
        message: `${artifact.artifact_ref} is source-derived (${artifact.source_derived_class}) and must have exactly one matching local cleanup intent requiring pending local cleanup and pending deletion evidence`
      });
    }
  }

  await validateBundleFixtureChain(value, options, errors);

  const lower = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["vendor receipt", "received state", "attestation", "review findings", "no vulnerabilities", "certified"]) {
    if (lower.includes(forbidden)) {
      errors.push({
        code: "bundle_claim_safe_language_required",
        message: `bundle manifest must not contain claim or out-of-scope wording: ${forbidden}`
      });
    }
  }
}

function isBundleManifestLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.evidence_bundle_id === "string" &&
      typeof value.manifest_id === "string" &&
      Array.isArray(value.artifact_references) &&
      value.verification_metadata
  );
}

// C7-03: `artifactByType` used to be built only from artifacts that already
// had a string `content_path`, so a required chain artifact (customer_approval,
// outbound_manifest) with a missing/absent content_path simply never entered
// the map -- `readReferencedFixture()` then received `undefined` and returned
// `{ok:true, value:undefined}`, silently skipping every downstream chain
// check (approval decision, manifest id, scope/policy/coverage-mode parity)
// instead of failing. Build the map from every artifact regardless of
// content_path, then require required-chain types to have a real, portable
// content_path before dereferencing.
async function validateBundleFixtureChain(value, options, errors) {
  const artifactByType = new Map();
  for (const artifact of value.artifact_references ?? []) {
    if (typeof artifact.artifact_type === "string" && !artifactByType.has(artifact.artifact_type)) {
      artifactByType.set(artifact.artifact_type, artifact);
    }
  }

  const approvalResult = await readRequiredReferencedFixture(artifactByType.get("customer_approval"), "customer_approval", options.fixtureRoot);
  if (!approvalResult.ok) {
    errors.push({ code: approvalResult.code, message: approvalResult.error });
  }
  const approval = approvalResult.value;
  if (approval) {
    if (approval.approval_id !== value.customer_approval_ref) {
      errors.push({
        code: "bundle_customer_approval_ref_mismatch",
        message: "bundle customer_approval_ref must match the referenced customer approval artifact"
      });
    }
    if (approval.decision !== "approved" || value.customer_approval_decision !== "approved") {
      errors.push({
        code: "bundle_requires_approved_customer_approval",
        message: "bundle manifests must chain to an approved customer approval artifact"
      });
    }
    if (approval.manifest_id !== value.manifest_id) {
      errors.push({
        code: "bundle_manifest_id_mismatch",
        message: "bundle manifest_id must match the referenced customer approval manifest_id"
      });
    }
  }

  const outboundResult = await readRequiredReferencedFixture(artifactByType.get("outbound_manifest"), "outbound_manifest", options.fixtureRoot);
  if (!outboundResult.ok) {
    errors.push({ code: outboundResult.code, message: outboundResult.error });
  }
  const outbound = outboundResult.value;
  if (outbound) {
    if (outbound.manifest_id !== value.manifest_id) {
      errors.push({
        code: "bundle_manifest_id_mismatch",
        message: "bundle manifest_id must match the referenced outbound manifest artifact"
      });
    }
    if (outbound.review_scope_ref !== value.review_scope_ref) {
      errors.push({
        code: "bundle_manifest_scope_ref_mismatch",
        message: "bundle review_scope_ref must match outbound manifest review_scope_ref"
      });
    }
    if (outbound.disclosure_policy_ref !== value.disclosure_policy_ref) {
      errors.push({
        code: "bundle_manifest_policy_ref_mismatch",
        message: "bundle disclosure_policy_ref must match outbound manifest disclosure_policy_ref"
      });
    }
    if (outbound.coverage_mode !== value.coverage_mode) {
      errors.push({
        code: "bundle_manifest_coverage_mode_mismatch",
        message: "bundle coverage_mode must match outbound manifest coverage_mode"
      });
    }
  }
}

function validateLocalRunnerAttemptSemantics(value, errors) {
  if (!isLocalRunnerAttemptLike(value)) {
    return;
  }

  // Sub-project B: a submit-stage attempt is the one place remote_state may
  // move off not_submitted -- the schema's own allOf enforces the pairing, so
  // this guard only needs to keep every pre-existing, local-only stage pinned.
  if (value.stage !== "submit" && value.remote_state !== "not_submitted") {
    errors.push({
      code: "local_attempt_remote_state_required",
      message: "local runner attempts must remain remote_state not_submitted outside the submit stage"
    });
  }

  const identities = value.identities ?? {};
  const hasBundleIdentity =
    identities.evidence_bundle_id !== undefined ||
    identities.bundle_instance_id !== undefined ||
    identities.submission_attempt_id !== undefined;
  if (value.bundle_state !== "ready_not_submitted" && hasBundleIdentity) {
    errors.push({
      code: "local_attempt_bundle_identity_state_mismatch",
      message: "local runner attempts may carry bundle identities only when bundle_state is ready_not_submitted"
    });
  }
  if (value.bundle_state === "ready_not_submitted") {
    for (const field of ["evidence_bundle_id", "bundle_instance_id", "submission_attempt_id"]) {
      if (identities[field] === undefined) {
        errors.push({
          code: "local_attempt_bundle_identity_state_mismatch",
          message: `ready local bundle attempts must include ${field}`
        });
      }
    }
  }

  if (value.approval_state === "approved" || value.review_state === "approved_no_signed_bundle") {
    for (const field of ["manifest_id", "approval_id"]) {
      if (identities[field] === undefined) {
        errors.push({
          code: "local_attempt_approval_metadata_required",
          message: `post-approval local attempts must preserve ${field}`
        });
      }
    }
    const metadata = value.approval_metadata ?? {};
    if (
      metadata.decision !== "approved" ||
      typeof metadata.decided_at !== "string" ||
      metadata.decided_at.trim() === ""
    ) {
      errors.push({
        code: "local_attempt_approval_metadata_required",
        message: "post-approval local attempts must preserve approved decision and approval timestamp"
      });
    }
    const text = JSON.stringify(value).toLowerCase();
    if (value.bundle_state === "failed_before_ready" && !text.includes("no signed evidence bundle is ready")) {
      errors.push({
        code: "local_attempt_no_signed_bundle_statement_required",
        message: "post-approval failures must state that no signed Evidence Bundle is ready"
      });
    }
  }

  if (value.review_state === "unapproved_not_submitted") {
    const text = JSON.stringify(value).toLowerCase();
    if (text.includes("approved evidence bundle")) {
      errors.push({
        code: "local_attempt_unapproved_state_required",
        message: "pre-approval or declined attempts must not use approved bundle identity language"
      });
    }
  }

  const trust = value.runner_trust ?? {};
  const trustText = JSON.stringify(trust).toLowerCase();
  if (
    trust.release_signature_status === "unsigned_local_build" ||
    trust.release_signature_status === "untrusted_local_build"
  ) {
    const labelsUntrustedState =
      trustText.includes("unsigned") ||
      trustText.includes("untrusted") ||
      trustText.includes("local") ||
      trustText.includes("synthetic_demo") ||
      trustText.includes("demo");
    if (!labelsUntrustedState || trust.trust_label === "trusted_release") {
      errors.push({
        code: "local_attempt_runner_trust_label_required",
        message: "unsigned, untrusted, local, or demo runner trust states must be visibly labeled"
      });
    }
  }
  if (
    trust.trust_label === "trusted_release" &&
    (trust.release_signature_status !== "verified_release_signature" ||
      typeof trust.release_verification_artifact !== "string")
  ) {
    errors.push({
      code: "local_attempt_runner_trust_label_required",
      message: "trusted release labels require verified release signature status and a verification artifact"
    });
  }

  const serializedValue = JSON.stringify(value);
  if (serializedValue.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    errors.push({
      code: "local_attempt_remote_claim_language",
      message: `local runner attempts must not exceed the maximum allowed text length (${TEXT_TOO_LONG_REASON})`
    });
  } else {
    // Sub-project B: on a submit-stage attempt, the record may state the
    // protocol's own transport state verbatim -- that state is exactly what
    // the server returned, not a characterization of what it means. The
    // relaxation is narrow and token-exact: only these four literal values,
    // only on stage "submit", are stripped before scanning. Every other
    // stage, and every other forbidden phrase, stays fully in force.
    const scannedValue =
      value.stage === "submit"
        ? SUBMIT_REMOTE_STATE_TOKENS.reduce((text, token) => text.split(token).join(""), serializedValue)
        : serializedValue;
    for (const phrase of CLAIM_SAFE_FORBIDDEN_PHRASES) {
      if (sharedForbiddenPhrasePresent(scannedValue, phrase)) {
        errors.push({
          code: "local_attempt_remote_claim_language",
          message: `local runner attempts must not contain out-of-scope wording: ${phrase}`
        });
      }
    }
  }

  const diagnosticsText = JSON.stringify(value.diagnostics ?? {});
  if (diagnosticsText.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    errors.push({
      code: "local_attempt_sensitive_diagnostic",
      message: `local runner diagnostics must not exceed the maximum allowed text length (${TEXT_TOO_LONG_REASON})`
    });
  } else {
    for (const forbidden of SECRET_FORBIDDEN_PHRASES) {
      if (sharedForbiddenPhrasePresent(diagnosticsText, forbidden)) {
        errors.push({
          code: "local_attempt_sensitive_diagnostic",
          message: `local runner diagnostics must not include sensitive detail: ${forbidden}`
        });
      }
    }
  }
  if (
    ("raw_snippets_printed" in (value.diagnostics ?? {}) && value.diagnostics.raw_snippets_printed !== false) ||
    ("sensitive_detail_omitted" in (value.diagnostics ?? {}) && value.diagnostics.sensitive_detail_omitted !== true)
  ) {
    errors.push({
      code: "local_attempt_sensitive_diagnostic",
      message: "local runner diagnostics must omit sensitive detail and never print raw snippets by default"
    });
  }
}

function isLocalRunnerAttemptLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.attempt_id === "string" &&
      typeof value.stage === "string" &&
      typeof value.review_state === "string" &&
      value.runner_trust &&
      value.diagnostics
  );
}

// D3-3: signature_bytes used to be a synthetic marker string that restated the
// signed identity's digest, so C7-21 could check the binding by parsing it.
// Real ML-DSA-65 bytes carry no readable digest, so the equivalent check is the
// actual signature verification: the corpus is signed by the committed test key
// published in v0/valid/signing-key-directory.json, over
// `<domain>\n<RFC8785 signing input>` (packages/signing/src/signed-message.ts).
const SIGNED_MESSAGE_DOMAIN = "codeattest-ml-dsa-65-v1";
// Fixed 22-byte SPKI DER prefix for an ML-DSA-65 public key; the protocol
// carries the raw 1952-byte key and `node:crypto` imports SPKI. Mirrors
// SPKI_PREFIX in packages/signing/src/ml-dsa.ts.
const ML_DSA_65_SPKI_PREFIX = Buffer.from("308207b2300b0609608648016503040312038207a100", "hex");
const fixtureSigningPublicKey = createPublicKey({
  key: Buffer.concat([
    ML_DSA_65_SPKI_PREFIX,
    Buffer.from(JSON.parse(readFileSync(resolveProjectPath("protocol/fixtures/v0/valid/signing-key-directory.json"), "utf8")).keys[0].public_key, "base64url")
  ]),
  format: "der",
  type: "spki"
});
const fixtureVendorReceiptSigningInput = JSON.parse(readFileSync(resolveProjectPath("protocol/fixtures/v0/signing-inputs/vendor-receipt-identity.json"), "utf8"));

function fixtureSignatureVerifies(signatureBytes, signingInput) {
  if (typeof signatureBytes !== "string" || !signatureBytes.startsWith("ml_dsa_65:")) {
    return false;
  }
  try {
    const message = Buffer.from(`${SIGNED_MESSAGE_DOMAIN}\n${canonicalize(signingInput)}`, "utf8");
    return verify(null, message, fixtureSigningPublicKey, Buffer.from(signatureBytes.slice("ml_dsa_65:".length), "base64url"));
  } catch {
    return false;
  }
}

async function validateSignatureEnvelopeSemantics(value, options, errors) {
  if (!isSignatureEnvelopeLike(value)) {
    return;
  }

  let expectedIdentity;
  if (value.signed_identity_type === "evidence_bundle") {
    expectedIdentity = (await readJson(path.join(options.fixtureRoot, "v0/valid/bundle-manifest.json"))).evidence_bundle_id;
  } else if (value.signed_identity_type === "outbound_manifest") {
    expectedIdentity = (await readJson(path.join(options.fixtureRoot, "v0/valid/outbound-manifest.json"))).manifest_id;
  } else if (value.signed_identity_type === "vendor_receipt") {
    expectedIdentity = (await readJson(path.join(options.fixtureRoot, "v0/valid/vendor-receipt.json"))).vendor_receipt_id;
  } else if (value.signed_identity_type === "static_bundle_manifest") {
    expectedIdentity = [
      (await readJson(path.join(options.fixtureRoot, "v0/valid/static-bundle-manifest.generated.json"))).static_bundle_manifest_id,
      (await readJson(path.join(options.fixtureRoot, "v0/valid/static-bundle-manifest.finalized.json"))).static_bundle_manifest_id
    ];
  } else if (value.signed_identity_type === "attestation_package_finalization") {
    const finalization = await readJson(path.join(options.fixtureRoot, "v0/valid/attestation-package-finalization.json"));
    expectedIdentity = `sha256:${finalization.attestation_package_finalization_id.slice("attestation_finalization:".length)}`;
  }
  const signedIdentityMatches = Array.isArray(expectedIdentity) ? expectedIdentity.includes(value.signed_identity) : expectedIdentity === undefined || value.signed_identity === expectedIdentity;
  if (!signedIdentityMatches) {
    errors.push({
      code: "signature_signed_identity_mismatch",
      message: `signature envelope signed_identity must equal a registered canonical ${value.signed_identity_type} identity`
    });
  }
}

function validateVendorReceiptSemantics(value, options, errors) {
  if (!isVendorReceiptLike(value)) {
    return;
  }

  if (value.verification_state !== "received_with_receipt") {
    errors.push({
      code: "vendor_receipt_no_failed_receipt",
      message: "Vendor Receipt records may only represent received_with_receipt; rejected/quarantined states must not issue receipts"
    });
  }

  const excludes = new Set(value.identity_input_excludes ?? []);
  for (const excludedField of ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"]) {
    if (!excludes.has(excludedField)) {
      errors.push({
        code: "vendor_receipt_identity_exclusion_required",
        message: `Vendor Receipt identity metadata must exclude ${excludedField}`
      });
    }
  }

  const shouldVerifyIdentity = !options?.expectedFailure || options.expectedFailure === "vendor_receipt_identity_mismatch";
  if (shouldVerifyIdentity) {
    const identityInput = JSON.parse(JSON.stringify(value));
    delete identityInput.vendor_receipt_id;
    delete identityInput.receipt_signature;
    if (identityInput.public_verification_metadata && typeof identityInput.public_verification_metadata === "object") {
      delete identityInput.public_verification_metadata.signed_identity;
    }
    const expectedReceiptId = sha256IdFromCanonical(identityInput);
    if (value.vendor_receipt_id !== expectedReceiptId) {
      errors.push({
        code: "vendor_receipt_identity_mismatch",
        message: `vendor_receipt_id must match canonical receipt identity input: expected ${expectedReceiptId}`
      });
    }
  }

  const signature = value.receipt_signature ?? {};
  const verification = value.public_verification_metadata ?? {};

  if (signature.signed_identity_type !== "vendor_receipt" || verification.signed_identity_type !== "vendor_receipt") {
    errors.push({
      code: "vendor_receipt_signature_identity_type",
      message: "Vendor Receipt signatures and public verification metadata must use signed_identity_type vendor_receipt"
    });
  }
  if (signature.signed_identity !== value.vendor_receipt_id || verification.signed_identity !== value.vendor_receipt_id) {
    errors.push({
      code: "signature_signed_identity_mismatch",
      message: "Vendor Receipt signature and public verification metadata signed_identity must equal vendor_receipt_id"
    });
  }
  if (!signature.key_id || !signature.key_version || !verification.key_id || !verification.key_version) {
    errors.push({
      code: "receipt_key_metadata_required",
      message: "Vendor Receipt signatures require key_id and key_version in both signature and public verification metadata"
    });
  } else if (signature.key_id !== verification.key_id || signature.key_version !== verification.key_version) {
    errors.push({
      code: "receipt_key_metadata_required",
      message: "Vendor Receipt public verification metadata must preserve the signature key id/version"
    });
  }
  if (signature.signing_time !== value.receipt_timestamp || verification.signing_time !== value.receipt_timestamp) {
    errors.push({
      code: "receipt_key_metadata_required",
      message: "Vendor Receipt signing time and public verification metadata signing time must equal receipt_timestamp"
    });
  }
  if (value.key_rotation_readiness?.historical_key_id !== signature.key_id || value.key_rotation_readiness?.historical_key_version !== signature.key_version) {
    errors.push({
      code: "receipt_key_metadata_required",
      message: "Vendor Receipt key rotation readiness must preserve historical key id/version"
    });
  }

  // C7-21: receipt_signature previously never had its own signature_bytes
  // checked at all, and public_verification_metadata was only cross-checked
  // for key/timing/identity fields -- protocol_version, algorithm_profile,
  // canonicalization, signing_mode, and signing_limitations could silently
  // diverge between the (private) signature and the (public) metadata meant
  // to mirror it, or the signature bytes could claim a different digest than
  // signed_identity. D3-3: with real ML-DSA-65 bytes the equivalent binding is
  // verification against the corpus's published vendor-receipt signing input.
  if (!fixtureSignatureVerifies(signature.signature_bytes, fixtureVendorReceiptSigningInput)) {
    errors.push({
      code: "receipt_signature_bytes_invalid",
      message: "Vendor Receipt signature signature_bytes must be a real ML-DSA-65 signature over the published vendor receipt signing input"
    });
  }
  if (signature.protocol_version !== verification.protocol_version) {
    errors.push({ code: "receipt_key_metadata_required", message: "Vendor Receipt public verification metadata must preserve the signature protocol_version" });
  }
  if (signature.algorithm_profile !== verification.algorithm_profile) {
    errors.push({ code: "receipt_key_metadata_required", message: "Vendor Receipt public verification metadata must preserve the signature algorithm_profile" });
  }
  if (signature.canonicalization !== verification.canonicalization) {
    errors.push({ code: "receipt_key_metadata_required", message: "Vendor Receipt public verification metadata must preserve the signature canonicalization" });
  }
  if (signature.signing_mode !== verification.signing_mode) {
    errors.push({ code: "receipt_key_metadata_required", message: "Vendor Receipt public verification metadata must preserve the signature signing_mode" });
  }
  if (!Array.isArray(signature.signing_limitations) || !Array.isArray(verification.signing_limitations) || canonicalize(signature.signing_limitations) !== canonicalize(verification.signing_limitations)) {
    errors.push({ code: "receipt_key_metadata_required", message: "Vendor Receipt public verification metadata must preserve the signature signing_limitations" });
  }

  const approvedSummary = value.approved_artifact_count_summary ?? {};
  const receivedSummary = value.received_artifact_count_summary ?? {};
  const approvedSummaryValid = validateReceiptArtifactCountSummary(approvedSummary, errors);
  const receivedSummaryValid = validateReceiptArtifactCountSummary(receivedSummary, errors);
  if (approvedSummaryValid && receivedSummaryValid && canonicalize(approvedSummary) !== canonicalize(receivedSummary)) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: "Vendor Receipt approved and received artifact count summaries must match"
    });
  }
  if (value.disclosure_policy_summary?.disclosure_policy_ref !== value.disclosure_policy_ref || value.disclosure_policy_summary?.coverage_mode !== value.coverage_mode) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: "Vendor Receipt Disclosure Policy summary must match top-level disclosure policy reference and Coverage Mode"
    });
  }

  // C7-07: `new Map(rows.map(...))` silently collapses duplicate `field`
  // values, so a receipt could carry both a valid comparison row and a
  // contradictory/tampered row for the same field and only the last one
  // (in array order) would ever be checked. Require the row field set to be
  // exactly the required set, with no duplicates and no unexpected fields.
  const comparisonRows = value.approved_vs_received_comparison?.rows ?? [];
  const artifactCountValue = `evidence_category_counts:${approvedSummary.total_count}`;
  const disclosureSummaryValue = `${value.disclosure_policy_summary?.disclosure_policy_ref}:${value.disclosure_policy_summary?.coverage_mode}:${value.disclosure_policy_summary?.redaction_configuration_version}`;
  const requiredRows = [
    ["manifest_id", value.manifest_id],
    ["evidence_bundle_id", value.evidence_bundle_id],
    ["selected_commit", value.selected_commit?.commit_sha],
    ["repository_identity_hash", value.repository_identity_hash],
    ["coverage_mode", value.coverage_mode],
    ["artifact_count_summary", artifactCountValue],
    ["disclosure_policy_summary", disclosureSummaryValue]
  ];
  const requiredFieldSet = new Set(requiredRows.map(([field]) => field));
  const seenFields = new Set();
  const duplicateFields = new Set();
  for (const row of comparisonRows) {
    if (seenFields.has(row.field)) {
      duplicateFields.add(row.field);
    }
    seenFields.add(row.field);
  }
  if (duplicateFields.size > 0) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: `Vendor Receipt comparison rows must not repeat a field: ${[...duplicateFields].join(", ")}`
    });
  }
  if (seenFields.size !== requiredFieldSet.size || [...seenFields].some((field) => !requiredFieldSet.has(field))) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: "Vendor Receipt comparison rows must contain exactly the required field set with no unexpected fields"
    });
  }
  const rowByField = new Map(comparisonRows.map((row) => [row.field, row]));
  for (const [field, expectedValue] of requiredRows) {
    const row = rowByField.get(field);
    if (!row || row.result !== "matched" || row.approved_value !== expectedValue || row.received_value !== expectedValue) {
      errors.push({
        code: "receipt_approved_received_mismatch",
        message: `Vendor Receipt comparison row ${field} must match approved and received values`
      });
    }
  }
}

function isVendorReceiptLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.vendor_receipt_id === "string" &&
      typeof value.evidence_bundle_id === "string" &&
      typeof value.manifest_id === "string" &&
      value.receipt_signature &&
      value.public_verification_metadata &&
      value.approved_vs_received_comparison
  );
}

function validateReceiptArtifactCountSummary(summary, errors) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary) || summary.count_domain !== "evidence_category_counts" || !Number.isInteger(summary.total_count) || !Array.isArray(summary.categories)) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: "Vendor Receipt artifact count summaries must use the evidence_category_counts domain, total_count, and categories"
    });
    return false;
  }
  const seen = new Set();
  let sum = 0;
  for (const category of summary.categories) {
    if (!category || typeof category !== "object" || Array.isArray(category) || typeof category.category !== "string" || !Number.isInteger(category.count) || category.count < 0 || seen.has(category.category)) {
      errors.push({
        code: "receipt_approved_received_mismatch",
        message: "Vendor Receipt artifact count categories must be unique named non-negative integer counts"
      });
      return false;
    }
    seen.add(category.category);
    sum += category.count;
  }
  if (sum !== summary.total_count) {
    errors.push({
      code: "receipt_approved_received_mismatch",
      message: "Vendor Receipt artifact count total_count must equal the sum of category counts"
    });
    return false;
  }
  return true;
}

const ENVIRONMENT_READINESS_CONTROLS = [
  "access_control_ready",
  "access_logging_ready",
  "encryption_at_rest_ready",
  "retention_defaults_ready",
  "deletion_controls_ready",
  "demo_budget_gate_ready",
  "signing_release_trust_ready"
];

const ENVIRONMENT_READINESS_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;

function actorIdentity(actor) {
  return actor && typeof actor.actor_type === "string" && typeof actor.actor_id === "string"
    ? `${actor.actor_type}:${actor.actor_id}`
    : undefined;
}

function validateEnvironmentReadinessEvidenceSemantics(value, errors) {
  if (!isEnvironmentReadinessEvidenceLike(value)) return;

  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(["readiness_evidence_id"])) {
    errors.push({
      code: "readiness_evidence_identity_excludes_invalid",
      message: "environment readiness evidence identity input must exclude only readiness_evidence_id"
    });
  }
  const identityInput = { ...value };
  delete identityInput.readiness_evidence_id;
  try {
    if (sha256IdFromCanonical(identityInput) !== value.readiness_evidence_id) {
      errors.push({
        code: "readiness_evidence_identity_mismatch",
        message: "readiness_evidence_id must equal SHA-256 over canonical evidence content excluding readiness_evidence_id"
      });
    }
  } catch {
    errors.push({ code: "readiness_evidence_identity_mismatch", message: "environment readiness evidence must be canonicalizable JSON" });
  }

  const producerIdentity = actorIdentity(value.evidence_producer);
  if (producerIdentity !== undefined && producerIdentity === actorIdentity(value.independent_reviewer)) {
    errors.push({
      code: "readiness_evidence_self_review",
      message: "environment readiness evidence producer and independent reviewer must be distinct actors"
    });
  }

  const observedAt = Date.parse(value.observed_at);
  const reviewedAt = Date.parse(value.reviewed_at);
  if (Number.isFinite(observedAt) && Number.isFinite(reviewedAt) && reviewedAt < observedAt) {
    errors.push({
      code: "readiness_evidence_review_time_invalid",
      message: "environment readiness evidence must be reviewed at or after its observation time"
    });
  }

  const attachments = Array.isArray(value.evidence_attachments) ? value.evidence_attachments : [];
  const checkIds = attachments.map((attachment) => attachment?.check_id);
  const digests = attachments.map((attachment) => attachment?.attachment_digest);
  if (new Set(checkIds).size !== checkIds.length || new Set(digests).size !== digests.length) {
    errors.push({
      code: "readiness_evidence_attachment_duplicate",
      message: "environment readiness evidence attachment check ids and digests must each be unique"
    });
  }
  for (const attachment of attachments) {
    const collectedAt = Date.parse(attachment?.collected_at);
    if (Number.isFinite(collectedAt) && Number.isFinite(observedAt) && collectedAt > observedAt) {
      errors.push({
        code: "readiness_evidence_attachment_time_invalid",
        message: "each readiness evidence attachment must be collected no later than observed_at"
      });
    }
  }
}

function isEnvironmentReadinessEvidenceLike(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.readiness_evidence_id === "string" && typeof value.control === "string"
  );
}

async function loadReadinessRecordsById(fixtureRoot, prefix, identityField) {
  const records = new Map();
  if (typeof fixtureRoot !== "string") return records;
  for (const directoryName of ["valid", "support"]) {
    let files;
    try {
      files = await listFiles(path.join(fixtureRoot, "v0", directoryName));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || !path.basename(file).startsWith(prefix)) continue;
      try {
        const record = await readJson(file);
        if (typeof record?.[identityField] === "string" && !records.has(record[identityField])) records.set(record[identityField], record);
      } catch {
        // The fixture's normal validation path reports malformed documents.
      }
    }
  }
  return records;
}

async function validateEnvironmentReadinessDecisionSemantics(value, options, errors) {
  if (!isEnvironmentReadinessDecisionLike(value)) return;

  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(["readiness_decision_id", "decision_signature"])) {
    errors.push({
      code: "readiness_decision_identity_excludes_invalid",
      message: "environment readiness decision identity input must exclude readiness_decision_id and decision_signature"
    });
  }
  const identityInput = { ...value };
  delete identityInput.readiness_decision_id;
  delete identityInput.decision_signature;
  try {
    if (sha256IdFromCanonical(identityInput) !== value.readiness_decision_id) {
      errors.push({
        code: "readiness_decision_identity_mismatch",
        message: "readiness_decision_id must equal SHA-256 over canonical decision content excluding identity and signature"
      });
    }
  } catch {
    errors.push({ code: "readiness_decision_identity_mismatch", message: "environment readiness decision must be canonicalizable JSON" });
  }

  if (value.proposed_gate_version !== value.previous_gate_version + 1) {
    errors.push({
      code: "readiness_decision_nonconsecutive_version",
      message: "environment readiness decision proposed_gate_version must immediately follow previous_gate_version"
    });
  }

  const bindings = Array.isArray(value.evidence_bindings) ? value.evidence_bindings : [];
  const controls = bindings.map((binding) => binding?.control);
  const controlSet = new Set(controls);
  if (bindings.length !== ENVIRONMENT_READINESS_CONTROLS.length || controlSet.size !== ENVIRONMENT_READINESS_CONTROLS.length || ENVIRONMENT_READINESS_CONTROLS.some((control) => !controlSet.has(control))) {
    errors.push({
      code: "readiness_decision_controls_invalid",
      message: "environment readiness decision must bind exactly one evidence record for each of the seven controls"
    });
  }

  const approvers = Array.isArray(value.approvers) ? value.approvers : [];
  const approverIds = approvers.map((approver) => actorIdentity(approver?.actor));
  if (approverIds.length !== 2 || approverIds.some((identity) => identity === undefined) || new Set(approverIds).size !== 2) {
    errors.push({
      code: "readiness_decision_approvers_invalid",
      message: "environment readiness decision requires two distinct recorded approvers"
    });
  }

  const evidenceById = await loadReadinessRecordsById(options?.fixtureRoot, "environment-readiness-evidence.", "readiness_evidence_id");
  const decidedAt = Date.parse(value.decided_at);
  const producers = new Set();
  for (const binding of bindings) {
    const evidence = evidenceById.get(binding?.readiness_evidence_ref);
    if (evidence === undefined) {
      errors.push({
        code: "readiness_decision_evidence_missing",
        message: `environment readiness decision cannot resolve evidence for ${binding?.control ?? "unknown control"}`
      });
      continue;
    }
    const producer = actorIdentity(evidence.evidence_producer);
    if (producer !== undefined) producers.add(producer);
    if (evidence.control !== binding.control) {
      errors.push({
        code: "readiness_decision_control_binding_mismatch",
        message: `evidence bound as ${binding.control} declares ${evidence.control}`
      });
    }
    if (evidence.deployment_identity !== value.deployment_identity || evidence.release_digest !== value.release_digest || evidence.deployment_digest !== value.deployment_digest) {
      errors.push({
        code: "readiness_decision_release_mismatch",
        message: `evidence for ${binding.control} must bind the decision's exact pilot release and deployment digests`
      });
    }
    if (value.decision === "approved" && evidence.result !== "passed") {
      errors.push({
        code: "readiness_decision_failed_control",
        message: `approved environment readiness decision requires passing evidence for ${binding.control}`
      });
    }
    const observedAt = Date.parse(evidence.observed_at);
    const reviewedAt = Date.parse(evidence.reviewed_at);
    if (value.decision === "approved" && (!Number.isFinite(decidedAt) || !Number.isFinite(observedAt) || !Number.isFinite(reviewedAt) || reviewedAt > decidedAt || observedAt > decidedAt || decidedAt - observedAt > ENVIRONMENT_READINESS_FRESHNESS_MS || decidedAt - reviewedAt > ENVIRONMENT_READINESS_FRESHNESS_MS)) {
      errors.push({
        code: "readiness_decision_stale_evidence",
        message: `approved environment readiness decision requires evidence for ${binding.control} observed and reviewed within seven days`
      });
    }
  }

  if (approverIds.some((identity) => producers.has(identity))) {
    errors.push({
      code: "readiness_decision_self_approval",
      message: "final environment readiness approvers must not approve evidence they produced"
    });
  }

  if (value.decision === "approved") {
    const signature = value.decision_signature;
    const signatureMatches = signature?.signing_mode === "managed_key" &&
      signature?.signed_identity_type === "environment_readiness_decision" &&
      signature?.signed_identity === value.readiness_decision_id &&
      signature?.algorithm_profile === "ml_dsa_65" &&
      signature?.canonicalization === "rfc8785" &&
      signature?.signing_time === value.decided_at;
    if (!signatureMatches) {
      errors.push({
        code: "readiness_decision_signature_invalid",
        message: "approved environment readiness decision must carry a managed-key signature over its own identity"
      });
    } else if (options?.expectedFailure === undefined) {
      const signingInput = {
        protocol_version: "codeattest.v0",
        signing_input_type: "environment_readiness_decision_identity",
        algorithm_profile: "ml_dsa_65",
        signed_identity_type: "environment_readiness_decision",
        signed_identity: value.readiness_decision_id,
        canonicalization: "rfc8785",
        identity_input_path: "v0/valid/environment-readiness-decision.identity-input.json"
      };
      if (!fixtureSignatureVerifies(signature.signature_bytes, signingInput)) {
        errors.push({
          code: "readiness_decision_signature_invalid",
          message: "approved environment readiness decision fixture signature bytes must verify over its published signing input"
        });
      }
    }
  }
}

function isEnvironmentReadinessDecisionLike(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    typeof value.readiness_decision_id === "string" && typeof value.decision === "string"
  );
}

async function validateEnvironmentEvidenceGateSemantics(value, options, errors) {
  if (!isEnvironmentEvidenceGateLike(value)) {
    return;
  }

  const knownProfiles = new Set(["synthetic_demo", "partner_pilot_candidate", "partner_pilot_real_snippet_ready"]);
  if (!knownProfiles.has(value.environment_profile)) {
    errors.push({
      code: "environment_gate_profile_required",
      message: "environment_profile must be synthetic_demo, partner_pilot_candidate, or partner_pilot_real_snippet_ready"
    });
  }

  const acceptingRealEvidence = value.real_raw_snippet_acceptance === true || value.real_targeted_file_acceptance === true;
  if (value.environment_profile !== "partner_pilot_real_snippet_ready" && acceptingRealEvidence) {
    errors.push({
      code: "environment_gate_real_evidence_not_allowed",
      message: "only partner_pilot_real_snippet_ready may accept real Raw Snippets or targeted files"
    });
  }

  const allowsRetainedSource = Array.isArray(value.allowed_source_derived_classes) && value.allowed_source_derived_classes.includes("customer_opt_in_retained_source");
  if (value.environment_profile !== "partner_pilot_real_snippet_ready" && allowsRetainedSource) {
    errors.push({
      code: "environment_gate_real_evidence_not_allowed",
      message: "customer_opt_in_retained_source is allowed only for partner_pilot_real_snippet_ready"
    });
  }

  const requiredReadiness = [...ENVIRONMENT_READINESS_CONTROLS];
  // C7-06: readiness was previously enforced only when acceptingRealEvidence
  // was true, so a gate could set environment_profile
  // "partner_pilot_real_snippet_ready" plus allow customer_opt_in_retained_source
  // while leaving both acceptance booleans and every readiness flag false --
  // downstream policy/lifecycle records can still rely on the allowed
  // retained-source class even though nothing accepted real evidence yet.
  if (acceptingRealEvidence || allowsRetainedSource) {
    for (const field of requiredReadiness) {
      if (value[field] !== true) {
        errors.push({
          code: "environment_gate_readiness_required",
          message: `real source-derived evidence acceptance requires ${field}=true`
        });
      }
    }
    if (value.retention_period_required !== true) {
      errors.push({
        code: "environment_gate_readiness_required",
        message: "real source-derived evidence acceptance requires retention_period_required=true"
      });
    }
    if (!allowsRetainedSource) {
      errors.push({
        code: "environment_gate_readiness_required",
        message: "real source-derived evidence acceptance requires customer_opt_in_retained_source to be explicitly allowed"
      });
    }
  }

  if (value.environment_profile === "synthetic_demo") {
    if (value.evidence_boundary !== "synthetic-demo-only") {
      errors.push({
        code: "environment_gate_real_evidence_not_allowed",
        message: "synthetic_demo must keep evidence_boundary synthetic-demo-only"
      });
    }
  }

  if (value.environment_profile === "partner_pilot_real_snippet_ready") {
    const decisionsById = await loadReadinessRecordsById(options?.fixtureRoot, "environment-readiness-decision.", "readiness_decision_id");
    const decision = decisionsById.get(value.readiness_decision_ref);
    if (decision === undefined || decision.decision !== "approved") {
      errors.push({
        code: "environment_gate_readiness_decision_required",
        message: "partner_pilot_real_snippet_ready requires a referenced approved environment readiness decision"
      });
    } else {
      const gateApprovalInput = { ...value };
      delete gateApprovalInput.readiness_decision_ref;
      if (decision.proposed_gate_approval_input_digest !== sha256IdFromCanonical(gateApprovalInput)) {
        errors.push({
          code: "environment_gate_readiness_decision_mismatch",
          message: "environment readiness decision must bind the canonical final gate body excluding readiness_decision_ref"
        });
      }
    }
  }
}

function isEnvironmentEvidenceGateLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.environment_profile === "string" &&
      typeof value.real_raw_snippet_acceptance === "boolean" &&
      typeof value.evidence_boundary === "string"
  );
}

function isSignatureEnvelopeLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.algorithm_profile === "string" &&
      typeof value.key_id === "string" &&
      typeof value.signed_identity_type === "string" &&
      typeof value.signed_identity === "string" &&
      // signature-verification-outcome intentionally mirrors these same four
      // identity-correlation fields but is never itself a signature envelope
      // (it has no signature_bytes to verify) -- require the field that's
      // unique to an actual envelope so the outcome record isn't routed
      // through envelope canonical-identity checks it was never meant to pass.
      typeof value.signature_bytes === "string"
  );
}

// C7-03: unlike the old lenient `readReferencedFixture()`, a missing,
// non-string, absolute, or root-escaping content_path is a hard failure here
// -- required bundle-chain artifacts must be dereferenceable, not silently
// skipped.
async function readRequiredReferencedFixture(artifact, artifactType, fixtureRoot) {
  if (!artifact) {
    return { ok: false, value: undefined, code: "bundle_referenced_artifact_content_path_required", error: `bundle must reference a ${artifactType} artifact` };
  }
  if (typeof artifact.content_path !== "string" || artifact.content_path.trim() === "") {
    return { ok: false, value: undefined, code: "bundle_referenced_artifact_content_path_required", error: `${artifactType} artifact reference must declare a content_path so its bundle-chain fields can be verified` };
  }
  const resolvedRoot = path.resolve(fixtureRoot);
  const resolved = path.resolve(path.join(resolvedRoot, artifact.content_path));
  const relative = path.relative(resolvedRoot, resolved);
  if (path.isAbsolute(artifact.content_path) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { ok: false, value: undefined, code: "bundle_referenced_artifact_content_path_required", error: `${artifactType} artifact content_path must be a portable path within the fixture root` };
  }
  try {
    return { ok: true, value: await readJson(resolved) };
  } catch (error) {
    return {
      ok: false,
      code: "bundle_referenced_artifact_parse_failed",
      value: undefined,
      error: `${artifact.artifact_ref ?? artifact.artifact_type ?? "referenced artifact"} at ${artifact.content_path} could not be parsed: ${error.message}`
    };
  }
}

function validatePortableArtifactContentPath(artifact, errors) {
  if (artifact.content_path === undefined) {
    return true;
  }
  if (typeof artifact.content_path !== "string") {
    errors.push({
      code: "artifact_content_path_portable_required",
      message: `${artifact.artifact_ref ?? "artifact"} content_path must be a string when present`
    });
    return false;
  }

  const contentPath = artifact.content_path;
  const invalid =
    contentPath.trim() === "" ||
    contentPath.includes("\0") ||
    contentPath.includes("\\") ||
    /^[A-Za-z]:/.test(contentPath) ||
    contentPath.startsWith("/") ||
    path.isAbsolute(contentPath) ||
    contentPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..");

  let valid = true;
  if (invalid) {
    valid = false;
    errors.push({
      code: "artifact_content_path_portable_required",
      message: `${artifact.artifact_ref ?? "artifact"} content_path must be portable, relative, slash-separated, and non-traversing: ${JSON.stringify(contentPath)}`
    });
  }

  if (typeof artifact.content_path_anchor !== "string" || artifact.content_path_anchor.trim() === "") {
    valid = false;
    errors.push({
      code: "artifact_content_path_anchor_required",
      message: `${artifact.artifact_ref ?? "artifact"} must declare content_path_anchor for portable content_path semantics`
    });
  }
  return valid;
}

function categoryMap(categories) {
  const map = new Map();
  if (!Array.isArray(categories)) {
    return map;
  }
  for (const category of categories) {
    if (category && typeof category.category === "string" && !map.has(category.category)) {
      map.set(category.category, category);
    }
  }
  return map;
}

function includedCategory(categories, category, expected) {
  const actual = categories.get(category)?.included;
  return actual === expected;
}

function joinedLower(values) {
  return Array.isArray(values) ? values.join(" ").toLowerCase() : "";
}

function positiveNumber(value) {
  return Number.isInteger(value) && value > 0;
}

function sourceRetentionClass(value) {
  return value === "transient_source_derived" || value === "customer_opt_in_retained_source";
}

const REVIEW_EVENT_RETENTION_STATE_TYPES = new Set(["evidence_deleted", "retention_status_changed"]);
const REVIEW_EVENT_INTERNAL_LEARNING_TYPES = new Set(["pilot_metric_recorded", "pilot_feedback_recorded"]);
const REVIEW_EVENT_CUSTOMER_FINALIZATION_TYPES = new Set(["attestation_package_finalized", "attestation_package_exported"]);
const REVIEW_EVENT_CUSTOMER_CORRECTION_TYPES = new Set([
  "customer_remediation_recorded",
  "customer_accepted_risk_recorded"
]);
const REVIEW_EVENT_VERIFICATION_SCOPE_CORRECTION_TYPES = new Set([
  "verification_scope_recorded"
]);
const REVIEW_EVENT_EXPERT_CORRECTION_TYPES = new Set([
  "classification_recorded",
  "remediation_guidance_recorded",
  "validation_recorded",
  "false_positive_recorded"
]);
const REVIEW_EVENT_EXPERT_PROTECTED_TYPES = new Set([
  "classification_recorded",
  "remediation_guidance_recorded"
]);
// C7-27: classification/remediation-guidance/validation are each their own
// expert record family (unlike false_positive_recorded/customer_accepted_risk_recorded
// above, which already have dedicated same-family supersession guards) — a
// correction in one of these three must not supersede a record from another.
const REVIEW_EVENT_EXPERT_RECORD_TYPES = new Set([
  "classification_recorded",
  "remediation_guidance_recorded",
  "validation_recorded"
]);

function isReviewEventLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.event_id === "string" &&
      typeof value.review_id === "string" &&
      typeof value.event_type === "string" &&
      typeof value.visibility === "string" &&
      Number.isInteger(value.sequence_number)
  );
}

function isLogCheckpointLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.checkpoint_id === "string" &&
      typeof value.deployment_identity === "string" &&
      typeof value.merkle_root === "string" &&
      Number.isInteger(value.tree_size)
  );
}

export function logCheckpointIdentity(checkpoint) {
  const identityInput = { ...checkpoint };
  delete identityInput.checkpoint_id;
  return sha256IdFromCanonical(identityInput);
}

export function validateLogCheckpointSemantics(value, errors, label = "log checkpoint") {
  if (!isLogCheckpointLike(value)) {
    return;
  }

  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(["checkpoint_id"])) {
    errors.push({
      code: "log_checkpoint_identity_excludes_invalid",
      message: `${label} identity_input_excludes must be exactly ["checkpoint_id"]`
    });
  }

  try {
    if (logCheckpointIdentity(value) !== value.checkpoint_id) {
      errors.push({
        code: "log_checkpoint_identity_mismatch",
        message: `${label} checkpoint_id must equal SHA-256 over canonical checkpoint content excluding checkpoint_id`
      });
    }
  } catch {
    errors.push({
      code: "log_checkpoint_identity_mismatch",
      message: `${label} content must be RFC 8785 canonicalizable for identity verification`
    });
  }
}

function isReviewEventLogLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.review_id === "string" &&
      Array.isArray(value.events)
  );
}

function isReviewEventCustomerProjectionLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.review_id === "string" &&
      Array.isArray(value.entries)
  );
}

export function reviewEventIdentity(event) {
  const identityInput = { ...event };
  delete identityInput.event_id;
  return sha256IdFromCanonical(identityInput);
}

export function validateReviewEventSemantics(value, errors, label = "review event") {
  if (!isReviewEventLike(value)) {
    return;
  }

  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(["event_id"])) {
    errors.push({
      code: "review_event_identity_excludes_invalid",
      message: `${label} identity_input_excludes must be exactly ["event_id"]`
    });
  }

  if (value.internal_note !== undefined && value.visibility !== "internal_only") {
    errors.push({
      code: "review_event_internal_note_requires_internal_only",
      message: `${label} internal_note may only appear on internal_only events`
    });
  }

  if (value.reason !== undefined) {
    collectRemediationTextViolations(value.reason, "reason", label, errors, "review_event_reason", true);
  }

  if (value.event_type === "classification_recorded" && (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer")) {
    errors.push({
      code: "review_event_classification_reviewer_actor_required",
      message: `${label} classification_recorded events must be authored by a CodeAttest reviewer actor`
    });
  }

  if (value.event_type === "remediation_guidance_recorded" && (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer")) {
    errors.push({
      code: "review_event_remediation_guidance_reviewer_actor_required",
      message: `${label} remediation_guidance_recorded events must be authored by a CodeAttest reviewer actor`
    });
  }

  if (value.event_type === "validation_recorded" && (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer")) {
    errors.push({
      code: "review_event_validation_reviewer_actor_required",
      message: `${label} validation_recorded validation path/script events must be authored by a CodeAttest reviewer actor`
    });
  }

  if (value.event_type === "false_positive_recorded" && (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer")) {
    errors.push({
      code: "review_event_false_positive_reviewer_actor_required",
      message: `${label} false_positive_recorded events must be authored by a CodeAttest reviewer actor`
    });
  }

  if (value.event_type === "customer_accepted_risk_recorded") {
    const actorType = value.actor && typeof value.actor === "object" && !Array.isArray(value.actor) ? value.actor.actor_type : undefined;
    if (!["customer_user", "reviewer", "vendor_service"].includes(actorType) || !acceptedRiskEventReasonCarriesCustomerEvidence(value.reason)) {
      errors.push({
        code: "review_event_accepted_risk_customer_evidence_required",
        message: `${label} accepted-risk events require customer/reviewer/vendor actors and explicit customer rationale or sign-off evidence in their reason`
      });
    }
  }

  if ((value.event_type === "false_positive_recorded" || value.event_type === "customer_accepted_risk_recorded") && value.supersedes_classification_record_ref !== undefined) {
    errors.push({
      code: "review_event_outcome_supersedes_family_mismatch",
      message: `${label} outcome events must not carry supersedes_classification_record_ref`
    });
  }

  if (value.event_type === "customer_remediation_recorded" && (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "customer_user")) {
    errors.push({
      code: "review_event_customer_remediation_actor_required",
      message: `${label} customer_remediation_recorded events must be authored by a customer_user actor`
    });
  }

  if (value.event_type === "verification_scope_recorded") {
    const actorType = value.actor && typeof value.actor === "object" && !Array.isArray(value.actor) ? value.actor.actor_type : undefined;
    if (!["customer_user", "reviewer", "vendor_service"].includes(actorType) || verificationScopeActorIsForbiddenMachine(value.actor)) {
      errors.push({
        code: "review_event_verification_scope_actor_required",
        message: `${label} verification_scope_recorded events must be customer-authored or explicitly customer-backed reviewer/vendor records and never local-runner/worker/scanner/static-bundle actors`
      });
    }
    if (actorType !== "customer_user" && !verificationScopeEventCarriesCustomerBacking(value)) {
      errors.push({
        code: "review_event_verification_scope_customer_backing_required",
        message: `${label} reviewer/vendor verification_scope_recorded events must carry structured customer-backed selection provenance`
      });
    }
    if (verificationScopeTextHasForbiddenContent(value.reason)) {
      errors.push({
        code: "review_event_verification_scope_reason_claim_unsafe_text_forbidden",
        message: `${label} verification_scope_recorded reason must not imply fixed, verified, remediated, assurance, certification, or absence-of-vulnerabilities claims`
      });
    }
  }

  if (value.event_type === "verification_evidence_recorded") {
    const actorType = value.actor && typeof value.actor === "object" && !Array.isArray(value.actor) ? value.actor.actor_type : undefined;
    if (!['customer_user', 'vendor_service'].includes(actorType)) errors.push({ code: "review_event_verification_evidence_actor_required", message: `${label} verification evidence requires customer/customer-backed actor` });
    if (actorType === "vendor_service" && !isNonBlankString(value.customer_actor_ref)) errors.push({ code: "review_event_verification_evidence_customer_backing_required", message: `${label} vendor evidence event requires customer_actor_ref` });
    if (verificationScopeTextHasForbiddenContent(value.reason)) errors.push({ code: "review_event_verification_evidence_reason_claim_unsafe_text_forbidden", message: `${label} verification evidence reason is claim unsafe` });
  }

  if (value.event_type === "verification_recorded") {
    if (value.actor?.actor_type !== "reviewer") errors.push({ code: "review_event_verification_record_reviewer_actor_required", message: `${label} verification decision requires reviewer actor` });
    if (verificationScopeTextHasForbiddenContent(value.reason)) errors.push({ code: "review_event_verification_record_reason_claim_unsafe_text_forbidden", message: `${label} verification decision reason is claim unsafe` });
  }

  if (value.event_type === "attestation_generated" && !["reviewer", "vendor_service"].includes(value.actor?.actor_type)) {
    errors.push({ code: "review_event_attestation_generation_actor_required", message: `${label} attestation generation requires reviewer or vendor service actor` });
  }
  if (value.event_type === "static_bundle_generated" && value.actor?.actor_type !== "vendor_service") {
    errors.push({ code: "review_event_static_bundle_actor_required", message: `${label} static bundle generation requires deterministic vendor service actor` });
  }
  if (REVIEW_EVENT_CUSTOMER_FINALIZATION_TYPES.has(value.event_type) && value.actor?.actor_type !== "customer_user") {
    errors.push({ code: "review_event_finalization_customer_actor_required", message: `${label} package finalization and export require customer actor` });
  }
  if (REVIEW_EVENT_INTERNAL_LEARNING_TYPES.has(value.event_type)) {
    if (value.visibility !== "internal_only" || !["reviewer", "vendor_service"].includes(value.actor?.actor_type)) errors.push({ code: "review_event_pilot_internal_only_required", message: `${label} pilot learning events require reviewer/vendor actor and internal_only visibility` });
    if (value.reason !== undefined) errors.push({ code: "review_event_pilot_metadata_only_reason_forbidden", message: `${label} pilot learning event must be metadata-only without free-text reason` });
  }

  if (REVIEW_EVENT_RETENTION_STATE_TYPES.has(value.event_type) && value.source_derived_class === undefined) {
    errors.push({
      code: "review_event_missing_source_derived_class",
      message: `${label} ${value.event_type} must declare source_derived_class`
    });
  }

  if (!typedReviewEventArtifactRefsMatch(value)) {
    errors.push({
      code: "review_event_typed_artifact_ref_mismatch",
      message: `${label} typed review events must reference exactly their derived artifact ref`
    });
  }

  if (value.event_type === "submission_rejected" || value.event_type === "submission_quarantined") {
    const submissionAttemptKeyPattern = /^submission_attempt:bundle_instance:[a-z0-9][a-z0-9_-]{2,63}:submission_attempt:[a-z0-9][a-z0-9_-]{2,63}$/;
    if (typeof value.idempotency_key !== "string" || !submissionAttemptKeyPattern.test(value.idempotency_key)) {
      errors.push({
        code: "submission_event_idempotency_key_not_derived",
        message: `${label} submission events must derive idempotency_key from bundle and attempt identity`
      });
    }
  }

  if (reviewEventIdentity(value) !== value.event_id) {
    errors.push({
      code: "review_event_identity_mismatch",
      message: `${label} event_id must equal the sha256 of its RFC 8785 canonical content excluding event_id`
    });
  }
}

export function validateReviewEventLogSemantics(value, errors) {
  if (!isReviewEventLogLike(value) || !value.events.every((event) => isReviewEventLike(event))) {
    return;
  }

  const seenEventIds = new Map();
  const seenIdempotencyKeys = new Set();
  const priorClassificationArtifactRefs = new Set();
  let maxSequenceNumber;

  for (const [index, event] of value.events.entries()) {
    const label = `review event log entry ${index}`;
    validateReviewEventSemantics(event, errors, label);

    if (event.review_id !== value.review_id) {
      errors.push({
        code: "review_event_log_review_id_mismatch",
        message: `${label} review_id must equal the log review_id ${value.review_id}`
      });
    }

    if (maxSequenceNumber !== undefined && event.sequence_number <= maxSequenceNumber) {
      errors.push({
        code: "review_event_log_sequence_not_monotonic",
        message: `${label} sequence_number ${event.sequence_number} must be strictly greater than every earlier sequence_number`
      });
    }
    maxSequenceNumber = maxSequenceNumber === undefined ? event.sequence_number : Math.max(maxSequenceNumber, event.sequence_number);

    if (seenEventIds.has(event.event_id)) {
      errors.push({
        code: "review_event_log_duplicate_event_id",
        message: `${label} repeats event_id ${event.event_id}`
      });
    }

    if (seenIdempotencyKeys.has(event.idempotency_key)) {
      errors.push({
        code: "review_event_log_duplicate_idempotency_key",
        message: `${label} repeats idempotency_key ${event.idempotency_key}; a repeated key must be an append no-op`
      });
    }
    seenIdempotencyKeys.add(event.idempotency_key);

    if (event.event_type === "verification_scope_recorded") {
      const activeVerificationScopeEvent = latestVerificationScopeEvent(value.events.slice(0, index), event);
      if (activeVerificationScopeEvent !== undefined && event.supersedes_event_id !== activeVerificationScopeEvent.event_id) {
        errors.push({
          code: "review_event_verification_scope_version_invalid",
          message: `${label} verification-scope corrections must supersede the latest active scope for the same review/pass identity`
        });
      } else if (activeVerificationScopeEvent === undefined) {
        // C7-26: unlike verification_evidence_recorded/verification_recorded above,
        // this branch never required the *first* verification_scope_recorded event
        // for a review/pass to start at scope_version 1 with no supersedes_event_id
        // — a log could begin at scope_version:2 with nothing superseded.
        const identity = verificationScopeIdentityFromEvent(event);
        if (identity?.scopeVersion !== 1 || event.supersedes_event_id !== undefined) {
          errors.push({
            code: "review_event_verification_scope_version_invalid",
            message: `${label} initial verification-scope event must start at scope_version 1 without supersedes_event_id`
          });
        }
      }
    }
    for (const eventType of ["verification_evidence_recorded", "verification_recorded"]) {
      if (event.event_type !== eventType) continue;
      const code = eventType === "verification_evidence_recorded" ? "review_event_verification_evidence_version_invalid" : "review_event_verification_record_version_invalid";
      const identity = versionedVerificationIdentityFromProtocolEvent(event, eventType);
      const active = latestVersionedVerificationProtocolEvent(value.events.slice(0, index), event, eventType);
      if ((active === undefined && (identity?.recordVersion !== 1 || event.supersedes_event_id !== undefined)) || (active !== undefined && event.supersedes_event_id !== active.event_id)) errors.push({ code, message: `${label} versioned verification event must begin at version 1 and corrections must supersede the active family head` });
    }

    if (event.supersedes_event_id !== undefined) {
      const supersededIndex = seenEventIds.get(event.supersedes_event_id);
      if (supersededIndex === undefined) {
        errors.push({
          code: "review_event_log_supersedes_unknown_event",
          message: `${label} supersedes_event_id must reference an earlier event in the same log`
        });
      } else if (REVIEW_EVENT_CUSTOMER_CORRECTION_TYPES.has(event.event_type) || event.actor?.actor_type === "customer_user") {
        const chain = reviewEventSupersedesChain(value.events, event.supersedes_event_id);
        if (chain !== undefined) validateVersionedVerificationSupersedes(event, chain, value.events.slice(0, index), errors, label);
        if (chain === undefined) {
          errors.push({
            code: "review_event_log_supersedes_unknown_event",
            message: `${label} supersedes_event_id chain must remain within the same log`
          });
        } else if (chain.some((superseded) => superseded.event_type === "classification_recorded")) {
          errors.push({
            code: "customer_event_cannot_supersede_classification",
            message: `${label} customer-authored events must not supersede an expert classification_recorded event`
          });
        } else if (chain.some((superseded) => superseded.event_type === "remediation_guidance_recorded" || superseded.event_type === "validation_recorded" || superseded.event_type === "false_positive_recorded")) {
          errors.push({
            code: "customer_event_cannot_supersede_expert_record",
            message: `${label} customer-authored events must not supersede reviewer guidance or outcome chains`
          });
        } else if (event.event_type === "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type !== "customer_accepted_risk_recorded")) {
          errors.push({
            code: "review_event_outcome_supersedes_family_mismatch",
            message: `${label} accepted-risk corrections may supersede only prior accepted-risk events`
          });
        } else if (event.event_type !== "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type === "customer_accepted_risk_recorded")) {
          errors.push({
            code: "review_event_outcome_supersedes_family_mismatch",
            message: `${label} non-accepted-risk events must not supersede accepted-risk outcome history`
          });
        }
        if (event.event_type === "verification_scope_recorded" && chain.some((superseded) => superseded.event_type !== "verification_scope_recorded")) {
          errors.push({
            code: "review_event_verification_scope_supersedes_family_mismatch",
            message: `${label} verification-scope corrections may supersede only prior verification-scope events`
          });
        } else if (event.event_type !== "verification_scope_recorded" && chain.some((superseded) => superseded.event_type === "verification_scope_recorded")) {
          errors.push({
            code: "review_event_verification_scope_supersedes_family_mismatch",
            message: `${label} non-verification-scope events must not supersede verification-scope history`
          });
        }
        if (event.event_type === "verification_scope_recorded" && chain.every((superseded) => superseded.event_type === "verification_scope_recorded")) {
          const current = verificationScopeIdentityFromEvent(event);
          const prior = verificationScopeIdentityFromEvent(chain[0]);
          if (current === undefined || prior === undefined || current.reviewId !== prior.reviewId || current.verificationPassId !== prior.verificationPassId || current.scopeVersion <= prior.scopeVersion) {
            errors.push({
              code: "review_event_verification_scope_version_invalid",
              message: `${label} verification-scope corrections must retain review/pass identity and increase scope_version`
            });
          }
        }
      } else {
        const chain = reviewEventSupersedesChain(value.events, event.supersedes_event_id);
        if (chain !== undefined) validateVersionedVerificationSupersedes(event, chain, value.events.slice(0, index), errors, label);
        if (chain === undefined) {
          errors.push({
            code: "review_event_log_supersedes_unknown_event",
            message: `${label} supersedes_event_id chain must remain within the same log`
          });
        } else {
          if (event.event_type === "verification_scope_recorded" && chain.some((superseded) => superseded.event_type !== "verification_scope_recorded")) {
            errors.push({
              code: "review_event_verification_scope_supersedes_family_mismatch",
              message: `${label} verification-scope corrections may supersede only prior verification-scope events`
            });
          } else if (event.event_type === "verification_scope_recorded") {
            const activeVerificationScopeEvent = latestVerificationScopeEvent(value.events.slice(0, index), event);
            if (!verificationScopeCorrectionVersionIsValid(event, chain[0], activeVerificationScopeEvent)) {
              errors.push({
                code: "review_event_verification_scope_version_invalid",
                message: `${label} verification-scope corrections must retain review/pass identity and increase scope_version`
              });
            }
          } else if (event.event_type !== "verification_scope_recorded" && chain.some((superseded) => superseded.event_type === "verification_scope_recorded")) {
            errors.push({
              code: "review_event_verification_scope_supersedes_family_mismatch",
              message: `${label} non-verification-scope events must not supersede verification-scope history`
            });
          }
          if (event.event_type === "false_positive_recorded" && chain.some((superseded) => superseded.event_type !== "false_positive_recorded")) {
            errors.push({
              code: "review_event_outcome_supersedes_family_mismatch",
              message: `${label} false-positive corrections may supersede only prior false-positive events`
            });
          } else if (event.event_type !== "false_positive_recorded" && chain.some((superseded) => superseded.event_type === "false_positive_recorded")) {
            errors.push({
              code: "review_event_outcome_supersedes_family_mismatch",
              message: `${label} non-false-positive events must not supersede false-positive outcome history`
            });
          }
          if (event.event_type === "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type !== "customer_accepted_risk_recorded")) {
            errors.push({
              code: "review_event_outcome_supersedes_family_mismatch",
              message: `${label} accepted-risk corrections may supersede only prior accepted-risk events`
            });
          } else if (event.event_type !== "customer_accepted_risk_recorded" && chain.some((superseded) => superseded.event_type === "customer_accepted_risk_recorded")) {
            errors.push({
              code: "review_event_outcome_supersedes_family_mismatch",
              message: `${label} non-accepted-risk events must not supersede accepted-risk outcome history`
            });
          }
          // C7-27: the verification-scope and false-positive/accepted-risk families above
          // are guarded against cross-family supersession, but classification, remediation
          // guidance, and validation (all reviewer-authored "expert record" families) were
          // not, so a remediation_guidance_recorded event could supersede a prior
          // classification_recorded event and rewrite/retire a different expert history.
          if (REVIEW_EVENT_EXPERT_RECORD_TYPES.has(event.event_type) && chain.some((superseded) => superseded.event_type !== event.event_type)) {
            errors.push({
              code: "review_event_expert_supersedes_family_mismatch",
              message: `${label} expert corrections may supersede only prior events in the same expert record family`
            });
          } else if (!REVIEW_EVENT_EXPERT_RECORD_TYPES.has(event.event_type) && chain.some((superseded) => REVIEW_EVENT_EXPERT_RECORD_TYPES.has(superseded.event_type))) {
            errors.push({
              code: "review_event_expert_supersedes_family_mismatch",
              message: `${label} non-expert-family events must not supersede expert record history`
            });
          }
        }
      }
    }

    if (event.supersedes_classification_record_ref !== undefined) {
      if (event.event_type === "false_positive_recorded" || event.event_type === "customer_accepted_risk_recorded") {
        // validateReviewEventSemantics already emits review_event_outcome_supersedes_family_mismatch.
      } else if (REVIEW_EVENT_CUSTOMER_CORRECTION_TYPES.has(event.event_type) || event.actor?.actor_type === "customer_user") {
        errors.push({
          code: "customer_event_cannot_supersede_classification",
          message: `${label} customer-authored events must not directly reference a superseded expert classification record`
        });
      } else {
        const expectedArtifactRef = classificationArtifactRefFromRecordRef(event.supersedes_classification_record_ref);
        if (!priorClassificationArtifactRefs.has(expectedArtifactRef)) {
          errors.push({
            code: "review_event_log_supersedes_unknown_event",
            message: `${label} supersedes_classification_record_ref must reference an earlier classification artifact in the same log`
          });
        }
      }
    }

    if (!seenEventIds.has(event.event_id)) {
      seenEventIds.set(event.event_id, index);
    }
    if (event.event_type === "classification_recorded" && Array.isArray(event.artifact_refs)) {
      for (const artifactRef of event.artifact_refs) {
        if (typeof artifactRef === "string") {
          priorClassificationArtifactRefs.add(artifactRef);
        }
      }
    }
  }
}

function classificationArtifactRefFromRecordRef(recordRef) {
  return `artifact_ref:${recordRef.slice("classification_record:".length)}`;
}

function verificationScopeIdentityFromEvent(event) {
  if (typeof event?.idempotency_key !== "string") {
    return undefined;
  }
  const match = /^verification_scope:(review:[a-z0-9][a-z0-9_-]{2,63}):verification_pass:([a-z0-9][a-z0-9_-]{2,63}):scope_version:([1-9][0-9]*)$/u.exec(event.idempotency_key);
  return match === null ? undefined : { reviewId: match[1], verificationPassId: match[2], scopeVersion: Number(match[3]) };
}

function latestVerificationScopeEvent(events, event) {
  const identity = verificationScopeIdentityFromEvent(event);
  if (identity === undefined) {
    return undefined;
  }
  return [...events]
    .filter((candidate) => isReviewEventLike(candidate) && candidate.event_type === "verification_scope_recorded")
    .filter((candidate) => {
      const candidateIdentity = verificationScopeIdentityFromEvent(candidate);
      return candidateIdentity !== undefined && candidateIdentity.reviewId === identity.reviewId && candidateIdentity.verificationPassId === identity.verificationPassId;
    })
    .sort((left, right) => {
      const leftIdentity = verificationScopeIdentityFromEvent(left);
      const rightIdentity = verificationScopeIdentityFromEvent(right);
      if (leftIdentity === undefined || rightIdentity === undefined) {
        return 0;
      }
      return leftIdentity.scopeVersion - rightIdentity.scopeVersion || left.sequence_number - right.sequence_number;
    })
    .at(-1);
}

function verificationScopeCorrectionVersionIsValid(event, superseded, activeVerificationScopeEvent = superseded) {
  const current = verificationScopeIdentityFromEvent(event);
  const prior = superseded === undefined ? undefined : verificationScopeIdentityFromEvent(superseded);
  const active = activeVerificationScopeEvent === undefined ? undefined : verificationScopeIdentityFromEvent(activeVerificationScopeEvent);
  return current !== undefined &&
    prior !== undefined &&
    active !== undefined &&
    current.reviewId === prior.reviewId &&
    current.verificationPassId === prior.verificationPassId &&
    current.reviewId === active.reviewId &&
    current.verificationPassId === active.verificationPassId &&
    current.scopeVersion > prior.scopeVersion &&
    current.scopeVersion > active.scopeVersion;
}

function versionedVerificationIdentityFromProtocolEvent(event, eventType) {
  if (typeof event?.idempotency_key !== "string") return undefined;
  const family = eventType === "verification_evidence_recorded" ? "verification_evidence" : "verification_record";
  const match = new RegExp(`^${family}:(review:[a-z0-9][a-z0-9_-]{2,63}):${family}:([a-z0-9][a-z0-9_-]{2,63}):record_version:([1-9][0-9]*)$`, "u").exec(event.idempotency_key);
  return match === null ? undefined : { reviewId: match[1], recordId: match[2], recordVersion: Number(match[3]) };
}

function latestVersionedVerificationProtocolEvent(events, event, eventType) {
  const identity = versionedVerificationIdentityFromProtocolEvent(event, eventType);
  if (identity === undefined) return undefined;
  return [...events]
    .filter((candidate) => isReviewEventLike(candidate) && candidate.event_type === eventType)
    .filter((candidate) => {
      const candidateIdentity = versionedVerificationIdentityFromProtocolEvent(candidate, eventType);
      return candidateIdentity !== undefined && candidateIdentity.reviewId === identity.reviewId && candidateIdentity.recordId === identity.recordId;
    })
    .sort((left, right) => {
      const leftIdentity = versionedVerificationIdentityFromProtocolEvent(left, eventType);
      const rightIdentity = versionedVerificationIdentityFromProtocolEvent(right, eventType);
      return leftIdentity.recordVersion - rightIdentity.recordVersion || left.sequence_number - right.sequence_number;
    })
    .at(-1);
}

function versionedVerificationProtocolCorrectionIsValid(event, superseded, active, eventType) {
  const current = versionedVerificationIdentityFromProtocolEvent(event, eventType);
  const prior = versionedVerificationIdentityFromProtocolEvent(superseded, eventType);
  const head = versionedVerificationIdentityFromProtocolEvent(active, eventType);
  return current !== undefined && prior !== undefined && head !== undefined && current.reviewId === prior.reviewId && current.recordId === prior.recordId && current.reviewId === head.reviewId && current.recordId === head.recordId && current.recordVersion > prior.recordVersion && current.recordVersion > head.recordVersion;
}

// C7-28: this used to require exactly one artifact_ref + a string idempotency_key
// for every event before even checking event_type, so untyped/aggregate event
// types (e.g. submission failure events) that legitimately carry multiple
// artifact_refs after schema validation were rejected here too. Only the typed
// singleton families below derive a single artifact_ref from a structured
// idempotency key; every other event type is schema-validated elsewhere and
// must not be re-constrained by this typed-family check.
const REVIEW_EVENT_TYPED_SINGLETON_TYPES = new Set([
  "classification_recorded",
  "remediation_guidance_recorded",
  "customer_remediation_recorded",
  "validation_recorded",
  "verification_scope_recorded",
  "verification_evidence_recorded",
  "verification_recorded",
  "attestation_generated",
  "static_bundle_generated",
  "attestation_package_finalized",
  "attestation_package_exported",
  "pilot_metric_recorded",
  "pilot_feedback_recorded",
  "false_positive_recorded",
  "customer_accepted_risk_recorded"
]);

function typedReviewEventArtifactRefsMatch(event) {
  if (!REVIEW_EVENT_TYPED_SINGLETON_TYPES.has(event.event_type)) return true;
  if (!Array.isArray(event.artifact_refs) || event.artifact_refs.length !== 1 || typeof event.idempotency_key !== "string") {
    return false;
  }
  const [artifactRef] = event.artifact_refs;
  if (event.event_type === "classification_recorded") {
    const match = /^classification:(review:[a-z0-9][a-z0-9_-]{2,63}):classification_record:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "remediation_guidance_recorded") {
    const match = /^remediation_guidance:(review:[a-z0-9][a-z0-9_-]{2,63}):remediation_guidance:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "customer_remediation_recorded") {
    const match = /^customer_remediation:(review:[a-z0-9][a-z0-9_-]{2,63}):customer_status:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "validation_recorded") {
    const pathMatch = /^validation_path:(review:[a-z0-9][a-z0-9_-]{2,63}):validation_path:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    if (pathMatch !== null) {
      return pathMatch[1] === event.review_id && artifactRef === `artifact_ref:${pathMatch[2]}`;
    }
    const scriptMatch = /^validation_script:(review:[a-z0-9][a-z0-9_-]{2,63}):validation_script:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    if (scriptMatch !== null) {
      return scriptMatch[1] === event.review_id && artifactRef === `artifact_ref:${scriptMatch[2]}`;
    }
    return false;
  }
  if (event.event_type === "verification_scope_recorded") {
    const identity = verificationScopeIdentityFromEvent(event);
    return identity !== undefined && identity.reviewId === event.review_id && artifactRef === `artifact_ref:${identity.verificationPassId}`;
  }
  if (event.event_type === "verification_evidence_recorded" || event.event_type === "verification_recorded") {
    const identity = versionedVerificationIdentityFromProtocolEvent(event, event.event_type);
    return identity !== undefined && identity.reviewId === event.review_id && artifactRef === `artifact_ref:${identity.recordId}`;
  }
  if (event.event_type === "attestation_generated") {
    const match = /^attestation:(review:[a-z0-9][a-z0-9_-]{2,63}):attestation:([a-f0-9]{64}):attestation_version:([1-9][0-9]*)$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "static_bundle_generated") {
    const match = /^static_bundle:(review:[a-z0-9][a-z0-9_-]{2,63}):static_bundle:[a-z0-9][a-z0-9_-]{2,63}:manifest_version:[1-9][0-9]*:manifest_id:([a-f0-9]{64})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `sha256:${match[2]}`;
  }
  if (event.event_type === "attestation_package_finalized" || event.event_type === "attestation_package_exported") {
    const prefix = event.event_type === "attestation_package_finalized" ? "attestation_package_finalized" : "attestation_package_exported";
    const match = new RegExp(`^${prefix}:(review:[a-z0-9][a-z0-9_-]{2,63}):static_bundle:[a-z0-9][a-z0-9_-]{2,63}:finalization_version:[1-9][0-9]*:record_id:[a-f0-9]{64}:generated_manifest_id:[a-f0-9]{64}:manifest_id:([a-f0-9]{64})$`, "u").exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `sha256:${match[2]}`;
  }
  if (event.event_type === "pilot_metric_recorded" || event.event_type === "pilot_feedback_recorded") {
    const family = event.event_type === "pilot_metric_recorded" ? "pilot_metric" : "pilot_feedback";
    const match = new RegExp(`^${family}:(review:[a-z0-9][a-z0-9_-]{2,63}):${family}:[a-z0-9][a-z0-9_-]{2,63}:record_version:[1-9][0-9]*:content_id:([a-f0-9]{64})$`, "u").exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `sha256:${match[2]}`;
  }
  if (event.event_type === "false_positive_recorded") {
    const match = /^false_positive:(review:[a-z0-9][a-z0-9_-]{2,63}):false_positive:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  if (event.event_type === "customer_accepted_risk_recorded") {
    const match = /^accepted_risk:(review:[a-z0-9][a-z0-9_-]{2,63}):accepted_risk:([a-z0-9][a-z0-9_-]{2,63})$/u.exec(event.idempotency_key);
    return match !== null && match[1] === event.review_id && artifactRef === `artifact_ref:${match[2]}`;
  }
  return true;
}

function verificationScopeEventCarriesCustomerBacking(event) {
  return isNonBlankString(event.customer_actor_ref) || isNonBlankString(event.customer_selection_evidence_ref);
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function acceptedRiskEventReasonCarriesCustomerEvidence(reason) {
  if (typeof reason !== "string") {
    return false;
  }
  const trimmed = reason.trim();
  if (/Customer (rationale|sign-off):\s*(?:no|none|without|missing|not provided|absent)\b/iu.test(trimmed)) {
    return false;
  }
  return /^(Accepted risk recorded for [^.]+\. Customer (rationale|sign-off): .{12,})$/iu.test(trimmed);
}

function isValidationEventIdempotencyKey(value) {
  return typeof value === "string" && (/^validation_path:/u.test(value) || /^validation_script:/u.test(value));
}

function validateVersionedVerificationSupersedes(event, chain, priorEvents, errors, label) {
  for (const eventType of ["verification_evidence_recorded", "verification_recorded"]) {
    const familyCode = eventType === "verification_evidence_recorded" ? "review_event_verification_evidence_supersedes_family_mismatch" : "review_event_verification_record_supersedes_family_mismatch";
    const versionCode = eventType === "verification_evidence_recorded" ? "review_event_verification_evidence_version_invalid" : "review_event_verification_record_version_invalid";
    if (event.event_type === eventType) {
      if (chain.some((superseded) => superseded.event_type !== eventType)) errors.push({ code: familyCode, message: `${label} may supersede only ${eventType} history` });
      const active = latestVersionedVerificationProtocolEvent(priorEvents, event, eventType);
      if (!versionedVerificationProtocolCorrectionIsValid(event, chain[0], active, eventType)) errors.push({ code: versionCode, message: `${label} must retain review/record identity and increase record_version above active head` });
    } else if (chain.some((superseded) => superseded.event_type === eventType)) {
      errors.push({ code: familyCode, message: `${label} non-${eventType} event must not supersede ${eventType} history` });
    }
  }
}

function reviewEventSupersedesChain(events, firstSupersededId) {
  const chain = [];
  const visited = new Set();
  let nextId = firstSupersededId;

  while (nextId !== undefined) {
    if (visited.has(nextId)) {
      break;
    }
    visited.add(nextId);
    const superseded = events.find((existing) => isReviewEventLike(existing) && existing.event_id === nextId);
    if (superseded === undefined) {
      return undefined;
    }
    chain.push(superseded);
    nextId = superseded.supersedes_event_id;
  }

  return chain;
}

export function validateReviewEventCustomerProjectionSemantics(value, errors) {
  if (!isReviewEventCustomerProjectionLike(value)) {
    return;
  }

  const seenEventIds = new Set();
  for (const [index, entry] of value.entries.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.event_id !== "string") {
      continue;
    }
    if (entry.visibility !== "customer_facing") {
      errors.push({
        code: "customer_projection_internal_only_entry",
        message: `customer projection entry ${index} must be customer_facing`
      });
    }
    if (seenEventIds.has(entry.event_id)) {
      errors.push({
        code: "customer_projection_duplicate_event_id",
        message: `customer projection entry ${index} repeats event_id ${entry.event_id}`
      });
    }
    seenEventIds.add(entry.event_id);
  }
}

/**
 * Cross-checks a customer projection against the review event log it claims to
 * project. Entry-level checks alone cannot see truncation or fabrication: a
 * projection that drops a customer-facing event, or invents one the log never
 * recorded, is internally consistent and passes them. The projection is only
 * trustworthy if its entry set is exactly the log's `customer_facing` subset,
 * in `sequence_number` order, with per-entry fields carried through unchanged.
 */
export function validateReviewEventCustomerProjectionAgainstLog(projection, log, errors, label = "customer projection") {
  if (!isReviewEventCustomerProjectionLike(projection) || !isReviewEventLogLike(log)) {
    return;
  }

  if (projection.review_id !== log.review_id || projection.protocol_version !== log.protocol_version) {
    errors.push({
      code: "customer_projection_review_scope_mismatch",
      message: `${label} must project the log for ${log.review_id} at ${log.protocol_version}`
    });
    return;
  }

  const expected = [...log.events]
    .filter((event) => event && typeof event === "object" && event.visibility === "customer_facing")
    .sort((left, right) => left.sequence_number - right.sequence_number);

  const expectedById = new Map(expected.map((event) => [event.event_id, event]));
  const projectedIds = new Set();

  for (const [index, entry] of projection.entries.entries()) {
    if (!entry || typeof entry !== "object" || typeof entry.event_id !== "string") {
      continue;
    }
    projectedIds.add(entry.event_id);

    const source = expectedById.get(entry.event_id);
    if (source === undefined) {
      errors.push({
        code: "customer_projection_unknown_event",
        message: `${label} entry ${index} projects ${entry.event_id}, which is not a customer_facing event in the log`
      });
      continue;
    }

    for (const [entryField, sourceValue] of [
      ["event_type", source.event_type],
      ["event_timestamp", source.event_timestamp],
      ["actor_category", source.actor?.actor_type],
      ["artifact_refs", source.artifact_refs],
      ["reason", source.reason]
    ]) {
      if (canonicalize(entry[entryField] ?? null) !== canonicalize(sourceValue ?? null)) {
        errors.push({
          code: "customer_projection_entry_mismatch",
          message: `${label} entry ${index} ${entryField} does not match event ${entry.event_id} in the log`
        });
      }
    }
  }

  for (const event of expected) {
    if (!projectedIds.has(event.event_id)) {
      errors.push({
        code: "customer_projection_missing_event",
        message: `${label} omits customer_facing event ${event.event_id}; a customer history may not be truncated`
      });
    }
  }

  const projectedOrder = projection.entries
    .map((entry) => (entry && typeof entry === "object" ? entry.event_id : undefined))
    .filter((eventId) => typeof eventId === "string" && expectedById.has(eventId));
  const expectedOrder = expected.map((event) => event.event_id).filter((eventId) => projectedIds.has(eventId));
  if (canonicalize(projectedOrder) !== canonicalize(expectedOrder)) {
    errors.push({
      code: "customer_projection_order_mismatch",
      message: `${label} entries must follow the log's sequence_number order`
    });
  }
}

const STORED_OBJECT_NON_SOURCE_KINDS = new Set([
  "log_or_trace",
  "analytics_record",
  "crash_report",
  "support_attachment"
]);
const STORED_OBJECT_NON_SOURCE_ALLOWED_CLASSES = new Set(["never_collected", "retained_review_artifact"]);
const EVIDENCE_LIFECYCLE_CLASS_BEARING_TYPES = new Set(["evidence_deleted", "retention_status_changed"]);
// A Map, not an object literal: an object literal answers `constructor` and
// `toString` from `Object.prototype`, so the unknown-category branch would
// never fire for those inputs.
const MINIMIZATION_CATEGORY_SOURCE_CLASS = new Map([
  ["retained_finding", "retained_review_artifact"],
  ["retained_metadata", "retained_review_artifact"],
  ["retained_attestation", "retained_review_artifact"],
  ["retained_customer_opt_in_snippet", "customer_opt_in_retained_source"],
  ["deleted_transient", "transient_source_derived"],
  ["never_collected", "never_collected"]
]);

function isStoredObjectClassificationLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.stored_object_ref === "string" &&
      typeof value.object_kind === "string" &&
      typeof value.source_derived_class === "string"
  );
}

function isEvidenceLifecycleEventLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.event_id === "string" &&
      value.event_id.startsWith("evidence_event:") &&
      typeof value.event_type === "string" &&
      Number.isInteger(value.sequence_number)
  );
}

function isRetentionOptInRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.retention_record_id === "string"
  );
}

function isEvidenceMinimizationProjectionLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.review_id === "string" &&
      Array.isArray(value.entries) &&
      value.entries.every((entry) => entry && typeof entry === "object" && typeof entry.minimization_category === "string")
  );
}

/**
 * Logs, traces, analytics, crash reports, and support attachments are the
 * surfaces most likely to leak customer source by accident, so they may only
 * ever declare a non-source class. Customer opt-in retained source is a pilot
 * capability and stays impossible outside the real-snippet-ready profile.
 */
export function validateStoredObjectClassificationSemantics(value, errors, label = "stored object classification") {
  if (!isStoredObjectClassificationLike(value)) {
    return;
  }

  if (
    STORED_OBJECT_NON_SOURCE_KINDS.has(value.object_kind) &&
    !STORED_OBJECT_NON_SOURCE_ALLOWED_CLASSES.has(value.source_derived_class)
  ) {
    errors.push({
      code: "stored_object_forbidden_source_class",
      message: `${label} ${value.stored_object_ref} of kind ${value.object_kind} must not declare ${value.source_derived_class}`
    });
  }

  if (
    value.source_derived_class === "customer_opt_in_retained_source" &&
    value.environment_profile !== "partner_pilot_real_snippet_ready"
  ) {
    errors.push({
      code: "stored_object_opt_in_not_allowed",
      message: `${label} ${value.stored_object_ref} may only declare customer_opt_in_retained_source under partner_pilot_real_snippet_ready`
    });
  }
}

/**
 * Deletion is only provable when the event carries a Deletion Evidence
 * reference; a status label alone is not a receipt of deletion. Access is only
 * auditable when the event records the scope the inspection happened under.
 */
export function validateEvidenceLifecycleEventSemantics(value, errors, label = "evidence lifecycle event") {
  if (!isEvidenceLifecycleEventLike(value)) {
    return;
  }

  if (value.event_type === "evidence_deleted" && typeof value.deletion_evidence_ref !== "string") {
    errors.push({
      code: "deletion_event_missing_deletion_evidence",
      message: `${label} ${value.event_id} must reference a Deletion Evidence artifact; a status label alone does not prove deletion`
    });
  }

  if (value.event_type === "evidence_accessed" && value.access_scope === undefined) {
    errors.push({
      code: "access_event_missing_scope",
      message: `${label} ${value.event_id} must record the tenant and review scope the access happened under`
    });
  }

  if (value.event_type === "evidence_accessed" && value.access_scope !== undefined && value.access_scope.review_scope !== value.review_id) {
    errors.push({
      code: "access_event_scope_mismatch",
      message: `${label} ${value.event_id} access scope must match the event's own review id`
    });
  }

  if (EVIDENCE_LIFECYCLE_CLASS_BEARING_TYPES.has(value.event_type) && value.source_derived_class === undefined) {
    errors.push({
      code: "evidence_event_missing_source_derived_class",
      message: `${label} ${value.event_id} of type ${value.event_type} must declare source_derived_class`
    });
  }
}

export function validateDeletionEvidenceSemantics(value, errors, label = "deletion evidence") {
  if (!isDeletionEvidenceLike(value)) {
    return;
  }
  if (value.supersedes_deletion_evidence_ref === value.deletion_evidence_id) {
    errors.push({
      code: "deletion_evidence_self_supersede",
      message: `${label} supersedes_deletion_evidence_ref must reference an earlier attempt, not itself`
    });
  }
}

function isDeletionEvidenceLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.deletion_evidence_id === "string" &&
      typeof value.verification_status === "string" &&
      Array.isArray(value.deleted_artifact_digests)
  );
}

export function validateRetentionOptInRecordSemantics(value, errors, label = "retention opt-in record") {
  if (!isRetentionOptInRecordLike(value)) {
    return;
  }

  const period = value.retention_period;
  if (!period || typeof period !== "object" || Array.isArray(period)) {
    return;
  }
  const start = parseUtcTimestampNs(period.start_timestamp ?? "");
  const end = parseUtcTimestampNs(period.end_timestamp ?? "");
  if (start === undefined || end === undefined || end <= start) {
    errors.push({
      code: "retention_period_invalid",
      message: `${label} ${value.retention_record_id} retention_period end_timestamp must be after start_timestamp`
    });
  }
}

/**
 * The projection is only a data-minimization statement if the six categories
 * stay distinct: each category pins exactly one retention/source-derived class,
 * and a deleted-transient entry resolves to Deletion Evidence rather than being
 * an unbacked claim.
 */
export function validateEvidenceMinimizationProjectionSemantics(value, errors, label = "evidence minimization projection") {
  if (!isEvidenceMinimizationProjectionLike(value)) {
    return;
  }

  const categoryByArtifactRef = new Map();

  for (const [index, entry] of value.entries.entries()) {
    // One artifact rendered under two categories is two contradictory claims,
    // not a minimization statement: it could show as deleted and retained at once.
    const priorCategory = categoryByArtifactRef.get(entry.artifact_ref);
    if (priorCategory !== undefined && priorCategory !== entry.minimization_category) {
      errors.push({
        code: "minimization_artifact_category_conflict",
        message: `${label} entry ${index} repeats an artifact under category ${entry.minimization_category} after ${priorCategory}`
      });
    }
    categoryByArtifactRef.set(entry.artifact_ref, entry.minimization_category);

    const expectedClass = MINIMIZATION_CATEGORY_SOURCE_CLASS.get(entry.minimization_category);
    if (expectedClass !== undefined && entry.source_derived_class !== expectedClass) {
      errors.push({
        code: "minimization_category_class_mismatch",
        message: `${label} entry ${index} category ${entry.minimization_category} must declare source_derived_class ${expectedClass}`
      });
    }

    if (entry.minimization_category === "deleted_transient" && typeof entry.deletion_evidence_ref !== "string") {
      errors.push({
        code: "minimization_deleted_without_evidence",
        message: `${label} entry ${index} is deleted_transient and must resolve to a Deletion Evidence reference`
      });
    }
  }
}

/**
 * Story 2.6: the three intake outcomes are mutually exclusive and complete.
 * Each state pins the next paths the *system* can offer for it; a next path
 * outside that set is a record whose state and offered remedy disagree.
 */
const SUBMISSION_OUTCOME_STATE_NEXT_PATHS = new Map([
  ["received_with_receipt", new Set(["verify_receipt"])],
  ["rejected_no_receipt", new Set(["retry", "contact_support"])],
  ["quarantined_no_receipt", new Set(["quarantine_support", "contact_support"])]
]);

function isSubmissionOutcomeLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.outcome_state === "string" &&
      SUBMISSION_OUTCOME_STATE_NEXT_PATHS.has(value.outcome_state)
  );
}

function submissionOutcomeLabel(value, label) {
  return typeof value.submission_outcome_id === "string" && value.submission_outcome_id.length > 0
    ? `${label} ${value.submission_outcome_id}`
    : `${label} <missing submission_outcome_id>`;
}

/**
 * A failed submission may never be reported as a received one. `received_with_receipt`
 * requires a minted receipt reference and carries no failure reason codes; both
 * failure states carry at least one reason code and no receipt reference at all.
 * Failure copy stays claim-safe against the shared forbidden-phrase list, so a
 * rejection or quarantine can never read as a review outcome.
 */
export function validateSubmissionOutcomeSemantics(value, errors, label = "submission outcome") {
  if (!isSubmissionOutcomeLike(value)) {
    return;
  }

  const isFailure = value.outcome_state === "rejected_no_receipt" || value.outcome_state === "quarantined_no_receipt";
  const reasonCodes = Array.isArray(value.failure_reason_codes) ? value.failure_reason_codes : [];
  const displayLabel = submissionOutcomeLabel(value, label);

  if (value.outcome_state === "received_with_receipt" && value.vendor_receipt_ref === undefined) {
    errors.push({
      code: "submission_outcome_receipt_required",
      message: `${displayLabel} claims received_with_receipt without a minted receipt reference`
    });
  }

  if (isFailure && value.vendor_receipt_ref !== undefined) {
    errors.push({
      code: "submission_outcome_failure_must_not_reference_receipt",
      message: `${displayLabel} is ${value.outcome_state} and must not reference a receipt`
    });
  }

  if (isFailure && reasonCodes.length === 0) {
    errors.push({
      code: "submission_outcome_failure_requires_reason_codes",
      message: `${displayLabel} is ${value.outcome_state} and must carry at least one reason code`
    });
  }

  if (value.outcome_state === "received_with_receipt" && reasonCodes.length > 0) {
    errors.push({
      code: "submission_outcome_received_must_not_carry_reason_codes",
      message: `${displayLabel} is received_with_receipt and must not carry failure reason codes`
    });
  }

  const allowedNextPaths = SUBMISSION_OUTCOME_STATE_NEXT_PATHS.get(value.outcome_state);
  if (allowedNextPaths !== undefined && !allowedNextPaths.has(value.next_path)) {
    errors.push({
      code: "submission_outcome_next_path_state_mismatch",
      message: `${displayLabel} in state ${value.outcome_state} may not offer next path ${value.next_path}`
    });
  }

  let summaryImpliesReview = false;
  if (isFailure && typeof value.customer_facing_summary === "string") {
    const forbidden = customerVisibleTextForbidden(value.customer_facing_summary);
    if (forbidden !== undefined) {
      summaryImpliesReview = true;
      errors.push({
        code: "submission_outcome_summary_implies_review",
        message: `${displayLabel} summary must not imply CodeAttest reviewed, accepted, certified, or guaranteed the evidence: ${forbidden}`
      });
    }
  }

  // Append-time review-event text checks do not run here: this projector is
  // independently callable straight off a stored SubmissionOutcome artifact.
  // `forbiddenPublicContentReason` folds in customerVisibleTextForbidden, so
  // skip it when the claim-overreach check above already reported the same
  // underlying phrase — one summary should not produce two error codes for
  // one root cause.
  if (isFailure && !summaryImpliesReview && forbiddenPublicContentReason(value.customer_facing_summary) !== undefined) {
    errors.push({
      code: "submission_outcome_summary_text_forbidden",
      message: `${displayLabel} summary must not contain raw source, credential, or PII text`
    });
  }
  if (isFailure && Array.isArray(value.submission_identities) && value.submission_identities.some((row) => row && typeof row === "object" && forbiddenPublicContentReason(row.identity_value) !== undefined)) {
    errors.push({
      code: "submission_outcome_identity_value_text_forbidden",
      message: `${displayLabel} submission_identities identity_value must not contain raw source, credential, or PII text`
    });
  }

  // schema uniqueItems only forbids an exact (type, value) duplicate; two
  // bundle_instance_id rows with different values, or a row that disagrees
  // with the outcome's own top-level fields, both pass the schema.
  if (Array.isArray(value.submission_identities)) {
    const countByType = new Map();
    for (const row of value.submission_identities) {
      if (row && typeof row === "object" && typeof row.identity_type === "string") {
        countByType.set(row.identity_type, (countByType.get(row.identity_type) ?? 0) + 1);
      }
    }
    if ([...countByType.values()].some((count) => count > 1)) {
      errors.push({
        code: "submission_outcome_duplicate_identity_type",
        message: `${displayLabel} submission_identities must carry at most one row per identity_type`
      });
    }
    const bundleRow = value.submission_identities.find((row) => row && typeof row === "object" && row.identity_type === "bundle_instance_id");
    const attemptRow = value.submission_identities.find((row) => row && typeof row === "object" && row.identity_type === "submission_attempt_id");
    if (
      bundleRow === undefined || attemptRow === undefined ||
      bundleRow.identity_value !== value.bundle_instance_id || attemptRow.identity_value !== value.submission_attempt_id
    ) {
      errors.push({
        code: "submission_outcome_identity_field_mismatch",
        message: `${displayLabel} submission_identities must include bundle_instance_id/submission_attempt_id rows equal to the outcome's own top-level fields`
      });
    }
  }
}

const REVIEW_FINDING_DRAFT_FORBIDDEN_FIELDS = new Set([
  "classification",
  "expert_classification",
  "reviewer_classification",
  "confirmed",
  "likely",
  "inconclusive",
  "requires_customer_side_validation",
  "remediation_guidance",
  "validation_path",
  "attestation_copy",
  "receipt_semantics",
  "scanner_execution"
]);

const REVIEW_FINDING_DRAFT_INSUFFICIENT_BASIS = new Set([
  "scanner_output",
  "metadata_only",
  "deleted_under_policy_reference",
  "not_submitted_by_policy_reference",
  "never_collected_reference",
  "unresolved_reference"
]);

const REVIEW_FINDING_DRAFT_UNAVAILABLE_STATES = new Set([
  "deleted_under_policy",
  "never_collected",
  "not_submitted_by_policy",
  "unresolved_reference"
]);

// C7-31: consistency checks near this rule only rejected unavailable states
// shown as available, never the inverse — e.g. a genuinely retained artifact
// could still be displayed as "deleted" or omit its available_reference
// display state. This is the full five-state matrix in one place so every
// evidence-ref consumer can share it instead of re-deriving one direction.
function evidenceRefDisplayIsConsistent(ref) {
  if (!ref || typeof ref !== "object") return true;
  if (ref.availability_state === "retained_review_artifact") return ref.available_for_review === true && ref.display_state === "available_reference";
  if (ref.availability_state === "deleted_under_policy") return ref.available_for_review !== true && ref.display_state === "deleted" && typeof ref.deletion_evidence_ref === "string" && ref.deletion_evidence_ref.length > 0;
  if (ref.availability_state === "not_submitted_by_policy") return ref.available_for_review !== true && ref.display_state === "not_submitted";
  if (ref.availability_state === "never_collected") return ref.available_for_review !== true && ref.display_state === "not_collected";
  if (ref.availability_state === "unresolved_reference") return ref.available_for_review !== true && ref.display_state === "unresolved_reference";
  return true;
}

function isReviewFindingDraftSetLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.normalization_run_id === "string" &&
      Array.isArray(value.review_finding_drafts)
  );
}

function reviewFindingDraftSetLabel(value, label) {
  return typeof value.normalization_run_id === "string" && value.normalization_run_id.length > 0
    ? `${label} ${value.normalization_run_id}`
    : `${label} <missing normalization_run_id>`;
}

export async function validateReviewFindingDraftSetSemantics(value, options, errors, label = "review finding draft set") {
  if (!isReviewFindingDraftSetLike(value)) {
    return;
  }

  const displayLabel = reviewFindingDraftSetLabel(value, label);

  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "review_finding_draft_set_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }

  const receiptsById = await loadVendorReceiptsById(options.fixtureRoot);
  const receipt = receiptsById.get(value.vendor_receipt_ref);
  if (value.vendor_receipt_ref !== undefined && receipt === undefined) {
    errors.push({
      code: "review_finding_draft_set_unknown_receipt",
      message: `${displayLabel} references unknown Vendor Receipt ${value.vendor_receipt_ref}`
    });
  }
  if (receipt !== undefined) {
    if (receipt.verification_state !== "received_with_receipt") {
      errors.push({
        code: "review_finding_draft_set_receipt_not_received",
        message: `${displayLabel} requires a received_with_receipt Vendor Receipt`
      });
    }
    if (value.evidence_bundle_id !== receipt.evidence_bundle_id || value.manifest_id !== receipt.manifest_id) {
      errors.push({
        code: "review_finding_draft_set_receipt_identity_mismatch",
        message: `${displayLabel} must match evidence bundle and manifest identities from its Vendor Receipt`
      });
    }
  }

  if (value.normalization_status === "no_findings_produced") {
    if (value.review_finding_drafts.length !== 0) {
      errors.push({
        code: "review_finding_draft_set_no_findings_has_drafts",
        message: `${displayLabel} cannot carry drafts when normalization_status is no_findings_produced`
      });
    }
    if (value.no_findings_statement !== "No findings were produced by the configured inputs") {
      errors.push({
        code: "review_finding_draft_set_no_findings_statement_required",
        message: `${displayLabel} must use claim-safe no-findings wording`
      });
    }
    validateNoFindingsLimitations(value.normalization_limitations, errors, displayLabel);
  }

  if (value.normalization_status === "drafts_created" && value.review_finding_drafts.length === 0) {
    errors.push({
      code: "review_finding_draft_set_drafts_required",
      message: `${displayLabel} in drafts_created status must carry at least one draft`
    });
  }

  const draftIds = new Set();
  for (const [index, draft] of value.review_finding_drafts.entries()) {
    validateReviewFindingDraftSemantics(draft, index, value, draftIds, errors, displayLabel);
  }
}

function validateReviewFindingDraftSemantics(draft, index, draftSet, draftIds, errors, setLabel) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return;
  }

  const draftLabel = `${setLabel} draft ${index}`;
  if (draftIds.has(draft.review_finding_draft_id)) {
    errors.push({
      code: "review_finding_draft_duplicate_id",
      message: `${draftLabel} reuses review_finding_draft_id ${draft.review_finding_draft_id}`
    });
  }
  draftIds.add(draft.review_finding_draft_id);

  for (const field of REVIEW_FINDING_DRAFT_FORBIDDEN_FIELDS) {
    if (draft[field] !== undefined) {
      errors.push({
        code: "review_finding_draft_expert_field_forbidden",
        message: `${draftLabel} must not carry expert-only field ${field}`
      });
    }
  }

  if (draft.status !== "draft" || draft.review_lifecycle_state !== "under_review") {
    errors.push({
      code: "review_finding_draft_text_first_state_required",
      message: `${draftLabel} must expose text-first draft and under_review states`
    });
  }

  if (draft.coverage_mode !== draftSet.coverage_mode) {
    errors.push({
      code: "review_finding_draft_coverage_mode_mismatch",
      message: `${draftLabel} coverage_mode must match the containing normalization artifact`
    });
  }

  const candidateRefs = Array.isArray(draft.candidate_finding_refs) ? draft.candidate_finding_refs : [];
  if (candidateRefs.length === 0) {
    errors.push({
      code: "review_finding_draft_candidate_refs_required",
      message: `${draftLabel} must preserve at least one source Candidate Finding id`
    });
  }

  const evidenceBasis = Array.isArray(draft.evidence_basis) ? draft.evidence_basis : [];
  const thresholdGaps = Array.isArray(draft.threshold_gaps) ? draft.threshold_gaps : [];
  if (evidenceBasis.some((basis) => REVIEW_FINDING_DRAFT_INSUFFICIENT_BASIS.has(basis)) && thresholdGaps.length === 0) {
    errors.push({
      code: "review_finding_draft_threshold_gaps_required",
      message: `${draftLabel} must record threshold gaps for scanner-only, metadata-only, unavailable, or unresolved evidence basis`
    });
  }

  const evidenceRefs = Array.isArray(draft.evidence_refs) ? draft.evidence_refs : [];
  const derivedReferenceState = sourceReferenceStateForEvidenceRefs(evidenceRefs);
  if (derivedReferenceState !== undefined && draft.source_reference_state !== derivedReferenceState) {
    errors.push({
      code: "review_finding_draft_source_reference_state_mismatch",
      message: `${draftLabel} source_reference_state must reflect the least-available evidence reference state`
    });
  }

  // C7-30: unlike the downstream classification/outcome records (which bind
  // evidence_basis to evidence_refs via FINDING_CLASSIFICATION_BASIS_DRAFT_EVIDENCE_RULES),
  // the draft itself never checked this, so a draft could claim e.g.
  // extended_approved_source_context while carrying only scanner/unresolved refs.
  const consistentEvidenceRefs = evidenceRefs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref));
  if (evidenceBasis.length > 0 && !findingClassificationEvidenceBasisMatchesDraft(evidenceBasis, consistentEvidenceRefs)) {
    errors.push({
      code: "review_finding_draft_evidence_basis_not_bound_to_refs",
      message: `${draftLabel} evidence_basis must be supported by evidence_refs`
    });
  }

  for (const [evidenceIndex, evidenceRef] of evidenceRefs.entries()) {
    validateReviewFindingDraftEvidenceRef(evidenceRef, evidenceIndex, errors, draftLabel);
  }
}

function validateReviewFindingDraftEvidenceRef(evidenceRef, evidenceIndex, errors, draftLabel) {
  if (!evidenceRef || typeof evidenceRef !== "object" || Array.isArray(evidenceRef)) {
    return;
  }

  const evidenceLabel = `${draftLabel} evidence_ref ${evidenceIndex}`;
  if (REVIEW_FINDING_DRAFT_UNAVAILABLE_STATES.has(evidenceRef.availability_state) && evidenceRef.available_for_review === true) {
    errors.push({
      code: "review_finding_draft_deleted_evidence_shown_available",
      message: `${evidenceLabel} must not render unavailable source-derived content as available`
    });
  }

  if (evidenceRef.availability_state === "deleted_under_policy") {
    if (evidenceRef.display_state !== "deleted") {
      errors.push({
        code: "review_finding_draft_deleted_evidence_shown_available",
        message: `${evidenceLabel} deleted evidence must display as deleted`
      });
    }
    if (typeof evidenceRef.deletion_evidence_ref !== "string") {
      errors.push({
        code: "review_finding_draft_deleted_evidence_missing_proof",
        message: `${evidenceLabel} deleted evidence must reference deletion evidence when available`
      });
    }
  }

  if (evidenceRef.availability_state === "retained_review_artifact" && !evidenceRefDisplayIsConsistent(evidenceRef)) {
    errors.push({
      code: "review_finding_draft_retained_evidence_display_inconsistent",
      message: `${evidenceLabel} retained evidence must display as an available reference`
    });
  }
}

function validateNoFindingsLimitations(limitations, errors, label) {
  const text = Array.isArray(limitations) ? limitations.join(" ").toLowerCase() : "";
  if (!text.includes("does not prove absence of vulnerabilities")) {
    errors.push({
      code: "review_finding_draft_set_no_findings_limitation_required",
      message: `${label} must explicitly state that no-findings output does not prove absence of vulnerabilities`
    });
  }
}

function sourceReferenceStateForEvidenceRefs(evidenceRefs) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    return "unresolved_reference";
  }
  const priority = ["unresolved_reference", "deleted_under_policy", "not_submitted_by_policy", "never_collected", "retained_review_artifact"];
  for (const state of priority) {
    if (evidenceRefs.some((ref) => ref && typeof ref === "object" && ref.availability_state === state)) {
      return state;
    }
  }
  return undefined;
}

const FINDING_CLASSIFICATION_ALLOWED_VALUES = new Set([
  "likely",
  "confirmed",
  "inconclusive",
  "requires_customer_side_validation"
]);

const FINDING_CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS = new Set([
  "scanner_output",
  "metadata_only",
  "deleted_under_policy_reference",
  "not_submitted_by_policy_reference",
  "never_collected_reference",
  "unresolved_reference"
]);

const FINDING_CLASSIFICATION_FORBIDDEN_FIELDS = new Set([
  "remediation_implementation",
  "remediation_status",
  "customer_owner",
  "customer_status",
  "accepted_risk_record",
  "accepted_risk_rationale",
  "false_positive_rationale",
  "attestation_copy",
  "scanner_execution",
  "scanner_stdout",
  "scanner_stderr",
  "final_validation_script_body",
  "validation_script_body"
]);

const FINDING_CLASSIFICATION_TEXT_FIELDS = new Set([
  "rationale",
  "confirmation_criteria",
  "defensible_confirmation_criteria",
  "threshold_gaps",
  "limitations",
  "validation_path_summary",
  "validation_path_ref"
]);

const FINDING_CLASSIFICATION_BASIS_DRAFT_EVIDENCE_RULES = new Map([
  ["scanner_output", (ref) =>
    ref.artifact_ref === "artifact_ref:scanner_finding_set" &&
    ref.availability_state === "retained_review_artifact" &&
    ref.available_for_review === true &&
    ref.display_state === "available_reference"
  ],
  ["metadata_only", (ref) =>
    (ref.availability_state === "not_submitted_by_policy" && ref.display_state === "not_submitted") ||
    (ref.availability_state === "never_collected" && ref.display_state === "not_collected") ||
    (ref.availability_state === "retained_review_artifact" && ref.available_for_review === true && ref.display_state === "available_reference")
  ],
  // C7-31: this accepted any non-retained_review_artifact source class,
  // including customer_opt_in_retained_source — which should be reserved for
  // the extended_approved_source_context basis below — blurring retained
  // opt-in source with an ordinary scanner-derived finding-context snippet.
  ["finding_context_snippet", (ref) => ref.available_for_review === true && ref.display_state === "available_reference" && ref.source_derived_class === "transient_source_derived"],
  ["extended_approved_source_context", (ref) => ref.available_for_review === true && ref.display_state === "available_reference" && ref.source_derived_class === "customer_opt_in_retained_source"],
  ["retained_review_artifact", (ref) => ref.availability_state === "retained_review_artifact" && ref.available_for_review === true && ref.source_derived_class === "retained_review_artifact"],
  ["deleted_under_policy_reference", (ref) => ref.availability_state === "deleted_under_policy" && ref.display_state === "deleted" && typeof ref.deletion_evidence_ref === "string" && ref.deletion_evidence_ref.length > 0],
  ["not_submitted_by_policy_reference", (ref) => ref.availability_state === "not_submitted_by_policy" && ref.display_state === "not_submitted"],
  ["never_collected_reference", (ref) => ref.availability_state === "never_collected" && ref.display_state === "not_collected"],
  ["unresolved_reference", (ref) => ref.availability_state === "unresolved_reference" && ref.display_state === "unresolved_reference"]
]);

function isFindingClassificationRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.classification_record_id === "string" ||
        (typeof value.classification === "string" && typeof value.customer_status_record_id !== "string" && value.accepted_risk_record_id === undefined))
  );
}

function findingClassificationLabel(value, label) {
  return typeof value.classification_record_id === "string" && value.classification_record_id.length > 0
    ? `${label} ${value.classification_record_id}`
    : `${label} <missing classification_record_id>`;
}

export function validateFindingClassificationRecordSemantics(value, errors, label = "finding classification record") {
  if (!isFindingClassificationRecordLike(value)) {
    return;
  }

  const displayLabel = findingClassificationLabel(value, label);

  if (!FINDING_CLASSIFICATION_ALLOWED_VALUES.has(value.classification)) {
    errors.push({
      code: "finding_classification_allowed_taxonomy_required",
      message: `${displayLabel} must use only the allowed reviewer classification taxonomy`
    });
  }

  if (typeof value.review_finding_draft_ref !== "string") {
    errors.push({
      code: "finding_classification_draft_ref_required",
      message: `${displayLabel} must reference the Review Finding draft being classified`
    });
  }

  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer") {
    errors.push({
      code: "finding_classification_reviewer_actor_required",
      message: `${displayLabel} must be authored by a CodeAttest reviewer actor`
    });
  }

  const evidenceBasis = Array.isArray(value.evidence_basis) ? value.evidence_basis : [];
  if (evidenceBasis.length === 0) {
    errors.push({
      code: "finding_classification_evidence_basis_required",
      message: `${displayLabel} must preserve the evidence basis visible to the reviewer`
    });
  }

  const draftEvidenceRefs = Array.isArray(value.review_finding_draft_evidence_refs)
    ? value.review_finding_draft_evidence_refs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    : [];
  if (
    typeof value.review_finding_draft_ref === "string" &&
    (draftEvidenceRefs.length === 0 || !draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !findingClassificationEvidenceBasisMatchesDraft(evidenceBasis, draftEvidenceRefs))
  ) {
    errors.push({
      code: "finding_classification_evidence_basis_not_bound_to_draft",
      message: `${displayLabel} evidence_basis must be bound to the referenced draft evidence refs`
    });
  }
  if (
    draftEvidenceRefs.length > 0 &&
    !findingClassificationSourceReferenceStateMatchesDraft(value.source_reference_state, draftEvidenceRefs)
  ) {
    errors.push({
      code: "finding_classification_source_reference_state_mismatch",
      message: `${displayLabel} source_reference_state must reflect the least-available draft evidence reference state`
    });
  }

  const limitations = Array.isArray(value.limitations) ? value.limitations : [];
  if (limitations.length === 0) {
    errors.push({
      code: "finding_classification_limitations_required",
      message: `${displayLabel} must keep evidence limitations visible with the classification`
    });
  }

  for (const field of FINDING_CLASSIFICATION_FORBIDDEN_FIELDS) {
    if (value[field] !== undefined) {
      errors.push({
        code: "finding_classification_forbidden_field",
        message: `${displayLabel} must not carry ${field}; later workflow records own that state`
      });
    }
  }

  const criteria = Array.isArray(value.confirmation_criteria) ? value.confirmation_criteria : [];
  if (value.classification === "confirmed" && criteria.every((criterion) => !isMeaningfulClassificationText(criterion))) {
    errors.push({
      code: "finding_classification_confirmed_criteria_required",
      message: `${displayLabel} confirmed classification requires explicit confirmation criteria`
    });
  }

  const hasInsufficientBasis = evidenceBasis.some((basis) => FINDING_CLASSIFICATION_INSUFFICIENT_CONFIRMED_BASIS.has(basis));
  if (value.classification === "confirmed" && hasInsufficientBasis && !isMeaningfulClassificationText(value.defensible_confirmation_criteria)) {
    errors.push({
      code: "finding_classification_confirmed_defensible_criteria_required",
      message: `${displayLabel} confirmed scanner-only or metadata-only classification requires defensible threshold criteria`
    });
  }

  if (
    value.classification === "requires_customer_side_validation" &&
    !isMeaningfulClassificationText(value.validation_path_summary) &&
    typeof value.validation_path_ref !== "string"
  ) {
    errors.push({
      code: "finding_classification_validation_path_required",
      message: `${displayLabel} requires a validation path summary or reference`
    });
  }

  for (const field of FINDING_CLASSIFICATION_TEXT_FIELDS) {
    collectFindingClassificationTextViolations(value[field], field, displayLabel, errors);
  }
}

function findingClassificationEvidenceBasisMatchesDraft(evidenceBasis, draftEvidenceRefs) {
  for (const basis of evidenceBasis) {
    const rule = FINDING_CLASSIFICATION_BASIS_DRAFT_EVIDENCE_RULES.get(basis);
    if (rule && !draftEvidenceRefs.some(rule)) {
      return false;
    }
  }
  return true;
}

function draftEvidenceRefsAreConsistent(draftEvidenceRefs) {
  const statesByArtifact = new Map();
  for (const ref of draftEvidenceRefs) {
    if (ref.availability_state !== "retained_review_artifact" && (ref.available_for_review === true || ref.display_state === "available_reference")) {
      return false;
    }
    if (ref.availability_state === "deleted_under_policy" && !(typeof ref.deletion_evidence_ref === "string" && ref.deletion_evidence_ref.length > 0)) {
      return false;
    }
    if (typeof ref.artifact_ref === "string" && typeof ref.availability_state === "string") {
      const existing = statesByArtifact.get(ref.artifact_ref);
      if (existing !== undefined && existing !== ref.availability_state) {
        return false;
      }
      statesByArtifact.set(ref.artifact_ref, ref.availability_state);
    }
  }
  return true;
}

function findingClassificationSourceReferenceStateMatchesDraft(sourceReferenceState, draftEvidenceRefs) {
  return sourceReferenceState === sourceReferenceStateForEvidenceRefs(draftEvidenceRefs);
}

function isMeaningfulClassificationText(value) {
  return typeof value === "string" && /[a-z0-9]+/iu.test(value) && value.trim().split(/\s+/u).filter(Boolean).length >= 3 && value.trim().length >= 12;
}

function collectFindingClassificationTextViolations(value, field, label, errors) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    for (const phrase of SECRET_FORBIDDEN_PHRASES) {
      if (sharedForbiddenPhrasePresent(value, phrase)) {
        errors.push({
          code: "finding_classification_raw_source_text_forbidden",
          message: `${label} ${field} must not include raw source, scanner output, secrets, or token-like text`
        });
        return;
      }
    }
    if (customerVisibleTextForbidden(value) !== undefined) {
      errors.push({
        code: "finding_classification_claim_unsafe_text_forbidden",
        message: `${label} ${field} must not imply assurance, acceptance, certification, audit-readiness, security-guarantee, or absence-of-vulnerabilities claims`
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectFindingClassificationTextViolations(item, field, label, errors);
    }
  }
}

const REMEDIATION_GUIDANCE_ALLOWED_STATUSES = new Set([
  "actionable_guidance_provided",
  "limited_guidance_requires_validation",
  "guidance_unavailable_from_submitted_evidence"
]);

const REMEDIATION_GUIDANCE_TEXT_FIELDS = new Set([
  "exploitability_rationale",
  "suggested_remediation",
  "validation_steps",
  "insufficient_evidence_reason",
  "next_step_summary",
  "validation_path_summary",
  "validation_path_ref",
  "limitations"
]);

const CUSTOMER_REMEDIATION_STATUS_ALLOWED_VALUES = new Set([
  "not_started",
  "planned",
  "in_progress",
  "remediated_by_customer",
  "validation_pending",
  "deferred",
  "not_applicable"
]);

const CUSTOMER_STATUS_FORBIDDEN_FIELDS = new Set([
  "classification",
  "expert_classification",
  "reviewer_classification",
  "rationale",
  "reviewer_rationale",
  "remediation_rationale",
  "reviewer_remediation_rationale",
  "suggested_remediation",
  "validation_steps",
  "accepted_risk_record",
  "accepted_risk_rationale",
  "false_positive_rationale"
]);

const CUSTOMER_STATUS_TEXT_FIELDS = new Set([
  "owner",
  "target_state",
  "customer_notes"
]);

const CUSTOMER_FACING_FINDING_TEXT_FIELDS = new Set([
  "expert_classification.rationale_summary",
  "expert_classification.criteria_summary",
  "expert_classification.limitations",
  "evidence_basis.limitations",
  "reviewer_remediation_guidance.exploitability_rationale_summary",
  "reviewer_remediation_guidance.suggested_remediation_summary",
  "reviewer_remediation_guidance.validation_step_summary",
  "reviewer_remediation_guidance.next_step_summary",
  "reviewer_remediation_guidance.validation_path_summary",
  "reviewer_remediation_guidance.validation_path_ref",
  "reviewer_remediation_guidance.insufficient_evidence_reason",
  "reviewer_remediation_guidance.limitations",
  "customer_remediation_status.owner",
  "customer_remediation_status.target_state",
  "customer_remediation_status.customer_notes_summary",
  "verification_state.summary",
  "validation_paths.required_evidence",
  "validation_paths.steps",
  "validation_paths.expected_result",
  "validation_paths.limitations",
  "validation_paths.output_attachment_instructions",
  "validation_paths.target",
  "validation_paths.authorization_assumption",
  "validation_paths.method",
  "validation_paths.safety_constraints",
  "validation_paths.evidence_artifacts_to_collect",
  "reviewer_validation_scripts.purpose",
  "reviewer_validation_scripts.prerequisites",
  "reviewer_validation_scripts.execution_steps",
  "reviewer_validation_scripts.expected_output",
  "reviewer_validation_scripts.safety_notes",
  "reviewer_validation_scripts.output_attachment_instructions",
  "reviewer_validation_scripts.script_content",
  "reviewer_validation_scripts.pricing_note",
  "accepted_risk_outcome.evidence_basis_summary",
  "accepted_risk_outcome.customer_acceptance_summary",
  "accepted_risk_outcome.risk_owner",
  "accepted_risk_outcome.scope_of_acceptance",
  "accepted_risk_outcome.limitations",
  "false_positive_outcome.evidence_basis_summary",
  "false_positive_outcome.rationale_summary",
  "false_positive_outcome.limitations"
]);

function isFindingRemediationGuidanceLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.remediation_guidance_id === "string" || typeof value.guidance_status === "string")
  );
}

function remediationGuidanceLabel(value, label) {
  return typeof value.remediation_guidance_id === "string" && value.remediation_guidance_id.length > 0
    ? `${label} ${value.remediation_guidance_id}`
    : `${label} <missing remediation_guidance_id>`;
}

export function validateFindingRemediationGuidanceSemantics(value, errors, label = "finding remediation guidance") {
  if (!isFindingRemediationGuidanceLike(value)) {
    return;
  }

  const displayLabel = remediationGuidanceLabel(value, label);
  const classificationContext = value.classification_context && typeof value.classification_context === "object" && !Array.isArray(value.classification_context)
    ? value.classification_context
    : {};
  const classification = classificationContext.classification;
  const guidanceStatus = value.guidance_status;
  const evidenceRefs = Array.isArray(value.evidence_refs) ? value.evidence_refs : [];
  const limitations = Array.isArray(value.limitations) ? value.limitations : [];

  if (!REMEDIATION_GUIDANCE_ALLOWED_STATUSES.has(guidanceStatus)) {
    errors.push({
      code: "remediation_guidance_status_allowed_required",
      message: `${displayLabel} must use the bounded remediation guidance status vocabulary`
    });
  }

  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer") {
    errors.push({
      code: "remediation_guidance_reviewer_actor_required",
      message: `${displayLabel} must be authored by a CodeAttest reviewer actor`
    });
  }

  if (typeof value.classification_record_ref !== "string") {
    errors.push({
      code: "remediation_guidance_classification_ref_required",
      message: `${displayLabel} must reference the expert classification record it depends on`
    });
  }

  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "remediation_guidance_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }

  if (value.source_reference_state !== classificationContext.source_reference_state) {
    errors.push({
      code: "remediation_guidance_source_reference_state_mismatch",
      message: `${displayLabel} source_reference_state must match the referenced classification context`
    });
  }

  const draftEvidenceRefs = Array.isArray(value.review_finding_draft_evidence_refs)
    ? value.review_finding_draft_evidence_refs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    : [];
  if (draftEvidenceRefs.length > 0 && !draftEvidenceRefsAreConsistent(draftEvidenceRefs)) {
    errors.push({
      code: "remediation_guidance_evidence_ref_unbound",
      message: `${displayLabel} draft evidence refs must not make unavailable or unproven deleted evidence reviewable`
    });
  }
  const availableDraftArtifactRefs = new Set(draftEvidenceRefs
    .filter((ref) => ref.available_for_review === true && ref.display_state === "available_reference")
    .map((ref) => ref.artifact_ref)
    .filter((ref) => typeof ref === "string"));
  if (evidenceRefs.length > 0 && !evidenceRefs.every((ref) => availableDraftArtifactRefs.has(ref))) {
    errors.push({
      code: "remediation_guidance_evidence_ref_unbound",
      message: `${displayLabel} evidence_refs must be bound to available evidence refs from the classified draft`
    });
  }

  if (guidanceStatus === "actionable_guidance_provided") {
    if (classification === "inconclusive") {
      errors.push({
        code: "remediation_guidance_inconclusive_not_actionable",
        message: `${displayLabel} cannot mark inconclusive findings as actionable guidance`
      });
    }
    if (!isMeaningfulRemediationText(value.suggested_remediation) || !isMeaningfulRemediationText(value.validation_steps) || limitations.some((limitation) => !isMeaningfulRemediationText(limitation))) {
      errors.push({
        code: "remediation_guidance_actionable_details_required",
        message: `${displayLabel} actionable guidance requires remediation steps, validation steps, and visible limitations`
      });
    }
    if (evidenceRefs.length === 0) {
      errors.push({
        code: "remediation_guidance_evidence_ref_required",
        message: `${displayLabel} actionable guidance requires at least one supporting evidence reference`
      });
    }
    if ((classification === "likely" || classification === "confirmed") && !isMeaningfulRemediationText(value.exploitability_rationale)) {
      errors.push({
        code: "remediation_guidance_exploitability_rationale_required",
        message: `${displayLabel} likely or confirmed actionable guidance requires exploitability rationale scoped to submitted evidence`
      });
    }
    if (classification === "confirmed") {
      const criteria = Array.isArray(classificationContext.confirmation_criteria) ? classificationContext.confirmation_criteria : [];
      if (criteria.every((criterion) => !isMeaningfulRemediationText(criterion))) {
        errors.push({
          code: "remediation_guidance_confirmed_criteria_context_required",
          message: `${displayLabel} confirmed actionable guidance must preserve confirmation criteria context`
        });
      }
    }
  }

  if (guidanceStatus === "limited_guidance_requires_validation" || guidanceStatus === "guidance_unavailable_from_submitted_evidence") {
    if (!isMeaningfulRemediationText(value.insufficient_evidence_reason)) {
      errors.push({
        code: "remediation_guidance_insufficient_evidence_reason_required",
        message: `${displayLabel} limited or unavailable guidance requires a specific insufficient-evidence reason`
      });
    }
    if (
      !isMeaningfulRemediationText(value.next_step_summary) &&
      !isMeaningfulRemediationText(value.validation_path_summary) &&
      typeof value.validation_path_ref !== "string"
    ) {
      errors.push({
        code: "remediation_guidance_next_step_required",
        message: `${displayLabel} limited or unavailable guidance requires a next step or validation path handoff`
      });
    }
  }

  for (const field of REMEDIATION_GUIDANCE_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "remediation_guidance");
  }
}

const FALSE_POSITIVE_RECORD_TEXT_FIELDS = new Set([
  "rationale",
  "limitations"
]);

const ACCEPTED_RISK_RECORD_TEXT_FIELDS = new Set([
  "customer_rationale",
  "customer_signoff_summary",
  "risk_owner",
  "scope_of_acceptance",
  "limitations"
]);

function isFalsePositiveRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (
        typeof value.false_positive_record_id === "string" ||
        value.falsePositiveRecordId !== undefined ||
        value.candidate_finding_refs !== undefined
      )
  );
}

function falsePositiveRecordLabel(value, label) {
  return typeof value.false_positive_record_id === "string" && value.false_positive_record_id.length > 0
    ? `${label} ${value.false_positive_record_id}`
    : `${label} <missing false_positive_record_id>`;
}

export function validateFalsePositiveRecordSemantics(value, errors, label = "false-positive record") {
  if (!isFalsePositiveRecordLike(value)) {
    return;
  }

  const displayLabel = falsePositiveRecordLabel(value, label);
  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer") {
    errors.push({
      code: "false_positive_record_reviewer_actor_required",
      message: `${displayLabel} must be authored by a CodeAttest reviewer actor`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "false_positive_record_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  const evidenceBasis = Array.isArray(value.evidence_basis) ? value.evidence_basis : [];
  const draftEvidenceRefs = Array.isArray(value.review_finding_draft_evidence_refs)
    ? value.review_finding_draft_evidence_refs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    : [];
  if (evidenceBasis.length === 0 || draftEvidenceRefs.length === 0 || !draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !findingClassificationEvidenceBasisMatchesDraft(evidenceBasis, draftEvidenceRefs)) {
    errors.push({
      code: "false_positive_record_evidence_basis_required",
      message: `${displayLabel} evidence basis must be bound to the normalized Review Finding draft evidence refs`
    });
  }
  if (draftEvidenceRefs.length > 0 && !findingClassificationSourceReferenceStateMatchesDraft(value.source_reference_state, draftEvidenceRefs)) {
    errors.push({
      code: "false_positive_record_source_reference_state_mismatch",
      message: `${displayLabel} source_reference_state must reflect draft evidence availability`
    });
  }
  if (typeof value.review_finding_draft_ref !== "string") {
    errors.push({
      code: "false_positive_record_finding_ref_required",
      message: `${displayLabel} must preserve the affected Review Finding draft reference`
    });
  }
  if (typeof value.classification_record_ref !== "string") {
    errors.push({
      code: "false_positive_record_classification_ref_required",
      message: `${displayLabel} must preserve the reviewer classification reference it qualifies`
    });
  }
  if (!isMeaningfulRemediationText(value.rationale)) {
    errors.push({
      code: "false_positive_record_rationale_required",
      message: `${displayLabel} requires reviewer rationale`
    });
  }
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.some((limitation) => !isMeaningfulRemediationText(limitation))) {
    errors.push({
      code: "false_positive_record_limitations_required",
      message: `${displayLabel} must preserve outcome limitations`
    });
  }
  for (const field of FALSE_POSITIVE_RECORD_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "false_positive_record");
  }
}

function isAcceptedRiskRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (
        typeof value.accepted_risk_record_id === "string" ||
        value.customerRationale !== undefined ||
        value.customer_signoff_ref !== undefined ||
        value.customer_signoff_summary !== undefined
      )
  );
}

function acceptedRiskRecordLabel(value, label) {
  return typeof value.accepted_risk_record_id === "string" && value.accepted_risk_record_id.length > 0
    ? `${label} ${value.accepted_risk_record_id}`
    : `${label} <missing accepted_risk_record_id>`;
}

export function validateAcceptedRiskRecordSemantics(value, errors, label = "accepted-risk record") {
  if (!isAcceptedRiskRecordLike(value)) {
    return;
  }

  const displayLabel = acceptedRiskRecordLabel(value, label);
  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || !["customer_user", "reviewer", "vendor_service"].includes(value.actor.actor_type)) {
    errors.push({
      code: "accepted_risk_record_actor_required",
      message: `${displayLabel} must preserve the recorder actor when available`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "accepted_risk_record_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  const hasCustomerRationale = isMeaningfulRemediationText(value.customer_rationale);
  const hasCustomerSignoff = typeof value.customer_signoff_ref === "string" || isMeaningfulRemediationText(value.customer_signoff_summary);
  if (!hasCustomerRationale && !hasCustomerSignoff) {
    errors.push({
      code: "accepted_risk_record_customer_acceptance_required",
      message: `${displayLabel} requires customer rationale or customer sign-off evidence`
    });
  }
  if (value.actor?.actor_type !== "customer_user" && !hasCustomerRationale && !hasCustomerSignoff) {
    errors.push({
      code: "accepted_risk_record_customer_acceptance_required",
      message: `${displayLabel} non-customer recorders must include explicit customer rationale or sign-off evidence`
    });
  }
  if (typeof value.review_finding_draft_ref !== "string") {
    errors.push({
      code: "accepted_risk_record_finding_ref_required",
      message: `${displayLabel} must preserve the affected Review Finding draft reference`
    });
  }
  if (typeof value.classification_record_ref !== "string") {
    errors.push({
      code: "accepted_risk_record_classification_ref_required",
      message: `${displayLabel} must preserve the expert classification reference without rewriting it`
    });
  }
  const evidenceBasis = Array.isArray(value.evidence_basis) ? value.evidence_basis : [];
  const draftEvidenceRefs = Array.isArray(value.review_finding_draft_evidence_refs)
    ? value.review_finding_draft_evidence_refs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    : [];
  if (evidenceBasis.length === 0 || draftEvidenceRefs.length === 0) {
    errors.push({
      code: "accepted_risk_record_evidence_basis_unbound",
      message: `${displayLabel} must preserve evidence basis and draft evidence refs`
    });
  }
  if (draftEvidenceRefs.length > 0 && (!draftEvidenceRefsAreConsistent(draftEvidenceRefs) || !findingClassificationEvidenceBasisMatchesDraft(evidenceBasis, draftEvidenceRefs))) {
    errors.push({
      code: "accepted_risk_record_evidence_basis_unbound",
      message: `${displayLabel} evidence basis must match normalized draft evidence refs when present`
    });
  }
  if (draftEvidenceRefs.length > 0 && !findingClassificationSourceReferenceStateMatchesDraft(value.source_reference_state, draftEvidenceRefs)) {
    errors.push({
      code: "accepted_risk_record_source_reference_state_mismatch",
      message: `${displayLabel} source_reference_state must reflect draft evidence availability`
    });
  }
  if (typeof value.review_by_date === "string" && !isIsoCalendarDate(value.review_by_date)) {
    errors.push({
      code: "accepted_risk_record_review_by_date_invalid",
      message: `${displayLabel} review_by_date must be a valid ISO calendar date`
    });
  }
  if (!Array.isArray(value.limitations) || value.limitations.length === 0 || value.limitations.some((limitation) => !isMeaningfulRemediationText(limitation))) {
    errors.push({
      code: "accepted_risk_record_limitations_required",
      message: `${displayLabel} must preserve accepted-risk limitations`
    });
  }
  for (const forbiddenField of ["classification", "expert_classification", "customer_remediation_status", "verification_state", "verified", "fixed", "remediated"]) {
    if (value[forbiddenField] !== undefined) {
      errors.push({
        code: "accepted_risk_record_rewrite_forbidden",
        message: `${displayLabel} must not carry ${forbiddenField}; accepted risk does not rewrite classification, remediation, or verification state`
      });
    }
  }
  for (const field of ACCEPTED_RISK_RECORD_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "accepted_risk_record");
    if (acceptedRiskTextHasPositiveClosureClaim(value[field])) {
      errors.push({
        code: "accepted_risk_record_claim_unsafe_text_forbidden",
        message: `${displayLabel} ${field} must not imply fixed, verified, remediated, or resolved status`
      });
    }
  }
}

// C7-11: this used to run the negation check over the *whole string*, so any
// negated closure phrase anywhere suppressed detection of an unrelated,
// genuinely unsafe positive claim elsewhere in the same string -- e.g. "This
// is not fixed. It is verified by customer acceptance." has an unrelated
// second-sentence positive closure claim that must still be caught. Mirrors
// the same clause-splitting fix applied to packages/ui/src/customer-finding-record.ts
// and packages/static-bundle/src/index.ts under C6-12 -- keep all three in sync.
function acceptedRiskTextHasPositiveClosureClaim(value) {
  if (Array.isArray(value)) {
    return value.some((item) => acceptedRiskTextHasPositiveClosureClaim(item));
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  const terminalWords = ["complete", "completed", "accepted", "approved", "done"].join("|");
  const positiveClaimPattern = new RegExp(`\\b(?:is|was|has been|now|already|considered|marked)\\s+(?:fixed|verified|remediated|resolved)\\b|\\b(?:fixed|verified|remediated|resolved)\\s+(?:by|with|for)\\b|\\b(?:remediation|verification)\\s+(?:${terminalWords})\\b|\\bresolved\\s+pending\\s+retest\\b`, "u");
  const safeNegatedPattern = new RegExp(`\\b(?:not|no|never|without|does not|do not|cannot|is not|was not|has not been)\\s+(?:[^.!?]{0,40}\\s)?(?:fixed|verified|remediated|resolved|${terminalWords})\\b`, "u");
  const clauses = normalized.split(/[.!?;\n]+/u);
  return clauses.some((clause) => positiveClaimPattern.test(clause) && !safeNegatedPattern.test(clause));
}

async function validateOutcomeRecordFixtureReferenceSemantics(value, options, errors) {
  if (!isFalsePositiveRecordLike(value) && !isAcceptedRiskRecordLike(value)) {
    return;
  }
  if (typeof options.fixtureRoot !== "string" || typeof value.classification_record_ref !== "string") {
    return;
  }
  const classifications = await loadFindingClassificationsByRecordRef(options.fixtureRoot);
  const classification = classifications.get(value.classification_record_ref);
  if (classification === undefined) {
    // C7-32: this used to return silently when the ref didn't resolve, so an
    // outcome record detached from any real expert classification history
    // (fabricated or dangling classification_record_ref) passed this check
    // vacuously instead of being rejected.
    errors.push({
      code: isFalsePositiveRecordLike(value) ? "false_positive_record_reference_mismatch" : "accepted_risk_record_reference_mismatch",
      message: `${value.classification_record_ref} outcome record must reference a known classification fixture`
    });
    return;
  }

  const referenceMismatch =
    value.review_id !== classification.review_id ||
    value.review_finding_draft_ref !== classification.review_finding_draft_ref ||
    canonicalize(value.review_finding_draft_evidence_refs) !== canonicalize(classification.review_finding_draft_evidence_refs);

  if (referenceMismatch) {
    errors.push({
      code: isFalsePositiveRecordLike(value) ? "false_positive_record_reference_mismatch" : "accepted_risk_record_reference_mismatch",
      message: `${value.classification_record_ref} outcome record must bind to the referenced classification review, finding draft, and draft evidence refs`
    });
  }
}

async function loadFindingClassificationsByRecordRef(fixtureRoot) {
  const classifications = new Map();
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return classifications;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith("finding-classification-record")) {
      continue;
    }
    try {
      const classification = await readJson(file);
      if (isFindingClassificationRecordLike(classification) && typeof classification.classification_record_id === "string") {
        classifications.set(classification.classification_record_id, classification);
      }
    } catch {
      // Broken fixtures are reported through the normal fixture validation path.
    }
  }
  return classifications;
}

const VALIDATION_PATH_TEXT_FIELDS = new Set([
  "required_evidence",
  "steps",
  "expected_result",
  "limitations",
  "target",
  "authorization_assumption",
  "method",
  "safety_constraints",
  "output_attachment_instructions"
]);

const VALIDATION_SCRIPT_TEXT_FIELDS = new Set([
  "purpose",
  "prerequisites",
  "execution_steps",
  "expected_output",
  "safety_notes",
  "output_attachment_instructions",
  "script_content"
]);

function isFindingValidationPathLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.validation_path_id === "string" || typeof value.path_type === "string")
  );
}

function validationPathLabel(value, label) {
  return typeof value.validation_path_id === "string" && value.validation_path_id.length > 0
    ? `${label} ${value.validation_path_id}`
    : `${label} <missing validation_path_id>`;
}

export function validateFindingValidationPathSemantics(value, errors, label = "finding validation path") {
  if (!isFindingValidationPathLike(value)) {
    return;
  }

  const displayLabel = validationPathLabel(value, label);
  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer") {
    errors.push({
      code: "validation_path_reviewer_actor_required",
      message: `${displayLabel} must be authored by a CodeAttest reviewer actor`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "validation_path_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  const draftEvidenceRefs = Array.isArray(value.review_finding_draft_evidence_refs)
    ? value.review_finding_draft_evidence_refs.filter((ref) => ref && typeof ref === "object" && !Array.isArray(ref))
    : [];
  if (draftEvidenceRefs.length > 0 && !draftEvidenceRefsAreConsistent(draftEvidenceRefs)) {
    errors.push({
      code: "validation_path_evidence_ref_unbound",
      message: `${displayLabel} draft evidence refs must not make unavailable or unproven deleted evidence reviewable`
    });
  }
  if (draftEvidenceRefs.length > 0 && !findingClassificationSourceReferenceStateMatchesDraft(value.source_reference_state, draftEvidenceRefs)) {
    errors.push({
      code: "validation_path_source_reference_state_mismatch",
      message: `${displayLabel} source_reference_state must match draft evidence availability state`
    });
  }
  const hasRemoteSpecificFields = value.target !== undefined || value.authorization_assumption !== undefined || value.method !== undefined || value.safety_constraints !== undefined || value.evidence_artifacts_to_collect !== undefined;
  if (value.path_type === "remote_dynamic_testing") {
    for (const field of ["target", "authorization_assumption", "method", "safety_constraints"]) {
      if (!isMeaningfulRemediationText(value[field])) {
        errors.push({
          code: "validation_path_remote_authorization_required",
          message: `${displayLabel} remote dynamic testing requires ${field}`
        });
        break;
      }
    }
    if (!Array.isArray(value.evidence_artifacts_to_collect) || value.evidence_artifacts_to_collect.length === 0) {
      errors.push({
        code: "validation_path_remote_authorization_required",
        message: `${displayLabel} remote dynamic testing requires evidence artifacts to collect`
      });
    }
  } else if (hasRemoteSpecificFields) {
    errors.push({
      code: "validation_path_branch_field_forbidden",
      message: `${displayLabel} non-remote validation paths must not carry remote dynamic testing fields`
    });
  }
  if (value.path_type === "customer_run_script") {
    if (!Array.isArray(value.reviewer_validation_script_refs) || value.reviewer_validation_script_refs.length === 0) {
      errors.push({
        code: "validation_path_script_ref_required",
        message: `${displayLabel} customer-run script paths must reference reviewer-authored validation scripts`
      });
    }
  } else if (value.reviewer_validation_script_refs !== undefined) {
    errors.push({
      code: "validation_path_branch_field_forbidden",
      message: `${displayLabel} non-script validation paths must not carry reviewer validation script refs`
    });
  }
  if (value.path_type === "manual_steps" && !isMeaningfulRemediationText(value.output_attachment_instructions)) {
    errors.push({
      code: "validation_path_manual_attachment_instructions_required",
      message: `${displayLabel} manual-step paths must include output attachment instructions`
    });
  }
  for (const field of VALIDATION_PATH_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "validation_path");
  }
}

function isReviewerValidationScriptLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.validation_script_id === "string" || typeof value.script_package_status === "string")
  );
}

function validationScriptLabel(value, label) {
  return typeof value.validation_script_id === "string" && value.validation_script_id.length > 0
    ? `${label} ${value.validation_script_id}`
    : `${label} <missing validation_script_id>`;
}

export function validateReviewerValidationScriptPackageSemantics(values, errors, label = "reviewer validation script package") {
  const scriptsByReview = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (!isReviewerValidationScriptLike(value) || value.script_package_status !== "included_base_package") {
      continue;
    }
    const reviewId = typeof value.review_id === "string" ? value.review_id : "<missing review_id>";
    const scripts = scriptsByReview.get(reviewId) ?? [];
    scripts.push(value);
    scriptsByReview.set(reviewId, scripts);
  }
  for (const [reviewId, scripts] of scriptsByReview) {
    if (scripts.length > 3) {
      errors.push({
        code: "validation_script_included_cap_exceeded",
        message: `${label} ${reviewId} must not allocate more than 3 included base-package scripts`
      });
    }
    const slots = new Set();
    for (const script of scripts) {
      if (!Number.isInteger(script.included_script_slot)) {
        continue;
      }
      if (slots.has(script.included_script_slot)) {
        errors.push({
          code: "validation_script_included_cap_exceeded",
          message: `${label} ${reviewId} must not reuse included script slot ${script.included_script_slot}`
        });
      }
      slots.add(script.included_script_slot);
    }
  }
}

export function validateReviewerValidationScriptSemantics(value, errors, label = "reviewer validation script") {
  if (!isReviewerValidationScriptLike(value)) {
    return;
  }

  const displayLabel = validationScriptLabel(value, label);
  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "reviewer") {
    errors.push({
      code: "validation_script_reviewer_actor_required",
      message: `${displayLabel} must be authored by a CodeAttest reviewer actor`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "validation_script_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  if (value.script_package_status === "included_base_package") {
    if (!Number.isInteger(value.included_script_slot) || value.included_script_slot < 1 || value.included_script_slot > 3) {
      errors.push({
        code: "validation_script_included_slot_required",
        message: `${displayLabel} included base-package scripts require included_script_slot 1..3`
      });
    }
  }
  if (value.script_package_status === "additional_script_candidate_pricing_tbd") {
    if (value.included_script_slot !== undefined) {
      errors.push({
        code: "validation_script_additional_slot_forbidden",
        message: `${displayLabel} additional-script candidates must not consume an included script slot`
      });
    }
    const joinedCopy = [value.purpose, value.prerequisites, value.execution_steps, value.expected_output, value.safety_notes, value.output_attachment_instructions, value.script_content].filter((item) => typeof item === "string").join(" ");
    if (!/pricing\s+tbd/iu.test(joinedCopy)) {
      errors.push({
        code: "validation_script_pricing_tbd_required",
        message: `${displayLabel} additional-script candidates must preserve pricing TBD copy`
      });
    }
  }
  for (const field of VALIDATION_SCRIPT_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "validation_script");
  }
}

const VERIFICATION_SCOPE_ALLOWED_REQUEST_TYPES = new Set([
  "follow_up_commit",
  "customer_validation_evidence",
  "reviewer_authored_script_output",
  "manual_validation_record",
  "remote_dynamic_testing_evidence"
]);

const VERIFICATION_SCOPE_ALLOWED_ELIGIBILITY_STATES = new Set([
  "eligible",
  "out_of_scope",
  "requires_additional_agreement",
  "blocked_pending_validation_path"
]);

const VERIFICATION_SCOPE_FORBIDDEN_FIELDS = new Set([
  "follow_up_commit_ref",
  "follow_up_commit",
  "uploaded_validation_evidence_ref",
  "validation_evidence_ref",
  "before_after_outcome",
  "before_after_decision",
  "verification_complete",
  "verified_with_evidence",
  "verification_decision",
  "addendum_ref",
  "attestation_addendum_ref",
  "fixed",
  "resolved",
  "remediated",
  "accepted_risk_record",
  "false_positive_record"
]);

const VERIFICATION_SCOPE_TEXT_FIELDS = new Set([
  "included_pass_start_basis",
  "limitations",
  "selected_findings.eligibility_reason",
  "selected_findings.limitations",
  "included_script_allocation.additional_script_candidates.reason"
]);

function isVerificationPassScopeLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (Array.isArray(value.selected_findings) || value.included_script_allocation !== undefined || value.scope_recorded_at !== undefined || value.pass_deadline !== undefined)
  );
}

function verificationPassScopeLabel(value, label) {
  return typeof value.verification_pass_id === "string" && value.verification_pass_id.length > 0
    ? `${label} ${value.verification_pass_id}`
    : `${label} <missing verification_pass_id>`;
}

function verificationScopeActorIsForbiddenMachine(actor) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    return false;
  }
  const actorType = String(actor.actor_type ?? "").toLowerCase();
  const actorId = String(actor.actor_id ?? "").toLowerCase();
  if (["local_runner", "local-runner", "runner", "worker", "scanner", "static_bundle", "static-bundle"].includes(actorType)) {
    return true;
  }
  return actorId.split(":").some((segment) => verificationScopeActorSegmentIsForbiddenMachine(segment));
}

function verificationScopeActorSegmentIsForbiddenMachine(segment) {
  return /^(?:local[_-]?runner(?:[_-].+|\d+)?|runner(?:[_-].+|\d+)?|worker(?:pool(?:[_-].+|\d+)?|[_-].+|\d+)?|scanner(?:[_-].+|\d+)?|static[_-]?bundle(?:[_-].+|\d+)?)$/u.test(segment);
}

export function validateVerificationPassScopeSemantics(value, errors, label = "verification pass scope") {
  if (!isVerificationPassScopeLike(value)) {
    return;
  }

  const displayLabel = verificationPassScopeLabel(value, label);
  const actorType = value.actor && typeof value.actor === "object" && !Array.isArray(value.actor) ? value.actor.actor_type : undefined;
  if (!["customer_user", "reviewer", "vendor_service"].includes(actorType)) {
    errors.push({
      code: "verification_scope_actor_authority_required",
      message: `${displayLabel} must be customer-authored or explicitly customer-backed when recorded by reviewer/vendor actors`
    });
  }
  if (actorType !== "customer_user" && !isNonBlankString(value.customer_actor_ref) && !isNonBlankString(value.customer_selection_evidence_ref)) {
    errors.push({
      code: "verification_scope_customer_backing_required",
      message: `${displayLabel} reviewer/vendor/service actors must carry customer-backed selection provenance`
    });
  }
  if (verificationScopeActorIsForbiddenMachine(value.actor)) {
    errors.push({
      code: "verification_scope_actor_authority_required",
      message: `${displayLabel} must not be authored by local-runner, worker, scanner, or static-bundle machine identities`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "verification_scope_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }

  const selectedFindings = Array.isArray(value.selected_findings)
    ? value.selected_findings.filter((finding) => finding && typeof finding === "object" && !Array.isArray(finding))
    : [];
  if (selectedFindings.length === 0) {
    errors.push({
      code: "verification_scope_selected_findings_required",
      message: `${displayLabel} must include at least one selected Review Finding draft`
    });
  }

  const start = parseUtcTimestampNs(value.included_pass_started_at);
  const recorded = parseUtcTimestampNs(value.scope_recorded_at);
  const deadline = parseUtcTimestampNs(value.pass_deadline);
  if (start === undefined || recorded === undefined || deadline === undefined) {
    errors.push({
      code: "verification_scope_deadline_outside_included_window",
      message: `${displayLabel} included-pass timestamps must be calendar-valid UTC RFC 3339 values`
    });
  } else {
    const thirtyDaysNs = 30n * 24n * 60n * 60n * 1_000_000_000n;
    const deadlineDelta = deadline - start;
    if (deadlineDelta <= 0n || deadlineDelta > thirtyDaysNs || recorded < start || recorded > deadline) {
      errors.push({
        code: "verification_scope_deadline_outside_included_window",
        message: `${displayLabel} pass_deadline and scope_recorded_at must stay inside the positive 30-day included-pass window`
      });
    }
  }
  const startBasis = typeof value.included_pass_start_basis === "string" ? value.included_pass_start_basis.toLowerCase() : "";
  const limitationText = joinedLower(value.limitations);
  const uncertainStartBasis = /unavailable|unknown|estimated|fallback|basis used/u.test(startBasis);
  const slaPromise = /(?:guaranteed|committed|assured|contractual|promised).{0,40}(?:within|in|delivery|deadline)?\s*30\s*days|30\s*days.{0,40}(?:guaranteed|committed|assured|contractual|promised|delivery|deadline)|\b30-day\s*sla\b|\bcontractual\s+30-day\s+sla\b|\bpromised\s+delivery\s+within\s+30\s+days\b/u.test(`${startBasis} ${limitationText}`);
  if (slaPromise || (uncertainStartBasis && !/basis|deadline|included pass|30 days|sla/u.test(limitationText))) {
    errors.push({
      code: "verification_scope_deadline_basis_limitation_required",
      message: `${displayLabel} uncertain included-pass start basis must be preserved as a limitation without implying an SLA`
    });
  }

  const allocation = value.included_script_allocation && typeof value.included_script_allocation === "object" && !Array.isArray(value.included_script_allocation)
    ? value.included_script_allocation
    : {};
  const includedSlots = Array.isArray(allocation.included_slots)
    ? allocation.included_slots.filter((slot) => slot && typeof slot === "object" && !Array.isArray(slot))
    : [];
  const includedScriptCapExceeded = includedSlots.length > 3;
  if (includedScriptCapExceeded) {
    errors.push({
      code: "verification_scope_included_script_cap_exceeded",
      message: `${displayLabel} must not allocate more than 3 included Validation Script slots`
    });
  }
  const slotNumbers = new Set();
  if (!includedScriptCapExceeded) {
    for (const slot of includedSlots) {
      if (!Number.isInteger(slot.slot) || slot.slot < 1 || slot.slot > 3 || slotNumbers.has(slot.slot)) {
        errors.push({
          code: "verification_scope_included_script_slot_duplicate",
          message: `${displayLabel} included Validation Script slots must be unique integers 1..3`
        });
        break;
      }
      slotNumbers.add(slot.slot);
    }
  }
  const additionalCandidates = Array.isArray(allocation.additional_script_candidates)
    ? allocation.additional_script_candidates.filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate))
    : [];
  for (const candidate of additionalCandidates) {
    if (candidate.pricing_posture !== "pricing_tbd" || !/pricing\s*tbd/iu.test(`${candidate.reason ?? ""} ${candidate.pricing_posture ?? ""}`)) {
      errors.push({
        code: "verification_scope_additional_script_pricing_tbd_required",
        message: `${displayLabel} additional script candidates must be marked separately with pricing TBD posture`
      });
    }
  }
  const allocationEntries = [...includedSlots, ...additionalCandidates];
  const allocationScriptRefs = new Set();
  if (!includedScriptCapExceeded) for (const allocationEntry of allocationEntries) {
    if (typeof allocationEntry.validation_script_ref !== "string" || allocationScriptRefs.has(allocationEntry.validation_script_ref)) {
      errors.push({
        code: "verification_scope_script_allocation_ref_mismatch",
        message: `${displayLabel} script allocation validation_script_ref values must be present and unique across included and additional entries`
      });
      break;
    }
    allocationScriptRefs.add(allocationEntry.validation_script_ref);
  }
  const selectedFindingRefs = new Set(selectedFindings.map((finding) => finding.review_finding_draft_ref).filter((ref) => typeof ref === "string"));
  if (selectedFindingRefs.size !== selectedFindings.length) {
    errors.push({
      code: "verification_scope_reference_mismatch",
      message: `${displayLabel} selected finding draft refs must be unique`
    });
  }
  if (!includedScriptCapExceeded) {
    const selectedScriptRefsAcrossScope = new Set();
    for (const finding of selectedFindings) {
      for (const scriptRef of Array.isArray(finding.reviewer_validation_script_refs) ? finding.reviewer_validation_script_refs : []) {
        if (selectedScriptRefsAcrossScope.has(scriptRef)) {
          errors.push({
            code: "verification_scope_script_allocation_ref_mismatch",
            message: `${displayLabel} selected reviewer_validation_script_refs must be unique across the scope`
          });
        }
        selectedScriptRefsAcrossScope.add(scriptRef);
      }
    }
    for (const allocationEntry of allocationEntries) {
      if (typeof allocationEntry.finding_ref !== "string" || !selectedFindingRefs.has(allocationEntry.finding_ref)) {
        errors.push({
          code: "verification_scope_script_allocation_ref_mismatch",
          message: `${displayLabel} script allocation entries must reference a selected finding`
        });
      }
      const selectedFinding = selectedFindings.find((finding) => finding.review_finding_draft_ref === allocationEntry.finding_ref);
      const selectedScriptRefs = new Set(Array.isArray(selectedFinding?.reviewer_validation_script_refs) ? selectedFinding.reviewer_validation_script_refs : []);
      if (typeof allocationEntry.validation_script_ref !== "string" || !selectedScriptRefs.has(allocationEntry.validation_script_ref)) {
        errors.push({
          code: "verification_scope_script_allocation_ref_mismatch",
          message: `${displayLabel} script allocation validation_script_ref must be referenced by the same selected finding`
        });
      }
    }
    if (allocationScriptRefs.size !== selectedScriptRefsAcrossScope.size) {
      errors.push({
        code: "verification_scope_script_allocation_ref_mismatch",
        message: `${displayLabel} every selected reviewer_validation_script_ref must be allocated exactly once`
      });
    }
  }

  for (const [index, finding] of selectedFindings.entries()) {
    const findingLabel = `${displayLabel} selected finding ${index}`;
    if (typeof finding.classification_record_ref !== "string") {
      errors.push({
        code: "verification_scope_classification_binding_required",
        message: `${findingLabel} must preserve classification_record_ref`
      });
    }
    if (typeof finding.review_finding_draft_ref !== "string") {
      errors.push({
        code: "verification_scope_finding_binding_required",
        message: `${findingLabel} must preserve review_finding_draft_ref`
      });
    }
    if (!VERIFICATION_SCOPE_ALLOWED_REQUEST_TYPES.has(finding.requested_verification_type)) {
      errors.push({
        code: "verification_scope_request_type_allowed_required",
        message: `${findingLabel} must use the bounded requested verification type vocabulary`
      });
    }
    if (!VERIFICATION_SCOPE_ALLOWED_ELIGIBILITY_STATES.has(finding.eligibility_state)) {
      errors.push({
        code: "verification_scope_eligibility_state_allowed_required",
        message: `${findingLabel} must use the bounded eligibility state vocabulary`
      });
    }
    if (!isMeaningfulVerificationScopeReason(finding.eligibility_reason)) {
      errors.push({
        code: "verification_scope_eligibility_reason_required",
        message: `${findingLabel} must record a specific eligibility reason or next step`
      });
    }
    if (!Array.isArray(finding.limitations) || finding.limitations.length === 0 || finding.limitations.some((limitation) => !isMeaningfulVerificationScopeReason(limitation))) {
      errors.push({
        code: "verification_scope_limitations_required",
        message: `${findingLabel} must keep per-finding scope limitations visible`
      });
    }
    if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && typeof finding.validation_path_ref !== "string") {
      errors.push({
        code: "verification_scope_validation_path_required_for_eligible",
        message: `${findingLabel} requires a formal validation path before it can be eligible`
      });
    }
    if (finding.eligibility_state === "blocked_pending_validation_path" && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) {
      errors.push({
        code: "verification_scope_blocked_next_step_required",
        message: `${findingLabel} blocked pending validation path must include a specific next step`
      });
    }
    if (finding.eligibility_state === "requires_additional_agreement" && !verificationScopeReasonHasSpecificNextStep(finding.eligibility_reason)) {
      errors.push({
        code: "verification_scope_additional_agreement_next_step_required",
        message: `${findingLabel} requires additional agreement must include a specific next step`
      });
    }
    if ((typeof finding.false_positive_record_ref === "string" || typeof finding.accepted_risk_record_ref === "string") && finding.eligibility_state !== "out_of_scope") {
      const hasCustomerBackedNewPath = typeof finding.validation_path_ref === "string" && finding.requested_verification_type !== "follow_up_commit";
      if (!hasCustomerBackedNewPath) {
        errors.push({
          code: "verification_scope_outcome_default_out_of_scope_required",
          message: `${findingLabel} false-positive or accepted-risk outcomes must remain visible and default out of scope unless a new formal verification path is selected`
        });
      }
    }
  }

  for (const field of VERIFICATION_SCOPE_FORBIDDEN_FIELDS) {
    if (value[field] !== undefined || selectedFindings.some((finding) => finding[field] !== undefined)) {
      errors.push({
        code: "verification_scope_story_4_1_field_forbidden",
        message: `${displayLabel} must not carry ${field}; follow-up evidence, decisions, and addenda belong to later Epic 4 stories`
      });
    }
  }
  for (const field of VERIFICATION_SCOPE_TEXT_FIELDS) {
    for (const textValue of valuesAtPath(value, field)) {
      collectVerificationScopeTextViolations(textValue, field, displayLabel, errors);
    }
  }
}

function isVerificationEvidenceRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (typeof value.verification_evidence_record_id === "string" || value.requested_verification_type !== undefined));
}

export function validateVerificationEvidenceRecordSemantics(value, errors, label = "verification evidence record") {
  if (!isVerificationEvidenceRecordLike(value)) return;
  const displayLabel = `${label} ${value.verification_evidence_record_id ?? "<missing id>"}`;
  const actorType = value.actor && typeof value.actor === "object" && !Array.isArray(value.actor) ? value.actor.actor_type : undefined;
  if (!['customer_user', 'vendor_service'].includes(actorType)) errors.push({ code: "verification_evidence_actor_authority_required", message: `${displayLabel} requires customer/customer-backed authority` });
  if (actorType === "vendor_service" && !isNonBlankString(value.customer_actor_ref)) errors.push({ code: "verification_evidence_customer_backing_required", message: `${displayLabel} vendor service requires customer_actor_ref` });
  if (value.access_scope?.review_scope !== value.review_id) errors.push({ code: "verification_evidence_access_scope_mismatch", message: `${displayLabel} access scope must equal review id` });
  // C7-09: verification_pass_id and verification_pass_ref were never
  // required to agree, so evidence could be attributed to a different
  // verification pass instance than the one it claims to target.
  if (value.verification_pass_id !== value.verification_pass_ref) errors.push({ code: "verification_evidence_reference_mismatch", message: `${displayLabel} verification_pass_id must equal verification_pass_ref` });
  const commitType = value.requested_verification_type === "follow_up_commit";
  if (commitType) {
    if (!value.follow_up_commit) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} follow-up commit evidence requires commit metadata` });
    if (value.validation_path_ref !== undefined || value.reviewer_validation_script_ref !== undefined || value.validation_artifacts !== undefined) errors.push({ code: "verification_evidence_type_fields_mismatch", message: `${displayLabel} commit evidence must not carry validation fields` });
    const commit = value.follow_up_commit;
    const sameCommit = commit?.follow_up_commit?.commit_sha !== undefined && commit.follow_up_commit.commit_sha === commit.original_selected_commit?.commit_sha;
    const sameRepository = commit?.follow_up_repository_identity !== undefined && commit.follow_up_repository_identity === commit.original_repository_identity;
    if (commit?.relationship_to_selected_commit === "same_commit_submitted" && (!sameCommit || value.intake_state !== "verification_pending" || !isMeaningfulRemediationText(value.next_step_summary))) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} same commit must remain pending with next step` });
    if (commit?.relationship_to_selected_commit === "repository_mismatch" && (sameRepository || value.intake_state !== "broader_context_required" || !isMeaningfulRemediationText(value.next_step_summary))) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} repository mismatch requires broader context and next step` });
    // C7-10: the two checks above only enforce the POSITIVE sentinel
    // branches. Without the inverse, a record could label the relationship
    // "customer_declared_related" (no dedicated check) while the SHAs are
    // actually identical, or preserve repository identity while still
    // claiming "customer_declared_related"/"customer_declared_descendant"
    // for what is really a repository_mismatch case.
    if (commit?.relationship_to_selected_commit !== undefined) {
      if (commit.relationship_to_selected_commit !== "same_commit_submitted" && sameCommit) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} identical commit SHAs must use relationship same_commit_submitted` });
      if (["customer_declared_related", "customer_declared_descendant"].includes(commit.relationship_to_selected_commit) && sameCommit) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} related/descendant relationships require non-identical commit SHAs` });
      if (commit.relationship_to_selected_commit !== "repository_mismatch" && !sameRepository) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} differing repository identities must use relationship repository_mismatch` });
      if (commit.relationship_to_selected_commit === "repository_mismatch" && sameRepository) errors.push({ code: "verification_evidence_commit_context_invalid", message: `${displayLabel} repository_mismatch requires differing repository identities` });
    }
  } else {
    if (value.follow_up_commit !== undefined || typeof value.validation_path_ref !== "string" || !Array.isArray(value.validation_artifacts) || value.validation_artifacts.length === 0) errors.push({ code: "verification_evidence_validation_context_invalid", message: `${displayLabel} non-commit evidence requires validation path and artifacts only` });
    if (value.requested_verification_type === "reviewer_authored_script_output" && typeof value.reviewer_validation_script_ref !== "string") errors.push({ code: "verification_evidence_validation_context_invalid", message: `${displayLabel} script output requires script ref` });
    // C7-33: only the positive requirement above was enforced, so
    // customer_validation_evidence/manual_validation_record/remote_dynamic_testing_evidence
    // could still carry a reviewer_validation_script_ref, making mismatched
    // evidence look like legitimate reviewer-authored script output.
    if (value.requested_verification_type !== "reviewer_authored_script_output" && value.reviewer_validation_script_ref !== undefined) errors.push({ code: "verification_evidence_type_fields_mismatch", message: `${displayLabel} only reviewer-authored script output may reference reviewer_validation_script_ref` });
  }
  const artifactRefs = Array.isArray(value.validation_artifacts) ? value.validation_artifacts.map((artifact) => artifact?.artifact_ref) : [];
  if (new Set(artifactRefs).size !== artifactRefs.length || value.validation_artifacts?.some((artifact) => artifact?.source_derived_class === "never_collected")) errors.push({ code: "verification_evidence_lifecycle_invalid", message: `${displayLabel} validation artifacts require unique collected lifecycle classes` });
  if (value.intake_state !== "accepted_for_review" && !isMeaningfulRemediationText(value.next_step_summary)) errors.push({ code: "verification_evidence_next_step_required", message: `${displayLabel} incomplete intake state requires actionable next step` });
  for (const text of [value.state_reason, value.next_step_summary, value.follow_up_commit?.relationship_basis, ...(Array.isArray(value.limitations) ? value.limitations : [])]) collectRemediationTextViolations(text, "verification_text", displayLabel, errors, "verification_evidence");
}

function isVerificationRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (typeof value.verification_record_id === "string" || value.before_state !== undefined || value.after_state !== undefined));
}

export function validateVerificationRecordSemantics(value, errors, label = "verification record") {
  if (!isVerificationRecordLike(value)) return;
  const displayLabel = `${label} ${value.verification_record_id ?? "<missing id>"}`;
  if (value.actor?.actor_type !== "reviewer") errors.push({ code: "verification_record_reviewer_actor_required", message: `${displayLabel} requires reviewer actor` });
  // C7-09: verification_pass_id and verification_pass_ref were never
  // required to agree, so a decision could be attributed to a different
  // verification pass instance than the one it claims to target.
  if (value.verification_pass_id !== value.verification_pass_ref) errors.push({ code: "verification_record_reference_mismatch", message: `${displayLabel} verification_pass_id must equal verification_pass_ref` });
  const evidenceRefs = Array.isArray(value.verification_evidence_record_refs) ? value.verification_evidence_record_refs : [];
  if (new Set(evidenceRefs).size !== evidenceRefs.length) errors.push({ code: "verification_record_reference_mismatch", message: `${displayLabel} evidence refs must be unique` });
  const criteria = Array.isArray(value.before_state?.confirmation_criteria) ? value.before_state.confirmation_criteria : [];
  const results = Array.isArray(value.after_state?.criteria_results) ? value.after_state.criteria_results : [];
  const resultCriteria = results.map((result) => result?.criterion);
  if (criteria.length === 0 || resultCriteria.length !== criteria.length || new Set(resultCriteria).size !== resultCriteria.length || resultCriteria.some((criterion) => !criteria.includes(criterion))) errors.push({ code: "verification_record_criteria_mismatch", message: `${displayLabel} criteria results must exactly cover recorded criteria` });
  const resultValues = results.map((result) => result?.result);
  const statusMatches = value.verification_status === "verification_complete" ? resultValues.length > 0 && resultValues.every((result) => result === "satisfied") : value.verification_status === "not_verified" ? resultValues.includes("not_satisfied") : value.verification_status === "verification_pending" ? resultValues.includes("not_evaluated") : resultValues.includes("customer_validation_required");
  if (!statusMatches) errors.push({ code: "verification_record_criteria_mismatch", message: `${displayLabel} outcome must match criterion results` });
  if (value.verification_status !== "verification_complete" && !isMeaningfulRemediationText(value.next_step_summary)) errors.push({ code: "verification_record_next_step_required", message: `${displayLabel} incomplete outcome requires actionable next step` });
  for (const text of [value.after_state?.summary, value.rationale, value.next_step_summary, ...criteria, ...resultCriteria, ...(Array.isArray(value.remaining_limitations) ? value.remaining_limitations : [])]) collectRemediationTextViolations(text, "verification_text", displayLabel, errors, "verification_record");
}

function isVerificationAddendumLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (typeof value.verification_addendum_id === "string" || Array.isArray(value.findings)));
}

export function validateVerificationAddendumSemantics(value, errors, label = "verification addendum") {
  if (!isVerificationAddendumLike(value)) return;
  const displayLabel = `${label} ${value.verification_addendum_id ?? "<missing id>"}`;
  if (value.verification_pass_ref !== value.verification_pass_id) errors.push({ code: "verification_addendum_reference_mismatch", message: `${displayLabel} scope/pass refs must match` });
  const findings = Array.isArray(value.findings) ? value.findings : [];
  const findingRefs = findings.map((finding) => finding?.review_finding_draft_ref);
  const decisionRefs = findings.map((finding) => finding?.verification_record_ref);
  if (new Set(findingRefs).size !== findingRefs.length || new Set(decisionRefs).size !== decisionRefs.length) errors.push({ code: "verification_addendum_reference_mismatch", message: `${displayLabel} finding and decision chains must be unique` });
  const retained = Array.isArray(value.retained_evidence) ? value.retained_evidence : [];
  const deleted = Array.isArray(value.deleted_evidence) ? value.deleted_evidence : [];
  const retainedRefs = retained.map((entry) => entry?.artifact_ref);
  const deletedRefs = deleted.map((entry) => entry?.artifact_ref);
  if (new Set(retainedRefs).size !== retainedRefs.length || new Set(deletedRefs).size !== deletedRefs.length || retainedRefs.some((ref) => deletedRefs.includes(ref))) errors.push({ code: "verification_addendum_evidence_resolution_invalid", message: `${displayLabel} evidence must resolve exactly once as retained or deleted` });
  // C4-22: this standalone script validator has no evidence context, so it
  // can only enforce the upper causal bound (a deletion cannot postdate the
  // addendum reporting it) -- the lower bound (deletion cannot predate the
  // evidence it deletes) requires evidence.recorded_at and is enforced only
  // by the control-plane builder, which has that context.
  const generatedAt = parseUtcTimestampNs(value.generated_at);
  for (const entry of deleted) {
    const deletionAt = parseUtcTimestampNs(entry?.deletion_timestamp);
    if (generatedAt === undefined || deletionAt === undefined || deletionAt > generatedAt) {
      errors.push({ code: "verification_addendum_deletion_evidence_missing", message: `${displayLabel} deletion_timestamp must not postdate generated_at` });
    }
  }
  const unresolved = findings.some((finding) => finding?.verification_status === "verification_pending" || finding?.verification_status === "requires_customer_side_validation");
  if (unresolved && value.finalization_state !== "not_finalized") errors.push({ code: "verification_addendum_finalization_invalid", message: `${displayLabel} unresolved findings cannot finalize` });
  if ((unresolved || value.finalization_state === "not_finalized") && !isMeaningfulRemediationText(value.next_step_summary)) errors.push({ code: "verification_addendum_next_step_required", message: `${displayLabel} incomplete addendum requires next step` });
  for (const finding of findings) if (finding?.verification_status !== "verification_complete" && !isMeaningfulRemediationText(finding?.next_step_summary)) errors.push({ code: "verification_addendum_next_step_required", message: `${displayLabel} incomplete finding requires next step` });
  for (const text of [value.next_step_summary, ...(Array.isArray(value.limitations) ? value.limitations : []), ...findings.flatMap((finding) => [finding?.summary, finding?.next_step_summary, ...(Array.isArray(finding?.remaining_limitations) ? finding.remaining_limitations : [])])]) collectRemediationTextViolations(text, "verification_text", displayLabel, errors, "verification_addendum");
}

function isSecurityReviewAttestationLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.attestation_id === "string" && Array.isArray(value.sections));
}

export function validateSecurityReviewAttestationSemantics(value, errors, label = "security review attestation") {
  if (!isSecurityReviewAttestationLike(value)) return;
  const displayLabel = `${label} ${value.attestation_id}`;
  if (!['reviewer', 'vendor_service'].includes(value.generated_by?.actor_type)) {
    errors.push({ code: "attestation_generation_actor_required", message: `${displayLabel} must be generated by a reviewer or deterministic vendor service` });
  }
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const requiredSectionTypes = ['scope', 'method', 'receipt_chain', 'findings_and_classification', 'remediation_and_validation', 'verification_outcomes', 'evidence_lifecycle', 'limitations'];
  const sectionTypes = sections.map((section) => section?.section_type);
  if (sections.length !== requiredSectionTypes.length || new Set(sectionTypes).size !== requiredSectionTypes.length || requiredSectionTypes.some((sectionType) => !sectionTypes.includes(sectionType))) {
    errors.push({ code: "attestation_sections_incomplete", message: `${displayLabel} must include each independently readable section exactly once` });
  }
  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(['attestation_id'])) {
    errors.push({ code: "attestation_identity_excludes_invalid", message: `${displayLabel} identity input must exclude only attestation_id` });
  }
  const identityInput = { ...value };
  delete identityInput.attestation_id;
  try {
    const expectedId = `attestation:${sha256IdFromCanonical(identityInput).slice("sha256:".length)}`;
    if (value.attestation_id !== expectedId) errors.push({ code: "attestation_identity_mismatch", message: `${displayLabel} must equal SHA-256 over canonical Attestation content excluding attestation_id` });
  } catch {
    errors.push({ code: "attestation_identity_mismatch", message: `${displayLabel} identity input must be canonicalizable JSON` });
  }
  const textValues = [
    value.method?.tooling_summary,
    value.method?.disclosure_summary,
    ...(value.method?.method_limitations ?? []),
    ...(value.limitations ?? []),
    ...sections.flatMap((section) => [section?.title, section?.summary, section?.scope, ...(section?.evidence_basis ?? []), ...(section?.limitations ?? [])])
  ];
  for (const text of textValues) collectRemediationTextViolations(text, "attestation_text", displayLabel, errors, "attestation");
}

function isIdentitySigningInputLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.signing_input_type === "string" && typeof value.signed_identity_type === "string" && value.signature_bytes === undefined);
}

export function validateIdentitySigningInputSemantics(value, errors, label = "identity signing input") {
  if (!isIdentitySigningInputLike(value)) return;
  const identityBindingByInput = new Map([
    ["outbound_manifest_identity", { type: "outbound_manifest", path: "v0/valid/outbound-manifest.identity-input.json" }],
    ["bundle_manifest_identity", { type: "evidence_bundle", path: "v0/valid/bundle-manifest.identity-input.json" }],
    ["vendor_receipt_identity", { type: "vendor_receipt", path: "v0/valid/vendor-receipt.identity-input.json" }],
    ["static_bundle_manifest_identity", { type: "static_bundle_manifest", paths: new Set(["v0/valid/static-bundle-manifest.identity-input.json", "v0/valid/static-bundle-manifest.finalized.identity-input.json"]) }],
    ["attestation_package_finalization_identity", { type: "attestation_package_finalization", path: "v0/valid/attestation-package-finalization.identity-input.json" }],
    ["disclosure_policy_identity", { type: "disclosure_policy", paths: new Set(["v0/valid/disclosure-policy.identity-input.json", "v0/valid/disclosure-policy.extended.identity-input.json", "v0/valid/disclosure-policy.metadata-only.identity-input.json"]) }],
    ["review_event_identity", { type: "review_event", path: "v0/valid/review-event.identity-input.json" }],
    ["security_review_attestation_identity", { type: "security_review_attestation", path: "v0/valid/security-review-attestation.identity-input.json" }],
    ["environment_readiness_decision_identity", { type: "environment_readiness_decision", path: "v0/valid/environment-readiness-decision.identity-input.json" }]
  ]);
  const binding = identityBindingByInput.get(value.signing_input_type);
  if (binding?.type !== value.signed_identity_type) errors.push({ code: "signing_input_identity_type_mismatch", message: `${label} signing_input_type must match signed_identity_type` });
  const pathMatches = binding !== undefined && ("paths" in binding ? binding.paths.has(value.identity_input_path) : binding.path === value.identity_input_path);
  if (!pathMatches) errors.push({ code: "signing_input_identity_path_mismatch", message: `${label} identity_input_path must match signing_input_type and signed_identity_type` });
}

function isSupportingEvidenceMappingLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.supporting_evidence_mapping_id === "string");
}

export function validateSupportingEvidenceMappingSemantics(value, errors, label = "supporting evidence mapping") {
  if (!isSupportingEvidenceMappingLike(value)) return;
  const displayLabel = `${label} ${value.supporting_evidence_mapping_id}`;
  if (value.approval_state !== "approved") errors.push({ code: "supporting_evidence_mapping_approval_required", message: `${displayLabel} must be approved and versioned before projection` });
  if (value.approved_by?.actor_type !== "reviewer") errors.push({ code: "supporting_evidence_mapping_authority_required", message: `${displayLabel} must be approved by a reviewer` });
  const entries = Array.isArray(value.entries) ? value.entries : [];
  const entryIds = entries.map((entry) => entry?.mapping_entry_id);
  if (new Set(entryIds).size !== entryIds.length) errors.push({ code: "supporting_evidence_mapping_duplicate_entry", message: `${displayLabel} mapping entry ids must be unique` });
  for (const text of [value.decision_authority, value.acceptance_disclaimer, ...(value.limitations ?? []), ...entries.flatMap((entry) => [entry?.topic, entry?.supporting_evidence_role, entry?.scope_summary, entry?.method_summary, entry?.receipt_context, ...(entry?.limitations ?? [])])]) {
    collectRemediationTextViolations(text, "mapping_text", displayLabel, errors, "supporting_evidence_mapping");
  }
}

function isStaticBundleManifestLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.static_bundle_manifest_id === "string" && Array.isArray(value.files));
}

const STATIC_BUNDLE_REQUIRED_PATH_ROLES = new Map([
  ["attestation.json", "attestation"],
  ["vendor-receipt.json", "vendor_receipt"],
  ["evidence-bundle-representation.json", "evidence_bundle_representation"],
  ["portal/index.html", "portal"],
  ["portal/styles.css", "portal_asset"],
  ["portal/portal.js", "portal_asset"]
]);

export function validateStaticBundleManifestSemantics(value, errors, label = "static bundle manifest") {
  if (!isStaticBundleManifestLike(value)) return;
  const displayLabel = `${label} ${value.static_bundle_manifest_id}`;
  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(['static_bundle_manifest_id'])) errors.push({ code: "static_bundle_identity_excludes_invalid", message: `${displayLabel} identity input must exclude only static_bundle_manifest_id` });
  const identityInput = { ...value };
  delete identityInput.static_bundle_manifest_id;
  try {
    if (sha256IdFromCanonical(identityInput) !== value.static_bundle_manifest_id) errors.push({ code: "static_bundle_manifest_identity_mismatch", message: `${displayLabel} must equal SHA-256 over canonical manifest content excluding static_bundle_manifest_id` });
  } catch {
    errors.push({ code: "static_bundle_manifest_identity_mismatch", message: `${displayLabel} identity input must be canonicalizable JSON` });
  }
  if (value.package_state === "finalized" && (value.manifest_version < 2 || typeof value.supersedes_static_bundle_manifest_id !== "string" || value.supersedes_static_bundle_manifest_id === value.static_bundle_manifest_id)) errors.push({ code: "static_bundle_finalization_version_invalid", message: `${displayLabel} finalized package must be a higher manifest version superseding generated bytes` });
  // C7-35: only the finalized-state shape was checked; a generated package
  // carrying a supersedes_static_bundle_manifest_id (a field meant to record
  // finalization lineage) passed unchallenged.
  if (value.package_state === "generated" && value.supersedes_static_bundle_manifest_id !== undefined) errors.push({ code: "static_bundle_finalization_version_invalid", message: `${displayLabel} generated package must not supersede another manifest` });
  const files = Array.isArray(value.files) ? value.files : [];
  const filePaths = files.map((file) => file?.relative_path);
  const fileRefs = files.map((file) => file?.artifact_ref);
  if (new Set(filePaths).size !== filePaths.length || new Set(fileRefs).size !== fileRefs.length) errors.push({ code: "static_bundle_duplicate_file", message: `${displayLabel} included file paths and artifact refs must be unique` });
  // C7-12: the old checks verified required roles existed *anywhere* in the
  // files array and required paths existed *anywhere* in filePaths, but
  // never bound a specific path to a specific role -- portal/index.html
  // could carry artifact_role "attestation" while attestation.json carried
  // "portal", and both independent checks would still pass.
  const filesByPath = new Map(files.map((file) => [file?.relative_path, file]));
  for (const [requiredPath, requiredRole] of STATIC_BUNDLE_REQUIRED_PATH_ROLES) {
    const file = filesByPath.get(requiredPath);
    if (!file || file.artifact_role !== requiredRole) {
      errors.push({ code: "static_bundle_required_files_missing", message: `${displayLabel} must include ${requiredPath} bound to artifact_role ${requiredRole}` });
    }
  }
  if (value.verification_metadata?.verification_instructions_path !== 'VERIFY.txt') errors.push({ code: "static_bundle_required_files_missing", message: `${displayLabel} must declare the VERIFY.txt verification instructions path` });
  const requiredRefs = [value.evidence_bundle_representation?.bundle_manifest_ref, value.evidence_bundle_representation?.signature_ref, value.evidence_bundle_representation?.identity_ref, ...(value.evidence_bundle_representation?.retained_export_approved_payload_refs ?? [])];
  if (requiredRefs.some((ref) => fileRefs.filter((fileRef) => fileRef === ref).length !== 1)) errors.push({ code: "static_bundle_reference_unresolved", message: `${displayLabel} every Evidence Bundle payload reference must resolve to exactly one digest-covered file` });
  if ([value.verification_metadata?.manifest_signature_ref, value.verification_metadata?.signing_input_ref].some((ref) => fileRefs.includes(ref))) errors.push({ code: "static_bundle_signing_attachment_circular", message: `${displayLabel} signing input and signature must be outer attachments, not signed payload files` });
  const includedRefs = value.minimization_disposition?.included_retained_refs ?? [];
  if (includedRefs.length !== fileRefs.length || new Set(includedRefs).size !== includedRefs.length || fileRefs.some((ref) => !includedRefs.includes(ref)) || includedRefs.some((ref) => !fileRefs.includes(ref))) errors.push({ code: "static_bundle_minimization_coverage_invalid", message: `${displayLabel} included_retained_refs must exactly cover every payload file ref` });
  const prohibitedInternalLearning = /(?:pilot[-_. ]?(?:metric|feedback)|internal[-_. ]?learning)/iu;
  if (files.some((file) => prohibitedInternalLearning.test(`${file?.relative_path ?? ''} ${file?.inclusion_reason ?? ''}`)) || includedRefs.some((ref) => prohibitedInternalLearning.test(ref))) {
    errors.push({ code: "static_bundle_internal_learning_forbidden", message: `${displayLabel} must exclude internal pilot metrics and feedback from customer files and included refs` });
  }
  for (const text of files.map((file) => file?.inclusion_reason)) collectRemediationTextViolations(text, "inclusion_reason", displayLabel, errors, "static_bundle");
}

function validateStaticBundleVerificationPackageSemantics(value, errors, label = "static bundle verification package") {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.attachment_index_id !== "string" || !value.signing_input_attachment || !value.signature_attachment) return;
  const displayLabel = `${label} ${value.attachment_index_id}`;
  const signingInput = value.signing_input_attachment.signing_input;
  const signature = value.signature_attachment.signature_envelope;
  let signingBytes; let signatureBytes;
  try { signingBytes = canonicalize(signingInput); signatureBytes = canonicalize(signature); } catch { errors.push({ code: "static_bundle_verification_attachment_invalid", message: `${displayLabel} attachments must be canonicalizable JSON` }); return; }
  if (`sha256:${sha256Hex(signingBytes)}` !== value.signing_input_attachment.digest || Buffer.byteLength(signingBytes) !== value.signing_input_attachment.size_bytes || `sha256:${sha256Hex(signatureBytes)}` !== value.signature_attachment.digest || Buffer.byteLength(signatureBytes) !== value.signature_attachment.size_bytes) errors.push({ code: "static_bundle_verification_attachment_invalid", message: `${displayLabel} attachment digest and size must match exact RFC8785 bytes` });
  if (signingInput?.signed_identity !== value.signed_payload_manifest_id || signature?.signed_identity !== value.signed_payload_manifest_id || signature?.key_id !== undefined && typeof signature.key_id !== "string" || signature?.key_version !== undefined && typeof signature.key_version !== "string" || signature?.signing_time === undefined) errors.push({ code: "static_bundle_verification_binding_invalid", message: `${displayLabel} must bind manifest identity, key/version, and signing time` });
  // C7-12: the identity/key/timing bindings above never checked that the
  // signing input and signature actually claim to sign a static bundle
  // manifest at all -- a nested signing_input/signature envelope for a
  // completely different record type (e.g. vendor_receipt) with the right
  // identity/key/timing shape would still pass.
  if (
    signingInput?.signing_input_type !== "static_bundle_manifest_identity" ||
    signingInput?.signed_identity_type !== "static_bundle_manifest" ||
    signature?.signed_identity_type !== "static_bundle_manifest" ||
    typeof signingInput?.identity_input_path !== "string" ||
    !/^v0\/valid\/static-bundle-manifest\.[\w.-]*identity-input\.json$/u.test(signingInput.identity_input_path)
  ) {
    errors.push({ code: "static_bundle_verification_binding_invalid", message: `${displayLabel} signing input and signature must declare a static_bundle_manifest identity type and path` });
  }
  // D3-3: the package inlines the exact signing input the envelope signs, so
  // the signature is verified cryptographically against the corpus's published
  // signing key rather than reconstructed from a deterministic digest recipe.
  if (!fixtureSignatureVerifies(signature?.signature_bytes, signingInput)) errors.push({ code: "static_bundle_verification_signature_invalid", message: `${displayLabel} signature bytes must verify as a real ML-DSA-65 signature over the inlined signing input` });
  const indexInput = { ...value }; delete indexInput.attachment_index_id;
  try { if (sha256IdFromCanonical(indexInput) !== value.attachment_index_id) errors.push({ code: "static_bundle_verification_index_identity_mismatch", message: `${displayLabel} attachment index identity must recompute` }); } catch { errors.push({ code: "static_bundle_verification_index_identity_mismatch", message: `${displayLabel} attachment index must be canonicalizable` }); }
}

function isStaticPortalProjectionLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.static_portal_projection_id === "string");
}

export function validateStaticPortalProjectionSemantics(value, errors, label = "static portal projection") {
  if (!isStaticPortalProjectionLike(value)) return;
  const displayLabel = `${label} ${value.static_portal_projection_id}`;
  const requiredSections = ['overview', 'scope', 'receipt_chain', 'methods', 'findings', 'validation_remediation', 'limitations', 'appendices'];
  const navigation = Array.isArray(value.navigation) ? value.navigation : [];
  const sections = navigation.map((entry) => entry?.section_id);
  const orders = navigation.map((entry) => entry?.order);
  // C7-35: the set-membership + order-uniqueness checks below allow a
  // "rotated" navigation array (any permutation of the 8 sections, each still
  // carrying a unique 1..8 order) to pass, since neither checked that a given
  // array index actually holds the canonical section for that position.
  if (navigation.length !== 8 || new Set(sections).size !== 8 || requiredSections.some((section) => !sections.includes(section)) || new Set(orders).size !== 8 || orders.some((order, index) => order !== index + 1) || requiredSections.some((section, index) => sections[index] !== section)) errors.push({ code: "static_portal_navigation_incomplete", message: `${displayLabel} must expose fixed ordered navigation` });
  const documents = Array.isArray(value.documents) ? value.documents : [];
  const documentSections = documents.map((document) => document?.section_id);
  const documentPaths = documents.map((document) => document?.relative_path);
  const navigationPaths = navigation.map((entry) => entry?.relative_path);
  if (documents.length !== 8 || new Set(documentSections).size !== 8 || requiredSections.some((section) => !documentSections.includes(section)) || new Set(documentPaths).size !== documents.length || navigation.some((entry) => !documents.some((document) => document?.section_id === entry?.section_id && document?.relative_path === entry?.relative_path))) errors.push({ code: "static_portal_document_incomplete", message: `${displayLabel} every navigation section must resolve to exactly one matching offline document` });
  const prohibitedInternalLearning = /(?:pilot[-_. ]?(?:metric|feedback)|internal[-_. ]?learning)/iu;
  if (documents.some((document) => (document?.source_artifact_refs ?? []).some((ref) => prohibitedInternalLearning.test(String(ref))))) errors.push({ code: "static_portal_internal_learning_forbidden", message: `${displayLabel} must exclude internal pilot references from customer documents` });
  if (value.asset_policy?.remote_assets_allowed !== false || value.asset_policy?.analytics_allowed !== false || value.asset_policy?.live_api_calls_allowed !== false || value.asset_policy?.runtime_authorization_required !== false || value.asset_policy?.relative_links_only !== true) errors.push({ code: "static_portal_remote_dependency_forbidden", message: `${displayLabel} must be self-contained with relative links and no remote runtime` });
  for (const text of documents.flatMap((document) => [document?.title, document?.summary, document?.phone_summary])) collectRemediationTextViolations(text, "portal_text", displayLabel, errors, "static_portal");
}

function isAttestationPackageFinalizationLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.attestation_package_finalization_id === "string");
}

export function validateAttestationPackageFinalizationSemantics(value, errors, label = "attestation package finalization") {
  if (!isAttestationPackageFinalizationLike(value)) return;
  const displayLabel = `${label} ${value.attestation_package_finalization_id}`;
  if (value.customer_actor?.actor_type !== "customer_user") errors.push({ code: "attestation_finalization_customer_actor_required", message: `${displayLabel} requires customer finalization authority` });
  if (canonicalize(value.identity_input_excludes ?? null) !== canonicalize(["attestation_package_finalization_id", "export_state", "exported_at"])) errors.push({ code: "attestation_finalization_identity_excludes_invalid", message: `${displayLabel} identity input must exclude finalization id and export timeline fields` });
  const identityInput = { ...value };
  delete identityInput.attestation_package_finalization_id;
  delete identityInput.export_state;
  delete identityInput.exported_at;
  try {
    const expectedId = `attestation_finalization:${sha256IdFromCanonical(identityInput).slice("sha256:".length)}`;
    if (value.attestation_package_finalization_id !== expectedId) errors.push({ code: "attestation_finalization_identity_mismatch", message: `${displayLabel} must equal SHA-256 over canonical finalization content excluding attestation_package_finalization_id` });
  } catch {
    errors.push({ code: "attestation_finalization_identity_mismatch", message: `${displayLabel} identity input must be canonicalizable JSON` });
  }
  if (value.generated_manifest_ref === value.finalized_manifest_ref || value.finalized_manifest_version < 2) errors.push({ code: "attestation_finalization_new_manifest_required", message: `${displayLabel} must issue a newly signed higher manifest version` });
  if (value.visible_context?.static_bundle_id !== value.static_bundle_id || value.visible_context?.generated_manifest_id !== value.generated_manifest_ref) errors.push({ code: "attestation_finalization_visible_context_mismatch", message: `${displayLabel} visible bundle and manifest identities must match the package being finalized` });
  if (!value.visible_context?.limitations_visible || !value.visible_context?.receipt_context_visible || !value.visible_context?.export_consequence_visible) errors.push({ code: "attestation_finalization_visible_context_required", message: `${displayLabel} requires visible identity, limitation, receipt, and export consequence context` });
  if ((value.export_state === "exported") !== (typeof value.exported_at === "string")) errors.push({ code: "attestation_export_timestamp_required", message: `${displayLabel} exported_at must appear if and only if the package is exported` });
  if (typeof value.exported_at === "string" && Date.parse(value.exported_at) < Date.parse(value.finalized_at)) errors.push({ code: "attestation_export_timestamp_invalid", message: `${displayLabel} export timestamp must not precede finalization` });
  collectRemediationTextViolations(value.customer_control_after_export, "customer_control_after_export", displayLabel, errors, "attestation_finalization");
}

async function validateEpic5FixtureChainSemantics(value, options, errors) {
  if (typeof options.fixtureRoot !== "string") return;
  const relevant = isSecurityReviewAttestationLike(value) || isSupportingEvidenceMappingLike(value) || isStaticBundleManifestLike(value) || isStaticPortalProjectionLike(value) || isAttestationPackageFinalizationLike(value) || isSignatureEnvelopeLike(value) || isIdentitySigningInputLike(value);
  if (!relevant) return;
  const load = async (relativePath) => readJson(path.join(options.fixtureRoot, relativePath));
  let attestation;
  let mapping;
  let generated;
  let finalized;
  let portal;
  let finalization;
  let classification;
  let guidance;
  let validationPath;
  let validationScript;
  let verificationEvidence;
  let verificationRecord;
  try {
    [attestation, mapping, generated, finalized, portal, finalization, classification, guidance, validationPath, validationScript, verificationEvidence, verificationRecord] = await Promise.all([
      load("v0/valid/security-review-attestation.json"),
      load("v0/valid/supporting-evidence-mapping.soc2.json"),
      load("v0/valid/static-bundle-manifest.generated.json"),
      load("v0/valid/static-bundle-manifest.finalized.json"),
      load("v0/valid/static-portal-projection.json"),
      load("v0/valid/attestation-package-finalization.json"),
      load("v0/valid/finding-classification-record.requires-validation.json"),
      load("v0/valid/finding-remediation-guidance.requires-validation-path-only.json"),
      load("v0/valid/finding-validation-path.customer-run-script.json"),
      load("v0/valid/reviewer-validation-script.included-slot-1.json"),
      load("v0/valid/verification-evidence-record.customer-validation.json"),
      load("v0/valid/verification-record.complete.json")
    ]);
  } catch { return; }
  const display = options.fixturePath ?? "Epic 5 fixture";
  if (isSupportingEvidenceMappingLike(value) && value.approval_state === "approved" && (value.review_id !== attestation.review_id || value.attestation_ref !== attestation.attestation_id)) errors.push({ code: "supporting_evidence_mapping_reference_mismatch", message: `${display} must reference the canonical Attestation and review` });
  if (isStaticBundleManifestLike(value) && value.package_state === "generated" && value.attestation_ref !== attestation.attestation_id) errors.push({ code: "static_bundle_attestation_reference_mismatch", message: `${display} must reference the canonical Attestation` });
  if (isStaticBundleManifestLike(value) && value.package_state === "finalized") {
    const generatedComparable = { ...generated, static_bundle_manifest_id: undefined, manifest_version: value.manifest_version, package_state: "finalized", created_at: value.created_at, supersedes_static_bundle_manifest_id: generated.static_bundle_manifest_id };
    const finalizedComparable = { ...value, static_bundle_manifest_id: undefined };
    delete generatedComparable.static_bundle_manifest_id;
    delete finalizedComparable.static_bundle_manifest_id;
    if (value.static_bundle_id !== generated.static_bundle_id || value.review_id !== generated.review_id || value.manifest_version !== generated.manifest_version + 1 || value.supersedes_static_bundle_manifest_id !== generated.static_bundle_manifest_id || canonicalize(finalizedComparable) !== canonicalize(generatedComparable)) errors.push({ code: "static_bundle_finalized_lineage_invalid", message: `${display} finalized manifest must be the next immutable generated-manifest version` });
  }
  if (isStaticPortalProjectionLike(value) && (value.review_id !== attestation.review_id || value.static_bundle_id !== generated.static_bundle_id || value.static_bundle_manifest_ref !== generated.static_bundle_manifest_id)) errors.push({ code: "static_portal_reference_mismatch", message: `${display} must bind the canonical review and generated static manifest` });
  if (isAttestationPackageFinalizationLike(value) && value.customer_actor?.actor_type === "customer_user") {
    if (value.review_id !== attestation.review_id || value.visible_context?.attestation_id !== attestation.attestation_id || value.static_bundle_id !== generated.static_bundle_id || value.generated_manifest_ref !== generated.static_bundle_manifest_id || value.finalized_manifest_ref !== finalized.static_bundle_manifest_id || value.finalized_manifest_version !== finalized.manifest_version) errors.push({ code: "attestation_finalization_reference_mismatch", message: `${display} must bind the canonical Attestation and static manifest lineage` });
  }
  if (isSignatureEnvelopeLike(value) && value.signed_identity_type === "static_bundle_manifest") {
    const expectedManifestId = options.fixturePath === "v0/valid/signature-envelope.static-bundle-finalized.json" ? finalized.static_bundle_manifest_id : generated.static_bundle_manifest_id;
    if (value.signed_identity !== expectedManifestId) errors.push({ code: "signature_signed_identity_mismatch", message: `${display} static manifest signature must bind its registered manifest identity` });
  }
  const finalizationDigest = `sha256:${finalization.attestation_package_finalization_id.slice("attestation_finalization:".length)}`;
  if ((isSignatureEnvelopeLike(value) || isIdentitySigningInputLike(value)) && value.signed_identity_type === "attestation_package_finalization" && value.signed_identity !== finalizationDigest) errors.push({ code: "signature_signed_identity_mismatch", message: `${display} finalization signature must bind finalization record identity` });
  if (isSecurityReviewAttestationLike(value)) {
    if (value.supporting_evidence_mapping_ref !== undefined && (mapping.supporting_evidence_mapping_id !== value.supporting_evidence_mapping_ref || mapping.review_id !== value.review_id || mapping.attestation_ref !== value.attestation_id)) errors.push({ code: "attestation_mapping_reference_mismatch", message: `${display} optional mapping must resolve to the same Attestation and review` });
    const byType = new Map((value.sections ?? []).map((section) => [section.section_type, section.supporting_artifact_refs ?? []]));
    const expected = new Map([
      ["scope", ["artifact_ref:review_scope"]], ["method", ["artifact_ref:scanner_finding_set"]], ["receipt_chain", ["artifact_ref:vendor_receipt"]],
      ["findings_and_classification", [`artifact_ref:${classification.classification_record_id.slice("classification_record:".length)}`]],
      ["remediation_and_validation", [`artifact_ref:${guidance.remediation_guidance_id.slice("remediation_guidance:".length)}`, `artifact_ref:${validationPath.validation_path_id.slice("validation_path:".length)}`, `artifact_ref:${validationScript.validation_script_id.slice("validation_script:".length)}`]],
      ["verification_outcomes", [`artifact_ref:${verificationEvidence.verification_evidence_record_id.slice("verification_evidence:".length)}`, `artifact_ref:${verificationRecord.verification_record_id.slice("verification_record:".length)}`]],
      ["evidence_lifecycle", ["artifact_ref:evidence_minimization_projection"]], ["limitations", ["artifact_ref:review_scope"]]
    ]);
    for (const [sectionType, refs] of expected) { const actual = byType.get(sectionType) ?? []; if (actual.length !== refs.length || refs.some((ref) => !actual.includes(ref))) errors.push({ code: "attestation_sections_reference_coverage_invalid", message: `${display} ${sectionType} section must exactly cover its supplied record family` }); }
  }
  if (isStaticPortalProjectionLike(value) && value.documents?.length === 8 && portal.documents?.length === 8 && value.static_portal_projection_id === portal.static_portal_projection_id && value.documents.some((document) => document.review_id !== undefined && document.review_id !== value.review_id)) errors.push({ code: "static_portal_reference_mismatch", message: `${display} documents cannot cross review boundaries` });
}

// C4-28: mirrors the protocol-ts package's claim-safety module's opaquePilotActorIdIsValid /
// containsPiiValue -- keep both in sync.
function opaquePilotActorIdIsValid(actorType, actorId) {
  if (typeof actorType !== "string" || typeof actorId !== "string") return false;
  return new RegExp(`^${actorType}:[a-z0-9][a-z0-9_-]{2,63}$`, "u").test(actorId);
}

function containsPiiValue(value) {
  if (Array.isArray(value)) return value.some((entry) => containsPiiValue(entry));
  if (value !== null && typeof value === "object") return Object.values(value).some((entry) => containsPiiValue(entry));
  return piiTextForbidden(value) !== undefined;
}

function isPilotMetricRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.pilot_metric_record_id === "string");
}

export function validatePilotMetricRecordSemantics(value, errors, label = "pilot metric record") {
  if (!isPilotMetricRecordLike(value)) return;
  const displayLabel = `${label} ${value.pilot_metric_record_id}`;
  if (value.visibility !== "internal_only" || value.content_free !== true || value.pii_free !== true) errors.push({ code: "pilot_metric_internal_content_free_required", message: `${displayLabel} must remain internal-only, content-free, and PII-free` });
  if (!opaquePilotActorIdIsValid(value.recorded_by?.actor_type, value.recorded_by?.actor_id) || containsPiiValue(value)) errors.push({ code: "pilot_metric_pii_forbidden", message: `${displayLabel} recorded_by.actor_id must be an opaque namespaced identifier and no field may carry PII-like text` });
  const metrics = value.metrics ?? {};
  const countValues = [metrics.candidate_finding_count, metrics.classified_finding_count, metrics.actionable_classification_count, metrics.submission_rejection_count];
  const durationValues = [metrics.review_hours, metrics.validation_hours, metrics.turnaround_hours];
  if (!Number.isSafeInteger(value.record_version) || countValues.some((entry) => !Number.isSafeInteger(entry)) || durationValues.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || Math.abs(entry) > Number.MAX_SAFE_INTEGER)) errors.push({ code: "pilot_metric_number_invalid", message: `${displayLabel} requires finite safe numeric values` });
  // C7-34: Date.parse() truncates to millisecond precision, but protocol
  // timestamps allow up to nanoseconds -- a valid sub-millisecond-wide window
  // could be misclassified as start >= end.
  const start = parseUtcTimestampNs(value.measurement_window?.start_timestamp);
  const end = parseUtcTimestampNs(value.measurement_window?.end_timestamp);
  const recorded = parseUtcTimestampNs(value.recorded_at);
  if (start === undefined || end === undefined || recorded === undefined || start >= end || end > recorded) errors.push({ code: "pilot_metric_window_invalid", message: `${displayLabel} requires start < end <= recorded_at` });
  if (value.metrics?.classified_finding_count > value.metrics?.candidate_finding_count || value.metrics?.actionable_classification_count > value.metrics?.classified_finding_count) errors.push({ code: "pilot_metric_counts_invalid", message: `${displayLabel} requires actionable <= classified <= candidate findings` });
  for (const text of value.caveats ?? []) collectRemediationTextViolations(text, "pilot_metric_caveat", displayLabel, errors, "pilot_metric");
}

function isPilotFeedbackRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.pilot_feedback_record_id === "string");
}

export function validatePilotFeedbackRecordSemantics(value, errors, label = "pilot feedback record") {
  if (!isPilotFeedbackRecordLike(value)) return;
  const displayLabel = `${label} ${value.pilot_feedback_record_id}`;
  if (value.visibility !== "internal_only" || value.content_free !== true || value.pii_free !== true) errors.push({ code: "pilot_feedback_internal_content_free_required", message: `${displayLabel} must remain internal-only, content-free, and PII-free` });
  const mappingProfiles = (value.mapping_feedback ?? []).map((entry) => entry?.mapping_profile);
  if (!Number.isSafeInteger(value.record_version) || !Number.isSafeInteger(value.usefulness_rating) || (value.mapping_feedback ?? []).some((entry) => !Number.isSafeInteger(entry?.usefulness_rating))) errors.push({ code: "pilot_feedback_number_invalid", message: `${displayLabel} requires finite safe integer ratings and versions` });
  if (new Set(mappingProfiles).size !== mappingProfiles.length) errors.push({ code: "pilot_feedback_mapping_duplicate", message: `${displayLabel} mapping feedback profiles must be unique` });
  if (
    (value.caveats ?? []).some((text) => typeof text === "string" && piiTextForbidden(text) !== undefined) ||
    !opaquePilotActorIdIsValid(value.recorded_by?.actor_type, value.recorded_by?.actor_id) ||
    containsPiiValue(value)
  ) errors.push({ code: "pilot_feedback_pii_forbidden", message: `${displayLabel} recorded_by.actor_id must be an opaque namespaced identifier and no field may carry PII-like text` });
  for (const text of value.caveats ?? []) collectRemediationTextViolations(text, "pilot_feedback_caveat", displayLabel, errors, "pilot_feedback");
}

async function validateEpic4FixtureChainSemantics(value, options, errors) {
  if ((!isVerificationEvidenceRecordLike(value) && !isVerificationRecordLike(value) && !isVerificationAddendumLike(value)) || typeof options.fixtureRoot !== "string") return;
  let index;
  try { index = await readJson(path.join(options.fixtureRoot, "v0/fixture-index.json")); } catch { return; }
  const relevantSchemas = new Set([
    "urn:codeattest:protocol:v0:verification-pass-scope",
    "urn:codeattest:protocol:v0:finding-classification-record",
    "urn:codeattest:protocol:v0:finding-validation-path",
    "urn:codeattest:protocol:v0:reviewer-validation-script",
    "urn:codeattest:protocol:v0:verification-evidence-record",
    "urn:codeattest:protocol:v0:verification-record"
  ]);
  const records = [];
  for (const entry of index.valid_fixtures ?? []) {
    if (!relevantSchemas.has(entry.schema) || entry.path === options.fixturePath) continue;
    try { records.push(await readJson(path.join(options.fixtureRoot, entry.path))); } catch { /* gate reports parse failures separately */ }
  }
  const byId = (field, id) => records.filter((record) => record?.[field] === id);
  if (isVerificationEvidenceRecordLike(value)) {
    const scopes = byId("verification_pass_id", value.verification_pass_ref).filter((scope) => Array.isArray(scope.selected_findings) && scope.scope_version === value.scope_version);
    const classifications = byId("classification_record_id", value.classification_record_ref);
    if (scopes.length !== 1 || classifications.length !== 1) errors.push({ code: "verification_evidence_reference_mismatch", message: `${options.fixturePath} must resolve exactly one scope version and classification` });
    else {
      const scope = scopes[0]; const classification = classifications[0]; const selected = scope.selected_findings.find((finding) => finding.review_finding_draft_ref === value.review_finding_draft_ref);
      if (!selected || scope.review_id !== value.review_id || selected.classification_record_ref !== value.classification_record_ref || selected.requested_verification_type !== value.requested_verification_type || classification.review_id !== value.review_id || classification.review_finding_draft_ref !== value.review_finding_draft_ref) errors.push({ code: "verification_evidence_reference_mismatch", message: `${options.fixturePath} scope/finding/classification chain mismatches` });
    }
    if (typeof value.validation_path_ref === "string") {
      const paths = byId("validation_path_id", value.validation_path_ref);
      if (paths.length !== 1 || paths[0].review_id !== value.review_id || paths[0].classification_record_ref !== value.classification_record_ref || paths[0].review_finding_draft_ref !== value.review_finding_draft_ref) errors.push({ code: "verification_evidence_validation_context_invalid", message: `${options.fixturePath} validation path chain mismatches` });
    }
    if (typeof value.reviewer_validation_script_ref === "string") {
      const scripts = byId("validation_script_id", value.reviewer_validation_script_ref);
      if (scripts.length !== 1 || scripts[0].review_id !== value.review_id || scripts[0].validation_path_ref !== value.validation_path_ref || scripts[0].classification_record_ref !== value.classification_record_ref) errors.push({ code: "verification_evidence_validation_context_invalid", message: `${options.fixturePath} validation script chain mismatches` });
    }
  }
  if (isVerificationRecordLike(value)) {
    const classifications = byId("classification_record_id", value.classification_record_ref);
    const evidence = value.verification_evidence_record_refs?.flatMap((ref) => byId("verification_evidence_record_id", ref)) ?? [];
    if (classifications.length !== 1 || evidence.length !== value.verification_evidence_record_refs?.length || evidence.some((entry) => entry.review_id !== value.review_id || entry.verification_pass_id !== value.verification_pass_id || entry.verification_pass_ref !== value.verification_pass_ref || entry.review_finding_draft_ref !== value.review_finding_draft_ref || entry.classification_record_ref !== value.classification_record_ref)) errors.push({ code: "verification_record_reference_mismatch", message: `${options.fixturePath} decision chain must resolve classification and evidence exactly` });
    else {
      const classification = classifications[0];
      const pathRefs = [...new Set(evidence.map((entry) => entry.validation_path_ref).filter((ref) => typeof ref === "string"))];
      const paths = pathRefs.flatMap((ref) => byId("validation_path_id", ref));
      const expectedCriteria = classification.classification === "requires_customer_side_validation" && (classification.confirmation_criteria ?? []).length === 0 && paths.length === 1 ? [paths[0].expected_result] : classification.confirmation_criteria;
      if (value.before_state?.classification !== classification.classification || canonicalize(value.before_state?.review_finding_draft_evidence_refs) !== canonicalize((classification.review_finding_draft_evidence_refs ?? []).map((ref) => ref.artifact_ref)) || canonicalize(value.before_state?.evidence_basis) !== canonicalize(classification.evidence_basis) || value.before_state?.source_reference_state !== classification.source_reference_state || canonicalize(value.before_state?.confirmation_criteria) !== canonicalize(expectedCriteria)) errors.push({ code: "verification_record_before_state_mismatch", message: `${options.fixturePath} must preserve original basis and usable recorded criteria` });
    }
  }
  if (isVerificationAddendumLike(value)) {
    for (const finding of value.findings ?? []) {
      const decisions = byId("verification_record_id", finding.verification_record_ref);
      const evidence = finding.verification_evidence_record_refs?.flatMap((ref) => byId("verification_evidence_record_id", ref)) ?? [];
      if (decisions.length !== 1 || evidence.length !== finding.verification_evidence_record_refs?.length || decisions[0]?.review_id !== value.review_id || decisions[0]?.review_finding_draft_ref !== finding.review_finding_draft_ref || decisions[0]?.classification_record_ref !== finding.classification_record_ref || decisions[0]?.verification_status !== finding.verification_status) errors.push({ code: "verification_addendum_reference_mismatch", message: `${options.fixturePath} addendum decision/evidence chain mismatches` });
      for (const ref of finding.verification_evidence_record_refs ?? []) {
        const artifactRef = `artifact_ref:${ref.slice("verification_evidence:".length)}`;
        const resolutionCount = [...(value.retained_evidence ?? []), ...(value.deleted_evidence ?? [])].filter((entry) => entry.artifact_ref === artifactRef).length;
        if (resolutionCount !== 1) errors.push({ code: "verification_addendum_evidence_resolution_invalid", message: `${options.fixturePath} evidence record ${ref} must resolve exactly once` });
      }
    }
  }
}

async function validateVerificationPassScopeFixtureReferenceSemantics(value, options, errors) {
  if (!isVerificationPassScopeLike(value) || typeof options.fixtureRoot !== "string") {
    return;
  }
  const drafts = await loadReviewFindingDraftsByRef(options.fixtureRoot);
  const classifications = await loadFindingClassificationsByRecordRef(options.fixtureRoot);
  const remediationGuidance = await loadRemediationGuidanceByRef(options.fixtureRoot);
  const customerStatuses = await loadCustomerStatusesByRef(options.fixtureRoot);
  const validationPaths = await loadValidationPathsByRef(options.fixtureRoot);
  const validationScripts = await loadValidationScriptsByRef(options.fixtureRoot);
  const acceptedRisks = await loadAcceptedRisksByRef(options.fixtureRoot);
  const falsePositives = await loadFalsePositivesByRef(options.fixtureRoot);
  const selectedFindings = Array.isArray(value.selected_findings)
    ? value.selected_findings.filter((finding) => finding && typeof finding === "object" && !Array.isArray(finding))
    : [];
  const allocation = value.included_script_allocation && typeof value.included_script_allocation === "object" && !Array.isArray(value.included_script_allocation)
    ? value.included_script_allocation
    : {};
  const includedSlots = Array.isArray(allocation.included_slots)
    ? allocation.included_slots.filter((slot) => slot && typeof slot === "object" && !Array.isArray(slot))
    : [];
  const includedScriptCapExceeded = includedSlots.length > 3;
  const additionalCandidates = Array.isArray(allocation.additional_script_candidates)
    ? allocation.additional_script_candidates.filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate))
    : [];
  const selectedFindingRefs = new Set(selectedFindings.map((finding) => finding.review_finding_draft_ref).filter((ref) => typeof ref === "string"));
  if (selectedFindingRefs.size !== selectedFindings.length) {
    errors.push({
      code: "verification_scope_reference_mismatch",
      message: `${value.verification_pass_id} selected finding draft refs must be unique`
    });
  }
  for (const finding of selectedFindings) {
    const classification = classifications.get(finding.classification_record_ref);
    if (classification === undefined) {
      errors.push({
        code: "verification_scope_classification_binding_mismatch",
        message: `${finding.classification_record_ref} verification scope selection must resolve to a known classification fixture`
      });
      continue;
    }
    if (
      value.review_id !== classification.review_id ||
      finding.review_finding_draft_ref !== classification.review_finding_draft_ref ||
      finding.current_classification !== classification.classification
    ) {
      errors.push({
        code: "verification_scope_classification_binding_mismatch",
        message: `${finding.classification_record_ref} verification scope selection must bind to the referenced classification review, finding draft, and classification value`
      });
    }
    const draft = drafts.get(finding.review_finding_draft_ref);
    if (
      draft === undefined ||
      draft.reviewId !== value.review_id ||
      !draftEvidenceRefsAreConsistent(draft.evidenceRefs) ||
      canonicalize(draft.evidenceRefs) !== canonicalize(classification.review_finding_draft_evidence_refs) ||
      !findingClassificationSourceReferenceStateMatchesDraft(classification.source_reference_state, draft.evidenceRefs)
    ) {
      errors.push({
        code: "verification_scope_draft_binding_mismatch",
        message: `${finding.review_finding_draft_ref} must resolve to a normalized Review Finding draft with matching evidence refs and source-reference state`
      });
    }
    if (typeof finding.remediation_guidance_ref === "string") {
      const guidance = remediationGuidance.get(finding.remediation_guidance_ref);
      if (guidance === undefined || guidance.review_id !== value.review_id || guidance.classification_record_ref !== finding.classification_record_ref || guidance.review_finding_draft_ref !== finding.review_finding_draft_ref) {
        errors.push({
          code: "verification_scope_reference_mismatch",
          message: `${finding.remediation_guidance_ref} must bind to the selected finding classification and draft refs`
        });
      }
    }
    if (typeof finding.customer_status_record_ref === "string") {
      const status = customerStatuses.get(finding.customer_status_record_ref);
      if (status === undefined || status.review_id !== value.review_id || status.classification_record_ref !== finding.classification_record_ref || status.finding_ref !== finding.review_finding_draft_ref || status.customer_remediation_status !== finding.current_customer_remediation_status) {
        errors.push({
          code: "verification_scope_reference_mismatch",
          message: `${finding.customer_status_record_ref} must bind to the selected finding classification, draft refs, and current status`
        });
      }
    }
    if (typeof finding.validation_path_ref === "string") {
      const validationPath = validationPaths.get(finding.validation_path_ref);
      if (validationPath === undefined || validationPath.review_id !== value.review_id || validationPath.classification_record_ref !== finding.classification_record_ref || validationPath.review_finding_draft_ref !== finding.review_finding_draft_ref) {
        errors.push({
          code: "verification_scope_validation_path_ref_mismatch",
          message: `${finding.validation_path_ref} must bind to the selected finding classification and draft refs`
        });
      } else if (finding.current_classification === "requires_customer_side_validation" && finding.eligibility_state === "eligible" && validationPath.included_pass_verifiability === "additional_agreement_required") {
        errors.push({
          code: "verification_scope_validation_path_required_for_eligible",
          message: `${finding.validation_path_ref} must be verifiable within the included pass before a customer-side-validation finding can be marked eligible`
        });
      }
    }
    for (const scriptRef of Array.isArray(finding.reviewer_validation_script_refs) ? finding.reviewer_validation_script_refs : []) {
      if (includedScriptCapExceeded) {
        continue;
      }
      const script = validationScripts.get(scriptRef);
      if (script === undefined || script.review_id !== value.review_id || script.classification_record_ref !== finding.classification_record_ref || (typeof finding.validation_path_ref === "string" && script.validation_path_ref !== finding.validation_path_ref)) {
        errors.push({
          code: "verification_scope_script_ref_mismatch",
          message: `${scriptRef} must bind to the selected finding validation path/classification context`
        });
      } else {
        const includedEntry = includedSlots.find((slot) => slot.validation_script_ref === scriptRef);
        const additionalEntry = additionalCandidates.find((candidate) => candidate.validation_script_ref === scriptRef);
        if (script.script_package_status === "included_base_package") {
          if (includedEntry === undefined || script.included_script_slot !== includedEntry.slot || additionalEntry !== undefined) {
            errors.push({
              code: "verification_scope_script_allocation_ref_mismatch",
              message: `${scriptRef} included script package metadata must match exactly one included allocation slot`
            });
          }
        } else if (script.script_package_status === "additional_script_candidate_pricing_tbd") {
          if (additionalEntry === undefined || includedEntry !== undefined) {
            errors.push({
              code: "verification_scope_script_allocation_ref_mismatch",
              message: `${scriptRef} additional script package metadata must match exactly one pricing-TBD allocation candidate`
            });
          }
        }
      }
    }
    if (typeof finding.accepted_risk_record_ref === "string") {
      const acceptedRisk = acceptedRisks.get(finding.accepted_risk_record_ref);
      if (acceptedRisk === undefined || acceptedRisk.review_id !== value.review_id || acceptedRisk.classification_record_ref !== finding.classification_record_ref || acceptedRisk.review_finding_draft_ref !== finding.review_finding_draft_ref) {
        errors.push({
          code: "verification_scope_reference_mismatch",
          message: `${finding.accepted_risk_record_ref} must bind to the selected finding classification and draft refs`
        });
      }
    }
    if (typeof finding.false_positive_record_ref === "string") {
      const falsePositive = falsePositives.get(finding.false_positive_record_ref);
      if (falsePositive === undefined || falsePositive.review_id !== value.review_id || falsePositive.classification_record_ref !== finding.classification_record_ref || falsePositive.review_finding_draft_ref !== finding.review_finding_draft_ref) {
        errors.push({
          code: "verification_scope_reference_mismatch",
          message: `${finding.false_positive_record_ref} must bind to the selected finding classification and draft refs`
        });
      }
    }
  }
}

async function loadReviewFindingDraftsByRef(fixtureRoot) {
  const drafts = new Map();
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return drafts;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith("review-finding-draft-set")) {
      continue;
    }
    try {
      const set = await readJson(file);
      if (!set || typeof set !== "object" || Array.isArray(set) || typeof set.review_id !== "string" || !Array.isArray(set.review_finding_drafts)) {
        continue;
      }
      for (const draft of set.review_finding_drafts) {
        if (!draft || typeof draft !== "object" || Array.isArray(draft) || typeof draft.review_finding_draft_id !== "string" || !Array.isArray(draft.evidence_refs) || drafts.has(draft.review_finding_draft_id)) {
          return new Map();
        }
        drafts.set(draft.review_finding_draft_id, { reviewId: set.review_id, evidenceRefs: draft.evidence_refs });
      }
    } catch {
      // Broken fixtures are reported through the normal fixture validation path.
    }
  }
  return drafts;
}

function verificationScopeReasonHasSpecificNextStep(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  if (/\b(?:no|not|without|do not|does not|cannot)\b.{0,40}\b(?:validation path|formal path|next step|additional agreement|obtain|request|record|agree|confirm)\b/u.test(normalized)) {
    return false;
  }
  return /\b(?:obtain|request|record|agree|confirm|create|provide|submit|document|schedule)\b.{0,80}\b(?:validation path|formal path|next step|additional agreement|pricing\s*tbd|customer approval|order form|scope)\b|\b(?:validation path|formal path|additional agreement|pricing\s*tbd)\b.{0,80}\b(?:required|needed|before|must|next)\b/u.test(normalized);
}

async function loadRemediationGuidanceByRef(fixtureRoot) {
  return loadValidFixturesById(fixtureRoot, "finding-remediation-guidance", isFindingRemediationGuidanceLike, "remediation_guidance_id");
}

async function loadCustomerStatusesByRef(fixtureRoot) {
  return loadValidFixturesById(fixtureRoot, "customer-remediation-status-record", isCustomerRemediationStatusRecordLike, "customer_status_record_id");
}

async function loadAcceptedRisksByRef(fixtureRoot) {
  return loadValidFixturesById(fixtureRoot, "accepted-risk-record", isAcceptedRiskRecordLike, "accepted_risk_record_id");
}

async function loadFalsePositivesByRef(fixtureRoot) {
  return loadValidFixturesById(fixtureRoot, "false-positive-record", isFalsePositiveRecordLike, "false_positive_record_id");
}

async function loadValidFixturesById(fixtureRoot, filePrefix, isLike, idField) {
  const records = new Map();
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return records;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith(filePrefix)) {
      continue;
    }
    try {
      const record = await readJson(file);
      if (isLike(record) && typeof record[idField] === "string") {
        records.set(record[idField], record);
      }
    } catch {
      // Broken fixtures are reported through the normal fixture validation path.
    }
  }
  return records;
}

async function loadValidationPathsByRef(fixtureRoot) {
  const records = new Map();
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return records;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith("finding-validation-path")) {
      continue;
    }
    try {
      const record = await readJson(file);
      if (isFindingValidationPathLike(record) && typeof record.validation_path_id === "string") {
        records.set(record.validation_path_id, record);
      }
    } catch {
      // Broken fixtures are reported through the normal fixture validation path.
    }
  }
  return records;
}

async function loadValidationScriptsByRef(fixtureRoot) {
  const records = new Map();
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return records;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith("reviewer-validation-script")) {
      continue;
    }
    try {
      const record = await readJson(file);
      if (isReviewerValidationScriptLike(record) && typeof record.validation_script_id === "string") {
        records.set(record.validation_script_id, record);
      }
    } catch {
      // Broken fixtures are reported through the normal fixture validation path.
    }
  }
  return records;
}

function valuesAtPath(value, pathText) {
  const parts = pathText.split(".");
  let values = [value];
  for (const part of parts) {
    const next = [];
    for (const item of values) {
      if (Array.isArray(item)) {
        for (const child of item) {
          if (child && typeof child === "object" && !Array.isArray(child) && child[part] !== undefined) {
            next.push(child[part]);
          }
        }
      } else if (item && typeof item === "object" && !Array.isArray(item) && item[part] !== undefined) {
        next.push(item[part]);
      }
    }
    values = next;
  }
  return values;
}

function verificationScopeTextHasForbiddenContent(value) {
  if (Array.isArray(value)) {
    return value.some((item) => verificationScopeTextHasForbiddenContent(item));
  }
  if (typeof value !== "string") {
    return false;
  }
  for (const phrase of SECRET_FORBIDDEN_PHRASES) {
    if (sharedForbiddenPhrasePresent(value, phrase)) {
      return true;
    }
  }
  if (customerVisibleTextForbidden(value) !== undefined) {
    return true;
  }
  return verificationScopeTextHasClosureClaim(value);
}

function collectVerificationScopeTextViolations(value, field, label, errors) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVerificationScopeTextViolations(item, field, label, errors);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  for (const phrase of SECRET_FORBIDDEN_PHRASES) {
    if (sharedForbiddenPhrasePresent(value, phrase)) {
      errors.push({
        code: "verification_scope_raw_source_text_forbidden",
        message: `${label} ${field} must not include raw source, scanner output, secrets, or token-like text`
      });
      return;
    }
  }
  if (customerVisibleTextForbidden(value) !== undefined) {
    errors.push({
      code: "verification_scope_claim_unsafe_text_forbidden",
      message: `${label} ${field} must not imply fresh review, assurance, acceptance, certification, audit-readiness, security-guarantee, or absence-of-vulnerabilities claims`
    });
    return;
  }
  if (verificationScopeTextHasClosureClaim(value)) {
    errors.push({
      code: "verification_scope_claim_unsafe_text_forbidden",
      message: `${label} ${field} must not imply fixed, verified, remediated, resolved, or complete status`
    });
  }
}

function verificationScopeTextHasClosureClaim(value) {
  if (typeof value !== "string") {
    return false;
  }
  const normalizedValue = normalizeSharedForbiddenText(value);
  if (verificationScopeIsTypedIdentityReference(normalizedValue)) {
    return false;
  }
  for (const clause of normalizedValue.split(/[.;!?]+/u).map((part) => part.trim()).filter(Boolean)) {
    for (const phrase of CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES) {
      const normalizedPhrase = normalizeSharedForbiddenText(phrase);
      const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const hasLeadingBoundary = /^[a-z0-9]/u.test(normalizedPhrase);
      const prefix = hasLeadingBoundary ? "(^|[^a-z0-9])" : "";
      const suffix = /[a-z0-9]$/u.test(normalizedPhrase) ? "(?:$|[^a-z0-9])" : "";
      const occurrence = new RegExp(`${prefix}${escaped}${suffix}`, "gu");
      let match;
      while ((match = occurrence.exec(clause)) !== null) {
        const boundaryPrefix = hasLeadingBoundary ? String(match[1] ?? "") : "";
        const phraseStart = match.index + boundaryPrefix.length;
        const leadingWindow = clause.slice(Math.max(0, phraseStart - 64), phraseStart).trimEnd();
        if (leadingWindow.length > 0) {
          const leadingTail = leadingWindow.split(/(?:,|;|\band\b|\bbut\b|\bhowever\b|\bthough\b|\byet\b)/u).at(-1)?.trim() ?? "";
          if (/(?:\bnot|\bno|\bnever|\bwithout|\bdoes not|\bdo not|\bcannot|\bis not|\bwas not|\bhas not been)(?:\s+[^,;.!?]{0,40})?$/u.test(leadingTail)) {
            continue;
          }
        }
        return true;
      }
    }
  }
  return false;
}

function verificationScopeIsTypedIdentityReference(value) {
  const match = /^([a-z_]+):([a-z0-9][a-z0-9_-]{2,63})$/u.exec(value.trim());
  return match !== null && CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES.includes(match[1]);
}

function parseUtcTimestamp(value) {
  if (typeof value !== "string" || !isUtcRfc3339Timestamp(value)) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseUtcTimestampNs(value) {
  if (typeof value !== "string" || !isUtcRfc3339Timestamp(value)) {
    return undefined;
  }
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|\+00:00)$/u.exec(value);
  if (match === null) {
    return undefined;
  }
  const wholeSeconds = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(wholeSeconds)) {
    return undefined;
  }
  const fractional = BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  return BigInt(wholeSeconds) * 1_000_000n + fractional;
}

function isCustomerRemediationStatusRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.customer_status_record_id === "string" || typeof value.customer_remediation_status === "string")
  );
}

function customerStatusLabel(value, label) {
  return typeof value.customer_status_record_id === "string" && value.customer_status_record_id.length > 0
    ? `${label} ${value.customer_status_record_id}`
    : `${label} <missing customer_status_record_id>`;
}

export function validateCustomerRemediationStatusRecordSemantics(value, errors, label = "customer remediation status record") {
  if (!isCustomerRemediationStatusRecordLike(value)) {
    return;
  }

  const displayLabel = customerStatusLabel(value, label);
  if (!CUSTOMER_REMEDIATION_STATUS_ALLOWED_VALUES.has(value.customer_remediation_status)) {
    errors.push({
      code: "customer_remediation_status_allowed_required",
      message: `${displayLabel} must use the bounded customer remediation status vocabulary`
    });
  }
  if (!value.actor || typeof value.actor !== "object" || Array.isArray(value.actor) || value.actor.actor_type !== "customer_user") {
    errors.push({
      code: "customer_remediation_status_customer_actor_required",
      message: `${displayLabel} must be authored by a customer_user actor`
    });
  }
  if (typeof value.finding_ref !== "string" && typeof value.classification_record_ref !== "string") {
    errors.push({
      code: "customer_remediation_status_finding_ref_required",
      message: `${displayLabel} must reference a finding or classification record without rewriting it`
    });
  }
  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "customer_remediation_status_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  for (const field of CUSTOMER_STATUS_FORBIDDEN_FIELDS) {
    if (value[field] !== undefined) {
      errors.push({
        code: "customer_remediation_status_rewrite_forbidden",
        message: `${displayLabel} must not carry ${field}; expert classification and reviewer guidance remain separate records`
      });
    }
  }
  if (typeof value.due_date === "string" && !isIsoCalendarDate(value.due_date)) {
    errors.push({
      code: "customer_remediation_status_due_date_invalid",
      message: `${displayLabel} due_date must be a valid ISO calendar date`
    });
  }
  for (const field of CUSTOMER_STATUS_TEXT_FIELDS) {
    collectRemediationTextViolations(value[field], field, displayLabel, errors, "customer_remediation_status");
  }
}

function isCustomerFacingFindingRecordLike(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (typeof value.customer_facing_finding_record_id === "string" || value.expert_classification !== undefined)
  );
}

function customerFacingFindingLabel(value, label) {
  return typeof value.customer_facing_finding_record_id === "string" && value.customer_facing_finding_record_id.length > 0
    ? `${label} ${value.customer_facing_finding_record_id}`
    : `${label} <missing customer_facing_finding_record_id>`;
}

export function validateCustomerFacingFindingRecordSemantics(value, errors, label = "customer-facing finding record") {
  if (!isCustomerFacingFindingRecordLike(value)) {
    return;
  }

  const displayLabel = customerFacingFindingLabel(value, label);
  const expert = value.expert_classification && typeof value.expert_classification === "object" && !Array.isArray(value.expert_classification)
    ? value.expert_classification
    : {};
  const guidance = value.reviewer_remediation_guidance && typeof value.reviewer_remediation_guidance === "object" && !Array.isArray(value.reviewer_remediation_guidance)
    ? value.reviewer_remediation_guidance
    : {};
  const customerStatus = value.customer_remediation_status && typeof value.customer_remediation_status === "object" && !Array.isArray(value.customer_remediation_status)
    ? value.customer_remediation_status
    : {};
  const verification = value.verification_state && typeof value.verification_state === "object" && !Array.isArray(value.verification_state)
    ? value.verification_state
    : {};
  const future = value.future_outcome_visibility && typeof value.future_outcome_visibility === "object" && !Array.isArray(value.future_outcome_visibility)
    ? value.future_outcome_visibility
    : {};

  if (value.source_derived_class !== "retained_review_artifact") {
    errors.push({
      code: "customer_facing_finding_source_class_required",
      message: `${displayLabel} must declare source_derived_class retained_review_artifact`
    });
  }
  if (value.visibility !== "customer_facing") {
    errors.push({
      code: "customer_facing_finding_visibility_required",
      message: `${displayLabel} must be explicitly customer_facing when projected for customers`
    });
  }
  if (typeof value.ambiguous_status === "string" || typeof value.status === "string" || typeof value.remediation_status === "string") {
    errors.push({
      code: "customer_facing_finding_status_separation_required",
      message: `${displayLabel} must not collapse expert, customer remediation, and verification state into one status`
    });
  }
  if (typeof value.classification_record_ref === "string" && expert.classification_record_ref !== value.classification_record_ref) {
    errors.push({
      code: "customer_facing_finding_reference_mismatch",
      message: `${displayLabel} top-level classification reference must match the expert classification section`
    });
  }
  if (typeof value.remediation_guidance_ref === "string" && guidance.remediation_guidance_ref !== value.remediation_guidance_ref) {
    errors.push({
      code: "customer_facing_finding_reference_mismatch",
      message: `${displayLabel} top-level remediation guidance reference must match the reviewer guidance section`
    });
  }
  if ((typeof value.verification_record_ref === "string" || typeof verification.verification_record_ref === "string") && verification.verification_record_ref !== value.verification_record_ref) {
    errors.push({
      code: "customer_facing_finding_reference_mismatch",
      message: `${displayLabel} top-level verification reference must match the verification section`
    });
  }
  const acceptedRiskTopLevelMatches = future.accepted_risk_record_ref === value.accepted_risk_record_ref;
  const falsePositiveTopLevelMatches = future.false_positive_record_ref === value.false_positive_record_ref;
  if ((typeof value.accepted_risk_record_ref === "string" || typeof future.accepted_risk_record_ref === "string") && !acceptedRiskTopLevelMatches) {
    errors.push({
      code: "customer_facing_finding_reference_mismatch",
      message: `${displayLabel} top-level accepted-risk reference must match the future outcome section`
    });
  }
  if ((typeof value.false_positive_record_ref === "string" || typeof future.false_positive_record_ref === "string") && !falsePositiveTopLevelMatches) {
    errors.push({
      code: "customer_facing_finding_reference_mismatch",
      message: `${displayLabel} top-level false-positive reference must match the future outcome section`
    });
  }
  const evidenceRefs = value.evidence_basis && typeof value.evidence_basis === "object" && !Array.isArray(value.evidence_basis) && Array.isArray(value.evidence_basis.evidence_refs)
    ? value.evidence_basis.evidence_refs
    : [];
  if (evidenceRefs.length === 0) {
    errors.push({
      code: "customer_facing_finding_evidence_ref_required",
      message: `${displayLabel} must preserve at least one evidence reference`
    });
  }
  if (typeof customerStatus.latest_status_record_ref === "string") {
    const statusRefs = Array.isArray(value.customer_status_record_refs) ? value.customer_status_record_refs : [];
    if (!statusRefs.includes(customerStatus.latest_status_record_ref)) {
      errors.push({
        code: "customer_facing_finding_reference_mismatch",
        message: `${displayLabel} latest_status_record_ref must be listed in customer_status_record_refs`
      });
    }
  }
  if (guidance.guidance_status === "actionable_guidance_provided") {
    // Exploitability rationale is only required for likely/confirmed guidance, matching the
    // source guidance rule (remediation_guidance_exploitability_rationale_required). For
    // requires_customer_side_validation actionable guidance the runtime projects a record with
    // no rationale summary, so demanding it here would reject an artifact the runtime emits.
    const requiresExploitabilityRationale = expert.classification === "likely" || expert.classification === "confirmed";
    if (
      !isMeaningfulRemediationText(guidance.suggested_remediation_summary) ||
      !isMeaningfulRemediationText(guidance.validation_step_summary) ||
      (requiresExploitabilityRationale && !isMeaningfulRemediationText(guidance.exploitability_rationale_summary))
    ) {
      errors.push({
        code: "customer_facing_finding_guidance_actionable_details_required",
        message: `${displayLabel} actionable customer-facing guidance must preserve remediation and validation detail, plus exploitability rationale for likely or confirmed findings`
      });
    }
  }
  if (guidance.guidance_status === "limited_guidance_requires_validation" || guidance.guidance_status === "guidance_unavailable_from_submitted_evidence") {
    if (!isMeaningfulRemediationText(guidance.insufficient_evidence_reason)) {
      errors.push({
        code: "customer_facing_finding_guidance_insufficient_evidence_reason_required",
        message: `${displayLabel} limited or unavailable customer-facing guidance must preserve the insufficient-evidence reason`
      });
    }
    if (!isMeaningfulRemediationText(guidance.next_step_summary) && !isMeaningfulRemediationText(guidance.validation_path_summary) && typeof guidance.validation_path_ref !== "string") {
      errors.push({
        code: "customer_facing_finding_guidance_next_step_required",
        message: `${displayLabel} limited or unavailable customer-facing guidance must preserve a next step or validation handoff`
      });
    }
  }
  if ((verification.status === "verification_complete" || verification.status === "verified_with_evidence") && typeof verification.verification_record_ref !== "string") {
    errors.push({
      code: "customer_facing_finding_verification_reference_required",
      message: `${displayLabel} verification-complete status requires an explicit verification record reference`
    });
  }
  const acceptedRiskFutureRefConsistent = future.accepted_risk_visible === (typeof future.accepted_risk_record_ref === "string");
  const falsePositiveFutureRefConsistent = future.false_positive_visible === (typeof future.false_positive_record_ref === "string");
  if (!acceptedRiskFutureRefConsistent) {
    errors.push({
      code: "customer_facing_finding_future_outcome_reference_required",
      message: `${displayLabel} accepted-risk visibility and its later record reference must agree`
    });
  }
  if (!falsePositiveFutureRefConsistent) {
    errors.push({
      code: "customer_facing_finding_future_outcome_reference_required",
      message: `${displayLabel} false-positive visibility and its later record reference must agree`
    });
  }
  const acceptedRiskOutcome = value.accepted_risk_outcome && typeof value.accepted_risk_outcome === "object" && !Array.isArray(value.accepted_risk_outcome)
    ? value.accepted_risk_outcome
    : undefined;
  const falsePositiveOutcome = value.false_positive_outcome && typeof value.false_positive_outcome === "object" && !Array.isArray(value.false_positive_outcome)
    ? value.false_positive_outcome
    : undefined;
  if (future.accepted_risk_visible === true && acceptedRiskFutureRefConsistent && acceptedRiskTopLevelMatches && typeof value.accepted_risk_record_ref === "string") {
    if (acceptedRiskOutcome === undefined || acceptedRiskOutcome.accepted_risk_record_ref !== future.accepted_risk_record_ref || acceptedRiskOutcome.accepted_risk_record_ref !== value.accepted_risk_record_ref) {
      errors.push({
        code: "customer_facing_finding_outcome_section_required",
        message: `${displayLabel} visible accepted-risk records must have a matching accepted_risk_outcome section`
      });
    }
  } else if (acceptedRiskOutcome !== undefined && future.accepted_risk_visible !== true) {
    errors.push({
      code: "customer_facing_finding_outcome_section_required",
      message: `${displayLabel} accepted_risk_outcome must not appear when accepted risk is hidden`
    });
  }
  if (future.false_positive_visible === true && falsePositiveFutureRefConsistent && falsePositiveTopLevelMatches && typeof value.false_positive_record_ref === "string") {
    if (falsePositiveOutcome === undefined || falsePositiveOutcome.false_positive_record_ref !== future.false_positive_record_ref || falsePositiveOutcome.false_positive_record_ref !== value.false_positive_record_ref) {
      errors.push({
        code: "customer_facing_finding_outcome_section_required",
        message: `${displayLabel} visible false-positive records must have a matching false_positive_outcome section`
      });
    }
  } else if (falsePositiveOutcome !== undefined && future.false_positive_visible !== true) {
    errors.push({
      code: "customer_facing_finding_outcome_section_required",
      message: `${displayLabel} false_positive_outcome must not appear when false positive is hidden`
    });
  }
  if (acceptedRiskOutcome !== undefined) {
    if (!Array.isArray(acceptedRiskOutcome.evidence_refs) || acceptedRiskOutcome.evidence_refs.length === 0 || !isMeaningfulRemediationText(acceptedRiskOutcome.evidence_basis_summary) || !isMeaningfulRemediationText(acceptedRiskOutcome.customer_acceptance_summary)) {
      errors.push({
        code: "customer_facing_finding_outcome_details_required",
        message: `${displayLabel} accepted-risk outcome must preserve evidence basis and customer acceptance summary`
      });
    }
    if (acceptedRiskOutcome.evidence_consumer_export !== "include" && acceptedRiskOutcome.evidence_consumer_export !== "exclude") {
      errors.push({
        code: "customer_facing_finding_outcome_export_required",
        message: `${displayLabel} accepted-risk outcome must declare evidence-consumer export posture`
      });
    }
  }
  if (falsePositiveOutcome !== undefined) {
    if (!Array.isArray(falsePositiveOutcome.evidence_refs) || falsePositiveOutcome.evidence_refs.length === 0 || !isMeaningfulRemediationText(falsePositiveOutcome.evidence_basis_summary) || !isMeaningfulRemediationText(falsePositiveOutcome.rationale_summary)) {
      errors.push({
        code: "customer_facing_finding_outcome_details_required",
        message: `${displayLabel} false-positive outcome must preserve evidence basis and reviewer rationale summary`
      });
    }
    if (falsePositiveOutcome.actor_category !== "reviewer") {
      errors.push({
        code: "customer_facing_finding_outcome_details_required",
        message: `${displayLabel} false-positive outcome actor category must remain reviewer`
      });
    }
    if (falsePositiveOutcome.evidence_consumer_export !== "include" && falsePositiveOutcome.evidence_consumer_export !== "exclude") {
      errors.push({
        code: "customer_facing_finding_outcome_export_required",
        message: `${displayLabel} false-positive outcome must declare evidence-consumer export posture`
      });
    }
  }
  if (customerStatus.customer_notes_visible === false && typeof customerStatus.customer_notes_summary === "string") {
    errors.push({
      code: "customer_facing_finding_customer_notes_export_forbidden",
      message: `${displayLabel} must not include hidden customer notes in customer-facing or evidence-consumer projection copy`
    });
  }
  if (typeof customerStatus.due_date === "string" && !isIsoCalendarDate(customerStatus.due_date)) {
    errors.push({
      code: "customer_facing_finding_due_date_invalid",
      message: `${displayLabel} customer due_date must be a valid ISO calendar date`
    });
  }

  const validationPaths = Array.isArray(value.validation_paths)
    ? value.validation_paths.filter((pathRecord) => pathRecord && typeof pathRecord === "object" && !Array.isArray(pathRecord))
    : [];
  const validationScripts = Array.isArray(value.reviewer_validation_scripts)
    ? value.reviewer_validation_scripts.filter((script) => script && typeof script === "object" && !Array.isArray(script))
    : [];
  const validationScriptsByRef = new Map(validationScripts
    .filter((script) => typeof script.validation_script_ref === "string")
    .map((script) => [script.validation_script_ref, script]));
  const validationPathsByRef = new Map(validationPaths
    .filter((pathRecord) => typeof pathRecord.validation_path_ref === "string")
    .map((pathRecord) => [pathRecord.validation_path_ref, pathRecord]));
  for (const pathRecord of validationPaths) {
    const hasRemoteFields = pathRecord.target !== undefined || pathRecord.authorization_assumption !== undefined || pathRecord.method !== undefined || pathRecord.safety_constraints !== undefined || pathRecord.evidence_artifacts_to_collect !== undefined;
    if (pathRecord.path_type === "remote_dynamic_testing") {
      if (!isMeaningfulRemediationText(pathRecord.target) || !isMeaningfulRemediationText(pathRecord.authorization_assumption) || !isMeaningfulRemediationText(pathRecord.method) || !isMeaningfulRemediationText(pathRecord.safety_constraints) || !Array.isArray(pathRecord.evidence_artifacts_to_collect) || pathRecord.evidence_artifacts_to_collect.length === 0) {
        errors.push({
          code: "customer_facing_finding_reference_mismatch",
          message: `${displayLabel} remote dynamic testing paths must preserve target, authorization, method, safety, and evidence collection details`
        });
      }
    } else if (hasRemoteFields) {
      errors.push({
        code: "customer_facing_finding_reference_mismatch",
        message: `${displayLabel} non-remote validation paths must not carry remote dynamic testing fields`
      });
    }
    const scriptRefs = Array.isArray(pathRecord.reviewer_validation_script_refs) ? pathRecord.reviewer_validation_script_refs : [];
    if (pathRecord.path_type === "customer_run_script") {
      if (scriptRefs.length === 0) {
        errors.push({
          code: "customer_facing_finding_reference_mismatch",
          message: `${displayLabel} customer-run script paths must preserve reviewer script refs`
        });
      }
      for (const ref of scriptRefs) {
        const script = validationScriptsByRef.get(ref);
        if (script === undefined || script.validation_path_ref !== pathRecord.validation_path_ref) {
          errors.push({
            code: "customer_facing_finding_reference_mismatch",
            message: `${displayLabel} validation path script refs must resolve back to the same path`
          });
          break;
        }
      }
    } else if (pathRecord.reviewer_validation_script_refs !== undefined) {
      errors.push({
        code: "customer_facing_finding_reference_mismatch",
        message: `${displayLabel} non-script validation paths must not carry reviewer script refs`
      });
    }
    if (pathRecord.path_type === "manual_steps" && !isMeaningfulRemediationText(pathRecord.output_attachment_instructions)) {
      errors.push({
        code: "customer_facing_finding_reference_mismatch",
        message: `${displayLabel} manual validation paths must preserve output attachment instructions`
      });
    }
  }
  for (const script of validationScripts) {
    const pathRecord = typeof script.validation_path_ref === "string" ? validationPathsByRef.get(script.validation_path_ref) : undefined;
    const pathScriptRefs = Array.isArray(pathRecord?.reviewer_validation_script_refs) ? pathRecord.reviewer_validation_script_refs : [];
    if (pathRecord === undefined || pathRecord.path_type !== "customer_run_script" || !pathScriptRefs.includes(script.validation_script_ref)) {
      errors.push({
        code: "customer_facing_finding_reference_mismatch",
        message: `${displayLabel} reviewer validation scripts must point to customer-run script paths that list them`
      });
    }
    if (script.script_package_status === "additional_script_candidate_pricing_tbd") {
      const pricingCopy = [script.pricing_note, script.purpose, script.prerequisites, script.execution_steps, script.expected_output, script.safety_notes, script.output_attachment_instructions, script.script_content].filter((item) => typeof item === "string").join(" ");
      if (!/pricing\s+tbd/iu.test(pricingCopy)) {
        errors.push({
          code: "customer_facing_finding_script_pricing_tbd_required",
          message: `${displayLabel} additional validation script candidates must preserve customer-visible pricing TBD copy`
        });
      }
    }
  }

  for (const field of CUSTOMER_FACING_FINDING_TEXT_FIELDS) {
    collectRemediationTextViolations(valueAtPath(value, field), field, displayLabel, errors, "customer_facing_finding");
  }
}

function isMeaningfulRemediationText(value) {
  return typeof value === "string" && value.trim().length >= 12;
}

function isMeaningfulVerificationScopeReason(value) {
  return typeof value === "string" && value.trim().length >= 12 && value.trim().split(/\s+/u).filter(Boolean).length >= 3;
}

// `detectSourceCodeLikeText` is opt-in (only the review-event `reason` call
// site sets it) because this helper is also used for reviewer-validation-script
// text, which intentionally contains code.
function collectRemediationTextViolations(value, field, label, errors, prefix, detectSourceCodeLikeText = false) {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    for (const phrase of SECRET_FORBIDDEN_PHRASES) {
      if (sharedForbiddenPhrasePresent(value, phrase)) {
        errors.push({
          code: `${prefix}_raw_source_text_forbidden`,
          message: `${label} ${field} must not include raw source, scanner output, secrets, or token-like text`
        });
        return;
      }
    }
    if (detectSourceCodeLikeText && sourceCodeLikeTextReason(value) !== undefined) {
      errors.push({
        code: `${prefix}_raw_source_text_forbidden`,
        message: `${label} ${field} must not include source-code-like text`
      });
      return;
    }
    if (customerVisibleTextForbidden(value) !== undefined) {
      errors.push({
        code: `${prefix}_claim_unsafe_text_forbidden`,
        message: `${label} ${field} must not imply assurance, acceptance, certification, audit-readiness, security-guarantee, or absence-of-vulnerabilities claims`
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRemediationTextViolations(item, field, label, errors, prefix, detectSourceCodeLikeText);
    }
  }
}

function valueAtPath(value, dottedPath) {
  const parts = dottedPath.split(".");
  return valueAtPathParts(value, parts);
}

function valueAtPathParts(value, parts) {
  if (parts.length === 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => valueAtPathParts(item, parts));
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const [part, ...remaining] = parts;
  return valueAtPathParts(value[part], remaining);
}

function isIsoCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) {
    return false;
  }
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

async function loadVendorReceiptsById(fixtureRoot) {
  const receipts = new Map();
  if (typeof fixtureRoot !== "string") {
    return receipts;
  }
  const directories = [path.join(fixtureRoot, "v0", "valid"), path.join(fixtureRoot, "v0", "support")];
  for (const directory of directories) {
    let files;
    try {
      files = await listFiles(directory);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json") || !path.basename(file).startsWith("vendor-receipt")) {
        continue;
      }
      try {
        const receipt = await readJson(file);
        if (receipt && typeof receipt === "object" && typeof receipt.vendor_receipt_id === "string" && !receipts.has(receipt.vendor_receipt_id)) {
          receipts.set(receipt.vendor_receipt_id, receipt);
        }
      } catch {
        // A broken fixture is reported by the normal fixture reader; this lookup is best-effort.
      }
    }
  }
  return receipts;
}

async function validateSubmissionReviewEventOutcomeReferences(value, options, errors) {
  const events = [];
  if (isReviewEventLike(value)) {
    events.push(value);
  } else if (isReviewEventLogLike(value)) {
    events.push(...value.events.filter((event) => isReviewEventLike(event)));
  }
  const submissionEvents = events.filter((event) => event.event_type === "submission_rejected" || event.event_type === "submission_quarantined");
  if (submissionEvents.length === 0) {
    return;
  }

  const outcomesByRef = await loadSubmissionOutcomesByArtifactRef(options.fixtureRoot);
  for (const event of submissionEvents) {
    const outcomeRefs = (Array.isArray(event.artifact_refs) ? event.artifact_refs : [])
      .map((ref) => outcomesByRef.get(ref))
      .filter((outcome) => outcome !== undefined);

    if (outcomeRefs.length === 0) {
      errors.push({
        code: "submission_event_missing_outcome_ref",
        message: `submission event ${event.event_id} must reference its submission-outcome artifact`
      });
      continue;
    }

    for (const outcome of outcomeRefs) {
      const expectedType = outcome.outcome_state === "rejected_no_receipt"
        ? "submission_rejected"
        : outcome.outcome_state === "quarantined_no_receipt"
          ? "submission_quarantined"
          : undefined;
      if (expectedType === undefined) {
        errors.push({
          code: "submission_event_state_not_a_failure",
          message: `submission event ${event.event_id} references a received outcome that has no failure event type`
        });
      } else if (event.event_type !== expectedType) {
        errors.push({
          code: "submission_event_type_state_mismatch",
          message: `submission event ${event.event_id} type does not match referenced outcome state`
        });
      }

      const expectedKey = `submission_attempt:${outcome.bundle_instance_id}:${outcome.submission_attempt_id}`;
      if (event.idempotency_key !== expectedKey) {
        errors.push({
          code: "submission_event_idempotency_key_not_derived",
          message: `submission event ${event.event_id} idempotency_key must derive from bundle and attempt identity`
        });
      }
    }
  }
}

async function loadSubmissionOutcomesByArtifactRef(fixtureRoot) {
  const outcomes = new Map();
  if (typeof fixtureRoot !== "string") {
    return outcomes;
  }
  let files;
  try {
    files = await listFiles(path.join(fixtureRoot, "v0", "valid"));
  } catch {
    return outcomes;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || !path.basename(file).startsWith("submission-outcome.")) {
      continue;
    }
    try {
      const outcome = await readJson(file);
      if (isSubmissionOutcomeLike(outcome)) {
        outcomes.set(`artifact_ref:${outcome.submission_outcome_id.slice("submission_outcome:".length)}`, outcome);
      }
    } catch {
      // A broken fixture is reported by the normal fixture reader; this lookup is best-effort.
    }
  }
  return outcomes;
}

// C7-16: entry.fixture_path / entry.identity_input_path came straight from
// the invariants document and were joined onto fixtureRoot unchecked, so a
// traversing or absolute entry could pull a canonical-identity input from
// outside the fixture root.
export async function verifyCanonicalIdentity(entry, fixtureRoot) {
  const errors = [];
  const fixture = await readJson(resolveUnderRoot(fixtureRoot, entry.fixture_path, "canonical identity fixture path"));
  const identityInput = await readJson(resolveUnderRoot(fixtureRoot, entry.identity_input_path, "canonical identity input path"));
  const digestIdentity = sha256IdFromCanonical(identityInput);
  const computedIdentity = typeof entry.identity_namespace === "string" ? `${entry.identity_namespace}:${digestIdentity.slice("sha256:".length)}` : digestIdentity;

  if (entry.canonicalization !== "rfc8785") {
    errors.push({ code: "canonicalization", message: `${entry.fixture_path} must use rfc8785 canonicalization` });
  }
  if (entry.hash_algorithm !== "sha256") {
    errors.push({ code: "hash_algorithm", message: `${entry.fixture_path} must use sha256 identity hashing` });
  }
  const excludedIdentityFields = Array.isArray(entry.identity_input_excludes) ? entry.identity_input_excludes : [entry.identity_field];
  for (const excludedField of excludedIdentityFields) {
    if (identityInput[excludedField] !== undefined) errors.push({ code: "self_referential_identity", message: `${entry.identity_input_path} must exclude ${excludedField}` });
  }
  if (computedIdentity !== entry.expected_identity) {
    errors.push({
      code: "identity_mismatch",
      message: `${entry.identity_input_path} canonical identity drifted: expected ${entry.expected_identity}, got ${computedIdentity}`
    });
  }
  if (fixture[entry.identity_field] !== entry.expected_identity) {
    errors.push({
      code: "identity_field_mismatch",
      message: `${entry.fixture_path} ${entry.identity_field} must equal ${entry.expected_identity}`
    });
  }

  return errors;
}

function inspectSchemaNode(schema, location, errors) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }

  if (schema.type === "object" && schema.properties) {
    if (schema.additionalProperties !== false) {
      errors.push({ code: "schema_open_object", message: `${location} object schemas with properties must set additionalProperties: false` });
    }
    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      if (!isSnakeCase(propertyName)) {
        errors.push({ code: "schema_field_case", message: `${location} property ${propertyName} must be snake_case` });
      }
      inspectSchemaNode(propertySchema, `${location}.properties.${propertyName}`, errors);
    }
  }

  if (schema.items) {
    inspectSchemaNode(schema.items, `${location}.items`, errors);
  }
  if (schema.contains) inspectSchemaNode(schema.contains, `${location}.contains`, errors);
  for (const key of ["if", "then", "else", "not"]) {
    if (schema[key]) inspectSchemaNode(schema[key], `${location}.${key}`, errors);
  }
  if (schema.dependentSchemas) {
    for (const [propertyName, dependentSchema] of Object.entries(schema.dependentSchemas)) {
      inspectSchemaNode(dependentSchema, `${location}.dependentSchemas.${propertyName}`, errors);
    }
  }
  for (const key of ["$defs", "oneOf", "anyOf", "allOf"]) {
    const nested = schema[key];
    if (Array.isArray(nested)) {
      nested.forEach((item, index) => inspectSchemaNode(item, `${location}.${key}[${index}]`, errors));
    } else if (nested && typeof nested === "object") {
      for (const [nestedKey, nestedSchema] of Object.entries(nested)) {
        inspectSchemaNode(nestedSchema, `${location}.${key}.${nestedKey}`, errors);
      }
    }
  }
}

function validateSchemaValue(value, schema, schemaMap, location, errors) {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, schemaMap);
    if (!resolved) {
      errors.push({ code: "unresolved_ref", message: `${location} uses unresolved schema ref ${schema.$ref}` });
      return;
    }
    validateSchemaValue(value, resolved, schemaMap, location, errors);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const childSchema of schema.allOf) {
      validateSchemaValue(value, childSchema, schemaMap, location, errors);
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.filter((candidate) => {
      const candidateErrors = [];
      validateSchemaValue(value, candidate, schemaMap, location, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches === 0) errors.push({ code: "any_of", message: `${location} must match at least one anyOf branch` });
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateErrors = [];
      validateSchemaValue(value, candidate, schemaMap, location, candidateErrors);
      return candidateErrors.length === 0;
    }).length;
    if (matches !== 1) errors.push({ code: "one_of", message: `${location} must match exactly one oneOf branch` });
  }

  if (schema.not) {
    const notErrors = [];
    validateSchemaValue(value, schema.not, schemaMap, location, notErrors);
    if (notErrors.length === 0) errors.push({ code: "not", message: `${location} must not match the forbidden schema` });
  }

  if (schema.if) {
    const ifErrors = [];
    validateSchemaValue(value, schema.if, schemaMap, location, ifErrors);
    if (ifErrors.length === 0 && schema.then) {
      validateSchemaValue(value, schema.then, schemaMap, location, errors);
    } else if (ifErrors.length > 0 && schema.else) {
      validateSchemaValue(value, schema.else, schemaMap, location, errors);
    }
  }

  if (schema.const !== undefined && !jsonValueEquals(value, schema.const)) {
    errors.push({ code: "const", message: `${location} must equal ${JSON.stringify(schema.const)}` });
  }

  if (schema.enum && !schema.enum.some((item) => jsonValueEquals(value, item))) {
    errors.push({ code: "enum", message: `${location} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}` });
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push({ code: "type", message: `${location} must be ${schema.type}` });
    return;
  }

  if (schema.type === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push({ code: "min_length", message: `${location} must be at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push({ code: "max_length", message: `${location} must be at most ${schema.maxLength} characters` });
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      errors.push({ code: "pattern", message: `${location} does not match ${schema.pattern}` });
    }
    if (schema.pattern === "^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\\.[0-9]{1,9})?(?:Z|\\+00:00)$" && !isUtcRfc3339Timestamp(value)) {
      errors.push({ code: "utc_rfc3339_timestamp", message: `${location} must be a valid UTC RFC 3339 calendar timestamp` });
    }
  }

  if (schema.type === "integer" || schema.type === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ code: "minimum", message: `${location} must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ code: "maximum", message: `${location} must be <= ${schema.maximum}` });
    }
  }

  const hasArrayKeywords = schema.minItems !== undefined || schema.maxItems !== undefined || schema.uniqueItems !== undefined || schema.items !== undefined || schema.contains !== undefined;
  if (schema.type === "array" || (hasArrayKeywords && Array.isArray(value))) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ code: "min_items", message: `${location} must contain at least ${schema.minItems} item(s)` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ code: "max_items", message: `${location} must contain at most ${schema.maxItems} item(s)` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const [index, item] of value.entries()) {
        const key = canonicalize(item);
        if (seen.has(key)) {
          errors.push({ code: "unique_items", message: `${location}[${index}] duplicates an earlier array item` });
          break;
        }
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchemaValue(item, schema.items, schemaMap, `${location}[${index}]`, errors));
    }
    if (schema.contains) {
      const matches = value.filter((item, index) => {
        const containsErrors = [];
        validateSchemaValue(item, schema.contains, schemaMap, `${location}[${index}]`, containsErrors);
        return containsErrors.length === 0;
      }).length;
      const minimum = schema.minContains ?? 1;
      if (matches < minimum) errors.push({ code: "contains", message: `${location} must contain at least ${minimum} matching item(s)` });
      if (schema.maxContains !== undefined && matches > schema.maxContains) errors.push({ code: "max_contains", message: `${location} must contain at most ${schema.maxContains} matching item(s)` });
    }
  }

  const hasObjectKeywords = schema.required !== undefined || schema.dependentRequired !== undefined || schema.dependentSchemas !== undefined || schema.properties !== undefined || schema.additionalProperties !== undefined;
  if (schema.type === "object" || (hasObjectKeywords && value !== null && typeof value === "object" && !Array.isArray(value))) {
    const required = schema.required ?? [];
    for (const requiredProperty of required) {
      if (value[requiredProperty] === undefined) {
        errors.push({ code: "required", message: `${location}.${requiredProperty} is required` });
      }
    }

    const dependentRequired = schema.dependentRequired ?? {};
    for (const [propertyName, dependentProperties] of Object.entries(dependentRequired)) {
      if (value[propertyName] !== undefined) {
        for (const dependentProperty of dependentProperties) {
          if (value[dependentProperty] === undefined) {
            errors.push({ code: "dependent_required", message: `${location}.${dependentProperty} is required when ${location}.${propertyName} is present` });
          }
        }
      }
    }

    const dependentSchemas = schema.dependentSchemas ?? {};
    for (const [propertyName, dependentSchema] of Object.entries(dependentSchemas)) {
      if (value[propertyName] !== undefined) {
        validateSchemaValue(value, dependentSchema, schemaMap, location, errors);
      }
    }

    const properties = schema.properties ?? {};
    for (const [propertyName, propertyValue] of Object.entries(value)) {
      if (properties[propertyName]) {
        validateSchemaValue(propertyValue, properties[propertyName], schemaMap, `${location}.${propertyName}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ code: "additional_property", message: `${location}.${propertyName} is not allowed` });
      }
    }
  }
}

const UTC_RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/;

export function isUtcRfc3339Timestamp(value) {
  const match = UTC_RFC3339_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function jsonValueEquals(left, right) {
  return canonicalize(left) === canonicalize(right);
}

function resolveRef(ref, schemaMap) {
  const [schemaId, fragment] = ref.split("#");
  let target = schemaMap.get(schemaId);
  if (!target) {
    return undefined;
  }
  if (!fragment) {
    return target;
  }
  const pointer = fragment.startsWith("/") ? fragment : fragment.slice(1);
  const segments = pointer.split("/").filter(Boolean).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (const segment of segments) {
    target = target?.[segment];
  }
  return target;
}

function matchesType(value, type) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (type === "integer") {
    return Number.isSafeInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  }
  return typeof value === type;
}

function collectArtifactReferences(value) {
  const references = [];
  visit(value);
  return references;

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (!Array.isArray(node) && typeof node.artifact_type === "string" && typeof node.artifact_ref === "string") {
      references.push(node);
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      visit(child);
    }
  }
}

function collectCamelCaseFixtureFields(value, location, errors) {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCamelCaseFixtureFields(item, `${location}[${index}]`, errors));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!isSnakeCase(key)) {
      errors.push({ code: "camel_case_protocol_field", message: `${location}.${key} must be snake_case` });
    }
    collectCamelCaseFixtureFields(child, `${location}.${key}`, errors);
  }
}

function isSnakeCase(value) {
  return /^[a-z][a-z0-9_]*$/.test(value);
}
