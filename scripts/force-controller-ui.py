#!/usr/bin/env python3
"""Explicitly authorized display-only override for the development renderer."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
from compat import installed
_, spec = installed()
relative = spec['renderer']
path = root / 'build/desktop/resources/app' / relative
changes = spec['ui']
source = path.read_text()
for before, after in changes:
    if source.count(before) != 1:
        raise SystemExit('UI insertion point changed or already patched: ' + before)
    source = source.replace(before, after, 1)
path.write_text(source)
manifest_path = root / 'build/copy-manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['controllerUiForcedVisible'] = True
manifest['serverGateValuesChanged'] = False
manifest['rendererVisibilityConditionsChanged'] = True
manifest['uiPatch'] = {'file': relative, 'replacements': changes}
manifest['modifiedCopiedAppFiles'].append('resources/app/' + relative)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('Patched controller display only; account state and backend gate bridge retained.')
