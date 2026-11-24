'use strict';
// Private chat between a creator and a giveaway winner.
//
//  - The creator's app opens a room for the winner (platform + the winner's platform
//    user id / @handle, exactly as they appeared in the live chat).
//  - The room link can be posted in public chat: opening it is harmless, because the
//    winner must sign in with that platform's official sign-in and the server checks
//    that the signed-in account IS the winning account. Anyone else is refused.
//  - Identity sign-in uses minimal scopes, the platform token is revoked right after
//    the check and never stored. The winner gets an HttpOnly cookie for this room only.
//  - Messages are encrypted at rest and deleted when the room is closed or expires.
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const C = require('../crypto');
const O = require('./oauth');
const { fail } = require('../http');

const ROOM_TTL = 7 * 24 * 3600_000;
const FLOW_TTL = 10 * 60_000;
const MAX_MESSAGES = 500;
const MAX_ROOMS_PER_DAY = 50;
const LIVE_PLATFORMS = ['youtube', 'twitch', 'kick', 'tiktok'];

const norm = (s) => String(s || '').trim().replace(/^@/, '').toLowerCase();
const claimUrl = (code) => `${config.publicUrl}/w/${code}`;

function hasPro(userId, deviceUid) {
  const rows = db.get().prepare(`SELECT l.entitlements FROM licenses l JOIN devices d ON d.license_id=l.id
    WHERE l.user_id=? AND l.status='active' AND d.status='active' AND d.device_uid=?`).all(userId, deviceUid);
  return rows.some((x) => JSON.parse(x.entitlements).includes('pro'));
}

function purgeExpired() {
  const d = db.get();
  const old = d.prepare("SELECT id FROM winner_rooms WHERE status!='closed' AND expires_at < ?").all(db.now());
  for (const r of old) closeRow(r.id);
  d.prepare("DELETE FROM identity_flows WHERE expires_at < ?").run(db.now() - 3600_000);
}
function closeRow(id) {
  const d = db.get();
  d.prepare('DELETE FROM winner_messages WHERE room_id=?').run(id);
  d.prepare("UPDATE winner_rooms SET status='closed', session_hash=NULL, closed_at=? WHERE id=?").run(db.now(), id);
}

const viewForHost = (r) => {
  const last = db.get().prepare('SELECT MAX(id) AS m, MAX(created_at) AS at FROM winner_messages WHERE room_id=?').get(r.id);
  const unread = db.get().prepare("SELECT COUNT(*) AS n FROM winner_messages WHERE room_id=? AND sender='winner' AND id>?").get(r.id, r.host_read_id).n;
  return {
    roomId: r.room_id, platform: r.platform, winnerName: r.winner_name, winnerHandle: r.winner_handle || null, title: r.title,
    status: r.status, verifiedName: r.verified_name || null, claimUrl: r.status === 'closed' ? null : claimUrl(r.code),
    createdAt: r.created_at, expiresAt: r.expires_at, verifiedAt: r.verified_at || null, closedAt: r.closed_at || null,
    lastMessageAt: last.at || null, unread,
  };
};
const msgView = (m) => ({ id: m.id, from: m.sender, text: C.decrypt(m.body_enc), at: m.created_at });

