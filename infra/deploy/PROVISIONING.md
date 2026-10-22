# Single-VPS Provisioning Wizard

This runbook provisions the human-owned prerequisites for the CodeAttest demo
and pilot processes on one Ubuntu VPS. Run each checkpoint deliberately; do not
paste secrets into a shared terminal transcript. Commands are idempotent where
Ubuntu's native tools permit it and stop before replacing an existing file,
filesystem, database, or key.

The pilot remains metadata-only until the separate G readiness decision. This
runbook does not raise an environment gate or authorize real customer
source-derived evidence.

## 1. Preflight

Confirm the repository is the build source but not the runtime destination:

```sh
pwd
test -f package.json
test "$(pwd -P)" != /opt/codeattest
case "$(pwd -P)" in /opt/codeattest/*|/var/lib/codeattest/*) exit 1;; esac
node --version
npm --version
systemctl is-system-running
command -v rsync curl systemd-analyze caddy psql pg_createcluster cryptsetup
```

Expected Node is `v24.18.0`. Stop if `/opt/codeattest`, `/var/lib/codeattest`,
or `/etc/codeattest` is a symlink into `/mnt/hgfs`; runtime data and releases
must live on native disk.

Before continuing, choose and record privately:

- the demo and pilot DNS names;
- a PostgreSQL major version installed by Ubuntu (shown by `pg_lsclusters`);
- distinct migrator and application passwords for each cluster;
- the unused block device dedicated to the pilot LUKS volume;
- a notification hook path, if alerts should leave journald.

## 2. Isolated Unix identities and directories

These commands are safe to repeat. They create non-login service users and
private roots without changing an existing user's identity.

```sh
id codeattest-demo >/dev/null 2>&1 || sudo useradd --system --home /var/lib/codeattest/demo --shell /usr/sbin/nologin codeattest-demo
id codeattest-pilot >/dev/null 2>&1 || sudo useradd --system --home /var/lib/codeattest/pilot --shell /usr/sbin/nologin codeattest-pilot
sudo install -d -m 0755 /opt/codeattest/demo /opt/codeattest/pilot
sudo install -d -o codeattest-demo -g codeattest-demo -m 0700 /var/lib/codeattest/demo /var/lib/codeattest/demo/objects
sudo install -d -o codeattest-pilot -g codeattest-pilot -m 0700 /var/lib/codeattest/pilot
sudo install -d -m 0750 /etc/codeattest/demo /etc/codeattest/pilot
```

Checkpoint: `findmnt -T /opt/codeattest` and `findmnt -T /var/lib/codeattest`
must report native filesystems, never `hgfs`.

## 3. Separate PostgreSQL clusters

Replace `<PG_MAJOR>` and the four password placeholders. Ports `5433` and
`5434` are intentionally distinct. `pg_createcluster` refuses to overwrite an
existing cluster; the guard makes repeat runs a no-op.

```sh
pg_lsclusters | awk '$1 == "<PG_MAJOR>" && $2 == "demo" { found=1 } END { exit !found }' || sudo pg_createcluster <PG_MAJOR> demo --port 5433 --start
pg_lsclusters | awk '$1 == "<PG_MAJOR>" && $2 == "pilot" { found=1 } END { exit !found }' || sudo pg_createcluster <PG_MAJOR> pilot --port 5434 --start
sudo -u postgres psql -p 5433 -tc "SELECT 1 FROM pg_roles WHERE rolname='codeattest_migrator'" | grep -q 1 || sudo -u postgres psql -p 5433 -c "CREATE ROLE codeattest_migrator LOGIN PASSWORD '<DEMO_MIGRATOR_PASSWORD>'"
sudo -u postgres psql -p 5434 -tc "SELECT 1 FROM pg_roles WHERE rolname='codeattest_migrator'" | grep -q 1 || sudo -u postgres psql -p 5434 -c "CREATE ROLE codeattest_migrator LOGIN PASSWORD '<PILOT_MIGRATOR_PASSWORD>'"
sudo -u postgres psql -p 5433 -tc "SELECT 1 FROM pg_database WHERE datname='codeattest'" | grep -q 1 || sudo -u postgres createdb -p 5433 -O codeattest_migrator codeattest
sudo -u postgres psql -p 5434 -tc "SELECT 1 FROM pg_database WHERE datname='codeattest'" | grep -q 1 || sudo -u postgres createdb -p 5434 -O codeattest_migrator codeattest
```

Create `codeattest_app` with its real password before the first migration.
`0002_roles_and_grants.sql` creates that role only when it is missing, and
`codeattest_migrator` has no `CREATEROLE`, so the migration cannot create it:

```sh
sudo -u postgres psql -p 5433 -tc "SELECT 1 FROM pg_roles WHERE rolname='codeattest_app'" | grep -q 1 || sudo -u postgres psql -p 5433 -c "CREATE ROLE codeattest_app LOGIN PASSWORD '<DEMO_APP_PASSWORD>'"
sudo -u postgres psql -p 5434 -tc "SELECT 1 FROM pg_roles WHERE rolname='codeattest_app'" | grep -q 1 || sudo -u postgres psql -p 5434 -c "CREATE ROLE codeattest_app LOGIN PASSWORD '<PILOT_APP_PASSWORD>'"
```

