#!/usr/bin/env python3
"""Install the Remote icon for the current user without changing the app binary."""
import os
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
data = Path(os.environ.get('XDG_DATA_HOME', Path.home()/'.local/share'))
icon = data/'icons/hicolor/512x512/apps/chatgpt-remote.png'
icon.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root/'src/chatgpt-remote.png', icon)
entry = data/'applications/chatgpt-remote.desktop'
if not entry.exists():
    entry.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile('/usr/share/applications/chatgpt-remote.desktop', entry)
source = entry.read_text()
lines = source.splitlines()
lines = ['Icon='+str(icon) if line.startswith('Icon=') else line for line in lines]
entry.write_text('\n'.join(lines)+'\n')
subprocess.run(['desktop-file-validate', str(entry)], check=True)
if shutil.which('update-desktop-database'):
    subprocess.run(['update-desktop-database', str(entry.parent)], check=True)
print('Installed large red C icon. Restart Remote to refresh the running window icon.')
