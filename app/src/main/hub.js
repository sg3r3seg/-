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
  publish(evt) {
    const e = { id: crypto.randomUUID(), ts: Date.now(), user: {}, ...evt };
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
