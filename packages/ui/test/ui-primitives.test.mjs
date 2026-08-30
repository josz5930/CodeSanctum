import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = new URL("..", import.meta.url);
const workspacePath = fileURLToPath(workspaceRoot);
const tempDir = await mkdtemp(path.join(tmpdir(), "onevps-ui-test-"));

const VALID_RECEIPT_ID = "vendor_receipt:synthetic_demo_001";
const VALID_BUNDLE_ID = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VALID_MANIFEST_ID = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const VALID_TIMESTAMP = "2026-07-13T10:00:00Z";

try {
  const tscBin = path.resolve(workspacePath, "..", "..", "node_modules", "typescript", "bin", "tsc");
  const outDir = path.join(tempDir, "dist");
  execFileSync(process.execPath, [
    tscBin,
    "-p",
    "tsconfig.json",
    "--outDir",
    outDir,
    "--tsBuildInfoFile",
    path.join(tempDir, "ui.tsbuildinfo")
  ], {
    cwd: workspacePath,
    stdio: "pipe"
  });

  const ui = await import(pathToFileURL(path.join(outDir, "packages", "ui", "src", "index.js")).href);

  const requiredExports = [
    "AppShell",
    "EvidenceCard",
    "ReceiptBanner",
    "RiskWarning",
    "StatusPill",
    "TimelineEvent",
    "codeAttestDesignTokens",
    "colorTokensForRole",
    "isReceiptReviewState",
    "receiptReviewStateDefinitions",
    "receiptReviewStateValues",
    "workspaceName"
  ];

  for (const exportName of requiredExports) {
    assert(exportName in ui, `missing public export: ${exportName}`);
  }

  assert(ui.workspaceName === "@onevps/ui", "workspace marker must remain exported");

  testDesignTokenContracts(ui);
  testStatusVocabulary(ui);
  testReceiptBanner(ui);
  testRiskWarning(ui);
  testEvidenceCard(ui);
  testTimelineEvent(ui);
  testAppShell(ui);
  testSafetyAndPerformance(ui);
  await testSourceSafety(workspacePath);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function testDesignTokenContracts(ui) {
  const tokens = ui.codeAttestDesignTokens;
  assert(tokens.colors.verification === "#047857", "verification token must match UX contract");
  assert(tokens.colors.risk === "#B91C1C", "risk token must match UX contract");
  assert(tokens.accessibility.minimumTargetSizePx === 44, "target size contract must be 44px");
  assert(tokens.accessibility.focusRingWidthPx >= 2, "focus ring contract must be visible");
  assert(tokens.motion.prefersReducedMotionMediaQuery === "(prefers-reduced-motion: reduce)", "reduced-motion media query must be exported");

  const roleLabels = {
    neutral: "neutral status pill",
    primary: "primary status pill",
    verification: "verification status pill",
    review: "review status pill",
    warning: "warning status pill",
    risk: "risk warning"
  };
  for (const [role, label] of Object.entries(roleLabels)) {
    const pair = ui.colorTokensForRole(role);
    assert(contrastRatio(pair.foreground, pair.background) >= 4.5, `${label} contrast must meet AA-oriented text contrast`);
  }

  const pairs = [
    [tokens.colors.inkPrimary, tokens.colors.surfaceRaised, "app shell / evidence card"],
    [tokens.colors.inkPrimary, tokens.colors.surfaceSubtle, "receipt banner"]
  ];

  for (const [foreground, background, label] of pairs) {
    assert(contrastRatio(foreground, background) >= 4.5, `${label} contrast must meet AA-oriented text contrast`);
  }

  let unknownRoleThrew = false;
  try {
    ui.colorTokensForRole("unexpected_role");
  } catch (error) {
    unknownRoleThrew = error instanceof Error && error.message.includes("Unknown CodeAttest color role");
  }
  assert(unknownRoleThrew, "unknown color roles must fail explicitly instead of returning undefined");

  for (const background of [tokens.colors.surfaceBase, tokens.colors.surfaceRaised, tokens.colors.surfaceSubtle]) {
    assert(
      contrastRatio(tokens.accessibility.focusRingColor, background) >= tokens.accessibility.focusRingContrastTarget,
      `focus ring must meet ${tokens.accessibility.focusRingContrastTarget}:1 contrast against ${background}`
    );
  }
}

function testStatusVocabulary(ui) {
  const expected = [
    "not_submitted",
    "submitted",
    "received",
    "received_with_receipt",
    "rejected_no_receipt",
    "quarantined_no_receipt",
    "under_review",
    "review_complete",
    "verification_pending",
    "finalized",
    "deleted",
    "retained",
    "not_collected",
    "unknown"
  ];

  assertArrayEquals(ui.receiptReviewStateValues, expected, "status values must match Story 2.1 vocabulary");

  for (const state of expected) {
    const pill = ui.StatusPill({ state });
    assert(pill.visibleLabel.length > 0, `${state} must have visible label`);
    assert(pill.accessibleLabel.includes(pill.visibleLabel), `${state} must include visible label in accessible label`);
    assert(pill.colorRole !== undefined, `${state} can expose color role but not depend on it`);
    assert(pill.meaning.length > 0, `${state} must explain meaning in text`);
    assert(pill.doesNotRelyOnColor === true, `${state} must not rely on color alone`);
  }

  const unknownPill = ui.StatusPill({ state: "protocol_drifted_state" });
  assert(unknownPill.state === "unknown", "unknown status must expose unknown sentinel state");
  assert(unknownPill.visibleLabel === "Unknown state", "unknown status must render safe fallback label");
  assert(unknownPill.meaning === "Status value is unknown or drifted; treat as not verified.", "unknown status must not imply completion or receipt");
  assert(ui.isReceiptReviewState("unknown") === true, "unknown sentinel must be part of the public state vocabulary");
  assert(ui.isReceiptReviewState("protocol_drifted_state") === false, "state guard must narrow untyped strings");

  assert(ui.StatusPill({ state: "rejected_no_receipt" }).visibleLabel === "Rejected without receipt", "rejected label must preserve no-receipt semantics");
  assert(ui.StatusPill({ state: "quarantined_no_receipt" }).visibleLabel === "Quarantined without receipt", "quarantine label must preserve no-receipt semantics");

  // C6-28: unknown/drifted state must not be treated as proof no receipt
  // exists — absence of knowledge is not evidence of absence.
  assert(ui.isNoReceiptState("unknown") === false, "the unknown sentinel state must not imply no receipt");
  assert(ui.isNoReceiptState("future_receipted_state") === false, "an unrecognized future state must not imply no receipt");
  assert(ui.isNoReceiptState("not_submitted") === true, "a recognized state that positively establishes no receipt must still imply no receipt");
  assert(ui.isNoReceiptState("rejected_no_receipt") === true, "rejected_no_receipt must still imply no receipt");

  // C6-47: emphasis must be propagated, not silently dropped.
  assert(ui.StatusPill({ state: "under_review" }).emphasis === "default", "omitted emphasis must default to default");
  assert(ui.StatusPill({ state: "under_review", emphasis: "compact" }).emphasis === "compact", "compact emphasis must be honored in the view contract");

  // C6-27: the shared status-definition registry must not be runtime-mutable.
  try {
    ui.receiptReviewStateDefinitions.unknown.receiptImplication = "receipt_required";
    assert(false, "receiptReviewStateDefinitions must be frozen");
  } catch { /* expected: frozen object rejects assignment */ }

  // C6-27: shared design tokens must not be runtime-mutable.
  try {
    ui.codeAttestDesignTokens.colors.risk = "#000000";
    assert(false, "codeAttestDesignTokens must be deeply frozen");
  } catch { /* expected: frozen object rejects assignment */ }
}

function testReceiptBanner(ui) {
  const banner = ui.ReceiptBanner({
    vendorReceiptId: VALID_RECEIPT_ID,
    evidenceBundleId: VALID_BUNDLE_ID,
    receiptTimestamp: VALID_TIMESTAMP,
    verificationState: "received_with_receipt",
    manifestId: VALID_MANIFEST_ID,
    signingKeyVersion: "demo-key-v1",
    mldsaProfile: "ml_dsa_65"
  });

  assert(banner !== null, "valid ReceiptBanner props must return a view");
  assert(banner.kind === "receipt-banner", "ReceiptBanner must return receipt-banner view");
  assert(banner.role === "status", "receipt banner must use status semantics");
  assert(banner.ariaLive === "polite", "receipt banner should announce politely");
  assert(banner.summary.includes("Vendor Receipt"), "receipt summary must use plain-language receipt text");
  assert(banner.identities.some((identity) => identity.value === VALID_RECEIPT_ID), "receipt identity must render literally");
  assert(banner.identities.some((identity) => identity.value === VALID_BUNDLE_ID), "bundle identity must render literally");
  assert(banner.identities[0].label === "Vendor Receipt", "vendor receipt must be the first visible identity");
  assert(banner.identities[1].label === "Evidence Bundle", "evidence bundle must be the second visible identity");
  assert(banner.technicalDetails.rows[0].label === "Vendor Receipt", "vendor receipt must lead the technical detail rows");
  assert(banner.technicalDetails.rows[1].label === "Evidence Bundle", "evidence bundle must be the second technical detail row");
  assert(banner.technicalDetails.rows.at(-1).value === ui.receiptReviewStateDefinitions.received_with_receipt.label, "verification state technical row must reuse the canonical status label instead of a duplicated literal");
  assert(banner.timestamp.dateTime === VALID_TIMESTAMP, "timestamp dateTime must preserve UTC RFC3339 value");
  assert(banner.technicalDetails.expandedByDefault === false, "technical details must be expandable, not always expanded");
  assert(countIdentityValue(banner.identities, VALID_MANIFEST_ID) === 1, "manifest identity must appear once in visible identities");
  assert(countIdentityValue(banner.technicalDetails.rows, VALID_MANIFEST_ID) === 1, "manifest identity must appear once in technical rows");
  assertNoUnsafeView(banner);

  const copyableBanner = ui.ReceiptBanner({
    vendorReceiptId: VALID_RECEIPT_ID,
    evidenceBundleId: "sha256:foo&bar",
    receiptTimestamp: VALID_TIMESTAMP,
    verificationState: "received_with_receipt"
  });
  assert(copyableBanner?.identities.some((identity) => identity.value === "sha256:foo&bar"), "identity values must remain literal for copyability");
  assert(!JSON.stringify(copyableBanner).includes("&amp;"), "identity values must not be HTML-entity encoded inside view contracts");

  const blankDetailsLabelBanner = ui.ReceiptBanner({
    vendorReceiptId: VALID_RECEIPT_ID,
    evidenceBundleId: VALID_BUNDLE_ID,
    receiptTimestamp: VALID_TIMESTAMP,
    verificationState: "received_with_receipt",
    technicalDetailsLabel: ""
  });
  assert(blankDetailsLabelBanner?.technicalDetails.label === "Receipt technical details", "blank technicalDetailsLabel must use accessible default label");

  const directionHiddenBanner = ui.ReceiptBanner({
    vendorReceiptId: "vendor_receipt:‎‏؜\u{E0020}️\u{E0100}synthetic",
    evidenceBundleId: VALID_BUNDLE_ID,
    receiptTimestamp: VALID_TIMESTAMP,
    verificationState: "received_with_receipt"
  });
  assert(directionHiddenBanner !== null, "direction-hidden receipt fixture must still render after stripping invisible controls");
  assert(!/[؜‎‏︀-️\u{E0020}-\u{E007F}\u{E0100}-\u{E01EF}]/u.test(JSON.stringify(directionHiddenBanner)), "view text must strip direction-changing invisible controls");

  const nonStringReceiptBanner = ui.ReceiptBanner({
    vendorReceiptId: 12345,
    evidenceBundleId: VALID_BUNDLE_ID,
    receiptTimestamp: VALID_TIMESTAMP,
    verificationState: "received_with_receipt"
  });
  assert(nonStringReceiptBanner?.identities.some((identity) => identity.value === "12345"), "receipt text sanitizer must coerce JSON-sourced scalar inputs");
  for (const timestamp of [
    "2026-07-13T10:00:00.123456789Z",
    "2026-07-13T10:00:00+00:00"
  ]) {
    assert(ui.canRenderReceiptBanner({
      vendorReceiptId: VALID_RECEIPT_ID,
      evidenceBundleId: VALID_BUNDLE_ID,
      receiptTimestamp: timestamp,
      verificationState: "received_with_receipt"
    }) === true, `valid UTC RFC3339 form must be accepted: ${timestamp}`);
  }

  for (const invalid of [
    { vendorReceiptId: "", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "received_with_receipt" },
    { vendorReceiptId: "​‮", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: "", receiptTimestamp: VALID_TIMESTAMP, verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "2026-07-13T10:00:00+10:00", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "2026-07-13T10:00:00-00:00", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "2026-07-13t10:00:00z", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "2026-13-40T25:99:99Z", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: "0000-00-00T00:00:00Z", verificationState: "received_with_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "rejected_no_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "quarantined_no_receipt" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "verification_pending" },
    { vendorReceiptId: "vendor_receipt:x", evidenceBundleId: VALID_BUNDLE_ID, receiptTimestamp: VALID_TIMESTAMP, verificationState: "verified_with_receipt" },
    undefined,
    null
  ]) {
    assert(ui.canRenderReceiptBanner(invalid) === false, `invalid receipt banner props must be rejected: ${JSON.stringify(invalid)}`);
    assert(ui.ReceiptBanner(invalid) === null, "invalid receipt banner props must return null");
  }
}

function testRiskWarning(ui) {
  const warning = ui.RiskWarning({
    title: "No Vendor Receipt was issued",
    message: "CodeAttest could not verify the submitted bundle identity.",
    riskType: "failed_verification",
    audience: "customer",
    affectedIdentity: {
      label: "Evidence Bundle",
      value: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    },
    nextPaths: [
      { type: "retry", label: "Rerun Local Runner" },
      { type: "verify_receipt", label: "Verify receipt status" },
      { type: "support", label: "Contact support" },
      { type: "quarantine", label: "Move to quarantine" }
    ]
  });

  assert(warning.kind === "risk-warning", "RiskWarning must return risk-warning view");
  assert(warning.role === "alert", "risk warning must use alert semantics");
  assert(warning.affectedIdentity.value.includes("sha256:"), "affected identity must render");
  assert(warning.nextPaths.some((path) => path.type === "retry"), "retry path must render");
  assert(warning.nextPaths.some((path) => path.type === "support"), "support path must render");
  assert(!warning.nextPaths.some((path) => path.type === "quarantine"), "customer quarantine path must be omitted entirely");
  assertNoUnsafeView(warning);

  const vendorWarning = ui.RiskWarning({
    title: "Quarantine review required",
    message: "The bundle needs vendor-side handling.",
    riskType: "malformed_bundle",
    audience: "vendor",
    affectedIdentity: { label: "Evidence Bundle", value: VALID_BUNDLE_ID },
    nextPaths: [{ type: "quarantine", label: "Move to quarantine" }]
  });
  assert(vendorWarning.nextPaths.some((nextPath) => nextPath.type === "quarantine" && nextPath.actionable === true), "vendor quarantine path remains actionable");

  const fallbackWarning = ui.RiskWarning({
    title: "Receipt unavailable",
    message: "No Vendor Receipt exists for this submission attempt.",
    riskType: "failed_submission",
    audience: "customer",
    affectedIdentity: undefined,
    nextPaths: [undefined, null]
  });
  assert(fallbackWarning.affectedIdentity.label === "Affected identity", "missing affected identity must use placeholder label");
  assert(fallbackWarning.affectedIdentity.value === "unavailable", "missing affected identity must use placeholder value");
  assert(fallbackWarning.nextPaths.length === 0, "missing next paths must be treated as empty");

  const malformedWarning = ui.RiskWarning({
    title: "Receipt unavailable",
    message: "No Vendor Receipt exists for this submission attempt.",
    riskType: "failed_submission",
    audience: "customer",
    affectedIdentity: {},
    nextPaths: {}
  });
  assert(malformedWarning.affectedIdentity.label === "Affected identity", "malformed affected identity must use placeholder label");
  assert(malformedWarning.affectedIdentity.value === "unavailable", "malformed affected identity must use placeholder value");
  assert(malformedWarning.nextPaths.length === 0, "non-array next paths must be treated as empty");

  const partialPathWarning = ui.RiskWarning({
    title: "Receipt unavailable",
    message: "No Vendor Receipt exists for this submission attempt.",
    riskType: "failed_submission",
    audience: "vendor",
    affectedIdentity: { label: "Evidence Bundle", value: VALID_BUNDLE_ID },
    nextPaths: [{ type: "retry" }, { label: "Contact support" }, { type: "support", label: "Contact support" }]
  });
  assert(partialPathWarning.nextPaths.length === 1, "next paths missing type or label must be filtered out");
  assert(partialPathWarning.nextPaths[0].type === "support", "valid next path must survive filtering");

  const driftedAudienceWarning = ui.RiskWarning({
    title: "Quarantine review required",
    message: "The bundle needs vendor-side handling.",
    riskType: "malformed_bundle",
    audience: "protocol_drifted_audience",
    affectedIdentity: { label: "Evidence Bundle", value: VALID_BUNDLE_ID },
    nextPaths: [{ type: "quarantine", label: "Move to quarantine" }]
  });
  assert(!driftedAudienceWarning.nextPaths.some((nextPath) => nextPath.type === "quarantine"), "an unrecognized audience must not see the quarantine next path, matching the vendor/ops allowlist");

  const firstUnavailableWarning = ui.RiskWarning({
    title: "Receipt unavailable",
    message: "No Vendor Receipt exists for this submission attempt.",
    riskType: "failed_submission",
    audience: "customer",
    affectedIdentity: [{}, { label: "", value: "" }]
  });
  firstUnavailableWarning.affectedIdentities[0].value = "mutated";
  const secondUnavailableWarning = ui.RiskWarning({
    title: "Receipt unavailable",
    message: "No Vendor Receipt exists for this submission attempt.",
    riskType: "failed_submission",
    audience: "customer",
    affectedIdentity: [{}, { label: "", value: "" }]
  });
  assert(secondUnavailableWarning.affectedIdentities[0].value === "unavailable", "mutating one RiskWarning's all-invalid fallback identity must not leak a shared object into a later call");

  // C6-26: null/undefined/malformed roots and un-whitelisted riskType/audience
  // must fail closed to the explicit unavailable view, never throw.
  assert(ui.RiskWarning(null).title === "Status unavailable", "null RiskWarning props must not throw and must return the unavailable view");
  assert(ui.RiskWarning(undefined).title === "Status unavailable", "undefined RiskWarning props must not throw and must return the unavailable view");
  assert(ui.RiskWarning([]).title === "Status unavailable", "array RiskWarning props must be rejected");
  assert(ui.RiskWarning({
    title: "x",
    message: "y",
    riskType: "not_a_real_risk_type",
    audience: "customer"
  }).title === "Status unavailable", "an unwhitelisted riskType must fail closed instead of rendering an unknown enum");
  assert(ui.RiskWarning({
    title: "x",
    message: "y",
    riskType: "failed_verification",
    audience: "not_a_real_audience"
  }).title === "Status unavailable", "an unwhitelisted audience must fail closed instead of rendering an unknown enum");
  try {
    ui.unavailableRiskWarning.title = "mutated";
    assert(false, "unavailableRiskWarning singleton must be frozen");
  } catch { /* expected: frozen object rejects assignment */ }
}

function testEvidenceCard(ui) {
  const card = ui.EvidenceCard({
    artifactLabel: "Outbound Manifest",
    artifactIdentity: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    timestamp: "2026-07-13T11:00:00Z",
    actor: { label: "Local Runner", id: "codeattest-local-runner" },
    state: "not_submitted",
    detailAction: { label: "View manifest details" }
  });

  assert(card.kind === "evidence-card", "EvidenceCard must return evidence-card view");
  assert(card.oneBoundedArtifact === true, "EvidenceCard must model one bounded artifact");
  assert(card.identity.value.includes("sha256:"), "artifact identity must render");
  assert(card.timestamp?.dateTime === "2026-07-13T11:00:00Z", "artifact timestamp must preserve UTC RFC3339 value");
  assert(card.actions.every((action) => action.hoverOnly === false), "actions must not be hover-only");
  assert(card.actions.every((action) => action.minTargetSizePx >= 44), "actions must meet 44px target contract");
  assertNoUnsafeView(card);

  const invalidTimestampCard = ui.EvidenceCard({
    artifactLabel: "Outbound Manifest",
    artifactIdentity: VALID_MANIFEST_ID,
    timestamp: "not-a-timestamp",
    actor: null,
    state: "not_submitted",
    detailAction: { label: "" }
  });
  assert(invalidTimestampCard.timestamp === undefined, "EvidenceCard must omit invalid timestamp values");
  assert(invalidTimestampCard.actor === undefined, "EvidenceCard must omit null actor values");
  assert(invalidTimestampCard.actions[0].label === "View Outbound Manifest details", "blank detail action label must use accessible fallback");
  assertNoUnsafeView(invalidTimestampCard);

  // C6-26: a "one bounded artifact" card must never render with a blank
  // identity or label — that is worse than not rendering at all.
  assert(ui.EvidenceCard(null) === null, "null EvidenceCard props must return null, not throw");
  assert(ui.EvidenceCard(undefined) === null, "undefined EvidenceCard props must return null, not throw");
  assert(ui.EvidenceCard({ artifactLabel: "", artifactIdentity: VALID_MANIFEST_ID, state: "not_submitted" }) === null, "a blank artifact label must return null");
  assert(ui.EvidenceCard({ artifactLabel: "Outbound Manifest", artifactIdentity: "", state: "not_submitted" }) === null, "a blank artifact identity must return null");
}

function testTimelineEvent(ui) {
  const customerEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "2026-07-13T12:00:00Z",
    actor: { label: "CodeAttest Intake", id: "service:intake" },
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "internal_only",
    audience: "customer",
    internalNote: "internal-only triage note must not leak"
  });

  assert(customerEvent === null, "internal-only customer timeline events must be omitted entirely");

  const driftedVisibilityEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "2026-07-13T12:00:00Z",
    actor: { label: "CodeAttest Intake", id: "service:intake" },
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "protocol_drifted_visibility",
    audience: "customer"
  });
  assert(driftedVisibilityEvent === null, "an unrecognized visibility value must fail closed for a customer audience, not fall through mislabeled as internal");

  const multilineMessageEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "2026-07-13T12:00:00Z",
    actor: { label: "CodeAttest Intake\nSecond line", id: "service:intake" },
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "customer_facing",
    audience: "customer"
  });
  assert(multilineMessageEvent?.actor?.label === "CodeAttest Intake Second line", "sanitized text must separate lines with a space instead of gluing them together");

  const invalidTimestampEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "not-a-timestamp",
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "customer_facing",
    audience: "customer"
  });
  assert(invalidTimestampEvent === null, "TimelineEvent must return null for invalid timestamps");

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  try {
    const warnedEvent = ui.TimelineEvent({
      eventType: "receipt_issued",
      timestamp: "2026-07-13T12:00:00Z",
      artifactReferences: [{
        label: "Vendor Receipt",
        value: "vendor_receipt:synthetic_demo_001"
      }],
      visibility: "customer_facing",
      audience: "vendor",
      internalNote: "silently dropped customer-facing note"
    });
    assert(warnedEvent !== null, "customer-facing events with internalNote still render without the note");
    assert(warnedEvent.internalNote === undefined, "customer-facing internalNote must still be dropped from the view");
  } finally {
    console.warn = originalWarn;
  }
  assert(warnings.some((warning) => warning.includes("internalNote") && warning.includes("customer_facing")), "customer_facing internalNote must emit an explicit warning");

  const malformedReferenceEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "2026-07-13T12:00:00Z",
    artifactReferences: [{}],
    visibility: "customer_facing",
    audience: "customer"
  });
  assert(malformedReferenceEvent?.artifactReferences[0].label === "Artifact reference", "malformed artifact references must use fallback label");
  assert(malformedReferenceEvent?.artifactReferences[0].value === "unavailable", "malformed artifact references must use fallback value");

  const publicEvent = ui.TimelineEvent({
    eventType: "receipt_issued‮moc.live",
    timestamp: "2026-07-13T12:00:00Z",
    actor: { label: "CodeAttest Intake", id: "service:intake" },
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "customer_facing",
    audience: "customer"
  });

  assert(publicEvent !== null, "customer-facing timeline events must render");
  assert(publicEvent.timestamp.dateTime === "2026-07-13T12:00:00Z", "timeline timestamp must preserve UTC RFC3339 value");
  assert(publicEvent.visibility.label === "Customer-facing", "visibility label must render");
  assert(publicEvent.internalDetailsVisible === false, "customer mode must hide internal details");
  assert(!publicEvent.visibleEventType.includes("‮"), "visible timeline labels must strip bidi controls");
  assert(publicEvent.eventType.includes("‮"), "machine event type must preserve raw discriminator value");
  assertNoUnsafeView(publicEvent);

  const maliciousEvent = ui.TimelineEvent({
    eventType: "<script>evil</script>_receipt‮issued",
    timestamp: "2026-07-13T12:00:00Z",
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "customer_facing",
    audience: "customer"
  });
  assert(maliciousEvent !== null, "malicious-looking raw text should still produce a text-view contract");
  assert(maliciousEvent.visibleEventType.includes("<script>evil</script>"), "view text remains raw and must be escaped by rendering adapters");
  assert(!maliciousEvent.visibleEventType.includes("‮"), "visible event text must strip bidi controls");

  const vendorEvent = ui.TimelineEvent({
    eventType: "receipt_issued",
    timestamp: "2026-07-13T12:00:00Z",
    artifactReferences: [{
      label: "Vendor Receipt",
      value: "vendor_receipt:synthetic_demo_001"
    }],
    visibility: "internal_only",
    audience: "vendor",
    internalNote: "visible to vendor ops"
  });
  assert(vendorEvent?.internalDetailsVisible === true, "vendor mode may show internal note bodies");
  assert(vendorEvent?.internalNote === "visible to vendor ops", "vendor internal timeline events must attach the internal note");
}

