'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createGiveaway = require('../src/main/engine/giveaway');
const createAutomations = require('../src/main/engine/automations');

function setup(lang = 'en') {
  const store = new Map(); const out = { chat: [], triggers: [], activity: [], overlay: [], notify: [] };
  const ctx = {
    settings: { get: () => lang }, store: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) }, send() {},
    session: { has: () => true }, overlay: { broadcast: (route, type, payload) => out.overlay.push({ route, type, payload }) }, activity: (a) => out.activity.push(a.text),
    notify: (title, body) => out.notify.push(`${title} | ${body}`),
    alerts: { showText() {} }, chat: { reply: async (t) => out.chat.push(t) },
    winners: { create: async () => ({ room: { claimUrl: 'https://livex.example/w/new', roomId: 'room-new-1' }, signInReady: true }), qr: async (u) => `data:image/svg+xml;base64,QR(${u})` },
  };
  ctx.giveaway = createGiveaway(ctx);
  ctx.automations = createAutomations(ctx);
  return { g: ctx.giveaway, out };
}
const chat = (g, id, handle) => g.onEvent({ type: 'chat', platform: 'twitch', text: '!join', user: { id, handle, name: handle } });
const tick = () => new Promise((r) => setImmediate(r));

test('winner not found -> prize goes to a new random participant, never the same one', async () => {
  const { g, out } = setup();
  g.open(); chat(g, '1', 'ana'); chat(g, '2', 'ben'); g.close();
  const first = g.draw();
  await tick(); await tick();
  const next = g.transfer(first.key);
  assert.notEqual(next.key, first.key);
  assert.equal(next.transferredFrom, first.name);
  const s = g.get();
  assert.equal(s.winners.find((w) => w.key === first.key).status, 'not_found');
  assert.equal(s.winners.find((w) => w.key === first.key).transferredTo, next.name);
  assert.ok(out.activity.some((x) => x.includes('not found — prize transferred to')));
  await tick(); await tick();
  assert.match(out.chat.at(-1), new RegExp(`^🎁 @${first.handle} could not be reached, so the prize moves on! Congrats @${next.handle}`));
  assert.throws(() => g.transfer(first.key), { code: 'ALREADY_TRANSFERRED' });
});

test('nobody left -> nothing changes; a "not found" winner can never be drawn again', () => {
  const { g } = setup();
  g.open(); chat(g, '1', 'solo'); g.close();
  const w = g.draw();
  assert.equal(g.hasEligible(), false);
  assert.throws(() => g.transfer(w.key), { code: 'NO_OTHER_ENTRIES' });
  assert.equal(g.get().winners[0].status, 'won', 'winner untouched');
  assert.throws(() => g.draw(), { code: 'NO_ENTRIES' });
});

test('room id is kept on the winner (to check whether they confirmed)', async () => {
  const { g } = setup('he');
  g.open(); chat(g, '1', 'ana'); chat(g, '2', 'ben'); g.close();
  const w = g.draw();
  await tick(); await tick();
  assert.equal(g.get().winners.find((x) => x.key === w.key).roomId, 'room-new-1');
});

test('after a draw the stream shows a QR card with the private link; confirmation is shown once + notifies', async () => {
  const { g, out } = setup('he');
  g.open(); chat(g, '1', 'dana.live'); g.close();
  const w = g.draw();
  for (let i = 0; i < 5; i++) await tick();
  const claim = out.overlay.find((x) => x.type === 'claim');
  assert.ok(claim, 'claim card broadcast to the giveaway overlay');
  assert.equal(claim.route, 'giveaway'); assert.equal(claim.payload.url, 'https://livex.example/w/new');
  assert.equal(claim.payload.handle, 'dana.live'); assert.match(claim.payload.qr, /^data:image\/svg\+xml;base64,/);
  assert.equal(g.confirmed('room-new-1').key, w.key);
  assert.equal(g.confirmed('room-new-1'), null, 'announced only once');
  assert.equal(out.overlay.filter((x) => x.type === 'confirmed').length, 1);
  assert.match(out.notify[0], /@dana\.live אישר\/ה את הזכייה/);
});
