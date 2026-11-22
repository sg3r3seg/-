'use strict';
// Publishes a Windows installer as the latest release:
//   node scripts/publish-release.js <path-to-installer.exe> <version> [notes]
// Copies the file to releases/files, computes SHA-512 and signs the manifest
// with the release Ed25519 key (verified by the app before installing).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../src/config');
const { signRelease } = require('../src/crypto');

const [file, version, ...notes] = process.argv.slice(2);
if (!file || !/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: publish-release.js <installer.exe> <x.y.z> [notes]');
  process.exit(1);
}
const buf = fs.readFileSync(file);
const name = `LiveX-Setup-${version}.exe`;
const dir = path.join(config.releasesDir, 'files');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, name), buf);
const manifest = {
  product: 'LiveX', platform: 'win32', arch: 'x64', version,
  file: name, url: `/api/updates/files/${name}`,
  size: buf.length, sha512: crypto.createHash('sha512').update(buf).digest('base64'),
  notes: notes.join(' ') || '', publishedAt: new Date().toISOString(),
};
const out = { manifest, signature: signRelease(manifest) };
fs.writeFileSync(path.join(config.releasesDir, 'latest.json'), JSON.stringify(out, null, 2));
console.log('published', manifest);
