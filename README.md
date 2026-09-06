# ChatGPT-Remote for Linux

Unofficial Linux Remote Controller build based on the installed ChatGPT app.
It uses a separate installation and login profile.

Current baseline: **ChatGPT `26.901.41600` → `chatgpt-remote 26.901.41600+remote.5`**.
Build and simulator checks were completed on September 6, 2026. See the validation
section for the limits of that testing.

```bash
git clone https://github.com/KikETs/codex-desktop-linux-remote.git
cd codex-desktop-linux-remote
```

## Build after an official app update

Run from the repository directory as your regular desktop user:

```bash
python3 one-shot.py --check
python3 one-shot.py --fetch-deps --install
```

`--fetch-deps` downloads TPM headers and the swtpm test dependencies from the
Ubuntu repositories and extracts them into the build workspace. It does not
install those packages system-wide. Omit `--install` to build without installing.
Only the installation step invokes sudo.

If ChatGPT-Remote is running, the script finishes the build and stops before
installation. Close the app, then install the generated package using the path
printed by the script. The script does not update the official ChatGPT app.

Supported environment: Ubuntu 24.04 amd64 and the reviewed ASAR hashes for official
versions `26.901.20858` and `26.901.41600`. Unknown versions or hashes are rejected
without modifying the original app. See [UPDATING.md](UPDATING.md) before adding
support for another release. Compatibility with every future release is not guaranteed.

## Prerequisites

Python 3.11 or newer, Node.js 22 or newer, g++, APT/dpkg, the AppArmor parser,
`desktop-file-utils`, and the TSS2 runtime libraries are required.
If your distribution supplies an older Node.js version, install Node.js 22 or newer
separately before building.

```bash
sudo apt install g++ apparmor desktop-file-utils libtss2-dev
```

A TPM 2.0 resource-manager device at `/dev/tpmrm0` is required. There is no software
private-key fallback. To retain TPM access across reboots, run this once:

```bash
bash scripts/enable-tpm-access.sh
# Log out and log back in afterward.
```

This adds the current user to the `tss` group, granting TPM device access to that
user's processes. It does not clear or initialize the TPM, change ownership, or
create NV entries or persistent handles. The build and installation commands do
not change TPM access permissions automatically.

## Changes included

- Add a Linux TPM P-256 backend for key creation, signing, and reloading.
- Force the Controller tab's display conditions on. Server gate values and
  authorization checks remain unchanged.
- Give the post-authorization success page a dedicated `chatgpt-remote://` return
  handler. Preserve the OAuth localhost callback, state and PKCE checks, and the
  existing `codex://` handler.
- Use package and command name `chatgpt-remote`, installation directory
  `/opt/chatgpt-remote`, and window class `ChatGPT-Remote`.
- Isolate app settings and keys under `~/.config/ChatGPT-Remote/config/Codex`, and
  CLI data under `~/.config/ChatGPT-Remote/codex`. Existing tokens and profiles are
  not copied. These locations follow the user's XDG configuration when set.
- Forward the IBus address and let the isolated profile reference the desktop
  session's IBus address files. Actual Korean text composition still needs testing
  in the user's environment.
- Include a dedicated AppArmor user-namespace rule for the copied executable.
  The Chromium sandbox remains enabled.

Some internal product labels retain the original name. Synchronizing the host's
project list and exposing the remote project selection UI remain unresolved.
Displaying a button does not grant server access.

## Validation and output

Each run creates a fresh workspace under `build/runs/`, preserving previous results.
Checks cover the original and native-module hashes, the exact patch scope, ASAR
contents, JavaScript syntax, seven swtpm tests including the actual Desktop key
wrapper, and an APT installation simulation. Each run records its output path and
hashes in `result.json`.

On September 6, 2026, the full `26.901.41600+remote.5` build, seven tests, and
installation simulation passed. That build was not installed during validation;
its GUI and live remote behavior remain unverified. Authorization, TPM signing,
and remote connection logs were previously observed with
`26.901.20858+remote.3`.

## Repository contents and paths

This repository contains build scripts, the custom key helper, and tests only.
`build/`, `vendor/`, `profile/`, logs, `.deb` files, `.asar` files, and key files are
excluded. Official binaries are not published as GitHub release assets; users
build locally from their own installation.

No personal home-directory or checkout paths are required. Workspace paths are
resolved from the script location, and user paths are derived from the current
user's home directory or XDG settings. Absolute system paths are intentional:

| Path | Purpose |
| --- | --- |
| `/usr/lib/chatgpt` | Supported official Ubuntu package layout |
| `/opt/chatgpt-remote` | Separate development installation |
| `/usr/bin`, `/bin` | System interpreters, launchers, and restricted subprocess PATH |
| `/etc/apparmor.d/chatgpt-remote` | Dedicated AppArmor profile |
| `/sys/kernel/security/apparmor` | Check whether AppArmor is available |
| `/dev/tpmrm0` | TPM resource-manager device |
| `/proc` | Detect a running development app before installation |
| `/dev/null` | Discard command output |

The tests also use the synthetic `/development-resources` path to validate key
provider routing. It is not a path on the developer's machine.

Repository: https://github.com/KikETs/codex-desktop-linux-remote

## Uninstall

```bash
sudo apt purge chatgpt-remote
```

User profiles are preserved. Earlier manual setups may also leave a user desktop
entry override or `~/.local/bin/chatgpt-remote-ime` launcher.
To revoke TPM group access, run the following and log out and back in:

```bash
sudo gpasswd -d "$(id -un)" tss
```
