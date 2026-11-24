'use strict';
// Official OAuth for connecting creators' platform accounts.
//
// Flow (server-mediated, so client secrets never leave the server):
//  1. The desktop app calls start() -> gets the provider's official authorize URL
//     and opens it in the user's own browser (Google & co. block embedded webviews).
//  2. The provider redirects to <PUBLIC_URL>/api/oauth/callback/<provider>; the server
//     verifies `state`, exchanges the code (with PKCE where supported) and loads the profile.
//  3. The app polls poll(); the tokens are handed over exactly once and then deleted
//     from the server. The app stores them encrypted with the OS keychain (DPAPI).
// Refresh and revoke also go through the server because they need the client secret.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const C = require('../crypto');
const { fail } = require('../http');

const FLOW_TTL = 10 * 60_000;
const b64url = (b) => Buffer.from(b).toString('base64url');

// platform -> provider definition
const PROVIDERS = {
  youtube: {
    oauth: 'google', label: 'YouTube (Google)', pkce: true,
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    profile: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    revoke: 'https://oauth2.googleapis.com/revoke',
    scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl',
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    parseProfile: (j) => { const c = j.items?.[0]; if (!c) throw new Error('No YouTube channel on this Google account'); return { id: c.id, name: c.snippet?.title, avatar: c.snippet?.thumbnails?.default?.url || null }; },
    revokeReq: (cfg, token) => ({ body: new URLSearchParams({ token }) }),
  },
  twitch: {
    oauth: 'twitch', label: 'Twitch', pkce: false,
    authorize: 'https://id.twitch.tv/oauth2/authorize',
    token: 'https://id.twitch.tv/oauth2/token',
    profile: 'https://api.twitch.tv/helix/users',
    revoke: 'https://id.twitch.tv/oauth2/revoke',
    scope: 'user:read:email chat:read chat:edit',
    extraAuth: { force_verify: 'true' },
    profileHeaders: (cfg) => ({ 'Client-Id': cfg.clientId }),
    parseProfile: (j) => { const u = j.data?.[0]; if (!u) throw new Error('Twitch profile not available'); return { id: u.id, name: u.display_name || u.login, login: u.login, avatar: u.profile_image_url || null }; },
    revokeReq: (cfg, token) => ({ body: new URLSearchParams({ client_id: cfg.clientId, token }) }),
  },
  kick: {
    oauth: 'kick', label: 'Kick', pkce: true,
    authorize: 'https://id.kick.com/oauth/authorize',
    token: 'https://id.kick.com/oauth/token',
    profile: 'https://api.kick.com/public/v1/users',
    revoke: 'https://id.kick.com/oauth/revoke',
    scope: 'user:read channel:read chat:write',
    parseProfile: (j) => { const u = j.data?.[0]; if (!u) throw new Error('Kick profile not available'); return { id: String(u.user_id), name: u.name, login: u.name, avatar: u.profile_picture || null }; },
    revokeReq: (cfg, token) => ({ query: { token, token_hint_type: 'access_token' } }),
  },
  tiktok: {
    oauth: 'tiktok', label: 'TikTok', pkce: false, clientIdParam: 'client_key',
    authorize: 'https://www.tiktok.com/v2/auth/authorize/',
    token: 'https://open.tiktokapis.com/v2/oauth/token/',
    profile: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name',
    revoke: 'https://open.tiktokapis.com/v2/oauth/revoke/',
    scope: 'user.info.basic',
    parseProfile: (j) => { const u = j.data?.user; if (!u) throw new Error('TikTok profile not available'); return { id: u.open_id, name: u.display_name, avatar: u.avatar_url || null }; },
    revokeReq: (cfg, token) => ({ body: new URLSearchParams({ client_key: cfg.clientId, client_secret: cfg.clientSecret, token }) }),
  },
  discord: {
    oauth: 'discord', label: 'Discord', pkce: false,
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    profile: 'https://discord.com/api/users/@me',
    revoke: 'https://discord.com/api/oauth2/token/revoke',
    scope: 'identify webhook.incoming',
    parseProfile: (j) => ({ id: j.id, name: j.global_name || j.username, login: j.username, avatar: j.avatar ? `https://cdn.discordapp.com/avatars/${j.id}/${j.avatar}.png` : null }),
    revokeReq: (cfg, token) => ({ body: new URLSearchParams({ token, client_id: cfg.clientId, client_secret: cfg.clientSecret }) }),
  },
};

