# Intake Service

Home for the dedicated Evidence Bundle intake verification boundary.

Story 2.2 implements a dependency-free TypeScript service API: `verifyIntakeSubmission(request)`. It is a pure verification handler that later HTTP/router adapters can call, but it does not add a server, route, database, object store, queue, worker, or transport framework.

## Story 2.2 boundary

The service verifies an approved Evidence Bundle before it is eligible for receipt generation. It checks:

- accepted protocol version `codeattest.v0` on submitted protocol-shaped inputs;
- schema-shaped structure before semantic verification, including snake_case protocol fields and closed protocol enums;
- canonical Evidence Bundle identity recomputed with RFC 8785/JCS and SHA-256 while excluding `evidence_bundle_id` from the identity input;
- approved Outbound Manifest identity and Customer Approval displayed context;
- review-scoped submission token/key expectations supplied by caller-side authenticated context;
- real runner signature-envelope metadata, signed identity, key id/version, canonicalization, signing mode, and a verified ML-DSA-65 signature outcome bound to the envelope;
- artifact digest, size, type, manifest entry, portable anchored content path, and source-derived class checks at the intake boundary;
- synthetic demo evidence gates that block real Raw Snippets or targeted files unless synthetic fixture markers are present in both metadata and bytes.

Successful verification returns only the service-local `verified_receipt_eligible` result plus an intake record projection for Story 2.3. That projection references the approved Outbound Manifest, `manifest_id`, `evidence_bundle_id`, selected application, selected commit, repository identity hash, Disclosure Policy reference, Coverage Mode, runner/tool versions, `bundle_instance_id`, and `submission_attempt_id`.

Failed verification returns `rejected_no_receipt` or `quarantined_no_receipt` with non-sensitive reason codes and retry/support hints. Failure output must not contain raw snippet bytes, targeted file contents, token material, stack traces, or language implying the evidence was reviewed.

## Out of scope

Story 2.2 does not issue or sign Vendor Receipts, create a `received_with_receipt` state, persist intake records, normalize scanner output, create reviewer classifications, update finding status, generate Attestations, build static bundles, call a network service, or accept real customer source-derived evidence in the synthetic demo profile.

Run the Story 2.2 gate with:

```sh
npm run intake:story-2.2-check
```

## Story 2.3 boundary

Story 2.3 adds `generateVendorReceipt(request)` and `verifyVendorReceiptRecord(receipt)` as pure, dependency-free TypeScript service functions. They convert only a `verified_receipt_eligible` Story 2.2 result into a real `received_with_receipt` result after:

- validating the caller-supplied UTC `receipt_timestamp` and real ML-DSA-65 signing metadata;
- comparing approved vs received `manifest_id`, `evidence_bundle_id`, selected commit, repository identity hash, Coverage Mode, Disclosure Policy summary, and protocol-owned artifact count summaries derived from the approved Outbound Manifest and the submitted bundle's received outbound-manifest artifact bytes;
- constructing a schema-valid protocol `VendorReceipt` record with deterministic `vendor_receipt_id` over RFC 8785/JCS canonical receipt identity input;
- signing the receipt with the common `SignatureEnvelope` shape using `signed_identity_type: "vendor_receipt"`;
- returning public verification metadata with historical key id/version and event-append hints for later key rotation history.

Failed or quarantined intake inputs, comparison mismatches, unprovable or inconsistent count summaries, bad signing metadata, or invalid receipt timestamps return `rejected_no_receipt` or `quarantined_no_receipt`. Those results intentionally contain no receipt id, receipt timestamp, signature envelope, public verification metadata, or `received_with_receipt` field.

The Story 2.3 receipt summary is a typed view/export projection only. It gives copyable identifiers and accessible metadata, but it does not create React/Next/Tailwind UI, downloadable static bundles, customer evidence packages, or Epic 5 export behavior.

Signature bytes are real ML-DSA-65, with `signing_limitations` stating that key custody is self-hosted software custody, not a hardware security module. Story 2.3 does not add Cloud KMS, Secret Manager, HTTP routes, server startup, database/object-store persistence, queues, workers, append-only event-log writes, storage/access/deletion controls, or real customer source-derived evidence handling.

Run the Story 2.3 gate with:

```sh
npm run intake:story-2.3-check
```

Story 2.6 adds `buildSubmissionOutcome`, which turns an intake verification result into a `submission-outcome` protocol artifact. A verified result produces `received_with_receipt` only when a minted Vendor Receipt is supplied; without one it is refused with `submission_outcome_receipt_required` rather than downgraded into a softer success. A failed result keeps its own `rejected_no_receipt` / `quarantined_no_receipt` disposition, carries its reason codes, references no receipt, and expands `affected_identity` plus the bundle/attempt identity into `submission_identities`. Failure copy is claim-safe and never implies the evidence was reviewed or accepted. This adds no quarantine storage, release, expiry, or operator workflow.

Run the Story 2.6 gate with:

```sh
npm run control-plane:story-2.6-check
```
