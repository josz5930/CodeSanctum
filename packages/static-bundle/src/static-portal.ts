import { isAttestationClaimSafe, piiTextForbidden, sourceTextForbiddenPhrase, validateProtocolSchema } from "../../protocol-ts/src/index.js";
import type { IdentitySigningInput, SecurityReviewAttestation, StaticBundleManifest as ProtocolStaticBundleManifest, SupportingEvidenceMapping } from "../../protocol-ts/src/index.js";
import { signingInputMatchesExpectation } from "../../protocol-ts/src/index.js";
import type { SupportingEvidenceMappingProjection } from "./supporting-evidence-mapping.js";
import { projectSupportingEvidenceMapping } from "./supporting-evidence-mapping.js";
import { isProtocolManifest, recomputeManifestId, sha256Text } from "./signed-static-bundle.js";

const REQUIRED_SECTION_IDS = ["overview", "scope", "receipt-chain", "methods", "findings", "validation-remediation", "limitations", "appendices"] as const;
const INTERNAL_KEYS = new Set(["internal_feedback", "pilot_feedback", "pilot_metrics", "unit_economics", "private_notes", "internal_notes"]);
const UNSAFE_COPY = /\b(?:soc\s*2\s+(?:accepted|certified|compliant)|control\s+satisfied|auditor\s+(?:accepted|approved)|regulator\s+approved|independent\s+assurance|certification\s+granted|no\s+vulnerabilities)\b/iu;

export type StaticPortalSectionId = typeof REQUIRED_SECTION_IDS[number];
export type StaticPortalDetail = { label: string; value: string; copyable?: boolean; href?: string };
export type StaticPortalSectionInput = {
  id: StaticPortalSectionId;
  title: string;
  summary: string;
  body: string[];
  details: StaticPortalDetail[];
};
export type StaticPortalFindingInput = {
  finding_ref: string;
  title: string;
  classification: string;
  evidence_basis: string;
  limitation: string;
  validation_path?: string;
  remediation_status: string;
  outcome_status?: "false_positive" | "accepted_risk";
  artifact_refs: string[];
};
export type StaticPortalInput = {
  protocol_version: "codeattest.v0";
  portal_id: string;
  title: string;
  review_id: string;
  selected_application: string;
  selected_commit: string;
  attestation_id: string;
  static_bundle_id: string;
  static_bundle_manifest_id: string;
  package_state: "generated" | "finalized";
  vendor_receipt_id: string;
  verification_status: "verified_offline";
  canonicalization: "rfc8785";
  signature_profile: "ml_dsa_65";
  signing_key_id: string;
  signing_key_version: string;
  signing_time: string;
  signing_input: IdentitySigningInput;
  signing_limitations: string[];
  sections: StaticPortalSectionInput[];
  findings: StaticPortalFindingInput[];
  // C6-21: this used to be the already-projected DTO, which discards
  // approval_state/approved_by/approved_at -- any caller could hand-construct
  // a safe-looking projection with matching review/attestation ids and render
  // it as approved supporting evidence. Accept the original signed record and
  // project it internally (approval-gated) instead.
  mappings?: SupportingEvidenceMapping[];
  // C6-19: the signed manifest and its referenced Attestation record, so the
  // display fields above can be cross-bound to the same signed identities the
  // signature actually covers, instead of being trusted as detached caller
  // assertions.
  manifest: ProtocolStaticBundleManifest;
  attestation: SecurityReviewAttestation;
};

export type StaticPortalAsset = {
  path: string;
  role: "portal_html" | "portal_css" | "portal_js";
  media_type: string;
  content: string;
  digest: string;
  size_bytes: number;
};

export type StaticPortalPackage = {
  kind: "static-portal";
  entry_path: "portal/index.html";
  assets: [StaticPortalAsset, StaticPortalAsset, StaticPortalAsset];
  section_ids: StaticPortalSectionId[];
  search_index: Array<{ id: string; title: string; text: string; refs: string[] }>;
  remote_dependencies: false;
  hosted_session_required: false;
  print_preserves_all_sections: true;
  phone_summary_sections: ["overview", "receipt-chain", "limitations", "findings"];
};

