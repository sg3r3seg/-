'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMock } = require('./oauth-mock');
const { start, client, newDeviceUid } = require('./helpers');

let srv; let call; let mock; let app; const DEV = newDeviceUid();
test.before(async () => {
  mock = await createMock().listen();
  Object.assign(process.env, mock.env());
  srv = await start(); call = client(srv.base);
  // PUBLIC_URL must point to this test server for the redirect URI
  require('../src/config').publicUrl = srv.base;
  const email = `oa-${Date.now()}@example.com`; const password = 'Str0ngPass!1';
  await call('POST', '/api/auth/register', { body: { firstName: 'Oa', lastName: 'Uth', email, password } });
  const tok = /#token=([\w-]+)/.exec(srv.mailer.readOutbox().filter((m) => m.to === email && m.tag === 'verify').pop().text)[1];
  await call('POST', '/api/auth/verify-email', { body: { token: tok } });
  app = (await call('POST', '/api/auth/login', { body: { email, password, client: 'app', device: { uid: DEV, name: 'PC', os: 'Win' } } })).body.accessToken;
});
test.after(async () => { await srv.stop(); mock.server.close(); });
const A = (m, u, body) => call(m, u, { token: app, device: DEV, body });
// Simulates the user's browser: open authorize URL, follow the provider redirect to our callback.
async function browser(url) {
  const r1 = await fetch(url, { redirect: 'manual' });
  const cb = r1.headers.get('location');
  const r2 = await fetch(cb);
  return { status: r2.status, html: await r2.text() };
}

test('lists platforms and whether sign-in is configured', async () => {
  const r = await A('GET', '/api/oauth/providers');
  assert.deepEqual(r.body.providers.map((p) => [p.platform, p.configured]), [['youtube', true], ['twitch', true], ['kick', true], ['tiktok', true], ['discord', true]]);
});

for (const [platform, name] of [['youtube', 'Shay Live'], ['twitch', 'ShayLive'], ['kick', 'shaykick'], ['tiktok', 'Shay TikTok'], ['discord', 'Shay']]) {
  test(`connect ${platform}: consent -> callback -> tokens handed to the app once`, async () => {
    const s = await A('POST', `/api/oauth/${platform}/start`, {});
    assert.equal(s.status, 200);
    assert.ok(s.body.authorizeUrl.includes('state='));
    assert.equal((await A('GET', `/api/oauth/flows/${s.body.flowId}`)).body.status, 'pending');
    const b = await browser(s.body.authorizeUrl);
    assert.equal(b.status, 200); assert.ok(b.html.includes(name));
    assert.ok(!/at-|rt-/.test(b.html), 'tokens never shown in the browser page');
    const p = await A('GET', `/api/oauth/flows/${s.body.flowId}`);
    assert.equal(p.body.status, 'done');
    assert.equal(p.body.result.profile.name, name);
    assert.ok(p.body.result.accessToken.startsWith(`at-`));
    if (platform !== 'tiktok' && platform !== 'discord') assert.ok(p.body.result.refreshToken);
    if (platform === 'discord') assert.ok(p.body.result.webhookUrl.startsWith('https://discord.com/api/webhooks/'));
    const again = await A('GET', `/api/oauth/flows/${s.body.flowId}`);
    assert.equal(again.body.status, 'collected'); assert.equal(again.body.result, undefined);
  });
}

test('PKCE is enforced (google/kick) and a reused callback is rejected', async () => {
  const s = await A('POST', '/api/oauth/kick/start', {});
  assert.ok(s.body.authorizeUrl.includes('code_challenge_method=S256'));
  const r1 = await fetch(s.body.authorizeUrl, { redirect: 'manual' }); const cb = r1.headers.get('location');
  assert.equal((await fetch(cb)).status, 200);
  const replay = await fetch(cb); assert.equal(replay.status, 400);
});

