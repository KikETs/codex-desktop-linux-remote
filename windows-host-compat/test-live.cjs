'use strict';
// Protocol verification through the installed Desktop's exact shell-command wrapper.
// This is not a claim that the Desktop GUI has connected.
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {EventEmitter, once} = require('node:events');
const host = process.argv[2];
if (!host || !process.argv[3]) throw Error('Usage: node test-live.cjs SSH_ALIAS EXTRACTED_OFFICIAL_WRAPPER');
const {wrap} = require(path.resolve(process.argv[3]));

class Client extends EventEmitter {
  async open() {
    this.id = 0; this.pending = new Map(); this.children = new Set(); this.sockets = new Set(); this.closing = false;
    this.server = net.createServer(socket => {
      this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket));
      const marker = crypto.randomBytes(8);
      const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ConnectTimeout=10', host, wrap('exec codex app-server proxy', marker)]);
      this.children.add(child); this.stderr = '';
      child.stderr.on('data', b => { this.stderr = (this.stderr + b).slice(-4000); });
      child.on('error', e => socket.destroy(e));
      child.on('exit', code => {this.children.delete(child); if(code && !this.closing) console.error('SSH proxy exit', code, this.stderr);socket.destroy();});
      child.stdin.on('error', () => socket.destroy());
      socket.on('error', () => child.kill());socket.on('close', () => child.kill());
      socket.pipe(child.stdin);
      let prefix = Buffer.alloc(0), ready = false;
      child.stdout.on('data', b => {
        if (!ready) {
          prefix = Buffer.concat([prefix, b]); if (prefix.length < marker.length) return;
          if (!prefix.subarray(0, 8).equals(marker)) { socket.destroy(Error('Invalid bootstrap marker')); return; }
          ready = true; b = prefix.subarray(8);
        }
        if (!socket.write(b)) child.stdout.pause();
      });
      socket.on('drain', () => child.stdout.resume());
    });
    this.server.listen(0, '127.0.0.1'); await once(this.server, 'listening');
    this.ws = new WebSocket(`ws://127.0.0.1:${this.server.address().port}/rpc`);
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.method) { this.emit('notification', m); return; }
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
    });
    await Promise.race([once(this.ws, 'open'), new Promise((_, reject) => {
      this.openTimer = setTimeout(() => reject(Error('WebSocket open timed out: ' + this.stderr)), 20000);
    })]); clearTimeout(this.openTimer);
    const result = await this.request('initialize', {clientInfo: {name: 'windows-host-compat-verifier', version: '0.1.0'}, capabilities: {experimentalApi: true}});
    this.ws.send(JSON.stringify({method: 'initialized'})); return result;
  }
  request(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Timeout: ' + method)); }, 20000);
      this.pending.set(id, {resolve, reject, timer}); this.ws.send(JSON.stringify({id, method, params}));
    });
  }
  async close() {
    this.closing = true;
    clearTimeout(this.openTimer);
    for (const p of this.pending.values()) {clearTimeout(p.timer);p.reject(Error('Client closed'));}
    this.pending.clear();this.ws?.close();
    for (const s of this.sockets) s.destroy();for (const c of this.children) c.kill();
    this.server?.close();
  }
}
(async () => {
  const results = []; let client = new Client(), folder;
  async function check(name, fn) {const t=Date.now();const r=await fn();results.push({name,passed:true,ms:Date.now()-t});console.log('PASS',name);return r;}
  try {
    await check('Desktop reverse-forward loopback validation', async () => {
      const server=net.createServer(s=>s.end());server.listen(0,'127.0.0.1');await once(server,'listening');
      const port=server.address().port, hex=port.toString(16).toUpperCase().padStart(4,'0');
      const query=`listeners=$(awk '$4 == "0A" && $2 ~ /:${hex}$/ {print $2}' /proc/net/tcp /proc/net/tcp6) || exit 1\n[ "$listeners" = '0100007F:${hex}' ] || exit 1`;
      try {await promisify(execFile)('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes',
        '-R',`127.0.0.1:${port}:127.0.0.1:${port}`,host,wrap(query)],{timeout:15000});}
      finally {server.close();}
    });
    const init = await check('Native Windows WebSocket initialization', () => client.open());
    assert.equal(init.platformFamily, 'windows');
    await check('Remote thread listing', () => client.request('thread/list', {limit: 1}));
    folder = path.win32.join(path.win32.dirname(init.codexHome), 'AppData', 'Local', 'Temp', 'codex-host-compat-' + crypto.randomUUID());
    await client.request('fs/createDirectory', {path: folder, recursive: true});
    const file=path.win32.join(folder, "한글 space ' $ test.txt"), text='Native Windows SSH 호환 검증\n';
    await check('Unicode file write/read', async () => {
      await client.request('fs/writeFile', {path:file,dataBase64:Buffer.from(text).toString('base64')});
      const read=await client.request('fs/readFile',{path:file}); assert.equal(Buffer.from(read.dataBase64,'base64').toString(),text);
    });
    await check('Native command execution', async () => {
      const r=await client.request('command/exec',{command:['cmd.exe','/d','/c','echo HOST_COMPAT_OK'],cwd:folder,timeoutMs:10000});
      assert.equal(r.exitCode,0);assert(r.stdout.includes('HOST_COMPAT_OK'));
    });
    await client.close(); client=new Client();
    await check('Fresh SSH session reconnect',()=>client.open());
    await check('File read after reconnect',()=>client.request('fs/readFile',{path:file}));
  } finally {
    if (folder && client.ws?.readyState === WebSocket.OPEN) await client.request('fs/remove',{path:folder,recursive:true,force:true});
    await client.close();
    const output=path.resolve(__dirname,'../build/windows-host-compat/protocol-results.json');
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({results,guiValidated:false},null,2)+'\n');
  }
})().catch(e=>{console.error(e);process.exitCode=1});
