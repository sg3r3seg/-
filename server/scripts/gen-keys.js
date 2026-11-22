'use strict';
// Generates server key material and writes the matching PUBLIC keys into the
// desktop app config (app/config/livex.config.json). Private keys never leave /server/keys.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const keysDir = process.env.KEYS_DIR || path.join(__dirname, '..', 'keys');
const force = process.argv.includes('--force');
fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });

function ensure(file, make) {
  const p = path.join(keysDir, file);
  if (fs.existsSync(p) && !force) return fs.readFileSync(p, 'utf8');
  const v = make();
  fs.writeFileSync(p, v, { mode: 0o600 });
  console.log('wrote', p);
  return v;
}
const ed = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const tokenPem = ensure('token_ed25519.pem', ed);
const releasePem = ensure('release_ed25519.pem', ed);
ensure('secrets.json', () => JSON.stringify({
  codePepper: crypto.randomBytes(32).toString('base64'),
  dataKey: crypto.randomBytes(32).toString('base64'),
}, null, 2));

const pub = (pem) => crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' });
const appCfgPath = path.join(__dirname, '..', '..', 'app', 'config', 'livex.config.json');
let appCfg = {};
if (fs.existsSync(appCfgPath)) appCfg = JSON.parse(fs.readFileSync(appCfgPath, 'utf8'));
appCfg.apiBase = process.env.LIVEX_API_BASE || appCfg.apiBase || 'http://127.0.0.1:8787';
appCfg.websiteUrl = process.env.LIVEX_WEBSITE_URL || appCfg.websiteUrl || appCfg.apiBase;
appCfg.tokenPublicKey = pub(tokenPem);
appCfg.releasePublicKey = pub(releasePem);
fs.mkdirSync(path.dirname(appCfgPath), { recursive: true });
fs.writeFileSync(appCfgPath, `${JSON.stringify(appCfg, null, 2)}\n`);
console.log('updated', appCfgPath);
