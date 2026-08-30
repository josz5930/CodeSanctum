import assert from "node:assert/strict";
import { buildTestServer, SEEDED, loginAs } from "./helpers/identity-fixtures.mjs";

let accessTimestamp = Date.parse("2026-07-20T00:00:00Z");
const { server, ports } = await buildTestServer({
  now: () => {
    const timestamp = new Date(accessTimestamp).toISOString().replace(/\.000Z$/, "Z");
    accessTimestamp += 1_000;
    return timestamp;
  }
});

const anonymous = await server.inject({ method: "GET", url: "/web/context" });
assert.equal(anonymous.statusCode, 401, anonymous.body);
assert.equal(anonymous.json().reason_code, "auth_credentials_invalid");
assert.equal(anonymous.json().message, "The credentials could not be authenticated.");

const pending = await server.inject({
  method: "GET",
  url: "/web/context",
  headers: { cookie: SEEDED.pendingCookie }
});
assert.equal(pending.statusCode, 401, pending.body);
assert.equal(pending.json().reason_code, "auth_credentials_invalid");

const cookie = await loginAs(server, SEEDED.customer);
const signedIn = await server.inject({
  method: "GET",
  url: "/web/context",
  headers: { cookie }
});
assert.equal(signedIn.statusCode, 200, signedIn.body);
const body = signedIn.json();
assert.equal(body.kind, "app-shell");
assert.equal(typeof body.navigationLabel, "string");
assert.ok(body.navigationLabel.length > 0);
assert.equal(typeof body.reviewState, "object");
assert.equal(body.reviewState.state, "unknown");
assert.equal(body.separatesCustomerAndVendorControls, true);

const injected = await server.inject({
  method: "GET",
  url: "/web/context?reviewState=finalized&selectedApplication=injected-app",
  headers: { cookie, "x-review-state": "finalized" },
  payload: { reviewState: "finalized", selectedApplication: "injected-app" }
});
assert.equal(injected.statusCode, 200, injected.body);
assert.equal(injected.json().reviewState.state, "unknown");
assert.equal(injected.json().selectedApplication, undefined);

const anonymousReviews = await server.inject({ method: "GET", url: "/web/reviews" });
assert.equal(anonymousReviews.statusCode, 401, anonymousReviews.body);
assert.equal(anonymousReviews.json().reason_code, "auth_credentials_invalid");
assert.equal(anonymousReviews.json().message, "The credentials could not be authenticated.");

const pendingReviews = await server.inject({
  method: "GET",
  url: "/web/reviews",
  headers: { cookie: SEEDED.pendingCookie }
});
assert.equal(pendingReviews.statusCode, 401, pendingReviews.body);
assert.equal(pendingReviews.json().reason_code, "auth_credentials_invalid");

const customerReviews = await server.inject({
  method: "GET",
  url: "/web/reviews",
  headers: { cookie }
});
assert.equal(customerReviews.statusCode, 200, customerReviews.body);
const customerBody = customerReviews.json();
assert.equal(customerBody.shell.kind, "app-shell");
assert.ok(Array.isArray(customerBody.reviews));
assert.equal(customerBody.reviews.length, 0, "a tenant-wide grant does not enumerate review ids");
assert.equal(
  customerBody.reviews.some((pill) => pill.state === "rejected_no_receipt"),
  false,
  "out-of-scope review is absent"
);

const beforeInScope = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
  .filter((event) => event.event_type === "evidence_accessed").length;
const beforeOutOfScope = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length;

const dualCookie = await loginAs(server, SEEDED.dualRole);
const listed = await server.inject({
  method: "GET",
  url: "/web/reviews",
  headers: { cookie: dualCookie }
});
assert.equal(listed.statusCode, 200, listed.body);
const listedBody = listed.json();
assert.equal(listedBody.shell.kind, "app-shell");
assert.equal(listedBody.shell.reviewState.state, "unknown");
assert.ok(Array.isArray(listedBody.reviews));
assert.equal(listedBody.reviews.length, 1, "granted reviews list without an artifact catalog");
const [inScopePill] = listedBody.reviews;
assert.equal(inScopePill.kind, "status-pill");
assert.equal(inScopePill.state, "received_with_receipt");
assert.equal(typeof inScopePill.visibleLabel, "string");
assert.ok(inScopePill.visibleLabel.length > 0);
assert.equal(
  listedBody.reviews.some((pill) => pill.state === "rejected_no_receipt"),
  false,
  "out-of-scope review is absent"
);

const accessedInScope = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
  .filter((event) => event.event_type === "evidence_accessed");
assert.equal(accessedInScope.length, beforeInScope + 1, "one evidence_accessed per revealed scope");
assert.equal(accessedInScope.at(-1).access_scope.review_scope, SEEDED.reviewInScope);
assert.equal(accessedInScope.at(-1).purpose, "customer_review_read");
assert.equal(
  (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewOutOfScope)).length,
  beforeOutOfScope,
  "a denial appends nothing"
);

