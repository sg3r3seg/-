'use strict';
const WebSocket = require('ws');
const { Connector } = require('./base');

// Kick: Kick's official public API requires a registered developer app with
// webhooks delivered to a public server. Until such an app is configured,
// LiveX reads the channel's public chat feed (the same Pusher feed kick.com
// uses). This is marked as an unofficial connector in the UI.
const PUSHER = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

class Kick extends Connector {
  constructor() { super('kick', 'Kick'); this.status.unofficial = true; }

  async lookup(slug) {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw Object.assign(new Error(`Kick channel lookup failed (${res.status}). Enter the chatroom ID manually.`), { code: 'LOOKUP_FAILED' });
    const j = await res.json();
    return { chatroomId: j.chatroom?.id, channelId: j.id, live: !!j.livestream, viewers: j.livestream?.viewer_count ?? null };
  }

  async connect({ channel, chatroomId }) {
    const slug = String(channel || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(slug)) throw Object.assign(new Error('Invalid Kick channel name'), { code: 'VALIDATION' });
    this.wantConnected = true; this.retry = 0;
    this.setStatus({ state: 'connecting', detail: 'kick.com', channel: slug });
    let info = { chatroomId: chatroomId ? parseInt(chatroomId, 10) : null, channelId: null, live: null, viewers: null };
    if (!info.chatroomId) {
      try { info = await this.lookup(slug); } catch (e) { this.setStatus({ state: 'error', detail: e.message }); this.wantConnected = false; throw e; }
    }
    if (!info.chatroomId) { this.setStatus({ state: 'error', detail: 'Chatroom not found' }); throw new Error('Chatroom not found'); }
    this.cfg = { slug, ...info };
    this.setStatus({ live: info.live, viewers: info.viewers });
    this.open();
  }

  open() {
    this.ws?.removeAllListeners(); this.ws?.terminate?.();
    const ws = new WebSocket(PUSHER); this.ws = ws;
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      const data = typeof m.data === 'string' ? (() => { try { return JSON.parse(m.data); } catch { return {}; } })() : (m.data || {});
      switch (m.event) {
        case 'pusher:connection_established':
          ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${this.cfg.chatroomId}.v2` } }));
          if (this.cfg.channelId) ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `channel.${this.cfg.channelId}` } }));
          break;
        case 'pusher_internal:subscription_succeeded':
          if (String(m.channel).startsWith('chatrooms.')) { this.retry = 0; this.setStatus({ state: 'connected', detail: `kick.com/${this.cfg.slug}` }); this.log('info', `joined Kick chatroom ${this.cfg.chatroomId}`); }
          break;
        case 'pusher:ping': ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); break;
        case 'App\\Events\\ChatMessageEvent': {
          const s = data.sender || {};
          const badges = (s.identity?.badges || []).map((b) => b.type);
          this.publish({ type: 'chat', user: { id: String(s.id), name: s.username, badges, isMod: badges.includes('moderator') || badges.includes('broadcaster'), color: s.identity?.color }, text: String(data.content || '').replace(/\[emote:\d+:([^\]]+)\]/g, ':$1:') });
          break;
        }
        case 'App\\Events\\SubscriptionEvent': this.publish({ type: 'sub', user: { name: data.username }, count: data.months }); break;
        case 'App\\Events\\GiftedSubscriptionsEvent': this.publish({ type: 'gift', user: { name: data.gifter_username }, gift: 'Gift sub', count: (data.gifted_usernames || []).length || 1 }); break;
        case 'App\\Events\\StreamHostEvent': this.publish({ type: 'raid', user: { name: data.host_username }, count: data.number_viewers }); break;
        case 'App\\Events\\FollowersUpdated': if (data.followed) this.publish({ type: 'follow', user: { name: data.username } }); break;
        case 'App\\Events\\StreamerIsLive': this.setStatus({ live: true }); break;
        case 'App\\Events\\StopStreamBroadcast': this.setStatus({ live: false }); break;
        default: break;
      }
    });
    ws.on('close', () => { if (this.wantConnected) this.scheduleReconnect(() => this.open()); });
    ws.on('error', (e) => this.setStatus({ state: 'error', detail: e.message }));
  }
  disconnect() { super.disconnect(); this.ws?.removeAllListeners(); this.ws?.close(); this.ws = null; }
}
module.exports = { Kick };
