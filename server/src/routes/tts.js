'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const { h, fail, str } = require('../http');
const { requireAuth, requireVerified, requireApp } = require('../middleware');
const { limiter } = require('../ratelimit');

// AI voice proxy. The provider API key stays on the server. Every request
// re-checks the TTS entitlement in the database (not only the token).
const r = express.Router();
r.use(requireAuth, requireVerified, requireApp);
r.use((req, _res, next) => {
  const rows = db.get().prepare(`SELECT l.entitlements FROM licenses l JOIN devices d ON d.license_id=l.id
    WHERE l.user_id=? AND l.status='active' AND d.status='active' AND d.device_uid=?`).all(req.user.id, req.token.dev);
  if (!rows.some((x) => JSON.parse(x.entitlements).includes('tts'))) {
    return next(Object.assign(new Error('LiveX TTS license required'), { status: 403, code: 'TTS_NOT_LICENSED' }));
  }
  next();
});
const C = require('../crypto');

// ---- ElevenLabs ------------------------------------------------------------------
// Voices come from the creator's OWN ElevenLabs account, connected in the app (Voice
// Studio). The key is stored only here, encrypted; every call goes through this server.
// If a creator has not connected an account and the server has a LiveX key configured,
// that key is a fallback limited to premade voices + voices this creator cloned.
const XI = () => `${(!config.production && config.ai.elevenLabsBase) || 'https://api.elevenlabs.io'}/v1`;
const own = (userId) => db.get().prepare('SELECT * FROM elevenlabs_accounts WHERE user_id=?').get(userId);
function provider(req) {
  const a = own(req.user.id);
  if (a) return { via: 'own', key: C.decrypt(a.key_enc), account: a };
  if (config.ai.elevenLabsKey) return { via: 'livex', key: config.ai.elevenLabsKey };
  return null;
}
const requireProvider = (req, _res, next) => {
  req.xi = provider(req);
  if (!req.xi) return next(Object.assign(new Error('Connect your ElevenLabs account in Voice Studio to use AI voices'), { status: 503, code: 'ELEVENLABS_NOT_CONNECTED' }));
  next();
};
async function xi(key, method, path, { json, form, accept } = {}) {
  const res = await fetch(`${XI()}${path}`, {
    method, signal: AbortSignal.timeout(60000),
    headers: { 'xi-api-key': key, Accept: accept || 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  }).catch(() => fail(502, 'ELEVENLABS_UNREACHABLE', 'ElevenLabs could not be reached. Try again.'));
  if (res.ok) return res;
  const j = await res.json().catch(() => ({}));
  const st = j?.detail?.status || j?.detail?.code || '';
  const msg = (typeof j?.detail === 'string' ? j.detail : j?.detail?.message) || `ElevenLabs error ${res.status}`;
  // Never answer 401 here: in the app a 401 means "LiveX session expired".
  if (/quota|credits|limit/i.test(st + msg) || res.status === 429) fail(429, 'ELEVENLABS_QUOTA', `ElevenLabs: ${msg}`);
  if (res.status === 401 || /invalid_api_key|unauthorized/i.test(st)) fail(409, 'ELEVENLABS_KEY_INVALID', 'ElevenLabs did not accept the API key. Connect the account again with a valid key.');
  if (/missing_permissions/i.test(st)) fail(409, 'ELEVENLABS_PERMISSION', `ElevenLabs: this API key is missing a permission (${msg})`);
  fail(502, 'ELEVENLABS_ERROR', `ElevenLabs: ${msg}`);
}
const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
const isHebrew = (t) => /[֐-׿]/.test(t);
const voiceView = (v) => ({ id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url || null, labels: v.labels || {} });
const modelCache = new Map(); // key hash -> { at, models }
async function models(key) {
  const k = C.sha256(key); const c = modelCache.get(k);
  if (c && Date.now() - c.at < 3600_000) return c.models;
  const list = await (await xi(key, 'GET', '/models')).json();
  const out = (Array.isArray(list) ? list : []).filter((m) => m.can_do_text_to_speech).map((m) => ({
    id: m.model_id, name: m.name, maxChars: m.maximum_text_length_per_request || null,
    languages: (m.languages || []).map((l) => l.language_id), hebrew: (m.languages || []).some((l) => /^(he|heb|iw)$/i.test(l.language_id) || /hebrew/i.test(l.name || '')),
  }));
  modelCache.set(k, { at: Date.now(), models: out });
  return out;
}

r.get('/ai/status', h(async (req, res) => {
  const a = own(req.user.id);
  res.json({
    provider: 'elevenlabs', configured: !!(a || config.ai.elevenLabsKey), via: a ? 'own' : config.ai.elevenLabsKey ? 'livex' : null,
    account: a ? { connected: true, name: a.account_name, tier: a.tier, keyHint: a.key_hint, connectedAt: a.connected_at } : { connected: false },
  });
}));

// Connect / replace the creator's ElevenLabs account (key from elevenlabs.io → API Keys).
r.post('/ai/connect', limiter('xi-connect', 10, 600_000, (req) => req.user.id), h(async (req, res) => {
  const key = str(req.body?.apiKey, { min: 20, max: 200, name: 'apiKey', pattern: /^[A-Za-z0-9_-]+$/ });
  await xi(key, 'GET', '/voices'); // proves the key works (needs the Voices: read permission)
  let name = null; let tier = null;
  try { const u = await (await xi(key, 'GET', '/user')).json(); name = u.first_name || null; tier = u.subscription?.tier || null; } catch { /* key without user_read: fine */ }
  db.get().prepare(`INSERT INTO elevenlabs_accounts(user_id,key_enc,key_hint,account_name,tier,connected_at,last_ok_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET key_enc=excluded.key_enc, key_hint=excluded.key_hint, account_name=excluded.account_name, tier=excluded.tier, connected_at=excluded.connected_at, last_ok_at=excluded.last_ok_at`)
    .run(req.user.id, C.encrypt(key), key.slice(-4), name, tier, db.now(), db.now());
  db.audit(req.user.id, 'elevenlabs_connected', { tier });
  res.json({ connected: true, name, tier, keyHint: key.slice(-4) });
}));
r.post('/ai/disconnect', h(async (req, res) => {
  db.get().prepare('DELETE FROM elevenlabs_accounts WHERE user_id=?').run(req.user.id);
  db.audit(req.user.id, 'elevenlabs_disconnected', {});
  res.json({ connected: false });
}));

// The creator's voices. Shared LiveX key: only premade voices + this creator's own clones.
r.get('/ai/voices', requireProvider, h(async (req, res) => {
  const j = await (await xi(req.xi.key, 'GET', '/voices')).json();
  let voices = (j.voices || []).map(voiceView);
  if (req.xi.via === 'livex') {
    const mine = new Set(db.get().prepare('SELECT provider_voice_id FROM voice_consents WHERE user_id=?').all(req.user.id).map((x) => x.provider_voice_id));
    voices = voices.filter((v) => v.category === 'premade' || mine.has(v.id));
  }
  res.json({ via: req.xi.via, voices });
}));

r.get('/ai/models', requireProvider, h(async (req, res) => res.json({ models: await models(req.xi.key) })));

// ElevenLabs Voice Library (shared community voices) — search and add to the creator's account.
r.get('/ai/library', requireProvider, limiter('xi-lib', 120, 600_000, (req) => req.user.id), h(async (req, res) => {
  if (req.xi.via !== 'own') fail(409, 'ELEVENLABS_OWN_ACCOUNT_REQUIRED', 'Connect your own ElevenLabs account to add voices from the ElevenLabs library');
  const q = new URLSearchParams({ page_size: '30' });
  const search = String(req.query.search || '').slice(0, 80).trim(); if (search) q.set('search', search);
  const lang = String(req.query.language || '').slice(0, 8); if (/^[a-z]{2,3}$/.test(lang)) q.set('language', lang);
  const gender = String(req.query.gender || ''); if (['male', 'female', 'neutral'].includes(gender)) q.set('gender', gender);
  const j = await (await xi(req.xi.key, 'GET', `/shared-voices?${q}`)).json();
  res.json({ voices: (j.voices || []).map((v) => ({ id: v.voice_id, publicOwnerId: v.public_owner_id, name: v.name, previewUrl: v.preview_url || null, language: v.language || null, accent: v.accent || null, gender: v.gender || null, age: v.age || null, useCase: v.use_case || null, description: String(v.description || '').slice(0, 300) })), hasMore: !!j.has_more });
}));
r.post('/ai/library/add', requireProvider, limiter('xi-lib-add', 30, 3600_000, (req) => req.user.id), h(async (req, res) => {
  if (req.xi.via !== 'own') fail(409, 'ELEVENLABS_OWN_ACCOUNT_REQUIRED', 'Connect your own ElevenLabs account to add voices from the ElevenLabs library');
  const owner = str(req.body?.publicOwnerId, { min: 8, max: 100, name: 'publicOwnerId', pattern: /^[A-Za-z0-9]+$/ });
  const voiceId = str(req.body?.voiceId, { min: 8, max: 64, name: 'voiceId', pattern: VOICE_ID });
  const name = str(req.body?.name, { min: 1, max: 60, name: 'name' });
  const j = await (await xi(req.xi.key, 'POST', `/voices/add/${owner}/${voiceId}`, { json: { new_name: name } })).json();
  res.json({ voiceId: j.voice_id, name });
}));

r.post('/ai/synthesize', requireProvider, limiter('tts-synth', 60, 60_000, (req) => req.user.id), h(async (req, res) => {
  const text = str(req.body?.text, { min: 1, max: 500, name: 'text' });
  const voiceId = str(req.body?.voiceId, { min: 1, max: 64, name: 'voiceId', pattern: /^[A-Za-z0-9]+$/ });
  if (req.xi.via === 'livex') { // shared key: never let one creator use another creator's clone
    const mine = db.get().prepare('SELECT 1 FROM voice_consents WHERE user_id=? AND provider_voice_id=?').get(req.user.id, voiceId);
    if (!mine) { const v = (await (await xi(req.xi.key, 'GET', '/voices')).json()).voices?.find((x) => x.voice_id === voiceId); if (!v || v.category !== 'premade') fail(403, 'VOICE_NOT_ALLOWED', 'This voice is not available to your account'); }
  }
  // Model: the one chosen in the app if the account has it; for Hebrew text a model that
  // the account reports as supporting Hebrew; otherwise the server default.
  let model = String(req.body?.modelId || '').slice(0, 60);
  let list = [];
  try { list = await models(req.xi.key); } catch { /* fall back to default */ }
  if (model && list.length && !list.some((m) => m.id === model)) model = '';
  if (!model && isHebrew(text)) model = list.find((m) => m.hebrew)?.id || '';
  if (!model) model = config.ai.elevenLabsModel;
  const resp = await xi(req.xi.key, 'POST', `/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { json: { text, model_id: model }, accept: 'audio/mpeg' });
  if (req.xi.via === 'own') db.get().prepare('UPDATE elevenlabs_accounts SET last_ok_at=? WHERE user_id=?').run(db.now(), req.user.id);
  res.set('Content-Type', 'audio/mpeg'); res.set('X-LiveX-Model', model);
  res.send(Buffer.from(await resp.arrayBuffer()));
}));

// Create a voice from a recording / uploaded sample (Instant Voice Cloning) in the creator's
// ElevenLabs account. Requires explicit consent of the voice owner; the consent is recorded.
r.post('/ai/clone', requireProvider, limiter('tts-clone', 5, 3600_000, (req) => req.user.id),
  express.json({ limit: '15mb' }), h(async (req, res) => {
    const b = req.body || {};
    if (b.consent !== true) fail(400, 'CONSENT_REQUIRED', 'Explicit consent of the voice owner is required');
    const owner = str(b.voiceOwnerName, { min: 2, max: 100, name: 'voiceOwnerName' });
    const statement = str(b.consentStatement, { min: 10, max: 1000, name: 'consentStatement' });
    const name = str(b.name, { min: 1, max: 60, name: 'name' });
    const audio = Buffer.from(String(b.audioBase64 || ''), 'base64');
    if (audio.length < 10_000 || audio.length > 10 * 1024 * 1024) fail(400, 'VALIDATION', 'Recording must be between 10KB and 10MB');
    const mime = /^audio\/[\w.+-]+$/.test(String(b.mimeType || '')) ? b.mimeType : 'audio/webm';
    const ext = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' }[mime] || 'webm';
    const form = new FormData();
    form.append('name', name);
    form.append('description', `Created in LiveX. Voice owner consent: ${owner}`);
    form.append('remove_background_noise', 'true');
    form.append('files', new Blob([audio], { type: mime }), `sample.${ext}`);
    const j = await (await xi(req.xi.key, 'POST', '/voices/add', { form })).json();
    db.get().prepare('INSERT INTO voice_consents(user_id,voice_owner_name,statement,provider_voice_id,ip,created_at) VALUES(?,?,?,?,?,?)')
      .run(req.user.id, owner, statement, j.voice_id, req.ip, db.now());
    res.json({ voiceId: j.voice_id, via: req.xi.via });
  }));

module.exports = r;
