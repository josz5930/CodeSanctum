// Single source of truth for claim-safe enforcement: protocol/policies/claim-safety.v0.json
// is the protocol-owned policy artifact. Both the control-plane runtime boundary
// (claimSafeForbiddenPhrase, via this generated re-export) and the protocol gate
// (scripts/lib/protocol-utils.mjs loadSharedPhraseArray) derive from that JSON file.
// Do not hand-edit the phrase lists here; edit protocol/policies/claim-safety.v0.json
// and regenerate with `npm run generate --workspace @onevps/protocol-ts`.
//
// Story 3.3 AC5 forbids implying SOC 2 acceptance, certification, regulator
// approval, independent assurance, or absence of vulnerabilities. The SOC 2 /
// regulator / certification-claim entries are intentionally MULTI-WORD:
// protocol/docs/protocol-invariants.md documents that the shared list must keep
// allowing ordinary reviewer prose that merely mentions certified/attestation
// context (existing valid fixtures say "certified training fixture"). Matching a
// bare word would false-positive on that legitimate prose, so we match the claim
// phrase, not the word.
export {
  CLAIM_SAFE_FORBIDDEN_PHRASES,
  CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES,
  CLAIM_SAFE_TEXT_MAX_LENGTH,
  CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES,
  PII_EMAIL_ADDRESS_PATTERN_SOURCE,
  SOURCE_TEXT_FORBIDDEN_PHRASES
} from "./generated/claim-safety-policy.js";
import {
  CLAIM_SAFE_FORBIDDEN_PHRASES,
  CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES,
  CLAIM_SAFE_TEXT_MAX_LENGTH,
  CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES,
  PII_EMAIL_ADDRESS_PATTERN_SOURCE,
  SOURCE_TEXT_FORBIDDEN_PHRASES
} from "./generated/claim-safety-policy.js";

// Distinct sentinel for "text exceeded CLAIM_SAFE_TEXT_MAX_LENGTH", returned from
// the same slot that otherwise carries a matched phrase or PII-family id. Compare
// against this constant rather than the string literal so callers that interpolate
// the return value into a message don't read it as an offending phrase. Mirrored
// in scripts/lib/protocol-utils.mjs.
export const TEXT_TOO_LONG_REASON = "text_too_long";

export function claimSafeForbiddenPhrase(value: unknown): string | undefined {
  return firstForbiddenPhrase(value, CLAIM_SAFE_FORBIDDEN_PHRASES);
}

export function sourceTextForbiddenPhrase(value: unknown): string | undefined {
  return firstForbiddenPhrase(value, SOURCE_TEXT_FORBIDDEN_PHRASES);
}

// docs/codeattest-assurance-boundary.md ("Avoid: CodeAttest certifies the
// code, guarantees compliance, proves SOC 2 readiness, or confirms the
// application is secure") describes an open-ended family of assurance
// overclaims that CLAIM_SAFE_FORBIDDEN_PHRASES cannot enumerate exhaustively
// as exact phrases. Each pattern below requires a claim-shaped construction
// (a verb/conclusion plus its object), not a bare policy word, so ordinary
// reviewer prose like "certified training fixture" or "a scoped secure-code
// review" stays allowed. Mirrored in scripts/lib/protocol-utils.mjs
// (CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS) — keep both in sync.
const CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
  { id: "certifies_code_claim", pattern: /\bcertif(?:y|ies|ied|ication)\b[^.!?]{0,60}\b(?:code|application|package|product|deployment|system|software)\b/u },
  { id: "audit_ready_claim", pattern: /\baudit[- ]?(?:safe|ready|readiness|accepted|acceptance)\b/u },
  { id: "soc2_readiness_claim", pattern: /\bsoc 2\b[^.!?]{0,30}\b(?:read(?:y|iness)|accept(?:ed|ance)|certif(?:y|ies|ied|ication)|complian(?:t|ce))\b/u },
  { id: "secure_conclusion_claim", pattern: /\b(?:confirms?|proves?|guarantees?|ensures?)\b[^.!?]{0,60}\b(?:is\s+)?secure\b/u },
  { id: "compliance_guarantee_claim", pattern: /\bguarantees?\b[^.!?]{0,60}\bcomplian(?:t|ce)\b/u },
  { id: "zero_vulnerability_claim", pattern: /\b(?:zero|no|without\s+any|free\s+of|absence\s+of)\b[^.!?]{0,40}\bvulnerab(?:le|ilit(?:y|ies))\b/u },
  { id: "vulnerability_free_claim", pattern: /\bvulnerab(?:le|ility|ilities)[- ]free\b/u }
];

