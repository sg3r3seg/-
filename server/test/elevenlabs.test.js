'use strict';
// ElevenLabs voices: the creator connects their own account in the app; everything goes
// through the server, which keeps the key encrypted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createXiMock } = require('./elevenlabs-mock');
const { start, client, newDeviceUid } = require('./helpers');

let srv; let call; let xi; let A; let B; let noTts;
const KEY = 'k-creatorKey123456789abcd';
async function account(first, product) {
  const email = `${first.toLowerCase()}-${Date.now()}@example.com`; const password = 'Str0ngPass!1'; const device = newDeviceUid();
  await call('POST', '/api/auth/register', { body: { firstName: first, lastName: 'T', email, password } });
  const tok = /#token=([\w-]+)/.exec(srv.mailer.readOutbox().filter((m) => m.to === email && m.tag === 'verify').pop().text)[1];
  await call('POST', '/api/auth/verify-email', { body: { token: tok } });
  const web = (await call('POST', '/api/auth/login', { body: { email, password, client: 'web' } })).body.accessToken;
  const app = (await call('POST', '/api/auth/login', { body: { email, password, client: 'app', device: { uid: device, name: 'PC', os: 'Windows 11' } } })).body.accessToken;
  if (product) {
    const co = await call('POST', '/api/shop/checkout', { token: web, body: { product } });
    await call('POST', '/api/payments/sandbox/complete', { token: web, body: { orderId: co.body.orderId } });
    const code = /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(srv.mailer.readOutbox().filter((m) => m.to === email && m.tag === 'activation').pop().text)[1];
    await call('POST', '/api/app/activate', { token: app, device, body: { code, device: { name: 'PC', os: 'Windows 11' } } });
  }
  return (m, u, body) => call(m, u, { token: app, device, body });
}
test.before(async () => {
  xi = await createXiMock().listen();
  process.env.ELEVENLABS_API_URL = `http://127.0.0.1:${xi.port}`;
  srv = await start(); call = client(srv.base);
  require('../src/config').ai.elevenLabsBase = `http://127.0.0.1:${xi.port}`;
  A = await account('Shay', 'TTS'); B = await account('Eve', 'BUNDLE'); noTts = await account('Pro', 'PRO');
});
test.after(async () => { await srv.stop(); xi.server.close(); });

test('not connected: clear status and message; TTS license required', async () => {
  const s = (await A('GET', '/api/tts/ai/status')).body;
  assert.equal(s.configured, false); assert.equal(s.account.connected, false);
  const v = await A('GET', '/api/tts/ai/voices');
  assert.equal(v.status, 503); assert.equal(v.body.error, 'ELEVENLABS_NOT_CONNECTED');
  assert.equal((await noTts('POST', '/api/tts/ai/connect', { apiKey: KEY })).body.error, 'TTS_NOT_LICENSED');
});

test('connect: bad key refused (409, not 401); good key stored encrypted, only last 4 chars shown', async () => {
  const bad = await A('POST', '/api/tts/ai/connect', { apiKey: 'k-wrong' + '!'.repeat(0) + 'x'.repeat(2) });
  assert.equal(bad.status, 400, 'format check');
  const bad2 = await A('POST', '/api/tts/ai/connect', { apiKey: 'zz-not-a-valid-key-1234567' });
  assert.equal(bad2.status, 409); assert.equal(bad2.body.error, 'ELEVENLABS_KEY_INVALID');
  const ok = await A('POST', '/api/tts/ai/connect', { apiKey: KEY });
  assert.equal(ok.status, 200); assert.deepEqual([ok.body.name, ok.body.tier, ok.body.keyHint], ['Shay', 'creator', 'abcd']);
  const st = (await A('GET', '/api/tts/ai/status')).body;
  assert.equal(st.via, 'own'); assert.equal(st.account.keyHint, 'abcd'); assert.ok(!JSON.stringify(st).includes(KEY));
  const row = require('../src/db').get().prepare('SELECT key_enc FROM elevenlabs_accounts').get();
  assert.ok(!row.key_enc.includes(KEY), 'key encrypted at rest');
  const np = await B('POST', '/api/tts/ai/connect', { apiKey: 'k-noperm-key-123456789xyz' });
  assert.equal(np.status, 200, 'a key without user_read permission still connects'); assert.equal(np.body.name, null);
});

