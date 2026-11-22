'use strict';
// Operator CLI working directly on the database.
//   node scripts/admin.js revoke <LICENSE_ID> [reason]
//   node scripts/admin.js mark-paid <ORDER_ID>
//   node scripts/admin.js user <email|LVX-USER-…>
const db = require('../src/db');
const L = require('../src/services/licenses');
const auth = require('../src/services/auth');

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
  } else {
    console.log('usage: admin.js revoke <LICENSE_ID> [reason] | mark-paid <ORDER_ID> | user <email|USER_ID>');
    process.exitCode = 1;
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
