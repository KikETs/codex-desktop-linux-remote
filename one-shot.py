#!/usr/bin/env python3
"""Build from a supported installed official app in a fresh isolated workspace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from compat import BUILDS

ROOT = Path(__file__).resolve().parent

def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Install the verified local deb using sudo; does not alter TPM permissions')
    parser.add_argument('--fetch-deps', action='store_true', help='Download Ubuntu TPM development and simulator packages into the build workspace only')
    parser.add_argument('--check', action='store_true', help='Read-only compatibility and tool check')
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error('Run as the desktop user, not sudo. Only --install invokes sudo.')
    package = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'chatgpt'], text=True)
    arch = subprocess.check_output(['dpkg', '--print-architecture'], text=True).strip()
    archive = Path('/usr/lib/chatgpt/resources/app.asar')
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    print(json.dumps({'installedVersion': package, 'architecture': arch,
                      'asarSha256': digest, 'supported': digest in BUILDS and arch == 'amd64'}, indent=2), flush=True)
    if digest not in BUILDS or arch != 'amd64':
        parser.error('Unsupported official build. Re-audit and add a reviewed adapter; do not replace the hash alone.')
    required = ['g++', 'node', 'dpkg-deb', 'apparmor_parser', 'desktop-file-validate', 'cp']
    missing = [name for name in required if shutil.which(name) is None]
    if missing:
        parser.error('Missing build tools: ' + ', '.join(missing))
    node_major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'], text=True))
    if node_major < 22:
        parser.error('Node.js 22 or newer required')
    if args.check:
        return
    runs = ROOT / 'build/runs'
    runs.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix='remote-', dir=runs))
    print('Build workspace:', workspace, flush=True)
    for name in ['src', 'scripts', 'test']:
        shutil.copytree(ROOT / name, workspace / name)
    shutil.copyfile(ROOT / 'package.json', workspace / 'package.json')
    if args.fetch_deps:
        debs = workspace / 'vendor/debs'
        debs.mkdir(parents=True)
        run('apt-get', 'download', 'libtss2-dev', 'libtpms0', 'swtpm', cwd=debs)
        for deb in sorted(debs.glob('*.deb')):
            run('dpkg-deb', '-x', str(deb), str(workspace / 'vendor/root'))
    elif (ROOT / 'vendor/root/usr/include/tss2').is_dir():
        (workspace / 'vendor').symlink_to(ROOT / 'vendor', target_is_directory=True)
    else:
        parser.error('TPM headers/simulator missing. Re-run with --fetch-deps (local extraction only).')
    run('bash', 'scripts/build.sh', cwd=workspace)
    for script in ['prepare-copy.py', 'force-controller-ui.py', 'patch-return-link.py', 'repack-copy.py', 'verify-copy.py']:
        run('python3', 'scripts/' + script, cwd=workspace)
    run('node', '--test', 'test/provider.test.cjs', cwd=workspace)
    run('node', '--check', 'build/desktop/resources/app/' + BUILDS[digest]['renderer'], cwd=workspace)
    run('python3', 'scripts/build-deb.py', cwd=workspace)
    deb, = (workspace / 'build').glob('chatgpt-remote_*.deb')
    run('desktop-file-validate', str(next((workspace / 'build').glob('deb-root-*/usr/share/applications/chatgpt-remote.desktop'))))
    run('apt-get', '-s', 'install', str(deb))
    with deb.open('rb') as stream:
        deb_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = {'deb': str(deb), 'sha256': deb_hash, 'officialAsarSha256': digest,
              'tests': '7 simulator tests passed', 'hardwareAndGuiValidated': False}
    (workspace / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2), flush=True)
    if args.install:
        for process in Path('/proc').iterdir():
            if not process.name.isdigit():
                continue
            try:
                executable = str((process / 'exe').readlink())
            except OSError:
                continue
            if executable == '/opt/chatgpt-remote/ChatGPT':
                parser.error('Build succeeded. Close ChatGPT-Remote before installing the printed deb with sudo apt install.')
        run('sudo', 'apt-get', 'install', str(deb))

if __name__ == '__main__':
    main()
