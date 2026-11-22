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
const requireProvider = (_req, _res, next) => {
  if (!config.ai.elevenLabsKey) return next(Object.assign(new Error('AI voice provider is not configured on the server'), { status: 503, code: 'AI_PROVIDER_NOT_CONFIGURED' }));
  next();
};
const XI = 'https://api.elevenlabs.io/v1';
const xiHeaders = () => ({ 'xi-api-key': config.ai.elevenLabsKey });

r.get('/ai/status', h(async (_req, res) => res.json({ provider: 'elevenlabs', configured: !!config.ai.elevenLabsKey })));

r.get('/ai/voices', requireProvider, h(async (_req, res) => {
  const resp = await fetch(`${XI}/voices`, { headers: xiHeaders() });
  if (!resp.ok) fail(502, 'PROVIDER_ERROR', `Voice provider error ${resp.status}`);
  const j = await resp.json();
  res.json({ voices: (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url, labels: v.labels })) });
}));

r.post('/ai/synthesize', requireProvider, limiter('tts-synth', 60, 60_000, (req) => req.user.id), h(async (req, res) => {
  const text = str(req.body?.text, { min: 1, max: 500, name: 'text' });
  const voiceId = str(req.body?.voiceId, { min: 1, max: 64, name: 'voiceId', pattern: /^[A-Za-z0-9]+$/ });
  const resp = await fetch(`${XI}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { ...xiHeaders(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: config.ai.elevenLabsModel }),
  });
  if (!resp.ok) fail(502, 'PROVIDER_ERROR', `Voice provider error ${resp.status}`);
  res.set('Content-Type', 'audio/mpeg');
  res.send(Buffer.from(await resp.arrayBuffer()));
}));

// Voice cloning requires explicit consent of the voice owner; the consent is recorded.
r.post('/ai/clone', requireProvider, limiter('tts-clone', 5, 3600_000, (req) => req.user.id),
  express.json({ limit: '15mb' }), h(async (req, res) => {
    const b = req.body || {};
    if (b.consent !== true) fail(400, 'CONSENT_REQUIRED', 'Explicit consent of the voice owner is required');
    const owner = str(b.voiceOwnerName, { min: 2, max: 100, name: 'voiceOwnerName' });
    const statement = str(b.consentStatement, { min: 10, max: 1000, name: 'consentStatement' });
    const name = str(b.name, { min: 1, max: 60, name: 'name' });
    const audio = Buffer.from(String(b.audioBase64 || ''), 'base64');
    if (audio.length < 10_000 || audio.length > 10 * 1024 * 1024) fail(400, 'VALIDATION', 'Recording must be between 10KB and 10MB');
    const form = new FormData();
    form.append('name', name);
    form.append('description', `LiveX clone. Owner consent: ${owner}`);
    form.append('files', new Blob([audio], { type: String(b.mimeType || 'audio/webm') }), 'sample.webm');
    const resp = await fetch(`${XI}/voices/add`, { method: 'POST', headers: xiHeaders(), body: form });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) fail(502, 'PROVIDER_ERROR', j?.detail?.message || `Voice provider error ${resp.status}`);
    db.get().prepare('INSERT INTO voice_consents(user_id,voice_owner_name,statement,provider_voice_id,ip,created_at) VALUES(?,?,?,?,?,?)')
      .run(req.user.id, owner, statement, j.voice_id, req.ip, db.now());
    res.json({ voiceId: j.voice_id });
  }));

module.exports = r;
