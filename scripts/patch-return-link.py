#!/usr/bin/env python3
"""Change only the post-auth success page return link, not the OAuth callback."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
from compat import installed
_, spec = installed()
path = root / 'build/desktop/resources/app' / spec['main']
old = spec['return'] + '=`codex://settings/connections`'
new = spec['return'] + '=`chatgpt-remote://settings/connections`'
source = path.read_text()
if source.count(old) != 1:
    raise SystemExit('Unknown return link layout; refusing modification')
path.write_text(source.replace(old, new, 1))
path = root / 'build/copy-manifest.json'
manifest = json.loads(path.read_text())
manifest.update(returnLinkPatch=[old, new], returnLinkChanged=True)
path.write_text(json.dumps(manifest, indent=2) + '\n')
