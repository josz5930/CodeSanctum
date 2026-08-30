# CodeAttest Naming Cleanup (Proposal)

Status: Proposal — not yet executed
Audience: repository owner, contributors
Last updated: 2026-08-30

## Why this exists

The project uses several names for the same thing, which adds friction for
newcomers:

| Layer | Current name |
| --- | --- |
| Product | **CodeAttest** |
| Git repository | **CodeSanctum** |
| npm + Cargo workspace | `onevps` |
| Rust crate | `onevps-local-runner-scaffold` |
| TypeScript packages | `@onevps/control-plane`, `@onevps/intake-service`, `@onevps/host`, … |

The product-facing surface (root `README.md` and everything under `docs/`) now
leads consistently with **CodeAttest**. This document proposes how the internal
`onevps` / `*-scaffold` identifiers could be aligned later, and why they are left
unchanged for now.

## Why the internal names are unchanged for now

A rename of the workspace name, crate, or package scope is **not** cosmetic. The
`onevps` / `@onevps/*` / `onevps-local-runner-scaffold` identifiers are load-bearing
across:

- **Imports** — every cross-workspace import uses `@onevps/…` specifiers.
- **`package.json` / `Cargo.toml`** — workspace name, package names, and the
  `--workspace @onevps/…` and `-p onevps-local-runner-scaffold` invocations in
  the root script surface and in `npm run ci`.
- **Generated artifacts** — `packages/protocol-ts/src/generated/` and the fixture
  / binding manifests (`canonical-manifest.json`, `bindings-manifest.json`) whose
  `sha256` entries are compared by `fixtures:drift` and `bindings:check`.
- **CI** — `.github/workflows/ci.yml` runs `npm run ci`, which names dozens of
  per-story scripts and workspace targets.
- **External compatibility** — anyone who has cloned, forked, or scripted against
  the current package/crate names.

Renaming these carelessly would break the build, the drift gates, and any
downstream fork. It is deliberately out of scope for the documentation refactor
that produced this file.

## Proposed target names (for discussion)

| Layer | Proposed |
| --- | --- |
| npm + Cargo workspace | `codeattest` |
| Rust crate | `codeattest-local-runner` (drop `scaffold`) |
| TypeScript packages | `@codeattest/control-plane`, `@codeattest/intake-service`, … |
| Git repository | Optional: rename `CodeSanctum` → `codeattest` (GitHub auto-redirects the old URL) |

Dropping `scaffold` should wait until the runner is no longer described as a
scaffold in its own README.

## Safe migration sequence (if/when undertaken)

Do this as its own dedicated change, not bundled with feature work:

1. **Land on final names first.** Decide workspace name, package scope, crate
   name, and whether the GitHub repo is renamed. Renaming the repo on GitHub
   keeps a redirect from the old URL, but update `SECURITY.md`, README clone
   commands, and badge/advisory links regardless.
2. **Rename Cargo first, in isolation.** Update `[package] name` and `-p` targets
   and every `cargo`/`npm run rust:*` reference; run `npm run rust:build` +
   `rust:test`.
3. **Rename the npm scope in one mechanical pass.** Update each `package.json`
   `name`, every `@onevps/*` import specifier, every `--workspace @onevps/…`
   script, and the dependency-direction lint allowlists
   (`lint:deps`, `lint:workspace-boundaries`).
4. **Regenerate, do not hand-edit, generated output.** Run
   `npm run generate --workspace @codeattest/protocol-ts` and refresh the fixture
   and binding manifests so `fixtures:drift` / `bindings:check` pass with the new
   names.
5. **Search for stragglers.** Grep the whole tree (including `docs/`, `scripts/`,
   `infra/`, and workspace READMEs) for `onevps` and `scaffold` and reconcile
   each hit intentionally.
6. **Run the full gate.** `npm run ci` must pass end to end before the rename
   lands.
7. **Announce the break.** A package/scope rename is a breaking change for
   forks; note it in release notes.

Until that dedicated effort happens, the internal `onevps` names stay as they
are, and product-facing text simply leads with CodeAttest and explains the legacy
names once.
