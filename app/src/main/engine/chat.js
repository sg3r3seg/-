'use strict';
const { uid, fill, userKey, clampStr, num } = require('./util');

// CUSTOM COMMANDS + CHAT BOT. Replies are sent only through connections that
// can actually write (e.g. Twitch with OAuth). Otherwise the reply is logged
// as "not sent" — never shown as delivered.
module.exports = (ctx) => {
  const lastUsed = new Map(); const seen = new Set(); let timers = [];
  const cmds = () => ctx.store.get('commands', [
    { id: uid(), trigger: '!livex', response: 'Powered by LiveX — ONE PLATFORM. EVERY CREATOR.', cooldownSec: 30, level: 'everyone', enabled: true, macroId: '' },
  ]);
  const bot = () => ({ enabled: false, welcome: { enabled: false, template: 'Welcome {user}! 👋' }, keywords: [], timed: [], ...ctx.store.get('chatbot', {}) });

  async function reply(text, evt, source) {
    const results = await ctx.platforms.sendChat(text, evt?.platform);
    const sent = results.filter((r) => r.ok).map((r) => r.platform);
    ctx.activity({ kind: 'bot', source, text, sent, note: sent.length ? '' : 'not sent — no connected platform with chat-write permission' });
    ctx.overlay.broadcast('chat', 'message', { id: uid(), user: { name: 'LiveX Bot' }, text, platform: 'livex', bot: true });
    return results;
  }

  function scheduleTimed() {
    timers.forEach(clearInterval); timers = [];
    const b = bot();
    if (!b.enabled) return;
    for (const t of b.timed.filter((x) => x.enabled && x.text)) {
      timers.push(setInterval(() => { if (ctx.session.has('pro')) reply(t.text, null, 'timed'); }, Math.max(1, t.intervalMin) * 60_000));
    }
  }

  return {
    commands: cmds,
    bot,
    saveCommands(list) {
      const out = (Array.isArray(list) ? list : []).slice(0, 200).map((c) => ({
        id: clampStr(c.id || uid(), 20), trigger: clampStr(String(c.trigger || '').trim().split(/\s/)[0], 30).toLowerCase(),
        response: clampStr(c.response, 450), cooldownSec: num(c.cooldownSec, 10, 0, 3600), level: c.level === 'mods' ? 'mods' : 'everyone',
        enabled: !!c.enabled, macroId: clampStr(c.macroId, 20),
      })).filter((c) => /^[!][\p{L}\p{N}_-]{1,29}$/u.test(c.trigger));
      ctx.store.set('commands', out); return out;
    },
    saveBot(b) {
      const out = {
        enabled: !!b.enabled,
        welcome: { enabled: !!b.welcome?.enabled, template: clampStr(b.welcome?.template, 300) },
        keywords: (b.keywords || []).slice(0, 100).map((k) => ({ id: clampStr(k.id || uid(), 20), keyword: clampStr(k.keyword, 60).toLowerCase(), response: clampStr(k.response, 300), enabled: !!k.enabled })).filter((k) => k.keyword),
        timed: (b.timed || []).slice(0, 20).map((t) => ({ id: clampStr(t.id || uid(), 20), text: clampStr(t.text, 300), intervalMin: num(t.intervalMin, 15, 1, 720), enabled: !!t.enabled })),
      };
      ctx.store.set('chatbot', out); scheduleTimed(); return out;
    },
    start: scheduleTimed,
    stop() { timers.forEach(clearInterval); timers = []; },
    onEvent(e) {
      if (e.type !== 'chat' || !ctx.session.has('pro') || e.test) return;
      ctx.overlay.broadcast('chat', 'message', { id: e.id, user: e.user, text: e.text, platform: e.platform });
      const text = String(e.text || '').trim();
      if (text.startsWith('!')) {
        const trigger = text.split(/\s/)[0].toLowerCase();
        const c = cmds().find((x) => x.enabled && x.trigger === trigger);
        if (c) {
          if (c.level === 'mods' && !e.user?.isMod) return;
          const key = `${c.id}`; const now = Date.now();
          if (now - (lastUsed.get(key) || 0) < c.cooldownSec * 1000) return;
          lastUsed.set(key, now);
          if (c.response) reply(fill(c.response, e), e, `command ${c.trigger}`);
          if (c.macroId) ctx.runMacro(c.macroId, `chat ${c.trigger}`);
          return;
        }
      }
      const b = bot();
      if (!b.enabled) return;
      const k = userKey(e);
      if (b.welcome.enabled && !seen.has(k)) { seen.add(k); reply(fill(b.welcome.template, e), e, 'welcome'); return; }
      seen.add(k);
      const lower = text.toLowerCase();
      const kw = b.keywords.find((x) => x.enabled && lower.includes(x.keyword));
      if (kw) {
        const key = `kw:${kw.id}`; const now = Date.now();
        if (now - (lastUsed.get(key) || 0) < 30_000) return;
        lastUsed.set(key, now);
        reply(fill(kw.response, e), e, `keyword ${kw.keyword}`);
      }
    },
    reply,
  };
};
