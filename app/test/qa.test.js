'use strict';
// QA regression tests for fixes made during the pre-release QA pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const memStore = () => { const d = {}; return { get: (k, f) => (k in d ? d[k] : f), set: (k, v) => { d[k] = v; } }; };
function ctx(ents = ['pro', 'tts']) {
  const sent = []; const ov = []; const acts = [];
  const c = { sent, ov, acts, store: memStore(), session: { has: (e) => ents.includes(e) }, send: (ch, p) => sent.push([ch, p]),
    overlay: { broadcast: (r, t, p) => ov.push([r, t, p]), mediaUrl: (n) => `/media/${n}?key=k` },
    platforms: { sendChat: async () => [] }, activity: (a) => acts.push(a), hub: { log() {} }, runMacro() {} };
  return c;
}

test('hub drops duplicate events and repeat follows', () => {
  const hub = require('../src/main/hub');
  const got = []; const fn = (e) => got.push(e); hub.on('event', fn);
  const u = { id: 'u1', name: 'Dana' };
  hub.publish({ platform: 'tiktok', type: 'follow', user: u });
  hub.publish({ platform: 'tiktok', type: 'follow', user: u }); // duplicate
  hub.publish({ platform: 'tiktok', type: 'gift', user: u, gift: 'Rose', count: 5 });
  hub.publish({ platform: 'tiktok', type: 'gift', user: u, gift: 'Rose', count: 5 }); // retransmit within 2s
  hub.publish({ platform: 'tiktok', type: 'chat', user: u, text: 'hi' });
  hub.off('event', fn);
  assert.deepEqual(got.map((e) => e.type), ['follow', 'gift', 'chat']);
});

test('tiktok provider: social event no longer produces a second follow', () => {
  const { TikTok } = require('../src/main/platforms/tiktok');
  const t = new TikTok(); const out = []; t.publish = (e) => out.push(e);
  t.map({ event: 'follow', data: { uniqueId: 'a', nickname: 'A' } });
  t.map({ event: 'social', data: { uniqueId: 'a', nickname: 'A', displayType: 'pm_mt_msg_viewer_follow' } });
  assert.equal(out.filter((e) => e.type === 'follow').length, 1);
});

test('chat moderation: links, repeats, flood and caps are blocked; mods exempt', () => {
  const c = ctx(); const chat = require('../src/main/engine/chat')(c);
  const ev = (text, user = { id: 'x', name: 'X' }) => ({ type: 'chat', platform: 'twitch', text, user });
  assert.equal(chat.moderate(ev('check https://spam.example')), 'link');
  assert.equal(chat.moderate(ev('free stuff at spam.com now')), 'link');
  assert.equal(chat.moderate(ev('hello')), null);
  chat.moderate(ev('buy', { id: 'r' })); chat.moderate(ev('buy', { id: 'r' }));
  assert.equal(chat.moderate(ev('buy', { id: 'r' })), 'repeat');
  assert.equal(chat.moderate(ev('THIS IS ALL CAPS SHOUTING', { id: 'c' })), 'caps');
  assert.equal(chat.moderate(ev('https://ok.example', { id: 'm', isMod: true })), null);
  chat.saveBot({ ...chat.bot(), moderation: { ...chat.bot().moderation, blockLinks: false } });
  assert.equal(chat.moderate(ev('see https://x.example', { id: 'z' })), null);
});

test('blocked chat is not read by TTS and cannot join giveaways', () => {
  const c = ctx(); const tts = require('../src/main/engine/tts')(c); const g = require('../src/main/engine/giveaway')(c);
  g.configure({ keyword: '!join' }); g.open();
  const e = { type: 'chat', platform: 'kick', text: '!join', user: { id: 'b', name: 'B' }, blocked: 'link' };
  tts.onEvent({ ...e, text: 'hello' }); g.onEvent(e);
  assert.equal(tts.state().length + (tts.state().current ? 1 : 0), 0);
  assert.equal(g.get().total, 0);
});

test('TTS on/off: manual speak refused when off, turning off clears the queue', () => {
  const c = ctx(); const tts = require('../src/main/engine/tts')(c);
  tts.pause(); tts.say('one'); tts.say('two');
  assert.equal(tts.state().length, 2);
  tts.saveSettings({ enabled: false });
  assert.equal(tts.state().length, 0);
  assert.throws(() => tts.say('three'), /turned off/);
  tts.onEvent({ type: 'chat', platform: 'x', text: 'hello', user: { name: 'u' } });
  assert.equal(tts.state().length, 0);
  tts.saveSettings({ enabled: true }); tts.resume();
  tts.onEvent({ type: 'chat', platform: 'x', text: 'hello', user: { name: 'u' } });
  assert.equal(c.sent.filter(([ch]) => ch === 'tts:speak').pop()[1].text, 'u: hello'); // username + original text
});

test('TTS failure (provider offline) is logged and the queue continues', () => {
  const c = ctx(); const logs = []; c.hub = { log: (...a) => logs.push(a) };
  const tts = require('../src/main/engine/tts')(c);
  tts.pause(); tts.say('a'); tts.say('b'); tts.resume();
  const first = c.sent.filter(([ch]) => ch === 'tts:speak')[0][1];
  tts.failed(first.id, 'AI provider unavailable');
  assert.ok(logs.length === 1);
  return new Promise((r) => setTimeout(() => { assert.equal(c.sent.filter(([ch]) => ch === 'tts:speak').length, 2); r(); }, 400));
});

