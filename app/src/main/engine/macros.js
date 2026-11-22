'use strict';
const { uid, clampStr, num } = require('./util');

const STEP_TYPES = ['sound', 'tts', 'alert', 'wait', 'timer', 'chat', 'discord', 'highlight', 'wheel', 'giveaway'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MACRO: sequences of real actions, triggered by hotkey, chat command or the remote panel.
module.exports = (ctx) => {
  let macros = ctx.store.get('macros', []);
  const running = new Set();
  const save = () => { ctx.store.set('macros', macros); ctx.hotkeys.refresh(); return macros; };
  const cleanStep = (s) => ({
    type: STEP_TYPES.includes(s.type) ? s.type : 'wait', soundId: clampStr(s.soundId, 20), text: clampStr(s.text, 300),
    ms: num(s.ms, 1000, 0, 600000), op: ['start', 'stop', 'reset', 'add', 'open', 'close', 'draw'].includes(s.op) ? s.op : 'start', sec: num(s.sec, 60, -86400, 86400),
  });
  async function run(id, source = 'manual') {
    if (!ctx.session.has('pro')) throw Object.assign(new Error('LiveX PRO required'), { code: 'NOT_LICENSED' });
    const m = macros.find((x) => x.id === id);
    if (!m) throw Object.assign(new Error('Macro not found'), { code: 'NOT_FOUND' });
    if (running.has(id)) return { skipped: true };
    running.add(id);
    ctx.activity({ kind: 'macro', text: `Macro "${m.name}" started (${source})` });
    try {
      for (const s of m.steps) {
        switch (s.type) {
          case 'sound': ctx.sounds.play(s.soundId, 'macro'); break;
          case 'tts': ctx.tts.say(s.text, 'macro'); break;
          case 'alert': ctx.alerts.showText(s.text); break;
          case 'wait': await sleep(s.ms); break;
          case 'timer': if (s.op === 'add') ctx.timer.add(s.sec); else if (['start', 'stop', 'reset'].includes(s.op)) ctx.timer[s.op](); break;
          case 'chat': await ctx.chat.reply(s.text, null, `macro ${m.name}`); break;
          case 'discord': await ctx.platforms.connectors.discord.send(s.text); break;
          case 'highlight': ctx.insights.mark(s.text, 'macro'); break;
          case 'wheel': ctx.giveaway.spin(); break;
          case 'giveaway': if (['open', 'close', 'draw'].includes(s.op)) ctx.giveaway[s.op](); break;
          default: break;
        }
      }
      return { ok: true };
    } catch (e) {
      ctx.activity({ kind: 'macro', text: `Macro "${m.name}" failed: ${e.message}` });
      throw e;
    } finally { running.delete(id); }
  }
  return {
    STEP_TYPES,
    list: () => macros,
    save(m) {
      const item = { id: clampStr(m.id || uid(), 20), name: clampStr(m.name || 'Macro', 40), hotkey: clampStr(m.hotkey, 40), steps: (m.steps || []).slice(0, 50).map(cleanStep) };
      macros = [...macros.filter((x) => x.id !== item.id), item];
      return save();
    },
    remove(id) { macros = macros.filter((x) => x.id !== id); return save(); },
    run,
  };
};
