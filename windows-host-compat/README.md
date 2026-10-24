# Windows SSH host compatibility

Unofficial Windows-side adapter for the official Linux Desktop's SSH connection.
Desktop app files, native modules, feature gates, and authentication checks remain
unchanged. This SSH route is independent of Remote Control relay enrollment.

```text
Official Linux Desktop
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

The installer supports the default Windows OpenSSH authorized-key locations.
An administrator account needs access to the shared administrators key file.
Custom `AuthorizedKeysFile` or `ForceCommand` configurations need separate review.

## Install from Linux

```bash
python3 windows-host-compat/deploy.py user@windows-host
```

The installer creates a dedicated Ed25519 key and the local SSH alias
`windows-codex-compat`. The private key stays in the local user's `.ssh` directory.
On Windows it installs under `%LOCALAPPDATA%/CodexSshCompat`, protects that directory
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

## Remove

First close projects using the compatibility connection. Through the original
SSH login or a local Windows PowerShell, run:

```powershell
& "$env:LOCALAPPDATA\CodexSshCompat\uninstall.ps1"
```

This revokes only the dedicated key entry and stops only the recorded compatibility
server. It preserves the original keys and shell configuration. After its SSH
sessions exit, remove `%LOCALAPPDATA%/CodexSshCompat`. On Linux, remove only the
corresponding `Host windows-codex-compat` block and its dedicated private/public
key files if they are no longer needed. Removing a connection in Desktop does not
revoke its SSH key automatically.
