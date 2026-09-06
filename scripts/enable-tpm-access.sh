#!/usr/bin/env bash
# Explicit, separate one-time administration action. Never clear/reinitialize TPM.
set -euo pipefail
if [[ "$EUID" -eq 0 ]]; then
  echo 'Run as the desktop user; this script invokes sudo only for group membership.' >&2
  exit 1
fi
if [[ ! -c /dev/tpmrm0 ]] || ! getent group tss >/dev/null; then
  echo 'TPM resource-manager device or tss group missing; no changes made.' >&2
  exit 1
fi
if [[ "$(stat -c %G /dev/tpmrm0)" != tss ]]; then
  echo 'Unexpected TPM device group; no changes made.' >&2
  exit 1
fi
desktop_user="$(id -un)"
if id -nG "$desktop_user" | tr ' ' '\n' | grep -qx tss; then
  echo 'Account already belongs to tss. Log out/in if this session predates the change.'
  exit 0
fi
echo 'This grants all processes of the current user access to the TPM device.'
sudo usermod -aG tss "$desktop_user"
echo 'Log out and back in to apply. Existing app sessions need restarting.'
