param([string]$PublicKey, [switch]$StopServer)
$ErrorActionPreference = 'Stop'
# Run through the original SSH connection or a local PowerShell, not the dedicated key.
$root = Join-Path $env:LOCALAPPDATA 'CodexSshCompat'
$text = if ($PublicKey) { $PublicKey.Trim() } else { [IO.File]::ReadAllText((Join-Path $root 'client.pub')).Trim() }
if ($text -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ codex-windows-ssh-compat$') { throw 'Unexpected dedicated public key' }
$pub = $text.Split(' ')[1]
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$keys = if ($isAdmin) { Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' } else { Join-Path $env:USERPROFILE '.ssh\authorized_keys' }
$bytes = [IO.File]::ReadAllBytes($keys)
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$before = $utf8.GetString($bytes)
$remaining = [Text.StringBuilder]::new()
foreach ($match in [regex]::Matches($before, '[^\r\n]*(?:\r\n|\n|\r|$)')) {
    $line = $match.Value.TrimEnd("`r", "`n")
    if (!($line.StartsWith('command=') -and $line.Contains('compat-shell.exe') -and $line.Contains(' '+$pub+' ') -and $line.EndsWith(' codex-windows-ssh-compat'))) {
        [void]$remaining.Append($match.Value)
    }
}
[IO.File]::WriteAllBytes($keys, $utf8.GetBytes($remaining.ToString()))
if ($StopServer) {
$python = [IO.File]::ReadAllText((Join-Path $root 'python-path.txt')).Trim()
if ($python -match '^/([a-z])/(.*)$') { $python = $Matches[1].ToUpperInvariant() + ':\' + $Matches[2].Replace('/','\') }
& $python (Join-Path $root 'manager.py') pkill -f 'codex.* app-server.* --listen'
if ($LASTEXITCODE -notin @(0,1)) { throw 'Could not stop the compatibility-owned server' }
}
Write-Output 'Selected dedicated key revoked. Shared server preserved unless -StopServer was explicitly supplied. Keep the installation while other clients use it.'
