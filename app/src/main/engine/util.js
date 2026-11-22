'use strict';
const crypto = require('node:crypto');
const uid = () => crypto.randomUUID().slice(0, 8);
const fill = (tpl, e = {}) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => {
  const v = { user: e.user?.name, gift: e.gift, count: e.count, amount: e.amount, currency: e.currency, platform: e.platform, text: e.text, target: e.target, title: e.title }[k];
  return v === undefined || v === null ? '' : String(v);
});
const userKey = (e) => `${e.platform}:${e.user?.id || e.user?.name || 'anon'}`;
const clampStr = (s, n) => String(s ?? '').slice(0, n);
const num = (v, d, min = -Infinity, max = Infinity) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
module.exports = { uid, fill, userKey, clampStr, num };
