'use strict';
const express = require('express');
const config = require('../config');
const auth = require('../services/auth');
const { h, str, email, password, fail } = require('../http');
const { limiter } = require('../ratelimit');
const { requireAuth } = require('../middleware');
const { validateDevice } = require('../services/licenses');

const r = express.Router();
const COOKIE = 'lvx_rt';
const cookieOpts = () => ({ httpOnly: true, sameSite: 'strict', secure: config.publicUrl.startsWith('https://'), path: '/api/auth', maxAge: config.refreshTokenTtlDays * 86400_000 });
const readCookie = (req) => (req.get('cookie') || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

const NAME = { min: 1, max: 60, pattern: /^[\p{L}\p{M}' .-]+$/u };

r.post('/register', limiter('register', 10, 3600_000), h(async (req, res) => {
  const b = req.body || {};
  const data = {
    firstName: str(b.firstName, { ...NAME, name: 'firstName' }),
    lastName: str(b.lastName, { ...NAME, name: 'lastName' }),
    email: email(b.email),
    password: password(b.password),
  };
  const { user, mail } = await auth.register(data, req.ip);
  res.status(201).json({ user: auth.publicUser(user), verificationEmail: mail.delivered ? 'sent' : 'queued_dev_outbox', devMailbox: require('../mailer').devMailboxUrl() });
}));

r.post('/verify-email', limiter('verify', 30, 3600_000), h(async (req, res) => {
  const user = auth.verifyEmail(req.body?.token);
  res.json({ user: auth.publicUser(user) });
}));

r.post('/resend-verification', limiter('resend', 5, 3600_000), h(async (req, res) => {
  const user = auth.checkCredentials(email(req.body?.email), String(req.body?.password || ''));
  if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
  await auth.sendVerification(user);
  res.json({ ok: true });
}));

r.post('/login', limiter('login', 20, 15 * 60_000), h(async (req, res) => {
  const b = req.body || {};
  const client = b.client === 'app' ? 'app' : 'web';
  const user = auth.checkCredentials(email(b.email), String(b.password || ''));
  if (!user.email_verified_at) {
    const devMailbox = require('../mailer').devMailboxUrl();
    fail(403, 'EMAIL_NOT_VERIFIED', devMailbox ? 'Please verify your email address before signing in. On this test server emails are not sent — open the local mailbox to find the link.' : 'Please verify your email address before signing in.', devMailbox ? { devMailbox } : undefined);
  }
  let deviceUid = null;
  if (client === 'app') deviceUid = validateDevice(b.device).uid;
  const s = auth.createSession(user, client, deviceUid);
  if (client === 'web') {
    res.cookie(COOKIE, s.refreshToken, cookieOpts());
    delete s.refreshToken;
  }
  require('../db').audit(user.id, 'login', { client }, req.ip);
  res.json({ ...s, user: auth.publicUser(user) });
}));

r.post('/refresh', limiter('refresh', 120, 15 * 60_000), h(async (req, res) => {
  const b = req.body || {};
  const fromCookie = !b.refreshToken;
  if (fromCookie && req.get('x-requested-with') !== 'livex-web') fail(400, 'BAD_REQUEST', 'Missing header');
  const s = auth.refreshSession(fromCookie ? readCookie(req) : b.refreshToken, b.deviceUid);
  const out = { accessToken: s.accessToken, expiresIn: s.expiresIn, user: auth.publicUser(s.user) };
  if (fromCookie) res.cookie(COOKIE, s.refreshToken, cookieOpts());
  else out.refreshToken = s.refreshToken;
  res.json(out);
}));

r.post('/logout', h(async (req, res) => {
  auth.revokeSession(req.body?.refreshToken || readCookie(req));
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
}));

r.post('/logout-all', requireAuth, h(async (req, res) => {
  auth.revokeAllSessions(req.user.id);
  res.clearCookie(COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
}));

r.post('/forgot', limiter('forgot', 5, 3600_000), h(async (req, res) => {
  await auth.requestPasswordReset(email(req.body?.email));
  res.json({ ok: true }); // same response whether or not the account exists
}));

r.post('/reset', limiter('reset', 10, 3600_000), h(async (req, res) => {
  auth.resetPassword(req.body?.token, password(req.body?.password));
  res.json({ ok: true });
}));

r.get('/me', requireAuth, h(async (req, res) => res.json({ user: auth.publicUser(req.user) })));

module.exports = r;
