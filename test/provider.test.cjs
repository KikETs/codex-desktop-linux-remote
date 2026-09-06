'use strict';
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn, execFileSync} = require('node:child_process');
const vm = require('node:vm');
const {createProvider} = require('../src/device-key.cjs');
const root = path.resolve(__dirname, '..');
let temporary, simulator, provider, config;
const payload = Buffer.from(JSON.stringify({domain: 'codex-device-key-sign-payload/v1',
  payload: {type: 'remoteControlClientConnection', nonce: 'test-local-only'}}));
before(async () => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-tpm-test-'));
  const state = path.join(temporary, 'state'); fs.mkdirSync(state, {mode: 0o700});
  const socket = path.join(temporary, 'tpm.sock');
  simulator = spawn(path.join(root, 'vendor/root/usr/bin/swtpm'), ['socket', '--tpm2',
    '--tpmstate', `dir=${state}`, '--server', `type=unixio,path=${socket}`,
    '--ctrl', `type=unixio,path=${socket}.ctrl`, '--flags', 'not-need-init,startup-clear'], {
    env: {...process.env, LD_LIBRARY_PATH: [path.join(root, 'vendor/root/usr/lib/x86_64-linux-gnu'),
      path.join(root, 'vendor/root/usr/lib/x86_64-linux-gnu/swtpm')].join(':')},
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; simulator.stderr.on('data', b => { stderr += b; });
  for (let i = 0; !fs.existsSync(socket) && i < 100; ++i) {
    if (simulator.exitCode !== null) throw new Error(`swtpm startup: ${stderr}`);
    await new Promise(r => setTimeout(r, 20));
  }
  config = {directory: path.join(temporary, 'keys'), helper: path.join(root, 'build/tpm-key-test'),
    testTransport: `swtpm:path=${socket}`};
  provider = createProvider(config);
  assert.deepEqual(await provider.probe(), {connected: true});
});
after(async () => {
  if (simulator && simulator.exitCode === null) {
    const exited = new Promise(r => simulator.once('exit', r)); simulator.kill('SIGTERM'); await exited;
  }
  if (temporary) fs.rmSync(temporary, {recursive: true, force: true});
});
test('create, reload across providers, P-256 DER signature and delete', async () => {
  const key = await provider.createDeviceKey('hardware_only');
  assert.equal(key.protectionClass, 'TEST_ONLY_SOFTWARE_TPM');
  const second = createProvider(config);
  assert.deepEqual(await second.getDeviceKeyPublic(key.keyId), key);
  const sig = await second.signDeviceKey(key.keyId, payload);
  const pub = crypto.createPublicKey({key: Buffer.from(key.publicKeySpkiDerBase64, 'base64'), type: 'spki', format: 'der'});
  assert.equal(pub.asymmetricKeyDetails.namedCurve, 'prime256v1');
  assert(crypto.verify('sha256', payload, pub, Buffer.from(sig.signatureDerBase64, 'base64')));
  assert(!crypto.verify('sha256', Buffer.concat([payload, Buffer.from('x')]), pub, Buffer.from(sig.signatureDerBase64, 'base64')));
  const record = JSON.parse(fs.readFileSync(path.join(config.directory, `${key.keyId}.json`)));
  assert(!Object.keys(record).some(k => /pem|pkcs8|privateKey/i.test(k)));
  assert.equal(fs.statSync(path.join(config.directory, `${key.keyId}.json`)).mode & 0o777, 0o600);
  await second.deleteDeviceKey(key.keyId);
  await assert.rejects(provider.getDeviceKeyPublic(key.keyId), /ENOENT/);
});
test('tampered TPM wrapped blob fails closed', async () => {
  const key = await provider.createDeviceKey();
  const file = path.join(config.directory, `${key.keyId}.json`);
  const record = JSON.parse(fs.readFileSync(file));
  record.privateBlob = record.privateBlob.slice(0, -2) + (record.privateBlob.endsWith('00') ? '01' : '00');
  fs.writeFileSync(file, JSON.stringify(record));
  await assert.rejects(provider.signDeviceKey(key.keyId, payload), /Load/);
  await provider.deleteDeviceKey(key.keyId);
});
test('public-key substitution fails before returning metadata', async () => {
  const key = await provider.createDeviceKey();
  const file = path.join(config.directory, `${key.keyId}.json`);
  const record = JSON.parse(fs.readFileSync(file)); record.publicKeySpkiDerBase64 = 'invalid';
  fs.writeFileSync(file, JSON.stringify(record));
  await assert.rejects(provider.getDeviceKeyPublic(key.keyId), /mismatch/);
  await provider.deleteDeviceKey(key.keyId);
});
test('unsafe permissions, symlinks, traversal and signing domain rejected', async () => {
  const key = await provider.createDeviceKey();
  const file = path.join(config.directory, `${key.keyId}.json`);
  await assert.rejects(provider.getDeviceKeyPublic('../outside'), /invalid device key ID/);
  await assert.rejects(provider.signDeviceKey(key.keyId, Buffer.from('{}')), /domain/);
  fs.chmodSync(file, 0o644);
  await assert.rejects(provider.getDeviceKeyPublic(key.keyId), /unsafe key record/);
  fs.chmodSync(file, 0o600);
  const backup = file + '.saved'; fs.renameSync(file, backup); fs.symlinkSync(backup, file);
  await assert.rejects(provider.getDeviceKeyPublic(key.keyId), /ELOOP/);
  fs.unlinkSync(file); fs.renameSync(backup, file); await provider.deleteDeviceKey(key.keyId);
});
test('simulator key label cannot be loaded as hardware key', async () => {
  const key = await provider.createDeviceKey();
  const production = createProvider({directory: config.directory, helper: path.join(root, 'build/tpm-key')});
  await assert.rejects(production.getDeviceKeyPublic(key.keyId), /invalid key record/);
  await provider.deleteDeviceKey(key.keyId);
});
test('unsupported policies rejected; simulator helper requires explicit test transport', async () => {
  await assert.rejects(provider.createDeviceKey('plaintext'), /unsupported/);
  assert.throws(() => execFileSync(path.join(root, 'build/tpm-key-test'), ['probe'],
    {env: {}, stdio: 'pipe'}), /test build requires explicit swtpm/);
});
test('actual Desktop key wrapper produces a verifiable domain-bound signature', async () => {
  // Execute only the installed app's small key wrapper, never the app or a patch.
  const mainDir = path.join(root, 'build/desktop/resources/app/.vite/build');
  const mainName = fs.readdirSync(mainDir).find(n => /^main-.*\.js$/.test(n));
  const bundle = fs.readFileSync(path.join(mainDir, mainName), 'utf8');
  const match = /var (\w+)=\(0,F\.createRequire\)\(__filename\),\w+=`remote-control-device-key\.node`/.exec(bundle);
  assert(match);
  const begin = match.index, end = bundle.indexOf('var ', begin + 4);
  const className = /,(\w+)=class\{resourcesPath;addon=null/.exec(bundle.slice(begin, end))[1];
  assert(begin >= 0 && end > begin);
  const context = {Buffer, process: {platform: 'linux'}, __filename: __filename,
    p: {join: path.join}, F: {createRequire: () => target => {
      assert.equal(target, '/development-resources/linux-device-key.cjs');
      return provider;
    }}};
  const Wrapper = vm.runInNewContext(bundle.slice(begin, end) + ';' + className, context);
  const wrapper = new Wrapper('/development-resources');
  const key = await wrapper.createDeviceKey('allow_os_protected_nonextractable');
  const challenge = {type: 'remoteControlClientConnection',
    nonce: crypto.randomBytes(32).toString('base64url'), audience: 'remote_control_client_websocket',
    scopes: ['remote_control_controller_websocket'], accountUserId: 'local-test-account',
    clientId: 'local-test-client', sessionId: 'local-test-session', targetOrigin: 'https://example.invalid',
    targetPath: '/codex/remote/control/client', tokenExpiresAt: 2000000000,
    tokenSha256Base64url: crypto.createHash('sha256').update('local-test-token').digest('base64url')};
  const signed = await wrapper.signDeviceKey(key.keyId, challenge);
  const bytes = Buffer.from(signed.signedPayloadBase64, 'base64');
  assert.equal(JSON.parse(bytes).domain, 'codex-device-key-sign-payload/v1');
  const pub = crypto.createPublicKey({key: Buffer.from(key.publicKeySpkiDerBase64, 'base64'),
    format: 'der', type: 'spki'});
  assert(crypto.verify('sha256', bytes, pub, Buffer.from(signed.signatureDerBase64, 'base64')));
  await assert.rejects(wrapper.signDeviceKey(key.keyId, {...challenge, nonce: 'short'}), /nonce/);
  await assert.rejects(wrapper.signDeviceKey(key.keyId, {...challenge, scopes: ['invalid']}), /scopes/);
  await wrapper.deleteDeviceKey(key.keyId);
});
