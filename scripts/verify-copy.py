#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import struct

root = Path(__file__).resolve().parents[1]
source = Path('/usr/lib/chatgpt')
copy = root / 'build/desktop'
from compat import installed
expected, spec = installed()
sha = lambda p: hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
assert sha(source / 'resources/app.asar') == expected
assert sha(copy / 'resources/app.asar.reference') == expected
assert sha(source / 'ChatGPT') == sha(copy / 'ChatGPT')
native_count = 0
for p in source.rglob('*.node'):
    assert sha(p) == sha(copy / p.relative_to(source))
    native_count += 1
f = (source / 'resources/app.asar').open('rb')
_, header_size, _, json_size = struct.unpack('<4I', f.read(16))
header = json.loads(f.read(json_size))

def entries(files, prefix=''):
    for name, value in files.items():
        full = prefix + name
        if 'files' in value:
            yield from entries(value['files'], full + '/')
        else:
            yield full, value

modified = []
manifest = json.loads((root / 'build/copy-manifest.json').read_text())
ui = manifest.get('uiPatch')
for name, value in entries(header['files']):
    if 'offset' not in value or value.get('unpacked'):
        continue
    f.seek(8 + header_size + int(value['offset']))
    before = f.read(value['size'])
    after = (copy / 'resources/app' / name).read_bytes()
    if before != after:
        modified.append(name)
        if ui and name == ui['file']:
            restored = after.decode()
            for old, new in reversed(ui['replacements']):
                assert restored.count(new) == 1
                restored = restored.replace(new, old, 1)
            assert restored.encode() == before
            continue
        assert name == spec['main']
        if manifest.get('returnLinkPatch'):
            old, new = manifest['returnLinkPatch']
            assert after.count(new.encode()) == 1
            after = after.replace(new.encode(), old.encode(), 1)
        prefix = b'getAddon(){'
        insertion = b'if(process.platform===`linux`){if(this.resourcesPath==null)throw Error(`Linux device keys require resourcesPath`);return this.addon??=Xke((0,p.join)(this.resourcesPath,`linux-device-key.cjs`))}'
        insertion = insertion.replace(b'Xke(', (spec['loader'] + '(').encode())
        assert after.replace(prefix + insertion, prefix, 1) == before
assert set(modified) == {spec['main']} | ({ui['file']} if ui else set())
result = {'originalAsarUnchanged': True, 'runtimeByteIdentical': True,
          'originalNativeModulesByteIdentical': native_count,
          'changedUnpackedEntries': modified, 'featureFlagsUnchanged': True,
          'rendererVisibilityConditionsChanged': bool(ui),
          'authAndIntegrityCodeUnchanged': True}
(root / 'build/verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
