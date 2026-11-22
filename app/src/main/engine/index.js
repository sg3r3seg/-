'use strict';
const hub = require('../hub');

// Wires all modules to the event hub. `ctx` is the shared dependency bag.
function createEngine(base) {
  const ctx = {
    ...base,
    hub,
    activity(a) { const e = { id: Math.random().toString(36).slice(2), ts: Date.now(), ...a }; ctx.send('activity', e); hub.log('info', a.kind || 'engine', a.text + (a.note ? ` (${a.note})` : '')); return e; },
  };
  ctx.hotkeys = require('./hotkeys')(ctx);
  ctx.alerts = require('./alerts')(ctx);
  ctx.tts = require('./tts')(ctx);
  ctx.sounds = require('./sounds')(ctx);
  ctx.timer = require('./timer')(ctx);
  ctx.giveaway = require('./giveaway')(ctx);
  ctx.goals = require('./goals')(ctx);
  ctx.insights = require('./insights')(ctx);
  ctx.schedule = require('./schedule')(ctx);
  ctx.macros = require('./macros')(ctx);
  ctx.runMacro = (id, src) => ctx.macros.run(id, src).catch(() => {});
  ctx.chat = require('./chat')(ctx);

  const consumers = [ctx.insights, ctx.alerts, ctx.tts, ctx.chat, ctx.timer, ctx.giveaway, ctx.goals];
  hub.on('event', (e) => {
    for (const c of consumers) {
      try { c.onEvent(e); } catch (err) { hub.log('error', 'engine', err.message); }
    }
    ctx.send('event', e);
  });

  ctx.start = () => {
    ctx.timer.restore();
    ctx.goals.saveGoal(ctx.goals.goal());
    ctx.giveaway.configure(ctx.giveaway.get());
    ctx.giveaway.saveWheel(ctx.giveaway.wheel());
    ctx.chat.start();
    ctx.hotkeys.refresh();
  };
  return ctx;
}
module.exports = { createEngine };
