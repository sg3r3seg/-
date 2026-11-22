'use strict';
// Builds the Windows installer:
//   1. electron-builder packages LiveX for win32-x64 into release/win-unpacked
//      (afterPack embeds icon + version info, no Wine needed)
//   2. makensis compiles build/installer.nsi into release/LiveX-Setup-<version>.exe
// Works on Windows, Linux and macOS (needs `makensis`: apt install nsis / choco install nsis / brew install makensis).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config', 'livex.config.json'), 'utf8'));
if (!cfg.tokenPublicKey || !cfg.releasePublicKey) throw new Error('config/livex.config.json is missing public keys — run "npm run keys" in /server');
const api = new URL(cfg.apiBase);
if (api.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(api.hostname)) throw new Error('apiBase must be https');
if (api.protocol !== 'https:') console.warn(`! Building with a LOCAL server address (${cfg.apiBase}). For distribution set LIVEX_API_BASE=https://… and run "npm run keys" in /server.`);

const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32', ...opts });

run(bin('electron-builder'), ['--win', 'dir', '--x64', '--publish', 'never']);

function findMakensis() {
  if (process.env.MAKENSIS) return process.env.MAKENSIS;
  for (const c of ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe']) {
    try { execFileSync(c, ['-VERSION'], { stdio: 'ignore' }); return c; } catch { /* try next */ }
  }
  throw new Error('makensis not found. Install NSIS (apt install nsis / choco install nsis) or set MAKENSIS.');
}
const sidebar = path.join(root, 'build', 'sidebar.bmp');
if (!fs.existsSync(sidebar)) throw new Error('build/sidebar.bmp missing — run "npm run icons"');
const out = path.join(root, 'release', `LiveX-Setup-${pkg.version}.exe`);
run(findMakensis(), ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${pkg.version}`, `-DSRC=${path.join(root, 'release', 'win-unpacked')}`, `-DOUTFILE=${out}`, path.join(root, 'build', 'installer.nsi')]);
const buf = fs.readFileSync(out);
console.log(`\nInstaller: ${out}\nSize: ${(buf.length / 1048576).toFixed(1)} MB\nSHA-256: ${crypto.createHash('sha256').update(buf).digest('hex')}`);