// Customer-prose PII patterns. Structured protocol identifiers use typed
// references (see CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES, e.g. "review:abc123")
// or bare sha256 digests, neither of which this list matches. The email
// pattern and text ceiling come from protocol/policies/claim-safety.v0.json;
// the remaining family patterns are mirrored in scripts/lib/protocol-utils.mjs.
// C6-18: SSN, unlabeled (unprefixed) phone numbers, and common cloud
// credential formats survived the original family list, which only caught
// phone numbers carrying an explicit "phone:"/"contact:" label and
// access-token-style credentials carrying an explicit "key:"/"token:" label.
const PII_FAMILY_PATTERNS: ReadonlyArray<{ readonly id: string; readonly pattern: RegExp }> = [
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

// Bidi override/embedding and default-ignorable formatting characters can
// hide or reorder customer-visible text (spoofing risk). normalizeForbiddenText
// silently strips a subset of these before phrase matching; this check instead
// rejects their presence outright. Numeric codepoint ranges (rather than
// literal/escaped characters in source) keep this auditable: U+00AD soft
// hyphen, U+200B-U+200F zero-width space through right-to-left mark,
// U+2060-U+2064 word joiner through invisible plus, U+2066-U+2069
// directional isolates, U+202A-U+202E bidi embedding/override, U+FEFF
// byte-order mark / zero-width no-break space. Mirrored in
// scripts/lib/protocol-utils.mjs.
const HIDDEN_CONTROL_CODEPOINT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00ad, 0x00ad],
  [0x200b, 0x200f],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0x202a, 0x202e],
  [0xfeff, 0xfeff]
];

function containsHiddenControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (HIDDEN_CONTROL_CODEPOINT_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end)) {
      return true;
    }
  }
  return false;
}

/**
 * Broader claim-safety detector for genuinely customer-visible prose fields
 * (Attestation sections, supporting-evidence mapping text, static portal
 * copy, customer-facing finding text, submission failure summaries, review
 * event reasons). Includes every CLAIM_SAFE_FORBIDDEN_PHRASES exact match
 * plus assurance/audit-readiness/security-guarantee/absent-vulnerability
 * claim families. Explicit disclaimers ("does not imply audit acceptance")
 * are not flagged, mirroring claimSafePositiveClosurePhrase's negation
 * handling. `context` is reserved for call-site labeling and does not
 * change matching behavior.
 */
