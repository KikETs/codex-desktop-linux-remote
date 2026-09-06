#!/usr/bin/env python3
"""Rebuild only the explicitly authorized development ASAR. Never change fuses,
runtime signatures, server integrity headers, or feature flags.
"""
import copy
import hashlib
import json
from pathlib import Path
import struct

root = Path(__file__).resolve().parents[1]
resources = root / 'build/desktop/resources'
original = resources / 'app.asar.reference'
target = resources / 'app.asar'
if target.exists():
    raise SystemExit('Development ASAR exists; refusing to overwrite')
from compat import installed
expected, spec = installed()
if hashlib.file_digest(original.open('rb'), 'sha256').hexdigest() != expected:
    raise SystemExit('Reference archive hash mismatch')
with original.open('rb') as f:
    _, _, _, json_size = struct.unpack('<4I', f.read(16))
    header = json.loads(f.read(json_size))

def entries(files, prefix=''):
    for name, value in files.items():
        full = prefix + name
        if 'files' in value:
            yield from entries(value['files'], full + '/')
        else:
            yield full, value

body = resources / 'app.asar.body.tmp'
offset = 0
with body.open('xb') as f:
    for name, value in entries(header['files']):
        if 'offset' not in value or value.get('unpacked'):
            continue
        data = (resources / 'app' / name).read_bytes()
        value['offset'] = str(offset)
        value['size'] = len(data)
        if 'integrity' in value:
            integrity = value['integrity']
            if integrity['algorithm'] != 'SHA256':
                raise SystemExit('Unsupported archive integrity algorithm')
            block_size = integrity['blockSize']
            integrity['hash'] = hashlib.sha256(data).hexdigest()
            integrity['blocks'] = [hashlib.sha256(data[i:i + block_size]).hexdigest()
                                   for i in range(0, len(data), block_size)]
            if not data:
                integrity['blocks'] = [hashlib.sha256(data).hexdigest()]
        f.write(data)
        offset += len(data)
raw = json.dumps(header, ensure_ascii=False, separators=(',', ':')).encode()
padded = raw + b'\0' * (-len(raw) % 4)
header_pickle = struct.pack('<II', len(padded) + 4, len(raw)) + padded
with target.open('xb') as f, body.open('rb') as stream:
    f.write(struct.pack('<II', 4, len(header_pickle)))
    f.write(header_pickle)
    while data := stream.read(1024 * 1024):
        f.write(data)
body.unlink()

# Re-read every packed entry and verify hashes/offsets before handing it to Owl.
with target.open('rb') as f:
    _, hs, _, js = struct.unpack('<4I', f.read(16))
    parsed = json.loads(f.read(js))
    for name, value in entries(parsed['files']):
        if 'offset' not in value or value.get('unpacked'):
            continue
        f.seek(8 + hs + int(value['offset']))
        data = f.read(value['size'])
        assert data == (resources / 'app' / name).read_bytes(), name
        if 'integrity' in value:
            assert hashlib.sha256(data).hexdigest() == value['integrity']['hash'], name
manifest_path = root / 'build/copy-manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest.update(mode='repackaged-development-copy',
                developmentAsarSha256=hashlib.file_digest(target.open('rb'), 'sha256').hexdigest(),
                repackagingAuthorized=True, runtimeResigned=False)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'path': str(target), 'sha256': manifest['developmentAsarSha256'],
                  'packedEntriesVerified': True}, indent=2))
