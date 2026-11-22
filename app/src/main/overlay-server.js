'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');

// Local overlay server for OBS Browser Sources. Bound to 127.0.0.1 only.
// Every URL carries a per-install key; WebSocket upgrades must present it and
// come from the overlay origin (blocks other websites from connecting).
const ROUTES = ['alerts', 'chat', 'tts', 'wheel', 'follower-goal', 'timer', 'giveaway'];
const DIR = path.join(__dirname, '..', 'overlays');

class OverlayServer {
  constructor() { this.server = null; this.wss = null; this.state = {}; this.port = null; this.key = null; this.clients = new Set(); this.styles = {}; }

  async start({ port, key }) {
    await this.stop();
    this.key = key;
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.server.on('upgrade', (req, socket, head) => {
      const u = new URL(req.url, 'http://x');
      const origin = req.headers.origin;
      const okOrigin = !origin || origin === `http://127.0.0.1:${this.port}` || origin === `http://localhost:${this.port}` || origin === 'null';
      if (u.pathname !== '/ws' || !this.validKey(u.searchParams.get('key')) || !okOrigin || this.disabled?.has(u.searchParams.get('route'))) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onClient(ws, u.searchParams.get('route')));
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => { this.server.off('error', reject); resolve(); });
    });
    this.port = this.server.address().port;
    return this.port;
  }
  validKey(k) {
    return typeof k === 'string' && k.length === this.key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(this.key));
  }
  url(route) { return `http://127.0.0.1:${this.port}/${route}?key=${this.key}`; }
  mediaUrl(name) { return `/media/${encodeURIComponent(name)}?key=${this.key}`; }
  setDisabled(list) {
    this.disabled = new Set(list);
    for (const c of this.clients) if (this.disabled.has(c.route)) c.close(4001, 'disabled');
  }
  running() { return !!this.server?.listening; }

  handle(req, res) {
    const u = new URL(req.url, 'http://x');
    const route = u.pathname.replace(/^\/+|\/+$/g, '');
    const sec = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
    if (route === 'health') { res.writeHead(200, { ...sec, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, service: 'livex-overlay' })); return; }
    if (route.startsWith('assets/')) {
      const f = path.join(DIR, 'assets', path.basename(route));
      if (!fs.existsSync(f)) { res.writeHead(404, sec); res.end(); return; }
      const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { ...sec, 'Content-Type': `${type}; charset=utf-8` }); fs.createReadStream(f).pipe(res); return;
    }
    if (route.startsWith('media/')) {
      const name = path.basename(route);
      const f = this.mediaDir && path.join(this.mediaDir, name);
      const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
      if (!this.validKey(u.searchParams.get('key')) || !f || !types[path.extname(name)] || !fs.existsSync(f)) { res.writeHead(404, sec); res.end(); return; }
      res.writeHead(200, { ...sec, 'Content-Type': types[path.extname(name)] }); fs.createReadStream(f).pipe(res); return;
    }
    if (!ROUTES.includes(route)) { res.writeHead(404, sec); res.end('Not found'); return; }
    if (this.disabled?.has(route)) { res.writeHead(410, sec); res.end('This overlay is disabled in LiveX'); return; }
    if (!this.validKey(u.searchParams.get('key'))) { res.writeHead(403, sec); res.end('Invalid overlay key'); return; }
    res.writeHead(200, { ...sec, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*" });
    fs.createReadStream(path.join(DIR, `${route}.html`)).pipe(res);
  }

  onClient(ws, route) {
    ws.route = ROUTES.includes(route) ? route : 'unknown';
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', () => {}); // overlays are receive-only
    ws.send(JSON.stringify({ type: 'hello', route: ws.route, lang: this.lang || 'en', style: this.styles[ws.route] || {}, state: this.state[ws.route] || null }));
  }
  // Send a message to overlays of a route; `sticky` state is replayed to new clients.
  broadcast(route, type, payload, { sticky = false } = {}) {
    if (sticky) this.state[route] = { type, payload };
    if (this.disabled?.has(route)) return;
    const msg = JSON.stringify({ type, payload });
    for (const c of this.clients) if (c.route === route && c.readyState === 1) c.send(msg);
  }
  setLang(lang) {
    this.lang = lang === 'he' ? 'he' : 'en';
    const msg = JSON.stringify({ type: 'lang', payload: this.lang });
    for (const c of this.clients) if (c.readyState === 1) c.send(msg);
  }
  setStyle(route, style) {
    this.styles[route] = style;
    this.broadcast(route, 'style', style);
  }
  clientCounts() {
    const counts = Object.fromEntries(ROUTES.map((r) => [r, 0]));
    for (const c of this.clients) if (counts[c.route] !== undefined) counts[c.route] += 1;
    return counts;
  }
  // Real check: fetch each overlay URL over HTTP and confirm the page is served.
  async verify() {
    const out = [];
    for (const r of ROUTES) {
      const url = this.url(r);
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const body = await res.text();
        out.push({ route: r, url, ok: res.ok && body.includes(`data-overlay="${r}"`), disabled: !!this.disabled?.has(r), status: res.status, checkedAt: Date.now() });
      } catch (e) { out.push({ route: r, url, ok: false, error: e.message, checkedAt: Date.now() }); }
    }
    return out;
  }
  async stop() {
    for (const c of this.clients) c.terminate();
    this.clients.clear();
    if (this.server) await new Promise((r) => this.server.close(() => r()));
    this.server = null;
  }
}
module.exports = { OverlayServer, ROUTES };
