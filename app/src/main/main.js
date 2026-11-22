'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session: eSession, Notification, Tray, Menu, nativeImage, shell } = require('electron');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('app.livex.desktop');

const { Store } = require('./store');
const session = require('./session');
const platforms = require('./platforms/manager');
const updater = require('./updater');
const hub = require('./hub');
const { OverlayServer } = require('./overlay-server');
const { RemoteServer } = require('./remote-server');
const { createEngine } = require('./engine');
const ipc = require('./ipc');

const RENDERER = path.join(__dirname, '..', 'renderer', 'index.html');
const RENDERER_URL = pathToFileURL(RENDERER).toString();
const ICON = path.join(__dirname, '..', 'renderer', 'img', 'icon.png');
let win = null; let tray = null; let quitting = false;
const logs = [];

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function createWindow(settings) {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640,
    backgroundColor: '#04060c', show: false, icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060a14', symbolColor: '#7fdcff', height: 38 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false, backgroundThrottling: false,
      devTools: !app.isPackaged,
    },
  });
  win.loadFile(RENDERER);
  win.once('ready-to-show', () => win.show());
  // No navigation away from the app and no new windows.
  win.webContents.on('will-navigate', (e, url) => { if (url !== RENDERER_URL) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!quitting && settings.get('minimizeToTray', false) && tray) { e.preventDefault(); win.hide(); }
  });
}

function hardenSession() {
  const ses = eSession.defaultSession;
  // Microphone only (Voice Studio recording) and audio output selection.
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    const fromApp = wc.getURL().split('#')[0] === RENDERER_URL;
    cb(fromApp && (permission === 'media' ? (details.mediaTypes || []).every((t) => t === 'audio') : permission === 'speaker-selection'));
  });
  ses.setPermissionCheckHandler((wc, permission) => !!wc && wc.getURL().split('#')[0] === RENDERER_URL && ['media', 'speaker-selection'].includes(permission));
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip('LiveX');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open LiveX', click: () => { win.show(); win.focus(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { win.show(); win.focus(); });
  } catch { tray = null; }
}

app.whenReady().then(async () => {
  const dataDir = app.getPath('userData');
  const settings = new Store(dataDir, 'settings', {
    language: (app.getLocale() || 'en').startsWith('he') ? 'he' : 'en', theme: 'navy', notifications: true, outputDeviceId: 'default',
    minimizeToTray: false, autoUpdateCheck: true, overlayPort: 4777, remotePort: 4778, overlayKey: crypto.randomBytes(18).toString('base64url'),
  });
  settings.flush();
  const store = new Store(dataDir, 'modules', {});
  const overlay = new OverlayServer();
  const remote = new RemoteServer();

  hub.on('log', (l) => { logs.push(l); if (logs.length > 1000) logs.shift(); send('log', l); });
  const ctx = createEngine({
    store, settings, overlay, platforms, session, dataDir, send,
    notify(title, body) { if (settings.get('notifications', true) && Notification.isSupported()) new Notification({ title, body, icon: ICON }).show(); },
  });
  ctx.remote = remote;
  ctx.restartOverlay = async () => {
    await overlay.stop();
    if (!session.has('pro') && !session.has('tts')) return;
    try {
      await overlay.start({ port: settings.get('overlayPort', 4777), key: settings.get('overlayKey') });
      for (const [route, style] of Object.entries(store.get('overlayStyles', {}))) overlay.setStyle(route, style);
      hub.log('info', 'overlay', `overlay server on 127.0.0.1:${overlay.port}`);
      ctx.start();
    } catch (e) { hub.log('error', 'overlay', `cannot start overlay server: ${e.message}`); }
  };
  ctx.startRemote = () => remote.start({
    port: settings.get('remotePort', 4778),
    actions: {
      state: async () => ({ sounds: ctx.sounds.list().map((x) => ({ id: x.id, name: x.name, color: x.color })), macros: ctx.macros.list().map((m) => ({ id: m.id, name: m.name })), timer: ctx.timer.get(), tts: session.has('tts') ? ctx.tts.state() : null, giveaway: { open: ctx.giveaway.get().open, total: ctx.giveaway.get().total } }),
      run: async (action, b) => {
        if (!session.has('pro')) throw new Error('LiveX PRO license required');
        const id = String(b.id || '').slice(0, 20);
        switch (action) {
          case 'sound': return ctx.sounds.play(id, 'remote');
          case 'macro': return ctx.macros.run(id, 'remote');
          case 'timer-start': return ctx.timer.start();
          case 'timer-stop': return ctx.timer.stop();
          case 'timer-add': return ctx.timer.add(Number(b.sec) || 60);
          case 'highlight': return ctx.insights.mark('', 'remote');
          case 'wheel': return ctx.giveaway.spin();
          case 'giveaway-draw': return ctx.giveaway.draw();
          case 'tts-skip': if (!session.has('tts')) throw new Error('LiveX TTS license required'); return ctx.tts.skip();
          case 'tts-pause': if (!session.has('tts')) throw new Error('LiveX TTS license required'); return ctx.tts.pause();
          case 'tts-resume': if (!session.has('tts')) throw new Error('LiveX TTS license required'); return ctx.tts.resume();
          default: throw new Error('Unknown action');
        }
      },
    },
  });

  // React to licensing changes: start/stop licensed services in the main process.
  let lastEnt = '';
  session.on('change', (st) => {
    send('session:changed', st);
    const ent = st.entitlements.join(',');
    if (ent !== lastEnt) {
      lastEnt = ent;
      if (!ent) { platforms.disconnectAll(); overlay.stop(); remote.stop(); ctx.chat.stop(); ctx.hotkeys.unregisterAll(); } else { ctx.restartOverlay(); if (st.phase === 'ready') platforms.autoConnect(); }
      if (!session.has('pro')) { remote.stop(); }
    }
  });
  platforms.on('status', (s) => send('platform:status', s));
  updater.listeners.add((s) => send('update:state', s));

  hardenSession();
  ipc.register(ctx, { rendererUrl: RENDERER_URL, getWindow: () => win, logs });
  createWindow(settings);
  createTray();
  if (settings.get('autoUpdateCheck', true)) setTimeout(() => updater.check().catch(() => {}), 15_000);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (ev, url) => { if (url !== RENDERER_URL) ev.preventDefault(); });
});