Store each migrator URL in a root-only file. `deploy.sh` applies new
migrations with this file on every release: the host config's URL is the
`codeattest_app` role, which cannot run DDL. Write the files with an editor
(not `echo`, which puts the password in shell history):

```sh
sudo install -m 0400 -o root -g root /dev/null /etc/codeattest/demo/migrator-database-url
sudo install -m 0400 -o root -g root /dev/null /etc/codeattest/pilot/migrator-database-url
sudoedit /etc/codeattest/demo/migrator-database-url    # postgres://codeattest_migrator:<DEMO_MIGRATOR_PASSWORD>@127.0.0.1:5433/codeattest
sudoedit /etc/codeattest/pilot/migrator-database-url   # postgres://codeattest_migrator:<PILOT_MIGRATOR_PASSWORD>@127.0.0.1:5434/codeattest
```

Run the migrations once for each cluster:

```sh
sudo node scripts/run-migrations.mjs --database-url-file /etc/codeattest/demo/migrator-database-url
sudo node scripts/run-migrations.mjs --database-url-file /etc/codeattest/pilot/migrator-database-url
```

Seed only the existing, non-real-evidence profiles. Repeating version 1 is a
recorded no-op; never edit or replace a prior gate row:

```sh
sudo sh -c 'CODEATTEST_DATABASE_URL="$(cat /etc/codeattest/demo/migrator-database-url)" node scripts/seed-environment-gate.mjs --gate-file protocol/fixtures/v0/valid/environment-evidence-gate.synthetic-demo.json --version 1'
sudo sh -c 'CODEATTEST_DATABASE_URL="$(cat /etc/codeattest/pilot/migrator-database-url)" node scripts/seed-environment-gate.mjs --gate-file protocol/fixtures/v0/valid/environment-evidence-gate.partner-pilot-candidate.json --version 1'
```

## 4. Pilot encrypted volume

Destructive storage operations are intentionally not expressed as paste-ready
commands. In a root shell, identify the dedicated device by stable `/dev/disk/by-id`
name, confirm it has no wanted data, then use `cryptsetup luksFormat`, `cryptsetup
open`, and `mkfs.ext4` once. Add the mapping to `/etc/crypttab` and mount it at
`/var/lib/codeattest/pilot/objects` through `/etc/fstab` with `nodev,nosuid,noexec`.

After mounting, make the root private and verify the backing device:

```sh
sudo install -d -o codeattest-pilot -g codeattest-pilot -m 0700 /var/lib/codeattest/pilot/objects
findmnt --target /var/lib/codeattest/pilot/objects --output SOURCE,FSTYPE,OPTIONS
sudo cryptsetup status codeattest-pilot
```

Do not set `object_store_encrypted: true` while the current
`partner_pilot_candidate` gate still has `encryption_at_rest_ready: false`:
the existing fail-closed boot contract requires those values to agree. G owns
the append-only readiness decision. Until G records it, the pilot unit is
provisioned but intentionally not started; F does not weaken or rewrite the
gate to force a green boot.

## 5. Config and credentials

Generate independent 32-byte TOTP wrapping keys and object-store envelope
keys. Existing keys are never overwritten:

```sh
for identity in demo pilot; do
  for key in totp-key envelope-key; do
    sudo test -e "/etc/codeattest/$identity/$key" || openssl rand 32 | sudo tee "/etc/codeattest/$identity/$key" >/dev/null
    sudo chmod 0400 "/etc/codeattest/$identity/$key"
  done
done
```

The envelope key encrypts source-derived object bytes (AES-256-GCM) before
they reach disk. The host, worker, and retention units all load it, and a unit
whose credential file is missing does not start. Losing it makes every stored
object unreadable, so back it up through the same offline path as the signing
credential, never next to a data backup (see [`BACKUP.md`](./BACKUP.md)).

Follow [`../custody/README.md`](../custody/README.md) separately for demo and
pilot signing keys. Store the encrypted credentials at
`/etc/codeattest/<identity>/signing-key.cred`, publish each signed key directory
under `/var/lib/codeattest/<identity>/`, and never copy the offline trust-anchor
private key to this VPS.

Provision the separate runner-release public anchor at
`/etc/codeattest/release-trust-anchor.pub`. It must be root-owned, may be mode
`0644`, and must not be writable by group or other. The corresponding private
key stays off the VPS. Confirm that demo and pilot key directories name
different active managed keys and that both directory signatures verify before
continuing.

Create `/etc/codeattest/demo-host.json` and
`/etc/codeattest/pilot-host.json` using the exact closed shape in
[`../../services/host/src/config.ts`](../../services/host/src/config.ts).
[`host-config.example.json`](./host-config.example.json) is a filled-in demo
example. The credential names must match the names the systemd units load, or
the host cannot find its keys:

