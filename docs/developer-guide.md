# CodeAttest Developer Guide

Status: Contributor / internal implementation reference
Audience: engineers building on or contributing to CodeAttest
Last updated: 2026-08-30

This guide holds the day-to-day build, test, and workspace detail that used to
live in the root `README.md`. If you are here to *use* CodeAttest, start with the
root [README](../README.md). If you are here to *change* it, read this plus the
authoritative rulebook in [`AGENTS.md`](../AGENTS.md) (also surfaced as
`CLAUDE.md`) and the per-area README for the code you are touching.

The product name is **CodeAttest**. The Git repository is **CodeSanctum**. The
npm and Cargo workspace name is `onevps` (crate `onevps-local-runner-scaffold`,
packages such as `@onevps/control-plane`). See
[Naming Cleanup](./codeattest-naming-cleanup.md) for why these differ and how a
future rename could be sequenced safely.

## 1. Prerequisites

- Node.js `24.18.0` LTS — pinned in [`.node-version`](../.node-version) /
  [`.nvmrc`](../.nvmrc). Use `nvm use` or an equivalent version manager.
  TypeScript `6.0.3` installs with the workspace.
- Rust `1.96.1` with `rustfmt` and `clippy` — pinned in
  [`rust-toolchain.toml`](../rust-toolchain.toml). `rustup` picks this up
  automatically.
- `git`.

Use **npm workspaces** (`package-lock.json`). Do not switch to pnpm or yarn.

## 2. Install and verify

```sh
git clone https://github.com/josz5930/CodeSanctum
cd CodeSanctum
npm install          # or: npm run setup
npm run ci           # same aggregate gate CI runs
```

`npm install` covers all eleven TypeScript packages: `apps/control-plane`,
`apps/web`, `services/intake`, `services/worker`, `services/host`,
`packages/ui`, `packages/protocol-ts`, `packages/signing`,
`packages/static-bundle`, `packages/evidence-store`, and
`packages/identity-store`. Rust dependencies resolve the first time you run a
`cargo` command.

**The root npm workspace is the canonical command surface.** Run everything from
the repository root; do not guess at package-local scripts.

If Cargo is missing locally, the `rust:*` scripts (and the one TypeScript test
that regenerates signature fixtures through the Rust signer) print an explicit
`PENDING` message and exit 0 instead of failing. That is a skip, not a pass — do
not treat it as "Rust is fine."

## 3. Command reference

| Intent | Command |
| --- | --- |
| Install / setup | `npm install` or `npm run setup` |
| Format check | `npm run format` (TypeScript/text + Rust; **check-only**, no auto-write) |
| Lint | `npm run lint` (workspace boundaries, TypeScript, dependency direction, public-content safety, runner-artifact leak check, Clippy) |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` (`build:ts` + `rust:build`) |
| Test | `npm test` (TypeScript workspaces + Rust) |
| Protocol gate | `npm run protocol:check` |
| Fixture drift gate | `npm run fixtures:drift` |
| Fixture coverage gate | `npm run fixtures:coverage` |
| Generated binding drift gate | `npm run bindings:check` |
| RFC 8785 / JCS canonicalization check | `npm run jcs:check` |
| Regenerate protocol TypeScript bindings | `npm run generate --workspace @onevps/protocol-ts` |
| Rust format / lint / build / test | `npm run rust:fmt` / `rust:lint` / `rust:build` / `rust:test` |
| CI aggregate (all of the above + every per-story gate) | `npm run ci` |

`npm run format` and `npm run format:check` do **not** rewrite files. Fix LF /
final-newline / trailing-whitespace issues by hand. The format rules (LF only,
final newline, no trailing whitespace) apply to `.ts`, `.mjs`, `.rs`, `.json`,
`.md`, `.yml`, `.yaml`, `.toml`, `.py`, `.txt`, and `.jsonl`.

### Targeted runs

- One TypeScript file: `node apps/control-plane/test/review-event-log.test.mjs`
- One TypeScript workspace: `npm run test --workspace @onevps/control-plane`
  (also `@onevps/web`, `@onevps/intake-service`, `@onevps/worker-service`,
  `@onevps/host`, `@onevps/protocol-ts`, `@onevps/ui`, `@onevps/signing`,
  `@onevps/static-bundle`, `@onevps/evidence-store`, `@onevps/identity-store`)
- One Rust integration test: `cargo test -p onevps-local-runner-scaffold --test cli_scope_init`
- One Rust test by name: `cargo test -p onevps-local-runner-scaffold scope_init`

### Per-story gates

Individual per-story gates (for example `npm run control-plane:story-4.4-check`)
are listed in [`package.json`](../package.json). Each scopes protocol + fixture +
workspace tests to the area a story touched. Prefer the relevant per-story gate
while iterating on one area instead of rerunning the full suite.

The fixture drift gate uses `git diff --exit-code` in a git workspace, or falls
back to direct `sha256` comparison against
`protocol/fixtures/canonical-manifest.json` and
`packages/protocol-ts/src/generated/bindings-manifest.json` when there is no git
workspace. After schema or fixture edits, read
[`protocol/fixtures/README.md`](../protocol/fixtures/README.md) before finishing.

## 4. Repository map

```
protocol/          Product-truth center: schemas, fixtures, policies, canonicalization, identity rules
  schemas/         JSON Schema 2020-12 contracts (closed, snake_case)
  fixtures/        Canonical examples shared by Rust and TypeScript
  policies/        Claim-safety enforcement policy
  docs/            Identity, canonicalization, and invariant notes