// ---- creator (desktop app) ---------------------------------------------------------
function create(user, deviceUid, body) {
  purgeExpired();
  if (!hasPro(user.id, deviceUid)) fail(403, 'NOT_LICENSED', 'LiveX PRO is required for private winner chats');
  const platform = String(body.platform || '');
  if (!LIVE_PLATFORMS.includes(platform)) fail(400, 'VALIDATION', 'Private chats are available for YouTube, Twitch, Kick and TikTok winners');
  const winnerId = String(body.winnerId || '').slice(0, 120) || null;
  const winnerHandle = norm(body.winnerHandle).slice(0, 80) || null;
  if (!winnerId && !winnerHandle) fail(400, 'VALIDATION', 'The winner has no platform identity to verify');
  if (platform === 'tiktok' && !winnerHandle) fail(400, 'VALIDATION', 'TikTok winners are verified by @username');
  if (platform === 'youtube' && !winnerId) fail(400, 'VALIDATION', 'YouTube winners are verified by channel id');
  const winnerName = String(body.winnerName || winnerHandle || 'Winner').slice(0, 80);
  const title = String(body.title || 'Giveaway').slice(0, 80);
  const today = db.get().prepare('SELECT COUNT(*) AS n FROM winner_rooms WHERE user_id=? AND created_at > ?').get(user.id, db.now() - 86400_000).n;
  if (today >= MAX_ROOMS_PER_DAY) fail(429, 'RATE_LIMITED', 'Too many private chats today');
  // Re-use an open room for the same winner instead of creating duplicates.
  const existing = db.get().prepare("SELECT * FROM winner_rooms WHERE user_id=? AND platform=? AND status!='closed' AND COALESCE(winner_id,'')=? AND COALESCE(winner_handle,'')=?")
    .get(user.id, platform, winnerId || '', winnerHandle || '');
  if (existing) return { room: viewForHost(existing), reused: true, signInReady: O.configured(platform) };
  const roomId = C.randomToken(12); const code = C.randomToken(9);
  db.get().prepare(`INSERT INTO winner_rooms(room_id,code,user_id,platform,winner_id,winner_handle,winner_name,title,status,created_at,expires_at)
    VALUES(?,?,?,?,?,?,?,?,'waiting',?,?)`).run(roomId, code, user.id, platform, winnerId, winnerHandle, winnerName, title, db.now(), db.now() + ROOM_TTL);
  db.audit(user.id, 'winner_room_created', { platform, winner: winnerName });
  const row = db.get().prepare('SELECT * FROM winner_rooms WHERE room_id=?').get(roomId);
  return { room: viewForHost(row), reused: false, signInReady: O.configured(platform) };
}

function ownRoom(user, roomId) {
  const r = db.get().prepare('SELECT * FROM winner_rooms WHERE room_id=? AND user_id=?').get(String(roomId || ''), user.id);
  if (!r) fail(404, 'NOT_FOUND', 'Private chat not found');
  return r;
}

function list(user) {
  purgeExpired();
  const rows = db.get().prepare('SELECT * FROM winner_rooms WHERE user_id=? AND (status!=\'closed\' OR closed_at > ?) ORDER BY created_at DESC LIMIT 100').all(user.id, db.now() - 7 * 86400_000);
  return { rooms: rows.map(viewForHost) };
}

function hostMessages(user, roomId, after) {
  const r = ownRoom(user, roomId);
  const msgs = db.get().prepare('SELECT * FROM winner_messages WHERE room_id=? AND id>? ORDER BY id LIMIT 200').all(r.id, Number(after) || 0);
  const maxId = msgs.length ? msgs[msgs.length - 1].id : 0;
  if (maxId > r.host_read_id) db.get().prepare('UPDATE winner_rooms SET host_read_id=? WHERE id=?').run(maxId, r.id);
  return { room: viewForHost({ ...r, host_read_id: Math.max(maxId, r.host_read_id) }), messages: msgs.map(msgView) };
}

