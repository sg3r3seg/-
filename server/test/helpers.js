'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolated server instance: temp data dir + freshly generated in-memory keys.
function setupEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livex-test-'));
  const ed = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const tokenPem = ed();
  Object.assign(process.env, {
    DATA_DIR: dir,
    DB_FILE: path.join(dir, 'test.db'),
    RELEASES_DIR: path.join(dir, 'releases'),
    PAYMENT_PROVIDER: 'sandbox',
    RATE_LIMIT_MULTIPLIER: '100',
    ADMIN_TOKEN: 'a'.repeat(40),
    LIVEX_TOKEN_PRIVATE_KEY: Buffer.from(tokenPem).toString('base64'),
    LIVEX_RELEASE_PRIVATE_KEY: Buffer.from(ed()).toString('base64'),
    LIVEX_SECRETS: Buffer.from(JSON.stringify({
      codePepper: crypto.randomBytes(32).toString('base64'),
      dataKey: crypto.randomBytes(32).toString('base64'),
    })).toString('base64'),
  });
  return { dir, tokenPublicKey: crypto.createPublicKey(tokenPem) };
}

async function start() {
  const env = setupEnv();
  const db = require('../src/db');
  db.open();
  const { createApp } = require('../src/app');
  const server = await new Promise((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const mailer = require('../src/mailer');
  const stop = () => new Promise((r) => server.close(() => { db.close(); r(); }));
  return { base, env, mailer, stop, db };
}

function client(base) {
  return async function call(method, url, { body, token, device, headers = {} } = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(device ? { 'X-LiveX-Device': device } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-json */ }
    return { status: res.status, body: json, headers: res.headers };
  };
}

const newDeviceUid = () => crypto.randomBytes(32).toString('base64url');

module.exports = { start, client, newDeviceUid };
