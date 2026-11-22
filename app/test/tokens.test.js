'use strict';
// Unit tests for the app-side trust logic (no Electron needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyJwt, entitlementsFromLease, verifyRelease, canonical } = require('../src/main/tokens');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const attacker = crypto.generateKeyPairSync('ed25519');
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload, key = privateKey, alg = 'EdDSA') {
  const input = `${b64u({ alg, typ: 'JWT' })}.${b64u(payload)}`;
  return `${input}.${crypto.sign(null, Buffer.from(input), key).toString('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const DEV = 'device-uid-123';
const lease = (over = {}) => ({ iss: 'livex', typ: 'lease', sub: 'LVX-USER-000001', dev: DEV, ent: ['pro'], iat: now, exp: now + 3600, ...over });

test('valid lease grants its entitlements', () => {
  const r = entitlementsFromLease(sign(lease({ ent: ['pro', 'tts'] })), pub, DEV);
  assert.equal(r.valid, true); assert.deepEqual(r.entitlements, ['pro', 'tts']);
});
test('lease signed by another key is rejected (fake server)', () => {
  assert.equal(entitlementsFromLease(sign(lease(), attacker.privateKey), pub, DEV).valid, false);
});
test('tampered payload is rejected', () => {
  const tok = sign(lease({ ent: [] })).split('.');
  tok[1] = b64u(lease({ ent: ['pro', 'tts'] }));
  assert.equal(entitlementsFromLease(tok.join('.'), pub, DEV).valid, false);
});
test('expired lease is rejected (offline grace ends)', () => {
  assert.equal(entitlementsFromLease(sign(lease({ exp: now - 1 })), pub, DEV).valid, false);
});
test('lease for another installation is rejected', () => {
  assert.equal(entitlementsFromLease(sign(lease()), pub, 'other-device').valid, false);
});
test('access token cannot be used as a lease', () => {
  assert.equal(entitlementsFromLease(sign(lease({ typ: 'access' })), pub, DEV).valid, false);
});
test('alg confusion / garbage is rejected', () => {
  assert.equal(verifyJwt(sign(lease(), privateKey, 'none'), pub), null);
  assert.equal(verifyJwt('a.b.c', pub), null);
  assert.equal(verifyJwt(null, pub), null);
});
test('unknown entitlements are ignored', () => {
  assert.deepEqual(entitlementsFromLease(sign(lease({ ent: ['pro', 'admin'] })), pub, DEV).entitlements, ['pro']);
});
test('release manifest signature verification', () => {
  const m = { version: '1.0.1', sha512: 'abc', size: 10, url: '/x', platform: 'win32' };
  const sig = crypto.sign(null, Buffer.from(canonical(m)), privateKey).toString('base64');
  assert.equal(verifyRelease(m, sig, pub), true);
  assert.equal(verifyRelease({ ...m, url: '/evil' }, sig, pub), false);
  assert.equal(verifyRelease(m, crypto.sign(null, Buffer.from(canonical(m)), attacker.privateKey).toString('base64'), pub), false);
});
