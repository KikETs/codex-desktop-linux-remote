'use strict';
const path = require('node:path');
const {app} = require('electron');
const {createProvider} = require('./linux-device-key-provider.cjs');
// This file is installed only in the development copy. No existing credentials
// or key store are imported; the launcher assigns an isolated userData directory.
module.exports = createProvider({
  directory: path.join(app.getPath('userData'), 'remote-control-device-keys'),
  helper: path.join(__dirname, 'native', 'linux-remote-control-tpm'),
});
