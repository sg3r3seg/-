'use strict';
const crypto = require('node:crypto');
const { userKey, clampStr, num } = require('./util');

// GIVEAWAY (keyword entries from real chat, cryptographically random draw) + WHEEL.
module.exports = (ctx) => {
  let g = { keyword: '!join', title: 'Giveaway', open: false, entries: [], winners: [], allowModsOnly: false, ...ctx.store.get('giveaway', {}) };
  // Default wheel items follow the app language (until the creator edits them).
  const DEFAULT_ITEMS = { en: ['Prize 1', 'Prize 2', 'Prize 3', 'Prize 4'], he: ['פרס 1', 'פרס 2', 'פרס 3', 'פרס 4'] };
  let wheel = { items: DEFAULT_ITEMS[ctx.settings?.get?.('language') === 'he' ? 'he' : 'en'], useEntries: false, last: null, ...ctx.store.get('wheel', {}) };
  const keys = new Set(g.entries.map((x) => x.key));
  const push = () => {
    ctx.store.set('giveaway', g);
    const pub = { title: g.title, keyword: g.keyword, open: g.open, count: g.entries.length, winners: g.winners.filter((w) => w.status !== 'not_found').slice(-5).map((w) => ({ name: w.name, platform: w.platform })), recent: g.entries.slice(-8).map((x) => x.name) };
    ctx.overlay.broadcast('giveaway', 'state', pub, { sticky: true });
    ctx.send('giveaway:state', { ...g, entries: g.entries.slice(-500), total: g.entries.length });
    return { ...g, total: g.entries.length };
  };
  // Participants who have not won yet (winners marked "not found" cannot win again).
  const eligible = () => g.entries.filter((x) => !g.winners.some((w) => w.key === x.key));
  function pickWinner(from) {
    const pool = eligible();
    if (!pool.length) throw Object.assign(new Error('No eligible entries'), { code: 'NO_ENTRIES' });
    const w = pool[crypto.randomInt(pool.length)];
    const win = { ...w, at: Date.now(), status: 'won', ...(from ? { transferredFrom: from.name } : {}) };
    g.winners.push(win);
    ctx.overlay.broadcast('giveaway', 'winner', { name: w.name, platform: w.platform, title: g.title });
    ctx.activity({ kind: 'giveaway', text: from ? `Winner ${from.name} not found — prize transferred to ${w.name} (${w.platform})` : `Winner: ${w.name} (${w.platform})` });
    push();
    ctx.automations?.trigger('giveaway_winner', { winner: win, title: g.title, from: from ? { name: from.handle || from.name } : null });
    return win;
  }
  const api = {
    get: () => ({ ...g, entries: g.entries.slice(-500), total: g.entries.length }),
    configure(c) { g.keyword = clampStr(c.keyword || '!join', 30).toLowerCase(); g.title = clampStr(c.title || 'Giveaway', 60); g.allowModsOnly = !!c.allowModsOnly; return push(); },
    open() { g.open = true; ctx.activity({ kind: 'giveaway', text: `Giveaway opened — type ${g.keyword}` }); return push(); },
    close() { g.open = false; return push(); },
    reset() { g.entries = []; g.winners = []; keys.clear(); g.open = false; return push(); },
    draw() { return pickWinner(null); },
    hasEligible: () => eligible().length > 0,
    // The private chat opened for a winner (used to check whether they confirmed).
    setRoom(key, roomId) {
      const w = g.winners.find((x) => x.key === key && x.status !== 'not_found');
      if (w && roomId) { w.roomId = String(roomId); push(); }
    },
    // "Winner not found": the drawn winner never showed up, so the prize moves to a new
    // random participant. The caller (IPC) first checks the winner did NOT confirm in the
    // private chat; nothing changes if there is nobody left to give the prize to.
    transfer(key) {
      const w = g.winners.find((x) => x.key === key);
      if (!w) throw Object.assign(new Error('Winner not found in this giveaway'), { code: 'NOT_FOUND' });
      if (w.status === 'not_found') throw Object.assign(new Error('The prize of this winner was already transferred'), { code: 'ALREADY_TRANSFERRED' });
      if (!eligible().length) throw Object.assign(new Error('There is no other participant to transfer the prize to'), { code: 'NO_OTHER_ENTRIES' });
      w.status = 'not_found'; w.notFoundAt = Date.now();
      const next = pickWinner(w);
      w.transferredTo = next.name;
      push();
      return next;
    },
    onEvent(e) {
      if (!g.open || e.type !== 'chat' || e.test || e.blocked || !ctx.session.has('pro')) return;
      if (String(e.text || '').trim().toLowerCase().split(/\s/)[0] !== g.keyword) return;
      if (g.allowModsOnly && !e.user?.isMod) return;
      const key = userKey(e);
      if (keys.has(key)) return;
      keys.add(key);
      // userId / @handle let LiveX verify the winner later (private chat sign-in).
      g.entries.push({ key, name: e.user?.name || 'unknown', platform: e.platform, userId: e.user?.id ? String(e.user.id) : undefined, handle: e.user?.handle || undefined, at: Date.now() });
      if (g.entries.length > 20000) g.entries.shift();
      push();
    },
    // WHEEL
    wheel: () => wheel,
    setLang(lang) {
      const isDefault = Object.values(DEFAULT_ITEMS).some((d) => d.join('|') === wheel.items.join('|'));
      if (isDefault) api.saveWheel({ ...wheel, items: DEFAULT_ITEMS[lang === 'he' ? 'he' : 'en'] });
    },
    saveWheel(w) {
      wheel.items = (Array.isArray(w.items) ? w.items : []).map((x) => clampStr(x, 40).trim()).filter(Boolean).slice(0, 40);
      wheel.useEntries = !!w.useEntries;
      ctx.store.set('wheel', wheel);
      ctx.overlay.broadcast('wheel', 'items', { items: wheel.items }, { sticky: true });
      return wheel;
    },
    spin() {
      const items = wheel.useEntries ? g.entries.slice(-40).map((x) => x.name) : wheel.items;
      if (items.length < 2) throw Object.assign(new Error('The wheel needs at least 2 items'), { code: 'VALIDATION' });
      const index = crypto.randomInt(items.length);
      const durationMs = num(6000, 6000);
      wheel.last = { result: items[index], at: Date.now() }; ctx.store.set('wheel', wheel);
      ctx.overlay.broadcast('wheel', 'spin', { items, index, durationMs });
      setTimeout(() => ctx.activity({ kind: 'wheel', text: `Wheel result: ${items[index]}` }), durationMs);
      return { items, index, result: items[index] };
    },
  };
  return api;
};
