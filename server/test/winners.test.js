'use strict';
// Private chat with a giveaway winner: identity is proven with the platform sign-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMock } = require('./oauth-mock');
const { start, client, newDeviceUid } = require('./helpers');

let srv; let call; let mock; let pro; let free;
async function account(first, product) {
  const email = `${first.toLowerCase()}-${Date.now()}@example.com`; const password = 'Str0ngPass!1'; const device = newDeviceUid();
  await call('POST', '/api/auth/register', { body: { firstName: first, lastName: 'Test', email, password } });
  const tok = /#token=([\w-]+)/.exec(srv.mailer.readOutbox().filter((m) => m.to === email && m.tag === 'verify').pop().text)[1];
  await call('POST', '/api/auth/verify-email', { body: { token: tok } });
  const web = (await call('POST', '/api/auth/login', { body: { email, password, client: 'web' } })).body.accessToken;
  const app = (await call('POST', '/api/auth/login', { body: { email, password, client: 'app', device: { uid: device, name: 'PC', os: 'Windows 11' } } })).body.accessToken;
  if (product) {
    const co = await call('POST', '/api/shop/checkout', { token: web, body: { product } });
    await call('POST', '/api/payments/sandbox/complete', { token: web, body: { orderId: co.body.orderId } });
    const code = /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(srv.mailer.readOutbox().filter((m) => m.to === email && m.tag === 'activation').pop().text)[1];
    const a = await call('POST', '/api/app/activate', { token: app, device, body: { code, device: { name: 'PC', os: 'Windows 11' } } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
  }
  return { A: (m, u, body) => call(m, u, { token: app, device, body }) };
}
test.before(async () => {
  mock = await createMock().listen();
  Object.assign(process.env, mock.env());
  srv = await start(); call = client(srv.base);
  require('../src/config').publicUrl = srv.base;
  pro = await account('Shay', 'PRO'); free = await account('Free', null);
});
test.after(async () => { await srv.stop(); mock.server.close(); });

// The winner's browser: keeps cookies, follows the platform sign-in and our redirects.
function winnerBrowser() {
  const jar = new Map();
  const keep = (res) => { for (const c of res.headers.getSetCookie?.() || []) { const [kv, ...attrs] = c.split(';'); const [k, v] = kv.split('='); jar.set(k.trim(), { v, path: (attrs.find((a) => /path=/i.test(a)) || 'Path=/').split('=')[1].trim() }); } };
  const cookie = (url) => [...jar].filter(([, c]) => new URL(url).pathname.startsWith(c.path)).map(([k, c]) => `${k}=${c.v}`).join('; ');
  const go = async (url, opts = {}) => { const r = await fetch(url, { ...opts, redirect: 'manual', headers: { ...(opts.headers || {}), cookie: cookie(url) } }); keep(r); return r; };
  return {
    jar,
    api: async (m, path, body) => { const r = await go(srv.base + path, { method: m, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; },
    // click "Sign in with <platform>": authorize -> provider redirect -> our callback -> /w/<code>
    async signIn(code) {
      const v = await this.api('POST', `/api/winner/${code}/verify`);
      assert.equal(v.status, 200, JSON.stringify(v.body));
      const r1 = await go(v.body.authorizeUrl); const r2 = await go(r1.headers.get('location'));
      return new URL(r2.headers.get('location'), srv.base);
    },
  };
}
const room = async (body) => { const r = await pro.A('POST', '/api/rooms', body); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.room; };
const codeOf = (r) => r.claimUrl.split('/w/')[1];

test('only PRO creators can open a private winner chat', async () => {
  const r = await free.A('POST', '/api/rooms', { platform: 'twitch', winnerId: '42', winnerHandle: 'shaylive', winnerName: 'ShayLive', title: 'Giveaway' });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'NOT_LICENSED');
});

test('Twitch winner: correct account signs in, chats privately both ways', async () => {
  const rm = await room({ platform: 'twitch', winnerId: '42', winnerHandle: '@ShayLive', winnerName: 'ShayLive', title: 'Headset giveaway' });
  assert.equal(rm.status, 'waiting'); assert.ok(rm.claimUrl.startsWith(`${srv.base}/w/`));
  const page = await fetch(rm.claimUrl); assert.equal(page.status, 200); assert.ok((await page.text()).includes('winner.js'));
  const b = winnerBrowser(); const code = codeOf(rm);
  const info = (await b.api('GET', `/api/winner/${code}`)).body;
  assert.equal(info.host, 'Shay'); assert.equal(info.title, 'Headset giveaway'); assert.equal(info.you, false); assert.equal(info.signInReady, true);
  assert.equal((await b.api('GET', `/api/winner/${code}/messages`)).status, 401, 'no messages before sign-in');
  const back = await b.signIn(code);
  assert.equal(back.pathname, `/w/${code}`); assert.equal(back.searchParams.get('ok'), '1');
  assert.ok(mock.revoked.some((x) => x.prov === 'twitch'), 'identity token is revoked right away');
  assert.equal((await b.api('GET', `/api/winner/${code}`)).body.you, true);
  await pro.A('POST', `/api/rooms/${rm.roomId}/messages`, { text: 'Congrats! Where should I send the prize?' });
  const sent = await b.api('POST', `/api/winner/${code}/messages`, { text: 'Thank you!! 🎉' });
  assert.equal(sent.status, 200);
  const w = await b.api('GET', `/api/winner/${code}/messages`);
  assert.deepEqual(w.body.messages.map((m) => [m.from, m.text]), [['host', 'Congrats! Where should I send the prize?'], ['winner', 'Thank you!! 🎉']]);
  const list = (await pro.A('GET', '/api/rooms')).body.rooms.find((x) => x.roomId === rm.roomId);
  assert.equal(list.status, 'verified'); assert.equal(list.verifiedName, 'ShayLive'); assert.equal(list.unread, 1);
  const h = await pro.A('GET', `/api/rooms/${rm.roomId}/messages`);
  assert.equal(h.body.messages.length, 2);
  assert.equal((await pro.A('GET', '/api/rooms')).body.rooms.find((x) => x.roomId === rm.roomId).unread, 0, 'reading clears unread');
  // A second browser (someone else from the stream) cannot read or take over the room.
  const other = winnerBrowser();
  assert.equal((await other.api('GET', `/api/winner/${code}/messages`)).status, 401);
  assert.equal((await other.api('POST', `/api/winner/${code}/verify`)).body.error, 'ALREADY_VERIFIED');
});

test('someone else signing in from the public link is refused', async () => {
  const rm = await room({ platform: 'kick', winnerId: '999', winnerHandle: 'realwinner', winnerName: 'realwinner', title: 'G' });
  const b = winnerBrowser(); const back = await b.signIn(codeOf(rm)); // mock signs in as shaykick (id 7)
  assert.equal(back.searchParams.get('e'), 'NOT_WINNER');
  assert.equal((await b.api('GET', `/api/winner/${codeOf(rm)}/messages`)).status, 401);
  assert.equal((await pro.A('GET', '/api/rooms')).body.rooms.find((x) => x.roomId === rm.roomId).status, 'waiting', 'room stays open for the real winner');
});

test('TikTok winner is matched by @username, YouTube by channel id', async () => {
  const tt = await room({ platform: 'tiktok', winnerId: '6800000001', winnerHandle: 'Shay_TT', winnerName: 'Shay TikTok', title: 'G' });
  assert.equal((await winnerBrowser().signIn(codeOf(tt))).searchParams.get('ok'), '1');
  const yt = await room({ platform: 'youtube', winnerId: 'UC123', winnerName: 'Shay Live', title: 'G' });
  const ytUrl = (await winnerBrowser().signIn(codeOf(yt)));
  assert.equal(ytUrl.searchParams.get('ok'), '1');
  const ytWrong = await room({ platform: 'youtube', winnerId: 'UC999', winnerName: 'Shay Live', title: 'G2' });
  assert.equal((await winnerBrowser().signIn(codeOf(ytWrong))).searchParams.get('e'), 'NOT_WINNER', 'same display name is not enough on YouTube');
});

test('winner cancels the sign-in', async () => {
  const rm = await room({ platform: 'twitch', winnerId: '43', winnerName: 'x', title: 'Cancel test' });
  mock.mode = 'deny';
  try { assert.equal((await winnerBrowser().signIn(codeOf(rm))).searchParams.get('e'), 'ACCESS_DENIED'); } finally { mock.mode = 'allow'; }
});

test('closing a room deletes its messages and locks the link', async () => {
  const rm = await room({ platform: 'twitch', winnerId: '4242', winnerHandle: 'shaylive', winnerName: 'ShayLive', title: 'Close test' }); // matched by @handle
  const b = winnerBrowser(); await b.signIn(codeOf(rm));
  await b.api('POST', `/api/winner/${codeOf(rm)}/messages`, { text: 'hi' });
  assert.equal((await pro.A('POST', `/api/rooms/${rm.roomId}/close`, {})).status, 200);
  assert.equal((await b.api('GET', `/api/winner/${codeOf(rm)}/messages`)).body.error, 'ROOM_CLOSED');
  assert.equal((await b.api('POST', `/api/winner/${codeOf(rm)}/messages`, { text: 'x' })).body.error, 'ROOM_CLOSED');
  const db = require('../src/db').get();
  const id = db.prepare('SELECT id FROM winner_rooms WHERE room_id=?').get(rm.roomId).id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM winner_messages WHERE room_id=?').get(id).n, 0);
});

test('messages are encrypted at rest; rooms of other creators are invisible', async () => {
  const rm = await room({ platform: 'twitch', winnerId: '42', winnerHandle: 'shaylive', winnerName: 'ShayLive', title: 'Enc test' });
  await pro.A('POST', `/api/rooms/${rm.roomId}/messages`, { text: 'SECRET-ADDRESS-123' });
  const db = require('../src/db').get();
  const raw = db.prepare('SELECT body_enc FROM winner_messages ORDER BY id DESC LIMIT 1').get().body_enc;
  assert.ok(!raw.includes('SECRET-ADDRESS'));
  const other = await account('Eve', 'PRO');
  assert.equal((await other.A('GET', `/api/rooms/${rm.roomId}/messages`)).status, 404);
  assert.equal((await other.A('GET', '/api/rooms')).body.rooms.length, 0);
});

test('same winner reuses the open room; bad input is rejected', async () => {
  const a = await room({ platform: 'twitch', winnerId: '77', winnerName: 'dup', title: 'Dup' });
  const b = await pro.A('POST', '/api/rooms', { platform: 'twitch', winnerId: '77', winnerName: 'dup', title: 'Dup' });
  assert.equal(b.body.reused, true); assert.equal(b.body.room.roomId, a.roomId);
  assert.equal((await pro.A('POST', '/api/rooms', { platform: 'discord', winnerId: '1', winnerName: 'x' })).status, 400);
  assert.equal((await pro.A('POST', '/api/rooms', { platform: 'tiktok', winnerId: '1', winnerName: 'x' })).status, 400, 'TikTok needs @username');
  assert.equal((await pro.A('POST', `/api/rooms/${a.roomId}/messages`, { text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await fetch(`${srv.base}/api/winner/nope-nope`)).status, 404);
});
