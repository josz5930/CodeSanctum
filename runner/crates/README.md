# Runner Crates

Home for the Rust Local Runner crate(s) and scanner adapters.

## What's Here

| Crate | Purpose |
| --- | --- |
| `local-runner-scaffold` (`onevps-local-runner-scaffold`) | The Local Runner CLI itself: `scope`, `scan`, `disclosure`, `manifest`, `bundle`, and `runner` subcommands. See [`runner/README.md`](../README.md) for the full command reference and example workflow. |

Scanner adapters (regex rules, Semgrep JSON ingestion, Semgrep local invocation) live inside this crate as input handlers rather than as separate crates — see [`runner/README.md`](../README.md#story-15-local-scanner-inputs) for how they're configured and what evidence they produce.

## Rules for This Directory

- This area is intended **public/open-source**. Use only synthetic or public non-customer fixtures, and avoid vendor-private service details.
- The runner depends on `protocol/` contracts and must not redefine evidence semantics — new artifact shapes or fields belong in [`protocol/schemas/`](../../protocol/schemas/README.md) first.

## How To Work Here

```sh
npm run rust:fmt     # cargo fmt --check
npm run rust:lint     # cargo clippy
npm run rust:build    # cargo build
npm run rust:test     # cargo test
```

Or invoke Cargo directly from the repository root, e.g. `cargo run -p onevps-local-runner-scaffold -- scope init --help`. The pinned toolchain is in [`rust-toolchain.toml`](../../rust-toolchain.toml).
