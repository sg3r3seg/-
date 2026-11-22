'use strict';
const { EventEmitter } = require('node:events');
const config = require('./config');
const secure = require('./secure');
const device = require('./device');
const { request, ApiError } = require('./api');
const { entitlementsFromLease } = require('./tokens');

const RECHECK_MS = 5 * 60_000;

// Authentication / licensing state machine of the desktop app.
// Entitlements are derived ONLY from a server-signed lease verified locally.
class Session extends EventEmitter {
  constructor() {
    super();
    this.accessToken = null;
    this.timer = null;
    this.state = {
      phase: 'booting', server: { reachable: null, checkedAt: null, version: null },
      user: null, entitlements: [], licenses: [], lease: null, offline: false, notice: null,
    };
  }

  get deviceUid() { return device.installId(); }
  has(ent) { return this.state.entitlements.includes(ent); }
  publicState() { return { ...this.state, device: device.info(), apiBase: config.apiBase, websiteUrl: config.websiteUrl }; }
  set(patch) { Object.assign(this.state, patch); this.emit('change', this.publicState()); }

  async checkServer() {
    try {
      const h = await request('GET', '/api/health', { timeoutMs: 6000 });
      if (!h.ok || h.service !== 'livex') throw new ApiError('BAD_RESPONSE', 'Unexpected server response');
      this.state.server = { reachable: true, checkedAt: Date.now(), version: h.version };
      return true;
    } catch (e) {
      this.state.server = { reachable: false, checkedAt: Date.now(), error: e.message };
      return false;
    }
  }

  // Boot sequence shown on the splash screen.
  async boot(progress = () => {}) {
    progress('server', 'running');
    const online = await this.checkServer();
    progress('server', online ? 'ok' : 'fail', this.state.server.error);
    if (!online) return this.enterOffline(progress);

    progress('auth', 'running');
    const refresh = secure.get('refreshToken');
    if (!refresh) { progress('auth', 'skip'); this.signedOut(); return this.publicState(); }
    try {
      await this.refreshTokens();
      progress('auth', 'ok');
    } catch (e) {
      if (e.code === 'NETWORK') { progress('auth', 'fail', e.message); return this.enterOffline(progress); }
      progress('auth', 'fail', e.message);
      this.signedOut({ code: e.code, text: e.message });
      return this.publicState();
    }
    progress('license', 'running');
    try {
      await this.refreshStatus();
      progress('license', 'ok');
      progress('device', this.state.licenses.some((l) => l.boundToThisDevice) ? 'ok' : 'warn');
      progress('permissions', 'ok', this.state.entitlements.join(', ') || 'none');
    } catch (e) {
      progress('license', 'fail', e.message);
      if (e.code === 'NETWORK') return this.enterOffline(progress);
      this.set({ phase: 'error', notice: { code: e.code, text: e.message } });
    }
    this.schedule();
    return this.publicState();
  }

  // Offline policy: allowed only with an unexpired, server-signed lease issued
  // for this installation. No lease -> no access. Cannot be bypassed locally
  // because the lease signature is verified with the embedded public key.
  enterOffline(progress = () => {}) {
    const cached = secure.get('lease');
    const r = entitlementsFromLease(cached, config.tokenPublicKey, this.deviceUid);
    if (r.valid && secure.get('refreshToken')) {
      progress('license', 'warn', 'offline lease');
      this.set({
        phase: 'ready', offline: true, entitlements: r.entitlements,
        user: this.state.user || { userId: r.payload.sub, fullName: r.payload.name },
        lease: { valid: true, expiresAt: r.expiresAt },
        notice: { code: 'OFFLINE', text: 'offline', until: r.expiresAt },
      });
    } else {
      progress('license', 'fail', 'no valid offline lease');
      this.set({ phase: 'offline_blocked', offline: true, entitlements: [], lease: null, notice: { code: 'OFFLINE_NO_LEASE', text: 'offline_no_lease' } });
    }
    this.schedule(60_000);
    return this.publicState();
  }

  signedOut(notice = null) {
    this.accessToken = null;
    this.set({ phase: 'signed_out', user: null, entitlements: [], licenses: [], lease: null, offline: false, notice });
  }

