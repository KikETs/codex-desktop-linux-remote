$ErrorActionPreference = 'Stop'
# Run through the original SSH connection or a local PowerShell, not the dedicated key.
$root = Join-Path $env:LOCALAPPDATA 'CodexSshCompat'
$pub = [IO.File]::ReadAllText((Join-Path $root 'client.pub')).Trim().Split(' ')[1]
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$keys = if ($isAdmin) { Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' } else { Join-Path $env:USERPROFILE '.ssh\authorized_keys' }
$lines = [IO.File]::ReadAllLines($keys)
$remaining = @($lines | Where-Object { !($_.Contains($pub) -and $_.EndsWith(' codex-windows-ssh-compat')) })
[IO.File]::WriteAllLines($keys, $remaining, [Text.UTF8Encoding]::new($false))
$python = [IO.File]::ReadAllText((Join-Path $root 'python-path.txt')).Trim()
if ($python -match '^/([a-z])/(.*)$') { $python = $Matches[1].ToUpperInvariant() + ':\' + $Matches[2].Replace('/','\') }
& $python (Join-Path $root 'manager.py') pkill -f 'codex.* app-server.* --listen'
if ($LASTEXITCODE -notin @(0,1)) { throw 'Could not stop the compatibility-owned server' }
Write-Output 'Dedicated key revoked and compatibility server stopped. Close its SSH sessions before removing the installation folder.'
