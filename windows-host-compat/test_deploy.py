"""Regression checks for the Windows deployment boundary; never contact a host."""
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile

import deploy


class DeploymentTests(unittest.TestCase):
    def test_payload_is_bom_free_utf8_with_lf_shell_scripts(self):
        with zipfile.ZipFile(io.BytesIO(deploy.archive_payload('ssh-ed25519 AAAA test\n'))) as archive:
            for name in archive.namelist():
                raw = archive.read(name)
                self.assertFalse(raw.startswith(b'\xef\xbb\xbf'))
                self.assertNotIn(b'\r\n', raw)
                raw.decode('utf-8')

    def test_identity_rejects_expansions_and_uses_forward_slashes(self):
        self.assertEqual(deploy.identity_path(Path('한글 space/key')), '"한글 space/key"')
        for value in ('bad%key', 'bad$key', 'bad"key', 'bad\nkey'):
            with self.assertRaises(RuntimeError):
                deploy.identity_path(Path(value))

    def test_alias_rejects_jump_hosts_and_injected_fields(self):
        values = {'hostname': 'example.invalid', 'user': 'remote', 'port': '22'}
        block = deploy.alias_block('compat', values, Path('space key'))
        self.assertIn('StrictHostKeyChecking yes', block)
        self.assertIn('IdentityFile "space key"', block)
        for extra in ({'proxyjump': 'jump'}, {'user': 'bad\nHost *'}):
            with self.assertRaises(RuntimeError):
                deploy.alias_block('compat', values | extra, Path('key'))

    def test_encoded_powershell_preserves_unicode_and_quotes(self):
        import base64
        script = "Write-Output '한글 space \"quote\" $literal'"
        self.assertEqual(base64.b64decode(deploy.powershell(script)[-1]).decode('utf-16le'), script)

    def test_real_keygen_and_openssh_config_with_unicode_space_path(self):
        with tempfile.TemporaryDirectory(prefix='compat-한글 space-') as folder:
            key = Path(folder) / '전용 key'
            first = deploy.ensure_key(key)
            self.assertEqual(deploy.ensure_key(key), first)
            config = Path(folder) / 'config'
            config.write_text(deploy.alias_block('compat-test',
                {'hostname': 'example.invalid', 'user': 'remote', 'port': '22'}, key), encoding='utf-8')
            result = subprocess.check_output([deploy.executable('ssh'), '-F', str(config), '-G', 'compat-test'])
            self.assertIn('identityfile ' + key.as_posix(), result.decode('utf-8'))
            if os.name == 'nt':
                script = "$a=[IO.File]::GetAccessControl('" + str(key).replace("'", "''") + "'); " + \
                    "if(!$a.AreAccessRulesProtected -or @($a.Access).Count -ne 1){exit 1}"
                subprocess.run(deploy.powershell(script), check=True, capture_output=True)

    def test_partial_key_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            key = Path(folder) / 'existing'
            key.write_bytes(b'preserve')
            with self.assertRaises(RuntimeError):
                deploy.ensure_key(key)
            self.assertEqual(key.read_bytes(), b'preserve')

    def test_alias_collision_stops_before_remote_or_key_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.object(deploy.Path, 'home', return_value=Path(folder)), \
                    mock.patch.object(deploy.sys, 'argv', ['deploy.py', 'original', '--key', str(Path(folder)/'key')]), \
                    mock.patch.object(deploy, 'effective', side_effect=[
                        {'hostname': 'target.invalid', 'user': 'remote', 'port': '22'},
                        {'hostname': 'other.invalid', 'user': 'remote', 'port': '22'}]), \
                    mock.patch.object(deploy, 'ensure_key') as keygen, \
                    mock.patch.object(deploy.subprocess, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'resolves differently'):
                    deploy.main()
                keygen.assert_not_called()
                run.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows PowerShell integration')
    def test_uninstall_only_revokes_selected_key_and_preserves_other_bytes_acl(self):
        import base64
        with tempfile.TemporaryDirectory(prefix='compat-remove-') as folder:
            base = Path(folder)
            root = base / 'CodexSshCompat'
            root.mkdir()
            public = 'ssh-ed25519 BBBB codex-windows-ssh-compat'
            selected = 'command="C:/compat-shell.exe",no-pty ' + public + '\r\n'
            retained = b'\xef\xbb\xbf# existing mixed endings\r\nssh-ed25519 AAAA legacy\n# preserve\r\n'
            contents = retained + selected.encode('ascii')
            keyfiles = [base/'ssh/administrators_authorized_keys', base/'.ssh/authorized_keys']
            for keyfile in keyfiles:
                keyfile.parent.mkdir()
                keyfile.write_bytes(contents)
            encoded = base64.b64encode(str(base).encode('utf-8')).decode('ascii')
            source = base64.b64encode(str(deploy.ROOT/'uninstall.ps1').encode('utf-8')).decode('ascii')
            script = r'''
$ErrorActionPreference='Stop'
$base=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('BASE'))
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('SOURCE'))
$env:LOCALAPPDATA=$base;$env:ProgramData=$base;$env:USERPROFILE=$base
$paths=@((Join-Path $base 'ssh\administrators_authorized_keys'),(Join-Path $base '.ssh\authorized_keys'))
$before=@($paths|ForEach-Object{[IO.File]::GetAccessControl($_).Sddl})
& ([scriptblock]::Create([IO.File]::ReadAllText($source))) -PublicKey 'ssh-ed25519 BBBB codex-windows-ssh-compat'
for($i=0;$i -lt 2;$i++){if([IO.File]::GetAccessControl($paths[$i]).Sddl -ne $before[$i]){throw 'ACL changed'}}
'''.replace('BASE', encoded).replace('SOURCE', source)
            subprocess.run(deploy.powershell(script), check=True, capture_output=True)
            actual = [keyfile.read_bytes() for keyfile in keyfiles]
            self.assertEqual(actual.count(retained), 1)
            self.assertEqual(actual.count(contents), 1)


if __name__ == '__main__':
    unittest.main()
