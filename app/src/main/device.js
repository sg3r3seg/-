'use strict';
const crypto = require('node:crypto');
const os = require('node:os');
const secure = require('./secure');

// Random installation identifier — no hardware fingerprinting. Generated once
// per installation, stored encrypted, and bound to the license on the server.
function installId() {
  let id = secure.get('installId');
  if (!id) { id = crypto.randomBytes(32).toString('base64url'); secure.set('installId', id); }
  return id;
}
function info() {
  const rel = os.release();
  let osName = `${os.type()} ${rel}`;
  if (process.platform === 'win32') {
    const build = parseInt(rel.split('.')[2] || '0', 10);
    osName = `Windows ${build >= 22000 ? '11' : '10'} (${rel})`;
  }
  return { uid: installId(), name: os.hostname().slice(0, 64), os: `${osName} ${os.arch()}`.slice(0, 64) };
}
module.exports = { installId, info };
