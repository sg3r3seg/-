'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { app } = require('electron');
const config = require('./config');
const { request } = require('./api');
const { verifyRelease } = require('./tokens');

// Secure updates:
// 1. fetch the release manifest from the LiveX server
// 2. verify its Ed25519 signature with the release public key embedded in the app
// 3. download the installer and verify size + SHA-512 from the signed manifest
// 4. on Windows, report the Authenticode status (required if the manifest says so)
// 5. run the NSIS installer; user settings in %APPDATA%\LiveX are preserved.
class Updater {
  constructor() { this.state = { phase: 'idle', current: app.getVersion() }; this.listeners = new Set(); }
  emit(patch) { Object.assign(this.state, patch); for (const l of this.listeners) l({ ...this.state }); }

  async check() {
    this.emit({ phase: 'checking', error: null });
    try {
      const r = await request('GET', `/api/updates/latest?current=${encodeURIComponent(app.getVersion())}&platform=${process.platform}`);
      if (!r.available) { this.emit({ phase: 'up-to-date', checkedAt: Date.now() }); return this.state; }
      if (!verifyRelease(r.manifest, r.signature, config.releasePublicKey)) throw new Error('Update manifest signature is invalid — update refused');
      if (r.manifest.platform !== 'win32') throw new Error('Update is not for this platform');
      this.manifest = r.manifest;
      this.emit({ phase: 'available', version: r.manifest.version, notes: r.manifest.notes, size: r.manifest.size, checkedAt: Date.now() });
    } catch (e) { this.emit({ phase: 'error', error: e.message }); }
    return this.state;
  }

  async download() {
    if (!this.manifest) throw new Error('No verified update available');
    const m = this.manifest;
    const url = new URL(m.url, config.apiBase);
    if (url.origin !== config.apiBase) throw new Error('Update URL is not on the LiveX server');
    const dest = path.join(app.getPath('temp'), `LiveX-Setup-${m.version}-${crypto.randomBytes(4).toString('hex')}.exe`);
    this.emit({ phase: 'downloading', progress: 0 });
    const res = await fetch(url, { redirect: 'error' });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const hash = crypto.createHash('sha512'); const out = fs.createWriteStream(dest);
    let got = 0;
    for await (const chunk of res.body) {
      got += chunk.length;
      if (got > m.size) { out.destroy(); fs.rmSync(dest, { force: true }); throw new Error('Download larger than expected'); }
      hash.update(chunk); out.write(chunk);
      this.emit({ progress: Math.round((got / m.size) * 100) });
    }
    await new Promise((r) => out.end(r));
    if (got !== m.size || hash.digest('base64') !== m.sha512) { fs.rmSync(dest, { force: true }); this.emit({ phase: 'error', error: 'Checksum mismatch — update refused' }); throw new Error('Checksum mismatch'); }
    const authenticode = await this.authenticode(dest);
    if (m.requireAuthenticode && authenticode !== 'Valid') { fs.rmSync(dest, { force: true }); throw new Error(`Installer signature status: ${authenticode}`); }
    this.file = dest;
    this.emit({ phase: 'ready', authenticode, progress: 100 });
    return this.state;
  }

  authenticode(file) {
    if (process.platform !== 'win32') return Promise.resolve('NotApplicable');
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-AuthenticodeSignature -LiteralPath $args[0]).Status.ToString()', file],
        { timeout: 20000, windowsHide: true }, (err, stdout) => resolve(err ? 'Unknown' : String(stdout).trim() || 'Unknown'));
    });
  }

  install() {
    if (!this.file || !fs.existsSync(this.file)) throw new Error('Update not downloaded');
    if (process.platform !== 'win32') throw new Error('Installer can only run on Windows');
    spawn(this.file, ['--updated'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 500);
    return true;
  }
}
module.exports = new Updater();
