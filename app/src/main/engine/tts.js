'use strict';
const { uid, clampStr, num } = require('./util');

// Built-in offensive-word lists (extendable by the user's block list).
const PROFANITY = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'faggot', 'whore', 'slut', 'זונה', 'שרמוטה', 'מניאק', 'בן זונה', 'הומו', 'קוקסינל', 'מזדיין'];
const DEFAULTS = {
  enabled: true, readChat: true, readGifts: true, readFollows: false, readSubs: true, readSuperchats: true,
  readUsername: true, maxLength: 200, blockedWords: [], filterProfanity: true, profanityMode: 'skip',
  skipCommands: true, skipLinks: true, onlyMods: false, maxQueue: 50, activeProfileId: 'default', outputDeviceId: 'default',
};
const DEFAULT_PROFILE = { id: 'default', name: 'Default', engine: 'system', voice: '', aiVoiceId: '', rate: 1, pitch: 1, volume: 1 };

module.exports = (ctx) => {
  const queue = [];
  let current = null; let paused = false; let timeout = null;
  const settings = () => ({ ...DEFAULTS, ...ctx.store.get('tts', {}) });
  const profiles = () => { const p = ctx.store.get('voiceProfiles', []); return p.length ? p : [DEFAULT_PROFILE]; };
  const profile = () => profiles().find((p) => p.id === settings().activeProfileId) || profiles()[0];
  const state = () => ({ paused, current, queue: queue.slice(0, 50), length: queue.length, licensed: ctx.session.has('tts') });
  const emit = () => { ctx.send('tts:state', state()); };

  function clean(text, s) {
    let t = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.skipLinks) t = t.replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    const words = [...s.blockedWords.map((w) => String(w).toLowerCase().trim()).filter(Boolean), ...(s.filterProfanity ? PROFANITY : [])];
    // Whole-word match (Unicode aware) to avoid false positives inside other words.
    const re = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    const hit = words.filter((w) => re(w).test(t));
    if (hit.length) {
      if (s.profanityMode === 'skip') return null;
      for (const w of hit) t = t.replace(re(w), '$1***');
    }
    return t.length > s.maxLength ? `${t.slice(0, s.maxLength)}…` : t;
  }

  function enqueue(item) {
    const s = settings();
    if (!ctx.session.has('tts')) return null;
    if (queue.length >= s.maxQueue) return null;
    const it = { id: uid(), ts: Date.now(), ...item };
    queue.push(it);
    emit(); pump();
    return it;
  }
  function pump() {
    if (paused || current || !queue.length) return;
    current = queue.shift();
    const p = profile();
    ctx.overlay.broadcast('tts', 'speak', { id: current.id, text: current.text, user: current.user, platform: current.platform }, { sticky: true });
    ctx.send('tts:speak', { ...current, profile: p, outputDeviceId: settings().outputDeviceId });
    clearTimeout(timeout);
    timeout = setTimeout(() => done(current?.id), 90_000); // renderer did not report back
    emit();
  }
  function done(id) {
    if (!current || (id && current.id !== id)) return;
    clearTimeout(timeout);
    ctx.overlay.broadcast('tts', 'done', { id: current.id }, { sticky: true });
    current = null; emit();
    setTimeout(pump, 250);
  }

  return {
    PROFANITY, DEFAULT_PROFILE, _clean: (t, s = {}) => clean(t, { ...DEFAULTS, ...s }),
    settings, state, profiles,
    saveSettings(input) {
      const s = settings();
      const next = { ...s };
      for (const k of ['enabled', 'readChat', 'readGifts', 'readFollows', 'readSubs', 'readSuperchats', 'readUsername', 'filterProfanity', 'skipCommands', 'skipLinks', 'onlyMods']) if (k in input) next[k] = !!input[k];
      if ('maxLength' in input) next.maxLength = num(input.maxLength, 200, 10, 500);
      if ('maxQueue' in input) next.maxQueue = num(input.maxQueue, 50, 1, 200);
      if ('profanityMode' in input) next.profanityMode = input.profanityMode === 'mask' ? 'mask' : 'skip';
      if ('blockedWords' in input) next.blockedWords = (Array.isArray(input.blockedWords) ? input.blockedWords : String(input.blockedWords).split(',')).map((w) => clampStr(w, 40).trim()).filter(Boolean).slice(0, 500);
      if ('activeProfileId' in input) next.activeProfileId = clampStr(input.activeProfileId, 20);
      if ('outputDeviceId' in input) next.outputDeviceId = clampStr(input.outputDeviceId, 200);
      ctx.store.set('tts', next);
      if (s.enabled && !next.enabled) { queue.length = 0; if (current) { ctx.send('tts:stop', { id: current.id }); done(current.id); } emit(); }
      return next;
    },
    saveProfile(p) {
      const list = profiles().filter((x) => x.id !== p.id);
      const prof = {
        id: clampStr(p.id || uid(), 20), name: clampStr(p.name || 'Voice', 40), engine: ['system', 'ai'].includes(p.engine) ? p.engine : 'system',
        voice: clampStr(p.voice, 200), aiVoiceId: clampStr(p.aiVoiceId, 64), sampleFile: clampStr(p.sampleFile, 200),
        rate: num(p.rate, 1, 0.5, 2), pitch: num(p.pitch, 1, 0.5, 2), volume: num(p.volume, 1, 0, 1), consent: p.consent || undefined,
      };
      list.push(prof);
      ctx.store.set('voiceProfiles', list);
      return prof;
    },
    deleteProfile(id) {
      if (id === 'default') throw new Error('The default profile cannot be deleted');
      ctx.store.set('voiceProfiles', profiles().filter((x) => x.id !== id));
      return profiles();
    },
    onEvent(e) {
      const s = settings();
      if (!s.enabled || !ctx.session.has('tts') || e.test) return;
      let text = null;
      const name = s.readUsername && e.user?.name ? `${e.user.name}: ` : '';
      if (e.type === 'chat' && e.blocked) return;
      if (e.type === 'chat' && s.readChat) {
        if (s.skipCommands && /^[!/]/.test(e.text || '')) return;
        if (s.onlyMods && !e.user?.isMod) return;
        const c = clean(e.text, s); if (c) text = name + c;
      } else if (e.type === 'gift' && s.readGifts) text = `${e.user?.name || ''} sent ${e.gift || 'a gift'}${e.count > 1 ? ` x${e.count}` : ''}`;
      else if ((e.type === 'superchat' || e.type === 'bits') && s.readSuperchats) { const c = clean(e.text, s); text = `${e.user?.name || ''}: ${e.amount} ${e.currency || ''}${c ? `. ${c}` : ''}`; }
      else if (e.type === 'follow' && s.readFollows) text = `${e.user?.name || ''} followed`;
      else if (e.type === 'sub' && s.readSubs) text = `${e.user?.name || ''} subscribed`;
      if (text) enqueue({ text, user: e.user?.name, platform: e.platform, source: e.type });
    },
    say(text, source = 'manual') {
      if (!settings().enabled) throw Object.assign(new Error('LiveX TTS is turned off'), { code: 'TTS_DISABLED' });
      const t = clampStr(text, 500).trim(); return t ? enqueue({ text: t, source, platform: 'livex' }) : null;
    },
    failed(id, message) { ctx.hub.log('warn', 'tts', `speech failed: ${String(message).slice(0, 200)}`); done(id); },
    pause() { paused = true; emit(); return state(); },
    resume() { paused = false; emit(); pump(); return state(); },
    skip() { if (current) { ctx.send('tts:stop', { id: current.id }); done(current.id); } return state(); },
    clear() { queue.length = 0; if (current) { ctx.send('tts:stop', { id: current.id }); done(current.id); } emit(); return state(); },
    remove(id) { const i = queue.findIndex((q) => q.id === id); if (i >= 0) queue.splice(i, 1); emit(); return state(); },
    done,
  };
};
