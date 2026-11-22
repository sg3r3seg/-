'use strict';
const { uid, clampStr, num } = require('./util');

// STREAM SCHEDULE with desktop reminders and optional real Discord announcements.
module.exports = (ctx) => {
  let items = ctx.store.get('schedule', []);
  const save = () => { items.sort((a, b) => a.startsAt - b.startsAt); ctx.store.set('schedule', items); ctx.send('schedule:state', items); return items; };
  async function tick() {
    const now = Date.now();
    for (const it of items) {
      if (!it.reminded && it.remindMin > 0 && now >= it.startsAt - it.remindMin * 60_000 && now < it.startsAt) {
        it.reminded = true; ctx.notify('LiveX — Stream soon', `${it.title} starts in ${it.remindMin} min`); save();
      }
      if (it.announceDiscord && !it.announced && now >= it.startsAt && now < it.startsAt + 30 * 60_000) {
        it.announced = true; save();
        try { await ctx.platforms.connectors.discord.send(`🔴 ${it.title} — LIVE now! ${it.platforms.join(' · ')}${it.notes ? `\n${it.notes}` : ''}`); ctx.activity({ kind: 'schedule', text: `Announced on Discord: ${it.title}` }); } catch (e) { ctx.activity({ kind: 'schedule', text: `Discord announcement failed: ${e.message}` }); }
      }
    }
  }
  setInterval(() => tick().catch(() => {}), 30_000).unref();
  return {
    list: () => items,
    save(it) {
      const startsAt = num(it.startsAt, NaN);
      if (!Number.isFinite(startsAt)) throw Object.assign(new Error('Invalid date'), { code: 'VALIDATION' });
      const prev = items.find((x) => x.id === it.id);
      const item = { id: clampStr(it.id || uid(), 20), title: clampStr(it.title || 'Live stream', 100), startsAt, durationMin: num(it.durationMin, 60, 5, 1440), platforms: (it.platforms || []).filter((p) => ['tiktok', 'youtube', 'kick', 'twitch'].includes(p)), notes: clampStr(it.notes, 500), remindMin: num(it.remindMin, 15, 0, 1440), announceDiscord: !!it.announceDiscord, reminded: prev && prev.startsAt === startsAt ? prev.reminded : false, announced: prev && prev.startsAt === startsAt ? prev.announced : false };
      items = [...items.filter((x) => x.id !== item.id), item];
      return save();
    },
    remove(id) { items = items.filter((x) => x.id !== id); return save(); },
    async announce(id) {
      const it = items.find((x) => x.id === id);
      if (!it) throw new Error('Not found');
      const when = new Date(it.startsAt).toLocaleString();
      await ctx.platforms.connectors.discord.send(`📅 ${it.title} — ${when}${it.platforms.length ? ` (${it.platforms.join(', ')})` : ''}${it.notes ? `\n${it.notes}` : ''}`);
      return true;
    },
  };
};
