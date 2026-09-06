'use strict';
// Production uses only a kernel TPM device. Test instances return a deliberately
// invalid server protectionClass and must never be used for enrollment.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const ALGORITHM = 'ecdsa_p256_sha256';
const KEY_ID = /^dk_linux_tpm_[0-9a-f]{32}$/;

function protectedDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error('key directory must be absolute');
  // Parent must already exist: never create or traverse arbitrary symlink chains.
  const parent = path.dirname(directory);
  if (fs.realpathSync(parent) !== parent) throw new Error('key directory parent contains symlinks');
  try { fs.mkdirSync(directory, {mode: 0o700}); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o700) throw new Error('key directory must be owned by user with mode 0700');
}
function spki(key) {
  if (![key.x, key.y].every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)))
    throw new Error('invalid P-256 public point');
  return crypto.createPublicKey({key: {
    kty: 'EC', crv: 'P-256', x: Buffer.from(key.x, 'hex').toString('base64url'),
    y: Buffer.from(key.y, 'hex').toString('base64url'),
  }, format: 'jwk'}).export({type: 'spki', format: 'der'}).toString('base64');
}
function signatureDER(signature) {
  const integer = value => {
    if (typeof value !== 'string' || !/^(?:[0-9a-f]{2}){1,32}$/.test(value))
      throw new Error('invalid ECDSA integer');
    let b = Buffer.from(value, 'hex');
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return Buffer.concat([Buffer.from([2, b.length]), b]);
  };
  const body = Buffer.concat([integer(signature.r), integer(signature.s)]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
function createProvider({directory, helper, testTransport} = {}) {
  if (!directory || !helper || !path.isAbsolute(helper)) throw new Error('absolute directory/helper required');
  const protectionClass = testTransport ? 'TEST_ONLY_SOFTWARE_TPM' : 'hardware_tpm';
  let tail = Promise.resolve();
  const serial = fn => {
    const task = tail.then(fn);
    tail = task.catch(() => {});
    return task;
  };
  const invoke = async (op, lines = []) => {
    // execFile's async API doesn't accept input; write bounded stdin explicitly.
    const env = {PATH: '/usr/bin:/bin', LANG: 'C', TSS2_LOG: 'all+ERROR'};
    if (testTransport) env.RC_TEST_TCTI = testTransport;
    return new Promise((resolve, reject) => {
      const child = execFile(helper, [op], {env, timeout: 30000, maxBuffer: 65536}, (error, stdout, stderr) => {
        if (error) { reject(new Error(`TPM ${op} failed: ${stderr.trim() || error.message}`)); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('invalid TPM helper output')); }
      });
      child.stdin.on('error', () => {}); // early helper rejection is reported above
      child.stdin.end(lines.length ? lines.join('\n') + '\n' : '');
    });
  };
  function filename(id) {
    if (!KEY_ID.test(id)) throw new Error('invalid device key ID');
    return path.join(directory, `${id}.json`);
  }
  function read(id) {
    protectedDirectory(directory);
    const fd = fs.openSync(filename(id), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() ||
          (st.mode & 0o777) !== 0o600 || st.size > 32768) throw new Error('unsafe key record');
      const record = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (record.version !== 1 || record.keyId !== id || record.algorithm !== ALGORITHM ||
          record.protectionClass !== protectionClass ||
          ![record.publicBlob, record.privateBlob].every(v => typeof v === 'string' &&
            /^(?:[0-9a-f]{2}){1,4096}$/.test(v))) throw new Error('invalid key record');
      return record;
    } finally { fs.closeSync(fd); }
  }
  function publicView(record, actual) {
    const actualSpki = spki(actual);
    if (actualSpki !== record.publicKeySpkiDerBase64) throw new Error('TPM public key mismatch');
    return {keyId: record.keyId, algorithm: ALGORITHM, protectionClass,
      publicKeySpkiDerBase64: actualSpki};
  }
  async function load(id) {
    const record = read(id);
    const actual = await invoke('public', [record.publicBlob, record.privateBlob]);
    return {record, view: publicView(record, actual)};
  }
  return Object.freeze({
    async probe() { return invoke('probe'); },
    createDeviceKey(policy = 'hardware_only') {
      return serial(async () => {
        if (!['hardware_only', 'allow_os_protected_nonextractable'].includes(policy))
          throw new Error('unsupported device key protection policy');
        protectedDirectory(directory);
        const key = await invoke('create');
        const record = {version: 1, keyId: `dk_linux_tpm_${crypto.randomBytes(16).toString('hex')}`,
          algorithm: ALGORITHM, protectionClass, publicKeySpkiDerBase64: spki(key),
          publicBlob: key.publicBlob, privateBlob: key.privateBlob};
        // Both blobs are TPM-native structures; privateBlob is encrypted under
        // the fixed TPM parent. This is not PEM/PKCS8 private key material.
        const target = filename(record.keyId);
        const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT |
          fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
        catch (e) { fs.unlinkSync(target); throw e; }
        finally { fs.closeSync(fd); }
        const dirFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
        return publicView(record, key);
      });
    },
    getDeviceKeyPublic(id) { return serial(async () => (await load(id)).view); },
    signDeviceKey(id, payload) {
      return serial(async () => {
        if (!(payload instanceof Uint8Array) || payload.byteLength > 65536)
          throw new Error('invalid signing payload');
        const bytes = Buffer.from(payload);
        const envelope = JSON.parse(bytes.toString('utf8'));
        if (envelope.domain !== 'codex-device-key-sign-payload/v1' ||
            !['remoteControlClientEnrollment', 'remoteControlClientConnection'].includes(envelope.payload?.type))
          throw new Error('invalid signing domain/type');
        const {record, view} = await load(id);
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        const result = await invoke('sign', [record.publicBlob, record.privateBlob, digest]);
        const der = signatureDER(result);
        const key = crypto.createPublicKey({key: Buffer.from(view.publicKeySpkiDerBase64, 'base64'),
          format: 'der', type: 'spki'});
        if (!crypto.verify('sha256', bytes, key, der)) throw new Error('TPM signature verification failed');
        return {algorithm: ALGORITHM, signatureDerBase64: der.toString('base64')};
      });
    },
    deleteDeviceKey(id) {
      return serial(async () => { read(id); fs.unlinkSync(filename(id)); });
    },
  });
}
module.exports = {createProvider, signatureDER};