export function customerVisibleTextForbidden(value: unknown, _context?: string): string | undefined {
  const exactPhrase = claimSafeForbiddenPhrase(value);
  if (exactPhrase !== undefined) {
    return exactPhrase;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (containsHiddenControlCharacter(value)) {
    return "hidden_control_character";
  }
  const piiMatch = piiTextForbidden(value);
  if (piiMatch !== undefined) {
    return piiMatch;
  }
  const normalized = normalizeForbiddenText(value);
  for (const clause of splitNormalizedClauses(normalized)) {
    const family = CUSTOMER_VISIBLE_ASSURANCE_FAMILY_PATTERNS.find(({ pattern }) => familyClaimAppearsPositively(clause, pattern));
    if (family !== undefined) {
      return family.id;
    }
  }
  return undefined;
}

/**
 * Standalone PII/customer-identifier detector, also folded into
 * customerVisibleTextForbidden(). Unlike the assurance-claim families, PII
 * matches are not negation-aware — an email address or identifier is still
 * PII regardless of surrounding phrasing.
 */
export function piiTextForbidden(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  if (isTypedIdentityReference(normalizeForbiddenText(value))) {
    return undefined;
  }
  const normalized = normalizeForbiddenText(value);
  const family = PII_FAMILY_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return family?.id;
}

/**
 * Family-pattern variant of regexAppearsPositively. Unlike the exact-phrase
 * negation window (which stops at the nearest comma), this scans the whole
 * sub-clause bounded by strong conjunctions (and/but/however/though/yet) for
 * a negation cue, so enumerated disclaimers like "is not remediation,
 * verification, audit acceptance, or control satisfaction" are recognized as
 * negating every listed item, not just the one nearest the negation word.
 */
function familyClaimAppearsPositively(clause: string, pattern: RegExp): boolean {
  const occurrence = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const strongBoundaryPattern = /\band\b|\bbut\b|\bhowever\b|\bthough\b|\byet\b/gu;
  let match: RegExpExecArray | null;
  while ((match = occurrence.exec(clause)) !== null) {
    let segmentStart = 0;
    let boundaryMatch: RegExpExecArray | null;
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

const FAMILY_NEGATION_CUE_PATTERN = /\b(?:not|no|never|without|does not|do not|cannot|is not|are not|was not|were not|has not been|have not been)\b/u;

/**
 * Claim profile for customer-facing Attestation, mapping, bundle, and portal
 * prose. Factual artifact names and bounded verification states are allowed;
 * assurance, acceptance, certification, security-guarantee, and absent-risk
 * conclusions are rejected.
 */
export function attestationClaimUnsafePhrase(value: unknown): string | undefined {
  return customerVisibleTextForbidden(value);
}

// Source-code-like prose that SOURCE_TEXT_FORBIDDEN_PHRASES' finite exact-phrase
// list cannot catch: a rationale like "src/auth.ts:42 if (!user.isAdmin) {
// eval(userInput); }" contains no listed phrase but is still source-derived
// content. Deliberately narrow and NOT folded into customerVisibleTextForbidden
// (used broadly, including places where code-shaped text is legitimate, e.g.
// validation scripts) — callers opt in explicitly. Mirrored in
// scripts/lib/protocol-utils.mjs (sourceCodeLikeTextReason) — keep both in sync.
const DYNAMIC_EXECUTION_PATTERN = /\b(?:eval|exec|new\s+Function)\s*\(/u;
const CODE_FENCE_OR_SHEBANG_PATTERN = /```|^#!/mu;
const FILE_LINE_REFERENCE_PATTERN = /\b[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|java|kt|c|cc|cpp|h|hpp|cs|php|rs|sh)\s*:\s*\d+\b/iu;
// A location reference alone ("src/auth.ts:42") must stay allowed; only flag
// it when combined with declaration/assignment/control-flow/call syntax.
// Control-flow keywords require an immediately following "(" so ordinary
// prepositional "for"/"while" prose ("for reviewer context") doesn't match.
const CODE_SYNTAX_PATTERN = /\b(?:if|for|while|switch|function)\s*\(|\bclass\s+[A-Za-z_$][\w$]*|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|=>|[^=!<>]=[^=]|\b[a-zA-Z_$][\w.$]*\([^()]*\)/u;
// Lazy `.*?` so a nested call inside the condition (`if (isAuthorized(user)) {`)
// still matches the outer `if (...) {` shape.
const AUTHORIZATION_CONDITIONAL_PATTERN = /\bif\s*\([^{}]{0,200}?\)\s*\{/u;
const AUTHORIZATION_KEYWORD_PATTERN = /\b(?:admin|authorize[ds]?|authorizing|authorization|permission|role|is[_-]?admin|is[_-]?authorized|access[_-]?control)\b/iu;

export function sourceCodeLikeTextReason(value: unknown): string | undefined {
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

export function isAttestationClaimSafe(value: unknown): boolean {
  return attestationClaimUnsafePhrase(value) === undefined && sourceTextForbiddenPhrase(value) === undefined;
}

/**
 * Finds positive Story 4.1 closure language without allowing a negation in a
 * separate sentence or clause to mask it. Typed references (for example,
 * `customer:verified`) are intentionally excluded because they are structured
 * identity values rather than customer-facing prose.
 */
// C3-03: the exact-phrase list ("fresh full review", "complete fresh
// review", "full secure-code review") cannot enumerate every combination of
// this same complete/fresh/full-plus-optional-secure-code-plus-review
// cluster — it was missing "complete fresh secure-code review" — so a
// bounded pattern covers the cluster instead of one more one-off literal.
const FRESH_REVIEW_CLOSURE_PATTERN = /\b(?:complete\s+fresh|fresh\s+full|complete\s+full)(?:\s+secure-code)?\s+review\b/u;

export function claimSafePositiveClosurePhrase(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  const normalizedValue = normalizeForbiddenText(value);
  if (isTypedIdentityReference(normalizedValue)) {
    return undefined;
  }
  for (const clause of splitNormalizedClauses(normalizedValue)) {
    for (const phrase of CLAIM_SAFE_POSITIVE_CLOSURE_PHRASES) {
      const normalizedPhrase = normalizeForbiddenText(phrase);
      if (phraseAppearsPositively(clause, normalizedPhrase)) {
        return phrase;
      }
    }
    if (regexAppearsPositively(clause, FRESH_REVIEW_CLOSURE_PATTERN)) {
      return "complete fresh secure-code review";
    }
  }
  return undefined;
}

function phraseAppearsPositively(clause: string, phrase: string): boolean {
  const hasLeadingBoundary = /^[a-z0-9]/u.test(phrase);
  const prefix = hasLeadingBoundary ? "(^|[^a-z0-9])" : "";
  const suffix = /[a-z0-9]$/u.test(phrase) ? "(?:$|[^a-z0-9])" : "";
  const occurrence = new RegExp(`${prefix}${escapeRegularExpression(phrase)}${suffix}`, "gu");
  return regexAppearsPositively(clause, occurrence, hasLeadingBoundary);
}

/**
 * Runs `pattern` (which may match variable-length claim constructions, not
 * just a fixed phrase) against `clause` and ignores any match whose
 * immediately preceding text is an explicit negation/disclaimer, so
 * "does not imply audit acceptance" is not treated as an audit-acceptance
 * claim. `hasCaptureGroupBoundary` is true when `pattern`'s match[1] is a
 * leading word-boundary capture (as phraseAppearsPositively's callers use)
 * that must be excluded from the negation-window slice.
 */
function regexAppearsPositively(clause: string, pattern: RegExp, hasCaptureGroupBoundary = false): boolean {
  const occurrence = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = occurrence.exec(clause)) !== null) {
    const boundaryPrefix = hasCaptureGroupBoundary ? String(match[1] ?? "") : "";
    const matchStart = match.index + boundaryPrefix.length;
    const leadingWindow = clause.slice(Math.max(0, matchStart - 64), matchStart).trimEnd();
    if (leadingWindow.length > 0) {
      // C3-03: colon and a standalone dash (surrounded by non-word
      // characters, so a compound word like "secure-code" isn't split) are
      // clause boundaries too, same as comma/semicolon/conjunctions — without
      // them, an unrelated negation on one side of a "label: value" or
      // "clause - clause" construction (e.g. "not applicable: verified")
      // reads as if it negates the value/clause on the other side.
      const leadingTail = leadingWindow.split(/,|;|:|(?<!\w)-(?!\w)|\band\b|\bbut\b|\bhowever\b|\bthough\b|\byet\b/u).at(-1)?.trim() ?? "";
      if (NEGATION_GUARD_PATTERN.test(leadingTail)) {
        continue;
      }
    }
    return true;
  }
  return false;
}

function isTypedIdentityReference(value: string): boolean {
  const match = /^([a-z_]+):([a-z0-9][a-z0-9_-]{2,63})$/u.exec(value.trim());
  const namespace = match?.[1];
  return namespace !== undefined && isTypedIdentityNamespace(namespace);
}

function isTypedIdentityNamespace(value: string): boolean {
  return CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES.includes(value as typeof CLAIM_SAFE_TYPED_REFERENCE_NAMESPACES[number]);
}

const NEGATION_GUARD_PATTERN = /(?:\bnot|\bno|\bnever|\bwithout|\bdoes not|\bdo not|\bcannot|\bis not|\bwas not|\bhas not been)(?:\s+[^,;.!?]{0,40})?$/u;

function splitNormalizedClauses(value: string): string[] {
  return value.split(/[.;!?]+/u).map((clause) => clause.trim()).filter(Boolean);
}

function firstForbiddenPhrase(value: unknown, phrases: readonly string[]): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length > CLAIM_SAFE_TEXT_MAX_LENGTH) {
    return TEXT_TOO_LONG_REASON;
  }
  // C3-02: normalizeForbiddenText silently *strips* only a narrow subset of
  // hidden/bidi characters (soft hyphen, U+200B-U+200F, word joiner, BOM).
  // Stripping (rather than rejecting) is actively counterproductive for
  // phrase-boundary detection — "auditor[ZWSP]approved" strips to
  // "auditorapproved", erasing the word boundary entirely — and the wider
  // default-ignorable/bidi-isolate/bidi-embedding ranges aren't stripped at
  // all, so a character from those ranges inserted mid-word (e.g.
  // "sec[U+2066]ret=") passes through untouched and never matches "secret=".
  // Reject outright instead of normalizing, reusing the same detector
  // customerVisibleTextForbidden() already uses for customer-facing prose.
  if (containsHiddenControlCharacter(value)) {
    return "hidden_control_character";
  }
  const normalized = normalizeForbiddenText(value);
  // C3-02: a multi-word forbidden phrase (e.g. "auditor approved") is the
  // same claim however its words are separated, so a literal internal space
  // in the stored phrase should also match a run of hyphen/underscore in the
  // text — closing bypasses like "auditor-approved" or "soc_2 accepted" that
  // an exact-space match misses. But every protocol identifier/enum/filename
  // token in this schema (e.g. "vendor_receipt", "vendor-receipt.json",
  // "soc_2_supporting_evidence") is itself snake_case or kebab-case and never
  // contains a literal space, while every real customer-facing prose field in
  // this schema does (fields are full sentences, not bare fragments) — so
  // tolerant matching is restricted to text that already contains a space,
  // which keeps "vendor receipt" (the forbidden claim) from colliding with
  // "vendor_receipt" (the pervasive, legitimate protocol type name).
  const toleratesSeparators = normalized.includes(" ");
  return phrases.find((phrase) => {
    const normalizedPhrase = normalizeForbiddenText(phrase);
    const prefix = /^[a-z0-9]/u.test(normalizedPhrase) ? "(?:^|[^a-z0-9])" : "";
    const suffix = /[a-z0-9]$/u.test(normalizedPhrase) ? "(?:$|[^a-z0-9])" : "";
    const escapedPhrase = escapeRegularExpression(normalizedPhrase);
    const matchablePhrase = toleratesSeparators ? escapedPhrase.replaceAll(" ", "[\\s_-]+") : escapedPhrase;
    return new RegExp(`${prefix}${matchablePhrase}${suffix}`, "u").test(normalized);
  });
}

function normalizeForbiddenText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−﹣－]/gu, "-")
    .replace(/[­​-‏⁠﻿]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\bsoc\s*-\s*2\b/gu, "soc 2")
    .replace(/\bsoc2\b/gu, "soc 2")
    .replace(/\s*([:=])\s*/gu, "$1")
    .replace(/\bs\s+e\s+c\s+r\s+e\s+t([=:])/gu, "secret$1")
    .replace(/\bp\s+a\s+s\s+s\s+w\s+o\s+r\s+d([=:])/gu, "password$1")
    .replace(/\bt\s+o\s+k\s+e\s+n([=:])/gu, "token$1")
    .replace(/\ba[\s_-]*p[\s_-]*i[\s_-]*k[\s_-]*e[\s_-]*y([=:])/gu, "api_key$1")
    .replace(/\bapi[\s_-]*key\b/gu, "api_key")
    .replace(/\bauthorization\s*[:=]?\s*bearer\b/gu, "authorization:bearer")
    .replace(/\b(secret|password|api_key|api-key|token)([=:])\s+/gu, "$1$2");
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * C4-28: pilot-learning `recorded_by.actor_id` must be an opaque, namespaced
 * identifier -- the namespace prefix must equal `actorType` exactly, and the
 * suffix is restricted to `[a-z0-9][a-z0-9_-]{2,63}`, the same shape used by
 * every other typed protocol reference. This alone rejects any email/phone/
 * free-text actor ID, since none of those characters (`.`, `@`, spaces,
 * parens, digits-only runs) are in the allowed suffix charset.
 */
export function opaquePilotActorIdIsValid(actorType: unknown, actorId: unknown): boolean {
  if (typeof actorType !== "string" || typeof actorId !== "string") {
    return false;
  }
  return new RegExp(`^${escapeRegularExpression(actorType)}:[a-z0-9][a-z0-9_-]{2,63}$`, "u").test(actorId);
}

/**
 * Recursively scans every string leaf of a JSON value for PII-shaped text
 * (email, phone, customer/user/device identifier fields, IP address, street
 * address, credential-like `key=`/`token:` text) via `piiTextForbidden`.
 * Unlike `containsPiiField` (control-plane, key-name based), this catches
 * PII carried in a field whose *name* is unremarkable but whose *value* is
 * not -- e.g. an actor ID or free-text note containing an email address.
 */
export function containsPiiValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsPiiValue(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => containsPiiValue(entry));
  }
  return piiTextForbidden(value) !== undefined;
}
