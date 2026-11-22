'use strict';
const crypto = require('node:crypto');

// Verifies a compact EdDSA JWS issued by the LiveX server. Pure function so it
// can be unit tested without Electron. Returns the payload or null.
function verifyJwt(token, publicKeyPem, { typ, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !publicKeyPem) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'EdDSA') return null;
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
    const ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (p.iss !== 'livex' || typeof p.exp !== 'number' || p.exp * 1000 < now) return null;
    if (typ && p.typ !== typ) return null;
    return p;
  } catch {
    return null;
  }
}

// Decide what the app may unlock from a lease. Only a valid, unexpired lease
// signed by the server and issued for THIS install id grants entitlements.
function entitlementsFromLease(lease, publicKeyPem, deviceUid, now = Date.now()) {
  const p = verifyJwt(lease, publicKeyPem, { typ: 'lease', now });
  if (!p || p.dev !== deviceUid || !Array.isArray(p.ent)) return { valid: false, entitlements: [], payload: null };
  return { valid: true, entitlements: p.ent.filter((e) => e === 'pro' || e === 'tts'), payload: p, expiresAt: p.exp * 1000 };
}

function canonical(obj) {
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(',')}]`;
  if (obj && typeof obj === 'object') return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
  return JSON.stringify(obj);
}
function verifyRelease(manifest, signatureB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(canonical(manifest)), crypto.createPublicKey(publicKeyPem), Buffer.from(signatureB64, 'base64'));
  } catch { return false; }
}

module.exports = { verifyJwt, entitlementsFromLease, verifyRelease, canonical };
