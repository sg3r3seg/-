'use strict';
// Minimal stand-in for platform OAuth servers (authorize / token / profile / revoke),
// used by automated tests. Verifies client credentials and PKCE like the real ones.
const http = require('node:http');
const crypto = require('node:crypto');

function createMock() {
  const m = { codes: new Map(), revoked: [], mode: 'allow', tokenMode: 'ok', refreshMode: 'ok', issued: 0, port: 0 };
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => r(new URLSearchParams(b))); });
  m.server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const [, prov, action] = u.pathname.split('/');
    if (action === 'authorize') {
      const q = u.searchParams; const redirect = new URL(q.get('redirect_uri'));
      redirect.searchParams.set('state', q.get('state'));
      if (m.mode === 'deny') redirect.searchParams.set('error', 'access_denied');
      else {
        const code = crypto.randomBytes(8).toString('hex');
        m.codes.set(code, { prov, challenge: q.get('code_challenge'), clientId: q.get('client_id') || q.get('client_key'), scope: q.get('scope') });
        redirect.searchParams.set('code', code);
      }
      res.writeHead(302, { Location: redirect.toString() }); return res.end();
    }
    if (action === 'token') {
      const p = await body(req);
      if ((p.get('client_secret') || '') !== `secret-${prov}`) return send(res, 401, { error: 'invalid_client' });
      if (m.tokenMode === 'fail') return send(res, 500, { error: 'server_error' });
      if (p.get('grant_type') === 'refresh_token') {
        if (m.refreshMode === 'revoked' || !String(p.get('refresh_token')).startsWith('rt-')) return send(res, 400, { error: 'invalid_grant' });
        m.issued += 1; return send(res, 200, { access_token: `at-${prov}-r${m.issued}`, expires_in: 3600, token_type: 'bearer' });
      }
      const c = m.codes.get(p.get('code')); m.codes.delete(p.get('code'));
      if (!c) return send(res, 400, { error: 'invalid_grant' });
      if (c.challenge) {
        const v = p.get('code_verifier') || '';
        if (crypto.createHash('sha256').update(v).digest('base64url') !== c.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE failed' });
      }
      m.issued += 1;
      const tok = { access_token: `at-${prov}-${m.issued}`, refresh_token: `rt-${prov}-${m.issued}`, expires_in: 3600, scope: c.scope };
      if (prov === 'discord') tok.webhook = { url: 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz' };
      return send(res, 200, tok);
    }
    if (action === 'profile') {
      if (!/^Bearer at-/.test(req.headers.authorization || '')) return send(res, 401, { error: 'unauthorized' });
      const shapes = {
        google: { items: [{ id: 'UC123', snippet: { title: 'Shay Live', thumbnails: { default: { url: 'https://yt3.example/a.jpg' } } } }] },
        twitch: { data: [{ id: '42', login: 'shaylive', display_name: 'ShayLive', profile_image_url: 'https://static-cdn.example/p.png' }] },
        kick: { data: [{ user_id: 7, name: 'shaykick', profile_picture: 'https://kick.example/p.png' }] },
        tiktok: { data: { user: { open_id: 'tt1', display_name: 'Shay TikTok', username: 'shay_tt', avatar_url: 'https://p16.example/a.jpeg' } } },
        discord: { id: '99', username: 'shay', global_name: 'Shay', avatar: 'abc' },
      };
      return send(res, 200, shapes[prov]);
    }
    if (action === 'revoke') {
      const p = await body(req); m.revoked.push({ prov, token: p.get('token') || u.searchParams.get('token') }); return send(res, 200, {});
    }
    send(res, 404, {});
  });
  m.listen = () => new Promise((r) => m.server.listen(0, '127.0.0.1', () => { m.port = m.server.address().port; r(m); }));
  m.env = () => {
    const env = {};
    for (const p of ['google', 'twitch', 'kick', 'tiktok', 'discord']) {
      const P = p.toUpperCase(); const b = `http://127.0.0.1:${m.port}/${p}`;
      Object.assign(env, { [`OAUTH_${P}_CLIENT_ID`]: `client-${p}`, [`OAUTH_${P}_CLIENT_SECRET`]: `secret-${p}`, [`OAUTH_${P}_AUTHORIZE_URL`]: `${b}/authorize`, [`OAUTH_${P}_TOKEN_URL`]: `${b}/token`, [`OAUTH_${P}_PROFILE_URL`]: `${b}/profile`, [`OAUTH_${P}_REVOKE_URL`]: `${b}/revoke` });
    }
    return env;
  };
  return m;
}
module.exports = { createMock };
