'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, shell, app } = require('electron');
const session = require('./session');
const hub = require('./hub');

// Private chat with a giveaway winner (rooms live on the LiveX server, see
// server/src/services/winners.js). The conversation is shown only in its own window,
// which is excluded from screen capture (OBS display/window capture, screenshots), and
// it never goes to overlays, TTS, the activity feed or the chat bot.
const CHAT_PAGE = path.join(__dirname, '..', 'renderer', 'winner-chat.html');
const CHAT_URL = pathToFileURL(CHAT_PAGE).toString();
const ICON = path.join(__dirname, '..', 'renderer', 'img', 'icon.png');
const LIVE = ['youtube', 'twitch', 'kick', 'tiktok'];
const enc = encodeURIComponent;

const windows = new Map(); // roomId -> BrowserWindow

const winners = {
  CHAT_URL,
  LIVE,
  // Identity the server checks when the winner signs in (from the live chat event).
  identityOf(w) {
    const platform = String(w.platform || '');
    return { platform, winnerId: w.userId ? String(w.userId) : undefined, winnerHandle: w.handle || undefined, winnerName: w.name || w.handle || 'Winner' };
  },
  canOpen(w) {
    if (!LIVE.includes(w.platform)) return false;
    if (w.platform === 'tiktok') return !!w.handle;
    if (w.platform === 'youtube') return !!w.userId;
    return !!(w.userId || w.handle);
  },
  async create(w, title) {
    if (!winners.canOpen(w)) throw Object.assign(new Error('This winner cannot be verified on their platform (no platform account id)'), { code: 'NO_IDENTITY' });
    const r = await session.authed('POST', '/api/rooms', { body: { ...winners.identityOf(w), title: String(title || 'Giveaway').slice(0, 80) } });
    hub.log('info', 'winners', `Private chat ${r.reused ? 'already open' : 'opened'} for giveaway winner (${w.platform})`); // no names/messages in logs
    return r;
  },
  async list() { return (await session.authed('GET', '/api/rooms')).rooms; },
  async messages(roomId, after) { return session.authed('GET', `/api/rooms/${enc(roomId)}/messages?after=${Number(after) || 0}`); },
  async send(roomId, text) { return session.authed('POST', `/api/rooms/${enc(roomId)}/messages`, { body: { text: String(text || '').slice(0, 1000) } }); },
  async close(roomId, reason) {
    const r = await session.authed('POST', `/api/rooms/${enc(roomId)}/close`, { body: reason ? { reason } : {} });
    windows.get(roomId)?.close();
    return r;
  },
  open(roomId, lang = 'en') {
    roomId = String(roomId || '').slice(0, 40);
    const existing = windows.get(roomId);
    if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return { opened: true, protected: true }; }
    const w = new BrowserWindow({
      width: 440, height: 680, minWidth: 360, minHeight: 480,
      title: 'LiveX — Private chat', backgroundColor: '#04060c', icon: ICON, autoHideMenuBar: true, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, spellcheck: true, devTools: !app.isPackaged,
      },
    });
    // Excluded from screen capture: on Windows 10 (2004+) / 11 the window does not appear
    // in OBS display or window capture, screen sharing or screenshots.
    w.setContentProtection(true);
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
    w.webContents.on('will-attach-webview', (e) => e.preventDefault());
    w.loadFile(CHAT_PAGE, { query: { room: roomId, lang: lang === 'he' ? 'he' : 'en' } });
    w.once('ready-to-show', () => w.show());
    w.on('closed', () => windows.delete(roomId));
    windows.set(roomId, w);
    return { opened: true, protected: true };
  },
  closeAllWindows() { for (const w of windows.values()) if (!w.isDestroyed()) w.close(); },
};
module.exports = winners;
