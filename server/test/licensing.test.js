'use strict';
// End-to-end tests of the mandatory licensing scenarios (spec section 15),
// executed over real HTTP against a real SQLite database.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { start, client, newDeviceUid } = require('./helpers');

let srv; let call;
test.before(async () => { srv = await start(); call = client(srv.base); });
test.after(async () => { await srv.stop(); });

const lastMail = (to, tag) => srv.mailer.readOutbox().filter((m) => m.to === to && (!tag || m.tag === tag)).pop();
const tokenFromLink = (text) => /#token=([A-Za-z0-9_-]+)/.exec(text)[1];
const codeFromMail = (text) => /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(text)[1];

let seq = 0;
async function newUser(first = 'Shay', last = 'Cohen') {
  seq += 1;
  const email = `user${seq}-${Date.now()}@example.com`;
  const password = 'Str0ngPass!';
  const reg = await call('POST', '/api/auth/register', { body: { firstName: first, lastName: last, email, password } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.match(reg.body.user.userId, /^LVX-USER-\d{6}$/);
  // login blocked until email verified
  const blocked = await call('POST', '/api/auth/login', { body: { email, password, client: 'web' } });
  assert.equal(blocked.body.error, 'EMAIL_NOT_VERIFIED');
  const v = await call('POST', '/api/auth/verify-email', { body: { token: tokenFromLink(lastMail(email, 'verify').text) } });
  assert.equal(v.status, 200);
  const web = await call('POST', '/api/auth/login', { body: { email, password, client: 'web' } });
  assert.equal(web.status, 200);
  return { email, password, userId: reg.body.user.userId, web: web.body.accessToken, first };
}
async function appLogin(u, device = newDeviceUid()) {
  const r = await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password, client: 'app', device: { uid: device, name: 'STREAM-PC', os: 'Windows 11' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.accessToken, refresh: r.body.refreshToken, device };
}
async function buy(u, product) {
  const co = await call('POST', '/api/shop/checkout', { token: u.web, body: { product } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const paid = await call('POST', '/api/payments/sandbox/complete', { token: u.web, body: { orderId: co.body.orderId } });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return { orderId: co.body.orderId, license: paid.body.license, code: codeFromMail(lastMail(u.email, 'activation').text) };
}
const status = (s) => call('GET', '/api/app/status', { token: s.token, device: s.device });
const activate = (s, code) => call('POST', '/api/app/activate', { token: s.token, device: s.device, body: { code, device: { name: 'STREAM-PC', os: 'Windows 11' } } });

function verifyLease(lease) {
  const [h, p, sig] = lease.split('.');
  const ok = crypto.verify(null, Buffer.from(`${h}.${p}`), srv.env.tokenPublicKey, Buffer.from(sig, 'base64url'));
  return ok ? JSON.parse(Buffer.from(p, 'base64url')) : null;
}

test('products and prices are served by the server', async () => {
  const r = await call('GET', '/api/products');
  const prices = Object.fromEntries(r.body.products.map((p) => [p.code, p.price]));
  assert.deepEqual(prices, { PRO: '19.90', TTS: '29.90', BUNDLE: '39.90' });
});

test('1-5: buy PRO, personal code bound to name + User ID, one-time activation', async () => {
  const u = await newUser('Shay', 'Levi');
  const { license, code } = await buy(u, 'PRO');                       // 1
  assert.match(license.personalCode, /^LVX-SHAY-[A-Z0-9]{4}-[A-Z0-9]{4}$/); // 2
  assert.equal(license.holderName, 'Shay Levi');                     // 3
  assert.equal(license.userId, u.userId);
  assert.equal(license.status, 'pending_activation');
  assert.equal(license.activationCode.code, code); // visible in personal area while unused
  const mail = lastMail(u.email, 'activation').text;
  assert.ok(mail.includes(u.userId) && mail.includes(license.personalCode) && mail.includes('Shay Levi'));

  const s = await appLogin(u);
  const before = await status(s);
  assert.deepEqual(before.body.entitlements, []);

  const a1 = await activate(s, code.toLowerCase().replace(/-/g, ' ')); // 4 (normalization)
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  assert.deepEqual(a1.body.entitlements, ['pro']);
  assert.equal(a1.body.license.status, 'active');
  const lease = verifyLease(a1.body.lease);
  assert.ok(lease && lease.typ === 'lease' && lease.dev === s.device && lease.ent.includes('pro'));

  const a2 = await activate(s, code);                                  // 5 same device
  assert.equal(a2.status, 409); assert.equal(a2.body.error, 'CODE_ALREADY_USED');
  const s2 = await appLogin(u);                                        // 5 other computer
  const a3 = await activate(s2, code);
  assert.equal(a3.status, 409); assert.equal(a3.body.error, 'CODE_ALREADY_USED');

  const acct = await call('GET', '/api/account', { token: u.web });
  const lic = acct.body.licenses[0];
  assert.equal(lic.activationCode.status, 'used');
  assert.equal(lic.activationCode.code, null); // no longer shown once used
  assert.equal(lic.device.name, 'STREAM-PC');
});

test('6: code cannot be used from another account', async () => {
  const owner = await newUser('Dana');
  const { code } = await buy(owner, 'PRO');
  const thief = await newUser('Eve');
  const s = await appLogin(thief);
  const r = await activate(s, code);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'CODE_OWNER_MISMATCH');
  assert.deepEqual((await status(s)).body.entitlements, []);
  // owner can still activate it afterwards
  const so = await appLogin(owner);
  assert.equal((await activate(so, code)).status, 200);
});

test('7: user without purchase cannot activate anything', async () => {
  const u = await newUser('Noam');
  const s = await appLogin(u);
  const fake = `LVX-${Array.from({ length: 5 }, () => 'ABCD').join('-')}`;
  const r = await activate(s, fake);
  assert.equal(r.status, 400); assert.equal(r.body.error, 'INVALID_CODE');
  const st = await status(s);
  assert.deepEqual(st.body.entitlements, []);
  assert.deepEqual(verifyLease(st.body.lease).ent, []);
  // checkout without completed payment grants nothing
  await call('POST', '/api/shop/checkout', { token: u.web, body: { product: 'BUNDLE' } });
  assert.deepEqual((await status(s)).body.entitlements, []);
});

test('8: TTS-only purchase does not grant PRO', async () => {
  const u = await newUser('Tal');
  const { code } = await buy(u, 'TTS');
  const s = await appLogin(u);
  const r = await activate(s, code);
  assert.deepEqual(r.body.entitlements, ['tts']);
  assert.ok(!verifyLease(r.body.lease).ent.includes('pro'));
});

test('9: Bundle grants PRO and TTS', async () => {
  const u = await newUser('Maya');
  const { code } = await buy(u, 'BUNDLE');
  const s = await appLogin(u);
  const r = await activate(s, code);
  assert.deepEqual(r.body.entitlements, ['pro', 'tts']);
});

test('10: changing computer requires the secure transfer flow', async () => {
  const u = await newUser('Omer');
  const { code, license } = await buy(u, 'PRO');
  const oldPc = await appLogin(u);
  assert.equal((await activate(oldPc, code)).status, 200);

  const newPc = await appLogin(u);
  const direct = await call('POST', '/api/app/bind', { token: newPc.token, device: newPc.device, body: { licenseId: license.licenseId } });
  assert.equal(direct.status, 409); assert.equal(direct.body.error, 'DEVICE_LIMIT');

  const acct = await call('GET', '/api/account', { token: u.web });
  const dev = acct.body.devices.find((d) => d.status === 'active');
  const wrong = await call('POST', `/api/account/devices/${dev.deviceId}/transfer`, { token: u.web, body: { password: 'nope12345' } });
  assert.equal(wrong.status, 401);
  const t = await call('POST', `/api/account/devices/${dev.deviceId}/transfer`, { token: u.web, body: { password: u.password } });
  assert.equal(t.status, 200);
  const tok = tokenFromLink(lastMail(u.email, 'transfer').text);
  const c = await call('POST', '/api/account/transfer/confirm', { token: u.web, body: { token: tok } });
  assert.equal(c.status, 200);
  assert.equal((await call('POST', '/api/account/transfer/confirm', { token: u.web, body: { token: tok } })).status, 400); // link is one-time

  // old computer: session revoked
  const rf = await call('POST', '/api/auth/refresh', { body: { refreshToken: oldPc.refresh, deviceUid: oldPc.device } });
  assert.equal(rf.status, 401);
  assert.deepEqual((await status(oldPc)).body.entitlements, []); // short-lived access token still valid -> no entitlements

  const bound = await call('POST', '/api/app/bind', { token: newPc.token, device: newPc.device, body: { licenseId: license.licenseId } });
  assert.equal(bound.status, 200, JSON.stringify(bound.body));
  assert.deepEqual(bound.body.entitlements, ['pro']);
});

test('11: revoking a license is reflected in the app status', async () => {
  const u = await newUser('Ron');
  const { code, license } = await buy(u, 'BUNDLE');
  const s = await appLogin(u);
  await activate(s, code);
  const rv = await call('POST', `/api/admin/licenses/${license.licenseId}/revoke`, { headers: { Authorization: `Bearer ${'a'.repeat(40)}` }, body: { reason: 'chargeback' } });
  assert.equal(rv.status, 200);
  const st = await status(s);
  assert.deepEqual(st.body.entitlements, []);
  assert.equal(st.body.licenses[0].status, 'revoked');
  assert.equal(st.body.licenses[0].revokeReason, 'chargeback');
  assert.equal((await call('POST', `/api/admin/licenses/${license.licenseId}/revoke`, { headers: { Authorization: 'Bearer wrong' } })).status, 404);
});

test('activation brute force is limited per user', async () => {
  const u = await newUser('Bruce');
  const s = await appLogin(u);
  for (let i = 0; i < 5; i++) await activate(s, `LVX-${crypto.randomBytes(10).toString('hex').toUpperCase().slice(0, 20).match(/.{4}/g).join('-')}`);
  const r = await activate(s, 'LVX-AAAA-BBBB-CCCC-DDDD-EEEE');
  assert.equal(r.status, 429); assert.equal(r.body.error, 'TOO_MANY_ATTEMPTS');
});

test('expired activation code is refused', async () => {
  const u = await newUser('Gal');
  const { code } = await buy(u, 'PRO');
  srv.db.get().prepare('UPDATE activation_codes SET expires_at=? WHERE code_hash=?').run(Date.now() - 1, require('../src/crypto').codeHash(code));
  const s = await appLogin(u);
  const r = await activate(s, code);
  assert.equal(r.status, 410); assert.equal(r.body.error, 'CODE_EXPIRED');
});

test('payment fulfilment is idempotent and checks the amount', async () => {
  const u = await newUser('Idan');
  const co = await call('POST', '/api/shop/checkout', { token: u.web, body: { product: 'PRO' } });
  const L = require('../src/services/licenses');
  await assert.rejects(L.fulfillOrder(co.body.orderId, { amountAgorot: 100, currency: 'ILS' }), /does not match/);
  const co2 = await call('POST', '/api/shop/checkout', { token: u.web, body: { product: 'PRO' } });
  const a = await L.fulfillOrder(co2.body.orderId, { amountAgorot: 1990, currency: 'ILS' });
  const b = await L.fulfillOrder(co2.body.orderId, { amountAgorot: 1990, currency: 'ILS' });
  assert.equal(a.license.license_id, b.license.license_id);
  assert.equal(b.alreadyFulfilled, true);
  assert.equal(srv.db.get().prepare('SELECT COUNT(*) n FROM licenses WHERE user_id=(SELECT id FROM users WHERE email=?)').get(u.email).n, 1);
});

test('activation codes are stored only as HMAC hashes + encrypted copies', async () => {
  const u = await newUser('Lior');
  const { code } = await buy(u, 'PRO');
  const rows = srv.db.get().prepare('SELECT code_hash, code_enc FROM activation_codes').all();
  for (const r of rows) {
    assert.ok(!r.code_hash.includes(code) && !r.code_enc.includes(code));
  }
  const dump = JSON.stringify(srv.db.get().prepare('SELECT * FROM activation_codes').all());
  assert.ok(!dump.includes(code));
});

test('app tokens are bound to their device and refresh tokens rotate', async () => {
  const u = await newUser('Yael');
  const s = await appLogin(u);
  const r = await call('GET', '/api/app/status', { token: s.token, device: newDeviceUid() });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'DEVICE_MISMATCH');
  const r1 = await call('POST', '/api/auth/refresh', { body: { refreshToken: s.refresh, deviceUid: s.device } });
  assert.equal(r1.status, 200);
  const reuse = await call('POST', '/api/auth/refresh', { body: { refreshToken: s.refresh, deviceUid: s.device } });
  assert.equal(reuse.body.error, 'SESSION_REUSED');
  // reuse detection revoked the rotated token as well
  const r2 = await call('POST', '/api/auth/refresh', { body: { refreshToken: r1.body.refreshToken, deviceUid: s.device } });
  assert.equal(r2.status, 401);
});

test('password reset flow', async () => {
  const u = await newUser('Ido');
  await call('POST', '/api/auth/forgot', { body: { email: u.email } });
  const tok = tokenFromLink(lastMail(u.email, 'reset').text);
  assert.equal((await call('POST', '/api/auth/reset', { body: { token: tok, password: 'NewPass123' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: u.email, password: u.password } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: u.email, password: 'NewPass123' } })).status, 200);
  assert.equal((await call('POST', '/api/auth/forgot', { body: { email: 'nobody@example.com' } })).status, 200);
});

test('TTS AI endpoints require a TTS license and report missing provider honestly', async () => {
  const u = await newUser('Shir');
  const s = await appLogin(u);
  const r = await call('GET', '/api/tts/ai/voices', { token: s.token, device: s.device });
  assert.equal(r.body.error, 'TTS_NOT_LICENSED');
  const { code } = await buy(u, 'TTS');
  await activate(s, code);
  const r2 = await call('GET', '/api/tts/ai/voices', { token: s.token, device: s.device });
  assert.equal(r2.status, 503); assert.equal(r2.body.error, 'ELEVENLABS_NOT_CONNECTED'); // the creator connects their own ElevenLabs account
});
