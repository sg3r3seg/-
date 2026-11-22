'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { uid, clampStr, num } = require('./util');

const EXT = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm' };
const MAX = 15 * 1024 * 1024;

// SOUND BOARD: files are copied into %APPDATA%\LiveX\sounds; playback happens
// in the renderer on the selected audio output device.
module.exports = (ctx) => {
  const dir = path.join(ctx.dataDir, 'sounds');
  fs.mkdirSync(dir, { recursive: true });
  let sounds = ctx.store.get('sounds', []).filter((s) => fs.existsSync(path.join(dir, s.file)));
  const save = () => { ctx.store.set('sounds', sounds); ctx.hotkeys.refresh(); return sounds; };
  return {
    EXT,
    list: () => sounds,
    add(srcPath, name) {
      const ext = path.extname(srcPath).toLowerCase();
      if (!EXT[ext]) throw Object.assign(new Error('Unsupported audio format'), { code: 'VALIDATION' });
      const st = fs.statSync(srcPath);
      if (st.size > MAX) throw Object.assign(new Error('Sound file is larger than 15MB'), { code: 'VALIDATION' });
      const id = uid(); const file = `${id}${ext}`;
      fs.copyFileSync(srcPath, path.join(dir, file));
      const s = { id, name: clampStr(name || path.basename(srcPath, ext), 40), file, mime: EXT[ext], hotkey: '', volume: 1, color: '#22e4d9' };
      sounds.push(s); save(); return s;
    },
    addBuffer(buf, name, ext) {
      if (!EXT[ext] || buf.length > MAX) throw Object.assign(new Error('Invalid sound'), { code: 'VALIDATION' });
      const id = uid(); const file = `${id}${ext}`;
      fs.writeFileSync(path.join(dir, file), buf);
      const s = { id, name: clampStr(name, 40), file, mime: EXT[ext], hotkey: '', volume: 1, color: '#22e4d9' };
      sounds.push(s); save(); return s;
    },
    update(id, patch) {
      sounds = sounds.map((s) => (s.id === id ? { ...s, name: clampStr(patch.name ?? s.name, 40), hotkey: clampStr(patch.hotkey ?? s.hotkey, 40), volume: num(patch.volume, s.volume, 0, 1), color: /^#[0-9a-f]{6}$/i.test(patch.color || '') ? patch.color : s.color } : s));
      return save();
    },
    remove(id) {
      const s = sounds.find((x) => x.id === id);
      if (s) { try { fs.unlinkSync(path.join(dir, s.file)); } catch { /* ignore */ } }
      sounds = sounds.filter((x) => x.id !== id); return save();
    },
    data(id) {
      const s = sounds.find((x) => x.id === id);
      if (!s) throw Object.assign(new Error('Sound not found'), { code: 'NOT_FOUND' });
      return { mime: s.mime, volume: s.volume, bytes: fs.readFileSync(path.join(dir, path.basename(s.file))) };
    },
    play(id, source = 'manual') {
      if (!sounds.some((x) => x.id === id)) throw Object.assign(new Error('Sound not found'), { code: 'NOT_FOUND' });
      ctx.send('sound:play', { id, source });
      return true;
    },
  };
};