  async refreshTokens() {
    const r = await request('POST', '/api/auth/refresh', { body: { refreshToken: secure.get('refreshToken'), deviceUid: this.deviceUid } });
    this.accessToken = r.accessToken;
    secure.set('refreshToken', r.refreshToken);
    this.state.user = r.user;
  }

  // Authenticated request with a single transparent token refresh.
  async authed(method, path, opts = {}) {
    if (!this.accessToken) await this.refreshTokens();
    try {
      return await request(method, path, { ...opts, token: this.accessToken, deviceUid: this.deviceUid });
    } catch (e) {
      if (e.status === 401 && e.code === 'UNAUTHENTICATED') {
        await this.refreshTokens();
        return request(method, path, { ...opts, token: this.accessToken, deviceUid: this.deviceUid });
      }
      if (e.status === 401) { secure.del('refreshToken'); secure.del('lease'); this.signedOut({ code: e.code, text: e.message }); }
      throw e;
    }
  }

  applyStatus(s) {
    const r = entitlementsFromLease(s.lease, config.tokenPublicKey, this.deviceUid);
    if (!r.valid) {
      // Signature/device mismatch: never trust the unsigned JSON fields.
      secure.del('lease');
      this.set({ phase: 'error', entitlements: [], notice: { code: 'LEASE_INVALID', text: 'lease_invalid' } });
      throw new ApiError('LEASE_INVALID', 'The server response could not be verified');
    }
    secure.set('lease', s.lease);
    const had = this.state.entitlements;
    const lost = had.filter((e) => !r.entitlements.includes(e));
    const anyRevoked = s.licenses.some((l) => l.status === 'revoked');
    let notice = null;
    if (anyRevoked && (lost.length || !r.entitlements.length)) notice = { code: 'LICENSE_REVOKED', text: 'license_revoked' };
    else if (lost.length) notice = { code: 'LICENSE_LOST', text: 'license_lost' };
    this.set({
      phase: 'ready', offline: false, user: s.user || this.state.user, licenses: s.licenses, entitlements: r.entitlements,
      lease: { valid: true, expiresAt: r.expiresAt }, notice,
    });
  }

  async refreshStatus() {
    const s = await this.authed('GET', '/api/app/status');
    this.applyStatus(s);
    return this.publicState();
  }

  schedule(ms = RECHECK_MS) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (this.state.phase === 'signed_out') return;
      try {
        if (this.state.offline) {
          if (!(await this.checkServer())) { this.enterOffline(); return; }
          await this.refreshTokens();
        }
        await this.refreshStatus();
        this.schedule();
      } catch (e) {
        if (e.code === 'NETWORK') this.enterOffline();
        else this.schedule();
      }
    }, ms);
    this.timer.unref?.();
  }

  async login(email, password) {
    const d = device.info();
    const r = await request('POST', '/api/auth/login', { body: { email, password, client: 'app', device: d } });
    secure.set('refreshToken', r.refreshToken);
    this.accessToken = r.accessToken;
    this.state.user = r.user;
    this.state.server.reachable = true;
    await this.refreshStatus();
    this.schedule();
    return this.publicState();
  }

  async register(data) { return request('POST', '/api/auth/register', { body: data }); }
  async forgot(email) { return request('POST', '/api/auth/forgot', { body: { email } }); }
  async resendVerification(email, password) { return request('POST', '/api/auth/resend-verification', { body: { email, password } }); }

  async activate(code) {
    const d = device.info();
    const r = await this.authed('POST', '/api/app/activate', { body: { code, device: { name: d.name, os: d.os } } });
    this.applyStatus(r);
    return { license: r.license, state: this.publicState() };
  }
  async bind(licenseId) {
    const d = device.info();
    const r = await this.authed('POST', '/api/app/bind', { body: { licenseId, device: { name: d.name, os: d.os } } });
    this.applyStatus(r);
    return this.publicState();
  }
  async devices() { return (await this.authed('GET', '/api/app/devices')).devices; }

  async logout({ all = false } = {}) {
    try {
      if (all) await this.authed('POST', '/api/auth/logout-all', { body: {} });
      else await request('POST', '/api/auth/logout', { body: { refreshToken: secure.get('refreshToken') } });
    } catch { /* still sign out locally */ }
    secure.del('refreshToken'); secure.del('lease');
    clearTimeout(this.timer);
    this.signedOut();
    return this.publicState();
  }
}

module.exports = new Session();
