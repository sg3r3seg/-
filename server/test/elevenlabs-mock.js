'use strict';
// Stand-in for the ElevenLabs API (same paths / shapes / error bodies), for automated tests.
const http = require('node:http');

function createXiMock() {
  const premade = [{ voice_id: 'premade00001', name: 'Rachel', category: 'premade', preview_url: 'https://xi.example/p1.mp3', labels: { accent: 'american' } }];
  const m = { accounts: new Map(), synth: [], port: 0 };
  // keys: 'k-…' valid; 'k-quota…' valid but out of credits; 'k-noperm…' valid without user_read
  const acct = (key) => { if (!m.accounts.has(key)) m.accounts.set(key, [...premade]); return m.accounts.get(key); };
  const valid = (key) => /^k-[A-Za-z0-9_-]{18,}$/.test(key || '');
  const library = [
    { voice_id: 'libvoice0001', public_owner_id: 'owner0000001', name: 'Noa — Hebrew narrator', preview_url: 'https://xi.example/l1.mp3', language: 'he', accent: 'israeli', gender: 'female', age: 'young', use_case: 'narrative_story', description: 'Warm Hebrew voice' },
    { voice_id: 'libvoice0002', public_owner_id: 'owner0000002', name: 'Max — Gamer', preview_url: 'https://xi.example/l2.mp3', language: 'en', accent: 'american', gender: 'male', age: 'young', use_case: 'characters', description: 'Energetic' },
  ];
  const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };
  const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  m.server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const key = req.headers['xi-api-key'];
    if (!valid(key)) return send(res, 401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
    const voices = acct(key); const p = u.pathname;
    if (req.method === 'GET' && p === '/v1/voices') return send(res, 200, { voices });
    if (req.method === 'GET' && p === '/v1/user') return key.startsWith('k-noperm') ? send(res, 401, { detail: { status: 'missing_permissions', message: 'The API key is missing the permission user_read' } }) : send(res, 200, { first_name: 'Shay', subscription: { tier: 'creator' } });
    if (req.method === 'GET' && p === '/v1/models') return send(res, 200, [
      { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true, maximum_text_length_per_request: 10000, languages: [{ language_id: 'en', name: 'English' }, { language_id: 'es', name: 'Spanish' }] },
      { model_id: 'eleven_v3', name: 'Eleven v3', can_do_text_to_speech: true, maximum_text_length_per_request: 5000, languages: [{ language_id: 'en', name: 'English' }, { language_id: 'he', name: 'Hebrew' }] },
      { model_id: 'eleven_english_sts_v2', name: 'STS', can_do_text_to_speech: false, languages: [] },
    ]);
    if (req.method === 'GET' && p === '/v1/shared-voices') { const q = (u.searchParams.get('search') || '').toLowerCase(); const lang = u.searchParams.get('language'); return send(res, 200, { voices: library.filter((v) => (!q || v.name.toLowerCase().includes(q)) && (!lang || v.language === lang)), has_more: false }); }
    let mm = /^\/v1\/voices\/add\/([^/]+)\/([^/]+)$/.exec(p);
    if (req.method === 'POST' && mm) {
      const b = JSON.parse((await body(req)).toString() || '{}'); const lib = library.find((v) => v.voice_id === mm[2] && v.public_owner_id === mm[1]);
      if (!lib) return send(res, 400, { detail: { status: 'voice_not_found', message: 'Shared voice not found' } });
      const id = `added${mm[2].slice(-7)}`; voices.push({ voice_id: id, name: b.new_name, category: 'professional', preview_url: lib.preview_url }); return send(res, 200, { voice_id: id });
    }
    if (req.method === 'POST' && p === '/v1/voices/add' && key.startsWith('k-free')) return send(res, 401, { detail: { status: 'can_not_use_instant_voice_cloning', message: 'Your subscription has no access to use instant voice cloning, please upgrade.' } });
    if (req.method === 'POST' && p === '/v1/voices/add') {
      const raw = await body(req); const ct = req.headers['content-type'] || '';
      if (!ct.startsWith('multipart/form-data') || raw.length < 10_000) return send(res, 400, { detail: { status: 'invalid_request', message: 'files required' } });
      const name = /name="name"\r\n\r\n([^\r]*)/.exec(raw.toString('utf8'))?.[1] || 'Voice';
      const id = `clone${String(voices.length).padStart(7, '0')}`; voices.push({ voice_id: id, name, category: 'cloned', preview_url: null }); return send(res, 200, { voice_id: id, requires_verification: false });
    }
    mm = /^\/v1\/text-to-speech\/([^/]+)$/.exec(p);
    if (req.method === 'POST' && mm) {
      if (key.startsWith('k-quota')) return send(res, 401, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 10000. You have 3 credits remaining.' } });
      if (key.startsWith('k-free')) return send(res, 401, { detail: { status: 'detected_unusual_activity', message: 'Unusual activity detected. Free Tier usage disabled.' } });
      const b = JSON.parse((await body(req)).toString());
      if (!voices.some((v) => v.voice_id === mm[1])) return send(res, 404, { detail: { status: 'voice_not_found', message: 'A voice with the voice_id was not found.' } });
      m.synth.push({ key, voice: mm[1], model: b.model_id, text: b.text });
      return send(res, 200, Buffer.from(`ID3-mp3-${mm[1]}-${b.model_id}`), 'audio/mpeg');
    }
    send(res, 404, { detail: 'Not found' });
  });
  m.listen = () => new Promise((r) => m.server.listen(0, '127.0.0.1', () => { m.port = m.server.address().port; r(m); }));
  return m;
}
module.exports = { createXiMock };
