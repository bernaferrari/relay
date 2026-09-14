#!/usr/bin/env bash
# Load Relay's watched server as a launchd job on a cabled lab Mac.
# Does not codesign or notarize a desktop build. Fail closed if the workspace
# or pnpm is missing. `--check` is read-only. Loading while :8787 is up
# restarts the watched server — refuse instead of `launchctl load`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
plist_src="$root/scripts/lab-mac/relay-server.plist.template"
dest="${HOME}/Library/LaunchAgents/dev.relay.lab-server.plist"
check_only=false
if [[ "${1:-}" == "--check" ]]; then
  check_only=true
fi

if [[ ! -f "$root/package.json" ]]; then
  echo "install-lab-server: workspace root not found at $root" >&2
  exit 1
fi
if ! command -v pnpm >/dev/null; then
  echo "install-lab-server: pnpm is required on PATH" >&2
  exit 1
fi
if [[ ! -f "$plist_src" ]]; then
  echo "install-lab-server: missing $plist_src" >&2
  exit 1
fi

uid="$(id -u)"
print="$(launchctl print "gui/${uid}/dev.relay.lab-server" 2>&1 || true)"
if echo "$print" | grep -qi "Could not find service"; then
  echo "Lab Mac server: not loaded (dev.relay.lab-server)"
else
  echo "Lab Mac server: launchctl print follows"
  echo "$print"
fi
if [[ -f "$dest" ]]; then
  echo "Plist: $dest"
else
  echo "Plist: missing ($dest)"
fi
echo "Morning routine: docs/GROK_DAILY_QA.md"
echo "Signed desktop build still needs an Apple Developer ID (agent-device-bqu.4)."

if $check_only; then
  exit 0
fi

if curl -sf --max-time 2 http://127.0.0.1:8787/health >/dev/null; then
  echo "install-lab-server: refusing to load. :8787 is already serving; launchctl load would restart it." >&2
  echo "Morning review stays Vite UI + pnpm ensure:serve. Re-run with --check after that server is stopped." >&2
  exit 2
fi

mkdir -p "$root/.relay" "$(dirname "$dest")"
sed "s|RELAY_WORKSPACE_ROOT|$root|g" "$plist_src" > "$dest"
launchctl unload "$dest" 2>/dev/null || true
launchctl load "$dest"
echo "Loaded $dest"
echo "Health: curl -sS http://127.0.0.1:8787/health"
