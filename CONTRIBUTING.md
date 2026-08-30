# Contributing to CodeAttest

Thanks for your interest in CodeAttest. 

Please read the [Support policy](./README.md#support-policy) first: CodeAttest is
an open-source project, not a supported commercial product. The sections below
are about improving the project itself.

## Before you start

- Read [`AGENTS.md`](./AGENTS.md) (the authoritative project rulebook, also
  surfaced as `CLAUDE.md`) and the [Developer Guide](./docs/developer-guide.md)
  for build/test commands, workspace layout, and the architecture rules that must
  hold.
- Read the README for the specific area you want to change (`protocol/`,
  `runner/`, `apps/`, `services/`, `packages/`). Each has story-by-story
  boundaries.
- **`protocol/` is authority.** New artifact fields, states, identities, or event
  types start as a schema + fixture (+ regenerated binding) change there, then
  adapters consume them. Do not redefine protocol semantics in a service, app,
  UI, or the runner.

## Making a change

1. Fork and branch.
2. Keep changes scoped and consistent with the surrounding code's conventions.
3. Preserve the **claim-safety** boundary: customer-visible text, Attestations,
   UI contracts, and static-bundle copy must not imply SOC 2 opinions, ISO/IEC
   27001 certification, a guarantee of security, or replacement of an auditor.
   See [Assurance Boundary](./docs/codeattest-assurance-boundary.md).
4. Keep synthetic/public fixtures synthetic. `protocol/` and `runner/` are
   intended public — no real customer content.
5. Run the gates locally before opening a PR:

   ```sh
   npm run ci
   ```

   While iterating on one area, the per-story gate is faster — for example
   `npm run control-plane:story-4.4-check`. See the
   [Developer Guide](./docs/developer-guide.md#3-command-reference) for the full
   command reference and per-file/per-workspace test runs.

6. Formatting is **check-only** (LF, final newline, no trailing whitespace). Fix
   issues by hand; `npm run format` reports but does not rewrite.

## Security

Do **not** report vulnerabilities through public issues or pull requests. Use the
private process in [`SECURITY.md`](./SECURITY.md).
