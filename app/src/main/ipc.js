'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain, shell, dialog, app, BrowserWindow } = require('electron');
const config = require('./config');
const session = require('./session');
const secure = require('./secure');
const platforms = require('./platforms/manager');
const updater = require('./updater');
const ttsSystem = require('./tts-system');
const hub = require('./hub');
const { ROUTES } = require('./overlay-server');

// All renderer -> main calls go through here. Every handler:
//  - verifies the sender is our own top-level app page (file://…/renderer/index.html)
//  - enforces the required entitlement in the MAIN process (renderer gating is cosmetic)
//  - receives plain JSON arguments and validates them.
const LEVEL = { public: 0, auth: 1, any: 2, pro: 3, tts: 4 };

function register(ctx, { rendererUrl, getWindow, logs }) {
  const ensure = (level) => {
    if (level === 'public') return;
    const st = session.state;
    if (!st.user || !['ready'].includes(st.phase)) throw coded('UNAUTHENTICATED', 'Please sign in');
    if (level === 'pro' && !session.has('pro')) throw coded('NOT_LICENSED', 'LiveX PRO license required');
    if (level === 'tts' && !session.has('tts')) throw coded('TTS_NOT_LICENSED', 'LiveX TTS license required');
    if (level === 'any' && !session.has('pro') && !session.has('tts')) throw coded('NOT_LICENSED', 'A LiveX license is required');
  };
  const handle = (channel, level, fn) => {
    if (!(level in LEVEL)) throw new Error(`bad level ${level}`);
    ipcMain.handle(channel, async (event, ...args) => {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || frame.url.split('#')[0] !== rendererUrl) throw coded('FORBIDDEN', 'Untrusted sender');
      try {
        ensure(level);
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        return { ok: false, error: { code: e.code || 'ERROR', message: e.message, data: e.data } };
      }
    });
  };
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const s = (v, max = 500) => String(v ?? '').slice(0, max);

  // ---- app / session --------------------------------------------------------
  handle('app:info', 'public', () => ({ version: app.getVersion(), platform: process.platform, apiBase: config.apiBase, websiteUrl: config.websiteUrl, secureStorage: secure.available() }));
  handle('session:state', 'public', () => session.publicState());
  handle('session:boot', 'public', () => session.boot((step, status, detail) => ctx.send('boot:progress', { step, status, detail })));
  handle('session:login', 'public', (email, password) => session.login(s(email, 254).trim(), s(password, 200)));
  handle('session:register', 'public', (d) => { d = obj(d); return session.register({ firstName: s(d.firstName, 60), lastName: s(d.lastName, 60), email: s(d.email, 254), password: s(d.password, 200) }); });
  handle('session:forgot', 'public', (email) => session.forgot(s(email, 254)));
  handle('session:resend', 'public', (email, password) => session.resendVerification(s(email, 254), s(password, 200)));
  handle('session:logout', 'public', (all) => { platforms.disconnectAll(); return session.logout({ all: !!all }); });
  handle('session:refresh', 'auth', async () => {
    try { return await session.refreshStatus(); } catch (e) {
      if (e.code === 'NETWORK') { session.enterOffline(); return session.publicState(); } // fall back to the signed offline lease
      throw e;
    }
  });
  handle('session:activate', 'auth', (code) => session.activate(s(code, 64)));
  handle('session:bind', 'auth', (licenseId) => session.bind(s(licenseId, 40)));
  handle('session:devices', 'auth', () => session.devices());
  handle('app:openWebsite', 'public', (p) => {
    const target = new URL(s(p || '/', 200), config.websiteUrl);
    if (target.origin !== config.websiteUrl) throw coded('FORBIDDEN', 'Blocked URL');
    return shell.openExternal(target.toString());
  });
  handle('app:openExternal', 'public', (u) => {
    const url = new URL(s(u, 500));
    if (url.protocol !== 'https:') throw coded('FORBIDDEN', 'Only https links can be opened');
    return shell.openExternal(url.toString());
  });
  handle('app:copy', 'public', (text) => { require('electron').clipboard.writeText(s(text, 2000)); return true; });

  // ---- settings ----------------------------------------------------------------
  handle('settings:get', 'public', () => ctx.settings.data);
  handle('settings:set', 'public', (patch) => {
    const p = obj(patch); const out = {};
    if (['he', 'en'].includes(p.language)) out.language = p.language;
    if (['navy', 'midnight', 'oled'].includes(p.theme)) out.theme = p.theme;
    if ('notifications' in p) out.notifications = !!p.notifications;
    if ('outputDeviceId' in p) out.outputDeviceId = s(p.outputDeviceId, 200);
    if ('minimizeToTray' in p) out.minimizeToTray = !!p.minimizeToTray;
    if ('autoUpdateCheck' in p) out.autoUpdateCheck = !!p.autoUpdateCheck;
    if ('overlayPort' in p) out.overlayPort = Math.max(1024, Math.min(65535, parseInt(p.overlayPort, 10) || 4777));
    if ('remotePort' in p) out.remotePort = Math.max(1024, Math.min(65535, parseInt(p.remotePort, 10) || 4778));
    if ('hotkeys' in p) {
      const hk = obj(p.hotkeys);
      ctx.store.set('hotkeys', { highlight: s(hk.highlight, 40), ttsSkip: s(hk.ttsSkip, 40) });
      ctx.hotkeys.refresh();
    }
    ctx.settings.patch(out);
    if ('overlayPort' in out) ctx.restartOverlay().catch(() => {});
    return ctx.settings.data;
  });
  handle('hotkeys:get', 'any', () => ({ ...ctx.store.get('hotkeys', { highlight: 'CommandOrControl+Shift+H', ttsSkip: 'CommandOrControl+Shift+S' }), registered: ctx.hotkeys.registered() }));

  // ---- platforms ------------------------------------------------------------------
  handle('platforms:list', 'any', () => platforms.statuses().map((st) => ({ ...st, saved: platforms.savedConfig(st.platform) })));
  handle('platforms:connect', 'any', async (id, cfg) => {
    if (id === 'discord') ensure('pro');
    return platforms.connect(s(id, 20), obj(cfg));
  });
  handle('platforms:disconnect', 'any', (id) => platforms.disconnect(s(id, 20)));
  handle('platforms:forget', 'any', (id) => platforms.forget(s(id, 20)));
  handle('platforms:discordTest', 'pro', async () => { await platforms.connectors.discord.send('✅ LiveX is connected to this channel.'); return true; });
  handle('activity:recent', 'auth', () => hub.activity.slice(0, 100));

  // ---- overlays ---------------------------------------------------------------------
  handle('overlay:setEnabled', 'any', (route, enabled) => {
    if (!ROUTES.includes(route)) throw coded('VALIDATION', 'Unknown overlay');
    const set = new Set(ctx.store.get('overlayDisabled', []));
    if (enabled) set.delete(route); else set.add(route);
    ctx.store.set('overlayDisabled', [...set]); ctx.overlay.setDisabled([...set]);
    return [...set];
  });
  handle('overlay:openPreview', 'any', (route) => {
    if (!ROUTES.includes(route) || !ctx.overlay.running()) throw coded('VALIDATION', 'Overlay not available');
    return shell.openExternal(ctx.overlay.url(route)); // local overlay URL only
  });
  handle('overlay:info', 'any', () => ({ disabled: ctx.store.get('overlayDisabled', []), running: ctx.overlay.running(), port: ctx.overlay.port, routes: ROUTES.map((r) => ({ route: r, url: ctx.overlay.running() ? ctx.overlay.url(r) : null, allowed: r === 'tts' ? session.has('tts') : session.has('pro') })), clients: ctx.overlay.clientCounts(), styles: ctx.store.get('overlayStyles', {}) }));
  handle('overlay:verify', 'any', () => ctx.overlay.verify());
  handle('overlay:setStyle', 'pro', (route, style) => {
    if (!ROUTES.includes(route)) throw coded('VALIDATION', 'Unknown overlay');
    const st = obj(style); const clean = {};
    for (const [k, v] of Object.entries(st).slice(0, 30)) if (/^[a-zA-Z]{1,30}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = typeof v === 'string' ? v.replace(/[<>;{}]/g, '').slice(0, 120) : v;
    const all = ctx.store.get('overlayStyles', {}); all[route] = clean; ctx.store.set('overlayStyles', all);
    ctx.overlay.setStyle(route, clean);
    return clean;
  });
  handle('overlay:regenerateKey', 'pro', async () => { ctx.settings.patch({ overlayKey: require('node:crypto').randomBytes(18).toString('base64url') }); await ctx.restartOverlay(); return true; });

  // ---- alerts -------------------------------------------------------------------------
  handle('alerts:get', 'pro', () => ctx.alerts.get());
  handle('alerts:save', 'pro', (d) => ctx.alerts.save(obj(d)));
  handle('alerts:test', 'pro', (type) => ctx.alerts.test(s(type, 20)));
  handle('alerts:importMedia', 'pro', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'Image / GIF', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0]; const ext = path.extname(src).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) throw coded('VALIDATION', 'Unsupported image type');
    if (fs.statSync(src).size > 10 * 1024 * 1024) throw coded('VALIDATION', 'Image must be 10MB or smaller');
    const dir = path.join(app.getPath('userData'), 'media'); fs.mkdirSync(dir, { recursive: true });
    const name = `${require('node:crypto').randomBytes(4).toString('hex')}${ext}`;
    fs.copyFileSync(src, path.join(dir, name));
    return { name, url: ctx.overlay.running() ? `http://127.0.0.1:${ctx.overlay.port}${ctx.overlay.mediaUrl(name)}` : null };
  });

  // ---- TTS + Voice Studio ---------------------------------------------------------------
  handle('tts:get', 'tts', () => ({ settings: ctx.tts.settings(), state: ctx.tts.state(), profiles: ctx.tts.profiles(), systemSupported: ttsSystem.supported() }));
  handle('tts:saveSettings', 'tts', (d) => ctx.tts.saveSettings(obj(d)));
  handle('tts:say', 'tts', (text) => ctx.tts.say(s(text, 500)));
  handle('tts:pause', 'tts', () => ctx.tts.pause());
  handle('tts:resume', 'tts', () => ctx.tts.resume());
  handle('tts:skip', 'tts', () => ctx.tts.skip());
  handle('tts:clear', 'tts', () => ctx.tts.clear());
  handle('tts:remove', 'tts', (id) => ctx.tts.remove(s(id, 20)));
  handle('tts:done', 'tts', (id) => ctx.tts.done(s(id, 20)));
  handle('tts:failed', 'tts', (id, msg) => ctx.tts.failed(s(id, 20), s(msg, 300)));
  handle('tts:systemVoices', 'tts', () => ttsSystem.voices());
  handle('tts:synthSystem', 'tts', async (o) => { o = obj(o); const buf = await ttsSystem.synthesize({ text: s(o.text, 1000), voice: s(o.voice, 200), rate: +o.rate || 1, pitch: +o.pitch || 1, volume: o.volume === undefined ? 1 : +o.volume }); return buf.toString('base64'); });
  handle('tts:saveProfile', 'tts', (p) => ctx.tts.saveProfile(obj(p)));
  handle('tts:deleteProfile', 'tts', (id) => ctx.tts.deleteProfile(s(id, 20)));
  handle('tts:aiStatus', 'tts', () => session.authed('GET', '/api/tts/ai/status'));
  handle('tts:aiVoices', 'tts', async () => (await session.authed('GET', '/api/tts/ai/voices')).voices);
  handle('tts:synthAi', 'tts', async (o) => { o = obj(o); const buf = await session.authed('POST', '/api/tts/ai/synthesize', { body: { text: s(o.text, 500), voiceId: s(o.voiceId, 64) }, raw: true, timeoutMs: 30000 }); return buf.toString('base64'); });
  handle('tts:aiClone', 'tts', async (o) => {
    o = obj(o);
    if (o.consent !== true) throw coded('CONSENT_REQUIRED', 'Explicit consent is required');
    return session.authed('POST', '/api/tts/ai/clone', { body: { name: s(o.name, 60), voiceOwnerName: s(o.voiceOwnerName, 100), consentStatement: s(o.consentStatement, 1000), consent: true, audioBase64: s(o.audioBase64, 15 * 1024 * 1024), mimeType: s(o.mimeType, 40) }, timeoutMs: 120000 });
  });
  handle('voice:saveSample', 'tts', (b64, ext) => {
    const e = ['.webm', '.wav', '.mp3', '.ogg', '.m4a'].includes(ext) ? ext : '.webm';
    const buf = Buffer.from(s(b64, 15 * 1024 * 1024), 'base64');
    if (buf.length > 10 * 1024 * 1024) throw coded('VALIDATION', 'Recording too large');
    const dir = path.join(app.getPath('userData'), 'voices'); fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}${e}`; fs.writeFileSync(path.join(dir, name), buf);
    return name;
  });
  handle('voice:loadSample', 'tts', (name) => fs.readFileSync(path.join(app.getPath('userData'), 'voices', path.basename(s(name, 100)))).toString('base64'));
  handle('voice:importSample', 'tts', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'webm'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 10 * 1024 * 1024) throw coded('VALIDATION', 'Recording must be 10MB or smaller');
    return { name: path.basename(r.filePaths[0]), ext: path.extname(r.filePaths[0]).toLowerCase(), base64: fs.readFileSync(r.filePaths[0]).toString('base64') };
  });

  // ---- chat bot / commands ---------------------------------------------------------------
  handle('commands:get', 'pro', () => ctx.chat.commands());
  handle('commands:save', 'pro', (list) => ctx.chat.saveCommands(Array.isArray(list) ? list : []));
  handle('bot:get', 'pro', () => ctx.chat.bot());
  handle('bot:save', 'pro', (b) => ctx.chat.saveBot(obj(b)));
  handle('bot:send', 'pro', (text) => ctx.chat.reply(s(text, 450), null, 'manual'));

  // ---- sound board -------------------------------------------------------------------------
  handle('sounds:list', 'pro', () => ctx.sounds.list());
  handle('sounds:import', 'pro', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'webm'] }] });
    if (r.canceled) return ctx.sounds.list();
    for (const f of r.filePaths.slice(0, 50)) ctx.sounds.add(f);
    return ctx.sounds.list();
  });
  handle('sounds:update', 'pro', (id, patch) => ctx.sounds.update(s(id, 20), obj(patch)));
  handle('sounds:remove', 'pro', (id) => ctx.sounds.remove(s(id, 20)));
  handle('sounds:play', 'pro', (id) => ctx.sounds.play(s(id, 20)));
  handle('sounds:data', 'any', (id) => { const d = ctx.sounds.data(s(id, 20)); return { mime: d.mime, volume: d.volume, base64: d.bytes.toString('base64') }; });

  // ---- macros ----------------------------------------------------------------------------------
  handle('macros:list', 'pro', () => ({ macros: ctx.macros.list(), stepTypes: ctx.macros.STEP_TYPES }));
  handle('macros:save', 'pro', (m) => ctx.macros.save(obj(m)));
  handle('macros:remove', 'pro', (id) => ctx.macros.remove(s(id, 20)));
  handle('macros:run', 'pro', (id) => ctx.macros.run(s(id, 20), 'app'));

  // ---- timer -----------------------------------------------------------------------------------
  handle('timer:get', 'pro', () => ctx.timer.get());
  handle('timer:configure', 'pro', (c) => ctx.timer.configure(obj(c)));
  for (const op of ['start', 'stop', 'reset']) handle(`timer:${op}`, 'pro', () => ctx.timer[op]());
  handle('timer:add', 'pro', (sec) => ctx.timer.add(Number(sec)));

  // ---- goals / challenges --------------------------------------------------------------------
  handle('goal:get', 'pro', () => ({ goal: ctx.goals.goal(), metrics: ctx.goals.METRICS }));
  handle('goal:save', 'pro', (g) => ctx.goals.saveGoal(obj(g)));
  handle('challenges:list', 'pro', () => ctx.goals.challenges());
  handle('challenges:save', 'pro', (c) => ctx.goals.saveChallenge(obj(c)));
  handle('challenges:delete', 'pro', (id) => ctx.goals.deleteChallenge(s(id, 20)));
  handle('challenges:reset', 'pro', (id) => ctx.goals.resetChallenge(s(id, 20)));

  // ---- giveaway / wheel --------------------------------------------------------------------------
  handle('giveaway:get', 'pro', () => ctx.giveaway.get());
  handle('giveaway:configure', 'pro', (c) => ctx.giveaway.configure(obj(c)));
  for (const op of ['open', 'close', 'reset', 'draw']) handle(`giveaway:${op}`, 'pro', () => ctx.giveaway[op]());
  handle('wheel:get', 'pro', () => ctx.giveaway.wheel());
  handle('wheel:save', 'pro', (w) => ctx.giveaway.saveWheel(obj(w)));
  handle('wheel:spin', 'pro', () => ctx.giveaway.spin());

  // ---- schedule ------------------------------------------------------------------------------------
  handle('schedule:list', 'pro', () => ctx.schedule.list());
  handle('schedule:save', 'pro', (it) => ctx.schedule.save(obj(it)));
  handle('schedule:remove', 'pro', (id) => ctx.schedule.remove(s(id, 20)));
  handle('schedule:announce', 'pro', (id) => ctx.schedule.announce(s(id, 20)));

  // ---- community / analytics / highlights ---------------------------------------------------------
  handle('community:list', 'pro', (q) => ctx.insights.community(obj(q)));
  handle('community:reset', 'pro', () => ctx.insights.resetCommunity());
  handle('analytics:get', 'pro', () => ({ current: ctx.insights.current(), sessions: ctx.insights.sessions() }));
  handle('analytics:startSession', 'pro', () => ctx.insights.startSession());
  handle('analytics:endSession', 'pro', () => ctx.insights.endSession());
  handle('analytics:clear', 'pro', () => ctx.insights.clearSessions());
  handle('highlights:list', 'pro', () => ctx.insights.highlights());
  handle('highlights:mark', 'pro', (note) => ctx.insights.mark(s(note, 200), 'app'));
  handle('highlights:update', 'pro', (id, note) => ctx.insights.updateHighlight(s(id, 20), s(note, 200)));
  handle('highlights:delete', 'pro', (id) => ctx.insights.deleteHighlight(s(id, 20)));
  handle('highlights:export', 'pro', async () => {
    const r = await dialog.showSaveDialog(getWindow(), { defaultPath: `livex-highlights-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, `﻿${ctx.insights.highlightsCsv()}`);
    return r.filePath;
  });

  // ---- remote control ------------------------------------------------------------------------------
  handle('remote:info', 'pro', () => ctx.remote.info());
  handle('remote:start', 'pro', () => ctx.startRemote());
  handle('remote:stop', 'pro', async () => { await ctx.remote.stop(); return ctx.remote.info(); });

  // ---- performance / diagnostics -----------------------------------------------------------------------
  let lastCpu = os.cpus();
  handle('perf:get', 'pro', () => {
    const cpus = os.cpus();
    let idle = 0; let total = 0;
    cpus.forEach((c, i) => {
      const p = lastCpu[i]?.times || c.times;
      const t = Object.keys(c.times).reduce((a, k) => a + c.times[k] - p[k], 0);
      idle += c.times.idle - p.idle; total += t;
    });
    lastCpu = cpus;
    const metrics = app.getAppMetrics();
    return {
      systemCpu: total ? Math.round((1 - idle / total) * 100) : 0,
      memTotal: os.totalmem(), memFree: os.freemem(),
      appCpu: Math.round(metrics.reduce((a, m) => a + (m.cpu?.percentCPUUsage || 0), 0) * 10) / 10,
      appMemMB: Math.round(metrics.reduce((a, m) => a + (m.memory?.workingSetSize || 0), 0) / 1024),
      processes: metrics.length, uptimeSec: Math.round(process.uptime()),
      eventsTotal: hub.counters.events, eventsPerMinute: hub.counters.perMinute.slice(-30),
      overlayClients: ctx.overlay.clientCounts(), platforms: platforms.statuses().map((p) => ({ platform: p.platform, state: p.state, lastEventAt: p.lastEventAt })),
    };
  });
  handle('diag:run', 'auth', async () => {
    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, ok, detail: String(detail ?? '') });
    const t0 = Date.now(); const srv = await session.checkServer();
    add('server', srv, srv ? `${config.apiBase} · ${Date.now() - t0} ms · v${session.state.server.version}` : session.state.server.error);
    try { await session.refreshStatus(); add('auth', true, session.state.user?.userId); } catch (e) { add('auth', false, e.message); }
    add('lease', !!session.state.lease?.valid, session.state.lease?.expiresAt ? new Date(session.state.lease.expiresAt).toISOString() : 'none');
    add('entitlements', session.state.entitlements.length > 0, session.state.entitlements.join(', ') || 'none');
    add('secureStorage', secure.available(), secure.available() ? 'OS keychain (DPAPI)' : 'unavailable');
    add('overlay', ctx.overlay.running(), ctx.overlay.running() ? `127.0.0.1:${ctx.overlay.port}` : 'not running');
    if (ctx.overlay.running()) { const v = await ctx.overlay.verify(); add('overlayRoutes', v.every((x) => x.ok), `${v.filter((x) => x.ok).length}/${v.length} routes verified`); }
    for (const p of platforms.statuses()) add(`platform:${p.platform}`, p.state === 'connected', `${p.state}${p.detail ? ` · ${p.detail}` : ''}`);
    if (ttsSystem.supported()) { try { const v = await ttsSystem.voices(); add('systemVoices', v.length > 0, v.map((x) => `${x.name} (${x.culture})`).join(', ')); } catch (e) { add('systemVoices', false, e.message); } } else add('systemVoices', false, 'Windows only');
    add('hotkeys', true, ctx.hotkeys.registered().join(', ') || 'none');
    return { checks, at: Date.now(), version: app.getVersion(), os: `${os.type()} ${os.release()} ${os.arch()}` };
  });
  handle('diag:logs', 'public', () => logs.slice(-300));
  handle('diag:exportLogs', 'public', async () => {
    const r = await dialog.showSaveDialog(getWindow(), { defaultPath: `livex-logs-${Date.now()}.txt` });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, logs.map((l) => `${new Date(l.ts).toISOString()} [${l.level}] ${l.source}: ${l.message}`).join('\r\n'));
    return r.filePath;
  });

  // ---- updates -----------------------------------------------------------------------------------------
  handle('update:state', 'public', () => updater.state);
  handle('update:check', 'public', () => updater.check());
  handle('update:download', 'public', () => updater.download());
  handle('update:install', 'public', () => updater.install());

  // window controls
  handle('win:minimize', 'public', () => getWindow()?.minimize());
  handle('win:toggleMax', 'public', () => { const w = getWindow(); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); });
  handle('win:close', 'public', () => getWindow()?.close());
  void BrowserWindow;
}

function coded(code, message) { return Object.assign(new Error(message), { code }); }
module.exports = { register };
