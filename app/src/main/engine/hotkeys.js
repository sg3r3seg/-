'use strict';
const { globalShortcut } = require('electron');

// Global hotkeys for sounds, macros, highlight marker and TTS skip.
module.exports = (ctx) => {
  const registered = [];
  const valid = (acc) => typeof acc === 'string' && /^((CommandOrControl|Control|Ctrl|Alt|Shift|Super|Meta)\+)*([A-Z0-9]|F[1-9]|F1[0-9]|F2[0-4]|Num[0-9]|Space|Tab|Home|End|PageUp|PageDown|Insert|Delete)$/i.test(acc);
  function refresh() {
    for (const a of registered.splice(0)) globalShortcut.unregister(a);
    if (!ctx.session.has('pro') && !ctx.session.has('tts')) return [];
    const map = [];
    const s = ctx.store.get('hotkeys', { highlight: 'CommandOrControl+Shift+H', ttsSkip: 'CommandOrControl+Shift+S' });
    if (ctx.session.has('pro')) {
      for (const snd of ctx.sounds.list()) if (snd.hotkey) map.push([snd.hotkey, () => ctx.sounds.play(snd.id, 'hotkey')]);
      for (const m of ctx.macros.list()) if (m.hotkey) map.push([m.hotkey, () => ctx.macros.run(m.id, 'hotkey').catch(() => {})]);
      if (s.highlight) map.push([s.highlight, () => ctx.insights.mark('', 'hotkey')]);
    }
    if (ctx.session.has('tts') && s.ttsSkip) map.push([s.ttsSkip, () => ctx.tts.skip()]);
    const failed = [];
    for (const [acc, fn] of map) {
      if (!valid(acc) || registered.includes(acc)) { failed.push(acc); continue; }
      try { if (globalShortcut.register(acc, fn)) registered.push(acc); else failed.push(acc); } catch { failed.push(acc); }
    }
    return failed;
  }
  return { refresh, registered: () => [...registered], valid, unregisterAll: () => { globalShortcut.unregisterAll(); registered.length = 0; } };
};