runner/            Rust Local Runner (customer-side CLI)
services/
  intake/          TypeScript bundle verification + Vendor Receipt issuance
  worker/          TypeScript scanner-finding normalization
  host/            Fastify composition root: boot ladder, submission transport, auth, read-only web routes (loopback only)
apps/
  control-plane/   TypeScript review lifecycle, classification, verification, Attestation logic
  web/             Next.js App Router surface rendering the UI contracts against the host
packages/
  protocol-ts/     Generated/validated TypeScript protocol bindings
  ui/              Serializable, framework-agnostic UI view contracts
  static-bundle/   Signed static bundle + offline portal projection
  evidence-store/  Persistence ports + memory/Postgres/filesystem adapters
  identity-store/  Accounts, sessions, TOTP, and runner submission credentials
  signing/         ML-DSA-65 signing + verification helpers
infra/             Local-dev / demo-cloud docs and future migrations (not a live stack)
docs/              Public-facing architecture, support, and assurance-boundary documentation
scripts/           Node scripts backing every gate in the command table above
```

Tests live next to the code they cover: `*/test/*.test.mjs` in each TypeScript
workspace, and `runner/crates/local-runner-scaffold/tests/*.rs` for Rust. There
is no top-level `tests/` or `src/` for the monorepo. Each live directory has its
own README with story-by-story detail — start there before changing that area.

`_Bmad-driven-draft/`, `_Grok-draft/`, `_bmad/`, and `_bmad-output/` are
historical planning/draft trees (some use pnpm). Do not implement against them
when they disagree with the root `README.md`, `protocol/`, and workspace READMEs.

## 5. Architecture rules that must hold

- **Protocol is authority.** Artifact meaning lives in `protocol/schemas/`,
  `protocol/fixtures/`, `protocol/policies/`, and `protocol/docs/`. Services,
  apps, UI, runner, and `packages/protocol-ts` validate, project, or transport
  those contracts. They do not invent fields, states, identities, or claim
  language. New concepts start in `protocol/` first.
- **Dependency direction is inward toward protocol.** `protocol/` must never
  depend on the runner, apps, services, or packages. `packages/protocol-ts` has
  no `@onevps/*` dependencies. Other workspaces may depend on `@onevps/protocol-ts`
  only (import the barrel `packages/protocol-ts/src/index.js`), except
  `@onevps/host`, which additionally depends on `@onevps/evidence-store`.
  Enforced by `npm run lint:deps` and `npm run lint:workspace-boundaries`.
- **Append-only history.** Audit-significant state is events and typed records.
  Corrections use `supersedes_event_id` or a higher-version record. Never
  rewrite, reorder, or delete prior events. A repeated `idempotency_key` with the
  same body is a no-op; a different body under that key is a rewrite and must be
  rejected.
- **Scanner output is not expert judgment.** Worker normalization preserves
  provenance, severity, confidence, and evidence availability. Classification,
  remediation, validation, false-positive, and accepted-risk records are authored
  by the control-plane with explicit actor authority.
- **Claim-safe outputs.** Customer-visible text, Attestations, UI contracts, and
  static-bundle copy must pass the claim-safety policy
  (`protocol/policies/claim-safety.v0.json`). Do not imply SOC 2 opinions,
  ISO/IEC 27001 certification, a guarantee of security, or replacement of an
  auditor.
- **Public/open vs. private-capable.** `protocol/` and `runner/` are intended
  public/open-source: fixtures there must be synthetic or public non-customer
  content and carry `SYNTHETIC_DEMO_DATA` / `NOT_CUSTOMER_SOURCE` markers where
  free text is allowed. `apps/`, `services/`, `packages/`, and `infra/` may hold
  private-capable vendor logic.
- **Evidence boundary.** Default environment profile is `synthetic_demo`. Do not
  accept, store, transform, or transmit real customer Raw Snippets or
  source-derived evidence until `environment-evidence-gate` is raised to
  `partner_pilot_real_snippet_ready` with the documented access, logging,
  encryption, retention, and deletion controls in place.
- **Pure library boundaries today.** Intake, worker, and control-plane `src/`
  stay free of Node core imports, `fetch(`, and database/queue/cloud clients.
  Later HTTP adapters call these functions; they do not reimplement them. Tests
  statically scan for this.

## 6. Code conventions

- TypeScript: ESM (`"type": "module"`), `strict` +
  `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` +
  `verbatimModuleSyntax`, target `ES2024`, module `NodeNext`. Workspace
  `tsconfig.json` extends `../../tsconfig.base.json` and sets `composite: true`.
- Protocol-owned JSON fields are `snake_case`. Schemas are closed
  (`additionalProperties: false`).
- Do not pin any dependency to `"latest"`. Workspace packages stay
  `"private": true`.
- Every TypeScript workspace exposes `workspaceName = "<package.json name>"` from
  `src/index.ts` and keeps `format` / `lint` / `typecheck` / `build` / `test`
  scripts.
- `packages/protocol-ts/src/generated/` is generator-owned. Never hand-edit it.
  After schema/policy changes run
  `npm run generate --workspace @onevps/protocol-ts` and update the fixture and
  binding manifests so `fixtures:drift` / `bindings:check` pass.
- Rust: the only workspace member is `runner/crates/local-runner-scaffold`.
  Clippy must be warning-free (`-D warnings`). Use the root `npm run rust:*`
  wrappers in CI-shaped work.
- Do not add Playwright, axe, static-export, or print-check dependencies until a
  story introduces a real UI or static portal target.

## 7. Testing conventions

- TypeScript tests are plain Node ESM scripts (`*.test.mjs`) invoked with `node`,
  not Jest/Vitest/Mocha. Follow the existing `assert(...)` / throw-on-failure
  style in the workspace you are editing.
- Each TypeScript workspace has a `test/scaffold.test.mjs` that must keep passing.
- Rust tests are crate unit tests plus integration tests under
  `runner/crates/local-runner-scaffold/tests/`.
- Prefer the per-story `*:story-*-check` script that already scopes protocol +
  fixture + workspace tests for the area you touched.

## 8. Where to read next

| Document | When |
| --- | --- |
| [`AGENTS.md`](../AGENTS.md) | Authoritative project rulebook (also `CLAUDE.md`) |
| [Technical Architecture](./codeattest-technical-architecture.md) | Component responsibilities |
| [Assurance Boundary](./codeattest-assurance-boundary.md) | Claim-safe language |
| [`protocol/README.md`](../protocol/README.md) + [protocol invariants](../protocol/docs/protocol-invariants.md) | Schema/fixture/invariant rules |
| Per-area README (`runner/`, `apps/`, `services/`, `packages/`) | Story-by-story boundary for the code you are changing |
| [Implementation Status](./implementation-status.md) | Current per-task implemented/deferred detail |