| Config key | Demo value | Pilot value |
| --- | --- | --- |
| `listen_addr` | `127.0.0.1:8080` | `127.0.0.1:8081` |
| `database_url` | `postgres://codeattest_app:<DEMO_APP_PASSWORD>@127.0.0.1:5433/codeattest` | `postgres://codeattest_app:<PILOT_APP_PASSWORD>@127.0.0.1:5434/codeattest` |
| `object_store_root` | `/var/lib/codeattest/demo/objects` | `/var/lib/codeattest/pilot/objects` |
| `encryption_key_ref` | `demo-totp-key` | `pilot-totp-key` |
| `object_store_envelope_key_ref` | `demo-envelope-key` | `pilot-envelope-key` |
| `signing.credential_name` | `demo-signing-key` | `pilot-signing-key` |
| `session_cookie_secure` | `true` | `true` |
| `transparency_anchor.token_credential` (when set) | `demo-anchor-token` | `pilot-anchor-token` |

Use independent signing key IDs per deployment. Demo also sets its engineered
`demo_budget_meter` values; pilot uses the no-op meter automatically.
`deploy.sh` runs `scripts/check-host-config.mjs` before it changes anything, and
that check refuses a config that breaks this table, a credential file that is
missing or readable by group or other, and a config that is not mode `0600`.
You can run it yourself after editing a config:

```sh
npm run build:run --workspace @onevps/host
sudo node scripts/check-host-config.mjs --identity demo --config /etc/codeattest/demo-host.json
```

When the off-box transparency anchor exists (production-readiness guide,
Section 2 §7), add `"transparency_anchor": {"base_url": "https://…",
"token_credential": "<identity>-anchor-token"}` to each config and store the
bearer token at `/etc/codeattest/<identity>/anchor-token` (root-owned, mode
`0400`). The `codeattest-checkpoint@<identity>` unit loads it; until it exists
that unit fails every hour by design.

```sh
sudo chown codeattest-demo:codeattest-demo /etc/codeattest/demo-host.json
sudo chown codeattest-pilot:codeattest-pilot /etc/codeattest/pilot-host.json
sudo chmod 0600 /etc/codeattest/demo-host.json /etc/codeattest/pilot-host.json
```

Create the timer's non-secret environment files. If a notification hook is
configured, it is executed by the root-owned, capability-dropped checker and
must itself be root-owned and not writable by either deployment user.

```sh
printf '%s\n' 'CODEATTEST_HOST_PORT=8080' | sudo tee /etc/codeattest/demo-observability.env >/dev/null
printf '%s\n' 'CODEATTEST_HOST_PORT=8081' | sudo tee /etc/codeattest/pilot-observability.env >/dev/null
sudo chown root:root /etc/codeattest/demo-observability.env /etc/codeattest/pilot-observability.env
sudo chmod 0600 /etc/codeattest/demo-observability.env /etc/codeattest/pilot-observability.env
```

## 6. DNS, Caddy, and units

Create public DNS A/AAAA records for both hostnames pointing at this VPS.
Permit inbound TCP 80/443 only; host and web ports remain loopback-only. Put
the hostnames in Caddy's systemd environment (commonly
`/etc/systemd/system/caddy.service.d/codeattest.conf`):

```ini
[Service]
Environment=CODEATTEST_DEMO_HOSTNAME=demo.example.invalid
Environment=CODEATTEST_PILOT_HOSTNAME=pilot.example.invalid
```

Replace the example names, run `sudo systemctl daemon-reload`, and validate
with `sudo caddy validate --config /etc/caddy/Caddyfile`. Caddy obtains and
renews TLS certificates automatically after DNS and ports are correct.

## 7. First deploy and smoke test

On the controlled release builder, from the exact clean commit to deploy,
produce the signed runner release. The output directory must be outside the
checkout:

```sh
npm run release-trust:g6-check
node scripts/build-signed-runner-release.mjs \
  --release-identifier codeattest-local-runner-<version> \
  --released-at <UTC-RFC3339> \
  --release-anchor-public-key /secure/release-trust-anchor.pub \
  --release-anchor-private-key /secure/release-anchor.pkcs8.der \
  --release-anchor-key-id codeattest-offline-release-anchor \
  --release-anchor-key-version v1 \
  --out-dir /secure-transfer/codeattest-runner-release
```

Transfer the output directory and the public anchor through the controlled
release path. Never transfer the private key. From the repository root on the
VPS, run the focused gate, then deploy demo:

```sh
npm run delivery:f-check
sudo infra/deploy/deploy.sh demo "$(pwd -P)" /secure-transfer/codeattest-runner-release
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
curl --fail --silent --show-error http://127.0.0.1:8080/readyz
curl --fail --silent --show-error --resolve '<DEMO_HOSTNAME>:443:127.0.0.1' https://<DEMO_HOSTNAME>/
systemctl status codeattest-demo.service codeattest-demo-web.service codeattest-observability@demo.timer
```

After G records evidence-backed encryption readiness for pilot, set the pilot
config declaration to match that new append-only gate row and run the same
sequence with `pilot`, ports `8081`/`3001`, and the pilot hostname.

If a release fails readiness, `deploy.sh` restores the previous release. For
an operator-directed rollback, run `sudo infra/deploy/rollback.sh <identity>`.
Database migrations are not rolled back; every deployed migration must remain
backward-compatible with the retained previous release.
