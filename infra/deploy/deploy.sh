#!/bin/sh
set -eu

usage() {
  echo "usage: deploy.sh <demo|pilot> [source-root] <signed-runner-release-dir>" >&2
  exit 2
}

identity=${1:-}
case "$identity" in
  demo|pilot) ;;
  *) usage ;;
esac

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
source_root=${2:-$(CDPATH='' cd -- "$script_dir/../.." && pwd)}
runner_release_dir=${3:-}
deploy_root=${CODEATTEST_DEPLOY_ROOT:-/opt/codeattest}
systemd_dir=${CODEATTEST_SYSTEMD_DIR:-/etc/systemd/system}
config_dir=${CODEATTEST_CONFIG_DIR:-/etc/codeattest}
caddy_dir=${CODEATTEST_CADDY_DIR:-/etc/caddy}
release_trust_anchor=${CODEATTEST_RELEASE_TRUST_ANCHOR_FILE:-/etc/codeattest/release-trust-anchor.pub}
config_path="$config_dir/$identity-host.json"
identity_root="$deploy_root/$identity"
releases_dir="$identity_root/releases"
current_link="$identity_root/current"
previous_link="$identity_root/previous"
web_link="$identity_root/web"
release_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
release_dir="$releases_dir/$release_id"
candidate_link="$identity_root/.current-$release_id"
host_unit="codeattest-$identity.service"
web_unit="codeattest-$identity-web.service"
health_port=8080
if [ "$identity" = pilot ]; then
  health_port=8081
fi
health_url="http://127.0.0.1:$health_port/readyz"
previous_release=
switched=0

if [ ! -d "$source_root" ] || [ ! -f "$source_root/package.json" ]; then
  echo "source root is not a CodeAttest checkout: $source_root" >&2
  exit 1
fi
if [ -z "$runner_release_dir" ] || [ ! -d "$runner_release_dir" ]; then
  echo "a signed runner release directory is required" >&2
  exit 1
fi
if [ ! -f "$release_trust_anchor" ]; then
  echo "missing release trust anchor: $release_trust_anchor" >&2
  exit 1
fi
anchor_owner=$(stat -c '%U' "$release_trust_anchor")
if [ "$anchor_owner" != root ] || find "$release_trust_anchor" -maxdepth 0 -perm /022 | grep -q .; then
  echo "release trust anchor must be root-owned and not group/other-writable: $release_trust_anchor" >&2
  exit 1
