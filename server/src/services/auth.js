'use strict';
const db = require('../db');
const config = require('../config');
const C = require('../crypto');
const mailer = require('../mailer');
const { fail } = require('../http');

const HOUR = 3600_000;

function publicUser(u) {
  return {
    userId: u.public_id,
    firstName: u.first_name,
    lastName: u.last_name,
    fullName: `${u.first_name} ${u.last_name}`,
    email: u.email,
    emailVerified: !!u.email_verified_at,
    createdAt: u.created_at,
  };
}

function findUserById(id) {
  return db.get().prepare('SELECT * FROM users WHERE id=?').get(id);
}
function findUserByPublicId(pid) {
  return db.get().prepare('SELECT * FROM users WHERE public_id=?').get(pid);
}

function issueEmailToken(userId, purpose, ttlMs, meta) {
  const token = C.randomToken(32);
  db.get().prepare(`INSERT INTO email_tokens(user_id,purpose,token_hash,meta,expires_at,created_at)
    VALUES(?,?,?,?,?,?)`).run(userId, purpose, C.sha256(token), meta ? JSON.stringify(meta) : null, db.now() + ttlMs, db.now());
  return token;
}

// Atomically consume a one-time email token.
function consumeEmailToken(token, purpose) {
  if (typeof token !== 'string' || token.length < 20) fail(400, 'INVALID_TOKEN', 'Invalid or expired link');
  return db.tx((d) => {
    const row = d.prepare('SELECT * FROM email_tokens WHERE token_hash=? AND purpose=?').get(C.sha256(token), purpose);
    if (!row || row.used_at || row.expires_at < db.now()) fail(400, 'INVALID_TOKEN', 'Invalid or expired link');
    d.prepare('UPDATE email_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(db.now(), row.id);
    return { ...row, meta: row.meta ? JSON.parse(row.meta) : null };
  });
}

async function sendVerification(user) {
  const token = issueEmailToken(user.id, 'verify', 48 * HOUR);
  const link = `${config.publicUrl}/verify.html#token=${token}`;
  return mailer.send({
    to: user.email,
    tag: 'verify',
    subject: 'LiveX — אימות כתובת דוא"ל / Verify your email',
    text: `Hi ${user.first_name},\n\nVerify your LiveX account: ${link}\n\nYour User ID: ${user.public_id}\nThis link expires in 48 hours.`,
    html: mailer.wrap('Verify your email', `<p>Hi ${esc(user.first_name)},</p>
      <p>Your User ID: <b>${user.public_id}</b></p>
      <p><a href="${link}" style="background:#22e4d9;color:#02121a;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p>
      <p style="color:#7aa6c9;font-size:12px">This link expires in 48 hours.</p>`),
  });
}

async function register({ firstName, lastName, email, password }, ip) {
  const existing = db.get().prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) fail(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const pwHash = C.hashPassword(password);
  const user = db.tx((d) => {
    const r = d.prepare(`INSERT INTO users(first_name,last_name,email,password_hash,created_at)
      VALUES(?,?,?,?,?)`).run(firstName, lastName, email, pwHash, db.now());
    const id = Number(r.lastInsertRowid);
    // Permanent server-generated public ID derived from the immutable row id.
    const publicId = `LVX-USER-${String(id).padStart(6, '0')}`;
    d.prepare('UPDATE users SET public_id=? WHERE id=?').run(publicId, id);
    return d.prepare('SELECT * FROM users WHERE id=?').get(id);
  });
  db.audit(user.id, 'register', null, ip);
  const mail = await sendVerification(user);
  return { user, mail };
}

function verifyEmail(token) {
  const row = consumeEmailToken(token, 'verify');
  db.get().prepare('UPDATE users SET email_verified_at=COALESCE(email_verified_at, ?) WHERE id=?').run(db.now(), row.user_id);
  db.audit(row.user_id, 'email_verified');
  return findUserById(row.user_id);
}

function checkCredentials(email, password) {
  const user = db.get().prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) { C.verifyPassword(password, C.DUMMY_HASH); fail(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'); }
  if (!C.verifyPassword(password, user.password_hash)) fail(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (user.status !== 'active') fail(403, 'ACCOUNT_DISABLED', 'This account is disabled');
  return user;
}

function accessToken(user, client, deviceUid) {
  return C.signJwt({ typ: 'access', sub: user.public_id, uid: user.id, cli: client, dev: deviceUid || null }, config.accessTokenTtlSec);
}

function createSession(user, client, deviceUid) {
  const refresh = C.randomToken(48);
  db.get().prepare(`INSERT INTO refresh_tokens(user_id,token_hash,client,device_uid,expires_at,created_at)
    VALUES(?,?,?,?,?,?)`).run(user.id, C.sha256(refresh), client, deviceUid || null,
    db.now() + config.refreshTokenTtlDays * 24 * HOUR, db.now());
  return { accessToken: accessToken(user, client, deviceUid), refreshToken: refresh, expiresIn: config.accessTokenTtlSec };
}

// Refresh token rotation with reuse detection: presenting a revoked token
// revokes every session of that user.
function refreshSession(refresh, deviceUid) {
  if (typeof refresh !== 'string' || refresh.length < 30) fail(401, 'INVALID_SESSION', 'Session expired. Please sign in again.');
  const result = db.tx((d) => {
    const row = d.prepare('SELECT * FROM refresh_tokens WHERE token_hash=?').get(C.sha256(refresh));
    if (!row) fail(401, 'INVALID_SESSION', 'Session expired. Please sign in again.');
    // Must be committed, so it is returned rather than thrown inside the transaction.
    if (row.revoked_at) return { reused: row.user_id };
    if (row.expires_at < db.now()) fail(401, 'INVALID_SESSION', 'Session expired. Please sign in again.');
    if (row.client === 'app' && row.device_uid !== (deviceUid || null)) fail(401, 'DEVICE_MISMATCH', 'Session belongs to another device');
    const user = d.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
    if (!user || user.status !== 'active') fail(403, 'ACCOUNT_DISABLED', 'This account is disabled');
    d.prepare('UPDATE refresh_tokens SET revoked_at=? WHERE id=?').run(db.now(), row.id);
    const next = C.randomToken(48);
    d.prepare(`INSERT INTO refresh_tokens(user_id,token_hash,client,device_uid,expires_at,created_at)
      VALUES(?,?,?,?,?,?)`).run(user.id, C.sha256(next), row.client, row.device_uid, row.expires_at, db.now());
    return { user, accessToken: accessToken(user, row.client, row.device_uid), refreshToken: next, expiresIn: config.accessTokenTtlSec };
  });
  if (result.reused) {
    revokeAllSessions(result.reused);
    db.audit(result.reused, 'refresh_token_reuse_detected');
    fail(401, 'SESSION_REUSED', 'Session was invalidated. Please sign in again.');
  }
  return result;
}

function revokeSession(refresh) {
  if (typeof refresh !== 'string') return;
  db.get().prepare('UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').run(db.now(), C.sha256(refresh));
}
function revokeAllSessions(userId) {
  db.get().prepare('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(db.now(), userId);
}
function revokeDeviceSessions(userId, deviceUid) {
  db.get().prepare(`UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND device_uid=? AND revoked_at IS NULL`)
    .run(db.now(), userId, deviceUid);
}

async function requestPasswordReset(email) {
  const user = db.get().prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return; // do not reveal whether the account exists
  const token = issueEmailToken(user.id, 'reset', 1 * HOUR);
  const link = `${config.publicUrl}/reset.html#token=${token}`;
  await mailer.send({
    to: user.email, tag: 'reset',
    subject: 'LiveX — שחזור סיסמה / Reset your password',
    text: `Reset your LiveX password: ${link}\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
    html: mailer.wrap('Reset your password', `<p><a href="${link}" style="color:#22e4d9">Choose a new password</a></p>
      <p style="color:#7aa6c9;font-size:12px">This link expires in 1 hour. If you did not request this, ignore this email.</p>`),
  });
}

function resetPassword(token, newPassword) {
  const row = consumeEmailToken(token, 'reset');
  db.get().prepare('UPDATE users SET password_hash=? WHERE id=?').run(C.hashPassword(newPassword), row.user_id);
  revokeAllSessions(row.user_id);
  db.audit(row.user_id, 'password_reset');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = {
  publicUser, findUserById, findUserByPublicId, register, verifyEmail, sendVerification,
  checkCredentials, createSession, refreshSession, revokeSession, revokeAllSessions, revokeDeviceSessions,
  requestPasswordReset, resetPassword, issueEmailToken, consumeEmailToken, esc,
};