test('my voices, library search + add, models with Hebrew', async () => {
  const v = (await A('GET', '/api/tts/ai/voices')).body;
  assert.equal(v.via, 'own'); assert.deepEqual(v.voices.map((x) => x.name), ['Rachel']);
  const lib = (await A('GET', '/api/tts/ai/library?search=noa')).body.voices;
  assert.equal(lib.length, 1); assert.equal(lib[0].language, 'he'); assert.equal(lib[0].publicOwnerId, 'owner0000001');
  const add = await A('POST', '/api/tts/ai/library/add', { publicOwnerId: lib[0].publicOwnerId, voiceId: lib[0].id, name: 'Noa HE' });
  assert.equal(add.status, 200);
  assert.ok((await A('GET', '/api/tts/ai/voices')).body.voices.some((x) => x.id === add.body.voiceId && x.name === 'Noa HE'));
  const models = (await A('GET', '/api/tts/ai/models')).body.models;
  assert.deepEqual(models.map((x) => [x.id, x.hebrew]), [['eleven_multilingual_v2', false], ['eleven_v3', true]], 'only TTS models listed');
});

test('speech: Hebrew text uses a model that supports Hebrew; chosen model is respected', async () => {
  const voice = (await A('GET', '/api/tts/ai/voices')).body.voices.find((x) => x.name === 'Noa HE').id;
  const he = await A('POST', '/api/tts/ai/synthesize', { text: 'תודה על המתנה!', voiceId: voice });
  assert.equal(he.status, 200); assert.equal(xi.synth.at(-1).model, 'eleven_v3');
  await A('POST', '/api/tts/ai/synthesize', { text: 'Thanks for the gift!', voiceId: voice });
  assert.equal(xi.synth.at(-1).model, 'eleven_multilingual_v2', 'server default for English');
  await A('POST', '/api/tts/ai/synthesize', { text: 'Thanks!', voiceId: voice, modelId: 'eleven_v3' });
  assert.equal(xi.synth.at(-1).model, 'eleven_v3');
  await A('POST', '/api/tts/ai/synthesize', { text: 'Thanks!', voiceId: voice, modelId: 'not_a_model' });
  assert.equal(xi.synth.at(-1).model, 'eleven_multilingual_v2', 'unknown model ignored');
  assert.equal(xi.synth.at(-1).key, KEY, "the creator's own key is used");
});

