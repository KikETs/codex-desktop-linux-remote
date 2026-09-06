'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {buildCommand, createTransport, readSettings, selectHost} = require('../src/windows-ssh.cjs');
test('Windows SSH command quotes Unicode and shell-sensitive paths without interpolation', () => {
  const command = buildCommand({sshHost: 'user@host', sshPort: 2222},
    {codexPath: "C:\\Program Files\\Test' $()\\codex.exe"});
  assert.equal(command[0], 'ssh');
  assert(command.includes('StrictHostKeyChecking=yes'));
  const script = Buffer.from(command.at(-1), 'base64').toString('utf16le');
  assert(script.includes("$codex='C:\\Program Files\\Test'' $()\\codex.exe'"));
  assert(script.includes('app-server --stdio'));
  assert(!script.includes('pkill'));
  assert.throws(() => buildCommand({sshHost: '-oProxyCommand=anything'}), /dash/);
  assert.throws(() => buildCommand({sshHost: 'host\nother'}), /Invalid/);
  assert.throws(() => buildCommand({sshHost: 'host', sshPort: 65536}), /port/);
});
test('Only explicitly selected SSH destinations use Windows; local and Unix connections remain unchanged', () => {
  const config = {id:'ssh:test',kind:'ssh',ssh_websocket_v0:{sshAlias:'work',sshHost:'host'}};
  const settings = {hosts:{work:{platform:'windows'}}};
  assert.equal(selectHost(config, settings).settings.platform, 'windows');
  assert.equal(selectHost({...config,kind:'local'}, settings), null);
  assert.equal(selectHost(config, {hosts:{other:{platform:'windows'}}}), null);
  assert.equal(selectHost(config, {hosts:{work:{platform:'posix'}}}), null);
});
test('Desktop adapter delegates the protocol unchanged and permits reconnect without replay', async () => {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'windows-ssh-test-'));
  const old=process.env.CODEX_HOME;
  try {
    fs.writeFileSync(path.join(tmp,'windows-ssh-hosts.json'),JSON.stringify({version:1,hosts:{host:{platform:'windows'}}}),{mode:0o600});
    process.env.CODEX_HOME=tmp;
    let created, calls=0;
    class Fake {constructor(o){created=o} async connect(){calls++;return {connection:calls}} getIoStatsSnapshot(){return {writes:0}}}
    const transport=createTransport({hostConfig:{id:'test',kind:'ssh',ssh_websocket_v0:{sshHost:'host'}}},Fake);
    assert.equal(created.hostConfig.kind,'ssh');
    assert.equal(created.hostConfig.codex_cli_command[0],'ssh');
    assert(transport.supportsReconnect());
    assert.deepEqual(await transport.connect(),{connection:1});
    assert.deepEqual(await transport.connect(),{connection:2});
    assert.deepEqual(transport.getIoStatsSnapshot(),{writes:0});
    assert.equal(createTransport({hostConfig:{kind:'local'}},Fake),null);
    fs.chmodSync(path.join(tmp,'windows-ssh-hosts.json'),0o666);
    assert.throws(()=>readSettings(tmp),/Unsafe/);
  } finally {
    if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;
    fs.rmSync(tmp,{recursive:true,force:true});
  }
});
test('Original sh transport runs first; only failed initialization falls back to confirmed Windows', async () => {
  const order=[];
  const original={kind:'websocket',supportsReconnect:()=>true,connect:async()=>{order.push('sh');throw Error('sh unavailable')}};
  class Windows {kind='stdio';async connect(){order.push('windows');return 'connected'}}
  const transport=createTransport({hostConfig:{kind:'ssh',ssh_websocket_v0:{sshHost:'automatic-test.invalid'}}},Windows,()=>original,async()=>{order.push('detect');return 'windows'});
  assert.equal(await transport.connect(),'connected');
  assert.deepEqual(order,['sh','detect','windows']);
  await transport.connect();
  assert.deepEqual(order,['sh','detect','windows','windows']);
});
test('Successful sh skips detection; Unix and uncertain failures preserve the original error', async () => {
  const options={hostConfig:{kind:'ssh',ssh_websocket_v0:{sshHost:'automatic-test.invalid'}}};
  const error=Error('original failure');
  const original={kind:'websocket',supportsReconnect:()=>true,connect:async()=>42};
  const t=createTransport(options,class{},()=>original,async()=>{throw Error('should not probe')});
  assert.equal(await t.connect(),42);
  original.connect=async()=>{throw error};
  for(const detect of [async()=> 'posix',async()=>{throw Error('authentication failed')}]){
    const t=createTransport(options,class{},()=>original,detect);
    await assert.rejects(t.connect(),e=>e===error);
  }
});
test('OS probe requires a successful positive response and preserves SSH verification', async () => {
  const {detectPlatform}=require('../src/windows-ssh.cjs');
  assert.equal(await detectPlatform({sshHost:'test'},async command=>{
    assert(command.includes('StrictHostKeyChecking=yes'));
    return {ok:true,stdout:'CODEX_SSH_WINDOWS_V1\r\n'};
  }),'windows');
  let calls=0;
  assert.equal(await detectPlatform({sshHost:'test'},async()=>++calls===1?{ok:false,stdout:''}:{ok:true,stdout:'Darwin\n'}),'posix');
  await assert.rejects(detectPlatform({sshHost:'test'},async()=>({ok:false,stdout:'CODEX_SSH_WINDOWS_V1'})),/detection failed/);
});
