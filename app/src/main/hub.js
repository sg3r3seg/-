'use strict';
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

// Central bus for normalized live events coming from REAL platform
// connections. Nothing in the app fabricates events; test actions are
// explicitly marked `test: true` and are excluded from analytics/community.
//
// Event shape: { id, ts, platform, type, user:{id,name,avatar,badges}, text, amount, currency, gift, count, test }
// type: chat | gift | follow | sub | like | share | superchat | bits | raid | viewers | join
class Hub extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.activity = []; // ring buffer for the dashboard
    this.counters = { events: 0, perMinute: [] };
  }
  // Duplicate protection: identical events within 2s (provider retransmits) and
  // repeat follows by the same viewer within an hour (follow/unfollow spam) are dropped.
  isDuplicate(e) {
    const now = e.ts; const who = e.user?.id || e.user?.name || '';
    this.recent = (this.recent || []).filter((r) => now - r.ts < 2000);
    const sig = [e.platform, e.type, who, e.gift, e.count, e.amount, e.text].join('|');
    if (e.type !== 'viewers' && e.type !== 'like' && this.recent.some((r) => r.sig === sig)) return true;
    this.recent.push({ sig, ts: now });
    if (e.type === 'follow' && who) {
      this.follows = this.follows || new Map();
      const k = `${e.platform}:${who}`; const last = this.follows.get(k);
      if (last && now - last < 3600_000) return true;
      this.follows.set(k, now);
      if (this.follows.size > 50000) this.follows.clear();
    }
    return false;
  }
  publish(evt) {
    const e = { id: crypto.randomUUID(), ts: Date.now(), user: {}, ...evt };
    if (!e.test && this.isDuplicate(e)) { this.counters.duplicates = (this.counters.duplicates || 0) + 1; return null; }
    this.counters.events += 1;
    const minute = Math.floor(e.ts / 60000);
    const last = this.counters.perMinute[this.counters.perMinute.length - 1];
    if (last && last.m === minute) last.n += 1; else { this.counters.perMinute.push({ m: minute, n: 1 }); if (this.counters.perMinute.length > 120) this.counters.perMinute.shift(); }
    if (e.type !== 'viewers') {
      this.activity.unshift(e);
      if (this.activity.length > 200) this.activity.pop();
    }
    this.emit('event', e);
    return e;
  }
  log(level, source, message) {
    const entry = { ts: Date.now(), level, source, message: String(message).slice(0, 500) };
    this.emit('log', entry);
    return entry;
  }
}
module.exports = new Hub();
