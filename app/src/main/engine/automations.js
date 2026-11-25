'use strict';
const { fill, userKey } = require('./util');

// BUILT-IN AUTOMATIONS — ship with LiveX, cannot be deleted or edited (locked).
// The creator can only switch each one on or off. They react to real events only
// (test alerts never trigger them) and need LiveX PRO, like the rest of the bot.
// Chat replies go out only through connections that can write; otherwise the
// activity log says "not sent" (never shown as delivered).
const BUILTIN = [
  {
    id: 'winner_private_chat', icon: 'gift', on: ['giveaway_winner'], defaultOn: true,
    name: ['Giveaway winner: private chat', 'זוכה בהגרלה: צ׳אט פרטי'],
    desc: ['When a winner is drawn, LiveX opens a private chat room and posts a link in the live chat. Only the real winner can open it, after signing in with their platform account. The conversation opens in a window that is hidden from OBS and screen capture.', 'כשנבחר זוכה, LiveX פותחת חדר צ׳אט פרטי ומפרסמת קישור בצ׳אט של השידור. רק הזוכה האמיתי/ת יכול/ה להיכנס, אחרי התחברות עם חשבון הפלטפורמה. השיחה נפתחת בחלון שמוסתר מ-OBS ומצילום מסך.'],
    text: ['🎉 Congrats @{user}! You won the giveaway: {title}. Open this private link to talk with me: {link}', '🎉 מזל טוב @{user}! זכית בהגרלה: {title}. היכנס/י לקישור הפרטי כדי לדבר איתי: {link}'],
    fallback: ['🎉 Congrats @{user}! You won the giveaway: {title}!', '🎉 מזל טוב @{user}! זכית בהגרלה: {title}!'],
    // used when the previous winner was not found and the prize moved on
    transferText: ['🎁 @{from} could not be reached, so the prize moves on! Congrats @{user}, you won the giveaway: {title}. Open this private link to talk with me: {link}', '🎁 @{from} לא נמצא/ה, אז הפרס עובר הלאה! מזל טוב @{user}, זכית בהגרלה: {title}. היכנס/י לקישור הפרטי כדי לדבר איתי: {link}'],
    transferFallback: ['🎁 @{from} could not be reached, so the prize moves on! Congrats @{user}, you won the giveaway: {title}!', '🎁 @{from} לא נמצא/ה, אז הפרס עובר הלאה! מזל טוב @{user}, זכית בהגרלה: {title}!'],
  },
  {
    id: 'thank_follow', icon: 'users', on: ['follow'], defaultOn: true, cooldownMs: 15_000,
    name: ['Thank new followers', 'תודה לעוקבים חדשים'],
    desc: ['Thanks new followers in chat (at most once every 15 seconds, so follow waves do not flood the chat).', 'מודה לעוקבים חדשים בצ׳אט (לכל היותר פעם ב-15 שניות, כדי שגל עוקבים לא יציף את הצ׳אט).'],
    text: ['Thanks for the follow, {user}! 💜', 'תודה על המעקב, {user}! 💜'],
  },
  {
    id: 'thank_gift', icon: 'gift', on: ['gift'], defaultOn: true, perUserMs: 20_000,
    name: ['Thank gifts', 'תודה על מתנות'],
    desc: ['Thanks viewers who send gifts (once per viewer every 20 seconds).', 'מודה לצופים ששולחים מתנות (פעם ב-20 שניות לכל צופה).'],
    text: ['{user}, huge thanks for {gift} ×{count}! 🎁', '{user}, תודה ענקית על {gift} ×{count}! 🎁'],
  },
  {
    id: 'thank_sub', icon: 'star', on: ['sub'], defaultOn: true, perUserMs: 10_000,
    name: ['Thank subscribers & members', 'תודה למנויים וחברי ערוץ'],
    desc: ['Thanks new subscribers / channel members in chat.', 'מודה למנויים חדשים ולחברי ערוץ בצ׳אט.'],
    text: ['{user}, thank you for subscribing! ⭐', '{user}, תודה על המנוי! ⭐'],
  },
  {
    id: 'thank_support', icon: 'zap', on: ['superchat', 'bits'], defaultOn: true, perUserMs: 10_000,
    name: ['Thank Super Chat & Bits', 'תודה על Super Chat ו-Bits'],
    desc: ['Thanks viewers for Super Chats, Super Stickers and Bits.', 'מודה לצופים על Super Chat, Super Sticker ו-Bits.'],
    text: ['{user}, thank you so much for the {amount} {currency}! 💰', '{user}, תודה רבה על ה-{amount} {currency}! 💰'],
  },
  {
    id: 'welcome_raid', icon: 'users', on: ['raid'], defaultOn: true, perUserMs: 60_000,
    name: ['Welcome raids', 'ברכה לריידים'],
    desc: ['Welcomes an incoming raid / host and its viewers.', 'מברך ריידים ואירוחים נכנסים ואת הצופים שלהם.'],
    text: ['Welcome {user} and all {count} raiders! 🚀', 'ברוכים הבאים {user} וכל {count} הריידרים! 🚀'],
  },
  {
    id: 'goal_reached', icon: 'trophy', on: ['goal_reached'], defaultOn: true,
    name: ['Goal reached celebration', 'חגיגת הגעה ליעד'],
    desc: ['When the goal overlay reaches its target: an on-screen alert and a thank-you in chat.', 'כשיעד ה-Overlay מושג: התראה על המסך ותודה בצ׳אט.'],
    text: ['🎯 We reached the goal: {title}! Thank you all! 🙌', '🎯 הגענו ליעד: {title}! תודה לכולם! 🙌'],
    alert: true,
  },
  {
    id: 'challenge_done', icon: 'trophy', on: ['challenge_done'], defaultOn: true,
    name: ['Challenge completed', 'אתגר הושלם'],
    desc: ['Announces in chat when a challenge is completed.', 'מכריז בצ׳אט כשאתגר הושלם.'],
    text: ['🏆 Challenge completed: {title}!', '🏆 האתגר הושלם: {title}!'],
  },
  {
    id: 'timer_end', icon: 'timer', on: ['timer_end'], defaultOn: false,
    name: ['Timer finished', 'הטיימר הסתיים'],
    desc: ['Writes in chat when the countdown timer reaches zero.', 'כותב בצ׳אט כשהטיימר מגיע לאפס.'],
    text: ['⏰ Time is up: {title}!', '⏰ הזמן נגמר: {title}!'],
  },
];

