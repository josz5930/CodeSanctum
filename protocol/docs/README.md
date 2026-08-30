# Protocol Docs

Home for protocol versioning, verification notes, canonicalization notes, identity rules, and compatibility guidance.

## What's Here

| Document | Covers |
| --- | --- |
| [`identity-and-canonicalization.md`](./identity-and-canonicalization.md) | v0 manifest identity, bundle identity, artifact digests, signing inputs, and submission correlation ids — how a protocol artifact's stable id is computed and what is excluded from that computation. |
| [`protocol-invariants.md`](./protocol-invariants.md) | Inventory of cross-field authority: which C1-01 rules are enforced directly by the Draft 2020-12 JSON Schemas, and which remain semantic-only (enforced by validators in `scripts/` or `packages/protocol-ts`, not by schema shape alone). |

## How This Differs From `protocol/schemas/` and `protocol/fixtures/`

- [`protocol/schemas/`](../schemas/README.md) defines the contracts.
- [`protocol/fixtures/`](../fixtures/README.md) proves the contracts with canonical examples.
- `protocol/docs/` explains the *reasoning* behind identity, canonicalization, and invariant rules that aren't obvious from reading a schema file alone — read this when you need to understand *why* an id is computed a certain way or *why* a rule lives in semantic validation instead of the schema itself.

## Rules for This Directory

- Keep this area focused on protocol **meaning**. Product surfaces (runner, services, apps, packages) can render or transport protocol artifacts, but they cannot redefine protocol semantics here or anywhere outside `protocol/`.