function addMessage(r, sender, text) {
  if (r.status === 'closed') fail(410, 'ROOM_CLOSED', 'This private chat was closed');
  const t = String(text || '').trim();
  if (!t || t.length > 1000) fail(400, 'VALIDATION', 'Message must be 1-1000 characters');
  const n = db.get().prepare('SELECT COUNT(*) AS n FROM winner_messages WHERE room_id=?').get(r.id).n;
  if (n >= MAX_MESSAGES) fail(429, 'ROOM_FULL', 'This private chat reached its message limit');
  const res = db.get().prepare('INSERT INTO winner_messages(room_id,sender,body_enc,created_at) VALUES(?,?,?,?)').run(r.id, sender, C.encrypt(t), db.now());
  const col = sender === 'host' ? 'host_read_id' : 'winner_read_id';
  db.get().prepare(`UPDATE winner_rooms SET ${col}=? WHERE id=?`).run(Number(res.lastInsertRowid), r.id);
  return { id: Number(res.lastInsertRowid), from: sender, text: t, at: db.now() };
}
const hostSend = (user, roomId, text) => ({ message: addMessage(ownRoom(user, roomId), 'host', text) });
function hostClose(user, roomId) {
  const r = ownRoom(user, roomId);
  if (r.status !== 'closed') { closeRow(r.id); db.audit(user.id, 'winner_room_closed', { platform: r.platform }); }
  return { ok: true };
}

// ---- winner (public web page) ------------------------------------------------------
function byCode(code) {
  purgeExpired();
  const r = db.get().prepare('SELECT * FROM winner_rooms WHERE code=?').get(String(code || ''));
  if (!r) fail(404, 'NOT_FOUND', 'This private chat link is not valid');
  return r;
}
const sessionOk = (r, token) => !!(token && r.session_hash && r.status === 'verified' && crypto.timingSafeEqual(Buffer.from(C.sha256(token)), Buffer.from(r.session_hash)));

function publicInfo(code, token) {
  const r = byCode(code);
  const host = db.get().prepare('SELECT first_name FROM users WHERE id=?').get(r.user_id);
  const def = O.PROVIDERS[r.platform];
  return {
    host: host?.first_name || 'LiveX', title: r.title, platform: r.platform, platformLabel: def?.label || r.platform,
    winnerName: r.winner_name, status: r.status, you: sessionOk(r, token), signInReady: O.configured(r.platform),
  };
}

