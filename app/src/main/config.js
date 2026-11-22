'use strict';
const path = require('node:path');
const fs = require('node:fs');

// Build-time configuration. Contains only PUBLIC values: the API base URL and
// the Ed25519 public keys used to verify server-signed tokens and releases.
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'livex.config.json'), 'utf8'));

function validateBase(u) {
  const url = new URL(u);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`Refusing insecure API base ${u}: HTTPS is required for non-local servers`);
  }
  return url.origin;
}

// LIVEX_API_BASE override is honoured only for unpackaged development runs.
let isPackaged = false;
try { isPackaged = require('electron').app.isPackaged; } catch { /* tests */ }
const override = !isPackaged ? process.env.LIVEX_API_BASE : undefined;

module.exports = {
  apiBase: validateBase(override || raw.apiBase),
  websiteUrl: validateBase(override || raw.websiteUrl || raw.apiBase),
  tokenPublicKey: raw.tokenPublicKey,
  releasePublicKey: raw.releasePublicKey,
  validateBase,
};
