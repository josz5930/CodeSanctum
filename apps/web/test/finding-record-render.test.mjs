import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importCompiled } from "./helpers/compile.mjs";

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../../../protocol/fixtures/v0/valid/${name}`, import.meta.url), "utf8"));
}

const ui = await importCompiled("../../packages/ui/src/index.js");
const { CustomerFindingRecord } = await importCompiled("components/CustomerFindingRecord.js");
const { VerificationPassScope } = await importCompiled("components/VerificationPassScope.js");

const findingRecord = loadFixture("customer-facing-finding-record.json");
assert.equal(findingRecord.evidence_consumer_export, "include", "fixture precondition: export included");

// A valid record renders the classification / evidence-basis / remediation / verification sections.
const customerView = ui.CustomerFindingRecordView({ record: findingRecord, audience: "customer" });
assert.equal(customerView.kind, "customer-finding-record");
const sectionIds = customerView.sections.map((section) => section.id);
for (const required of ["expert_classification", "evidence_basis", "reviewer_remediation_guidance", "verification_state"]) {
  assert.ok(sectionIds.includes(required), `missing section ${required}`);
}
const findingHtml = renderToStaticMarkup(createElement(CustomerFindingRecord, { view: customerView }));
assert.match(findingHtml, /data-slot="customer-finding-record"/);
assert.match(findingHtml, /data-section-id="expert_classification"/);
assert.match(findingHtml, /data-section-id="verification_state"/);

// Export posture: an included record is visible to an evidence_consumer; an excluded one is not.
const consumerIncluded = ui.CustomerFindingRecordView({ record: findingRecord, audience: "evidence_consumer" });
assert.notEqual(consumerIncluded.recordRef, "customer_facing_finding:unavailable", "included record stays visible to evidence_consumer");

const excludedRecord = { ...findingRecord, evidence_consumer_export: "exclude" };
const consumerExcluded = ui.CustomerFindingRecordView({ record: excludedRecord, audience: "evidence_consumer" });
assert.equal(consumerExcluded.recordRef, "customer_facing_finding:unavailable", "excluded record is withheld from evidence_consumer");
// The same excluded record still renders for the customer audience.
const customerOfExcluded = ui.CustomerFindingRecordView({ record: excludedRecord, audience: "customer" });
assert.notEqual(customerOfExcluded.recordRef, "customer_facing_finding:unavailable");

// Malformed / claim-unsafe input yields the unavailable state, not a throw.
const malformed = ui.CustomerFindingRecordView({ record: { visibility: "customer_facing", nonsense: true }, audience: "customer" });
assert.equal(malformed.sections.some((section) => section.id === "unavailable"), true);
const malformedHtml = renderToStaticMarkup(createElement(CustomerFindingRecord, { view: malformed }));
assert.match(malformedHtml, /data-section-id="unavailable"/);

// Verification pass scope: the non-dismissible disclosure is always present.
const scope = ui.VerificationPassScopeView({
  scope: loadFixture("verification-pass-scope.customer-facing-projection.json"),
  audience: "customer"
});
assert.equal(scope.kind, "verification-pass-scope");
assert.equal(scope.disclosure.nonDismissible, true);
const scopeHtml = renderToStaticMarkup(createElement(VerificationPassScope, { view: scope }));
assert.match(scopeHtml, /data-non-dismissible="true"/);
assert.match(scopeHtml, /limited to selected findings/i);
assert.match(scopeHtml, /not a complete fresh/i);

console.log("@onevps/web finding record render test passed.");
