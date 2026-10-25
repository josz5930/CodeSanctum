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

The web app's own form targets, `/session/login` and `/session/second-factor`,
are browser routes, so they reach Next.js, which forwards them to the host's
`/v0/auth/*` routes as JSON. `scripts/check-deploy-templates.mjs` fails when a
Next.js page, route handler, or form action falls under a host path matcher.

### Client address

Caddy sets no `trusted_proxies`, so it drops any `X-Forwarded-For` a client
sends and gives each upstream the real client address. The host trusts
`X-Forwarded-For` only from loopback peers (`trustProxy: "loopback"` in
`services/host/src/server.ts`), and the web app forwards the header on every
call it makes to the host. So the host's global request cap and its login
lockout count each client (an IPv6 client per /64), not one shared
`127.0.0.1`. The lockout counts per identifier and client network, so a
stranger who knows a username cannot keep that account locked. Do not add
`trusted_proxies` or rewrite `X-Forwarded-For` unless another trusted proxy
sits in front of Caddy; the template check fails on either.

### Timeouts

Caddy sets no header-read or idle timeout on its own, so the global
`servers { timeouts { … } }` block in the template bounds them: `read_header`
10s, `read_body_idle` and `write_idle` 30s, `idle` 2m. The body timeouts are
idle timeouts that reset on every successful read or write, so a slow but
steady artifact upload still completes; only a stalled connection is closed.
The template check fails when any of these is removed.

### Security headers

Both sites import the `security_headers` snippet: HSTS (one year,
subdomains), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, and
`Permissions-Policy`, deferred so they replace any upstream copy. Host routes
add a Content-Security-Policy that loads and frames nothing. Next.js pages get
a per-request nonce policy (with `frame-ancestors 'none'`) from
`apps/web/proxy.ts`; Caddy must not set a page CSP, because it would replace
that nonce and block the app's scripts. The template check enforces all of
this.

Caddy is the supported default. An nginx alternative must preserve the exact
path/upstream split, loopback-only upstreams, independent hostnames, TLS
renewal, request-size behavior, and secret-header posture. If an operator
chooses nginx, they own its certificate automation and must add an equivalent
validation check before deploying it; this repository intentionally ships no
second proxy template.

## Background worker

The host build ships a second entrypoint,
`services/host/dist/services/host/src/worker/main.js`, run by three templated
units per identity. All three use the host config, run as
`codeattest-<identity>`, and load neither the signing key nor the TOTP key: the
worker checks receipt signatures against the trust-anchor-signed key directory
and never signs anything. Each boots through the host's checks (migration head,
environment gate, object store, grant self-test) plus a key-directory check, and
stops if one fails.

| Unit | Command | What it does |
| --- | --- | --- |
| `codeattest-worker@<identity>.service` | `run` | Long-running. Every 5 seconds it returns claims older than 15 minutes to the queue and drains `normalize_scanner_findings`: it verifies the stored receipt, reads the review scope and scanner finding set through logged access, runs the pure normalizer from `services/worker`, stores the draft set as an encrypted object, and records one `finding_normalization_outcome` row. A job that fails five times is recorded as rejected. |
| `codeattest-retention@<identity>.timer` | `retention` | Hourly. Enqueues purges for retention records whose period ended (skipping ones already purged) and runs them. A failed purge stays queued and makes the run exit non-zero. |
| `codeattest-checkpoint@<identity>.timer` | `checkpoint` | Hourly. Computes the transparency checkpoint over every review head, publishes it to the off-box anchor, reads it back, and records it with the covered heads in `chain_head_anchor`. If nothing changed it re-reads the last publication instead, so a changed or lost anchor record is caught. |

The checkpoint unit fails closed until the anchor exists (Section 2 §7 of the
production-readiness guide): it needs `transparency_anchor` in the host config,
`{"base_url": "https://…", "token_credential": "<identity>-anchor-token"}`, and
the token at `/etc/codeattest/<identity>/anchor-token`. Until then the unit
shows as failed every hour, which is the intended signal, not noise.

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
self-test. It then builds in the checkout and runs
[`scripts/check-host-config.mjs`](../../scripts/check-host-config.mjs) against
the host config: the credential names must match the ones the units load, the
key files must exist with no group/other access, and `listen_addr` must be the
port the readiness gate probes. A bad config stops the deploy here, before
anything changes; after the switch, the automatic rollback would restore the
old release with the same bad config. It then applies migrations as
`codeattest_migrator`, using the root-only URL in
`/etc/codeattest/<identity>/migrator-database-url` (the host config's
`codeattest_app` role cannot run DDL), copies the application and verified
runner release to native disk, atomically
switches `current`, installs the unit and Caddy templates, reloads supervision,
and requires loopback `/readyz` before declaring success. The prior release is
retained through the `previous` symlink. A failed readiness gate restores it
automatically.

An explicit rollback verifies the retained runner release before it swaps
`current` and `previous`, restarts host, web, and worker, and requires readiness:

```sh
sudo infra/deploy/rollback.sh demo
```

Migrations are append-only and are not rolled back. A release that changes the
database must remain compatible with the retained prior release. Failed release
directories are preserved for diagnosis; clean them up only after resolving
their exact native-disk paths.

## Backup and restore

[`backup.sh`](./backup.sh) writes a checksummed database dump and object-store
archive for one deployment; [`restore.sh`](./restore.sh) restores one into an
empty database and object store. Pilot backups must land on an encrypted
device, and no backup holds keys. See [`BACKUP.md`](./BACKUP.md).

## Verification

Partner-pilot readiness observations use
[`READINESS-EVIDENCE.md`](./READINESS-EVIDENCE.md) and the synthetic canaries in
[`readiness-canaries/`](./readiness-canaries/). The collector redacts secrets
before hashing and refuses required-tool skips.

`npm run delivery:f-check` covers host budget and observability tests, the
guardrail wiring check, the SLO checker self-test, the host config preflight,
systemd/Caddy templates, and the deploy, rollback, backup, and restore scripts. `systemd-analyze`, Caddy, and ShellCheck run when
installed; their checks report `PENDING` rather than pretending an absent tool
passed.

The repository gate proves the artifacts. Live acceptance additionally needs
the provisioned services to answer both `/healthz` and `/readyz` on this VPS.
The current `partner_pilot_candidate` gate still declares encryption readiness
false, so the prepared encrypted pilot deployment must not be started with a
contradictory config. G owns that append-only readiness decision; F neither
rewrites the gate nor accepts real customer source-derived evidence.
