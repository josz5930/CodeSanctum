# Protocol

`protocol/` is the product-truth center for CodeAttest evidence semantics. It owns schemas, canonicalization notes, identity rules, signature envelope definitions, review-event contracts, retention/source-derived classes, and verification contracts. Every other area of this repository — the [Local Runner](../runner/README.md), [intake](../services/intake/README.md) and [worker](../services/worker/README.md) services, [`apps/control-plane`](../apps/control-plane/README.md), and every [`packages/`](../packages/README.md) package — consumes these contracts rather than redefining evidence meaning independently.

## What's Here

| Directory | Purpose |
| --- | --- |
| [`schemas/`](./schemas/README.md) | JSON Schema 2020-12 contracts for every protocol artifact (review scope, disclosure policy, outbound manifest, bundle manifest, vendor receipt, findings, verification, Attestation, static bundle, and more). |
| [`fixtures/`](./fixtures/README.md) | Canonical JSON, expected digests, signing inputs, verification outputs, and generated-binding drift fixtures that Rust and TypeScript code both validate against. |
| [`docs/`](./docs/README.md) | Protocol versioning, canonicalization, identity, and invariant notes. |

## v0 Authority

The initial `codeattest.v0` protocol surface is defined by JSON Schema 2020-12 files in `protocol/schemas/` and canonical fixtures in `protocol/fixtures/v0/`. Runner, intake, worker, web, and static bundle code must pass these shared fixtures before changing protocol behavior. Protocol-owned fields use `snake_case`, and schemas are closed with `additionalProperties: false`. The TypeScript package (`packages/protocol-ts`) consumes schema-derived generated output — it does not define protocol semantics.

## Evidence Boundary

The default workflow does not include a complete repository archive. Raw Snippet or targeted-file examples are source-code disclosure even when synthetic, so **public fixtures must carry `SYNTHETIC_DEMO_DATA` and `NOT_CUSTOMER_SOURCE` markers** and default to `transient_source_derived`.

Disclosure Policy is the protocol artifact that records what evidence may leave the customer environment before manifest preview or bundle construction. In v0 it supports exactly three coverage modes: `metadata_only`, `finding_context_snippets`, and `extended_approved_snippets_or_targeted_files`.

Sub-project G makes a final `partner_pilot_real_snippet_ready` gate traceable to proof rather than to booleans alone. `environment-readiness-evidence` records the reviewed result for one exact control/release/deployment, while `environment-readiness-decision` binds all seven records, two distinct approvers, the proposed gate approval-input digest, and a managed-key signature. These protocol records do not themselves claim that live readiness has been achieved; the repository fixtures remain synthetic and non-customer.

## Dependency Rule

`protocol/` must **not** depend on the runner, control-plane, intake, worker, static-bundle, generated protocol bindings, or `packages/protocol-ts` implementation code. `npm run lint:deps` enforces this direction — if you find yourself importing app/service code from here, the design is wrong, not the lint rule.

## Public/Open Area

`protocol/` is intended to be a public/open-source area. Use only synthetic or public non-customer fixtures here, and do not add vendor-private implementation details.

## How To Work Here

```sh
npm run protocol:check     # schema/gate validation
npm run fixtures:drift     # canonical fixture drift gate
npm run fixtures:coverage  # C1 coverage matrix check
npm run bindings:check     # generated TypeScript binding drift
npm run jcs:check          # RFC 8785 canonicalization fixtures
```

If you're editing a schema or fixture, read the manifest-update mechanics in [`fixtures/README.md`](./fixtures/README.md) first — fixture edits require hand-recomputing `sha256` entries in `protocol/fixtures/canonical-manifest.json` in this non-git-tracked workspace, or `fixtures:drift`/`bindings:check` will fail even when the change is semantically correct.
