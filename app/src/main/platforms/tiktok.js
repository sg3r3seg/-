'use strict';
const WebSocket = require('ws');
const { Connector } = require('./base');

// TikTok LIVE has no public official live-events API. LiveX connects to an
// integration provider that exposes TikTok LIVE events over a WebSocket —
// e.g. TikFinity's local Event API (ws://localhost:21213/) or any provider
// emitting the same {event, data} JSON format. Status is "connected" only
// while the provider socket is open.
class TikTok extends Connector {
  constructor() { super('tiktok', 'TikTok LIVE'); }
  connect({ providerUrl, username }) {
    const url = String(providerUrl || 'ws://127.0.0.1:21213/').trim();
    let u; try { u = new URL(url); } catch { throw Object.assign(new Error('Invalid provider WebSocket URL'), { code: 'VALIDATION' }); }
    if (!['ws:', 'wss:'].includes(u.protocol)) throw Object.assign(new Error('Provider URL must start with ws:// or wss://'), { code: 'VALIDATION' });
    if (u.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw Object.assign(new Error('Remote providers must use wss://'), { code: 'VALIDATION' });
    this.cfg = { url: u.toString(), username: String(username || '').replace(/^@/, '') };
    this.wantConnected = true; this.retry = 0;
    this.open();
  }
  open() {
    this.ws?.removeAllListeners(); this.ws?.terminate?.();
    this.setStatus({ state: 'connecting', detail: this.cfg.url, channel: this.cfg.username ? `@${this.cfg.username}` : null });
    const ws = new WebSocket(this.cfg.url, { handshakeTimeout: 8000 }); this.ws = ws;
    ws.on('open', () => { this.retry = 0; this.setStatus({ state: 'connected', detail: `provider ${this.cfg.url}` }); this.log('info', `connected to provider ${this.cfg.url}`); });
    ws.on('message', (buf) => { try { this.map(JSON.parse(buf.toString())); } catch { /* ignore malformed */ } });
    ws.on('close', () => { if (this.wantConnected) this.scheduleReconnect(() => this.open()); });
    ws.on('error', (e) => this.setStatus({ state: 'error', detail: `${e.message} — is the provider running?` }));
  }
  map(m) {
    const d = m.data || {};
    const user = { id: d.userId || d.uniqueId, name: d.nickname || d.uniqueId, avatar: d.profilePictureUrl, isMod: !!d.isModerator, badges: [d.isModerator && 'moderator', d.isSubscriber && 'subscriber'].filter(Boolean) };
    switch (m.event) {
      case 'chat': this.publish({ type: 'chat', user, text: d.comment }); break;
      case 'gift':
        // Streakable gifts: count only when the streak ends (repeatEnd) or the gift is not streakable.
        if (d.giftType === 1 && !d.repeatEnd) return;
        this.publish({ type: 'gift', user, gift: d.giftName || `Gift ${d.giftId}`, count: d.repeatCount || 1, amount: (d.diamondCount || 0) * (d.repeatCount || 1), currency: 'diamonds', image: d.giftPictureUrl });
        break;
      case 'follow': this.publish({ type: 'follow', user }); break;
      case 'social': if (/follow/i.test(d.displayType || '')) this.publish({ type: 'follow', user }); else if (/share/i.test(d.displayType || '')) this.publish({ type: 'share', user }); break;
      case 'share': this.publish({ type: 'share', user }); break;
      case 'like': this.publish({ type: 'like', user, count: d.likeCount || 1, total: d.totalLikeCount }); break;
      case 'subscribe': this.publish({ type: 'sub', user }); break;
      case 'member': this.publish({ type: 'join', user }); break;
      case 'roomUser': if (typeof d.viewerCount === 'number') { this.setStatus({ viewers: d.viewerCount, live: true }); this.publish({ type: 'viewers', count: d.viewerCount }); } break;
      case 'streamEnd': this.setStatus({ live: false }); break;
      default: break;
    }
  }
  disconnect() { super.disconnect(); this.ws?.removeAllListeners(); this.ws?.close(); this.ws = null; }
}
module.exports = { TikTok };