function def(platform) {
  const p = PROVIDERS[platform];
  if (!p) fail(404, 'UNKNOWN_PLATFORM', 'Unknown platform');
  const cfg = config.oauth[p.oauth];
  const o = (k) => (!config.production && cfg[`${k}Url`]) || p[k];
  return { ...p, platform, cfg, urls: { authorize: o('authorize'), token: o('token'), profile: o('profile'), revoke: o('revoke') } };
}
const configured = (platform) => { const d = def(platform); return !!(d.cfg.clientId && d.cfg.clientSecret); };
const redirectUri = (d) => `${config.publicUrl}/api/oauth/callback/${d.platform}`;

function providers() {
  return Object.entries(PROVIDERS).map(([platform, p]) => ({ platform, label: p.label, configured: configured(platform), scope: p.scope }));
}

async function postForm(url, params, headers = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    const msg = j.error_description || j.message || (typeof j.error === 'string' ? j.error : j.error?.message) || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { code: 'PROVIDER_TOKEN_ERROR', status: res.status });
  }
  return j;
}
function normalizeTokens(j) {
  const t = j.data && j.data.access_token ? j.data : j; // some providers wrap
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || null,
    expiresAt: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : null,
    scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope || null),
    webhookUrl: t.webhook?.url || null,
  };
}

