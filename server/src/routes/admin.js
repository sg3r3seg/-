'use strict';
const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const L = require('../services/licenses');
const auth = require('../services/auth');
const { h, fail } = require('../http');

// Admin API — disabled unless ADMIN_TOKEN (>= 32 chars) is configured.
const r = express.Router();
r.use((req, _res, next) => {
  const t = (/^Bearer (.+)$/.exec(req.get('authorization') || '') || [])[1] || '';
  const ok = config.adminToken.length >= 32 && t.length === config.adminToken.length
    && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(config.adminToken));
  if (!ok) return next(Object.assign(new Error('Not found'), { status: 404, code: 'NOT_FOUND' }));
  next();
});

r.get('/users', h(async (req, res) => {
  const q = `%${String(req.query.q || '')}%`;
  const users = db.get().prepare('SELECT * FROM users WHERE email LIKE ? OR public_id LIKE ? ORDER BY id DESC LIMIT 100').all(q, q);
  res.json({ users: users.map((u) => ({ ...auth.publicUser(u), licenses: L.userLicenses(u.id).map((l) => L.licenseView(l)) })) });
}));

r.post('/licenses/:id/revoke', h(async (req, res) => {
  res.json({ license: L.revokeLicense(req.params.id, String(req.body?.reason || 'revoked by admin').slice(0, 200)) });
}));

// Manual confirmation for offline payments (e.g. bank transfer) after the
// operator verified the money arrived.
r.post('/orders/:id/mark-paid', h(async (req, res) => {
  const o = db.get().prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) fail(404, 'ORDER_NOT_FOUND', 'Order not found');
  const result = await L.fulfillOrder(o.id, { providerRef: `manual_${o.id}` });
  res.json({ license: L.licenseView(result.license), alreadyFulfilled: result.alreadyFulfilled });
}));

module.exports = r;
