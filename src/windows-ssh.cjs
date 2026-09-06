'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');

function text(value, name) {
  if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value))
    throw new Error(`Invalid ${name}`);
  return value;
}
function psLiteral(value) { return "'" + text(value, 'PowerShell literal').replaceAll("'", "''") + "'"; }
function buildCommand(connection, settings = {}) {
  const target = text(connection.sshAlias || connection.sshHost, 'SSH destination');
  if (target.startsWith('-')) throw new Error('SSH destination cannot start with a dash');
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'];
  if (connection.sshPort != null) {
    const port = Number(connection.sshPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
    args.push('-p', String(port));
  }
  if (connection.identity) args.push('-i', text(connection.identity, 'SSH identity path'));
  // OpenSSH authenticates the host and user; no shell payload contains unquoted user data.
  const configured = settings.codexPath == null ? '$null' : psLiteral(settings.codexPath);
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);
$OutputEncoding=[Console]::OutputEncoding;
$codex=${configured};
if (!$codex) {
  $found=Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1;
  if ($found) { $codex=$found.Source }
}
if (!$codex) {
  $found=Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\\Codex\\bin') -Filter codex.exe -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1;
  if ($found) { $codex=$found.FullName }
}
if (!$codex -or !(Test-Path -LiteralPath $codex -PathType Leaf)) { throw 'Windows Codex CLI not found; configure codexPath or install Codex on this host.' }
Set-Location -LiteralPath $env:USERPROFILE;
& $codex -c features.code_mode_host=true app-server --stdio;
exit $LASTEXITCODE;`;
  args.push('--', target, 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'));
  return ['ssh', ...args];
}
function readSettings(codexHome = process.env.CODEX_HOME) {
  if (!codexHome) return {hosts: {}};
  const file = path.join(codexHome, 'windows-ssh-hosts.json');
  let stat;
  try { stat = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return {hosts: {}}; throw e; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536 ||
      (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o022))))
    throw new Error('Unsafe windows-ssh-hosts.json ownership, permissions, or size');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (settings.version !== 1 || !settings.hosts || typeof settings.hosts !== 'object' || Array.isArray(settings.hosts))
    throw new Error('Invalid Windows SSH settings format');
  return settings;
}
function selectHost(hostConfig, settings) {
  if (hostConfig.kind !== 'ssh') return null;
  const connection = hostConfig.ssh_websocket_v0;
  if (!connection) return null;
  for (const key of [hostConfig.id, connection.sshAlias, connection.sshHost]) {
    if (!key || !Object.hasOwn(settings.hosts, key)) continue;
    const value = settings.hosts[key];
    if (value?.platform === 'posix') return null;
    if (value?.platform !== 'windows') throw new Error('Unsupported SSH platform setting');
    return {connection, settings: value};
  }
  return null;
}
function probe(command) {
  return new Promise(resolve => execFile(command[0], command.slice(1),
    {timeout: 15000, maxBuffer: 65536, encoding: 'utf8'},
    (error, stdout) => resolve({ok: !error, stdout: stdout || ''})));
}
async function detectPlatform(connection, run = probe) {
  const command = buildCommand(connection);
  const prefix = command.slice(0, command.indexOf('--') + 2);
  const script = "if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { [Console]::WriteLine('CODEX_SSH_WINDOWS_V1') } else { exit 2 }";
  const windows = await run([...prefix, 'powershell.exe', '-NoLogo', '-NoProfile',
    '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  if (windows.ok && windows.stdout.trim() === 'CODEX_SSH_WINDOWS_V1') return 'windows';
  const unix = await run([...prefix, 'uname', '-s']);
  if (unix.ok && /^(Linux|Darwin|FreeBSD|OpenBSD|NetBSD)$/.test(unix.stdout.trim())) return 'posix';
  throw new Error('SSH OS detection failed. Verify SSH authentication and the remote shell, or explicitly configure windows/posix.');
}
function configuredPlatform(hostConfig, settings) {
  const c = hostConfig.ssh_websocket_v0;
  for (const key of [hostConfig.id, c?.sshAlias, c?.sshHost]) {
    if (key && Object.hasOwn(settings.hosts, key)) return settings.hosts[key]?.platform;
  }
  return null;
}
function windowsDelegate(options, StdioTransport, selected) {
  return new StdioTransport({...options, hostConfig: {...options.hostConfig,
    codex_cli_command: buildCommand(selected.connection, selected.settings)}});
}
function createTransport(options, StdioTransport, originalFactory, detect = detectPlatform) {
  if (options.hostConfig.kind !== 'ssh' || !options.hostConfig.ssh_websocket_v0) return null;
  const settings = readSettings();
  const selected = selectHost(options.hostConfig, settings);
  if (configuredPlatform(options.hostConfig, settings) === 'posix') return null;
  let platform = selected ? 'windows' : 'posix';
  let delegate = selected ? windowsDelegate(options, StdioTransport, selected) : originalFactory?.();
  if (!delegate) return null;
  let fallbackAllowed = !selected;
  // Keep the original sh bootstrap first. Only initial connection failures can fall back.
  // RPC errors after connect never trigger transport replacement or request replay.
  return {
    get kind() { return delegate.kind || 'stdio'; },
    supportsReconnect: () => platform === 'windows' ? true : delegate.supportsReconnect(),
    async connect() {
      try { return await delegate.connect(); }
      catch (originalError) {
        if (!fallbackAllowed) throw originalError;
        let detected;
        try { detected = await detect(options.hostConfig.ssh_websocket_v0); }
        catch { throw originalError; }
        // macOS and Linux already use the original sh transport. Preserve its error.
        if (detected !== 'windows') throw originalError;
        platform = 'windows';
        fallbackAllowed = false;
        delegate = windowsDelegate(options, StdioTransport,
          {connection: options.hostConfig.ssh_websocket_v0, settings: {}});
        return delegate.connect();
      }
    },
    getIoStatsSnapshot: () => delegate.getIoStatsSnapshot?.(),
  };
}

module.exports = {buildCommand, createTransport, readSettings, selectHost, detectPlatform};