function startVerify(code) {
  const r = byCode(code);
  if (r.status === 'closed') fail(410, 'ROOM_CLOSED', 'This private chat was closed');
  if (r.status === 'verified') fail(409, 'ALREADY_VERIFIED', 'The winner already confirmed this chat');
  const d = O.def(r.platform);
  if (!O.configured(r.platform)) fail(503, 'OAUTH_NOT_CONFIGURED', `${d.label} sign-in is not set up on the LiveX server yet`);
  const state = C.randomToken(32); const verifier = C.randomToken(48);
  db.get().prepare("INSERT INTO identity_flows(room_id,provider,state_hash,verifier_enc,status,created_at,expires_at) VALUES(?,?,?,?,'pending',?,?)")
    .run(r.id, r.platform, C.sha256(state), C.encrypt(verifier), db.now(), db.now() + FLOW_TTL);
  const q = new URLSearchParams({
    [d.clientIdParam || 'client_id']: d.cfg.clientId, redirect_uri: O.redirectUri(d), response_type: 'code',
    scope: d.identity.scope, state, ...(d.identity.extraAuth || {}),
  });
  if (d.pkce) { q.set('code_challenge', O.b64url(crypto.createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256'); }
  return { authorizeUrl: `${d.urls.authorize}?${q}` };
}

const ownsState = (state) => !!(state && db.get().prepare('SELECT 1 FROM identity_flows WHERE state_hash=?').get(C.sha256(String(state))));

function matches(r, profile) {
  if (r.winner_id && profile.id && String(profile.id) === String(r.winner_id)) return true;
  // @handles are unique on Twitch, Kick and TikTok (YouTube display names are not).
  if (r.platform !== 'youtube' && r.winner_handle && profile.login && norm(profile.login) === r.winner_handle) return true;
  return false;
}

// Called from the shared OAuth callback when `state` belongs to a winner check.
// Returns { code, ok, error?, session? } — the route sets the cookie and redirects.
async function identityCallback(platform, query) {
  const f = db.get().prepare('SELECT * FROM identity_flows WHERE state_hash=?').get(C.sha256(String(query.state || '')));
  const r = f && db.get().prepare('SELECT * FROM winner_rooms WHERE id=?').get(f.room_id);
  if (!f || !r || f.provider !== platform) return { ok: false, error: 'INVALID_STATE', code: r?.code };
  if (f.status !== 'pending') return { ok: false, error: 'FLOW_USED', code: r.code };
  const done = (status) => db.get().prepare('UPDATE identity_flows SET status=? WHERE id=?').run(status, f.id);
  if (f.expires_at < db.now()) { done('error'); return { ok: false, error: 'FLOW_EXPIRED', code: r.code }; }
  if (query.error) { done('error'); return { ok: false, error: query.error === 'access_denied' ? 'ACCESS_DENIED' : 'PROVIDER_ERROR', code: r.code }; }
  if (r.status === 'closed') { done('error'); return { ok: false, error: 'ROOM_CLOSED', code: r.code }; }
  if (r.status === 'verified') { done('error'); return { ok: false, error: 'ALREADY_VERIFIED', code: r.code }; }
  const d = O.def(platform);
  let profile; let accessToken;
  try {
    const params = { grant_type: 'authorization_code', code: String(query.code || ''), redirect_uri: O.redirectUri(d), [d.clientIdParam || 'client_id']: d.cfg.clientId, client_secret: d.cfg.clientSecret };
    if (d.pkce) params.code_verifier = C.decrypt(f.verifier_enc);
    ({ accessToken } = O.normalizeTokens(await O.postForm(d.urls.token, params)));
    if (!accessToken) throw new Error('No access token');
    const profileUrl = (!config.production && d.cfg.profileUrl) || d.identity.profile || d.urls.profile;
    const pres = await fetch(profileUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(d.profileHeaders ? d.profileHeaders(d.cfg) : {}) }, signal: AbortSignal.timeout(15000) });
    if (!pres.ok) throw new Error(`Profile request failed (${pres.status})`);
    profile = d.parseProfile(await pres.json());
  } catch (e) {
    console.error(`[winner] ${platform} identity check failed: ${e.message}`); // never logs tokens
    done('error'); return { ok: false, error: 'EXCHANGE_FAILED', code: r.code };
  } finally {
    if (accessToken) await O.revoke(platform, accessToken).catch(() => {}); // identity only: drop the token at once
  }
  done('done');
  if (!matches(r, profile)) {
    db.audit(r.user_id, 'winner_room_wrong_account', { platform });
    return { ok: false, error: 'NOT_WINNER', code: r.code };
  }
  const session = C.randomToken(32);
  db.get().prepare("UPDATE winner_rooms SET status='verified', session_hash=?, verified_name=?, verified_at=? WHERE id=?").run(C.sha256(session), String(profile.name || '').slice(0, 80), db.now(), r.id);
  db.audit(r.user_id, 'winner_room_verified', { platform });
  return { ok: true, code: r.code, session };
}

function winnerRoom(code, token) {
  const r = byCode(code);
  if (!sessionOk(r, token)) fail(r.status === 'closed' ? 410 : 401, r.status === 'closed' ? 'ROOM_CLOSED' : 'NOT_VERIFIED', r.status === 'closed' ? 'This private chat was closed' : 'Sign in to confirm you are the winner');
  return r;
}
function winnerMessages(code, token, after) {
  const r = winnerRoom(code, token);
  const msgs = db.get().prepare('SELECT * FROM winner_messages WHERE room_id=? AND id>? ORDER BY id LIMIT 200').all(r.id, Number(after) || 0);
  return { messages: msgs.map(msgView) };
}
const winnerSend = (code, token, text) => ({ message: addMessage(winnerRoom(code, token), 'winner', text) });

module.exports = { LIVE_PLATFORMS, create, list, hostMessages, hostSend, hostClose, publicInfo, startVerify, ownsState, identityCallback, winnerMessages, winnerSend, claimUrl };
