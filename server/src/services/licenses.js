'use strict';
const db = require('../db');
const config = require('../config');
const C = require('../crypto');
const mailer = require('../mailer');
const { fail } = require('../http');
const { esc } = require('./auth');

const DAY = 24 * 3600_000;

// ---- code formats ---------------------------------------------------------
const HEB = { א: 'A', ב: 'B', ג: 'G', ד: 'D', ה: 'H', ו: 'V', ז: 'Z', ח: 'CH', ט: 'T', י: 'Y', כ: 'K', ך: 'K', ל: 'L', מ: 'M', ם: 'M', נ: 'N', ן: 'N', ס: 'S', ע: 'A', פ: 'P', ף: 'F', צ: 'TZ', ץ: 'TZ', ק: 'K', ר: 'R', ש: 'SH', ת: 'T' };
function nameTag(firstName) {
  const latin = [...String(firstName || '')].map((ch) => HEB[ch] || ch).join('')
    .normalize('NFKD').toUpperCase().replace(/[^A-Z]/g, '');
  return (latin || 'USER').slice(0, 6);
}
// Personal code: shows the holder's name for recognition, but its security
// comes from the two random 4-char groups (31^8 ≈ 8.5e11) + DB uniqueness.
// It is an identifier, not a credential.
const newPersonalCode = (firstName) => `LVX-${nameTag(firstName)}-${C.randomChars(4)}-${C.randomChars(4)}`;
const newLicenseId = () => `LVX-LIC-${C.randomChars(10)}`;
// One-time activation code: 20 random chars from a 31-symbol alphabet ≈ 99 bits.
const newActivationCode = () => `LVX-${[0, 1, 2, 3, 4].map(() => C.randomChars(4)).join('-')}`;
const normalizeCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  .replace(/^LVX/, '').replace(/(.{4})(?=.)/g, '$1-').replace(/^/, 'LVX-');
const newDevicePublicId = () => `LVX-DEV-${C.randomChars(8)}`;

// ---- fulfillment ------------------------------------------------------------
// Called only after the payment provider confirmed the payment server-side.
// Idempotent: a repeated webhook for the same order never creates a second license.
async function fulfillOrder(orderId, { providerRef, amountAgorot, currency } = {}) {
  const result = db.tx((d) => {
    const order = d.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) fail(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (amountAgorot !== undefined && (amountAgorot !== order.amount_agorot || (currency || 'ILS').toUpperCase() !== order.currency)) {
      d.prepare("UPDATE orders SET status='failed' WHERE id=?").run(order.id);
      db.audit(order.user_id, 'payment_amount_mismatch', { orderId, amountAgorot, currency });
      fail(400, 'AMOUNT_MISMATCH', 'Paid amount does not match the order');
    }
    const existing = d.prepare('SELECT * FROM licenses WHERE order_id=?').get(order.id);
    if (existing) return { license: existing, code: null, alreadyFulfilled: true };
    if (order.status !== 'pending') fail(409, 'ORDER_NOT_PENDING', `Order is ${order.status}`);

    d.prepare("UPDATE orders SET status='paid', paid_at=?, provider_ref=COALESCE(provider_ref, ?) WHERE id=?")
      .run(db.now(), providerRef || null, order.id);
    const user = d.prepare('SELECT * FROM users WHERE id=?').get(order.user_id);
    const product = d.prepare('SELECT * FROM products WHERE code=?').get(order.product_code);

    let licenseId; let personal;
    for (;;) { // regenerate on the (astronomically unlikely) collision
      licenseId = newLicenseId(); personal = newPersonalCode(user.first_name);
      if (!d.prepare('SELECT 1 FROM licenses WHERE license_id=? OR personal_code=?').get(licenseId, personal)) break;
    }
    const r = d.prepare(`INSERT INTO licenses(license_id,user_id,order_id,product_code,entitlements,personal_code,
      holder_name,status,max_devices,purchased_at) VALUES(?,?,?,?,?,?,?,'pending_activation',?,?)`)
      .run(licenseId, user.id, order.id, product.code, product.entitlements, personal,
        `${user.first_name} ${user.last_name}`, config.maxDevicesPerLicense, db.now());
    const licenseRow = d.prepare('SELECT * FROM licenses WHERE id=?').get(Number(r.lastInsertRowid));

    const code = newActivationCode();
    d.prepare(`INSERT INTO activation_codes(license_id,user_id,code_hash,code_enc,status,expires_at,created_at)
      VALUES(?,?,?,?,'issued',?,?)`).run(licenseRow.id, user.id, C.codeHash(code), C.encrypt(code),
      db.now() + config.activationCodeTtlDays * DAY, db.now());
    db.audit(user.id, 'license_created', { licenseId, orderId: order.id, product: product.code });
    return { license: licenseRow, code, user, product, alreadyFulfilled: false };
  });

  if (result.code) {
    const { user, product, license, code } = result;
    try {
      await mailer.send({
        to: user.email, tag: 'activation',
        subject: `LiveX — קוד ההפעלה שלך / Your ${product.name} activation code`,
        text: `Hi ${user.first_name},\n\nThank you for purchasing ${product.name}.\n\nLicense holder: ${license.holder_name}\nUser ID: ${user.public_id}\nLicense ID: ${license.license_id}\nPersonal code: ${license.personal_code}\n\nOne-time activation code: ${code}\n\nOpen LiveX, sign in with this account and enter the activation code. The code can be used once only and expires in ${config.activationCodeTtlDays} days. It is also shown in your account area on the website.`,
        html: mailer.wrap(`Your ${esc(product.name)} license`, `<p>Hi ${esc(user.first_name)}, thank you for your purchase.</p>
          <table style="color:#cfe3f7;font-size:14px">
          <tr><td>License holder</td><td><b>${esc(license.holder_name)}</b></td></tr>
          <tr><td>User ID</td><td>${user.public_id}</td></tr>
          <tr><td>License ID</td><td>${license.license_id}</td></tr>
          <tr><td>Personal code</td><td>${license.personal_code}</td></tr></table>
          <p>One-time activation code:</p>
          <div style="font-family:Consolas,monospace;font-size:22px;letter-spacing:2px;background:#02121a;border:1px dashed #22e4d9;padding:14px;border-radius:10px;color:#22e4d9">${code}</div>
          <p style="color:#7aa6c9;font-size:12px">Sign in to LiveX with this account and enter the code. It works once only and expires in ${config.activationCodeTtlDays} days.</p>`),
      });
    } catch (e) {
      console.error('activation email failed', e.message); // code still visible in account area
    }
  }
  return result;
}

