'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine } = require('../src/main/platforms/twitch');

const memStore = () => { const d = {}; return { get: (k, f) => (k in d ? d[k] : f), set: (k, v) => { d[k] = v; } }; };
const makeCtx = (ents = ['pro', 'tts']) => {
  const sent = []; const ov = [];
  return {
    sent, ov,
    store: memStore(), session: { has: (e) => ents.includes(e) },
    send: (c, p) => sent.push([c, p]),
    overlay: { broadcast: (r, t, p) => ov.push([r, t, p]) },
  };
};

test('TTS filter: profanity skipped, whole-word, links removed, length capped', () => {
  const tts = require('../src/main/engine/tts')(makeCtx());
  assert.equal(tts._clean('you are a bitch'), null);
  assert.equal(tts._clean('scunthorpe united'), 'scunthorpe united'); // no false positive inside words
  assert.equal(tts._clean('hi https://evil.example now'), 'hi now');
  assert.equal(tts._clean('a'.repeat(300), { maxLength: 20 }), `${'a'.repeat(20)}…`);
  assert.equal(tts._clean('bad word here', { blockedWords: ['word'], profanityMode: 'mask' }), 'bad *** here');
  assert.equal(tts._clean('שלום זונה', {}), null);
});

test('TTS queue requires the TTS entitlement', () => {
  const noTts = require('../src/main/engine/tts')(makeCtx(['pro']));
  assert.equal(noTts.say('hello'), null);
  const ctx = makeCtx(['tts']);
  const tts = require('../src/main/engine/tts')(ctx);
  const it = tts.say('hello');
  assert.ok(it);
  assert.ok(ctx.sent.some(([c, p]) => c === 'tts:speak' && p.text === 'hello'));
  tts.onEvent({ type: 'chat', platform: 'twitch', user: { name: 'a' }, text: '!cmd' });
  assert.equal(tts.state().length, 0); // commands skipped
  tts.pause(); tts.say('x'); tts.say('y');
  assert.equal(tts.state().length, 2);
  tts.clear();
  assert.equal(tts.state().length, 0);
});

test('test events never reach TTS or analytics', () => {
  const ctx = makeCtx(); ctx.activity = () => {};
  const tts = require('../src/main/engine/tts')(ctx);
  tts.onEvent({ type: 'chat', text: 'hello', test: true, user: { name: 'x' } });
  assert.equal(tts.state().current, null);
  const ins = require('../src/main/engine/insights')(ctx);
  ins.onEvent({ type: 'chat', text: 'hi', test: true, platform: 'x', ts: Date.now(), user: { name: 'u' } });
  assert.equal(ins.current(), null);
});

test('giveaway: one entry per viewer, crypto draw, no repeat winners', () => {
  const ctx = makeCtx(); ctx.activity = () => {};
  const g = require('../src/main/engine/giveaway')(ctx);
  g.configure({ keyword: '!join', title: 'T' }); g.open();
  for (const n of ['a', 'b', 'a', 'c']) g.onEvent({ type: 'chat', platform: 'twitch', text: '!join', user: { id: n, name: n } });
  assert.equal(g.get().total, 3);
  const w = new Set([g.draw().name, g.draw().name, g.draw().name]);
  assert.equal(w.size, 3);
  assert.throws(() => g.draw(), /No eligible/);
});

test('alerts fire only for licensed, enabled rules', () => {
  const ctx = makeCtx(['tts']);
  const a = require('../src/main/engine/alerts')(ctx);
  a.onEvent({ type: 'follow', platform: 'kick', user: { name: 'x' } });
  assert.equal(ctx.ov.length, 0);
  const ctx2 = makeCtx(['pro']);
  const a2 = require('../src/main/engine/alerts')(ctx2);
  a2.onEvent({ type: 'follow', platform: 'kick', user: { name: 'Dana' } });
  assert.equal(ctx2.ov[0][2].text, 'Dana started following!');
  assert.equal(a2.test('gift').test, true);
});

test('twitch IRC parser handles tags, bits and sub notices', () => {
  const m = parseLine('@badges=moderator/1;bits=100;display-name=Dana;user-id=42 :dana!dana@dana.tmi.twitch.tv PRIVMSG #chan :Cheer100 hello');
  assert.equal(m.command, 'PRIVMSG'); assert.equal(m.tags.bits, '100'); assert.equal(m.tags['display-name'], 'Dana'); assert.equal(m.trailing, 'Cheer100 hello');
  const n = parseLine('@msg-id=resub;display-name=Ron;system-msg=Ron\\ssubscribed :tmi.twitch.tv USERNOTICE #chan');
  assert.equal(n.tags['system-msg'], 'Ron subscribed');
});
