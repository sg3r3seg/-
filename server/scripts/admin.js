'use strict';
// Operator CLI working directly on the database (run on the server machine).
//   node scripts/admin.js revoke <LICENSE_ID> [reason]
//   node scripts/admin.js mark-paid <ORDER_ID>
//   node scripts/admin.js user <email|LVX-USER-…>
//   node scripts/admin.js issue <email> <PRO|TTS|BUNDLE>
//        -> issues a license + one-time KEYNAME (gift / manual sale)
//   LIVEX_NEW_PASSWORD=… node scripts/admin.js create-account <email> [first] [last] [PRO|TTS|BUNDLE]
//        -> creates an already-verified account (e.g. for testing), optionally with a license.
//           The password is read from the environment so it never appears in files or history.
const db = require('../src/db');
const L = require('../src/services/licenses');
const auth = require('../src/services/auth');
const C = require('../src/crypto');
const V = require('../src/http');
const config = require('../src/config');

async function issue(who, product0) {
  const product = String(product0 || '').toUpperCase();
  const p = db.get().prepare('SELECT * FROM products WHERE code=?').get(product);
  if (!p) { console.log('Product must be PRO, TTS or BUNDLE'); process.exitCode = 1; return; }
  const u = db.get().prepare('SELECT * FROM users WHERE email=? OR public_id=?').get(String(who).trim().toLowerCase(), who);
  if (!u) { console.log(`No LiveX account for "${who}". Create the account on the website first (http://127.0.0.1:${config.port}/register.html).`); process.exitCode = 1; return; }
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
}

function createAccount(emailIn, first0, last0) {
  const email = V.email(emailIn);
  const pw = V.password(process.env.LIVEX_NEW_PASSWORD || '');
  const NAME = { min: 1, max: 60, pattern: /^[\p{L}\p{M}' .-]+$/u };
  const first = V.str(first0 || 'Test', { ...NAME, name: 'firstName' });
  const last = V.str(last0 || 'User', { ...NAME, name: 'lastName' });
  const existing = db.get().prepare('SELECT * FROM users WHERE email=?').get(email);
  if (existing) {
    db.get().prepare('UPDATE users SET password_hash=?, email_verified_at=COALESCE(email_verified_at, ?) WHERE id=?').run(C.hashPassword(pw), db.now(), existing.id);
    db.audit(existing.id, 'account_password_set_by_admin');
    console.log(`\n  Account already existed: ${email} (User ID ${existing.public_id}) — password updated, email marked verified.`);
    return existing;
  }
  const u = db.tx((d) => {
    const r = d.prepare('INSERT INTO users(first_name,last_name,email,password_hash,email_verified_at,created_at) VALUES(?,?,?,?,?,?)')
      .run(first, last, email, C.hashPassword(pw), db.now(), db.now());
    const id = Number(r.lastInsertRowid);
    d.prepare('UPDATE users SET public_id=? WHERE id=?').run(`LVX-USER-${String(id).padStart(6, '0')}`, id);
    return d.prepare('SELECT * FROM users WHERE id=?').get(id);
  });
  db.audit(u.id, 'account_created_by_admin');
  console.log(`\n  Account created (email already verified): ${email}\n  Name: ${first} ${last}   User ID: ${u.public_id}`);
  return u;
}

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
  } else if (cmd === 'issue' && arg) await issue(arg, rest[0]);
  else if (cmd === 'create-account' && arg) {
    const u = createAccount(arg, rest[0], rest[1]);
    if (rest[2]) {
      // Idempotent: running it again shows the license the account already has instead of issuing another one.
      const have = L.userLicenses(u.id).filter((l) => l.product_code === String(rest[2]).toUpperCase() && l.status !== 'revoked');
      if (!have.length) await issue(u.email, rest[2]);
      else for (const l of have) {
        const v = L.licenseView(l, { withCode: true });
        console.log(`\n  This account already has ${v.product} — License ID ${v.licenseId}, status: ${v.status}.`);
        console.log(v.activationCode?.code ? `  KEYNAME (not used yet): ${v.activationCode.code}` : '  Its KEYNAME was already used — sign in to LiveX with this account and the license loads automatically.');
      }
    }
  } else {
    console.log('usage: admin.js revoke <LICENSE_ID> [reason] | mark-paid <ORDER_ID> | user <email|USER_ID> | issue <email> <PRO|TTS|BUNDLE>\n       LIVEX_NEW_PASSWORD=... admin.js create-account <email> [first] [last] [PRO|TTS|BUNDLE]');
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