const listedAgain = await server.inject({
  method: "GET",
  url: "/web/reviews",
  headers: { cookie: dualCookie }
});
assert.equal(listedAgain.statusCode, 200, listedAgain.body);
assert.equal(listedAgain.json().reviews.length, 1);
assert.equal(
  (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
    .filter((event) => event.event_type === "evidence_accessed").length,
  beforeInScope + 1,
  "repeat GET must not double-log"
);

// --- GET /web/reviews/:reviewScope (detail projection) ---

const anonymousDetail = await server.inject({ method: "GET", url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}` });
assert.equal(anonymousDetail.statusCode, 401, anonymousDetail.body);
assert.equal(anonymousDetail.json().reason_code, "auth_credentials_invalid");

const scopedCookie = await loginAs(server, SEEDED.scopedCustomer);
const beforeDetailAccess = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
  .filter((event) => event.event_type === "evidence_accessed").length;

const customerDetail = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}`,
  headers: { cookie: scopedCookie }
});
assert.equal(customerDetail.statusCode, 200, customerDetail.body);
const customerDetailBody = customerDetail.json();
assert.equal(customerDetailBody.shell.kind, "app-shell");
assert.equal(customerDetailBody.reviewScope, SEEDED.reviewInScope);
assert.equal(customerDetailBody.reviewState.state, "received_with_receipt");
// received_with_receipt yields a ReceiptBannerView built from the vendor-receipt record.
assert.notEqual(customerDetailBody.receipt, null);
assert.equal(customerDetailBody.receipt.kind, "receipt-banner");
assert.equal(customerDetailBody.noReceipt, null, "a receipted review shows no no-receipt warning");
assert.ok(
  customerDetailBody.receipt.identities.some((identity) => identity.value.startsWith("sha256:")),
  "banner carries the vendor receipt / evidence bundle identities"
);
// internal_only timeline events are omitted for a customer actor.
assert.ok(Array.isArray(customerDetailBody.timeline));
assert.equal(
  customerDetailBody.timeline.some((event) => event.eventType === "classification_recorded"),
  false,
  "internal_only classification event absent for the customer"
);
assert.equal(
  customerDetailBody.timeline.some((event) => event.internalNote !== undefined),
  false,
  "no internal note reaches the customer projection"
);
assert.ok(customerDetailBody.timeline.length >= 2, "customer-facing events remain");
assert.ok(Array.isArray(customerDetailBody.evidence) && customerDetailBody.evidence.length >= 1);
assert.equal(customerDetailBody.evidence[0].kind, "evidence-card");

const afterDetailAccess = (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
  .filter((event) => event.event_type === "evidence_accessed").length;
assert.equal(afterDetailAccess, beforeDetailAccess + 1, "one evidence_accessed per revealed detail scope");

const customerDetailAgain = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}`,
  headers: { cookie: scopedCookie }
});
assert.equal(customerDetailAgain.statusCode, 200, customerDetailAgain.body);
assert.equal(
  (await ports.evidenceLifecycleLog.loadLog(SEEDED.reviewInScope))
    .filter((event) => event.event_type === "evidence_accessed").length,
  beforeDetailAccess + 1,
  "repeat detail GET must not double-log"
);

// internal_only timeline events ARE present for a reviewer.
const reviewerCookie = await loginAs(server, SEEDED.reviewer);
const reviewerDetail = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}`,
  headers: { cookie: reviewerCookie }
});
assert.equal(reviewerDetail.statusCode, 200, reviewerDetail.body);
const reviewerDetailBody = reviewerDetail.json();
const internalEntry = reviewerDetailBody.timeline.find((event) => event.eventType === "classification_recorded");
assert.notEqual(internalEntry, undefined, "reviewer sees the internal_only classification event");
assert.equal(internalEntry.internalDetailsVisible, true);
assert.equal(typeof internalEntry.internalNote, "string");

// A rejected review yields no banner and an explicit no-receipt RiskWarning.
const rejectedDetail = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewRejected)}`,
  headers: { cookie: scopedCookie }
});
assert.equal(rejectedDetail.statusCode, 200, rejectedDetail.body);
const rejectedBody = rejectedDetail.json();
assert.equal(rejectedBody.reviewState.state, "rejected_no_receipt");
assert.equal(rejectedBody.receipt, null, "a rejected review has no receipt banner");
assert.notEqual(rejectedBody.noReceipt, null);
assert.equal(rejectedBody.noReceipt.role, "alert");
assert.equal(rejectedBody.noReceipt.riskType, "rejected_no_receipt");

// Out-of-scope detail is denied for an actor with no grant covering the review.
const outOfScopeDetail = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewOutOfScope)}`,
  headers: { cookie: scopedCookie }
});
assert.equal(outOfScopeDetail.statusCode, 403, outOfScopeDetail.body);
assert.equal(outOfScopeDetail.json().reason_code, "evidence_access_denied");

// --- GET /web/reviews/:reviewScope/findings (finding record + verification scope) ---