fi
case "$source_root" in
  "$deploy_root"/*)
    echo "source root must be separate from the native deployment root" >&2
    exit 1
    ;;
esac
case "$runner_release_dir" in
  "$source_root"|"$source_root"/*)
    echo "signed runner release directory must be outside the source checkout" >&2
    exit 1
    ;;
esac
if [ -n "$(git -C "$source_root" status --porcelain)" ]; then
  echo "source checkout is not clean; refusing an inexact release deploy" >&2
  exit 1
fi
source_build_identifier=$(git -C "$source_root" rev-parse HEAD)
case "$source_build_identifier" in
  *[!a-f0-9]*|'')
    echo "source checkout does not resolve to a lowercase commit identity" >&2
    exit 1
    ;;
esac
if [ "${#source_build_identifier}" -ne 40 ]; then
  echo "source checkout does not resolve to a 40-character commit identity" >&2
  exit 1
fi
if [ ! -f "$config_path" ]; then
  echo "missing host config: $config_path" >&2
  exit 1
fi
config_mode=$(stat -c '%a' "$config_path")
if [ "$config_mode" != 600 ]; then
  echo "host config must be mode 0600: $config_path is $config_mode" >&2
  exit 1
fi
config_owner=$(stat -c '%U' "$config_path")
if [ "$config_owner" != "codeattest-$identity" ]; then
  echo "host config must be owned by codeattest-$identity: $config_path is owned by $config_owner" >&2
  exit 1
fi
if [ -e "$current_link" ] && [ ! -L "$current_link" ]; then
  echo "refusing to replace non-symlink current path: $current_link" >&2
  exit 1
fi
if [ -e "$web_link" ] && [ ! -L "$web_link" ]; then
  echo "refusing to replace non-symlink web path: $web_link" >&2
  exit 1
fi

echo "Verifying signed runner release for source commit $source_build_identifier"
node "$source_root/scripts/verify-runner-release.mjs" \
  --release-dir "$runner_release_dir" \
  --trust-anchor "$release_trust_anchor" \
  --expected-build-identifier "$source_build_identifier"

# Invoked indirectly through the trap installed below, which shellcheck cannot
# see as a call site. SC2329 flags the function as never invoked; SC2317 flags
# each statement in its body as unreachable. Both are the same false positive.
# shellcheck disable=SC2317,SC2329
rollback_failed_deploy() {
  exit_status=$?
  if [ "$switched" -eq 1 ] && [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
    failed_link="$identity_root/.failed-$release_id"
    ln -s "$previous_release" "$failed_link"
    mv -Tf "$failed_link" "$current_link"
    ln -sfn "$current_link/apps/web" "$web_link"
    systemctl restart "$host_unit" "$web_unit" || true
    echo "readiness failed; restored $previous_release" >&2
  fi
  exit "$exit_status"
}
trap 'rollback_failed_deploy' INT TERM HUP EXIT

echo "Building CodeAttest from $source_root"
(cd "$source_root" && npm run build && npm run build:run --workspace @onevps/host)

echo "Applying and checking migrations for $identity"
(cd "$source_root" && node scripts/run-migrations.mjs --config "$config_path")

install -d -m 0755 "$releases_dir"
install -d -m 0755 "$release_dir"
rsync -a \
  --chown=root:root \
  --exclude '.git/' \
  --exclude '.superpowers/' \
  --exclude 'docs/superpowers/' \
  --exclude 'target/' \
  --exclude 'runner/crates/local-runner-scaffold/.codeattest/' \
  "$source_root/" "$release_dir/"
install -d -m 0755 "$release_dir/runner-release"
rsync -a --chown=root:root "$runner_release_dir/" "$release_dir/runner-release/"

if [ -L "$current_link" ]; then
  previous_release=$(readlink -f "$current_link")
  if [ ! -d "$previous_release" ]; then
    echo "current release link is broken: $current_link" >&2
    exit 1
  fi
  ln -sfn "$previous_release" "$previous_link"
fi
ln -s "$release_dir" "$candidate_link"
mv -Tf "$candidate_link" "$current_link"
ln -sfn "$current_link/apps/web" "$web_link"
switched=1

install -m 0644 "$source_root/infra/deploy/codeattest-$identity.service.tmpl" "$systemd_dir/$host_unit"
install -m 0644 "$source_root/infra/deploy/codeattest-$identity-web.service.tmpl" "$systemd_dir/$web_unit"
install -m 0644 "$source_root/infra/deploy/observability.service.tmpl" "$systemd_dir/codeattest-observability@.service"
install -m 0644 "$source_root/infra/deploy/observability.timer.tmpl" "$systemd_dir/codeattest-observability@.timer"
install -d -o root -g root -m 0755 /usr/local/lib/codeattest
install -o root -g root -m 0755 "$source_root/scripts/check-observability.mjs" /usr/local/lib/codeattest/check-observability.mjs
install -d -m 0755 "$caddy_dir"
install -m 0644 "$source_root/infra/deploy/Caddyfile.tmpl" "$caddy_dir/Caddyfile"

systemctl daemon-reload
systemctl enable "$host_unit" "$web_unit" "codeattest-observability@$identity.timer"
systemctl restart "$host_unit" "$web_unit"
systemctl restart "codeattest-observability@$identity.timer"
systemctl reload caddy.service

attempt=1
attempts=${CODEATTEST_HEALTH_ATTEMPTS:-30}
delay=${CODEATTEST_HEALTH_DELAY_SECONDS:-2}
while [ "$attempt" -le "$attempts" ]; do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    switched=0
    trap - INT TERM HUP EXIT
    echo "Deployed $identity release $release_id; readiness passed at $health_url"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay"
  fi
  attempt=$((attempt + 1))
done

echo "readiness did not pass after $attempts attempts: $health_url" >&2
exit 1
