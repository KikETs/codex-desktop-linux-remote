#!/usr/bin/env python3
"""Select Windows transport for an existing Desktop SSH alias or destination."""
import argparse
import json
import os
import re
from pathlib import Path
import tempfile
import tomllib

def enable_projects(directory):
    """Enable the existing Desktop project UI through its local config option."""
    dest = directory/'config.toml'
    if dest.is_symlink():
        raise ValueError('Refusing symlink config file')
    original = dest.read_text() if dest.exists() else ''
    parsed = tomllib.loads(original)
    if parsed.get('features', {}).get('remote_connections') is True:
        return
    if 'features' not in parsed:
        updated = original.rstrip() + '\n\n[features]\nremote_connections = true\n'
    else:
        header = re.search(r'^\[features\][ \t]*(?:#.*)?$', original, re.M)
        if not header:
            raise ValueError('Use a standard [features] table before enabling projects')
        next_table = re.search(r'^\s*\[', original[header.end():], re.M)
        end = header.end() + next_table.start() if next_table else len(original)
        body = original[header.end():end]
        if 'remote_connections' in parsed['features']:
            body, count = re.subn(r'^(remote_connections[ \t]*=[ \t]*)(true|false)([ \t]*(?:#.*)?)$', r'\g<1>true\3', body, flags=re.M)
            if count != 1:
                raise ValueError('Unsupported remote_connections spelling; config preserved')
        else:
            body = '\nremote_connections = true\n' + body
        updated = original[:header.end()] + body + original[end:]
    expected = dict(parsed)
    expected['features'] = {**parsed.get('features', {}), 'remote_connections': True}
    if tomllib.loads(updated) != expected:
        raise ValueError('Unexpected config change; config preserved')
    if dest.exists():
        backup = directory/'config.toml.before-windows-ssh'
        if not backup.exists():
            fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f:
                f.write(original)
    fd, temporary = tempfile.mkstemp(prefix='.windows-projects-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(updated); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, dest)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('host', help='Exact SSH alias, SSH destination, or Desktop host ID')
    p.add_argument('--codex-path', help='Optional Windows path to codex.exe; otherwise discover it remotely')
    p.add_argument('--platform', choices=['windows', 'posix'], default='windows')
    p.add_argument('--enable-projects', action='store_true', help='Enable features.remote_connections in the isolated local config, preserving a backup')
    p.add_argument('--codex-home', type=Path, default=Path(os.environ.get('XDG_CONFIG_HOME', Path.home()/'.config'))/'ChatGPT-Remote/codex')
    args = p.parse_args()
    if args.host.startswith('-') or any(c in args.host for c in '\r\n\0'):
        p.error('Invalid SSH host')
    args.codex_home.mkdir(parents=True, exist_ok=True, mode=0o700)
    dest = args.codex_home/'windows-ssh-hosts.json'
    if dest.is_symlink():
        p.error('Refusing symlink settings file')
    data = json.loads(dest.read_text()) if dest.exists() else {'version': 1, 'hosts': {}}
    if data.get('version') != 1:
        p.error('Unsupported settings version')
    entry = {'platform': args.platform}
    if args.codex_path:
        entry['codexPath'] = args.codex_path
    data['hosts'][args.host] = entry
    fd, temporary = tempfile.mkstemp(prefix='.windows-ssh-', dir=args.codex_home)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, dest)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    print('Updated', dest)
    if args.enable_projects:
        enable_projects(args.codex_home)
        print('Enabled remote project selection in the isolated profile; restart the app.')
    print('Add this destination under Settings > Connections > SSH, then reconnect it.')

if __name__ == '__main__':
    main()
