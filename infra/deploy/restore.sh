#!/bin/sh
set -eu

usage() {
  echo "usage: restore.sh <demo|pilot> <backup-dir>" >&2
  exit 2
}

identity=${1:-}
case "$identity" in
  demo|pilot) ;;
  *) usage ;;
esac
backup_dir=${2:-}
if [ -z "$backup_dir" ] || [ ! -d "$backup_dir" ]; then
  usage
fi

config_dir=${CODEATTEST_CONFIG_DIR:-/etc/codeattest}
deploy_root=${CODEATTEST_DEPLOY_ROOT:-/opt/codeattest}
pg_superuser=${CODEATTEST_PG_SUPERUSER:-postgres}
config_path="$config_dir/$identity-host.json"
migrator_url_file="$config_dir/$identity/migrator-database-url"
current_link="$deploy_root/$identity/current"
service_user="codeattest-$identity"
units="codeattest-$identity.service codeattest-$identity-web.service codeattest-worker@$identity.service codeattest-retention@$identity.timer codeattest-retention@$identity.service codeattest-checkpoint@$identity.timer codeattest-checkpoint@$identity.service"
health_port=8080
if [ "$identity" = pilot ]; then
  health_port=8081
fi
health_url="http://127.0.0.1:$health_port/readyz"

if [ "$(id -u)" -ne 0 ]; then
  echo "restore.sh must run as root" >&2
  exit 1
fi
if [ ! -f "$config_path" ]; then
  echo "missing host config: $config_path" >&2
  exit 1
fi

echo "Verifying backup checksums in $backup_dir"
(cd "$backup_dir" && sha256sum --check --strict --quiet SHA256SUMS)
if ! grep -qx "identity=$identity" "$backup_dir/INFO"; then
  echo "backup was not taken from $identity: $backup_dir" >&2
  exit 1
fi

object_root=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).object_store_root)' "$config_path")
pg_port=$(node -e 'process.stdout.write(new URL(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).database_url).port || "5432")' "$config_path")
database=$(node -e 'process.stdout.write(new URL(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).database_url).pathname.slice(1))' "$config_path")

psql_as_superuser() {
  runuser -u "$pg_superuser" -- psql --port "$pg_port" --no-password --tuples-only --no-align --dbname "$database" --command "$1"
}

if [ ! -d "$object_root" ]; then
  echo "object store root is not a directory: $object_root (provision it first)" >&2
  exit 1
fi
if [ "$identity" = pilot ]; then
  backing=$(findmnt -n -T "$object_root" -o SOURCE,FSTYPE)
  if ! printf '%s\n' "$backing" | grep -Eqi 'mapper|crypt|crypto_luks'; then
    echo "pilot object store must be on an encrypted device before restore; $object_root is on: $backing" >&2
    exit 1
  fi
fi

# Restore only into an empty database and an empty object store. The history
# is append-only; merging a backup into live data, or replacing it, is a
# decision for a human to make by hand, not a side effect of this script.
if [ -n "$(find "$object_root" -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit)" ]; then
  echo "object store root is not empty: $object_root" >&2
  exit 1
fi
table_count=$(psql_as_superuser "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$table_count" != 0 ]; then
  echo "database $database on port $pg_port is not empty ($table_count tables); create an empty one first" >&2
  exit 1
fi
role_count=$(psql_as_superuser "SELECT count(*) FROM pg_roles WHERE rolname IN ('codeattest_migrator', 'codeattest_app')")
if [ "$role_count" != 2 ]; then
  echo "codeattest_migrator and codeattest_app must exist before restore (PROVISIONING.md section 3)" >&2
  exit 1
fi

echo "Stopping $identity services"
for unit in $units; do
  systemctl stop "$unit" 2>/dev/null || true
  if systemctl is-active --quiet "$unit"; then
    echo "could not stop $unit; refusing to restore under a running service" >&2
    exit 1
  fi
done

echo "Restoring database $database on port $pg_port"
runuser -u "$pg_superuser" -- pg_restore --port "$pg_port" --no-password --dbname "$database" --exit-on-error --single-transaction < "$backup_dir/database.dump"

echo "Restoring object store $object_root"
tar -C "$object_root" --no-same-owner -xf "$backup_dir/objects.tar"
chown -R "$service_user:$service_user" "$object_root"
chmod 0700 "$object_root"

if [ ! -L "$current_link" ]; then
  echo "Restored $identity from $backup_dir. No release is deployed; run deploy.sh next."
  exit 0
fi

# The backup may predate the deployed release's migrations.
echo "Bringing the restored schema up to the deployed release"
node "$current_link/scripts/run-migrations.mjs" --database-url-file "$migrator_url_file"

systemctl start "codeattest-$identity.service" "codeattest-$identity-web.service" "codeattest-worker@$identity.service"
systemctl start "codeattest-retention@$identity.timer" "codeattest-checkpoint@$identity.timer"

attempt=1
attempts=${CODEATTEST_HEALTH_ATTEMPTS:-30}
delay=${CODEATTEST_HEALTH_DELAY_SECONDS:-2}
while [ "$attempt" -le "$attempts" ]; do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    echo "Restored $identity from $backup_dir; readiness passed at $health_url"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay"
  fi
  attempt=$((attempt + 1))
done

echo "restored $identity but readiness did not pass: $health_url" >&2
exit 1
