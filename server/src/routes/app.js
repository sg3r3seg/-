'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../services/auth');
const L = require('../services/licenses');
const { h, fail } = require('../http');
const { requireAuth, requireVerified, requireApp } = require('../middleware');
const { limiter } = require('../ratelimit');

// Endpoints used by the LiveX desktop app.
const r = express.Router();
r.use(requireAuth, requireVerified, requireApp);

const deviceFromReq = (req) => ({ uid: req.token.dev, name: req.body?.device?.name, os: req.body?.device?.os });

r.get('/status', limiter('status', 120, 60_000, (req) => req.user.id), h(async (req, res) => {
  res.json({ user: auth.publicUser(req.user), ...L.appStatus(req.user, req.token.dev) });
}));

r.post('/activate',
  limiter('activate-ip', 10, 60_000),
  limiter('activate-user', 20, 3600_000, (req) => req.user.id),
  h(async (req, res) => {
    const license = L.activate(req.user.id, req.body?.code, deviceFromReq(req), req.ip);
    res.json({ license, user: auth.publicUser(req.user), ...L.appStatus(req.user, req.token.dev) });
  }));

r.post('/bind', limiter('bind', 10, 60_000), h(async (req, res) => {
  const license = L.bindLicense(req.user.id, String(req.body?.licenseId || ''), deviceFromReq(req), req.ip);
  res.json({ license, ...L.appStatus(req.user, req.token.dev) });
}));

r.get('/devices', h(async (req, res) => {
  const d = db.get();
  const devices = d.prepare('SELECT * FROM devices WHERE user_id=? ORDER BY last_seen_at DESC').all(req.user.id).map((dv) => ({
    ...L.deviceView(dv),
    licenseId: d.prepare('SELECT license_id FROM licenses WHERE id=?').get(dv.license_id).license_id,
    thisDevice: dv.device_uid === req.token.dev,
  }));
  res.json({ devices });
}));

module.exports = r;
