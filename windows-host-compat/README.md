# Windows SSH host compatibility

Unofficial Windows-side adapter for the official Desktop's SSH connection.
Desktop app files, native modules, feature gates, and authentication checks remain
unchanged. This SSH route is independent of Remote Control relay enrollment.

```text
Official Linux or Windows Desktop (with SSH exposed by the installed app)
  -> SSH with a dedicated key
  -> Windows compatibility launcher
  -> Git Bash bootstrap and codex wrapper
  -> native Windows Codex app-server / proxy
  -> private Windows Unix-domain socket
```

The adapter uses the native socket and raw HTTP/WebSocket stream. It does not
translate JSON-RPC messages, simulate a Linux Codex runtime, or start a public TCP
listener. The Windows user's existing Codex authentication and repository access
apply. The same Windows user privileges apply as with the existing SSH account.

## Requirements

- An existing working Windows OpenSSH login with trusted host keys.
- Git for Windows installed in the standard Program Files location.
- A real `python.exe` in the SSH environment's PATH.
- Windows Codex installed under the normal LocalAppData installation tree.
- The .NET Framework C# compiler shipped with Windows.

The connecting Windows PC needs Python 3.9+ and Windows OpenSSH Client. The
installer uses the running Python interpreter, prefers Windows' native
`System32/OpenSSH/ssh.exe` and `ssh-keygen.exe`, and falls back to PATH elsewhere.
It does not install Python or change PATH. If `py` is unavailable, use a real
`python.exe`; a Microsoft Store execution alias is not an installed interpreter.

The installer supports the default Windows OpenSSH authorized-key locations.
An administrator account needs access to the shared administrators key file.
Custom `AuthorizedKeysFile` or `ForceCommand` configurations need separate review.

## Install from Linux

```bash
python3 windows-host-compat/deploy.py user@windows-host
```

## Install from Windows

In PowerShell, after an ordinary SSH login already works and its host key has
been verified through the existing trusted workflow:

```powershell
git clone --branch windows-ssh-stdio --single-branch https://github.com/KikETs/codex-desktop-linux-remote.git
Set-Location codex-desktop-linux-remote
py -3 windows-host-compat/deploy.py user@windows-host --check
py -3 windows-host-compat/deploy.py user@windows-host
ssh -T windows-codex-compat 'codex --version'
```

`--check` only inventories the remote adapter, its source hashes, dependencies,
Codex version, and presence of a server record. It creates no keys or files.
`--prepare-key` creates/verifies only the local dedicated key. Every connecting
PC generates its own key; do not copy a Linux or another Windows PC's private key.

The default local paths are `%USERPROFILE%/.ssh/config` and
`%USERPROFILE%/.ssh/codex_windows_compat_ed25519`. Arguments go directly to
`subprocess` without a command shell. PowerShell scripts use UTF-16LE
`-EncodedCommand`; payload files and generated config are UTF-8 without BOM.
Archive creation normalizes line endings to LF, including with Git `autocrlf`.
IdentityFile is quoted and uses forward slashes, including paths with spaces or
Korean characters. SSH expansion/quote characters in key paths are rejected.
An existing BOM-prefixed SSH config is rejected without modification: back it up
and save it as UTF-8 without BOM before retrying.

On Windows the private key and config backup receive a current-user-only DACL.
New config files receive the same DACL; existing config ACLs and bytes are
preserved. The installer never replaces an existing/incomplete key pair. An
existing alias must match host, user, port, dedicated key, and strict
authentication options, or deployment stops before remote changes. Includes and
wildcards are resolved with `ssh -G`; ProxyJump/ProxyCommand configurations need
separate review and are rejected by this simple installer.

An existing adapter is inventoried first. Launcher, manager and shell files must
match before reuse; differing core files stop deployment before writes. Matching
core files and the recorded server are retained. Only management scripts are
updated with backups, and the new public key is registered under `state/clients`.
The original `client.pub`, previous authorized keys, key-file ACLs, SSH service,
and default shell remain in place. No active server is terminated during install.
Custom installations or offline core updates require separate review.

