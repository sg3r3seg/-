'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// ---------------------------------------------------------------------------
// Key material. Secrets live ONLY on the server (keys dir or env vars), never
// in the desktop app. The app only embeds the two Ed25519 PUBLIC keys.
// ---------------------------------------------------------------------------
function readKey(envName, file) {
  if (process.env[envName]) return Buffer.from(process.env[envName], 'base64').toString('utf8');
  const p = path.join(config.keysDir, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Missing key ${file}. Run "npm run keys" in /server (or set ${envName}).`);
  }
  return fs.readFileSync(p, 'utf8');
}

let _keys;
function keys() {
  if (_keys) return _keys;
  const tokenPriv = crypto.createPrivateKey(readKey('LIVEX_TOKEN_PRIVATE_KEY', 'token_ed25519.pem'));
  const releasePrivPem = (() => {
    try { return readKey('LIVEX_RELEASE_PRIVATE_KEY', 'release_ed25519.pem'); } catch { return null; }
  })();
  const secrets = JSON.parse(readKey('LIVEX_SECRETS', 'secrets.json'));
  _keys = {
    tokenPriv,
    tokenPub: crypto.createPublicKey(tokenPriv),
    releasePriv: releasePrivPem ? crypto.createPrivateKey(releasePrivPem) : null,
    codePepper: Buffer.from(secrets.codePepper, 'base64'),
    dataKey: Buffer.from(secrets.dataKey, 'base64'),
  };
  if (_keys.dataKey.length !== 32) throw new Error('dataKey must be 32 bytes');
  return _keys;
}

// --- random identifiers -----------------------------------------------------
const B32 = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L for readability
function randomChars(n, alphabet = B32) {
  const out = [];
  // rejection sampling -> unbiased
  const max = 256 - (256 % alphabet.length);
  while (out.length < n) {
    const buf = crypto.randomBytes(n * 2);
    for (const b of buf) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === n) break;
    }
  }
  return out.join('');
}
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// HMAC with server-side pepper: DB leak alone doesn't allow offline brute force of codes.
const codeHash = (code) => crypto.createHmac('sha256', keys().codePepper).update(code).digest('hex');

// --- AES-256-GCM for storing activation codes for display in the owner's account
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keys().dataKey, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
function decrypt(blob) {
  const [iv, tag, ct] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', keys().dataKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// --- passwords (scrypt) -----------------------------------------------------
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${dk.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const dk = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, {
      N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(dk, expected);
  } catch {
    return false;
  }
}
// Constant-ish time dummy check to avoid user enumeration by timing.
const DUMMY_HASH = hashPassword(randomToken(12));

// --- compact JWS (EdDSA / Ed25519) -----------------------------------------
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(payload, ttlSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: 'livex', iat: now, exp: now + ttlSec, jti: randomToken(9), ...payload };
  const input = `${b64u({ alg: 'EdDSA', typ: 'JWT' })}.${b64u(body)}`;
  const sig = crypto.sign(null, Buffer.from(input), keys().tokenPriv).toString('base64url');
  return `${input}.${sig}`;
}
function verifyJwt(token, expectedTyp) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
    if (header.alg !== 'EdDSA') return null;
    const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), keys().tokenPub,
      Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(parts[1], 'base64url'));
    if (p.iss !== 'livex' || typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
    if (expectedTyp && p.typ !== expectedTyp) return null;
    return p;
  } catch {
    return null;
  }
}

// --- release manifest signing ----------------------------------------------
function canonical(obj) {
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  if (obj && typeof obj === 'object') {
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(obj);
}
function signRelease(manifest) {
  if (!keys().releasePriv) throw new Error('release signing key not available');
  return crypto.sign(null, Buffer.from(canonical(manifest)), keys().releasePriv).toString('base64');
}

module.exports = {
  keys, randomChars, randomToken, sha256, codeHash, encrypt, decrypt,
  hashPassword, verifyPassword, DUMMY_HASH, signJwt, verifyJwt, canonical, signRelease,
};