export function generateStaticPortal(input: StaticPortalInput | unknown): StaticPortalPackage | null {
  if (!portalInputIsSafe(input)) return null;
  // C6-21: project each raw signed mapping record through the approval-gated
  // projector here, rather than trusting an already-projected DTO from the
  // caller (which discards approval_state/approved_by/approved_at). Any
  // mapping that fails approval-gated projection fails the whole portal.
  const rawMappings = input.mappings ?? [];
  const mappings = rawMappings.map((mapping) => projectSupportingEvidenceMapping(mapping));
  if (mappings.some((mapping) => mapping === null)) return null;
  const projectedMappings = mappings as SupportingEvidenceMappingProjection[];
  if (projectedMappings.some((mapping) => mapping.reviewId !== input.review_id || mapping.attestationRef !== input.attestation_id)) return null;
  if (new Set(projectedMappings.map((mapping) => mapping.mappingId)).size !== projectedMappings.length) return null;
  const orderedSections = REQUIRED_SECTION_IDS.map((id) => input.sections.find((section) => section.id === id)!);
  const searchIndex = buildSearchIndex(input, orderedSections, projectedMappings);
  const html = renderHtml(input, orderedSections, projectedMappings);
  const css = renderCss();
  const js = renderJs(searchIndex);
  const result: StaticPortalPackage = {
    kind: "static-portal",
    entry_path: "portal/index.html",
    assets: [asset("portal/index.html", "portal_html", "text/html; charset=utf-8", html), asset("portal/styles.css", "portal_css", "text/css; charset=utf-8", css), asset("portal/portal.js", "portal_js", "text/javascript; charset=utf-8", js)],
    section_ids: [...REQUIRED_SECTION_IDS],
    search_index: searchIndex,
    remote_dependencies: false,
    hosted_session_required: false,
    print_preserves_all_sections: true,
    phone_summary_sections: ["overview", "receipt-chain", "limitations", "findings"]
  };
  deepFreeze(result);
  return result;
}

export const buildStaticPortal = generateStaticPortal;
export const renderStaticPortal = generateStaticPortal;

function renderHtml(input: StaticPortalInput, sections: StaticPortalSectionInput[], mappings: SupportingEvidenceMappingProjection[]): string {
  const navigation = sections.map((section) => `<a href="#${section.id}" data-nav="${section.id}">${escapeHtml(section.title)}</a>`).join("");
  const content = sections.map((section) => renderSection(section, input.findings, mappings)).join("");
  const signingLimitations = `<aside class="verification-limitations"><h2>Signature limitations</h2><ul>${input.signing_limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul></aside>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(input.title)}</title><link rel="stylesheet" href="./styles.css"></head>
<body><a class="skip" href="#main">Skip to evidence packet</a><header><p class="eyebrow">CodeAttest static evidence packet</p><h1>${escapeHtml(input.title)}</h1><p>This package is supporting evidence within the recorded scope and limitations. The evidence consumer decides whether it is useful for their review context.</p><div class="verification" role="status"><strong>Offline verification:</strong> ${escapeHtml(input.verification_status.replaceAll("_", " "))}</div><dl class="context"><div><dt>Application</dt><dd>${copyValue(input.selected_application)}</dd></div><div><dt>Selected commit</dt><dd>${copyValue(input.selected_commit)}</dd></div><div><dt>Bundle</dt><dd>${copyValue(input.static_bundle_id)}</dd></div><div><dt>Bundle manifest identity</dt><dd>${copyValue(input.static_bundle_manifest_id)}</dd></div><div><dt>Receipt</dt><dd>${copyValue(input.vendor_receipt_id)}</dd></div><div><dt>Canonicalization</dt><dd>${copyValue(input.canonicalization)}</dd></div><div><dt>Signature profile</dt><dd>${copyValue(input.signature_profile)}</dd></div><div><dt>Signing key ID</dt><dd>${copyValue(input.signing_key_id)}</dd></div><div><dt>Signing key version</dt><dd>${copyValue(input.signing_key_version)}</dd></div><div><dt>Signing time</dt><dd>${copyValue(input.signing_time)}</dd></div></dl>${signingLimitations}</header>
<div class="layout"><nav aria-label="Evidence packet sections">${navigation}</nav><main id="main"><form class="search" role="search"><label for="portal-search">Search sections, findings, receipts, and artifact references</label><input id="portal-search" type="search" autocomplete="off"><p id="search-status" role="status" aria-live="polite"></p></form><div id="search-results" hidden></div>${content}</main></div><footer><p>Offline package. No hosted CodeAttest session, analytics, remote asset, or live API is used.</p></footer><script src="./portal.js" defer></script></body></html>`;
}

