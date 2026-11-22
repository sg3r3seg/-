'use strict';
const express = require('express');
const db = require('../db');
const config = require('../config');
const C = require('../crypto');
const mailer = require('../mailer');
const auth = require('../services/auth');
const L = require('../services/licenses');
const { h, fail, str } = require('../http');
const { requireAuth, requireVerified } = require('../middleware');
const { limiter } = require('../ratelimit');

const r = express.Router();
r.use(requireAuth, requireVerified);

r.get('/', h(async (req, res) => {
  const d = db.get();
  const licenses = L.userLicenses(req.user.id).map((l) => L.licenseView(l, { withCode: true }));
  const devices = d.prepare('SELECT * FROM devices WHERE user_id=? ORDER BY id DESC').all(req.user.id).map((dv) => {
    const lic = d.prepare('SELECT license_id, product_code FROM licenses WHERE id=?').get(dv.license_id);
    return { ...L.deviceView(dv), licenseId: lic.license_id, product: lic.product_code };
  });
  const orders = d.prepare('SELECT id,product_code,amount_agorot,currency,status,provider,created_at,paid_at FROM orders WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json({ user: auth.publicUser(req.user), licenses, devices, orders });
}));

r.patch('/profile', h(async (req, res) => {
  const NAME = { min: 1, max: 60, pattern: /^[\p{L}\p{M}' .-]+$/u };
  const first = str(req.body?.firstName, { ...NAME, name: 'firstName' });
  const last = str(req.body?.lastName, { ...NAME, name: 'lastName' });
  db.get().prepare('UPDATE users SET first_name=?, last_name=? WHERE id=?').run(first, last, req.user.id);
  res.json({ user: auth.publicUser(auth.findUserById(req.user.id)) });
}));

// Step 1 of a license transfer: re-authenticate with the password, then
// confirm through a one-time link sent to the account email.
r.post('/devices/:deviceId/transfer', limiter('transfer', 5, 3600_000, (req) => req.user.id), h(async (req, res) => {
  if (!C.verifyPassword(String(req.body?.password || ''), req.user.password_hash)) {
    fail(401, 'INVALID_CREDENTIALS', 'Incorrect password');
  }
  const { transferId, device } = L.startTransfer(req.user, String(req.params.deviceId));
  const token = auth.issueEmailToken(req.user.id, 'transfer', 3600_000, { transferId });
  const link = `${config.publicUrl}/transfer.html#token=${token}`;
  const mail = await mailer.send({
    to: req.user.email, tag: 'transfer',
    subject: 'LiveX — אישור העברת רישיון / Confirm license transfer',
    text: `Confirm removing LiveX from "${device.name}" (${device.public_id}) so you can activate it on a new computer:\n${link}\nThis link expires in 1 hour.`,
    html: mailer.wrap('Confirm license transfer', `<p>Remove LiveX from <b>${auth.esc(device.name)}</b> (${device.public_id}) so it can be activated on a new computer.</p>
      <p><a href="${link}" style="color:#22e4d9">Confirm transfer</a></p><p style="color:#7aa6c9;font-size:12px">Expires in 1 hour.</p>`),
  });
  res.json({ ok: true, confirmationEmail: mail.delivered ? 'sent' : 'queued_dev_outbox' });
}));

r.post('/transfer/confirm', h(async (req, res) => {
  const row = auth.consumeEmailToken(req.body?.token, 'transfer');
  if (row.user_id !== req.user.id) fail(403, 'FORBIDDEN', 'This link belongs to another account');
  const device = L.completeTransfer(req.user.id, row.meta.transferId);
  res.json({ ok: true, device });
}));

module.exports = r;