The installer creates a dedicated Ed25519 key and the local SSH alias
`windows-codex-compat`. The private key stays in the local user's `.ssh` directory.
On the remote Windows PC it installs under `%LOCALAPPDATA%/CodexSshCompat`, protects that directory
with a current-user-only DACL, and appends a forced-command entry for this key.
Existing key entries and their file permissions are retained. Backups of the
authorized-key file are private files inside the installation's `state` directory.
The new key disables PTY and agent forwarding but permits the SSH reverse forwards
used by Desktop tools. It authenticates normally as the existing Windows user.

The SSH service and system-wide default shell remain unchanged. Other SSH keys
keep their existing behavior. No Desktop app restart or package rebuild is part
of this installation. Close compatibility connections before an update that
changes the launcher executable.

In the **official** Desktop, add an SSH connection with this exact host value:

```text
windows-codex-compat
```

Entering the original IP or `user@host` uses the original key and shell instead.
The alias selects the compatibility entry. Existing remote project bookmarks are
not migrated automatically; add or select a project on the new connection.

For another alias or dedicated key path:

```bash
python3 windows-host-compat/deploy.py user@windows-host --alias windows-work --key ~/.ssh/codex_windows_work
```

## Implementation

- `launcher.cs` receives `SSH_ORIGINAL_COMMAND` from the dedicated key entry and
  passes it directly to Git Bash with inherited binary stdin/stdout handles.
- `env.sh` and `bin/login-sh` preserve the compatibility PATH through Desktop's
  nested shell bootstrap without changing the user's regular shell profiles.
- `bin/codex` and `manager.py` adapt `app-server --listen unix://` and
  `app-server proxy` to an explicit private socket. Native Codex still handles
  protocol framing, authentication, approvals, task execution, and streaming.
- The server starts detached from the SSH session. A lock prevents duplicate
  starts. PID creation-time checks restrict cleanup to this installation's server.
  Existing Desktop or CLI processes are not selected by name or killed.
- `bin/awk` translates only Desktop's exact `/proc/net/tcp` listener query to the
  Windows TCP table API. It checks real listening addresses and ports, retaining
  the loopback-only check. Other awk commands use Git's real awk.

The server is shared by compatibility connections for this installation. It
survives SSH disconnects, but reboot persistence and automatic Windows startup
are outside this implementation. A fresh connection starts it again as needed.
CLI or Desktop command-interface changes may require adapter updates; compatibility
with every future version is not guaranteed.

## Verification

```bash
python3 windows-host-compat/test_manager.py
python3 windows-host-compat/test_deploy.py
python3 windows-host-compat/extract-test-wrapper.py
node windows-host-compat/test-live.cjs windows-codex-compat build/windows-host-compat/official-shell-wrapper.cjs
```

The live test uses a small shell-command builder extracted from the installed
official ASAR and stores it only under ignored `build/`. It does not modify the
ASAR or launch a patched client. It checks a real SSH reverse-forward listener,
WebSocket initialization, remote thread listing, Unicode file I/O, native command
execution, and reconnect. It creates and removes an isolated temporary folder;
it does not submit a model turn. Unit tests cover listener verification, stale
process identity, cleanup restrictions, and original argument preservation.

On October 24, 2026, the seven live checks and six unit tests passed with official
Linux Desktop `26.1021.22027` and Windows Codex `0.163.0-alpha.11.2`. The user
confirmed the official Desktop displayed a connected state. Its unmodified main
process logged successful path/version/bootstrap probes, WebSocket negotiation,
and `initialize_handshake_result outcome=success`. The official ASAR digest was
`7000813d30255e75d99b457e440f896a8e86f2ec6f313e237d52c21880ecdcde`.

This establishes that connection path and the listed operations. Full model-task,
approval UI, Desktop-tool invocation, reboot, and long-duration behavior still
need separate validation. Logs and host-specific records remain under ignored
`build/` or on the Windows host.

### Windows client verification

On Windows, extract the small wrapper from the **installed** official archive
using its actual path (the package version is intentionally not hard-coded):

