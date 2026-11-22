'use strict';
const C = require('./crypto');
const auth = require('./services/auth');
const { fail, h } = require('./http');

// Bearer access token -> req.user. For desktop-app tokens the X-LiveX-Device
// header must match the device the session was issued to.
const requireAuth = h(async (req, _res, next) => {
  const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
  const p = m && C.verifyJwt(m[1], 'access');
  if (!p) fail(401, 'UNAUTHENTICATED', 'Please sign in');
  const user = auth.findUserById(p.uid);
  if (!user || user.public_id !== p.sub || user.status !== 'active') fail(401, 'UNAUTHENTICATED', 'Please sign in');
  if (p.cli === 'app') {
    const dev = req.get('x-livex-device');
    if (!dev || dev !== p.dev) fail(401, 'DEVICE_MISMATCH', 'Session belongs to another device');
  }
  req.user = user; req.token = p;
  next();
});

const requireVerified = (req, _res, next) => {
  if (!req.user.email_verified_at) return next(Object.assign(new Error('Verify your email first'), { status: 403, code: 'EMAIL_NOT_VERIFIED' }));
  next();
};
const requireApp = (req, _res, next) => {
  if (req.token.cli !== 'app') return next(Object.assign(new Error('App session required'), { status: 403, code: 'APP_ONLY' }));
  next();
};

module.exports = { requireAuth, requireVerified, requireApp };
