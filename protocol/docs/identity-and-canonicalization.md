# Identity and Canonicalization

The `codeattest.v0` fixtures use RFC 8785 JSON Canonicalization Scheme as the canonicalization authority and algorithm-prefixed SHA-256 ids for demo identity expectations. JavaScript protocol gates use the pinned npm `canonicalize` package, and Rust Local Runner identity helpers use the pinned `serde_json_canonicalizer` crate. Their canonical UTF-8 output is the signing and hash input for manifest, Disclosure Policy, and Evidence Bundle identities.

## Manifest Identity

`manifest_id` is computed from `protocol/fixtures/v0/valid/outbound-manifest.identity-input.json`. The identity input is the outbound manifest content without `manifest_id`, so hashing is not self-referential. The Story 1.7 manifest identity is over preview metadata and category disclosures, not over source files, terminal output, archive bytes, approval state, transport packaging, or a signed evidence bundle.

The fixture expectation is recorded in both `protocol/fixtures/v0/fixture-index.json` and `protocol/fixtures/canonical-manifest.json`. `npm run protocol:check` and `npm run fixtures:drift` recompute the value and fail if it changes without an intentional fixture update. The identity input must not contain `manifest_id`; self-referential identity-input fixtures are rejected.

## Evidence Bundle Identity

`evidence_bundle_id` is computed from `protocol/fixtures/v0/valid/bundle-manifest.identity-input.json`. The input includes `manifest_id`, approved customer approval reference, `bundle_state`, review scope / Disclosure Policy / scanner references, `bundle_instance_id`, `submission_attempt_id`, runner/tool versions, artifact references, verification metadata, and local cleanup intent, but excludes `evidence_bundle_id` itself.

The identity is over typed bundle-manifest metadata, not over archive bytes, terminal output, zip metadata, transport packaging, or signature bytes. Story 1.8 keeps the bundle `not_submitted`; it does not produce a Vendor Receipt or received state.

## Customer Approval

Customer approval is a separate artifact from the outbound manifest. Approved decisions preserve the displayed `manifest_id`, selected commit, repository identity hash, Coverage Mode, Disclosure Policy reference, warnings, bundle preview summary, decision timestamp, and optional approving actor. Declined decisions stay `not_submitted` and do not create a bundle identity or signature envelope.

## Portable Artifact Paths

Artifact references that carry `content_path` use portable paths relative to an explicit `content_path_anchor`. Manifest and bundle identity inputs must not include host-local absolute paths, Windows drive prefixes, backslashes, traversal segments, null bytes, or symlink-root escapes. Current anchors include manifest artifacts, bundle artifacts, bundle source-derived artifacts, and fixture root.

## Artifact Digests

Artifact references use algorithm-prefixed SHA-256 digests for fixture content. Raw Snippet-like fixtures are source-code disclosure even when synthetic, must include `SYNTHETIC_DEMO_DATA` and `NOT_CUSTOMER_SOURCE`, and default to `transient_source_derived`.

## Signing Inputs

Signing-input fixtures in `protocol/fixtures/v0/signing-inputs/` point to typed identity inputs and record the `ml_dsa_65` profile. Runner and vendor signatures sign identities and metadata, not archive bytes.

The signature-envelope fixtures contain real ML-DSA-65 signature bytes over the domain-separated canonical signing input. `signing_mode` and `signing_limitations` remain required so each envelope states whose custody its key is under and what a valid signature does not attest to.

## Vendor Receipt Identity

`vendor_receipt_id` is computed from `protocol/fixtures/v0/valid/vendor-receipt.identity-input.json`. The identity input is the Vendor Receipt record's immutable receipt metadata without `vendor_receipt_id`, without the receipt signature envelope, and without repeated public verification metadata whose value is the receipt id itself (`public_verification_metadata.signed_identity`). This keeps receipt identity non-self-referential while still binding the received bundle identity, approved manifest identity, receipt timestamp, receiving environment, selected commit, repository identity hash, Coverage Mode, Disclosure Policy summary, artifact count summaries, comparison rows, and pre-signing public key metadata.

`protocol/fixtures/v0/valid/vendor-receipt.json` embeds the common signature envelope shape with `signed_identity_type: "vendor_receipt"`; `protocol/fixtures/v0/valid/signature-envelope.receipt.json` and `protocol/fixtures/v0/signing-inputs/vendor-receipt-identity.json` provide standalone signing fixtures for gate and parity checks. Fixture signatures are real ML-DSA-65 bytes over the committed test key, with `signing_limitations` stating that key custody is self-hosted software custody, not a hardware security module.


`bundle_instance_id` identifies a generated local bundle instance. `submission_attempt_id` identifies a send attempt for that bundle. Later services can use both ids to distinguish reruns and submissions without treating a complete repository archive as part of the default workflow.

## Local Runner Attempts

`local-runner-attempt` records are append-oriented status/correlation records, not canonical bundle identities. They expose stable comparison fields such as selected commit, repository identity hash, manifest identity, approval id, bundle identity when one exists, runner version, and local `attempt_id`.

Failed pre-approval attempts do not carry `evidence_bundle_id`, `bundle_instance_id`, or `submission_attempt_id`. Post-approval failures preserve manifest and approval identity metadata but still state that no signed Evidence Bundle is ready. Successful local reruns carry a new `attempt_id` and distinct bundle/submission identifiers when a new signed local bundle is created. All Story 1.9 attempt records keep `remote_state: not_submitted`; Vendor Receipt, received, and finalized states belong to later intake workflows.
