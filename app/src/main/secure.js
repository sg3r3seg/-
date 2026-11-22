'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

// Secrets at rest (refresh token, install id, platform credentials the user
// entered) are encrypted with the OS keychain via Electron safeStorage
// (DPAPI on Windows). Nothing is stored if encryption is unavailable.
const file = () => path.join(app.getPath('userData'), 'secure.bin');
let cache = null;

function load() {
  if (cache) return cache;
  cache = {};
  try {
    if (safeStorage.isEncryptionAvailable() && fs.existsSync(file())) {
      cache = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    }
  } catch { cache = {}; }
  return cache;
}
function persist() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, safeStorage.encryptString(JSON.stringify(cache)));
  fs.renameSync(`${file()}.tmp`, file());
  return true;
}
module.exports = {
  available: () => safeStorage.isEncryptionAvailable(),
  get: (k) => load()[k],
  set: (k, v) => { load()[k] = v; return persist(); },
  del: (k) => { delete load()[k]; return persist(); },
};
