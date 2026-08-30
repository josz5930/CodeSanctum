# Web App

Hosted Next.js App Router surface for CodeAttest. This workspace renders `@onevps/ui` view contracts in the browser; it does not own evidence vocabulary, protocol records, or mutation APIs.

The App Router includes a Tailwind token bridge from `codeAttestDesignTokens`, login/logout against the host auth routes, a session-expired `RiskWarning`, and Server Components that fetch the host's read-only `web` route group (forwarding C's `httpOnly` session cookie) and render the returned `@onevps/ui` contracts through adapter components: the dashboard, the review detail (`/reviews/[scope]`), the finding records and verification scope (`/reviews/[scope]/findings`), and the attestation, finalization confirmation, supporting-evidence mapping, and static-bundle surfaces (`/reviews/[scope]/attestation`). Every adapter renders text through React's default escaping; none writes, and none exposes the internal-only pilot-learning contract.

The production build runs on webpack (`next build --webpack`): the workspace's `verbatimModuleSyntax` requires explicit `.js` specifiers, which `next.config.mjs` maps back to the real `.ts(x)` sources via `resolve.extensionAlias`.

## Boundary

- Package: `@onevps/web`
- May depend on `@onevps/ui` and `@onevps/protocol-ts` only
- Does not import `@onevps/control-plane`, `@onevps/evidence-store`, or `@onevps/host`
- Does not use `dangerouslySetInnerHTML`
- Customer-visible title copy is "CodeAttest" and stays claim-safe

## Commands

Run from the repository root:

```sh
npm run typecheck --workspace @onevps/web
npm run test --workspace @onevps/web
npm run web:e-check
```
