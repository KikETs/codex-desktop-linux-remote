#!/usr/bin/env python3
"""Create an unpacked development copy, without changing flags or integrity code."""
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/usr/lib/chatgpt')
TARGET = ROOT / 'build/desktop'
from compat import installed
EXPECTED, spec = installed()
archive = SOURCE / 'resources/app.asar'
digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
if digest != EXPECTED:
    raise SystemExit('Unsupported upstream ASAR hash. Re-audit before building.')
if TARGET.exists():
    raise SystemExit('Development copy already exists; refusing to overwrite it.')
if not (ROOT / 'build/tpm-key').is_file():
    raise SystemExit('Run npm run build first.')
TARGET.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['cp', '-a', '--reflink=auto', str(SOURCE), str(TARGET)], check=True)
# Original runtime/native modules remain byte-identical. Do not reconstruct ASAR.
resources = TARGET / 'resources'
original = resources / 'app.asar'
f = original.open('rb')
_, header_size, _, json_size = struct.unpack('<4I', f.read(16))
header = json.loads(f.read(json_size))
base = 8 + header_size
app = resources / 'app'
app.mkdir()

def entries(files, prefix=''):
    for name, item in files.items():
        full = prefix + name
        if 'files' in item:
            yield from entries(item['files'], full + '/')
        else:
            yield full, item

for name, item in entries(header['files']):
    target = app / name
    if not target.resolve().is_relative_to(app.resolve()):
        raise SystemExit('Invalid ASAR entry path')
    target.parent.mkdir(parents=True, exist_ok=True)
    if 'link' in item:
        link_target = app / item['link']
        if not link_target.resolve().is_relative_to(app.resolve()):
            raise SystemExit('Invalid ASAR link')
        import os
        target.symlink_to(os.path.relpath(link_target, target.parent))
    elif item.get('unpacked'):
        shutil.copy2(resources / 'app.asar.unpacked' / name, target)
    else:
        f.seek(base + int(item['offset']))
        target.write_bytes(f.read(item['size']))
        if item.get('executable'):
            target.chmod(0o755)
f.close()
main = app / spec['main']
source = main.read_text()
needle = 'getAddon(){if(process.platform!==`darwin`&&process.platform!==`win32`)throw Error(`Remote control device keys are only available on macOS and Windows`);'
if source.count(needle) != 1:
    raise SystemExit('Device key insertion point is not unique; refusing modification')
replacement = 'getAddon(){if(process.platform===`linux`){if(this.resourcesPath==null)throw Error(`Linux device keys require resourcesPath`);return this.addon??=Xke((0,p.join)(this.resourcesPath,`linux-device-key.cjs`))}' + needle[len('getAddon(){'):]
replacement = replacement.replace('Xke(', spec['loader'] + '(')
main.write_text(source.replace(needle, replacement))
shutil.copy2(ROOT / 'src/device-key.cjs', resources / 'linux-device-key-provider.cjs')
shutil.copy2(ROOT / 'src/desktop-adapter.cjs', resources / 'linux-device-key.cjs')
shutil.copy2(ROOT / 'build/tpm-key', resources / 'native/linux-remote-control-tpm')
original.rename(resources / 'app.asar.reference')
manifest = {
    'upstreamVersion': spec['version'], 'source': str(SOURCE),
    'upstreamAsarSha256': digest, 'mode': 'unpacked-development-copy',
    'modifiedOriginalAppFiles': [],
    'modifiedCopiedAppFiles': ['resources/app/' + spec['main']],
    'featureFlagsChanged': False, 'authenticationChanged': False,
    'integrityChecksChanged': False, 'nativeModulesReplaced': False,
    'addedFiles': ['resources/linux-device-key.cjs', 'resources/linux-device-key-provider.cjs',
                   'resources/native/linux-remote-control-tpm'],
}
(ROOT / 'build/copy-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(TARGET)
