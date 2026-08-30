# Packages

Home for shared TypeScript packages consumed by [`apps/`](../apps/README.md) and [`services/`](../services/README.md).

## What's Here

| Package | Purpose |
| --- | --- |
| [`protocol-ts/`](./protocol-ts/README.md) | Generated/validated TypeScript bindings derived from [`protocol/schemas/`](../protocol/schemas/README.md). This is where protocol contracts become TypeScript types — it does not define protocol semantics itself. |
| [`ui/`](./ui/README.md) | Dependency-light, framework-agnostic serializable view contracts (receipt banners, risk warnings, reviewer workbench, customer-facing finding records). Consumed by a future React/Next.js surface without redefining evidence vocabulary. |
| [`static-bundle/`](./static-bundle/README.md) | Signed Static Bundle and Generated Static Portal projection: builds a content-addressed, signed export package and an offline HTML portal from retained protocol records. |

## Rules for This Directory

- Packages should preserve **protocol-centered dependency direction**: they depend on `protocol/` (directly or via `packages/protocol-ts`), never the reverse.
- Shared UI, generated/validated protocol bindings, and static-bundle tooling belong here rather than duplicated inside application-specific folders in `apps/` or `services/`.
- `packages/protocol-ts/src/generated/` is generator-owned — never hand-edit it; regenerate with `npm run generate --workspace @onevps/protocol-ts` and let `npm run bindings:check` catch drift.

## How To Work Here

Run everything from the repository root — see the [root README's command reference](../README.md#4-command-reference). Per-package test runs:

```sh
npm run test --workspace @onevps/protocol-ts
npm run test --workspace @onevps/ui
npm run test --workspace @onevps/static-bundle
```
