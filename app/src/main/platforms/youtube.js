'use strict';
const { Connector } = require('./base');

// YouTube LIVE via the official YouTube Data API v3 using the creator's own
// API key (stored encrypted with the OS keychain). Reads live chat, Super
// Chats, memberships and the concurrent viewer count reported by YouTube.
const API = 'https://www.googleapis.com/youtube/v3';

class YouTube extends Connector {
  constructor() { super('youtube', 'YouTube LIVE'); }

  async api(path, params, { method = 'GET', body } = {}) {
    const url = new URL(`${API}/${path}`);
    const headers = {};
    // Prefer the creator's Google sign-in (OAuth); fall back to an API key.
    const token = this.cfg.getToken ? await this.cfg.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (this.cfg.apiKey) params = { ...params, key: this.cfg.apiKey };
    else throw Object.assign(new Error('YouTube sign-in expired — reconnect your Google account'), { code: 'REAUTH_REQUIRED', status: 401 });
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j?.error?.message || `YouTube API ${res.status}`), { status: res.status, reason: j?.error?.errors?.[0]?.reason });
    return j;
  }

  async connect({ apiKey, videoOrChannel, getToken }) {
    if (!getToken && (!apiKey || apiKey.length < 20)) throw Object.assign(new Error('Sign in with Google (Social Accounts) or enter a YouTube Data API key'), { code: 'VALIDATION' });
    this.cfg = { apiKey, getToken, target: String(videoOrChannel || '').trim() || (getToken ? 'mine' : '') };
    if (!this.cfg.target) throw Object.assign(new Error('Enter a live video URL/ID or a channel ID'), { code: 'VALIDATION' });
    this.wantConnected = true; this.retry = 0;
    await this.start();
  }

  async resolveVideoId() {
    const t = this.cfg.target;
    if (t === 'mine') { // signed-in creator: find their own active broadcast
      const r = await this.api('liveBroadcasts', { part: 'id,snippet', broadcastStatus: 'active', broadcastType: 'all', maxResults: '1' });
      if (!r.items?.length) throw Object.assign(new Error('Your YouTube channel is not live right now'), { code: 'NOT_LIVE' });
      return r.items[0].id;
    }
    const m = t.match(/(?:v=|youtu\.be\/|\/live\/)([A-Za-z0-9_-]{11})/) || t.match(/^([A-Za-z0-9_-]{11})$/);
    if (m) return m[1];
    const ch = t.match(/(UC[A-Za-z0-9_-]{22})/);
    if (!ch) throw Object.assign(new Error('Use a video URL/ID or a channel ID starting with UC'), { code: 'VALIDATION' });
    const s = await this.api('search', { part: 'id', channelId: ch[1], eventType: 'live', type: 'video', maxResults: '1' });
    if (!s.items?.length) throw Object.assign(new Error('This channel is not live right now'), { code: 'NOT_LIVE' });
    return s.items[0].id.videoId;
  }

  async start() {
    clearTimeout(this.retryTimer); clearTimeout(this.pollTimer); clearInterval(this.viewTimer);
    this.setStatus({ state: 'connecting', detail: 'YouTube Data API' });
    try {
      this.videoId = await this.resolveVideoId();
      const v = await this.videoDetails();
      this.liveChatId = v.liveStreamingDetails?.activeLiveChatId;
      if (!this.liveChatId) throw Object.assign(new Error('This video has no active live chat'), { code: 'NOT_LIVE' });
      this.pageToken = undefined; this.first = true; this.retry = 0;
      this.setStatus({ state: 'connected', detail: v.snippet?.title || this.videoId, channel: v.snippet?.channelTitle, live: true, canWrite: !!this.cfg.getToken });
      this.log('info', `connected to live chat of ${this.videoId}`);
      this.poll();
      this.viewTimer = setInterval(() => this.videoDetails().catch(() => {}), 30_000);
    } catch (e) {
      this.setStatus({ state: 'error', detail: e.message, live: e.code === 'NOT_LIVE' ? false : null });
      if (e.status === 400 || e.status === 401 || e.status === 403 || e.code === 'VALIDATION' || e.code === 'REAUTH_REQUIRED') { this.wantConnected = false; throw e; }
      this.scheduleReconnect(() => this.start().catch(() => {}));
      throw e;
    }
  }

  async videoDetails() {
    const r = await this.api('videos', { part: 'liveStreamingDetails,snippet', id: this.videoId });
    const v = r.items?.[0];
    if (!v) throw Object.assign(new Error('Video not found'), { code: 'NOT_FOUND' });
    const lsd = v.liveStreamingDetails || {};
    const viewers = lsd.concurrentViewers !== undefined ? parseInt(lsd.concurrentViewers, 10) : null;
    const live = !!lsd.actualStartTime && !lsd.actualEndTime;
    this.setStatus({ viewers, live });
    if (viewers !== null) this.publish({ type: 'viewers', count: viewers });
    return v;
  }

  async poll() {
    if (!this.wantConnected) return;
    try {
      const r = await this.api('liveChat/messages', { liveChatId: this.liveChatId, part: 'snippet,authorDetails', maxResults: '2000', ...(this.pageToken ? { pageToken: this.pageToken } : {}) });
      this.pageToken = r.nextPageToken;
      // Skip backlog from before connecting; only live messages from now on.
      if (!this.first) for (const it of r.items || []) this.map(it);
      this.first = false;
      this.pollTimer = setTimeout(() => this.poll(), Math.max(3000, r.pollingIntervalMillis || 5000));
    } catch (e) {
      if (e.reason === 'liveChatEnded' || e.reason === 'liveChatNotFound') {
        this.setStatus({ state: 'disconnected', detail: 'Live chat ended', live: false }); this.wantConnected = false; return;
      }
      this.setStatus({ state: 'error', detail: e.message });
      this.scheduleReconnect(() => this.start().catch(() => {}));
    }
  }

  map(it) {
    const s = it.snippet; const a = it.authorDetails || {};
    const user = { id: a.channelId, name: a.displayName, avatar: a.profileImageUrl, isMod: a.isChatModerator || a.isChatOwner, badges: [a.isChatOwner && 'owner', a.isChatModerator && 'moderator', a.isChatSponsor && 'member'].filter(Boolean) };
    switch (s.type) {
      case 'textMessageEvent': this.publish({ type: 'chat', user, text: s.displayMessage }); break;
      case 'superChatEvent': this.publish({ type: 'superchat', user, text: s.superChatDetails?.userComment || '', amount: (s.superChatDetails?.amountMicros || 0) / 1e6, currency: s.superChatDetails?.currency, gift: 'Super Chat' }); break;
      case 'superStickerEvent': this.publish({ type: 'superchat', user, text: '', amount: (s.superStickerDetails?.amountMicros || 0) / 1e6, currency: s.superStickerDetails?.currency, gift: 'Super Sticker' }); break;
      case 'newSponsorEvent': this.publish({ type: 'sub', user, text: s.displayMessage || '' }); break;
      case 'memberMilestoneChatEvent': this.publish({ type: 'sub', user, text: s.memberMilestoneChatDetails?.userComment || '', count: s.memberMilestoneChatDetails?.memberMonth }); break;
      case 'membershipGiftingEvent': this.publish({ type: 'gift', user, gift: 'Membership', count: s.membershipGiftingDetails?.giftMembershipsCount || 1 }); break;
      default: break;
    }
  }

  // Post into live chat (requires Google sign-in with the youtube.force-ssl scope).
  async send(text) {
    if (!this.cfg?.getToken || this.status.state !== 'connected') return super.send();
    await this.api('liveChat/messages', { part: 'snippet' }, { method: 'POST', body: { snippet: { liveChatId: this.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: String(text).slice(0, 200) } } } });
    return true;
  }
  disconnect() { super.disconnect(); clearTimeout(this.pollTimer); clearInterval(this.viewTimer); }
}
module.exports = { YouTube };
