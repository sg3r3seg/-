'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Small JSON document store in the user's profile (%APPDATA%\LiveX). Atomic
// writes (temp file + rename), debounced. Survives app updates.
class Store {
  constructor(dir, name, defaults = {}) {
    this.file = path.join(dir, `${name}.json`);
    this.defaults = defaults;
    this.timer = null;
    try { this.data = { ...structuredClone(defaults), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { this.data = structuredClone(defaults); }
  }
  get(key, fallback) { return key in this.data ? this.data[key] : fallback; }
  set(key, value) { this.data[key] = value; this.save(); return value; }
  patch(obj) { Object.assign(this.data, obj); this.save(); return this.data; }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
}
module.exports = { Store };