// Fill {link}/{title} first (util.fill blanks keys it does not know), then the event fields.
const render = (tpl, e, extra = {}) => fill(String(tpl).replace(/\{(link|title|from)\}/g, (m, k) => (extra[k] ?? e?.[k] ?? m)), e);

module.exports = (ctx) => {
  const he = () => ctx.settings?.get?.('language') === 'he';
  const L = (pair) => pair[he() ? 1 : 0];
  const state = () => ({ enabled: {}, stats: {}, ...ctx.store.get('automations', {}) });
  const isOn = (a) => { const s = state().enabled[a.id]; return s === undefined ? a.defaultOn : !!s; };
  const lastRun = new Map(); // id or id|user -> ts
  const stat = (id) => { const s = state(); s.stats[id] = { count: (s.stats[id]?.count || 0) + 1, lastAt: Date.now() }; ctx.store.set('automations', s); ctx.send('automations:state', api.list()); };

  function allowed(a, key) {
    const now = Date.now();
    if (a.cooldownMs && now - (lastRun.get(a.id) || 0) < a.cooldownMs) return false;
    if (a.perUserMs && key && now - (lastRun.get(`${a.id}|${key}`) || 0) < a.perUserMs) return false;
    lastRun.set(a.id, now); if (key) lastRun.set(`${a.id}|${key}`, now);
    return true;
  }

  async function runWinner(a, data) {
    let link = null; let note = '';
    try {
      const r = await ctx.winners.create(data.winner, data.title);
      link = r.room.claimUrl;
      ctx.giveaway?.setRoom(data.winner.key, r.room.roomId);
      if (!r.signInReady) note = 'platform sign-in is not set up on the server yet';
      ctx.send('winners:changed', { roomId: r.room.roomId });
    } catch (e) { note = e.message; }
    const who = { user: { name: data.winner.handle || data.winner.name } };
    const moved = !!data.from;
    const extra = { title: data.title, link, from: data.from?.name };
    const text = link ? render(L(moved ? a.transferText : a.text), who, extra) : render(L(moved ? a.transferFallback : a.fallback), who, extra);
    await ctx.chat.reply(text, { platform: data.winner.platform }, `automation ${a.id}`);
    if (!link) ctx.activity({ kind: 'automation', text: `Private chat not opened: ${note}` });
    else if (note) ctx.activity({ kind: 'automation', text: `Private chat link posted — ${note}` });
  }

  async function run(a, data, evt) {
    if (!ctx.session.has('pro')) return;
    stat(a.id);
    if (a.id === 'winner_private_chat') return runWinner(a, data);
    const text = render(L(a.text), evt || {}, { title: data?.title ?? evt?.title });
    if (a.alert) ctx.alerts.showText(text, 7000);
    await ctx.chat.reply(text, evt?.platform ? { platform: evt.platform } : null, `automation ${a.id}`);
  }

  const api = {
    BUILTIN,
    list: () => BUILTIN.map((a) => ({ id: a.id, icon: a.icon, locked: true, builtIn: true, enabled: isOn(a), name: L(a.name), desc: L(a.desc), text: L(a.text), triggers: a.on, stats: state().stats[a.id] || { count: 0, lastAt: null } })),
    setEnabled(id, on) {
      const a = BUILTIN.find((x) => x.id === id);
      if (!a) throw Object.assign(new Error('Unknown automation'), { code: 'NOT_FOUND' });
      const s = state(); s.enabled[id] = !!on; ctx.store.set('automations', s);
      ctx.activity({ kind: 'automation', text: `Automation "${a.name[0]}" ${on ? 'on' : 'off'}` });
      const out = api.list(); ctx.send('automations:state', out); return out;
    },
    // Built-ins cannot be removed or edited: these calls exist so the API says so explicitly.
    remove() { throw Object.assign(new Error('Built-in automations are locked and cannot be deleted'), { code: 'LOCKED' }); },
    update() { throw Object.assign(new Error('Built-in automations are locked and cannot be edited'), { code: 'LOCKED' }); },
    // Preview: shows the exact message in the activity log, sends nothing.
    preview(id) {
      const a = BUILTIN.find((x) => x.id === id);
      if (!a) throw Object.assign(new Error('Unknown automation'), { code: 'NOT_FOUND' });
      const sample = { user: { name: 'Viewer123' }, gift: 'Rose', count: 5, amount: 5, currency: 'USD', title: he() ? 'אוזניות גיימינג' : 'Gaming headset' };
      const text = render(L(a.text), sample, { title: sample.title, link: 'https://…/w/…' });
      ctx.activity({ kind: 'automation', text: `TEST (not sent): ${text}` });
      return { text };
    },
    // Engine hook for non-chat triggers (giveaway winner, goal, challenge, timer).
    trigger(name, data = {}) {
      for (const a of BUILTIN) {
        if (!a.on.includes(name) || !isOn(a)) continue;
        if (!allowed(a, null)) continue;
        run(a, data, data.event).catch((e) => ctx.activity({ kind: 'automation', text: `Automation failed: ${e.message}` }));
      }
    },
    onEvent(e) {
      if (e.test || e.blocked || !ctx.session.has('pro')) return;
      for (const a of BUILTIN) {
        if (!a.on.includes(e.type) || !isOn(a)) continue;
        if (!allowed(a, a.perUserMs ? userKey(e) : null)) continue;
        run(a, {}, e).catch((err) => ctx.activity({ kind: 'automation', text: `Automation failed: ${err.message}` }));
      }
    },
  };
  return api;
};
