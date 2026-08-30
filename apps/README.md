# Apps

Home for TypeScript application surfaces — the vendor/customer-facing side of CodeAttest, as opposed to the customer-side [`runner/`](../runner/README.md) or the protocol-truth layer in [`protocol/`](../protocol/README.md).

## What's Here

| App | Purpose |
| --- | --- |
| [`control-plane/`](./control-plane/README.md) | Review lifecycle, evidence-storage classification, finding classification/remediation/verification, and Attestation/static-bundle record generation. Today this is pure, dependency-free TypeScript library logic (no HTTP server, no database) — see its README for the story-by-story boundary. |
| [`web/`](./web/README.md) | Implemented Next.js App Router surface rendering authenticated login/session, dashboard, review, finding, verification, Attestation, and static-bundle `@onevps/ui` contracts through the host's read-only routes. |

## Rules for This Directory

- App code may be **private-capable**: unlike `protocol/` and `runner/`, code here does not need to be public/open-source.
- App code depends on protocol contracts through shared packages (`packages/protocol-ts`, `packages/ui`) and **must not invent independent evidence semantics** — if you need a new concept (a new state, a new artifact field), it belongs in `protocol/` first.
- Keep vendor-private implementation details (pricing, internal metrics, unapproved partner feedback) out of anything that could leak into a customer-facing projection.

## How To Work Here

Run everything from the repository root — see the [root README's command reference](../README.md#4-command-reference). Typecheck, lint, and test for this workspace specifically:

```sh
npm run typecheck --workspace @onevps/control-plane
npm run test --workspace @onevps/control-plane
npm run typecheck --workspace @onevps/web
npm run test --workspace @onevps/web
npm run web:e-check
```

Most story gates that touch the control-plane app are listed as `control-plane:story-*-check` scripts in the root [`package.json`](../package.json). The web workspace gate is `web:e-check`.
