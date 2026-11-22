import { t } from '../i18n.js';
import { h, call, card, field, input, textarea, select, toggle, act, empty, btn } from '../ui.js';
import { icon } from '../icons.js';

const ALERT_TYPES = ['follow', 'gift', 'sub', 'superchat', 'bits', 'raid', 'share', 'like'];

// ---------------------------------------------------------------- ALERTS ----
export async function alerts(root) {
  let data = await call('alerts:get');
  const sounds = await call('sounds:list');
  const soundOpts = [{ value: '', label: t('no_sound') }, ...sounds.map((s) => ({ value: s.id, label: s.name }))];
  const list = h('div', { class: 'stack' });
  const render = () => {
    list.replaceChildren(...data.rules.map((r, i) => {
      const upd = (k) => (e) => { data.rules[i][k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
      return h('div', { class: 'rule' },
        h('div', { class: 'rule-head' }, toggle(r.enabled, (v) => { data.rules[i].enabled = v; }), select(ALERT_TYPES.map((x) => ({ value: x, label: t(`ev_type_${x}`) })), r.type, { onchange: upd('type') }),
          h('button', { class: 'btn sm', onclick: (e) => act(e.target, () => call('alerts:test', r.type), t('test_sent')) }, h('span', { html: icon('play', 14) }), t('test')),
          h('button', { class: 'icon-btn', title: t('delete'), html: icon('trash', 15), onclick: () => { data.rules.splice(i, 1); render(); } })),
        h('div', { class: 'grid g4' },
          field(t('message_template'), input({ value: r.template, onchange: upd('template') }), t('template_vars')),
          field(t('min_amount'), input({ type: 'number', min: 0, value: r.minAmount, onchange: upd('minAmount') })),
          field(t('duration_ms'), input({ type: 'number', min: 1000, step: 500, value: r.durationMs, onchange: upd('durationMs') })),
          field(t('sound'), select(soundOpts, r.soundId, { onchange: upd('soundId') }))),
        h('div', { class: 'row' }, h('span', { class: 'field-label' }, t('alert_media')),
          r.media ? h('span', { class: 'badge ok' }, r.media) : h('span', { class: 'muted small' }, t('alert_media_none')),
          h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, async () => { const m = await call('alerts:importMedia'); if (m) { data.rules[i].media = m.name; render(); } }) }, h('span', { html: icon('upload', 14) }), t('choose_image')),
          r.media ? h('button', { class: 'btn sm ghost', onclick: () => { data.rules[i].media = ''; render(); } }, t('remove')) : null));
    }));
  };
  render();
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('alert_rules')), toggle(data.enabled, (v) => { data.enabled = v; }, t('alerts_enabled'))),
    h('p', { class: 'muted small' }, t('alerts_hint')), list,
    h('div', { class: 'row' },
      btn([h('span', { html: icon('plus') }), t('add_rule')], () => { data.rules.push({ type: 'follow', enabled: true, minAmount: 0, template: '{user}', soundId: '', durationMs: 5000 }); render(); }),
      btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => { data = await call('alerts:save', data); render(); }, t('saved')), 'primary'))));
}

