#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
root="$PWD"
if [[ ! -x "$root/build/desktop/ChatGPT" ]]; then
  echo 'Development copy missing; run python3 scripts/prepare-copy.py.' >&2
  exit 1
fi
# Preserve the desktop IBus connection before isolating XDG config/cache.
if [[ -z "${IBUS_ADDRESS:-}" ]] && command -v ibus >/dev/null 2>&1; then
  remote_ibus_address="$(ibus address 2>/dev/null || true)"
  if [[ "$remote_ibus_address" == unix:* ]]; then
    export IBUS_ADDRESS="$remote_ibus_address"
  fi
fi
# Separate app profile and app-server storage; no original token/config copying.
umask 077
mkdir -p "$root/profile/electron" "$root/profile/codex" "$root/profile/config" "$root/profile/cache"
export CODEX_ELECTRON_USER_DATA_PATH="$root/profile/electron"
export CODEX_HOME="$root/profile/codex"
export XDG_CONFIG_HOME="$root/profile/config"
export XDG_CACHE_HOME="$root/profile/cache"
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS NODE_PATH
exec "$root/build/desktop/ChatGPT" "$@"
