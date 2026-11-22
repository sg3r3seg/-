'use strict';
const { uid, userKey, clampStr } = require('./util');

// COMMUNITY (viewer leaderboard), ANALYTICS (per-session stats) and
// HIGHLIGHTS (timestamped markers) — computed only from real events.
const IDLE_END_MS = 30 * 60_000;

module.exports = (ctx) => {
  let viewers = ctx.store.get('community', {});
  let sessions = ctx.store.get('sessions', []);
  let highlights = ctx.store.get('highlights', []);
  let cur = null; const recentChat = [];
  let saveT = null;
  const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => { ctx.store.set('community', viewers); if (cur) persistSession(); }, 2000); };

  function newSession(reason) {
    cur = { id: uid(), startedAt: Date.now(), endedAt: null, lastEventAt: Date.now(), reason, platforms: [], messages: 0, chatters: [], gifts: 0, giftValue: {}, follows: 0, subs: 0, likes: 0, shares: 0, superchats: 0, raids: 0, peakViewers: 0, timeline: [] };
    sessions.unshift(cur); if (sessions.length > 100) sessions.pop();
    return cur;
  }
  function persistSession() { ctx.store.set('sessions', sessions.map((s) => (s === cur ? { ...cur, chatters: cur.chatters.slice(0, 5000) } : s))); }
  function endSession() { if (cur) { cur.endedAt = cur.lastEventAt; persistSession(); ctx.activity({ kind: 'session', text: 'Stream session ended' }); cur = null; } }
  setInterval(() => { if (cur && Date.now() - cur.lastEventAt > IDLE_END_MS) endSession(); }, 60_000).unref();

  return {
    onEvent(e) {
      if (e.test) return;
      if (!cur) newSession('auto');
      cur.lastEventAt = Date.now();
      if (!cur.platforms.includes(e.platform)) cur.platforms.push(e.platform);
      const minute = Math.floor((e.ts - cur.startedAt) / 60000);
      let b = cur.timeline[cur.timeline.length - 1];
      if (!b || b.m !== minute) { b = { m: minute, chat: 0, gifts: 0, follows: 0, viewers: null }; cur.timeline.push(b); if (cur.timeline.length > 1440) cur.timeline.shift(); }
      switch (e.type) {
        case 'chat': cur.messages += 1; b.chat += 1; { const k = userKey(e); if (!cur.chatters.includes(k)) cur.chatters.push(k); }
          recentChat.push({ ts: e.ts, user: e.user?.name, text: e.text, platform: e.platform }); if (recentChat.length > 30) recentChat.shift(); break;
        case 'gift': cur.gifts += e.count || 1; b.gifts += e.count || 1; if (e.amount) cur.giftValue[e.currency || 'units'] = (cur.giftValue[e.currency || 'units'] || 0) + e.amount; break;
        case 'superchat': case 'bits': cur.superchats += 1; if (e.amount) cur.giftValue[e.currency || 'units'] = (cur.giftValue[e.currency || 'units'] || 0) + e.amount; break;
        case 'follow': cur.follows += 1; b.follows += 1; break;
        case 'sub': cur.subs += 1; break;
        case 'like': cur.likes += e.count || 1; break;
        case 'share': cur.shares += 1; break;
        case 'raid': cur.raids += 1; break;
        case 'viewers': cur.peakViewers = Math.max(cur.peakViewers, e.count || 0); b.viewers = e.count; break;
        default: break;
      }
      if (e.type !== 'viewers' && e.user?.name) {
        const k = userKey(e);
        const v = viewers[k] || (viewers[k] = { name: e.user.name, platform: e.platform, avatar: e.user.avatar || null, messages: 0, gifts: 0, giftValue: 0, follows: 0, subs: 0, firstSeen: e.ts, lastSeen: e.ts });
        v.name = e.user.name; v.lastSeen = e.ts;
        if (e.type === 'chat') v.messages += 1;
        if (e.type === 'gift') { v.gifts += e.count || 1; v.giftValue += e.amount || 0; }
        if (e.type === 'superchat' || e.type === 'bits') v.giftValue += e.amount || 0;
        if (e.type === 'follow') v.follows += 1;
        if (e.type === 'sub') v.subs += 1;
        const keys = Object.keys(viewers);
        if (keys.length > 20000) delete viewers[keys.sort((a, c) => viewers[a].lastSeen - viewers[c].lastSeen)[0]];
      }
      saveSoon();
    },
    community({ q = '', sort = 'messages', limit = 200 } = {}) {
      const ql = String(q).toLowerCase();
      const list = Object.entries(viewers).map(([key, v]) => ({ key, ...v })).filter((v) => !ql || v.name.toLowerCase().includes(ql));
      const field = ['messages', 'gifts', 'giftValue', 'lastSeen', 'firstSeen'].includes(sort) ? sort : 'messages';
      list.sort((a, b) => b[field] - a[field]);
      return { total: list.length, items: list.slice(0, Math.min(1000, limit)) };
    },
    resetCommunity() { viewers = {}; ctx.store.set('community', viewers); return true; },
    sessions: () => sessions.map((s) => ({ ...s, chatters: undefined, uniqueChatters: s.chatters.length, current: s === cur })),
    current: () => (cur ? { ...cur, chatters: undefined, uniqueChatters: cur.chatters.length } : null),
    startSession() { endSession(); newSession('manual'); persistSession(); return true; },
    endSession() { endSession(); return true; },
    clearSessions() { sessions = cur ? [cur] : []; persistSession(); return true; },
    // HIGHLIGHTS
    highlights: () => highlights,
    mark(note = '', source = 'manual') {
      const h = { id: uid(), ts: Date.now(), offsetSec: cur ? Math.round((Date.now() - cur.startedAt) / 1000) : null, sessionId: cur?.id || null, note: clampStr(note, 200), source, chat: recentChat.slice(-10) };
      highlights.unshift(h); if (highlights.length > 1000) highlights.pop();
      ctx.store.set('highlights', highlights);
      ctx.activity({ kind: 'highlight', text: `Highlight marked${note ? `: ${note}` : ''}` });
      ctx.send('highlights:state', highlights);
      return h;
    },
    updateHighlight(id, note) { highlights = highlights.map((h) => (h.id === id ? { ...h, note: clampStr(note, 200) } : h)); ctx.store.set('highlights', highlights); return highlights; },
    deleteHighlight(id) { highlights = highlights.filter((h) => h.id !== id); ctx.store.set('highlights', highlights); return highlights; },
    highlightsCsv() {
      const fmt = (s) => (s === null ? '' : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return ['time,stream_offset,note,source,last_chat', ...highlights.map((h) => [new Date(h.ts).toISOString(), fmt(h.offsetSec), h.note, h.source, h.chat.map((c) => `${c.user}: ${c.text}`).join(' | ')].map(q).join(','))].join('\r\n');
    },
  };
};
