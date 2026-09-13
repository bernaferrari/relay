#!/usr/bin/env bash
# Hourly SuperGrok lab pack. No Python. Heavy leftovers are --todo, not overlay.json.
# grok-hourly is the saved chrome Plan (home/attach/model on existing signed-in Tests).
# Do not invent Tests. Do not include Delete/Sign Out/older-chat/Thread.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$root/bin/relay" plan run grok-web grok-hourly \
  --lane grok-lab \
  --actor human:hourly-heavy \
  --findings \
  --export "${HOURLY_EXPORT:-/tmp/hourly}" \
  --todo "$root/scripts/hourly-supergrok/TODO.md"
