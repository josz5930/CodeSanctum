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

Run migrations once as each migrator. Migration `0002_roles_and_grants.sql`
creates `codeattest_app` with a synthetic local password; replace it immediately
and independently in each cluster:

```sh
node scripts/run-migrations.mjs --database-url 'postgres://codeattest_migrator:<DEMO_MIGRATOR_PASSWORD>@127.0.0.1:5433/codeattest'
node scripts/run-migrations.mjs --database-url 'postgres://codeattest_migrator:<PILOT_MIGRATOR_PASSWORD>@127.0.0.1:5434/codeattest'
sudo -u postgres psql -p 5433 -d codeattest -c "ALTER ROLE codeattest_app PASSWORD '<DEMO_APP_PASSWORD>'"
sudo -u postgres psql -p 5434 -d codeattest -c "ALTER ROLE codeattest_app PASSWORD '<PILOT_APP_PASSWORD>'"
```

Seed only the existing, non-real-evidence profiles. Repeating version 1 is a
recorded no-op; never edit or replace a prior gate row:

```sh
node scripts/seed-environment-gate.mjs --database-url 'postgres://codeattest_migrator:<DEMO_MIGRATOR_PASSWORD>@127.0.0.1:5433/codeattest' --gate-file protocol/fixtures/v0/valid/environment-evidence-gate.synthetic-demo.json --version 1
node scripts/seed-environment-gate.mjs --database-url 'postgres://codeattest_migrator:<PILOT_MIGRATOR_PASSWORD>@127.0.0.1:5434/codeattest' --gate-file protocol/fixtures/v0/valid/environment-evidence-gate.partner-pilot-candidate.json --version 1
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

Generate independent 32-byte TOTP wrapping keys. Existing keys are never
overwritten:

```sh
sudo test -e /etc/codeattest/demo/totp-key || openssl rand 32 | sudo tee /etc/codeattest/demo/totp-key >/dev/null
sudo test -e /etc/codeattest/pilot/totp-key || openssl rand 32 | sudo tee /etc/codeattest/pilot/totp-key >/dev/null
sudo chmod 0400 /etc/codeattest/demo/totp-key /etc/codeattest/pilot/totp-key
```

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
[`../../services/host/src/config.ts`](../../services/host/src/config.ts). Use
loopback ports `8080` and `8081`, the matching cluster URL, independent key IDs,
and `credential_name` values `demo-signing-key` and `pilot-signing-key`.
Demo uses `/var/lib/codeattest/demo/objects` and its engineered budget values.
Pilot uses the no-op meter automatically. Set both files to root-owned mode
`0600`; `deploy.sh` refuses any other mode.

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
