'use strict';
const {execFileSync} = require('node:child_process');
const path = require('node:path');
try {
  process.stdout.write(execFileSync(path.join(__dirname, '../build/tpm-key'), ['probe'], {
    encoding: 'utf8', timeout: 10000, env: {PATH: '/usr/bin:/bin'}, stdio: ['ignore', 'pipe', 'pipe'],
  }));
} catch (e) {
  console.error(e.stderr?.toString().trim() || e.message);
  process.exitCode = 1;
}