test('user cancels on the consent screen -> ACCESS_DENIED, nothing stored', async () => {
  mock.mode = 'deny';
  const s = await A('POST', '/api/oauth/twitch/start', {});
  const b = await browser(s.body.authorizeUrl);
  mock.mode = 'allow';
  assert.equal(b.status, 400); assert.ok(b.html.includes('בוטלה'));
  const p = await A('GET', `/api/oauth/flows/${s.body.flowId}`);
  assert.deepEqual([p.body.status, p.body.error], ['error', 'ACCESS_DENIED']);
});

test('provider failure during token exchange -> EXCHANGE_FAILED', async () => {
  mock.tokenMode = 'fail';
  const s = await A('POST', '/api/oauth/youtube/start', {});
  await browser(s.body.authorizeUrl);
  mock.tokenMode = 'ok';
  const p = await A('GET', `/api/oauth/flows/${s.body.flowId}`);
  assert.deepEqual([p.body.status, p.body.error], ['error', 'EXCHANGE_FAILED']);
});

test('app closes the window: cancel marks the flow cancelled', async () => {
  const s = await A('POST', '/api/oauth/youtube/start', {});
  await A('POST', `/api/oauth/flows/${s.body.flowId}/cancel`, {});
  assert.equal((await A('GET', `/api/oauth/flows/${s.body.flowId}`)).body.status, 'cancelled');
  const b = await browser(s.body.authorizeUrl); assert.equal(b.status, 400); // late consent is ignored
});

test('forged / unknown state and another device cannot read a flow', async () => {
  const bad = await fetch(`${srv.base}/api/oauth/callback/twitch?code=x&state=forged`); assert.equal(bad.status, 400);
  const s = await A('POST', '/api/oauth/twitch/start', {});
  const other = await call('GET', `/api/oauth/flows/${s.body.flowId}`, { token: app, device: newDeviceUid() });
  assert.equal(other.status, 401); // access token is bound to its device
});

test('refresh works, revoked grant -> REAUTH_REQUIRED, revoke reaches the provider', async () => {
  const r = await A('POST', '/api/oauth/twitch/refresh', { refreshToken: 'rt-twitch-1' });
  assert.equal(r.status, 200); assert.ok(r.body.accessToken.startsWith('at-twitch-r')); assert.equal(r.body.refreshToken, 'rt-twitch-1');
  mock.refreshMode = 'revoked';
  const r2 = await A('POST', '/api/oauth/twitch/refresh', { refreshToken: 'rt-twitch-1' });
  mock.refreshMode = 'ok';
  assert.equal(r2.status, 409); assert.equal(r2.body.error, 'REAUTH_REQUIRED');
  mock.tokenMode = 'fail'; // platform outage must not force a reconnect
  const r3 = await A('POST', '/api/oauth/twitch/refresh', { refreshToken: 'rt-twitch-1' });
  mock.tokenMode = 'ok';
  assert.equal(r3.status, 502); assert.equal(r3.body.error, 'PROVIDER_UNAVAILABLE');
  const v = await A('POST', '/api/oauth/kick/revoke', { token: 'at-kick-9' });
  assert.equal(v.body.revoked, true); assert.ok(mock.revoked.some((x) => x.prov === 'kick' && x.token === 'at-kick-9'));
});

test('not configured platform reports it honestly', async () => {
  const cfg = require('../src/config'); const saved = cfg.oauth.tiktok.clientSecret; cfg.oauth.tiktok.clientSecret = '';
  const s = await A('POST', '/api/oauth/tiktok/start', {});
  cfg.oauth.tiktok.clientSecret = saved;
  assert.equal(s.status, 503); assert.equal(s.body.error, 'OAUTH_NOT_CONFIGURED');
});

test('no tokens are kept on the server after hand-over', async () => {
  const rows = srv.db.get().prepare("SELECT status, result_enc FROM oauth_flows WHERE status='collected'").all();
  assert.ok(rows.length >= 5 && rows.every((r) => r.result_enc === null));
});
