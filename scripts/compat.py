"""Reviewed source anchors. Unknown archives are rejected before extraction."""
import hashlib
from pathlib import Path

BUILDS = {
 '6be4f6074b300590459f9c5e1e8ea22bd57db08557a1186c521f055302d99c8a': {
  'version': '26.901.20858', 'main': '.vite/build/main-b_QrpbvH.js',
  'renderer': 'webview/assets/remote-connections-settings-7e9d7a97fb66.js',
  'loader': 'Xke', 'return': 'e4',
  'ui': [('Te=b(),V=!g,Ee=', 'Te=b(),V=!0,Ee='),
         ('at=V&&(Te||!1),ot=', 'at=!0,ot='),
         ('remoteControlConnectionsAuthRequired:We,showRemoteControlConnectionsSection:Te}', 'remoteControlConnectionsAuthRequired:We,showRemoteControlConnectionsSection:!0}'),
         ('showControlThisMacTab:rt,showRemoteControlConnectionsSection:Te,', 'showControlThisMacTab:rt,showRemoteControlConnectionsSection:!0,')]},
 'e71b1da21005efede51782f9b2183ba19b513caca2c61a0301172d7439955130': {
  'version': '26.901.41600', 'main': '.vite/build/main-C5K7o1Hr.js',
  'renderer': 'webview/assets/remote-connections-settings-ef54ad59b5c0.js',
  'loader': 'Yke', 'return': 't4',
  'ui': [('De=_(),Ae=!g,je=', 'De=_(),Ae=!0,je='),
         ('ut=Ae&&(De||!1),dt=', 'ut=!0,dt='),
         ('remoteControlConnectionsAuthRequired:Je,showRemoteControlConnectionsSection:De}', 'remoteControlConnectionsAuthRequired:Je,showRemoteControlConnectionsSection:!0}'),
         ('showControlThisMacTab:lt,showRemoteControlConnectionsSection:De,', 'showControlThisMacTab:lt,showRemoteControlConnectionsSection:!0,')]},
}

def installed():
    with Path('/usr/lib/chatgpt/resources/app.asar').open('rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    if digest not in BUILDS:
        raise SystemExit('Unsupported ASAR SHA256: ' + digest + '. Re-audit before patching.')
    return digest, BUILDS[digest]
