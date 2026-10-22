#!/bin/sh
set -eu

usage() {
  echo "usage: backup.sh <demo|pilot> <backup-root>" >&2
  exit 2
}

identity=${1:-}
case "$identity" in
  demo|pilot) ;;
  *) usage ;;
esac
backup_root=${2:-}
case "$backup_root" in
  /*) ;;
  *) usage ;;
esac

config_dir=${CODEATTEST_CONFIG_DIR:-/etc/codeattest}
deploy_root=${CODEATTEST_DEPLOY_ROOT:-/opt/codeattest}
pg_superuser=${CODEATTEST_PG_SUPERUSER:-postgres}
keep=${CODEATTEST_BACKUP_KEEP:-7}
config_path="$config_dir/$identity-host.json"
retention_timer="codeattest-retention@$identity.timer"
retention_service="codeattest-retention@$identity.service"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
destination="$backup_root/$identity"
partial="$destination/.partial-$stamp"
final="$destination/$stamp"
timer_was_active=0

if [ "$(id -u)" -ne 0 ]; then
  echo "backup.sh must run as root" >&2
  exit 1
fi
case "$keep" in
  ''|*[!0-9]*|0)
    echo "CODEATTEST_BACKUP_KEEP must be a positive integer" >&2
    exit 1
    ;;
esac
if [ ! -f "$config_path" ]; then
  echo "missing host config: $config_path" >&2
  exit 1
fi

# The object root and the database port come from the host config, so the
# backup reads exactly what the host serves. The dump runs as the cluster
# superuser over the local socket; the app role cannot read every table.
object_root=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).object_store_root)' "$config_path")
pg_port=$(node -e 'process.stdout.write(new URL(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).database_url).port || "5432")' "$config_path")
database=$(node -e 'process.stdout.write(new URL(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).database_url).pathname.slice(1))' "$config_path")

if [ ! -d "$object_root" ]; then
  echo "object store root is not a directory: $object_root" >&2
  exit 1
fi
case "$backup_root/" in
  "$object_root"/*|"$(dirname -- "$object_root")"/*)
    echo "backup root must be outside the deployment's data directory" >&2
    exit 1
    ;;
esac

install -d -m 0700 -o root -g root "$backup_root" "$destination"

# The dump holds review history, identities, and receipts in clear text. Pilot
# backups must land on an encrypted device, the same rule the host's boot
# probe applies to the object store.
backing=$(findmnt -n -T "$destination" -o SOURCE,FSTYPE)
if ! printf '%s\n' "$backing" | grep -Eqi 'mapper|crypt|crypto_luks'; then
  if [ "$identity" = pilot ]; then
    echo "pilot backups must be written to an encrypted device; $destination is on: $backing" >&2
    exit 1
  fi
  echo "warning: $destination is not on an encrypted device ($backing)" >&2
fi

# shellcheck disable=SC2317,SC2329
cleanup() {
  exit_status=$?
  rm -rf -- "$partial"
  if [ "$timer_was_active" -eq 1 ]; then
    systemctl start "$retention_timer" || true
  fi
  exit "$exit_status"
}
trap 'cleanup' INT TERM HUP EXIT

# A retention purge between the dump and the object archive would leave the
# backup naming an object it does not hold, so purges pause for the backup.
if systemctl is-active --quiet "$retention_timer"; then
  timer_was_active=1
fi
for unit in "$retention_timer" "$retention_service"; do
  systemctl stop "$unit" 2>/dev/null || true
  if systemctl is-active --quiet "$unit"; then
    echo "could not stop $unit; refusing to back up during a purge" >&2
    exit 1
  fi
done

umask 077
mkdir -- "$partial"

echo "Dumping $identity database $database on port $pg_port"
runuser -u "$pg_superuser" -- pg_dump --port "$pg_port" --format=custom --no-password "$database" > "$partial/database.dump"
migration_head=$(runuser -u "$pg_superuser" -- psql --port "$pg_port" --no-password --tuples-only --no-align --dbname "$database" \
  --command "SELECT filename FROM schema_migration ORDER BY filename DESC LIMIT 1")

echo "Archiving object store $object_root"
tar -C "$object_root" --exclude='*.tmp' --exclude='./.onevps-boot-probe-*' --exclude='./lost+found' -cf "$partial/objects.tar" .

release=
if [ -L "$deploy_root/$identity/current" ]; then
  release=$(readlink -f "$deploy_root/$identity/current")
fi
{
  echo "identity=$identity"
  echo "created_at=$stamp"
  echo "migration_head=$migration_head"
  echo "release=$release"
} > "$partial/INFO"

# Prove the archive is readable before calling it a backup.
pg_restore --list "$partial/database.dump" > /dev/null
tar -tf "$partial/objects.tar" > /dev/null
(cd "$partial" && sha256sum database.dump objects.tar INFO > SHA256SUMS)

mv -T -- "$partial" "$final"
trap - INT TERM HUP EXIT
if [ "$timer_was_active" -eq 1 ]; then
  systemctl start "$retention_timer"
fi

# Keep the newest $keep complete backups. Purged evidence stays in older
# backups until they age out here, so keep the window short (see BACKUP.md).
find "$destination" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*T[0-9]*Z' | sort | head -n "-$keep" | while IFS= read -r old; do
  rm -rf -- "$old"
  echo "Pruned $old"
done

echo "Backed up $identity to $final"
echo "This backup holds no keys. Back up /etc/codeattest/$identity separately and offline."
