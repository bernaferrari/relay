#!/usr/bin/env bash
# Load Relay's watched server as a launchd job on a cabled lab Mac.
# Does not codesign or notarize a desktop build. Fail closed if the workspace
# or pnpm is missing.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
plist_src="$root/scripts/lab-mac/relay-server.plist.template"
dest="${HOME}/Library/LaunchAgents/dev.relay.lab-server.plist"

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

mkdir -p "$root/.relay" "$(dirname "$dest")"
sed "s|RELAY_WORKSPACE_ROOT|$root|g" "$plist_src" > "$dest"
launchctl unload "$dest" 2>/dev/null || true
launchctl load "$dest"
echo "Loaded $dest"
echo "Health: curl -sS http://127.0.0.1:8787/health"
echo "Morning routine: docs/GROK_DAILY_QA.md"
echo "Signed desktop build still needs an Apple Developer ID (agent-device-bqu.4)."
