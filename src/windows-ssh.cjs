'use strict';
const fs = require('node:fs');
const path = require('node:path');

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
function createTransport(options, StdioTransport) {
  const selected = selectHost(options.hostConfig, readSettings());
  if (!selected) return null;
  const command = buildCommand(selected.connection, selected.settings);
  const delegate = new StdioTransport({...options,
    hostConfig: {...options.hostConfig, codex_cli_command: command}});
  // Use Desktop's framing, backpressure, approval routing, and RPC error handling.
  // Reconnect creates a new SSH session; no RPC request is replayed by this adapter.
  return {
    kind: 'stdio', supportsReconnect: () => true,
    connect: () => delegate.connect(),
    getIoStatsSnapshot: () => delegate.getIoStatsSnapshot(),
  };
}
module.exports = {buildCommand, createTransport, readSettings, selectHost};