function testAppShell(ui) {
  const shell = ui.AppShell({
    actorContext: { label: "Customer admin", id: "customer_user:maya" },
    selectedApplication: "payments-api",
    selectedCommit: "0123456789abcdef0123456789abcdef01234567",
    reviewState: "under_review",
    navigationLabel: "Receipt and review status"
  });

  assert(shell.kind === "app-shell", "AppShell must return app-shell view");
  assert(shell.actorContext?.label === "Customer admin", "actor context must render");
  assert(shell.selectedApplication === "payments-api", "selected application must render");
  assert(shell.selectedCommit?.length === 40, "selected commit must render");
  assert(shell.reviewState.visibleLabel === "Under review", "review state must render through StatusPill");
  assert(shell.separatesCustomerAndVendorControls === true, "app shell must separate customer/vendor controls");
  assertNoUnsafeView(shell);

  const nullishShell = ui.AppShell({
    actorContext: null,
    selectedApplication: null,
    selectedCommit: 12345,
    reviewState: "drifted_remote_state"
  });
  assert(nullishShell.actorContext === undefined, "AppShell must omit null actor context");
  assert(nullishShell.selectedApplication === undefined, "AppShell must omit null selected application");
  assert(nullishShell.selectedCommit === "12345", "AppShell must coerce JSON-sourced selected commit scalars");

  const driftedShell = ui.AppShell({ reviewState: "drifted_remote_state" });
  assert(driftedShell.reviewState.visibleLabel === "Unknown state", "AppShell must inherit safe StatusPill fallback");

  // C6-26/C6-28: a missing review state is absence of knowledge, not proof
  // nothing was submitted. Must default to "unknown", not the factual
  // "not_submitted", and must not throw on a null/undefined root.
  const emptyShell = ui.AppShell({});
  assert(emptyShell.reviewState.state === "unknown", "a missing review state must default to unknown, not not_submitted");
  const nullPropsShell = ui.AppShell(null);
  assert(nullPropsShell.reviewState.state === "unknown", "null AppShell props must not throw and must default to unknown");
  const undefinedPropsShell = ui.AppShell(undefined);
  assert(undefinedPropsShell.reviewState.state === "unknown", "undefined AppShell props must not throw and must default to unknown");
}

