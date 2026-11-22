'use strict';
const { uid, fill, clampStr, num } = require('./util');

const DEFAULT_RULES = [
  { id: 'follow', type: 'follow', enabled: true, minAmount: 0, template: '{user} started following!', soundId: '', durationMs: 5000 },
  { id: 'gift', type: 'gift', enabled: true, minAmount: 0, template: '{user} sent {gift} x{count}', soundId: '', durationMs: 6000 },
  { id: 'sub', type: 'sub', enabled: true, minAmount: 0, template: '{user} subscribed!', soundId: '', durationMs: 6000 },
  { id: 'superchat', type: 'superchat', enabled: true, minAmount: 0, template: '{user}: {amount} {currency} — {text}', soundId: '', durationMs: 8000 },
  { id: 'bits', type: 'bits', enabled: true, minAmount: 1, template: '{user} cheered {amount} bits!', soundId: '', durationMs: 6000 },
  { id: 'raid', type: 'raid', enabled: true, minAmount: 0, template: '{user} is raiding with {count} viewers!', soundId: '', durationMs: 7000 },
  { id: 'share', type: 'share', enabled: false, minAmount: 0, template: '{user} shared the LIVE', soundId: '', durationMs: 4000 },
];
const TYPES = ['follow', 'gift', 'sub', 'superchat', 'bits', 'raid', 'share', 'like'];

module.exports = (ctx) => {
  const data = () => ctx.store.get('alerts', { enabled: true, rules: DEFAULT_RULES });
  const save = (d) => { ctx.store.set('alerts', d); return d; };

  function show(rule, evt, test = false) {
    const media = rule.media ? ctx.overlay.mediaUrl(rule.media) : null;
    const alert = { id: uid(), type: evt.type, platform: evt.platform, text: fill(rule.template, evt), user: evt.user?.name, avatar: evt.user?.avatar, image: media || evt.image, custom: !!media, durationMs: rule.durationMs, test };
    ctx.overlay.broadcast('alerts', 'alert', alert);
    if (rule.soundId) ctx.send('sound:play', { id: rule.soundId, source: 'alert' });
    return alert;
  }

  return {
    get: data,
    save(input) {
      const rules = (Array.isArray(input?.rules) ? input.rules : []).slice(0, 50).filter((r) => TYPES.includes(r.type)).map((r) => ({
        id: clampStr(r.id || uid(), 20), type: r.type, enabled: !!r.enabled, minAmount: num(r.minAmount, 0, 0, 1e9),
        template: clampStr(r.template, 200), soundId: clampStr(r.soundId, 40), durationMs: num(r.durationMs, 5000, 1000, 60000),
        media: /^[a-z0-9]{8}\.(png|jpe?g|gif|webp)$/.test(r.media || '') ? r.media : '',
      }));
      return save({ enabled: !!input?.enabled, rules });
    },
    onEvent(evt) {
      const d = data();
      if (!d.enabled || !ctx.session.has('pro')) return;
      const rule = d.rules.find((r) => r.enabled && r.type === evt.type && (evt.amount ?? evt.count ?? 0) >= r.minAmount);
      if (rule) show(rule, evt);
    },
    // Explicit test alert — clearly labelled as TEST on the overlay.
    test(type) {
      const rule = data().rules.find((r) => r.type === type) || DEFAULT_RULES[0];
      return show(rule, { type, platform: 'test', user: { name: 'LiveX Test' }, gift: 'Rose', count: 1, amount: 5, currency: 'USD', text: 'Test alert' }, true);
    },
    showText(text, durationMs = 5000) {
      const a = { id: uid(), type: 'custom', text: clampStr(text, 200), durationMs };
      ctx.overlay.broadcast('alerts', 'alert', a);
      return a;
    },
  };
};
