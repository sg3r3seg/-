import { t } from '../i18n.js';
import { h, call, card, field, input, select, act, empty, btn, confirmBox, copy, badge } from '../ui.js';
import { icon } from '../icons.js';

// ------------------------------------------------------------- SOUND BOARD --
export async function soundboard(root, app) {
  let sounds = await call('sounds:list');
  const pads = h('div', { class: 'pads' });
  const render = () => pads.replaceChildren(...(sounds.length ? sounds.map((s) => h('div', { class: 'pad', style: { '--pad': s.color } },
    h('button', { class: 'pad-play', onclick: (e) => act(e.currentTarget, () => call('sounds:play', s.id)) }, h('span', { html: icon('play', 26) }), h('span', { class: 'pad-name' }, s.name)),
    h('div', { class: 'pad-meta' },
      input({ value: s.name, maxlength: 40, onchange: async (e) => { sounds = await call('sounds:update', s.id, { name: e.target.value }); } }),
      input({ value: s.hotkey, placeholder: t('hotkey_ph'), class: 'input mono', onchange: async (e) => { sounds = await call('sounds:update', s.id, { hotkey: e.target.value }); } }),
      h('div', { class: 'row' }, h('input', { type: 'range', class: 'range', min: 0, max: 1, step: 0.05, value: s.volume, onchange: async (e) => { sounds = await call('sounds:update', s.id, { volume: +e.target.value }); app.clearSoundCache?.(s.id); } }),
        h('input', { type: 'color', value: s.color, class: 'color', onchange: async (e) => { sounds = await call('sounds:update', s.id, { color: e.target.value }); render(); } }),
        h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: async () => { if (await confirmBox(t('delete_sound_confirm'), true)) { sounds = await call('sounds:remove', s.id); render(); } } }))))) : [empty(t('no_sounds'))]));
  render();
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('nav_soundboard')),
    btn([h('span', { html: icon('upload') }), t('import_sounds')], (e) => act(e.currentTarget, async () => { sounds = await call('sounds:import'); render(); }), 'primary')),
  h('p', { class: 'muted small' }, t('soundboard_hint')), pads));
}

// ------------------------------------------------------------------- MACRO --
export async function macro(root) {
  let { macros, stepTypes } = await call('macros:list');
  const sounds = await call('sounds:list');
  const listEl = h('div', { class: 'stack' });
  const stepEditor = (m, s, i, rerender) => {
    const set = (k) => (e) => { s[k] = e.target.type === 'number' ? +e.target.value : e.target.value; };
    const extra = [];
    if (s.type === 'sound') extra.push(select([{ value: '', label: '—' }, ...sounds.map((x) => ({ value: x.id, label: x.name }))], s.soundId, { onchange: set('soundId') }));
    if (['tts', 'alert', 'chat', 'discord', 'highlight'].includes(s.type)) extra.push(input({ value: s.text || '', placeholder: t('text'), class: 'input grow', onchange: set('text') }));
    if (s.type === 'wait') extra.push(input({ type: 'number', min: 0, step: 100, value: s.ms ?? 1000, onchange: set('ms') }), h('span', { class: 'muted small' }, 'ms'));
    if (s.type === 'timer') { extra.push(select(['start', 'stop', 'reset', 'add'].map((x) => ({ value: x, label: t(`op_${x}`) })), s.op, { onchange: (e) => { s.op = e.target.value; rerender(); } })); if (s.op === 'add') extra.push(input({ type: 'number', value: s.sec ?? 60, onchange: set('sec') }), h('span', { class: 'muted small' }, t('seconds'))); }
    if (s.type === 'giveaway') extra.push(select(['open', 'close', 'draw'].map((x) => ({ value: x, label: t(`op_${x}`) })), s.op, { onchange: set('op') }));
    return h('div', { class: 'row step-row' }, h('span', { class: 'step-num' }, i + 1),
      select(stepTypes.map((x) => ({ value: x, label: t(`step_${x}`) })), s.type, { onchange: (e) => { s.type = e.target.value; if (s.type === 'timer' && !['start', 'stop', 'reset', 'add'].includes(s.op)) s.op = 'start'; if (s.type === 'giveaway' && !['open', 'close', 'draw'].includes(s.op)) s.op = 'open'; rerender(); } }),
      ...extra, h('button', { class: 'icon-btn', html: icon('x', 14), onclick: () => { m.steps.splice(i, 1); rerender(); } }));
  };
  const render = () => listEl.replaceChildren(...(macros.length ? macros.map((m) => {
    const body = h('div', { class: 'stack sm' });
    const rerender = () => body.replaceChildren(...m.steps.map((s, i) => stepEditor(m, s, i, rerender)), btn([h('span', { html: icon('plus', 14) }), t('add_step')], () => { m.steps.push({ type: 'wait', ms: 1000 }); rerender(); }, 'sm'));
    rerender();
    return h('div', { class: 'rule' },
      h('div', { class: 'rule-head' }, input({ value: m.name, maxlength: 40, onchange: (e) => { m.name = e.target.value; } }), input({ value: m.hotkey || '', placeholder: t('hotkey_ph'), class: 'input mono', onchange: (e) => { m.hotkey = e.target.value; } }),
        btn([h('span', { html: icon('play', 14) }), t('run')], (e) => act(e.currentTarget, () => call('macros:run', m.id), t('macro_done')), 'sm', { disabled: !m.id }),
        btn([h('span', { html: icon('check', 14) }), t('save')], (e) => act(e.currentTarget, async () => { macros = await call('macros:save', m); render(); }, t('saved')), 'primary sm'),
        h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: async () => { if (m.id && await confirmBox(t('delete_confirm'), true)) { macros = await call('macros:remove', m.id); } else if (!m.id) macros = macros.filter((x) => x !== m); render(); } })),
      body);
  }) : [empty(t('no_macros'))]));
  render();
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('nav_macro')), btn([h('span', { html: icon('plus') }), t('new_macro')], () => { macros = [...macros, { name: t('new_macro'), hotkey: '', steps: [] }]; render(); }, 'primary')),
    h('p', { class: 'muted small' }, t('macro_hint')), listEl));
}

// ----------------------------------------------------------- REMOTE CONTROL --
export async function remote(root) {
  const box = h('div');
  const render = (info) => {
    box.replaceChildren(info.running
      ? h('div', { class: 'stack' },
        h('div', { class: 'row' }, badge(t('state_connected'), 'ok'), h('span', { class: 'muted' }, `${t('active_sessions')}: ${info.sessions}`)),
        h('div', { class: 'pin-box' }, h('span', { class: 'muted small' }, 'PIN'), h('div', { class: 'pin mono' }, info.pin)),
        ...info.urls.map((u) => h('div', { class: 'url-row' }, h('span', { class: 'mono grow' }, u), btn([h('span', { html: icon('copy', 14) }), t('copy')], () => copy(u), 'sm'))),
        info.urls.length ? null : h('div', { class: 'msg show warn' }, t('no_lan')),
        btn(t('stop_remote'), async (e) => render(await act(e.currentTarget, () => call('remote:stop')) || info), 'danger'))
      : h('div', { class: 'stack' }, h('p', { class: 'muted' }, t('remote_off')),
        btn([h('span', { html: icon('phone') }), t('start_remote')], async (e) => { const r = await act(e.currentTarget, () => call('remote:start')); if (r) render(r); }, 'primary')));
  };
  render(await call('remote:info'));
  root.append(card(t('nav_remote'), h('p', { class: 'muted small' }, t('remote_hint')), box));
}
