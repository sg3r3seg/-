'use strict';
// Operator CLI working directly on the database.
//   node scripts/admin.js revoke <LICENSE_ID> [reason]
//   node scripts/admin.js mark-paid <ORDER_ID>
//   node scripts/admin.js user <email|LVX-USER-…>
//   node scripts/admin.js issue <email> <PRO|TTS|BUNDLE>   -> issues a license + one-time KEYNAME (gift/manual sale)
const db = require('../src/db');
const L = require('../src/services/licenses');
const auth = require('../src/services/auth');
const C = require('../src/crypto');
const config = require('../src/config');

(async () => {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  db.open();
  if (cmd === 'revoke' && arg) console.log(L.revokeLicense(arg, rest.join(' ') || 'revoked by admin'));
  else if (cmd === 'mark-paid' && arg) console.log((await L.fulfillOrder(arg, { providerRef: `manual_${arg}` })).license);
  else if (cmd === 'user' && arg) {
    const u = db.get().prepare('SELECT * FROM users WHERE email=? OR public_id=?').get(arg, arg);
    if (!u) return console.log('not found');
    console.log(auth.publicUser(u));
    console.log(L.userLicenses(u.id).map((l) => L.licenseView(l)));
  } else if (cmd === 'issue' && arg) {
    const product = String(rest[0] || '').toUpperCase();
    const p = db.get().prepare('SELECT * FROM products WHERE code=?').get(product);
    if (!p) { console.log('Product must be PRO, TTS or BUNDLE'); process.exitCode = 1; return; }
    const u = db.get().prepare('SELECT * FROM users WHERE email=? OR public_id=?').get(String(arg).trim().toLowerCase(), arg);
    if (!u) { console.log(`No LiveX account for "${arg}". Create the account on the website first (http://127.0.0.1:${config.port}/register.html).`); process.exitCode = 1; return; }
    const orderId = `LVX-ORD-${C.randomChars(10)}`;
    db.get().prepare(`INSERT INTO orders(id,user_id,product_code,amount_agorot,currency,status,provider,created_at)
      VALUES(?,?,?,?,?,'pending','admin_issue',?)`).run(orderId, u.id, p.code, p.price_agorot, p.currency, db.now());
    const r = await L.fulfillOrder(orderId, { providerRef: `admin_${orderId}` });
    db.audit(u.id, 'license_issued_by_admin', { orderId, product: p.code });
    const v = L.licenseView(r.license, { withCode: true });
    const line = '='.repeat(60);
    console.log(`\n${line}\n  LiveX license issued\n${line}`);
    console.log(`  Holder        : ${v.holderName}`);
    console.log(`  User ID       : ${v.userId}`);
    console.log(`  Email         : ${v.email}`);
    console.log(`  Product       : ${p.name} (${v.entitlements.join(' + ').toUpperCase()})`);
    console.log(`  License ID    : ${v.licenseId}`);
    console.log(`  Personal code : ${v.personalCode}`);
    console.log(`\n  KEYNAME (one-time activation code):\n\n      ${r.code}\n`);
    console.log(`  Valid until   : ${new Date(v.activationCode.expiresAt).toLocaleString()}`);
    console.log(`  Sign in to LiveX with ${v.email} -> Account & License -> paste the code -> Activate.`);
    console.log(`  The code works once, only for this account. It is also shown in the account area on the website.\n${line}\n`);
  } else {
    console.log('usage: admin.js revoke <LICENSE_ID> [reason] | mark-paid <ORDER_ID> | user <email|USER_ID> | issue <email> <PRO|TTS|BUNDLE>');
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