// ---- views ------------------------------------------------------------------
function licenseView(l, { withCode = false } = {}) {
  const d = db.get();
  const device = d.prepare("SELECT * FROM devices WHERE license_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(l.id);
  const user = d.prepare('SELECT public_id,email FROM users WHERE id=?').get(l.user_id);
  const v = {
    licenseId: l.license_id,
    product: l.product_code,
    entitlements: JSON.parse(l.entitlements),
    holderName: l.holder_name,
    userId: user.public_id,
    email: user.email,
    personalCode: l.personal_code,
    status: l.status,
    purchasedAt: l.purchased_at,
    activatedAt: l.activated_at,
    revokedAt: l.revoked_at,
    revokeReason: l.revoke_reason,
    maxDevices: l.max_devices,
    device: device ? deviceView(device) : null,
  };
  if (withCode) {
    const ac = d.prepare('SELECT * FROM activation_codes WHERE license_id=? ORDER BY id DESC LIMIT 1').get(l.id);
    if (ac) {
      const expired = ac.status === 'issued' && ac.expires_at < db.now();
      v.activationCode = {
        status: expired ? 'expired' : ac.status,
        // Shown to the authenticated owner only, and only while unused.
        code: ac.status === 'issued' && !expired ? C.decrypt(ac.code_enc) : null,
        expiresAt: ac.expires_at,
        usedAt: ac.used_at,
      };
    }
  }
  return v;
}
function deviceView(dv) {
  return {
    deviceId: dv.public_id, name: dv.name, os: dv.os, status: dv.status,
    activatedAt: dv.activated_at, lastSeenAt: dv.last_seen_at, deactivatedAt: dv.deactivated_at,
  };
}
const userLicenses = (userId) => db.get().prepare('SELECT * FROM licenses WHERE user_id=? ORDER BY id').all(userId);

// ---- activation ----------------------------------------------------------------
function recordAttempt(userId, ip, success, reason) {
  db.get().prepare('INSERT INTO activation_attempts(user_id,ip,success,reason,created_at) VALUES(?,?,?,?,?)')
    .run(userId, ip, success ? 1 : 0, reason || null, db.now());
}
function recentFailures(userId) {
  const since = db.now() - config.activationFailureWindowMin * 60_000;
  return db.get().prepare('SELECT COUNT(*) n FROM activation_attempts WHERE user_id=? AND success=0 AND created_at>?')
    .get(userId, since).n;
}

function validateDevice(device) {
  const uid = String(device?.uid || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(uid)) fail(400, 'INVALID_DEVICE', 'Invalid device identifier');
  return {
    uid,
    name: String(device?.name || 'Unknown PC').replace(/[^\p{L}\p{N} ._()-]/gu, '').slice(0, 64) || 'Unknown PC',
    os: String(device?.os || 'Unknown').replace(/[^\p{L}\p{N} ._()/-]/gu, '').slice(0, 64) || 'Unknown',
  };
}

function bindDevice(d, license, userId, device) {
  const active = d.prepare("SELECT * FROM devices WHERE license_id=? AND status='active'").all(license.id);
  const same = active.find((x) => x.device_uid === device.uid);
  if (same) {
    d.prepare('UPDATE devices SET last_seen_at=?, name=?, os=? WHERE id=?').run(db.now(), device.name, device.os, same.id);
    return same;
  }
  if (active.length >= license.max_devices) {
    fail(409, 'DEVICE_LIMIT', 'This license is already active on another computer. Transfer it from your account on the website first.',
      { activeDevice: deviceView(active[0]) });
  }
  const r = d.prepare(`INSERT INTO devices(public_id,device_uid,user_id,license_id,name,os,status,activated_at,last_seen_at)
    VALUES(?,?,?,?,?,?,'active',?,?)`).run(newDevicePublicId(), device.uid, userId, license.id, device.name, device.os, db.now(), db.now());
  return d.prepare('SELECT * FROM devices WHERE id=?').get(Number(r.lastInsertRowid));
}

function activate(userId, rawCode, deviceIn, ip) {
  const device = validateDevice(deviceIn);
  if (recentFailures(userId) >= config.activationMaxFailures) {
    fail(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${config.activationFailureWindowMin} minutes.`);
  }
  const code = normalizeCode(rawCode);
  if (!/^LVX(-[A-Z0-9]{4}){5}$/.test(code)) {
    recordAttempt(userId, ip, false, 'format');
    fail(400, 'INVALID_CODE', 'Activation code is invalid');
  }
  const hash = C.codeHash(code);
  let failure = null;
  try {
    return db.tx((d) => {
      const ac = d.prepare('SELECT * FROM activation_codes WHERE code_hash=?').get(hash);
      if (!ac) { failure = 'not_found'; fail(400, 'INVALID_CODE', 'Activation code is invalid'); }
      if (ac.user_id !== userId) { failure = 'other_account'; fail(403, 'CODE_OWNER_MISMATCH', 'This activation code belongs to a different LiveX account.'); }
      if (ac.status === 'used' || ac.used_at) { failure = 'reused'; fail(409, 'CODE_ALREADY_USED', 'This activation code has already been used and cannot be used again.'); }
      if (ac.status !== 'issued') { failure = 'revoked'; fail(403, 'CODE_REVOKED', 'This activation code is no longer valid.'); }
      if (ac.expires_at < db.now()) { failure = 'expired'; fail(410, 'CODE_EXPIRED', 'This activation code has expired. Contact support from your account.'); }
      const license = d.prepare('SELECT * FROM licenses WHERE id=?').get(ac.license_id);
      if (license.status === 'revoked') { failure = 'license_revoked'; fail(403, 'LICENSE_REVOKED', 'This license has been revoked.'); }

      // Consume first (conditional update): only one request can ever win.
      const upd = d.prepare("UPDATE activation_codes SET status='used', used_at=?, used_device_uid=? WHERE id=? AND used_at IS NULL AND status='issued'")
        .run(db.now(), device.uid, ac.id);
      if (upd.changes !== 1) { failure = 'race'; fail(409, 'CODE_ALREADY_USED', 'This activation code has already been used and cannot be used again.'); }

      const dev = bindDevice(d, license, userId, device);
      d.prepare("UPDATE licenses SET status='active', activated_at=COALESCE(activated_at, ?) WHERE id=?").run(db.now(), license.id);
      recordAttempt(userId, ip, true);
      db.audit(userId, 'license_activated', { license: license.license_id, device: dev.public_id }, ip);
      return licenseView(d.prepare('SELECT * FROM licenses WHERE id=?').get(license.id));
    });
  } finally {
    if (failure) recordAttempt(userId, ip, false, failure);
  }
}

// Bind an already-activated license to this computer (after a transfer).
function bindLicense(userId, licenseId, deviceIn, ip) {
  const device = validateDevice(deviceIn);
  return db.tx((d) => {
    const lic = d.prepare('SELECT * FROM licenses WHERE license_id=? AND user_id=?').get(licenseId, userId);
    if (!lic) fail(404, 'LICENSE_NOT_FOUND', 'License not found');
    if (lic.status === 'revoked') fail(403, 'LICENSE_REVOKED', 'This license has been revoked.');
    if (lic.status !== 'active') fail(409, 'NOT_ACTIVATED', 'Activate this license with its one-time activation code first.');
    const dev = bindDevice(d, lic, userId, device);
    db.audit(userId, 'device_bound', { license: lic.license_id, device: dev.public_id }, ip);
    return licenseView(lic);
  });
}

// ---- app status + signed lease -------------------------------------------------
function appStatus(user, deviceUid) {
  const d = db.get();
  const licenses = userLicenses(user.id);
  const entitlements = new Set();
  const views = licenses.map((l) => {
    const v = licenseView(l);
    const dev = d.prepare("SELECT * FROM devices WHERE license_id=? AND device_uid=? AND status='active'").get(l.id, deviceUid);
    v.boundToThisDevice = !!dev;
    if (l.status === 'active' && dev) {
      JSON.parse(l.entitlements).forEach((e) => entitlements.add(e));
      d.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(db.now(), dev.id);
      v.thisDeviceId = dev.public_id;
    }
    return v;
  });
  const ent = [...entitlements].sort();
  // Short-lived signed lease. The app trusts entitlements ONLY from a lease
  // whose Ed25519 signature verifies with the embedded public key and whose
  // `dev` matches its own install id. This also defines the offline policy.
  const lease = C.signJwt({
    typ: 'lease', sub: user.public_id, name: `${user.first_name} ${user.last_name}`,
    dev: deviceUid, ent, lic: views.filter((v) => v.boundToThisDevice && v.status === 'active').map((v) => v.licenseId),
  }, config.leaseTtlHours * 3600);
  return { entitlements: ent, licenses: views, lease, leaseTtlHours: config.leaseTtlHours, serverTime: db.now() };
}

// ---- transfers ------------------------------------------------------------------
function startTransfer(user, devicePublicId) {
  const d = db.get();
  const dev = d.prepare("SELECT * FROM devices WHERE public_id=? AND user_id=? AND status='active'").get(devicePublicId, user.id);
  if (!dev) fail(404, 'DEVICE_NOT_FOUND', 'Active device not found');
  const since = db.now() - 365 * DAY;
  const n = d.prepare("SELECT COUNT(*) n FROM transfers WHERE license_id=? AND status='completed' AND completed_at>?").get(dev.license_id, since).n;
  if (n >= config.transferLimitPerYear) {
    fail(403, 'TRANSFER_LIMIT', `Transfer limit reached (${config.transferLimitPerYear} per year). Contact support.`);
  }
  const r = d.prepare("INSERT INTO transfers(user_id,license_id,device_id,status,created_at) VALUES(?,?,?,'pending',?)")
    .run(user.id, dev.license_id, dev.id, db.now());
  return { transferId: Number(r.lastInsertRowid), device: dev };
}

function completeTransfer(userId, transferId) {
  return db.tx((d) => {
    const t = d.prepare('SELECT * FROM transfers WHERE id=? AND user_id=?').get(transferId, userId);
    if (!t || t.status !== 'pending') fail(400, 'INVALID_TOKEN', 'Invalid or expired link');
    const dev = d.prepare('SELECT * FROM devices WHERE id=?').get(t.device_id);
    d.prepare("UPDATE devices SET status='deactivated', deactivated_at=? WHERE id=? AND status='active'").run(db.now(), dev.id);
    d.prepare("UPDATE transfers SET status='completed', completed_at=? WHERE id=?").run(db.now(), t.id);
    // The old computer loses its session for this account.
    d.prepare('UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND device_uid=? AND revoked_at IS NULL')
      .run(db.now(), userId, dev.device_uid);
    db.audit(userId, 'license_transferred_out', { device: dev.public_id });
    return deviceView({ ...dev, status: 'deactivated' });
  });
}

// ---- admin ----------------------------------------------------------------------
function revokeLicense(licenseId, reason) {
  return db.tx((d) => {
    const l = d.prepare('SELECT * FROM licenses WHERE license_id=?').get(licenseId);
    if (!l) fail(404, 'LICENSE_NOT_FOUND', 'License not found');
    d.prepare("UPDATE licenses SET status='revoked', revoked_at=?, revoke_reason=? WHERE id=?").run(db.now(), reason || 'revoked', l.id);
    d.prepare("UPDATE activation_codes SET status='revoked' WHERE license_id=? AND status='issued'").run(l.id);
    db.audit(l.user_id, 'license_revoked', { licenseId, reason });
    return licenseView(d.prepare('SELECT * FROM licenses WHERE id=?').get(l.id));
  });
}

module.exports = {
  fulfillOrder, licenseView, deviceView, userLicenses, activate, bindLicense, appStatus,
  startTransfer, completeTransfer, revokeLicense, normalizeCode, nameTag, validateDevice,
};
