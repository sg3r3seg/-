'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const create = require('../src/main/engine/automations');

function fakeCtx(lang = 'en', licensed = true) {
  const store = new Map(); const out = { chat: [], alerts: [], activity: [], rooms: [] };
  const ctx = {
    settings: { get: () => lang }, store: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) }, send() {},
    session: { has: () => licensed }, alerts: { showText: (t) => out.alerts.push(t) },
    chat: { reply: async (t, evt) => out.chat.push({ t, platform: evt?.platform }) }, activity: (a) => out.activity.push(a.text),
    winners: { create: async (w, title) => { out.rooms.push({ w, title }); return { room: { claimUrl: 'https://livex.example/w/abc', roomId: 'room12345' }, signInReady: true }; } },
  };
  return { a: create(ctx), out };
}
const tick = () => new Promise((r) => setImmediate(r));

test('built-ins are locked: listed, cannot be deleted or edited, only switched on/off', () => {
  const { a } = fakeCtx();
  const list = a.list();
  assert.ok(list.length >= 8);
  assert.ok(list.every((x) => x.locked && x.builtIn));
  assert.throws(() => a.remove('thank_follow'), { code: 'LOCKED' });
  assert.throws(() => a.update('thank_follow'), { code: 'LOCKED' });
  assert.equal(a.setEnabled('thank_follow', false).find((x) => x.id === 'thank_follow').enabled, false);
  assert.equal(a.list().length, list.length, 'turning off does not remove it');
});

test('react to real events only, with cooldowns; test events and blocked chat never trigger', async () => {
  const { a, out } = fakeCtx();
  a.onEvent({ type: 'follow', platform: 'twitch', user: { name: 'T' }, test: true });
  a.onEvent({ type: 'gift', platform: 'tiktok', user: { id: '1', name: 'Dana' }, gift: 'Rose', count: 3 });
  a.onEvent({ type: 'gift', platform: 'tiktok', user: { id: '1', name: 'Dana' }, gift: 'Rose', count: 3 }); // same viewer within 20 s
  a.onEvent({ type: 'gift', platform: 'tiktok', user: { id: '2', name: 'Avi' }, gift: 'Lion', count: 1 });
  a.onEvent({ type: 'follow', platform: 'twitch', user: { name: 'A' } });
  a.onEvent({ type: 'follow', platform: 'twitch', user: { name: 'B' } }); // global 15 s cooldown
  await tick();
  assert.deepEqual(out.chat.map((x) => x.t), ['Dana, huge thanks for Rose ×3! 🎁', 'Avi, huge thanks for Lion ×1! 🎁', 'Thanks for the follow, A! 💜']);
  assert.equal(out.chat[0].platform, 'tiktok', 'reply goes to the platform the event came from');
});

test('giveaway winner: opens a private room and posts the link (Hebrew)', async () => {
  const { a, out } = fakeCtx('he');
  a.trigger('giveaway_winner', { winner: { platform: 'twitch', name: 'NoaPlays', handle: 'noaplays', userId: '5' }, title: 'אוזניות' });
  await tick(); await tick();
  assert.equal(out.rooms.length, 1); assert.equal(out.rooms[0].title, 'אוזניות');
  assert.equal(out.chat[0].t, '🎉 מזל טוב @noaplays! זכית בהגרלה: אוזניות. היכנס/י לקישור הפרטי כדי לדבר איתי: https://livex.example/w/abc');
});

test('no PRO license -> nothing runs; turned off -> nothing runs; preview sends nothing', async () => {
  const off = fakeCtx('en', false); off.a.onEvent({ type: 'follow', platform: 'twitch', user: { name: 'A' } }); await tick();
  assert.equal(off.out.chat.length, 0);
  const { a, out } = fakeCtx(); a.setEnabled('thank_sub', false);
  a.onEvent({ type: 'sub', platform: 'twitch', user: { name: 'S' } }); await tick();
  assert.equal(out.chat.length, 0);
  assert.match(a.preview('thank_gift').text, /Viewer123/);
  assert.equal(out.chat.length, 0); assert.ok(out.activity.some((x) => x.startsWith('TEST (not sent)')));
});
