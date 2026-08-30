# Services

Home for private-capable backend services — the vendor-side processing boundaries that sit between the customer-side [`runner/`](../runner/README.md) and the review logic in [`apps/control-plane/`](../apps/control-plane/README.md).

## What's Here

| Service | Purpose |
| --- | --- |
| [`intake/`](./intake/README.md) | Verifies a submitted Evidence Bundle against protocol expectations and issues a signed Vendor Receipt when verification succeeds. Also turns intake results into `submission-outcome` records. |
| [`worker/`](./worker/README.md) | Normalizes raw scanner Candidate Findings into reviewer-ready `ReviewFindingDraftSet` records, without executing scanners or making classification decisions itself. |

## Rules for This Directory

- Services depend on protocol contracts and append-oriented review/event semantics — they **must not redefine** protocol identities, receipt states, retention classes, or evidence meaning. Any new concept belongs in `protocol/` first.
- Today both services are **dependency-free TypeScript library functions**, not running servers: no HTTP routes, no database, no queue, no network calls. Later HTTP/router adapters are expected to call into these functions rather than reimplement their logic.
- Keep service logic pure and testable — see each service's README for exactly what is and is not in scope for its current story.

## How To Work Here

Run everything from the repository root — see the [root README's command reference](../README.md#4-command-reference). Per-service test runs:

```sh
npm run test --workspace @onevps/intake-service
npm run test --workspace @onevps/worker-service
```

Story-scoped gates are listed as `intake:story-*-check` and `worker:story-*-check` in the root [`package.json`](../package.json).
