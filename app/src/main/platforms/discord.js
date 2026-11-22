'use strict';
const { Connector } = require('./base');

// Discord via an official channel Webhook (outgoing announcements only).
const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,120}$/;

class Discord extends Connector {
  constructor() { super('discord', 'Discord'); }
  async connect({ webhookUrl }) {
    const url = String(webhookUrl || '').trim();
    if (!WEBHOOK.test(url)) throw Object.assign(new Error('Enter a valid Discord webhook URL'), { code: 'VALIDATION' });
    this.setStatus({ state: 'connecting', detail: 'checking webhook' });
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, statusText: e.message }));
    if (!res.ok) { this.setStatus({ state: 'error', detail: `Webhook check failed: ${res.status || ''} ${res.statusText || ''}` }); throw new Error('Discord webhook is not valid'); }
    const j = await res.json();
    this.url = url;
    this.setStatus({ state: 'connected', detail: `#${j.channel_id} · ${j.name}`, canWrite: true, channel: j.name });
  }
  async send(content) {
    if (!this.url) return super.send();
    const res = await fetch(`${this.url}?wait=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'LiveX', content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Discord returned ${res.status}`);
    return true;
  }
  disconnect() { super.disconnect(); this.url = null; }
}
module.exports = { Discord, WEBHOOK };
