import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { verifiedOutcome } from "../../../packages/protocol-ts/test/helpers/real-signature.mjs";
import { importCompiled } from "./helpers/compile.mjs";

function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../../../protocol/fixtures/v0/valid/${name}`, import.meta.url), "utf8"));
}

function loadSigningFixture(name) {
  return JSON.parse(readFileSync(new URL(`../../../protocol/fixtures/v0/signing-inputs/${name}`, import.meta.url), "utf8"));
}

const ui = await importCompiled("../../packages/ui/src/index.js");
const { AttestationBuilder } = await importCompiled("components/AttestationBuilder.js");
const { AttestationFinalization } = await importCompiled("components/AttestationFinalization.js");
const { SupportingEvidenceMapping } = await importCompiled("components/SupportingEvidenceMapping.js");
const { StaticBundleGeneration } = await importCompiled("components/StaticBundleGeneration.js");

const attestation = loadFixture("security-review-attestation.json");
const mapping = loadFixture("supporting-evidence-mapping.soc2.json");
const manifest = loadFixture("static-bundle-manifest.generated.json");
const signature = loadFixture("signature-envelope.static-bundle.json");
const signingInput = loadSigningFixture("static-bundle-manifest-identity.json");

// AttestationBuilder renders scope/receipt-chain/section content.
const attestationView = ui.AttestationBuilderView({ attestation, audience: "customer" });
assert.equal(attestationView.available, true);
const attestationHtml = renderToStaticMarkup(createElement(AttestationBuilder, { view: attestationView }));
assert.match(attestationHtml, /data-slot="attestation-builder"/);
assert.match(attestationHtml, /data-slot="receipt-chain"/);
assert.match(attestationHtml, /data-section-type="scope"/);
assert.match(attestationHtml, /data-non-dismissible="true"/);

// AttestationFinalization keeps receipt/signature/deletion/portal/limitation/recipient context visible for a customer actor.
const finalizationContext = {
  attestation_id: attestation.attestation_id,
  static_bundle_id: manifest.static_bundle_id,
  static_bundle_manifest_id: manifest.static_bundle_manifest_id,
  review_id: manifest.review_id,
  selected_application: "Synthetic payments API",
  selected_commit: attestation.selected_commit.commit_sha,
  disclosure_policy_summary: attestation.method.disclosure_summary,
  coverage_mode: attestation.method.coverage_mode,
  vendor_receipt_id: manifest.vendor_receipt_ref,
  included_artifact_refs: manifest.files.map((file) => file.artifact_ref),
  deleted_artifacts: manifest.minimization_disposition.deleted_refs.map((deletion_evidence_ref) => ({
    artifact_ref: "artifact_ref:deleted_transient",
    deletion_evidence_ref
  })),
  limitations: [...attestation.limitations],
  portal_entry_path: "portal/index.html",
  signature_verification_state: "verified_offline",
  recipient_notes: "Share with the approved evidence consumer.",
  sharing_notes: "Customer controls the exported copy."
};
const finalizationView = ui.AttestationFinalizationView({
  context: finalizationContext,
  actor: { actor_type: "customer_user", actor_id: "customer:maya" }
});
assert.equal(finalizationView.available, true);
assert.equal(finalizationView.actorAuthority, "customer_user");
const finalizationHtml = renderToStaticMarkup(createElement(AttestationFinalization, { view: finalizationView }));
assert.match(finalizationHtml, /data-slot="attestation-finalization"/);
assert.match(finalizationHtml, /data-slot="customer-control-notice"/);
assert.match(finalizationHtml, /Signature verification/i);
// A reviewer (non-customer) actor cannot finalize.
assert.equal(
  ui.AttestationFinalizationView({ context: finalizationContext, actor: { actor_type: "reviewer", actor_id: "reviewer:1" } }).available,
  false,
  "only a customer actor can finalize"
);

// SupportingEvidenceMapping renders the acceptance disclaimer for an approved profile.
const mappingView = ui.SupportingEvidenceMappingView({
  mapping,
  reviewId: attestation.review_id,
  attestationId: attestation.attestation_id
});
assert.equal(mappingView.available, true);
const mappingHtml = renderToStaticMarkup(createElement(SupportingEvidenceMapping, { view: mappingView }));
assert.match(mappingHtml, /data-slot="supporting-evidence-mapping"/);
assert.match(mappingHtml, /data-slot="acceptance-disclaimer"/);

// StaticBundleGeneration carries the non-dismissible software-custody signing limitation.
const bundleView = ui.StaticBundleGenerationView({
  bundle: { manifest, signingInput, signature, signatureOutcome: verifiedOutcome(signature) },
  audience: "customer"
});
assert.equal(bundleView.available, true);
const bundleHtml = renderToStaticMarkup(createElement(StaticBundleGeneration, { view: bundleView }));
assert.match(bundleHtml, /data-slot="static-bundle-generation"/);
assert.match(bundleHtml, /data-slot="signing-limitation"/);
assert.match(bundleHtml, /data-non-dismissible="true"/);

// The internal-only pilot-learning contract is withheld from customer and evidence-consumer audiences.
const metric = loadFixture("pilot-metric-record.json");
assert.notEqual(ui.PilotLearningView({ metric, audience: "internal" }), null, "internal audience sees pilot learning");
assert.equal(ui.PilotLearningView({ metric, audience: "customer" }), null, "customer never sees pilot learning");
assert.equal(ui.PilotLearningView({ metric, audience: "evidence_consumer" }), null, "evidence consumer never sees pilot learning");

console.log("@onevps/web attestation render test passed.");
