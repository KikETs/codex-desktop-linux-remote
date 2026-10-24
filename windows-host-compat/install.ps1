$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Join-Path $env:LOCALAPPDATA 'CodexSshCompat'
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
function Protect-Directory([string]$path) {
    [IO.Directory]::CreateDirectory($path) | Out-Null
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($path, $acl)
}
Protect-Directory $root
Protect-Directory (Join-Path $root 'state')
Protect-Directory (Join-Path $root 'socket')
$python = (Get-Command python.exe -CommandType Application | Select-Object -First 1).Source
if (!$python -or $python.Contains('\WindowsApps\')) { throw 'A real Python installation is required' }
$posixPython = '/' + $python.Substring(0,1).ToLowerInvariant() + $python.Substring(2).Replace('\','/')
[IO.File]::WriteAllText((Join-Path $root 'python-path.txt'), $posixPython + "`n", [Text.UTF8Encoding]::new($false))
$exe = Join-Path $root 'compat-shell.exe'
$hash = (Get-FileHash (Join-Path $root 'launcher.cs') -Algorithm SHA256).Hash
$stamp = Join-Path $root 'state\launcher.sha256'
if (!(Test-Path $exe) -or !(Test-Path $stamp) -or [IO.File]::ReadAllText($stamp).Trim() -ne $hash) {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$exe" (Join-Path $root 'launcher.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed; close compatibility SSH connections before updating its executable' }
    [IO.File]::WriteAllText($stamp, $hash)
}
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$keys = if ($isAdmin) { Join-Path $env:ProgramData 'ssh\administrators_authorized_keys' } else { Join-Path $env:USERPROFILE '.ssh\authorized_keys' }
if (!(Test-Path -LiteralPath $keys)) { throw 'Existing authorized_keys file required; configure normal SSH first' }
$pub = [IO.File]::ReadAllText((Join-Path $root 'client.pub')).Trim()
if ($pub -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+ codex-windows-ssh-compat$') { throw 'Unexpected dedicated public key' }
$before = [IO.File]::ReadAllText($keys)
if (!$before.Contains($pub.Split(' ')[1])) {
    $backup = Join-Path $root ('state\authorized_keys.before-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
    [IO.File]::Copy($keys, $backup, $false)
    $forced = '\"' + $exe.Replace('\','/') + '\"'
    $line = 'command="' + $forced + '",no-agent-forwarding,no-pty ' + $pub
    [IO.File]::AppendAllText($keys, "`n" + $line + "`n", [Text.UTF8Encoding]::new($false))
}
[PSCustomObject]@{root=$root; authorizedKeys=$keys; defaultShellChanged=$false; sshServiceRestarted=$false} | ConvertTo-Json -Compress