// ---- 1. start ---------------------------------------------------------------
function start(user, deviceUid, platform) {
  const d = def(platform);
  if (!configured(platform)) fail(503, 'OAUTH_NOT_CONFIGURED', `${d.label} sign-in is not set up on the LiveX server yet`);
  const state = C.randomToken(32);
  const verifier = C.randomToken(48);
  const flowId = C.randomToken(18);
  db.get().prepare(`INSERT INTO oauth_flows(flow_id,user_id,device_uid,provider,state_hash,verifier_enc,status,created_at,expires_at)
    VALUES(?,?,?,?,?,?,'pending',?,?)`).run(flowId, user.id, deviceUid, platform, C.sha256(state), C.encrypt(verifier), db.now(), db.now() + FLOW_TTL);
  const q = new URLSearchParams({
    [d.clientIdParam || 'client_id']: d.cfg.clientId, redirect_uri: redirectUri(d), response_type: 'code',
    scope: d.scope, state, ...(d.extraAuth || {}),
  });
  if (d.pkce) { q.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256'); }
  db.audit(user.id, 'oauth_started', { platform });
  return { flowId, authorizeUrl: `${d.urls.authorize}?${q}`, expiresAt: db.now() + FLOW_TTL };
}

// ---- 2. provider callback ----------------------------------------------------
async function callback(platform, query) {
  const d = def(platform);
  const state = String(query.state || '');
  const row = state && db.get().prepare('SELECT * FROM oauth_flows WHERE state_hash=?').get(C.sha256(state));
  if (!row || row.provider !== platform) return { ok: false, error: 'INVALID_STATE' };
  if (row.status !== 'pending') return { ok: false, error: 'FLOW_USED' };
  const setErr = (code) => { db.get().prepare("UPDATE oauth_flows SET status='error', error=? WHERE id=?").run(code, row.id); return { ok: false, error: code }; };
  if (row.expires_at < db.now()) return setErr('FLOW_EXPIRED');
  if (query.error) return setErr(query.error === 'access_denied' ? 'ACCESS_DENIED' : 'PROVIDER_ERROR');
  if (!query.code) return setErr('NO_CODE');
  try {
    const params = { grant_type: 'authorization_code', code: String(query.code), redirect_uri: redirectUri(d), [d.clientIdParam || 'client_id']: d.cfg.clientId, client_secret: d.cfg.clientSecret };
    if (d.pkce) params.code_verifier = C.decrypt(row.verifier_enc);
    const tokens = normalizeTokens(await postForm(d.urls.token, params));
    if (!tokens.accessToken) throw new Error('No access token returned');
    const pres = await fetch(d.urls.profile, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json', ...(d.profileHeaders ? d.profileHeaders(d.cfg) : {}) }, signal: AbortSignal.timeout(15000) });
    if (!pres.ok) throw new Error(`Profile request failed (${pres.status})`);
    const profile = d.parseProfile(await pres.json());
    const result = { platform, ...tokens, profile, connectedAt: db.now() };
    db.get().prepare("UPDATE oauth_flows SET status='done', result_enc=? WHERE id=?").run(C.encrypt(JSON.stringify(result)), row.id);
    db.audit(row.user_id, 'oauth_connected', { platform, account: profile.name });
    return { ok: true, profile };
  } catch (e) {
    console.error(`[oauth] ${platform} exchange failed: ${e.message}`); // never logs tokens
    db.get().prepare("UPDATE oauth_flows SET status='error', error=? WHERE id=?").run('EXCHANGE_FAILED', row.id);
    return { ok: false, error: 'EXCHANGE_FAILED' };
  }
}

// ---- 3. app collects the result once ---------------------------------------------
function poll(user, deviceUid, flowId) {
  const row = db.get().prepare('SELECT * FROM oauth_flows WHERE flow_id=?').get(String(flowId || ''));
  if (!row || row.user_id !== user.id || row.device_uid !== deviceUid) fail(404, 'FLOW_NOT_FOUND', 'Sign-in request not found');
  if (row.status === 'pending') {
    if (row.expires_at < db.now()) { db.get().prepare("UPDATE oauth_flows SET status='error', error='FLOW_EXPIRED' WHERE id=?").run(row.id); return { status: 'error', error: 'FLOW_EXPIRED' }; }
    return { status: 'pending' };
  }
  if (row.status === 'done') {
    const result = JSON.parse(C.decrypt(row.result_enc));
    db.get().prepare("UPDATE oauth_flows SET status='collected', result_enc=NULL WHERE id=?").run(row.id); // hand over once, then forget
    return { status: 'done', result };
  }
  return { status: row.status, error: row.error };
}

function cancel(user, deviceUid, flowId) {
  db.get().prepare("UPDATE oauth_flows SET status='cancelled', result_enc=NULL WHERE flow_id=? AND user_id=? AND device_uid=? AND status IN ('pending','done')").run(String(flowId || ''), user.id, deviceUid);
  return { ok: true };
}

// ---- refresh / revoke -------------------------------------------------------------
async function refresh(platform, refreshToken) {
  const d = def(platform);
  if (!configured(platform)) fail(503, 'OAUTH_NOT_CONFIGURED', `${d.label} sign-in is not set up on the LiveX server`);
  if (typeof refreshToken !== 'string' || refreshToken.length < 8) fail(400, 'VALIDATION', 'refreshToken required');
  try {
    const t = normalizeTokens(await postForm(d.urls.token, { grant_type: 'refresh_token', refresh_token: refreshToken, [d.clientIdParam || 'client_id']: d.cfg.clientId, client_secret: d.cfg.clientSecret }));
    return { ...t, refreshToken: t.refreshToken || refreshToken };
  } catch (e) {
    // Platform down / timeout: keep the connection and let the app retry later.
    if (!e.status || e.status >= 500 || e.status === 429) fail(502, 'PROVIDER_UNAVAILABLE', 'The platform could not be reached. Try again later.');
    // 409, not 401: a 401 means the LiveX session itself is invalid and signs the user out of LiveX.
    fail(409, 'REAUTH_REQUIRED', 'The platform no longer accepts this connection. Reconnect the account.');
  }
}

async function revoke(platform, token) {
  const d = def(platform);
  if (!configured(platform) || typeof token !== 'string' || !token) return { revoked: false };
  try {
    const r = d.revokeReq(d.cfg, token);
    const url = r.query ? `${d.urls.revoke}?${new URLSearchParams(r.query)}` : d.urls.revoke;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: r.body, signal: AbortSignal.timeout(10000) });
    return { revoked: res.ok };
  } catch { return { revoked: false }; }
}

setInterval(() => { try { db.get().prepare("DELETE FROM oauth_flows WHERE expires_at < ?").run(db.now() - 3600_000); } catch { /* db closed */ } }, 600_000).unref();

module.exports = { PROVIDERS, providers, configured, start, callback, poll, cancel, refresh, revoke };
