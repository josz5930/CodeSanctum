import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

const ui = await importCompiled("../../packages/ui/src/index.js");
const { ReceiptBanner } = await importCompiled("components/ReceiptBanner.js");
const { TimelineEvent } = await importCompiled("components/TimelineEvent.js");
const { EvidenceCard } = await importCompiled("components/EvidenceCard.js");
const { RiskWarning } = await importCompiled("components/RiskWarning.js");

// The banner builds (and renders) only for received_with_receipt.
const banner = ui.ReceiptBanner({
  vendorReceiptId: "sha256:aaa",
  evidenceBundleId: "sha256:bbb",
  receiptTimestamp: "2026-07-10T00:20:00Z",
  verificationState: "received_with_receipt"
});
assert.notEqual(banner, null);
const bannerHtml = renderToStaticMarkup(createElement(ReceiptBanner, { view: banner }));
assert.match(bannerHtml, /role="status"/);
assert.match(bannerHtml, /Vendor Receipt/);
assert.match(bannerHtml, /sha256:aaa/);
assert.match(bannerHtml, /sha256:bbb/);
// A rejected verification state yields no banner at all (the builder returns null).
assert.equal(ui.ReceiptBanner({
  vendorReceiptId: "sha256:aaa",
  evidenceBundleId: "sha256:bbb",
  receiptTimestamp: "2026-07-10T00:20:00Z",
  verificationState: "rejected_no_receipt"
}), null);

// A no-receipt state renders an explicit "no Vendor Receipt" risk warning with affected identity + next path.
const noReceipt = ui.RiskWarning({
  title: "Rejected without a Vendor Receipt",
  message: "CodeAttest rejected this submission. No Vendor Receipt was issued.",
  riskType: "rejected_no_receipt",
  audience: "customer",
  affectedIdentity: { label: "Review", value: "review:synthetic-demo-0002" },
  nextPaths: [{ type: "support", label: "Contact support" }]
});
const noReceiptHtml = renderToStaticMarkup(createElement(RiskWarning, { view: noReceipt }));
assert.match(noReceiptHtml, /role="alert"/);
assert.match(noReceiptHtml, /Vendor Receipt/);
assert.match(noReceiptHtml, /review:synthetic-demo-0002/);
assert.match(noReceiptHtml, /Contact support/);

// internal_only timeline entries never survive to the customer projection: the builder drops them.
assert.equal(ui.TimelineEvent({
  eventType: "classification_recorded",
  timestamp: "2026-07-19T00:00:00Z",
  artifactReferences: [],
  visibility: "internal_only",
  audience: "customer",
  internalNote: "reviewer only"
}), null);

// A reviewer (ops) audience keeps the internal note; the adapter surfaces it.
const internalEntry = ui.TimelineEvent({
  eventType: "classification_recorded",
  timestamp: "2026-07-19T00:00:00Z",
  artifactReferences: [{ label: "Artifact reference", value: "artifact_ref:finding_inscope" }],
  visibility: "internal_only",
  audience: "ops",
  internalNote: "reviewer classification rationale"
});
assert.notEqual(internalEntry, null);
const internalHtml = renderToStaticMarkup(createElement(TimelineEvent, { view: internalEntry }));
assert.match(internalHtml, /internal-note/);
assert.match(internalHtml, /reviewer classification rationale/);

// A customer-facing event never emits an internal note slot.
const customerEntry = ui.TimelineEvent({
  eventType: "customer_remediation_recorded",
  timestamp: "2026-07-19T00:00:00Z",
  artifactReferences: [{ label: "Artifact reference", value: "artifact_ref:finding_inscope" }],
  visibility: "customer_facing",
  audience: "customer"
});
const customerHtml = renderToStaticMarkup(createElement(TimelineEvent, { view: customerEntry }));
assert.doesNotMatch(customerHtml, /internal-note/);
assert.match(customerHtml, /Customer remediation recorded/);

// Evidence card renders its bounded identity, state, and an actionable button with a11y metadata.
const card = ui.EvidenceCard({
  artifactLabel: "Evidence reference",
  artifactIdentity: "artifact_ref:finding_inscope",
  state: "received_with_receipt"
});
const cardHtml = renderToStaticMarkup(createElement(EvidenceCard, { view: card }));
assert.match(cardHtml, /artifact_ref:finding_inscope/);
assert.match(cardHtml, /data-slot="evidence-card"/);
assert.match(cardHtml, /data-min-target-size-px="44"/);

console.log("@onevps/web review detail render test passed.");
