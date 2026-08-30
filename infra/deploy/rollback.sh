#!/bin/sh
set -eu

identity=${1:-}
case "$identity" in
  demo|pilot) ;;
  *)
    echo "usage: rollback.sh <demo|pilot>" >&2
    exit 2
    ;;
esac

script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
deploy_root=${CODEATTEST_DEPLOY_ROOT:-/opt/codeattest}
release_trust_anchor=${CODEATTEST_RELEASE_TRUST_ANCHOR_FILE:-/etc/codeattest/release-trust-anchor.pub}
identity_root="$deploy_root/$identity"
current_link="$identity_root/current"
previous_link="$identity_root/previous"
web_link="$identity_root/web"
host_unit="codeattest-$identity.service"
web_unit="codeattest-$identity-web.service"
health_port=8080
if [ "$identity" = pilot ]; then
  health_port=8081
fi
health_url="http://127.0.0.1:$health_port/readyz"

if [ ! -L "$current_link" ] || [ ! -L "$previous_link" ]; then
  echo "rollback requires current and previous release symlinks for $identity" >&2
  exit 1
fi
current_release=$(readlink -f "$current_link")
previous_release=$(readlink -f "$previous_link")
if [ ! -d "$current_release" ] || [ ! -d "$previous_release" ]; then
  echo "rollback release link is broken for $identity" >&2
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

node "$script_dir/../../scripts/verify-runner-release.mjs" \
  --release-dir "$previous_release/runner-release" \
  --trust-anchor "$release_trust_anchor"

next_current="$identity_root/.rollback-current-$$"
next_previous="$identity_root/.rollback-previous-$$"
ln -s "$previous_release" "$next_current"
ln -s "$current_release" "$next_previous"
mv -Tf "$next_current" "$current_link"
mv -Tf "$next_previous" "$previous_link"
ln -sfn "$current_link/apps/web" "$web_link"

systemctl daemon-reload
systemctl restart "$host_unit" "$web_unit"

attempt=1
attempts=${CODEATTEST_HEALTH_ATTEMPTS:-30}
delay=${CODEATTEST_HEALTH_DELAY_SECONDS:-2}
while [ "$attempt" -le "$attempts" ]; do
  if curl --fail --silent --show-error --max-time 5 "$health_url" >/dev/null; then
    echo "Rolled $identity back to $previous_release; readiness passed at $health_url"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay"
  fi
  attempt=$((attempt + 1))
done

echo "rollback selected $previous_release but readiness did not pass" >&2
exit 1
