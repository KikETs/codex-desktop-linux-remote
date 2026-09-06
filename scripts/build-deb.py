#!/usr/bin/env python3
"""Package the already verified development copy under a separate apt identity."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / 'build/desktop'
from compat import installed
_, spec = installed()
version = spec['version'] + '+remote.6'
stage = root / f'build/deb-root-{version}'
output = root / f'build/chatgpt-remote_{version}_amd64.deb'
if stage.exists() or output.exists():
    raise SystemExit('Package staging/output already exists; refusing to overwrite')
subprocess.run(['python3', str(root / 'scripts/verify-copy.py')], check=True)
manifest = json.loads((root / 'build/copy-manifest.json').read_text())
with (source / 'resources/app.asar').open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == manifest['developmentAsarSha256']
target = stage / 'opt/chatgpt-remote'
target.mkdir(parents=True)
subprocess.run(['cp', '-a', '--reflink=auto', str(source) + '/.', str(target)], check=True)
# Ship the rebuilt archive, not extraction work files or the untouched reference.
shutil.rmtree(target / 'resources/app')
(target / 'resources/app.asar.reference').unlink()
backup = target / 'resources/app.asar.before-ui'
if backup.exists():
    backup.unlink()
(target / 'codex-launcher').unlink()
# Production helper needs execution permission for the installing desktop user.
(target / 'resources/native/linux-remote-control-tpm').chmod(0o755)

def write(path, data, mode=0o644):
    dest = stage / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(data)
    dest.chmod(mode)

write('usr/bin/chatgpt-remote', '''#!/bin/bash
set -euo pipefail
umask 077
# Preserve the desktop IBus connection before isolating XDG config/cache.
if [[ -z "${IBUS_ADDRESS:-}" ]] && command -v ibus >/dev/null 2>&1; then
  remote_ibus_address="$(ibus address 2>/dev/null || true)"
  if [[ "$remote_ibus_address" == unix:* ]]; then
    export IBUS_ADDRESS="$remote_ibus_address"
  fi
fi
remote_config="${XDG_CONFIG_HOME:-$HOME/.config}/ChatGPT-Remote"
remote_cache="${XDG_CACHE_HOME:-$HOME/.cache}/ChatGPT-Remote"
mkdir -p "$remote_config/electron" "$remote_config/codex" "$remote_config/config" "$remote_cache"
# Reuse only IBus discovery files; keep app credentials/settings isolated.
remote_ibus_bus="${XDG_CONFIG_HOME:-$HOME/.config}/ibus/bus"
if [[ -d "$remote_config/config/ibus/bus" && ! -L "$remote_config/config/ibus/bus" ]]; then
  rmdir -- "$remote_config/config/ibus/bus" 2>/dev/null || true
fi
if [[ -d "$remote_ibus_bus" && ! -e "$remote_config/config/ibus/bus" && ! -L "$remote_config/config/ibus/bus" ]]; then
  mkdir -p "$remote_config/config/ibus"
  ln -s -- "$remote_ibus_bus" "$remote_config/config/ibus/bus"
fi

export CODEX_ELECTRON_USER_DATA_PATH="$remote_config/electron"
export CODEX_HOME="$remote_config/codex"
export XDG_CONFIG_HOME="$remote_config/config"
export XDG_CACHE_HOME="$remote_cache"
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS NODE_PATH
exec /opt/chatgpt-remote/ChatGPT --class=ChatGPT-Remote --name=chatgpt-remote "$@"
''', 0o755)
write('usr/share/applications/chatgpt-remote.desktop', '''[Desktop Entry]
Name=ChatGPT-Remote
Comment=Local development build with Linux TPM remote controller support
Exec=/usr/bin/chatgpt-remote
Icon=chatgpt-remote
Type=Application
Terminal=false
StartupNotify=true
StartupWMClass=ChatGPT-Remote
Categories=Development;
''')
icon = stage / 'usr/share/pixmaps/chatgpt-remote.png'
icon.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source / 'resources/icon-chatgpt.png', icon)
write('etc/apparmor.d/chatgpt-remote', '''abi <abi/4.0>,
include <tunables/global>
profile chatgpt-remote "/opt/chatgpt-remote/ChatGPT" flags=(unconfined) {
  userns,
}
''')
dependencies = subprocess.check_output(
    ['dpkg-query', '-W', '-f=${Depends}', 'chatgpt'], text=True).strip()
dependencies += ', libtss2-esys-3.0.2-0t64, libtss2-mu-4.0.1-0t64, libtss2-tctildr0t64, libtss2-tcti-device0t64'
dependencies += ', python3'
write('usr/bin/chatgpt-remote-open', '''#!/usr/bin/python3
import os
import sys
# No tokens or arbitrary URLs are accepted. This link only focuses Connections.
if sys.argv[1:] != ['chatgpt-remote://settings/connections']:
    raise SystemExit('Unsupported ChatGPT-Remote return link')
os.execv('/usr/bin/chatgpt-remote', ['chatgpt-remote', '--class=ChatGPT-Remote',
    '--name=chatgpt-remote', 'codex://settings/connections'])
''', 0o755)
write('usr/share/applications/chatgpt-remote-return.desktop', '''[Desktop Entry]
Name=ChatGPT-Remote Return
Exec=/usr/bin/chatgpt-remote-open %u
Type=Application
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/chatgpt-remote;
''')
write('DEBIAN/control', f'''Package: chatgpt-remote
Version: {version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Local Development <local@localhost>
Depends: {dependencies}
Description: ChatGPT-Remote local development build
 Separate development installation with Linux TPM device key support.
 Unofficial build. Remote connectivity is unverified.
''')
write('DEBIAN/postinst', '''#!/bin/sh
set -e
if [ "$1" = configure ] && command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
  apparmor_parser -r /etc/apparmor.d/chatgpt-remote
fi
''', 0o755)
write('DEBIAN/postrm', '''#!/bin/sh
set -e
case "$1" in
  remove|purge)
    if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ] && [ -f /etc/apparmor.d/chatgpt-remote ]; then
      apparmor_parser -R /etc/apparmor.d/chatgpt-remote
    fi
    ;;
esac
''', 0o755)
write('DEBIAN/conffiles', '/etc/apparmor.d/chatgpt-remote\n')
subprocess.run(['apparmor_parser', '-Q', '-K', str(stage / 'etc/apparmor.d/chatgpt-remote')], check=True)
subprocess.run(['bash', '-n', str(stage / 'usr/bin/chatgpt-remote')], check=True)
for script in ('postinst', 'postrm'):
    subprocess.run(['sh', '-n', str(stage / 'DEBIAN' / script)], check=True)
subprocess.run(['dpkg-deb', '--root-owner-group', '-Zzstd', '-z3', '--build', str(stage), str(output)], check=True)
print(output)