```powershell
$package = Get-AppxPackage OpenAI.Codex
$asar = Join-Path $package.InstallLocation 'app/resources/app.asar'
py -3 windows-host-compat/test_manager.py
py -3 windows-host-compat/test_deploy.py
py -3 windows-host-compat/extract-test-wrapper.py --asar $asar
node windows-host-compat/test-live.cjs windows-codex-compat build/windows-host-compat/official-shell-wrapper.cjs
```

The live test requires Node.js with the built-in WebSocket client (Node 22+).
The archive is opened read-only; the extracted test fragment lives under ignored
`build/`. No official files are patched, replaced, resigned, or repackaged.

On October 24, 2026, all seven live checks passed from Windows OpenSSH 9.5p2
using the wrapper extracted from official Windows app package `26.1021.3705.0`,
against Windows Codex `0.163.0-alpha.11.2`. Six manager tests and eight deployment
tests also passed. Deployment tests run real key generation, DACL application,
and `ssh -G` using a temporary path with Korean characters and spaces.
The removal test runs only in an isolated temporary directory and checks key
selection, unchanged bytes/ACLs for other keys, and preservation of the shared
server by default. Alias collisions are checked before remote or key changes.
Dedicated public-key authentication and preservation of the pre-existing authorized-key
bytes were separately confirmed.

The user then added `windows-codex-compat` through the official Windows app's
normal Connections UI and reported a connected state. In the same unmodified
app session, the alias's shell probes and proxy startup were followed by
`initialize_handshake_result outcome=success transportKind=websocket` and the
managed SSH connection's transition to `connected` at 21:39:45 Asia/Seoul on
October 24, 2026. This independently establishes the Windows Desktop connection;
it is not inferred from the Linux result or the terminal verifier. The GUI was
operated by the user; the agent checked the local app logs read-only.

Full model turns, approval UI, Desktop tools, reboot recovery, and long-running
sessions on this Windows-to-Windows route remain unverified. Future app versions
have not been tested. Host addresses, personal paths, keys, and raw logs are not
included in the repository.

For the GUI check, open **Settings > Connections**, add an SSH host, enter exactly
`windows-codex-compat`, and connect. Confirm a connected state and correlate the
alias's bootstrap/WebSocket events with `initialize_handshake_result
outcome=success` in that app session's logs. Other hosts' or local stdio handshake
successes are not evidence for this connection. If the installed app exposes no
SSH UI or rejects the client transport, report that stage; never enable hidden
flags or patch the app. This configuration needs no per-app-update repackaging,
but a future change to SSH bootstrap or CLI arguments can require an adapter fix.

## Remove

First close projects using this client's compatibility connection and remove its
connection in Desktop. Revoke **only this PC's key** through the original SSH
login, never through `windows-codex-compat`. From the connecting PC:

```powershell
$public = (Get-Content -Raw "$env:USERPROFILE/.ssh/codex_windows_compat_ed25519.pub").Trim()
if ($public -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ codex-windows-ssh-compat$') { throw 'Unexpected key' }
$script = '& "$env:LOCALAPPDATA\CodexSshCompat\uninstall.ps1" -PublicKey ' + "'" + $public + "'"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes user@windows-host powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded
```

Omitting `-PublicKey` selects the legacy `client.pub`, which may belong to a Linux
client: do not omit it when removing a newer Windows client. The shared server
continues running. Only after **all** compatibility clients have disconnected and
no tasks depend on it, an explicit `-StopServer` can stop the recorded adapter
server with PID/creation-time validation. It never selects unrelated Codex
processes by name.

Locally, remove only the `Host windows-codex-compat` block from `.ssh/config`, then
delete its dedicated private/public key files if no longer needed. Keep other
blocks, includes, keys, and config ACLs. `config.before-codex-compat-*` is a private
byte-for-byte backup; restore the entire backup only if no subsequent edits need
preserving. Remote management-script and authorized-key backups are inside the
private `state` directory. Do not restore an entire authorized-key backup over
keys added later; revoke the selected entry instead. Keep the remote adapter
folder while any other client still uses it. Removing a Desktop connection alone
does not revoke the key. No SSH service restart or default-shell rollback is
needed because installation changes neither setting.
