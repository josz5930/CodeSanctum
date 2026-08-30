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
const { AppShell } = await importCompiled("components/AppShell.js");
const { CustomerFindingRecord } = await importCompiled("components/CustomerFindingRecord.js");
const { VerificationPassScope } = await importCompiled("components/VerificationPassScope.js");
const { AttestationBuilder } = await importCompiled("components/AttestationBuilder.js");
const { AttestationFinalization } = await importCompiled("components/AttestationFinalization.js");
const { SupportingEvidenceMapping } = await importCompiled("components/SupportingEvidenceMapping.js");
const { StaticBundleGeneration } = await importCompiled("components/StaticBundleGeneration.js");

const attestation = loadFixture("security-review-attestation.json");
const manifest = loadFixture("static-bundle-manifest.generated.json");
const signature = loadFixture("signature-envelope.static-bundle.json");
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
  signature_verification_state: "verified_offline"
};

const rendered = [
  createElement(AppShell, { view: ui.AppShell({ actorContext: { label: "customer_viewer", id: "account:synthetic-customer" } }) }),
  createElement(CustomerFindingRecord, {
    view: ui.CustomerFindingRecordView({ record: loadFixture("customer-facing-finding-record.json"), audience: "customer" })
  }),
  createElement(VerificationPassScope, {
    view: ui.VerificationPassScopeView({ scope: loadFixture("verification-pass-scope.customer-facing-projection.json"), audience: "customer" })
  }),
  createElement(AttestationBuilder, { view: ui.AttestationBuilderView({ attestation, audience: "customer" }) }),
  createElement(AttestationFinalization, {
    view: ui.AttestationFinalizationView({ context: finalizationContext, actor: { actor_type: "customer_user", actor_id: "customer:maya" } })
  }),
  createElement(SupportingEvidenceMapping, {
    view: ui.SupportingEvidenceMappingView({
      mapping: loadFixture("supporting-evidence-mapping.soc2.json"),
      reviewId: attestation.review_id,
      attestationId: attestation.attestation_id
    })
  }),
  createElement(StaticBundleGeneration, {
    view: ui.StaticBundleGenerationView({
      bundle: {
        manifest,
        signingInput: loadSigningFixture("static-bundle-manifest-identity.json"),
        signature,
        signatureOutcome: verifiedOutcome(signature)
      },
      audience: "customer"
    })
  })
].map((element) => renderToStaticMarkup(element)).join("");

// Every actionable element (buttons across adapters + the shell sign-out) carries
// the 44px target-size, focus-ring hook, and reduced-motion metadata.
const buttonCount = (rendered.match(/<button/g) ?? []).length;
assert.ok(buttonCount > 0, "the rendered surface has actionable buttons to check");
assert.equal((rendered.match(/data-focus-ring="visible"/g) ?? []).length, buttonCount, "every button exposes a focus-ring hook");
assert.equal((rendered.match(/data-reduced-motion="respected"/g) ?? []).length, buttonCount, "every button respects reduced motion");

// Every declared target size (buttons and the text-first status indicators alike)
// meets the 44px minimum; buttons additionally each carry one.
const targetSizes = [...rendered.matchAll(/data-min-target-size-px="(\d+)"/g)].map((match) => Number(match[1]));
assert.ok(targetSizes.length >= buttonCount, "every button declares a target size");
for (const size of targetSizes) {
  assert.ok(size >= 44, `actionable target size ${size} is below the 44px minimum`);
}

// No adapter emits a positive tabIndex or a hover-only action.
assert.doesNotMatch(rendered, /tabindex="[1-9]/i, "no positive tabIndex");
assert.doesNotMatch(rendered, /data-hover-only="true"/, "no hover-only action");

console.log("@onevps/web accessibility metadata test passed.");