test('alerts: custom image/GIF media is used and test alerts are marked', () => {
  const c = ctx(); const a = require('../src/main/engine/alerts')(c);
  const d = a.get(); d.rules[0].media = 'ab12cd34.gif'; d.rules[1].media = '../../evil.exe';
  a.save(d);
  assert.equal(a.get().rules[1].media, '', 'path traversal / bad names rejected');
  a.onEvent({ type: 'follow', platform: 'tiktok', user: { name: 'Noa' } });
  const al = c.ov.pop()[2];
  assert.equal(al.text, 'Noa started following!'); assert.equal(al.image, '/media/ab12cd34.gif?key=k'); assert.equal(al.custom, true);
  assert.equal(a.test('follow').test, true);
});

test('overlay server: disable/enable route, media served only with key', async () => {
  const { OverlayServer } = require('../src/main/overlay-server');
  const s = new OverlayServer(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvx-media-'));
  fs.writeFileSync(path.join(dir, 'ab12cd34.gif'), Buffer.from('GIF89a'));
  s.mediaDir = dir; const key = 'q'.repeat(24);
  const port = await s.start({ port: 0, key });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/ab12cd34.gif?key=${key}`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/ab12cd34.gif?key=bad`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/media/..%2F..%2Fetc%2Fpasswd?key=${key}`)).status, 404);
    s.setDisabled(['chat']);
    assert.equal((await fetch(s.url('chat'))).status, 410);
    assert.ok((await s.verify()).find((x) => x.route === 'chat').disabled);
    s.setDisabled([]);
    assert.equal((await fetch(s.url('chat'))).status, 200);
  } finally { await s.stop(); }
});

test('commands: create, edit, delete, cooldown and mods-only level', async () => {
  const c = ctx(); const replies = []; c.platforms.sendChat = async (t) => { replies.push(t); return [{ platform: 'twitch', ok: true }]; };
  const chat = require('../src/main/engine/chat')(c);
  let list = chat.saveCommands([{ trigger: '!discord', response: 'Join {user}!', cooldownSec: 60, level: 'everyone', enabled: true }, { trigger: '!ban', response: 'x', level: 'mods', enabled: true }, { trigger: 'bad trigger', response: 'x' }]);
  assert.equal(list.length, 2);
  chat.onEvent({ type: 'chat', platform: 'twitch', text: '!discord', user: { name: 'Dana' } });
  chat.onEvent({ type: 'chat', platform: 'twitch', text: '!discord', user: { name: 'Ron' } }); // cooldown
  chat.onEvent({ type: 'chat', platform: 'twitch', text: '!ban', user: { name: 'Eve' } }); // not a mod
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(replies, ['Join Dana!']);
  list = chat.saveCommands([{ ...list[0], response: 'Edited' }]); // edit + delete !ban
  assert.equal(list.length, 1); assert.equal(list[0].response, 'Edited');
});

test('timed bot messages fire on schedule', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const c = ctx(); const sent = []; c.platforms.sendChat = async (x) => { sent.push(x); return []; };
  const chat = require('../src/main/engine/chat')(c);
  chat.saveBot({ enabled: true, welcome: {}, keywords: [], timed: [{ text: 'Follow me!', intervalMin: 5, enabled: true }] });
  t.mock.timers.tick(5 * 60_000); t.mock.timers.tick(5 * 60_000);
  chat.stop();
  assert.equal(sent.length, 2);
});

test('donation/sub mapping: YouTube Super Chat + membership, Twitch bits + subs', () => {
  const { YouTube } = require('../src/main/platforms/youtube');
  const { Twitch, parseLine } = require('../src/main/platforms/twitch');
  const y = new YouTube(); const out = []; y.publish = (e) => out.push(e);
  y.map({ snippet: { type: 'superChatEvent', superChatDetails: { amountMicros: 25000000, currency: 'ILS', userComment: 'כל הכבוד' } }, authorDetails: { channelId: 'c1', displayName: 'Dana' } });
  y.map({ snippet: { type: 'newSponsorEvent', displayMessage: 'new member' }, authorDetails: { channelId: 'c2', displayName: 'Ron' } });
  assert.deepEqual(out.map((e) => [e.type, e.user.name, e.amount, e.currency]), [['superchat', 'Dana', 25, 'ILS'], ['sub', 'Ron', undefined, undefined]]);
  const tw = new Twitch(); const o2 = []; tw.publish = (e) => o2.push(e); tw.ws = { send() {} };
  tw.handle(parseLine('@bits=500;display-name=Maya;user-id=7;badges= :maya!maya@maya.tmi.twitch.tv PRIVMSG #c :Cheer500 go!'));
  tw.handle(parseLine('@msg-id=sub;display-name=Tal;user-id=8;msg-param-cumulative-months=3 :tmi.twitch.tv USERNOTICE #c :hi'));
  assert.deepEqual(o2.map((e) => [e.type, e.user.name, e.amount ?? e.count]), [['bits', 'Maya', 500], ['sub', 'Tal', 3]]);
});
