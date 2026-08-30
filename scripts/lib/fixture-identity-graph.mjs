// Declarative description of the protocol fixture corpus's identity cascade.
//
// D3-2: retiring synthetic signing rewrites `public_verification_metadata` /
// `verification_metadata` inside documents that are part of an identity input,
// so every computed identity downstream of them moves and every fixture that
// quotes one of those identities has to be rewritten with it. That cascade is
// too wide to hand-edit, so `scripts/regenerate-signature-fixtures.mjs` walks
// these tables instead. The order below is the whole design: each entry is
// recomputed only after every entry above it, because its identity input
// embeds one of their identities.
//
// Ground truth for `field`, `namespace`, `excludes` and `identity_input` is
// `protocol/fixtures/canonical-manifest.json`'s `canonicalIdentities` array
// plus each fixture's own `identity_input_excludes` declaration. The
// dependency order was derived by checking which identity digests literally
// occur in each identity input document.

// Fixtures whose identity is declared in `canonicalIdentities`. Each one has a
// committed identity-input document, which `fixtures:drift` hashes directly,
// so the regenerator rewrites that document too rather than only the fixture.
//
// `identity_input_derivation`:
//   "excludes" - the identity input is the fixture minus `excludes`, so the
//                regenerator can rebuild it from the fixture.
//   "manual"   - the identity input is a bespoke projection of the fixture
//                (review-scope flattens `runner` and `selected_application`
//                and drops `technical_context` / `dependency_manifests`), so
//                it is treated as the source of truth and only has identity
//                references substituted into it.
const CANONICAL_IDENTITIES = [
  { fixture: "v0/valid/review-scope.json", field: "review_scope_id", excludes: ["review_scope_id"], identity_input: "v0/valid/review-scope.identity-input.json", identity_input_derivation: "manual" },
  { fixture: "v0/valid/review-event.json", field: "event_id", excludes: ["event_id"], identity_input: "v0/valid/review-event.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.access-control.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.access-control.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.access-logging.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.access-logging.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.encryption-at-rest.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.encryption-at-rest.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.retention-defaults.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.retention-defaults.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.deletion-controls.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.deletion-controls.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.demo-budget-gate.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.demo-budget-gate.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.signing-release-trust.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.signing-release-trust.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.failed-encryption.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.failed-encryption.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.stale-access-control.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.stale-access-control.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-evidence.wrong-release-access-control.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"], identity_input: "v0/valid/environment-readiness-evidence.wrong-release-access-control.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-decision.approved.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"], identity_input: "v0/valid/environment-readiness-decision.identity-input.json" },
  { fixture: "v0/valid/environment-readiness-decision.declined.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"], identity_input: "v0/valid/environment-readiness-decision.declined.identity-input.json" },
  { fixture: "v0/valid/disclosure-policy.json", field: "disclosure_policy_id", excludes: ["disclosure_policy_id"], identity_input: "v0/valid/disclosure-policy.identity-input.json" },
  { fixture: "v0/valid/disclosure-policy.extended.json", field: "disclosure_policy_id", excludes: ["disclosure_policy_id"], identity_input: "v0/valid/disclosure-policy.extended.identity-input.json" },
  { fixture: "v0/valid/disclosure-policy.metadata-only.json", field: "disclosure_policy_id", excludes: ["disclosure_policy_id"], identity_input: "v0/valid/disclosure-policy.metadata-only.identity-input.json" },
  { fixture: "v0/valid/outbound-manifest.json", field: "manifest_id", excludes: ["manifest_id"], identity_input: "v0/valid/outbound-manifest.identity-input.json" },
  { fixture: "v0/valid/bundle-manifest.json", field: "evidence_bundle_id", excludes: ["evidence_bundle_id"], identity_input: "v0/valid/bundle-manifest.identity-input.json" },
  { fixture: "v0/valid/vendor-receipt.json", field: "vendor_receipt_id", excludes: ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"], identity_input: "v0/valid/vendor-receipt.identity-input.json" },
  { fixture: "v0/valid/security-review-attestation.json", field: "attestation_id", namespace: "attestation", excludes: ["attestation_id"], identity_input: "v0/valid/security-review-attestation.identity-input.json" },
  { fixture: "v0/valid/static-bundle-manifest.generated.json", field: "static_bundle_manifest_id", excludes: ["static_bundle_manifest_id"], identity_input: "v0/valid/static-bundle-manifest.identity-input.json" },
  { fixture: "v0/valid/static-bundle-manifest.finalized.json", field: "static_bundle_manifest_id", excludes: ["static_bundle_manifest_id"], identity_input: "v0/valid/static-bundle-manifest.finalized.identity-input.json" },
  { fixture: "v0/valid/attestation-package-finalization.json", field: "attestation_package_finalization_id", namespace: "attestation_finalization", excludes: ["attestation_package_finalization_id", "export_state", "exported_at"], identity_input: "v0/valid/attestation-package-finalization.identity-input.json" }
];

