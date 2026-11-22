// Audio players living for the whole app session: TTS speech and sound board.
import { call, b64ToUrl } from './ui.js';

async function playUrl(url, { volume = 1, sinkId } = {}, register) {
  const a = new Audio(url);
  a.volume = Math.max(0, Math.min(1, volume));
  if (sinkId && sinkId !== 'default' && typeof a.setSinkId === 'function') {
    try { await a.setSinkId(sinkId); } catch { /* device missing -> default output */ }
  }
  if (register) register(a);
  await new Promise((resolve) => {
    a.onended = resolve; a.onerror = resolve; a.onpause = () => { if (a.currentTime < a.duration) resolve(); };
    a.play().catch(resolve);
  });
  URL.revokeObjectURL(url);
}

function speakWeb(text, profile) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.name === profile.voice);
    if (v) u.voice = v; else if (/[֐-׿]/.test(text)) u.lang = 'he-IL';
    u.rate = profile.rate || 1; u.pitch = profile.pitch || 1; u.volume = profile.volume ?? 1;
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

// Synthesize one utterance with a voice profile. Returns a playable URL or null (web speech used).
export async function synth(text, profile) {
  if (profile.engine === 'ai' && profile.aiVoiceId) {
    const b64 = await call('tts:synthAi', { text, voiceId: profile.aiVoiceId });
    return { url: b64ToUrl(b64, 'audio/mpeg') };
  }
  const info = window.__livex?.info || {};
  if (info.platform === 'win32') {
    const b64 = await call('tts:synthSystem', { text, voice: profile.voice, rate: profile.rate, pitch: profile.pitch, volume: profile.volume });
    return { url: b64ToUrl(b64, 'audio/wav') };
  }
  return { web: true };
}

export async function speak(text, profile, sinkId, register) {
  const r = await synth(text, profile);
  if (r.web) return speakWeb(text, profile);
  return playUrl(r.url, { volume: profile.engine === 'ai' ? profile.volume ?? 1 : 1, sinkId }, register);
}

export function startPlayers(app) {
  let currentAudio = null; let currentId = null;
  window.livex.on('tts:speak', async (item) => {
    currentId = item.id;
    try {
      await speak(item.text, item.profile || {}, item.outputDeviceId, (a) => { currentAudio = a; });
    } catch (e) {
      console.warn('TTS failed', e);
    } finally {
      currentAudio = null;
      if (currentId === item.id) call('tts:done', item.id).catch(() => {});
    }
  });
  window.livex.on('tts:stop', () => {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  });

  const cache = new Map();
  window.livex.on('sound:play', async ({ id }) => {
    try {
      let s = cache.get(id);
      if (!s) { s = await call('sounds:data', id); cache.set(id, s); }
      await playUrl(b64ToUrl(s.base64, s.mime), { volume: s.volume, sinkId: app.settings?.outputDeviceId });
    } catch (e) { console.warn('sound failed', e); }
  });
  window.livex.on('nav', (id) => app.go(id));
  app.clearSoundCache = (id) => (id ? cache.delete(id) : cache.clear());
}
