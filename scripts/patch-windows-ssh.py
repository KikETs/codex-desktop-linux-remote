#!/usr/bin/env python3
"""Add an opt-in Windows transport before the existing Unix SSH selection."""
import json
from pathlib import Path
import shutil
from compat import installed

root = Path(__file__).resolve().parents[1]
_, spec = installed()
if spec['version'] != '26.901.41600':
    raise SystemExit('Windows SSH adapter currently requires 26.901.41600')
resources = root / 'build/desktop/resources'
path = resources/'app'/spec['main']
old = 'function P5(e){let t=uw(e.hostConfig);'
new = 'function P5(e){let windowsTransport=require((0,p.join)(process.resourcesPath,`windows-ssh.cjs`)).createTransport(e,n.bn,()=>windowsSshOriginal(e));return windowsTransport??windowsSshOriginal(e)}function windowsSshOriginal(e){let t=uw(e.hostConfig);'
text = path.read_text()
if text.count(old) != 1:
    raise SystemExit('Unknown transport factory; refusing modification')
path.write_text(text.replace(old, new, 1))
shutil.copyfile(root/'src/windows-ssh.cjs', resources/'windows-ssh.cjs')
manifest_path = root/'build/copy-manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['windowsSshPatch'] = [old, new]
manifest['windowsSshOptIn'] = True
manifest['addedFiles'].append('resources/windows-ssh.cjs')
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
