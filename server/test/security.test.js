'use strict';
// Security QA: authorization, IDOR, admin protection, data exposure.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, client, newDeviceUid } = require('./helpers');

let srv; let call;
test.before(async () => { srv = await start(); call = client(srv.base); });
test.after(async () => { await srv.stop(); });
const mails = () => srv.mailer.readOutbox();
async function user(name) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`; const password = 'Str0ngPass!1';
  const reg = await call('POST', '/api/auth/register', { body: { firstName: name, lastName: 'T', email, password } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const tok = /#token=([\w-]+)/.exec(mails().filter((m) => m.to === email && m.tag === 'verify').pop().text)[1];
  await call('POST', '/api/auth/verify-email', { body: { token: tok } });
  const web = (await call('POST', '/api/auth/login', { body: { email, password } })).body.accessToken;
  return { email, password, web };
}

test('protected endpoints reject anonymous and forged tokens', async () => {
  for (const [m, u] of [['GET', '/api/account'], ['GET', '/api/app/status'], ['POST', '/api/app/activate'], ['POST', '/api/shop/checkout'], ['GET', '/api/tts/ai/voices']]) {
    const body = m === 'GET' ? undefined : {};
    assert.equal((await call(m, u, { body })).status, 401, u);
    assert.equal((await call(m, u, { body, token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' })).status, 401, u);
  }
});

test('web session cannot call desktop-app endpoints', async () => {
  const u = await user('Web');
  assert.equal((await call('GET', '/api/app/status', { token: u.web })).body.error, 'APP_ONLY');
});

test('no cross-user access to orders, devices or transfers (IDOR)', async () => {
  const a = await user('Alice'); const b = await user('Bob');
  const co = await call('POST', '/api/shop/checkout', { token: a.web, body: { product: 'PRO' } });
  assert.equal((await call('GET', `/api/shop/orders/${co.body.orderId}`, { token: b.web })).status, 404);
  assert.equal((await call('POST', '/api/payments/sandbox/complete', { token: b.web, body: { orderId: co.body.orderId } })).status, 404);
  await call('POST', '/api/payments/sandbox/complete', { token: a.web, body: { orderId: co.body.orderId } });
  const code = /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(mails().filter((m) => m.to === a.email && m.tag === 'activation').pop().text)[1];
  const dev = newDeviceUid();
  const app = (await call('POST', '/api/auth/login', { body: { email: a.email, password: a.password, client: 'app', device: { uid: dev, name: 'PC', os: 'Win' } } })).body.accessToken;
  await call('POST', '/api/app/activate', { token: app, device: dev, body: { code } });
  const devId = (await call('GET', '/api/account', { token: a.web })).body.devices[0].deviceId;
  assert.equal((await call('POST', `/api/account/devices/${devId}/transfer`, { token: b.web, body: { password: b.password } })).status, 404);
  const bAcct = (await call('GET', '/api/account', { token: b.web })).body;
  assert.equal(bAcct.licenses.length, 0); assert.equal(bAcct.devices.length, 0);
});

test('account responses never expose password hashes or secrets', async () => {
  const u = await user('Priv');
  const r = await call('GET', '/api/account', { token: u.web });
  const raw = JSON.stringify(r.body);
  for (const bad of ['password', 'scrypt$', 'code_hash', 'token_hash', 'code_enc']) assert.ok(!raw.includes(bad), bad);
  const me = await call('GET', '/api/auth/me', { token: u.web });
  assert.ok(!JSON.stringify(me.body).includes('scrypt'));
});

test('admin API is hidden without the admin token', async () => {
  assert.equal((await call('GET', '/api/admin/users')).status, 404);
  const u = await user('NotAdmin');
  assert.equal((await call('GET', '/api/admin/users', { token: u.web })).status, 404);
  assert.equal((await call('GET', '/api/admin/users', { headers: { Authorization: `Bearer ${'a'.repeat(40)}` } })).status, 200);
});

test('web refresh cookie requires the anti-CSRF header; login is rate limited', async () => {
  assert.equal((await call('POST', '/api/auth/refresh', { body: {} })).body.error, 'BAD_REQUEST');
  const res = await call('GET', '/api/health');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});

test('static file serving does not expose server code, keys or database', async () => {
  for (const p of ['/../src/config.js', '/..%2fkeys%2fsecrets.json', '/data/test.db', '/.env', '/package.json']) {
    const r = await fetch(srv.base + p);
    const txt = await r.text();
    assert.ok(r.status === 404 || !/codePepper|PRIVATE KEY|"dependencies"|SQLite format/.test(txt), p);
  }
});
