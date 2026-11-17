#!/usr/bin/env bash
# Deploy this checkout to another machine running Quarterdeck as a node, and PROVE it worked:
# copy the code, install dependencies, restart the service, then ask the node (over ssh, on its loopback)
# which build it is running and compare with this checkout. Exit code 0 only if they match.
#
#   scripts/deploy-node.sh <ssh-host> [remote-dir] [port]
#   e.g. scripts/deploy-node.sh mbp            (remote-dir defaults to ~/quarterdeck, port to 7690)
#
# The service is restarted with launchd (macOS, label com.quarterdeck.server) or systemd --user (Linux, unit
# quarterdeck); override with QD_SERVICE=<label-or-unit>.
set -euo pipefail

host="${1:?usage: deploy-node.sh <ssh-host> [remote-dir] [port]}"
rdir="${2:-quarterdeck}"           # relative = under the remote home
port="${3:-7690}"
src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

want="$(cd "$src" && bun server.ts --build-id)"
[[ "$want" =~ ^[0-9a-f]{12}$ ]] || { echo "could not compute local build id (got: $want)" >&2; exit 1; }
echo "→ $host: deploying build $want from $src"

# The target is always written "host:dir/" in one quoted word (a zsh-style "$h:q…" once turned it into a local path).
rsync -a --delete --exclude node_modules --exclude .git --exclude .claude "$src/" "${host}:${rdir}/"

ssh "$host" bash -s -- "$rdir" "$port" "$want" "${QD_SERVICE:-}" <<'REMOTE'
set -euo pipefail
rdir="$1"; port="$2"; want="$3"; svc="$4"
cd "$HOME" && cd "$rdir"
bun="$(command -v bun || true)"; [ -n "$bun" ] || bun="$HOME/.bun/bin/bun"
[ -x "$bun" ] || { echo "bun not found on $(hostname)" >&2; exit 1; }
"$bun" install --frozen-lockfile --production >/dev/null
got_files="$("$bun" server.ts --build-id)"
[ "$got_files" = "$want" ] || { echo "files on $(hostname) are build $got_files, expected $want (copy incomplete?)" >&2; exit 1; }
if [ "$(uname)" = Darwin ]; then
  launchctl kickstart -k "gui/$(id -u)/${svc:-com.quarterdeck.server}"
else
  systemctl --user restart "${svc:-quarterdeck}"
fi
for i in $(seq 1 30); do
  sleep 1
  got="$(curl -s -m 2 "http://127.0.0.1:${port}/api/hello" | sed -n 's/.*"build":"\([0-9a-f]*\)".*/\1/p' || true)"
  if [ "$got" = "$want" ]; then echo "✓ $(hostname) is running build $got (after ${i} s)"; exit 0; fi
done
echo "✗ $(hostname): service did not come back with build $want (last answer: ${got:-none})" >&2
exit 1
REMOTE
