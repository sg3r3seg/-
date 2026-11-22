'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// REMOTE CONTROL: LAN web panel (phone/tablet). Off by default. Access needs
// a random 6-digit PIN shown in the app; a successful PIN yields a session
// token. Failed PIN attempts are rate limited and the PIN rotates on restart.
class RemoteServer {
  constructor() { this.server = null; this.sessions = new Map(); this.fails = new Map(); this.pin = null; this.port = null; this.actions = null; }

  async start({ port, actions }) {
    await this.stop();
    this.actions = actions;
    this.pin = String(crypto.randomInt(100000, 1000000));
    this.sessions.clear();
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { /* ignore */ } }));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '0.0.0.0', () => { this.server.off('error', reject); resolve(); }); });
    this.port = this.server.address().port;
    return this.info();
  }
  info() {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    return { running: !!this.server?.listening, port: this.port, pin: this.pin, urls: ips.map((ip) => `http://${ip}:${this.port}/`), sessions: this.sessions.size };
  }
  json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(obj)); }
  async body(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 16 * 1024) throw new Error('too large'); chunks.push(c); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
  }
  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'", 'X-Frame-Options': 'DENY' });
      fs.createReadStream(path.join(__dirname, '..', 'remote', 'index.html')).pipe(res); return;
    }
    if (req.method === 'GET' && u.pathname === '/remote.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      fs.createReadStream(path.join(__dirname, '..', 'remote', 'remote.js')).pipe(res); return;
    }
    if (req.method === 'GET' && u.pathname === '/api/lang') return this.json(res, 200, { lang: this.actions.lang ? this.actions.lang() : 'en' });
    const ip = req.socket.remoteAddress;
    if (req.method === 'POST' && u.pathname === '/api/pin') {
      const f = this.fails.get(ip) || { n: 0, until: 0 };
      if (f.until > Date.now()) return this.json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      const b = await this.body(req);
      const ok = typeof b.pin === 'string' && b.pin.length === 6 && crypto.timingSafeEqual(Buffer.from(b.pin), Buffer.from(this.pin));
      if (!ok) { f.n += 1; if (f.n >= 5) { f.until = Date.now() + 60_000; f.n = 0; } this.fails.set(ip, f); return this.json(res, 401, { error: 'Wrong PIN' }); }
      this.fails.delete(ip);
      const token = crypto.randomBytes(24).toString('base64url');
      this.sessions.set(token, { ip, at: Date.now() });
      return this.json(res, 200, { token });
    }
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!this.sessions.has(tok)) return this.json(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET' && u.pathname === '/api/state') return this.json(res, 200, await this.actions.state());
    if (req.method === 'POST' && u.pathname === '/api/action') {
      const b = await this.body(req);
      try { return this.json(res, 200, { ok: true, result: await this.actions.run(String(b.action || ''), b) }); } catch (e) { return this.json(res, 400, { error: e.message }); }
    }
    return this.json(res, 404, { error: 'Not found' });
  }
  async stop() {
    if (this.server) await new Promise((r) => this.server.close(() => r()));
    this.server = null; this.sessions.clear(); this.port = null;
  }
}
module.exports = { RemoteServer };
