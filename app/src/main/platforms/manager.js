'use strict';
const { EventEmitter } = require('node:events');
const secure = require('../secure');
const { Twitch } = require('./twitch');
const { YouTube } = require('./youtube');
const { Kick } = require('./kick');
const { TikTok } = require('./tiktok');
const { Discord } = require('./discord');

// Owns all platform connectors. Credentials are kept in secure storage.
class PlatformManager extends EventEmitter {
  constructor() {
    super();
    this.connectors = { tiktok: new TikTok(), youtube: new YouTube(), kick: new Kick(), twitch: new Twitch(), discord: new Discord() };
    for (const c of Object.values(this.connectors)) c.on('status', (s) => this.emit('status', s));
  }
  statuses() { return Object.values(this.connectors).map((c) => ({ ...c.status })); }
  savedConfig(id) {
    const cfg = secure.get(`platform:${id}`) || {};
    // Never return secrets to the renderer; only whether they are set.
    const safe = { ...cfg };
    for (const k of ['apiKey', 'oauthToken', 'webhookUrl']) if (safe[k]) safe[k] = '••••••••';
    return safe;
  }
  async connect(id, cfgIn) {
    const c = this.connectors[id];
    if (!c) throw new Error('Unknown platform');
    const prev = secure.get(`platform:${id}`) || {};
    const cfg = { ...cfgIn };
    for (const k of ['apiKey', 'oauthToken', 'webhookUrl']) if (cfg[k] === '••••••••') cfg[k] = prev[k];
    await c.connect(cfg);
    secure.set(`platform:${id}`, { ...cfg, autoConnect: true });
    return { ...c.status };
  }
  disconnect(id) {
    const c = this.connectors[id];
    if (!c) throw new Error('Unknown platform');
    c.disconnect();
    const prev = secure.get(`platform:${id}`);
    if (prev) secure.set(`platform:${id}`, { ...prev, autoConnect: false });
    return { ...c.status };
  }
  forget(id) { this.connectors[id]?.disconnect(); secure.del(`platform:${id}`); }
  autoConnect() {
    for (const id of Object.keys(this.connectors)) {
      const cfg = secure.get(`platform:${id}`);
      if (cfg?.autoConnect) Promise.resolve().then(() => this.connectors[id].connect(cfg)).catch(() => {});
    }
  }
  disconnectAll() { for (const c of Object.values(this.connectors)) c.disconnect(); }
  // Send a chat message to every connected platform that supports writing.
  async sendChat(text, only) {
    const results = [];
    for (const c of Object.values(this.connectors)) {
      if (c.id === 'discord' || (only && only !== c.id)) continue;
      if (c.status.state === 'connected' && c.status.canWrite) {
        try { await c.send(text); results.push({ platform: c.id, ok: true }); } catch (e) { results.push({ platform: c.id, ok: false, error: e.message }); }
      }
    }
    return results;
  }
}
module.exports = new PlatformManager();
