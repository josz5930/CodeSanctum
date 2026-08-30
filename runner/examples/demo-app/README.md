# Synthetic demo application

`SYNTHETIC_DEMO_DATA` — `NOT_CUSTOMER_SOURCE`

This is a tiny, deliberately synthetic application used only to give the Local
Runner something real to point `--application-path` at during the bundled demo.
It is **not** a customer application, contains **no** customer source, and its
"vulnerability" (`eval(...)` in `src/app.ts`) exists so a local scanner produces
a Candidate Finding to carry through the workflow. Do not treat it as an example
of production code.

## What is here

| File | Purpose |
| --- | --- |
| `src/app.ts` | Synthetic handler with an `eval(` call the demo regex rule matches |
| `src/routes.ts` | A second clean file so the scan covers more than one source file |
| `package.json` | Dependency-manifest context for scope capture (synthetic deps) |
| `scanner-config.json` | The regex scanner input the demo runs (`eval\(`) |
| `disclosure-policy-config.json` | `metadata_only` disclosure with scanner findings included |

## How it is used

The one-command demo drives the full customer-side Local Runner workflow against
this directory:

```sh
npm run demo
```

That builds the runner and runs scope capture → local scan → disclosure policy →
outbound manifest preview → explicit approval + signed local Evidence Bundle,
writing all runtime output under a gitignored `.codeattest/demo/` directory.
Nothing is transmitted. The run is deterministic and re-runnable: it pins a fixed
synthetic commit (`0123…4567`), review id (`review:synthetic-demo`), and approver
(`demo-approver@example.com`), and clears its output directory at the start of
each run. If Rust/Cargo is not installed it prints `PENDING` and exits cleanly.

See the [repository `README.md`](../../../README.md) §"Try it" for the one-command
and step-by-step versions, [`runner/README.md`](../../README.md) for every flag
and coverage mode, and [`scripts/demo.mjs`](../../../scripts/demo.mjs) for the
exact command sequence.

## What the demo produces

The `eval(` in `src/app.ts` matches the `demo.regex.eval` rule, so the scan emits
a single Candidate Finding (`severity: warning`, `confidence: medium`) that then
carries through the manifest into the signed local Evidence Bundle (see
"Why `metadata_only`" below for what is and is not disclosed). The clean
`src/routes.ts` produces no findings; it is there only so the scan covers more
than one source file.

## Why `metadata_only`

`disclosure-policy-config.json` selects `metadata_only` coverage, which excludes
Raw Snippets and targeted files, so the demo builds a signed bundle without any
source-derived disclosure and stays inside the default `synthetic_demo`
environment evidence gate. `include_scanner_findings` is set to `true` so the
Candidate Finding metadata (not the source snippet) still flows through the
manifest and into the bundle.