function renderSection(section: StaticPortalSectionInput, findings: StaticPortalFindingInput[], mappings: SupportingEvidenceMappingProjection[]): string {
  const details = section.details.length === 0 ? "" : `<dl>${section.details.map((detail) => `<div><dt>${escapeHtml(detail.label)}</dt><dd>${detail.href === undefined ? (detail.copyable === true ? copyValue(detail.value) : escapeHtml(detail.value)) : `<a href="${escapeAttribute(detail.href)}">${escapeHtml(detail.value)}</a>${detail.copyable === true ? copyButton(detail.value) : ""}`}</dd></div>`).join("")}</dl>`;
  const body = section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const findingMarkup = section.id === "findings" ? `<div class="finding-list">${findings.map(renderFinding).join("")}</div>` : "";
  const mappingMarkup = section.id === "appendices" && mappings.length > 0 ? `<div class="mappings"><h3>Supporting-evidence mappings</h3>${mappings.map(renderMapping).join("")}</div>` : "";
  return `<section id="${section.id}" tabindex="-1" data-search-section><h2>${escapeHtml(section.title)}</h2><p class="summary">${escapeHtml(section.summary)}</p>${body}${details}${findingMarkup}${mappingMarkup}</section>`;
}

function renderFinding(finding: StaticPortalFindingInput): string {
  const details: Array<[string, string]> = [["Finding reference", finding.finding_ref], ["Classification", finding.classification], ["Evidence basis", finding.evidence_basis], ["Remediation status", finding.remediation_status], ["Limitation", finding.limitation]];
  if (finding.validation_path !== undefined) details.push(["Validation path", finding.validation_path]);
  if (finding.outcome_status !== undefined) details.push(["Recorded outcome", finding.outcome_status.replaceAll("_", " ")]);
  return `<article class="finding" id="${safeElementId(finding.finding_ref)}"><h3>${escapeHtml(finding.title)}</h3><dl>${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${copyValue(value)}</dd></div>`).join("")}</dl><h4>Supporting artifact references</h4><ul>${finding.artifact_refs.map((ref) => `<li>${copyValue(ref)}</li>`).join("")}</ul></article>`;
}

function renderMapping(mapping: SupportingEvidenceMappingProjection): string {
  const entries = mapping.entries.map((entry) => `<section class="mapping-entry"><h5>${escapeHtml(entry.topic)}</h5><p>${escapeHtml(entry.supportingEvidenceRole)}</p><p><strong>Scope:</strong> ${escapeHtml(entry.scopeSummary)}</p><p><strong>Method:</strong> ${escapeHtml(entry.methodSummary)}</p><p><strong>Receipt context:</strong> ${escapeHtml(entry.receiptContext)}</p><ul>${entry.evidenceLinks.map((link) => `<li><a href="${escapeAttribute(link.href)}">${escapeHtml(link.printLabel)}</a></li>`).join("")}</ul><h6>Limitations</h6><ul>${entry.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul></section>`).join("");
  const uniqueLinks = [...new Map(mapping.entries.flatMap((entry) => entry.evidenceLinks).map((link) => [link.artifactRef, link])).values()];
  // C6-36: target id scoped by mappingId, matching each link's own `href` (which is already mapping-scoped by the producer).
  const targets = uniqueLinks.map((link) => `<li id="${safeElementId(`${mapping.mappingId}:${link.artifactRef}`)}">${copyValue(link.artifactRef)}</li>`).join("");
  return `<article class="mapping" id="${safeElementId(mapping.mappingId)}"><h4>${escapeHtml(mapping.profile.replaceAll("_", " "))}</h4><p><strong>Decision authority:</strong> ${escapeHtml(mapping.decisionAuthority)}</p><p>${escapeHtml(mapping.acceptanceDisclaimer)}</p>${entries}<h5>Mapping limitations</h5><ul>${mapping.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul><h5>Supporting artifact targets</h5><ul>${targets}</ul></article>`;
}

function renderCss(): string {
  return `:root{color-scheme:light dark;--paper:#f7f3ea;--ink:#17212b;--muted:#59636e;--line:#9aa4ad;--focus:#1667a8;--panel:#fffdf8;--warning:#7a4a00;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);line-height:1.55}header,footer{padding:2rem max(1rem,calc((100vw - 76rem)/2))}header{border-bottom:2px solid var(--ink)}h1,h2,h3,h4{line-height:1.2}.eyebrow{font-weight:700;text-transform:uppercase;letter-spacing:.08em}.layout{max-width:76rem;margin:auto;display:grid;grid-template-columns:15rem minmax(0,1fr);gap:2rem;padding:1.5rem 1rem 4rem}nav{position:sticky;top:1rem;align-self:start;display:grid;gap:.25rem}nav a{display:block;padding:.75rem;border-left:4px solid transparent;color:inherit;text-decoration:none}nav a[aria-current="location"]{border-left-color:var(--focus);font-weight:700;background:var(--panel)}section{background:var(--panel);border:1px solid var(--line);padding:1.5rem;margin-bottom:1rem;scroll-margin-top:1rem}section:focus{outline:3px solid var(--focus);outline-offset:3px}.summary{font-size:1.08rem;font-weight:600}.context,dl{display:grid;gap:.75rem}.context{grid-template-columns:repeat(2,minmax(0,1fr))}dl>div{border-left:3px solid var(--line);padding-left:.75rem}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}.copy-row{display:flex;align-items:flex-start;gap:.5rem;flex-wrap:wrap}.technical{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.copy{min-height:44px;padding:.55rem .75rem;border:1px solid currentColor;background:transparent;color:inherit;border-radius:.25rem;cursor:pointer}.copy:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.search{margin-bottom:1rem}.search label{display:block;font-weight:700}.search input{width:100%;min-height:44px;padding:.5rem;font:inherit}.finding,.mapping{border-top:2px solid var(--line);margin-top:1.25rem;padding-top:1rem}.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:var(--panel);padding:.75rem;z-index:10}@media(max-width:44rem){.layout{display:block}nav{position:static;grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:1rem}.context{grid-template-columns:1fr}header{padding-top:1.25rem}section{padding:1rem}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation:none!important;transition:none!important}}@media print{nav,.search,.copy,.skip,footer{display:none!important}.layout{display:block;max-width:none;padding:0}body{background:white;color:black}header,section{break-inside:avoid;border-color:#444;background:white}a{color:black;text-decoration:none}a[href]::after{content:" (" attr(href) ")";overflow-wrap:anywhere}}
`;
}

function renderJs(searchIndex: StaticPortalPackage["search_index"]): string {
  const serializedIndex = JSON.stringify(searchIndex).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `"use strict";\nconst searchIndex=${serializedIndex};\nconst input=document.getElementById("portal-search");const results=document.getElementById("search-results");const status=document.getElementById("search-status");const normalizeSearch=value=>value.normalize("NFKC").toLowerCase();input?.addEventListener("input",()=>{const query=normalizeSearch(input.value.trim());if(!query){results.hidden=true;results.replaceChildren();status.textContent="";return}const matches=searchIndex.filter(entry=>entry.text.includes(query));results.replaceChildren(...matches.map(entry=>{const link=document.createElement("a");link.href="#"+entry.id;link.textContent=entry.title;const item=document.createElement("p");item.append(link);return item}));results.hidden=false;status.textContent=matches.length+" matching section"+(matches.length===1?"":"s")+"."});document.addEventListener("click",async event=>{const button=event.target instanceof Element?event.target.closest("[data-copy]"):null;if(!(button instanceof HTMLButtonElement))return;const value=button.dataset.copy||"";try{await navigator.clipboard.writeText(value);button.textContent="Copied"}catch{const area=document.createElement("textarea");area.value=value;document.body.append(area);area.select();const copied=document.execCommand("copy");area.remove();button.textContent=copied?"Copied":"Copy failed"}setTimeout(()=>button.textContent="Copy",1200)});const links=[...document.querySelectorAll("nav a")];const sections=[...document.querySelectorAll("main section")];if("IntersectionObserver" in window){const observer=new IntersectionObserver(entries=>{const active=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!active)return;links.forEach(link=>link.toggleAttribute("aria-current",link.getAttribute("href")==="#"+active.target.id))},{rootMargin:"-10% 0px -70% 0px",threshold:[0,.25,.5]});sections.forEach(section=>observer.observe(section))}else if(links[0])links[0].setAttribute("aria-current","location");`;
}

function buildSearchIndex(input: StaticPortalInput, sections: StaticPortalSectionInput[], mappings: SupportingEvidenceMappingProjection[]): StaticPortalPackage["search_index"] {
  const sharedRefs = [input.review_id, input.attestation_id, input.static_bundle_id, input.static_bundle_manifest_id, input.vendor_receipt_id, input.selected_commit, input.verification_status, input.canonicalization, input.signature_profile, input.signing_key_id, input.signing_key_version, input.signing_time];
  const sectionEntries = sections.map((section) => ({ id: section.id, title: section.title, text: normalizeSearchText([section.title, section.summary, ...section.body, ...section.details.flatMap((detail) => [detail.label, detail.value]), ...sharedRefs]), refs: [...sharedRefs, ...section.details.map((detail) => detail.value)] }));
  const findingEntries = input.findings.map((finding) => ({ id: safeElementId(finding.finding_ref), title: finding.title, text: normalizeSearchText([finding.title, finding.finding_ref, finding.classification, finding.evidence_basis, finding.limitation, finding.validation_path, finding.remediation_status, finding.outcome_status, ...finding.artifact_refs, ...sharedRefs]), refs: [finding.finding_ref, ...finding.artifact_refs] }));
  const mappingEntries = mappings.map((mapping) => ({ id: safeElementId(mapping.mappingId), title: mapping.profile.replaceAll("_", " "), text: normalizeSearchText([mapping.profile, mapping.decisionAuthority, mapping.acceptanceDisclaimer, ...mapping.limitations, ...mapping.entries.flatMap((entry) => [entry.topic, entry.supportingEvidenceRole, entry.scopeSummary, entry.methodSummary, entry.receiptContext, ...entry.limitations, ...entry.evidenceLinks.flatMap((link) => [link.artifactRef, link.href, link.printLabel])]), ...sharedRefs]), refs: [mapping.mappingId, ...mapping.entries.flatMap((entry) => entry.evidenceLinks.map((link) => link.artifactRef))] }));
  return [...sectionEntries, ...findingEntries, ...mappingEntries];
}

function portalInputIsSafe(value: unknown): value is StaticPortalInput {
  if (!safeJsonValue(value) || !isPlainRecord(value) || !hasOnlyKeys(value, ["protocol_version", "portal_id", "title", "review_id", "selected_application", "selected_commit", "attestation_id", "static_bundle_id", "static_bundle_manifest_id", "package_state", "vendor_receipt_id", "verification_status", "canonicalization", "signature_profile", "signing_key_id", "signing_key_version", "signing_time", "signing_input", "signing_limitations", "sections", "findings", "mappings", "manifest", "attestation"]) || containsInternalLearning(value) || value.protocol_version !== "codeattest.v0" || value.canonicalization !== "rfc8785" || value.signature_profile !== "ml_dsa_65" || value.verification_status !== "verified_offline") return false;
  const requiredText = [value.portal_id, value.title, value.review_id, value.selected_application, value.selected_commit, value.attestation_id, value.static_bundle_id, value.vendor_receipt_id, value.verification_status, value.signing_key_version];
  if (requiredText.some((entry) => !safeText(entry)) || !/^review:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.review_id)) || !/^[a-f0-9]{40}$/u.test(String(value.selected_commit)) || !/^attestation:[a-f0-9]{64}$/u.test(String(value.attestation_id)) || !/^static_bundle:[a-z0-9][a-z0-9_-]{2,63}$/u.test(String(value.static_bundle_id)) || !/^sha256:[a-f0-9]{64}$/u.test(String(value.static_bundle_manifest_id)) || (value.package_state !== "generated" && value.package_state !== "finalized") || !/^sha256:[a-f0-9]{64}$/u.test(String(value.vendor_receipt_id)) || !safeText(value.signing_key_id) || !isUtc(value.signing_time) || !isPlainRecord(value.signing_input) || !Array.isArray(value.signing_limitations)) return false;
  const manifestId = String(value.static_bundle_manifest_id);
  const keyId = String(value.signing_key_id);
  const keyVersion = String(value.signing_key_version);
  const signingTime = String(value.signing_time);
  // D3-2: the portal renders signing *metadata*; it never held the signature
  // bytes' key material and now no longer takes the bytes at all. What it can
  // still enforce -- and does -- is that the signing input it displays is
  // exactly the one the signed manifest identity, key, and time describe. The
  // bytes themselves are verified before publication, against a host-computed
  // SignatureVerificationOutcome (apps/control-plane).
  if (!signingInputMatchesExpectation(value.signing_input, { protocol_version: "codeattest.v0", signing_input_type: "static_bundle_manifest_identity", signed_identity_type: "static_bundle_manifest", signed_identity: manifestId, identity_input_path: value.package_state === "finalized" ? "v0/valid/static-bundle-manifest.finalized.identity-input.json" : "v0/valid/static-bundle-manifest.identity-input.json", key_id: keyId, key_version: keyVersion, signing_time: signingTime })) return false;
  // C6-19: the signature above only ever verified static_bundle_manifest_id.
  // review_id/selected_commit/attestation_id/vendor_receipt_id were
  // independent caller-asserted display fields with no cryptographic tie to
  // that signed identity, so a valid signature/manifest-id pair could be
  // combined with unrelated syntactically-valid values for all four. Require
  // and cross-bind the actual signed manifest and its referenced Attestation
  // record instead of trusting the detached display fields.
  if (!isProtocolManifest(value.manifest) || recomputeManifestId(value.manifest) !== manifestId || value.manifest.package_state !== value.package_state || value.manifest.static_bundle_id !== value.static_bundle_id || value.manifest.review_id !== value.review_id || value.manifest.attestation_ref !== value.attestation_id || value.manifest.vendor_receipt_ref !== value.vendor_receipt_id) return false;
  if (validateProtocolSchema("urn:codeattest:protocol:v0:security-review-attestation", value.attestation).length > 0) return false;
  const attestation = value.attestation as SecurityReviewAttestation;
  if (attestation.attestation_id !== value.attestation_id || attestation.review_id !== value.review_id || attestation.selected_commit?.commit_sha !== value.selected_commit || attestation.receipt_chain?.vendor_receipt_id !== value.vendor_receipt_id) return false;
  if (!Array.isArray(value.sections) || value.sections.length !== REQUIRED_SECTION_IDS.length || !value.sections.every(sectionIsSafe)) return false;
  const sections = value.sections as StaticPortalSectionInput[];
  if (new Set(sections.map((section) => section.id)).size !== REQUIRED_SECTION_IDS.length || !REQUIRED_SECTION_IDS.every((id) => sections.some((section) => section.id === id))) return false;
  if (!Array.isArray(value.findings) || value.findings.some((finding) => !findingIsSafe(finding))) return false;
  const findings = value.findings as StaticPortalFindingInput[];
  if (new Set(findings.map((finding) => finding.finding_ref)).size !== findings.length || new Set(findings.map((finding) => safeElementId(finding.finding_ref))).size !== findings.length) return false;
  if (value.mappings === undefined) return true;
  // C6-21: deep validation (schema, approval gate, cross-binding) now runs in
  // generateStaticPortal via projectSupportingEvidenceMapping against the raw
  // signed record -- this guard only needs to confirm the shape is plausibly
  // an array of records for the type predicate.
  return Array.isArray(value.mappings) && value.mappings.every((mapping) => isPlainRecord(mapping));
}

function sectionIsSafe(value: unknown): value is StaticPortalSectionInput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["id", "title", "summary", "body", "details"]) && REQUIRED_SECTION_IDS.includes(value.id as StaticPortalSectionId) && safeText(value.title) && safeText(value.summary) && Array.isArray(value.body) && value.body.every(safeText) && Array.isArray(value.details) && value.details.every(detailIsSafe);
}

function detailIsSafe(value: unknown): value is StaticPortalDetail {
  return isPlainRecord(value) && hasOnlyKeys(value, ["label", "value", "copyable", "href"]) && safeText(value.label) && safeText(value.value) && (value.copyable === undefined || typeof value.copyable === "boolean") && (value.href === undefined || safeHref(value.href));
}

function findingIsSafe(value: unknown): value is StaticPortalFindingInput {
  return isPlainRecord(value) && hasOnlyKeys(value, ["finding_ref", "title", "classification", "evidence_basis", "limitation", "validation_path", "remediation_status", "outcome_status", "artifact_refs"]) && [value.finding_ref, value.title, value.classification, value.evidence_basis, value.limitation, value.remediation_status].every(safeText) && (value.validation_path === undefined || safeText(value.validation_path)) && (value.outcome_status === undefined || value.outcome_status === "false_positive" || value.outcome_status === "accepted_risk") && Array.isArray(value.artifact_refs) && value.artifact_refs.every(safeText) && new Set(value.artifact_refs).size === value.artifact_refs.length;
}

function containsInternalLearning(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInternalLearning);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => INTERNAL_KEYS.has(key.toLowerCase()) || containsInternalLearning(entry));
}

function safeJsonValue(value: unknown): boolean {
  const ancestors = new Set<object>();
  let nodes = 0;
  function visit(current: unknown, depth: number): boolean {
    nodes += 1;
    if (nodes > 20_000 || depth > 64) return false;
    if (current === null || typeof current === "string" || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current) && Math.abs(current) <= Number.MAX_SAFE_INTEGER;
    if (typeof current !== "object" || ancestors.has(current)) return false;
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    ancestors.add(current);
    try {
      const keys = Reflect.ownKeys(current);
      if (keys.some((key) => typeof key !== "string")) return false;
      if (Array.isArray(current) && (keys.length !== current.length + 1 || keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(String(key))))) return false;
      return keys.every((key) => {
        if (key === "length") return true;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        return descriptor !== undefined && descriptor.enumerable === true && descriptor.get === undefined && descriptor.set === undefined && visit(descriptor.value, depth + 1);
      });
    } finally { ancestors.delete(current); }
  }
  return visit(value, 0);
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && isAttestationClaimSafe(value) && sourceTextForbiddenPhrase(value) === undefined && piiTextForbidden(value) === undefined && !UNSAFE_COPY.test(value) && !/\b(?:pilot[_ -]?(?:metric|feedback|learning)|internal learning|unit economics|private notes)\b/iu.test(value) && !/[\u202A-\u202E\u2066-\u2069]/u.test(value);
}

function isUtc(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/u.test(value) && !Number.isNaN(Date.parse(value.replace("+00:00", "Z")));
}

function safeHref(value: unknown): value is string {
  if (typeof value !== "string" || !(value.startsWith("./") || value.startsWith("#")) || /^(?:https?:|\/\/|data:|javascript:)/iu.test(value) || /[\\ -]/u.test(value)) return false;
  // C6-20: the portal is a fixed, self-contained 3-asset package
  // (`portal/index.html`, `portal/styles.css`, `portal/portal.js`) -- a
  // `./`-relative href to anything else names a file this package never
  // ships. Only the two sibling assets by exact known path are allowed;
  // everything else must be a same-document `#` fragment.
  if (value.startsWith("./") && value !== "./styles.css" && value !== "./portal.js") return false;
  let decoded = value;
  try { for (let index = 0; index < 3; index += 1) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } } catch { return false; }
  return !decoded.split(/[\\/]/u).includes("..") && !decoded.includes(" ") && !/^(?:https?:|\/\/|data:|javascript:)/iu.test(decoded);
}

function asset(path: string, role: StaticPortalAsset["role"], mediaType: string, content: string): StaticPortalAsset {
  return { path, role, media_type: mediaType, content, digest: sha256Text(content), size_bytes: new TextEncoder().encode(content).length };
}

function copyValue(value: string): string {
  return `<span class="copy-row"><span class="technical">${escapeHtml(value)}</span>${copyButton(value)}</span>`;
}

function copyButton(value: string): string {
  return `<button class="copy" type="button" data-copy="${escapeAttribute(value)}" aria-label="Copy ${escapeAttribute(value)}">Copy</button>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function normalizeSearchText(values: unknown[]): string {
  return values.filter((value): value is string => typeof value === "string").join(" ").normalize("NFKC").toLowerCase();
}

function safeElementId(value: string): string {
  return `ref-${sha256Text(value).slice(7, 23)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}