const anonymousFindings = await server.inject({ method: "GET", url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}/findings` });
assert.equal(anonymousFindings.statusCode, 401, anonymousFindings.body);

const customerFindings = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}/findings`,
  headers: { cookie: scopedCookie }
});
assert.equal(customerFindings.statusCode, 200, customerFindings.body);
const findingsBody = customerFindings.json();
assert.equal(findingsBody.shell.kind, "app-shell");
assert.ok(Array.isArray(findingsBody.findings) && findingsBody.findings.length === 1);
const [finding] = findingsBody.findings;
assert.equal(finding.kind, "customer-finding-record");
const sectionIds = finding.sections.map((section) => section.id);
for (const required of ["expert_classification", "evidence_basis", "reviewer_remediation_guidance", "verification_state"]) {
  assert.ok(sectionIds.includes(required), `finding record must render the ${required} section`);
}
// The verification-pass-scope disclosure is present and non-dismissible.
assert.notEqual(findingsBody.verificationScope, null);
assert.equal(findingsBody.verificationScope.kind, "verification-pass-scope");
assert.equal(findingsBody.verificationScope.disclosure.nonDismissible, true);
assert.ok(
  findingsBody.verificationScope.disclosure.body.some((line) => /limited to selected findings/i.test(line)),
  "scope disclosure states the pass is limited to selected findings"
);
assert.ok(
  findingsBody.verificationScope.disclosure.body.some((line) => /not a complete fresh/i.test(line)),
  "scope disclosure states it is not a fresh full review"
);

// Out-of-scope findings are denied.
const outOfScopeFindings = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewOutOfScope)}/findings`,
  headers: { cookie: scopedCookie }
});
assert.equal(outOfScopeFindings.statusCode, 403, outOfScopeFindings.body);

// --- GET /web/reviews/:reviewScope/attestation (attestation + static-bundle surfaces) ---

const anonymousAttestation = await server.inject({ method: "GET", url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}/attestation` });
assert.equal(anonymousAttestation.statusCode, 401, anonymousAttestation.body);

const customerAttestation = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}/attestation`,
  headers: { cookie: scopedCookie }
});
assert.equal(customerAttestation.statusCode, 200, customerAttestation.body);
const attestationBody = customerAttestation.json();
assert.equal(attestationBody.shell.kind, "app-shell");
assert.equal(attestationBody.reviewScope, SEEDED.reviewInScope);

// AttestationBuilder renders scope/evidence/limitation/reference sections and the receipt chain.
assert.equal(attestationBody.attestation.kind, "attestation-builder");
assert.equal(attestationBody.attestation.available, true);
assert.equal(attestationBody.attestation.audience, "customer");
assert.ok(attestationBody.attestation.receiptChain.some((row) => row.label === "Vendor Receipt"));
const attestationSectionTypes = attestationBody.attestation.sections.map((section) => section.sectionType);
for (const required of ["scope", "receipt_chain", "limitations"]) {
  assert.ok(attestationSectionTypes.includes(required), `attestation must render the ${required} section`);
}
assert.equal(attestationBody.attestation.disclosure.nonDismissible, true);
assert.equal(attestationBody.attestation.actions.length, 0, "customer audience gets no generate action (read-only)");

// AttestationFinalization is a pre-action confirmation that requires a customer actor and keeps context visible.
assert.equal(attestationBody.finalization.kind, "attestation-finalization");
assert.equal(attestationBody.finalization.available, true);
assert.equal(attestationBody.finalization.actorAuthority, "customer_user");
assert.ok(
  attestationBody.finalization.visibleContext.some((entry) => /signature verification/i.test(entry.label)),
  "finalization keeps signature-verification context visible"
);

// SupportingEvidenceMapping renders an approved profile with its acceptance disclaimer.
assert.notEqual(attestationBody.supportingEvidenceMapping, null);
assert.equal(attestationBody.supportingEvidenceMapping.available, true);
assert.ok(attestationBody.supportingEvidenceMapping.acceptanceDisclaimer.length > 0);

// StaticBundleGeneration carries the software-custody signing limitation.
assert.equal(attestationBody.staticBundle.kind, "static-bundle-generation");
assert.equal(attestationBody.staticBundle.available, true);
assert.equal(attestationBody.staticBundle.disclosure.nonDismissible, true);
assert.equal(attestationBody.staticBundle.actions.length, 0, "customer audience gets no regenerate action (read-only)");

// No route surfaces the internal-only pilot-learning contract.
assert.equal(/pilot-learning/.test(customerAttestation.body), false, "attestation route never emits pilot-learning");

// A reviewer sees the internal reviewer audience for the attestation.
const reviewerAttestation = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewInScope)}/attestation`,
  headers: { cookie: reviewerCookie }
});
assert.equal(reviewerAttestation.statusCode, 200, reviewerAttestation.body);
assert.equal(reviewerAttestation.json().attestation.audience, "reviewer");

// Out-of-scope attestation is denied.
const outOfScopeAttestation = await server.inject({
  method: "GET",
  url: `/web/reviews/${encodeURIComponent(SEEDED.reviewOutOfScope)}/attestation`,
  headers: { cookie: scopedCookie }
});
assert.equal(outOfScopeAttestation.statusCode, 403, outOfScopeAttestation.body);

await server.close();
console.log("Web routes test passed.");