// ---------------------------------------------------------------- CHAT BOT ----
export async function chatbot(root) {
  let b = await call('bot:get');
  const kwList = h('div', { class: 'stack' }); const timedList = h('div', { class: 'stack' });
  const renderKw = () => kwList.replaceChildren(...(b.keywords.length ? b.keywords.map((k, i) => h('div', { class: 'row' }, toggle(k.enabled, (v) => { k.enabled = v; }),
    input({ value: k.keyword, placeholder: t('keyword'), onchange: (e) => { k.keyword = e.target.value; } }),
    input({ value: k.response, placeholder: t('response'), class: 'input grow', onchange: (e) => { k.response = e.target.value; } }),
    h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: () => { b.keywords.splice(i, 1); renderKw(); } }))) : [empty(t('none'))]));
  const renderTimed = () => timedList.replaceChildren(...(b.timed.length ? b.timed.map((x, i) => h('div', { class: 'row' }, toggle(x.enabled, (v) => { x.enabled = v; }),
    input({ value: x.text, placeholder: t('message'), class: 'input grow', onchange: (e) => { x.text = e.target.value; } }),
    input({ type: 'number', min: 1, value: x.intervalMin, style: { width: '90px' }, onchange: (e) => { x.intervalMin = +e.target.value; } }), h('span', { class: 'muted small' }, t('minutes')),
    h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: () => { b.timed.splice(i, 1); renderTimed(); } }))) : [empty(t('none'))]));
  renderKw(); renderTimed();
  const welcomeTpl = input({ value: b.welcome.template, onchange: (e) => { b.welcome.template = e.target.value; } });
  const manual = input({ placeholder: t('send_as_bot'), maxlength: 450, class: 'input grow' });
  root.append(
    h('div', { class: 'msg show info' }, t('bot_write_note')),
    card(h('div', { class: 'row between' }, h('h3', {}, t('nav_chatbot')), toggle(b.enabled, (v) => { b.enabled = v; }, t('enabled'))),
      h('h4', {}, t('welcome_message')), h('div', { class: 'row' }, toggle(b.welcome.enabled, (v) => { b.welcome.enabled = v; }), welcomeTpl),
      h('h4', {}, t('keyword_replies')), kwList, btn([h('span', { html: icon('plus') }), t('add')], () => { b.keywords.push({ keyword: '', response: '', enabled: true }); renderKw(); }, 'sm'),
      h('h4', {}, t('timed_messages')), timedList, btn([h('span', { html: icon('plus') }), t('add')], () => { b.timed.push({ text: '', intervalMin: 15, enabled: true }); renderTimed(); }, 'sm'),
      h('div', { class: 'row end' }, btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => { b = await call('bot:save', b); renderKw(); renderTimed(); }, t('saved')), 'primary'))),
    card(t('moderation'), h('p', { class: 'muted small' }, t('moderation_hint')),
      h('div', { class: 'toggles' },
        toggle(b.moderation.enabled, (v) => { b.moderation.enabled = v; }, t('moderation_enabled')),
        toggle(b.moderation.blockLinks, (v) => { b.moderation.blockLinks = v; }, t('block_links')),
        toggle(b.moderation.spamFilter, (v) => { b.moderation.spamFilter = v; }, t('spam_filter')),
        toggle(b.moderation.exemptMods, (v) => { b.moderation.exemptMods = v; }, t('exempt_mods')),
        toggle(b.moderation.warn, (v) => { b.moderation.warn = v; }, t('warn_in_chat'))),
      h('div', { class: 'grid g3' },
        field(t('max_repeats'), input({ type: 'number', min: 2, max: 20, value: b.moderation.maxRepeats, onchange: (e) => { b.moderation.maxRepeats = +e.target.value; } })),
        field(t('max_per_10s'), input({ type: 'number', min: 2, max: 50, value: b.moderation.maxPerTenSec, onchange: (e) => { b.moderation.maxPerTenSec = +e.target.value; } })),
        field(t('warn_template'), input({ value: b.moderation.warnTemplate, onchange: (e) => { b.moderation.warnTemplate = e.target.value; } }))),
      h('div', { class: 'row end' }, btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => { b = await call('bot:save', b); }, t('saved')), 'primary'))),
    card(t('send_message'), h('div', { class: 'row' }, manual, btn(t('send'), (e) => act(e.currentTarget, async () => {
      const r = await call('bot:send', manual.value);
      const sent = r.filter((x) => x.ok).map((x) => x.platform);
      if (!sent.length) throw new Error(t('not_sent_no_write'));
      manual.value = '';
      return sent;
    }, t('sent')), 'primary'))),
  );
}

// ---------------------------------------------------------------- COMMANDS ----
export async function commands(root) {
  let list = await call('commands:get');
  const macros = (await call('macros:list')).macros;
  const tbl = h('div', { class: 'stack' });
  const render = () => tbl.replaceChildren(...(list.length ? list.map((c, i) => h('div', { class: 'rule' },
    h('div', { class: 'rule-head' }, toggle(c.enabled, (v) => { c.enabled = v; }), input({ value: c.trigger, placeholder: '!command', class: 'input mono', style: { maxWidth: '200px' }, onchange: (e) => { c.trigger = e.target.value; } }),
      select([{ value: 'everyone', label: t('everyone') }, { value: 'mods', label: t('mods_only') }], c.level, { onchange: (e) => { c.level = e.target.value; } }),
      h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: () => { list.splice(i, 1); render(); } })),
    h('div', { class: 'grid g3' },
      field(t('response'), textarea({ value: c.response, rows: 2, onchange: (e) => { c.response = e.target.value; } }), t('template_vars')),
      field(t('cooldown_sec'), input({ type: 'number', min: 0, value: c.cooldownSec, onchange: (e) => { c.cooldownSec = +e.target.value; } })),
      field(t('run_macro'), select([{ value: '', label: '—' }, ...macros.map((m) => ({ value: m.id, label: m.name }))], c.macroId, { onchange: (e) => { c.macroId = e.target.value; } }))))) : [empty(t('no_commands'))]));
  render();
  root.append(card(t('nav_commands'), h('p', { class: 'muted small' }, t('commands_hint')), tbl,
    h('div', { class: 'row' },
      btn([h('span', { html: icon('plus') }), t('add_command')], () => { list.push({ trigger: '!', response: '', cooldownSec: 10, level: 'everyone', enabled: true, macroId: '' }); render(); }),
      btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => { list = await call('commands:save', list); render(); }, t('saved')), 'primary'))));
}
