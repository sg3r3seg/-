'use strict';
const { EventEmitter } = require('node:events');
const { shell } = require('electron');
const secure = require('./secure');
const session = require('./session');
const hub = require('./hub');

// Social accounts connected with each platform's official OAuth.
// Tokens are stored only in secure storage (OS keychain / DPAPI) under
// `oauth:<platform>`, never sent to the renderer and never logged.
const PLATFORMS = ['youtube', 'twitch', 'kick', 'tiktok', 'discord'];
const LABELS = { youtube: 'YouTube (Google)', twitch: 'Twitch', kick: 'Kick', tiktok: 'TikTok', discord: 'Discord' };
const POLL_MS = 1500; const FLOW_TIMEOUT_MS = 10 * 60_000;

class Social extends EventEmitter {
  constructor() { super(); this.pending = new Map(); this.configured = null; }

  // Tokens are kept per LiveX user, so another user on the same PC never sees them.
  key(p) { const uid = session.state.user?.userId; if (!uid) throw Object.assign(new Error('Please sign in'), { code: 'UNAUTHENTICATED' }); return `oauth:${uid}:${p}`; }
  stored(p) { try { return secure.get(this.key(p)) || null; } catch { return null; } }

  view(p) {
    const s = this.stored(p); const pend = this.pending.get(p);
    let status = s ? 'connected' : 'disconnected';
    if (s?.needsReconnect) status = 'reconnect';
    if (pend) status = 'connecting';
    return {
      platform: p, label: LABELS[p],
      configured: this.configured ? this.configured[p] !== false : null,
      status, error: pend ? null : (this.lastError?.[p] || null),
      account: s ? { id: s.profile?.id, name: s.profile?.name, avatar: s.profile?.avatar || null } : null,
      connectedAt: s?.connectedAt || null, lastRefreshAt: s?.lastRefreshAt || null,
      expiresAt: s?.expiresAt || null, scope: s?.scope || null,
    };
  }

  async list() {
    if (!this.configured) {
      try { const r = await session.authed('GET', '/api/oauth/providers'); this.configured = Object.fromEntries(r.providers.map((x) => [x.platform, x.configured])); } catch { /* offline: show stored state */ }
    }
    return PLATFORMS.map((p) => this.view(p));
  }

  changed(p) { this.emit('change', this.view(p)); }
  setError(p, code) { this.lastError = { ...(this.lastError || {}), [p]: code }; }

  async connect(p) {
    if (!PLATFORMS.includes(p)) throw Object.assign(new Error('Unknown platform'), { code: 'VALIDATION' });
    if (this.pending.has(p)) await this.cancel(p);
    this.setError(p, null);
    const { flowId, authorizeUrl } = await session.authed('POST', `/api/oauth/${p}/start`, { body: {} });
    const url = new URL(authorizeUrl);
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw Object.assign(new Error('Insecure sign-in URL refused'), { code: 'FORBIDDEN' });
    const flow = { flowId, started: Date.now(), timer: null };
    this.pending.set(p, flow); this.changed(p);
    flow.tick = async () => {
      if (this.pending.get(p) !== flow || flow.busy) return;
      flow.busy = true; clearTimeout(flow.timer);
      try {
        if (Date.now() - flow.started > FLOW_TIMEOUT_MS) { this.finish(p, flow, 'FLOW_EXPIRED'); return; }
        const r = await session.authed('GET', `/api/oauth/flows/${encodeURIComponent(flowId)}`);
        if (r.status === 'done') {
          const res = r.result;
          secure.set(this.key(p), { accessToken: res.accessToken, refreshToken: res.refreshToken, expiresAt: res.expiresAt, scope: res.scope, webhookUrl: res.webhookUrl || undefined, profile: res.profile, connectedAt: res.connectedAt || Date.now() });
          hub.log('info', 'social', `${LABELS[p]} connected as ${res.profile?.name}`);
          this.finish(p, flow, null); this.emit('connected', p); return;
        }
        if (r.status !== 'pending') { this.finish(p, flow, r.error || 'FAILED'); return; }
      } catch (e) { if (e.code !== 'NETWORK') { this.finish(p, flow, e.code || 'FAILED'); return; } } finally { flow.busy = false; }
      if (this.pending.get(p) === flow) flow.timer = setTimeout(() => flow.tick(), POLL_MS);
    };
    // The window also calls poll() every 1.5 s while a sign-in is pending: a timer
    // created from an IPC call does not always wake Electron's main loop on time.
    flow.timer = setTimeout(() => flow.tick(), POLL_MS);
    try {
      await shell.openExternal(url.toString()); // official sign-in page in the user's own browser
      hub.log('info', 'social', `${LABELS[p]}: waiting for sign-in in the browser`);
    } catch {
      await this.cancel(p); this.setError(p, 'BROWSER_FAILED'); this.changed(p);
    }
    return this.view(p);
  }

  async poll(p) {
    const flow = this.pending.get(p);
    if (flow) await flow.tick();
    return this.view(p);
  }

  finish(p, flow, error) {
    clearTimeout(flow.timer);
    if (this.pending.get(p) === flow) this.pending.delete(p);
    this.setError(p, error);
    if (error) hub.log('warn', 'social', `${LABELS[p]} sign-in did not complete: ${error}`);
    this.changed(p);
  }

  async cancel(p) {
    const flow = this.pending.get(p);
    if (!flow) return this.view(p);
    try { await session.authed('POST', `/api/oauth/flows/${encodeURIComponent(flow.flowId)}/cancel`, { body: {} }); } catch { /* ignore */ }
    this.finish(p, flow, 'CANCELLED');
    return this.view(p);
  }

  async disconnect(p) {
    const s = this.stored(p);
    let revoked = false;
    if (s?.accessToken) { try { revoked = (await session.authed('POST', `/api/oauth/${p}/revoke`, { body: { token: s.refreshToken || s.accessToken } })).revoked; } catch { /* still remove locally */ } }
    secure.del(this.key(p));
    this.setError(p, null);
    hub.log('info', 'social', `${LABELS[p]} disconnected${revoked ? ' (access revoked at the platform)' : ''}`);
    this.changed(p); this.emit('disconnected', p);
    return { ...this.view(p), revoked };
  }

  // Valid access token for platform connectors; refreshes through the LiveX server when needed.
  async accessToken(p) {
    const s = this.stored(p);
    if (!s || s.needsReconnect) return null;
    if (!s.expiresAt || s.expiresAt - Date.now() > 120_000) return s.accessToken;
    if (!s.refreshToken) { secure.set(this.key(p), { ...s, needsReconnect: true }); this.changed(p); return null; }
    try {
      const r = await session.authed('POST', `/api/oauth/${p}/refresh`, { body: { refreshToken: s.refreshToken } });
      const next = { ...s, accessToken: r.accessToken, refreshToken: r.refreshToken || s.refreshToken, expiresAt: r.expiresAt, lastRefreshAt: Date.now() };
      secure.set(this.key(p), next); this.changed(p);
      return next.accessToken;
    } catch (e) {
      if (e.code === 'REAUTH_REQUIRED') { secure.set(this.key(p), { ...s, needsReconnect: true }); this.setError(p, 'REAUTH_REQUIRED'); this.changed(p); }
      return null;
    }
  }
  profile(p) { return this.stored(p)?.profile || null; }
  webhookUrl(p) { return this.stored(p)?.webhookUrl || null; }
}
module.exports = new Social();
module.exports.PLATFORMS = PLATFORMS;
