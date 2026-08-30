# Always-on Delivery

Sub-project F's deploy surface targets one Ubuntu VPS with two isolated
deployments. It does not create a hosted environment by itself: follow
[`PROVISIONING.md`](./PROVISIONING.md) for the human-owned users, Postgres
clusters, storage, keys, DNS, and TLS prerequisites.

## Process and port map

| Deployment | Unix user | Host API | Next.js web | Native release root |
| --- | --- | --- | --- | --- |
| Demo | `codeattest-demo` | `127.0.0.1:8080` | `127.0.0.1:3000` | `/opt/codeattest/demo` |
| Pilot | `codeattest-pilot` | `127.0.0.1:8081` | `127.0.0.1:3001` | `/opt/codeattest/pilot` |

The host and web process for each deployment have separate systemd units.
Each web process receives exactly one loopback `CODEATTEST_HOST_BASE_URL`; it
cannot straddle deployments. Host units use mode-0600 config paths and
systemd credentials, restart on failure, and allow 15 seconds for the host's
10-second SIGTERM drain.

The observability timer runs every minute per deployment. Its short-lived,
capability-dropped root process can read the system journal without granting a
deployment user access to the other deployment's logs. It executes a separately
installed root-owned checker, probes loopback `/readyz`, reads only the selected
host unit's recent JSON metric records from journald, evaluates
[`services/host/SLO.md`](../../services/host/SLO.md), and exits non-zero on a
breach. An executable path supplied through `CODEATTEST_NOTIFY_HOOK` receives
the JSON evaluation as its only argument; that hook must be root-owned and not
writable by a deployment user. When no hook is configured, the breach remains
visible in journald.

## Caddy routing and TLS

[`Caddyfile.tmpl`](./Caddyfile.tmpl) contains exactly two hostname site blocks.
Within each block, `/healthz`, `/readyz`, `/v0/*`, and the host's authenticated
`/web/*` projection routes go to that deployment's host port. All browser
routes go to that deployment's integrated Next.js process. Caddy terminates
and automatically renews TLS after the operator provides the two hostname
environment variables and working DNS.

Caddy is the supported default. An nginx alternative must preserve the exact
path/upstream split, loopback-only upstreams, independent hostnames, TLS
renewal, request-size behavior, and secret-header posture. If an operator
chooses nginx, they own its certificate automation and must add an equivalent
validation check before deploying it; this repository intentionally ships no
second proxy template.

## Deploy and rollback

From the repository root:

```sh
npm run delivery:f-check
sudo infra/deploy/deploy.sh demo "$(pwd -P)" /secure-transfer/codeattest-runner-release
sudo infra/deploy/deploy.sh pilot "$(pwd -P)" /secure-transfer/codeattest-runner-release
```

The signed runner-release directory is required for both deployments.

Before building or changing `current`, `deploy.sh` requires a clean tracked
checkout, binds its Git commit to the signed runner release, independently
checks the release record, binary digest, and ML-DSA-65 signature against the
root-owned release trust anchor, and runs the runner's compiled-in trust
self-test. It then builds in the checkout, applies/checks the migration head,
copies the application and verified runner release to native disk, atomically
switches `current`, installs the unit and Caddy templates, reloads supervision,
and requires loopback `/readyz` before declaring success. The prior release is
retained through the `previous` symlink. A failed readiness gate restores it
automatically.

An explicit rollback verifies the retained runner release before it swaps
`current` and `previous`, restarts host and web, and requires readiness:

```sh
sudo infra/deploy/rollback.sh demo
```

Migrations are append-only and are not rolled back. A release that changes the
database must remain compatible with the retained prior release. Failed release
directories are preserved for diagnosis; clean them up only after resolving
their exact native-disk paths.

## Verification

Partner-pilot readiness observations use
[`READINESS-EVIDENCE.md`](./READINESS-EVIDENCE.md) and the synthetic canaries in
[`readiness-canaries/`](./readiness-canaries/). The collector redacts secrets
before hashing and refuses required-tool skips.

`npm run delivery:f-check` covers host budget and observability tests, the
guardrail wiring check, the SLO checker self-test, systemd/Caddy templates, and
deploy/rollback scripts. `systemd-analyze`, Caddy, and ShellCheck run when
installed; their checks report `PENDING` rather than pretending an absent tool
passed.

The repository gate proves the artifacts. Live acceptance additionally needs
the provisioned services to answer both `/healthz` and `/readyz` on this VPS.
The current `partner_pilot_candidate` gate still declares encryption readiness
false, so the prepared encrypted pilot deployment must not be started with a
contradictory config. G owns that append-only readiness decision; F neither
rewrites the gate nor accepts real customer source-derived evidence.
