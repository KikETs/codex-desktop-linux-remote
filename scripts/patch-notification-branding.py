#!/usr/bin/env python3
"""Identify native notifications from the isolated Remote copy."""
import json
from pathlib import Path
from compat import installed

root = Path(__file__).resolve().parents[1]
_, spec = installed()
if spec['version'] != '26.901.41600':
    print('Native notification branding is only reviewed for 26.901.41600')
    raise SystemExit(0)
path = root/'build/desktop/resources/app'/spec['main']
old = 'let t=new l.Notification(e);return{show:()=>t.show()'
new = 'let t=new l.Notification({...e,title:`[Remote] ${e.title??``}`,icon:(0,p.join)(process.resourcesPath,`icon-chatgpt.png`)});return{show:()=>t.show()'
source = path.read_text()
if source.count(old) != 1:
    raise SystemExit('Unknown native notification factory; refusing modification')
path.write_text(source.replace(old, new, 1))
manifest_path = root/'build/copy-manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['notificationBrandingPatch'] = [old, new]
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