test('upload / record a sample -> new voice in the creator account (consent required)', async () => {
  const audio = Buffer.alloc(20_000, 7).toString('base64');
  assert.equal((await A('POST', '/api/tts/ai/clone', { name: 'My voice', voiceOwnerName: 'Shay', consentStatement: 'I am the owner of this voice', audioBase64: audio, mimeType: 'audio/mpeg' })).body.error, 'CONSENT_REQUIRED');
  const r = await A('POST', '/api/tts/ai/clone', { name: 'My voice', voiceOwnerName: 'Shay', consentStatement: 'I am the owner of this voice', consent: true, audioBase64: audio, mimeType: 'audio/mpeg' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.via, 'own');
  assert.ok((await A('GET', '/api/tts/ai/voices')).body.voices.some((x) => x.id === r.body.voiceId && x.name === 'My voice'));
});

test('out of ElevenLabs credits -> clear 429 message (not a sign-out)', async () => {
  await B('POST', '/api/tts/ai/connect', { apiKey: 'k-quota-key-123456789xyzw' });
  const r = await B('POST', '/api/tts/ai/synthesize', { text: 'hi', voiceId: 'premade00001' });
  assert.equal(r.status, 429); assert.equal(r.body.error, 'ELEVENLABS_QUOTA'); assert.match(r.body.message, /quota/);
});

test('shared LiveX key fallback never exposes or speaks other creators\' voices', async () => {
  const cfg = require('../src/config'); const saved = cfg.ai.elevenLabsKey; cfg.ai.elevenLabsKey = 'k-livexSharedKey123456789';
  try {
    xi.accounts.set('k-livexSharedKey123456789', [{ voice_id: 'premade00001', name: 'Rachel', category: 'premade' }, { voice_id: 'otherclone01', name: 'Someone else clone', category: 'cloned' }]);
    const C2 = await account('Zed', 'TTS');
    const v = (await C2('GET', '/api/tts/ai/voices')).body;
    assert.equal(v.via, 'livex'); assert.deepEqual(v.voices.map((x) => x.id), ['premade00001']);
    assert.equal((await C2('POST', '/api/tts/ai/synthesize', { text: 'hi', voiceId: 'otherclone01' })).body.error, 'VOICE_NOT_ALLOWED');
    assert.equal((await C2('GET', '/api/tts/ai/library')).body.error, 'ELEVENLABS_OWN_ACCOUNT_REQUIRED');
  } finally { cfg.ai.elevenLabsKey = saved; }
});

test('disconnect removes the key', async () => {
  assert.equal((await A('POST', '/api/tts/ai/disconnect', {})).body.connected, false);
  assert.equal((await A('GET', '/api/tts/ai/status')).body.account.connected, false);
  assert.equal(require('../src/db').get().prepare('SELECT COUNT(*) AS n FROM elevenlabs_accounts WHERE key_hint=?').get('abcd').n, 0);
});

test('free account blocked by ElevenLabs is NOT reported as a bad key; reasons pass through', async () => {
  const F = await account('Free', 'TTS');
  const c = await F('POST', '/api/tts/ai/connect', { apiKey: '  "k-free-key-123456789abcdz"\n' });
  assert.equal(c.status, 200, 'pasted key with spaces/quotes/newline is cleaned');
  const sp = await F('POST', '/api/tts/ai/synthesize', { text: 'שלום', voiceId: 'premade00001' });
  assert.equal(sp.status, 409); assert.equal(sp.body.error, 'ELEVENLABS_FREE_BLOCKED');
  assert.equal(sp.body.provider.status, 'detected_unusual_activity'); assert.match(sp.body.provider.message, /Free Tier usage disabled/);
  const cl = await F('POST', '/api/tts/ai/clone', { name: 'v', voiceOwnerName: 'Free', consentStatement: 'I own this voice ok', consent: true, audioBase64: Buffer.alloc(20000, 1).toString('base64'), mimeType: 'audio/mpeg' });
  assert.equal(cl.body.error, 'ELEVENLABS_PLAN_REQUIRED'); assert.match(cl.body.provider.message, /instant voice cloning/);
  const d = (await F('POST', '/api/tts/ai/diagnose', {})).body;
  const by = Object.fromEntries(d.steps.map((x) => [x.id, x]));
  assert.ok(by.connected.ok && by.voices.ok && by.user.ok && by.models.ok);
  assert.equal(by.speech.ok, false); assert.equal(by.speech.code, 'ELEVENLABS_FREE_BLOCKED'); assert.equal(by.speech.providerStatus, 'detected_unusual_activity');
});

test('diagnose on a healthy account: every step passes, including a short speech test', async () => {
  const G = await account('Good', 'TTS');
  await G('POST', '/api/tts/ai/connect', { apiKey: 'k-good-key-123456789abcdef' });
  const d = (await G('POST', '/api/tts/ai/diagnose', {})).body;
  assert.deepEqual(d.steps.map((x) => [x.id, x.ok]), [['connected', true], ['reach', true], ['voices', true], ['user', true], ['models', true], ['speech', true]]);
  assert.match(d.steps.at(-1).detail, /eleven_v3/);
});
