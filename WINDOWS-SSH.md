# Windows SSH adapter

Unofficial, opt-in transport for the Linux ChatGPT-Remote copy. Supported baseline:
ChatGPT 26.901.41600. Windows integration was tested with Codex CLI 0.153.1 on
September 6, 2026. Desktop GUI integration still needs validation after installation.

## Build and configure

```bash
python3 one-shot.py --windows-ssh --fetch-deps
python3 scripts/configure-windows-ssh.py windows-workstation --enable-projects
```

Replace `windows-workstation` with the exact SSH alias or destination you will add
under Settings > Connections > SSH. For a discovered connection, use the displayed
SSH alias exactly: an alias and a user-qualified destination are separate keys,
even when SSH resolves them to the same machine. Fully restart the app after
changing transport selection because an existing connection can retain its old
transport instance. Configure SSH key authentication and verify
the host key through your normal SSH setup first. The adapter uses batch mode and
strict host-key checking. It does not handle password prompts.

Close ChatGPT-Remote and install the generated package with the printed command.
Restart the app, add the same SSH destination, then create a remote project from
the local app's Projects menu. Windows selection is configured with this script;
an OS dropdown has not been added to the connection dialog.

The helper writes `windows-ssh-hosts.json` inside the isolated Codex home.
`--enable-projects` sets the existing local `features.remote_connections` option
and preserves the first previous config as `config.toml.before-windows-ssh`.
The reviewed renderer reads this option in both `fPr` and `YAi`; the project
creation action also requires the local controller context. Server authorization
and workspace administrative permissions remain unchanged. This creates a local
remote-project bookmark; it does not synchronize Windows Desktop project groups.

For a nonstandard CLI location, supply `--codex-path` with the remote executable
path. Otherwise the adapter checks `codex.exe` in PATH, then the user's
`LocalAppData/OpenAI/Codex/bin` installation tree.

To return one destination to the original transport:

```bash
python3 scripts/configure-windows-ssh.py windows-workstation --platform posix
```

The project visibility setting is separate and remains enabled. To reverse it,
remove only `remote_connections` from the isolated config's `[features]` table,
or restore the backup if no subsequent settings need to be retained.

## Implementation

`scripts/patch-windows-ssh.py` inserts one exact-match dispatch before `P5` selects
the Unix SSH transport in `main-C5K7o1Hr.js`. `src/windows-ssh.cjs` selects only
explicitly configured hosts and delegates to Desktop's existing `n.bn` stdio
transport from `src-VqXTPopo.js`. Existing Unix SSH hosts retain their original path.

The Windows command uses UTF-16LE encoded PowerShell with UTF-8 protocol streams:

```text
Linux Desktop -> OpenSSH -> Windows PowerShell -> codex app-server --stdio
```

The Windows user's existing CLI authentication and repository access apply.
No relay, Windows daemon service, Unix shell emulation, or additional network
listener is introduced. The existing Desktop transport owns JSONL framing,
backpressure, approval routing, and errors. The adapter permits reconnect and
never replays RPC requests. A session ends when its SSH process exits; conversation
history can be resumed through a fresh connection. Survival of an active turn
across a disconnect is not guaranteed.

## Validation

Unit tests cover argument quoting, host selection, unchanged local/Unix routing,
unsafe settings permissions, and delegation/reconnect behavior. Live protocol
tests cover initialization, Unicode file I/O, folder listing, command execution,
thread creation, streamed output, orderly reconnect, real approval acceptance,
turn interruption, abrupt disconnect followed by resume, and repository Git diff.

```bash
node --test test/windows-ssh.test.cjs
node scripts/test-windows-ssh.cjs windows-workstation
node scripts/test-windows-ssh-control.cjs windows-workstation
node scripts/test-windows-ssh-project.cjs windows-workstation
```

Live tests create temporary folders and test conversations on the selected host.
Conversation tests use the host's model access and consume usage. They archive
their test conversations and remove their own folders on normal completion.
Abrupt process termination can require manual cleanup of these test artifacts.
The approval test accepts only its harmless echo probe. Reports stay under ignored
`build/`; do not publish private logs or host settings.

Protocol tests do not establish that every Desktop screen works. After installing,
check connection creation, project selection, file preview/diff, approval display,
app restart, and unchanged Linux SSH operation. Recheck the bundle factory and
transport contract before supporting another official version.