function testSafetyAndPerformance(ui) {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let fetchCalled = false;
  let timeoutCalled = false;

  globalThis.fetch = () => {
    fetchCalled = true;
    throw new Error("network must not be used by UI primitive contracts");
  };
  globalThis.setTimeout = () => {
    timeoutCalled = true;
    throw new Error("timers must not be used by UI primitive contracts");
  };

  try {
    const start = performance.now();
    const views = [
      ui.StatusPill({ state: "not_submitted" }),
      ui.RiskWarning({
        title: "Receipt unavailable",
        message: "No Vendor Receipt exists for this submission attempt.",
        riskType: "failed_submission",
        audience: "customer",
        affectedIdentity: { label: "Review", value: "review:synthetic_demo_001" },
        nextPaths: [{ type: "retry", label: "Retry submission" }]
      }),
      ui.EvidenceCard({
        artifactLabel: "Review",
        artifactIdentity: "review:synthetic_demo_001",
        state: "submitted"
      }),
      ui.AppShell({ reviewState: "submitted" })
    ];
    const elapsedMs = performance.now() - start;
    assert(elapsedMs < 50, `fixture primitive construction should stay lightweight, got ${elapsedMs}ms`);
    assert(fetchCalled === false, "primitive construction must not use fetch");
    assert(timeoutCalled === false, "primitive construction must not use timers");
    for (const view of views) {
      assertNoUnsafeView(view);
    }
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

async function testSourceSafety(workspacePathValue) {
  const sourceFiles = await collectSourceFiles(path.join(workspacePathValue, "src"));
  const combinedSource = (await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert(!combinedSource.includes("dangerouslySetInnerHTML"), "UI source must not use dangerouslySetInnerHTML");
  for (const forbidden of [
    "eval('1 + 1')",
    "api_key=",
    "password=",
    "secret=",
    "SOC 2 accepted",
    "certified",
    "regulator approved",
    "independent assurance",
    "compliance-ready",
    "audit accepted",
    "certify secure code",
    "guaranteed auditor acceptance",
    "no vulnerabilities",
    "submission successful",
    "upload successful",
    "receipt confirmed",
    "audit passed"
  ]) {
    assert(!combinedSource.toLowerCase().includes(forbidden.toLowerCase()), `UI source must avoid forbidden sample/copy text: ${forbidden}`);
  }
  assert(!/\baccepted\b/i.test(combinedSource), "UI source must avoid unqualified accepted copy");
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function assertNoUnsafeView(view) {
  const serialized = JSON.stringify(view);
  assert(!serialized.includes("dangerouslySetInnerHTML"), "view contract must not expose dangerous HTML hooks");
  assert(!serialized.includes("internal-only triage note"), "customer view must not leak internal note fixture text");
  assertWalk(view, (value, path) => {
    const key = path.at(-1);
    if (typeof value === "string" && key !== "eventType") {
      assert(!/‮/.test(value), "visible view text must not contain raw bidi override characters");
      assert(!/[ --]/.test(value), "visible view text must not contain C0 control characters");
    }
    if (value && typeof value === "object" && "hoverOnly" in value) {
      assert(value.hoverOnly === false, "actions must not be hover-only");
    }
    if (value && typeof value === "object" && "tabIndex" in value && value.tabIndex !== undefined) {
      assert(value.tabIndex <= 0, "positive tabIndex must not be used");
    }
  });
}

function assertWalk(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertWalk(item, visitor, [...path, String(index)]);
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertWalk(child, visitor, [...path, key]);
    }
  }
}

function countIdentityValue(rows, value) {
  return rows.filter((row) => row.value === value).length;
}

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(hexToRgb(foreground));
  const bg = relativeLuminance(hexToRgb(background));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex) {
  const match = /^#([a-f0-9]{6})$/i.exec(hex);
  assert(match, `invalid hex color: ${hex}`);
  const value = match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
}

function assertArrayEquals(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