// Fixtures that carry a self-consistent computed identity without declaring
// one in `canonicalIdentities`, and whose non-excluded content quotes an
// identity above (or carries signing metadata), so their own identity moves
// with the cascade. Verified by recomputing each one against the corpus as it
// stands: every entry here already agrees with its committed value.
//
// The remaining self-consistent fixtures (`v0/invalid/review-event.*.json`,
// `v0/valid/review-event.verification-*.json`) are deliberately omitted: they
// quote no identity in this cascade and hold no signing metadata, so nothing
// can move them.
const DERIVED_IDENTITIES = [
  { fixture: "v0/invalid/environment-readiness-evidence.self-reviewed.json", field: "readiness_evidence_id", excludes: ["readiness_evidence_id"] },
  { fixture: "v0/invalid/environment-readiness-decision.stale.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/environment-readiness-decision.failed-control.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/environment-readiness-decision.duplicate-control.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/environment-readiness-decision.missing-control.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/environment-readiness-decision.wrong-release.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/environment-readiness-decision.self-approved.json", field: "readiness_decision_id", excludes: ["readiness_decision_id", "decision_signature"] },
  { fixture: "v0/invalid/vendor-receipt.self-referential-identity-input.json", field: "vendor_receipt_id", excludes: ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"] },
  { fixture: "v0/invalid/vendor-receipt.signature-identity-mismatch.json", field: "vendor_receipt_id", excludes: ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"] },
  { fixture: "v0/invalid/vendor-receipt.signature-wrong-identity-type.json", field: "vendor_receipt_id", excludes: ["vendor_receipt_id", "receipt_signature", "public_verification_metadata.signed_identity"] },
  { fixture: "v0/invalid/static-bundle-manifest.internal-learning-file.json", field: "static_bundle_manifest_id", excludes: ["static_bundle_manifest_id"] },
  { fixture: "v0/valid/attestation-package-finalization.exported.json", field: "attestation_package_finalization_id", namespace: "attestation_finalization", excludes: ["attestation_package_finalization_id", "export_state", "exported_at"] },
  { fixture: "v0/invalid/attestation-package-finalization.exported-missing-timestamp.json", field: "attestation_package_finalization_id", namespace: "attestation_finalization", excludes: ["attestation_package_finalization_id", "export_state", "exported_at"] },
  { fixture: "v0/invalid/attestation-package-finalization.vendor-actor.json", field: "attestation_package_finalization_id", namespace: "attestation_finalization", excludes: ["attestation_package_finalization_id", "export_state", "exported_at"] }
];

export const FIXTURE_IDENTITY_ORDER = [...CANONICAL_IDENTITIES, ...DERIVED_IDENTITIES];

// Signature envelopes rewritten after every identity above is final, because
// each one signs a signing input that restates an identity. `pointer` locates
// the envelope inside its file.
//
// D3-1: the negative and support fixtures below used to carry synthetic bytes
// that restated their own identity digest, so they followed the cascade for
// free. Real ML-DSA bytes cannot be derived from a digest, so they are signed
// here instead -- each one over the signing input for the identity it claims
// to sign, which is what makes their *declared* defect (a wrong signed
// identity, a wrong identity type, a stale timestamp) the only thing wrong
// with them.
export const SIGNATURE_FIXTURES = [
  { fixture: "v0/valid/environment-readiness-decision.approved.json", pointer: ["decision_signature"], signing_input: "v0/signing-inputs/environment-readiness-decision-identity.json" },
  { fixture: "v0/valid/signature-envelope.bundle.json", pointer: [], signing_input: "v0/signing-inputs/bundle-manifest-identity.json" },
  { fixture: "v0/valid/signature-envelope.manifest.json", pointer: [], signing_input: "v0/signing-inputs/outbound-manifest-identity.json" },
  { fixture: "v0/valid/signature-envelope.receipt.json", pointer: [], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/valid/vendor-receipt.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/valid/signature-envelope.static-bundle.json", pointer: [], signing_input: "v0/signing-inputs/static-bundle-manifest-identity.json" },
  { fixture: "v0/valid/signature-envelope.static-bundle-finalized.json", pointer: [], signing_input: "v0/signing-inputs/static-bundle-manifest-finalized-identity.json" },
  { fixture: "v0/valid/signature-envelope.attestation-finalization.json", pointer: [], signing_input: "v0/signing-inputs/attestation-package-finalization-identity.json" },
  { fixture: "v0/invalid/signature-envelope.signed-identity-mismatch.json", pointer: [], signing_input: "v0/signing-inputs/bundle-manifest-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.approved-received-mismatch.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.invalid-timestamp.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.missing-key-metadata.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.quarantined-no-receipt-misuse.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.rejected-no-receipt-misuse.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.signature-identity-mismatch.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/invalid/vendor-receipt.signature-wrong-identity-type.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" },
  { fixture: "v0/support/vendor-receipt.not-received.json", pointer: ["receipt_signature"], signing_input: "v0/signing-inputs/vendor-receipt-identity.json" }
];

// Verification packages inline byte-identical copies of a signing input and a
// signature envelope, plus each copy's canonical digest and byte length, plus
// an `attachment_index_id` over everything else -- see
// `createVerificationPackage` in
// `packages/static-bundle/src/signed-static-bundle.ts`. Every one of those
// values moves when the signature does, so the package is re-projected from
// its two sources as a unit once the signature envelopes are final.
// `tamper_signature_bytes` re-projects the package exactly like its valid
// sibling and then changes the last base64url character of the embedded
// signature, which is what makes the negative fixture's declared failure
// (`static_bundle_verification_signature_invalid`) the bytes themselves rather
// than a stale attachment digest.
export const VERIFICATION_PACKAGE_FIXTURES = [
  { fixture: "v0/valid/static-bundle-verification-package.generated.json", signing_input: "v0/signing-inputs/static-bundle-manifest-identity.json", signature_envelope: "v0/valid/signature-envelope.static-bundle.json" },
  { fixture: "v0/valid/static-bundle-verification-package.finalized.json", signing_input: "v0/signing-inputs/static-bundle-manifest-finalized-identity.json", signature_envelope: "v0/valid/signature-envelope.static-bundle-finalized.json" },
  { fixture: "v0/invalid/static-bundle-verification-package.tampered-signature.json", signing_input: "v0/signing-inputs/static-bundle-manifest-identity.json", signature_envelope: "v0/valid/signature-envelope.static-bundle.json", tamper_signature_bytes: true }
];

// The ML-DSA vectors are the signer's own input: regenerating them from
// themselves is circular, and `runner/crates/local-runner-scaffold/tests/
// ml_dsa_vectors.rs` already proves they regenerate from the committed seed.
export const REGENERATION_EXCLUDED_FILES = ["v0/support/ml-dsa-65-test-vectors.json"];
