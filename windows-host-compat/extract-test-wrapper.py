#!/usr/bin/env python3
"""Extract the installed official Desktop's small shell-command builder for tests."""
import json
import argparse
import os
from pathlib import Path
import re
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--asar', type=Path, help='Installed official app.asar (read only)')
args = parser.parse_args()
archive = args.asar or Path('/usr/lib/chatgpt/resources/app.asar')
if os.name == 'nt' and not args.asar:
    raise SystemExit('Pass --asar with the installed official Windows app.asar path')
output = Path(__file__).resolve().parents[1] / 'build/windows-host-compat/official-shell-wrapper.cjs'
with archive.open('rb') as stream:
    _, header_size, _, json_size = struct.unpack('<4I', stream.read(16))
    header = json.loads(stream.read(json_size))
    builds = header['files']['.vite']['files']['build']['files']
    matches = []
    for name, entry in builds.items():
        if not name.startswith(('bootstrap-', 'main-')) or not name.endswith('.js'):
            continue
        stream.seek(8 + header_size + int(entry['offset']))
        source = stream.read(entry['size']).decode()
        for match in re.finditer(r'function ([\w$]+)\(e,t\)\{let n=`\$\{[\w$]+\}; \$\{e\}`', source):
            start = source.rfind('var ', 0, match.start())
            end = source.find('var ', match.end())
            fragment = source[start:end]
            if 'CODEX_REMOTE_PAYLOAD' in fragment and 'sh -c' in fragment:
                matches.append((match[1], fragment))
    if len(matches) != 1:
        raise SystemExit('Unknown official shell wrapper; inspect the current bundle before testing')
    function, fragment = matches[0]
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(fragment + '\nmodule.exports={wrap:' + function + '};\n', encoding='utf-8', newline='\n')
print(output)
