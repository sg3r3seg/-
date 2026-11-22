'use strict';
const { clampStr, num } = require('./util');

// TIMER: countdown / stopwatch / subathon (real events add time).
module.exports = (ctx) => {
  const def = { mode: 'countdown', title: '', durationSec: 600, running: false, endsAt: null, remainingMs: 600_000, startedAt: null, elapsedMs: 0, rules: { perFollowSec: 0, perSubSec: 60, perGiftUnitSec: 1, perSuperchatUnitSec: 10, perLikeSec: 0 }, capSec: 0, addedSec: 0 };
  let s = { ...def, ...ctx.store.get('timer', {}) };
  let tick = null;
  const now = () => Date.now();
  const snapshot = () => {
    const r = { ...s };
    if (s.mode === 'stopwatch') r.elapsedMs = s.running ? s.elapsedMs + (now() - s.startedAt) : s.elapsedMs;
    else r.remainingMs = s.running ? Math.max(0, s.endsAt - now()) : s.remainingMs;
    return r;
  };
  const push = () => {
    ctx.store.set('timer', s);
    const snap = snapshot();
    ctx.overlay.broadcast('timer', 'state', { ...snap, serverNow: now() }, { sticky: true });
    ctx.send('timer:state', snap);
    return snap;
  };
  const loop = () => {
    clearInterval(tick);
    if (!s.running) return;
    tick = setInterval(() => {
      if (s.mode !== 'stopwatch' && s.endsAt <= now()) {
        s.running = false; s.remainingMs = 0; clearInterval(tick); push();
        ctx.activity({ kind: 'timer', text: `${s.title || 'Timer'} finished` });
        ctx.notify('LiveX Timer', `${s.title || 'Timer'} finished`);
      } else ctx.send('timer:state', snapshot());
    }, 1000);
  };
  const api = {
    get: snapshot,
    configure(c) {
      api.stop();
      s.mode = ['countdown', 'stopwatch', 'subathon'].includes(c.mode) ? c.mode : 'countdown';
      s.title = clampStr(c.title, 60);
      s.durationSec = num(c.durationSec, 600, 1, 7 * 86400);
      s.capSec = num(c.capSec, 0, 0, 30 * 86400);
      s.rules = { perFollowSec: num(c.rules?.perFollowSec, 0, 0, 3600), perSubSec: num(c.rules?.perSubSec, 60, 0, 3600), perGiftUnitSec: num(c.rules?.perGiftUnitSec, 1, 0, 3600), perSuperchatUnitSec: num(c.rules?.perSuperchatUnitSec, 10, 0, 3600), perLikeSec: num(c.rules?.perLikeSec, 0, 0, 60) };
      return api.reset();
    },
    start() {
      if (s.running) return snapshot();
      if (s.mode === 'stopwatch') s.startedAt = now();
      else { if (s.remainingMs <= 0) s.remainingMs = s.durationSec * 1000; s.endsAt = now() + s.remainingMs; }
      s.running = true; loop(); return push();
    },
    stop() {
      if (!s.running) return snapshot();
      if (s.mode === 'stopwatch') s.elapsedMs += now() - s.startedAt; else s.remainingMs = Math.max(0, s.endsAt - now());
      s.running = false; clearInterval(tick); return push();
    },
    reset() { clearInterval(tick); Object.assign(s, { running: false, endsAt: null, startedAt: null, elapsedMs: 0, remainingMs: s.durationSec * 1000, addedSec: 0 }); return push(); },
    add(sec) {
      if (s.mode === 'stopwatch') return snapshot();
      let add = num(sec, 0, -86400, 86400);
      if (s.capSec && add > 0) add = Math.min(add, Math.max(0, s.capSec - s.addedSec));
      s.addedSec += add;
      if (s.running) s.endsAt += add * 1000; else s.remainingMs = Math.max(0, s.remainingMs + add * 1000);
      return push();
    },
    onEvent(e) {
      if (s.mode !== 'subathon' || !s.running || e.test || !ctx.session.has('pro')) return;
      const r = s.rules; let add = 0;
      if (e.type === 'follow') add = r.perFollowSec;
      else if (e.type === 'sub') add = r.perSubSec;
      else if (e.type === 'gift') add = r.perGiftUnitSec * (e.amount || e.count || 1);
      else if (e.type === 'superchat' || e.type === 'bits') add = r.perSuperchatUnitSec * Math.max(1, Math.floor(e.amount || 1));
      else if (e.type === 'like') add = r.perLikeSec * (e.count || 1);
      if (add > 0) api.add(add);
    },
    restore() { if (s.running) loop(); push(); },
  };
  return api;
};
