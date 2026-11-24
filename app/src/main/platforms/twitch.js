'use strict';
const WebSocket = require('ws');
const { Connector } = require('./base');

// Twitch chat via the official Twitch IRC WebSocket (TMI). Read-only works
// anonymously; sending requires the user's own OAuth token (chat:edit).
function parseTags(raw) {
  const tags = {};
  for (const kv of raw.split(';')) {
    const i = kv.indexOf('=');
    tags[kv.slice(0, i)] = kv.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\');
  }
  return tags;
}
function parseLine(line) {
  let rest = line; let tags = {}; let prefix = '';
  if (rest.startsWith('@')) { const i = rest.indexOf(' '); tags = parseTags(rest.slice(1, i)); rest = rest.slice(i + 1); }
  if (rest.startsWith(':')) { const i = rest.indexOf(' '); prefix = rest.slice(1, i); rest = rest.slice(i + 1); }
  const ti = rest.indexOf(' :');
  const trailing = ti >= 0 ? rest.slice(ti + 2) : null;
  const params = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ').filter(Boolean);
  return { tags, prefix, command: params.shift(), params, trailing };
}

class Twitch extends Connector {
  constructor() { super('twitch', 'Twitch'); }
  connect({ channel, username, oauthToken }) {
    channel = String(channel || '').trim().toLowerCase().replace(/^#/, '');
    if (!/^[a-z0-9_]{3,25}$/.test(channel)) throw Object.assign(new Error('Invalid Twitch channel name'), { code: 'VALIDATION' });
    this.cfg = { channel, username: (username || '').toLowerCase(), oauthToken: oauthToken || '' };
    this.wantConnected = true; this.retry = 0;
    this.open();
  }
  open() {
    clearTimeout(this.retryTimer);
    this.ws?.removeAllListeners(); this.ws?.terminate?.();
    this.setStatus({ state: 'connecting', detail: 'irc-ws.chat.twitch.tv', channel: this.cfg.channel });
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.ws = ws;
    ws.on('open', () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      const authed = this.cfg.oauthToken && this.cfg.username;
      ws.send(`PASS ${authed ? `oauth:${this.cfg.oauthToken.replace(/^oauth:/, '')}` : 'SCHMOOZE'}`);
      ws.send(`NICK ${authed ? this.cfg.username : `justinfan${Math.floor(10000 + Math.random() * 80000)}`}`);
      ws.send(`JOIN #${this.cfg.channel}`);
      this.authed = !!authed;
    });
    ws.on('message', (buf) => {
      for (const line of buf.toString().split('\r\n').filter(Boolean)) this.handle(parseLine(line));
    });
    ws.on('close', () => { if (this.wantConnected) this.scheduleReconnect(() => this.open()); });
    ws.on('error', (e) => { this.log('warn', e.message); this.setStatus({ state: 'error', detail: e.message }); });
  }
  handle(m) {
    switch (m.command) {
      case 'PING': this.ws.send(`PONG :${m.trailing}`); break;
      case 'NOTICE':
        if (/authentication failed|improperly formatted auth/i.test(m.trailing || '')) {
          this.setStatus({ state: 'error', detail: 'Twitch rejected the OAuth token' }); this.wantConnected = false; this.ws.close();
        }
        break;
      case 'ROOMSTATE':
        this.retry = 0;
        this.setStatus({ state: 'connected', detail: `#${this.cfg.channel}`, canWrite: this.authed });
        this.log('info', `joined #${this.cfg.channel}`);
        break;
      case 'PRIVMSG': {
        const t = m.tags; const user = { id: t['user-id'], handle: m.prefix.split('!')[0], name: t['display-name'] || m.prefix.split('!')[0], badges: (t.badges || '').split(',').filter(Boolean).map((b) => b.split('/')[0]), color: t.color };
        user.isMod = user.badges.includes('moderator') || user.badges.includes('broadcaster');
        if (t.bits) this.publish({ type: 'bits', user, text: m.trailing, amount: parseInt(t.bits, 10), currency: 'bits' });
        else this.publish({ type: 'chat', user, text: m.trailing });
        break;
      }
      case 'USERNOTICE': {
        const t = m.tags; const user = { id: t['user-id'], handle: t.login, name: t['display-name'] || t.login };
        const id = t['msg-id'];
        if (id === 'sub' || id === 'resub') this.publish({ type: 'sub', user, text: m.trailing || '', count: parseInt(t['msg-param-cumulative-months'] || '1', 10) });
        else if (id === 'subgift' || id === 'submysterygift') this.publish({ type: 'gift', user, gift: 'Gift sub', count: parseInt(t['msg-param-mass-gift-count'] || '1', 10), text: t['system-msg'] || '' });
        else if (id === 'raid') this.publish({ type: 'raid', user, count: parseInt(t['msg-param-viewerCount'] || '0', 10) });
        break;
      }
      default: break;
    }
  }
  async send(text) {
    if (this.status.state !== 'connected' || !this.authed) return super.send();
    this.ws.send(`PRIVMSG #${this.cfg.channel} :${String(text).replace(/[\r\n]+/g, ' ').slice(0, 450)}`);
    return true;
  }
  disconnect() { super.disconnect(); this.ws?.removeAllListeners(); this.ws?.close(); this.ws = null; }
}
module.exports = { Twitch, parseLine };
