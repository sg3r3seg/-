import { t } from '../i18n.js';
import { h, call, card, field, input, select, toggle, act, empty, btn, badge, fmtDur, fmtTime, confirmBox, textarea } from '../ui.js';
import { icon } from '../icons.js';

// -------------------------------------------------------------------- TIMER --
export async function timer(root) {
  let st = await call('timer:get');
  const big = h('div', { class: 'big-timer mono' });
  const runBadge = h('span');
  const show = (s) => { st = s; big.textContent = fmtDur(s.mode === 'stopwatch' ? s.elapsedMs : s.remainingMs); runBadge.replaceChildren(badge(s.running ? t('running') : t('stopped'), s.running ? 'ok' : '')); };
  show(st);
  const mode = select(['countdown', 'stopwatch', 'subathon'].map((m) => ({ value: m, label: t(`mode_${m}`) })), st.mode);
  const title = input({ value: st.title, maxlength: 60 });
  const mins = input({ type: 'number', min: 0, value: Math.floor(st.durationSec / 60) });
  const secs = input({ type: 'number', min: 0, max: 59, value: st.durationSec % 60 });
  const cap = input({ type: 'number', min: 0, value: Math.floor(st.capSec / 60) });
  const r = st.rules;
  const rule = (k) => input({ type: 'number', min: 0, value: r[k], 'data-k': k });
  const rules = { perFollowSec: rule('perFollowSec'), perSubSec: rule('perSubSec'), perGiftUnitSec: rule('perGiftUnitSec'), perSuperchatUnitSec: rule('perSuperchatUnitSec'), perLikeSec: rule('perLikeSec') };
  const subPanel = h('div', { class: 'grid g3' }, ...Object.entries(rules).map(([k, el]) => field(t(`rule_${k}`), el)), field(t('cap_minutes'), cap, t('cap_hint')));
  const syncMode = () => { subPanel.style.display = mode.value === 'subathon' ? '' : 'none'; };
  mode.onchange = syncMode; syncMode();
  root.append(h('div', { class: 'grid g2' },
    card(h('div', { class: 'row between' }, h('h3', {}, t('nav_timer')), runBadge), big,
      h('div', { class: 'row center' },
        btn([h('span', { html: icon('play') }), t('start')], (e) => act(e.currentTarget, async () => show(await call('timer:start'))), 'primary'),
        btn([h('span', { html: icon('pause') }), t('stop')], (e) => act(e.currentTarget, async () => show(await call('timer:stop')))),
        btn([h('span', { html: icon('refresh') }), t('reset')], (e) => act(e.currentTarget, async () => show(await call('timer:reset'))))),
      h('div', { class: 'row center' }, ...[-60, 60, 300, 600].map((sec) => btn(`${sec > 0 ? '+' : ''}${sec / 60} ${t('min_short')}`, (e) => act(e.currentTarget, async () => show(await call('timer:add', sec))), 'sm')))),
    card(t('timer_settings'),
      h('div', { class: 'grid g2' }, field(t('mode'), mode), field(t('title'), title)),
      h('div', { class: 'grid g2' }, field(t('minutes'), mins), field(t('seconds'), secs)),
      subPanel,
      btn([h('span', { html: icon('check') }), t('apply')], (e) => act(e.currentTarget, async () => show(await call('timer:configure', {
        mode: mode.value, title: title.value, durationSec: (+mins.value || 0) * 60 + (+secs.value || 0), capSec: (+cap.value || 0) * 60,
        rules: Object.fromEntries(Object.entries(rules).map(([k, el]) => [k, +el.value || 0])),
      })), t('saved')), 'primary'))));
  return window.livex.on('timer:state', show);
}

// ------------------------------------------------------- GOAL + CHALLENGES --
export async function challenges(root) {
  const { goal, metrics } = await call('goal:get');
  let list = await call('challenges:list');
  const metricOpts = metrics.map((m) => ({ value: m, label: t(`metric_${m}`) }));
  const g = { title: input({ value: goal.title }), metric: select(metricOpts, goal.metric), target: input({ type: 'number', min: 1, value: goal.target }), current: input({ type: 'number', min: 0, value: goal.current }) };
  const goalBar = h('div', { class: 'progress' }, h('div', { class: 'progress-fill' }));
  const showGoal = (x) => { goalBar.firstChild.style.width = `${Math.min(100, (x.current / x.target) * 100)}%`; goalBar.title = `${x.current}/${x.target}`; g.current.value = x.current; };
  showGoal(goal);
  const listEl = h('div', { class: 'stack' });
  const render = () => listEl.replaceChildren(...(list.length ? list.map((c) => h('div', { class: `challenge ${c.completedAt ? 'done' : ''}` },
    h('div', { class: 'row between' }, h('div', {}, h('b', {}, c.title), c.reward ? h('div', { class: 'muted small' }, `🎁 ${c.reward}`) : null),
      h('div', { class: 'row' }, c.completedAt ? badge(t('completed'), 'ok') : badge(`${c.progress}/${c.target} ${t(`metric_${c.metric}`)}`),
        h('button', { class: 'icon-btn', title: t('reset'), html: icon('refresh', 15), onclick: async () => { list = await call('challenges:reset', c.id); render(); } }),
        h('button', { class: 'icon-btn', title: t('delete'), html: icon('trash', 15), onclick: async () => { if (await confirmBox(t('delete_confirm'), true)) { list = await call('challenges:delete', c.id); render(); } } }))),
    h('div', { class: 'progress' }, h('div', { class: 'progress-fill', style: { width: `${Math.min(100, (c.progress / c.target) * 100)}%` } })))) : [empty(t('no_challenges'))]));
  render();
  const n = { title: input({ placeholder: t('challenge_title_ph'), maxlength: 80 }), reward: input({ placeholder: t('reward_ph'), maxlength: 120 }), metric: select(metricOpts, 'gift'), target: input({ type: 'number', min: 1, value: 10 }) };
  root.append(
    card(t('follower_goal'), h('p', { class: 'muted small' }, t('goal_hint')), goalBar,
      h('div', { class: 'grid g4' }, field(t('title'), g.title), field(t('metric'), g.metric), field(t('target'), g.target), field(t('current'), g.current)),
      btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => showGoal(await call('goal:save', { title: g.title.value, metric: g.metric.value, target: +g.target.value, current: +g.current.value })), t('saved')), 'primary')),
    card(t('nav_challenges'), h('p', { class: 'muted small' }, t('challenges_hint')), listEl,
      h('h4', {}, t('new_challenge')), h('div', { class: 'grid g4' }, field(t('title'), n.title), field(t('reward'), n.reward), field(t('metric'), n.metric), field(t('target'), n.target)),
      btn([h('span', { html: icon('plus') }), t('add')], (e) => act(e.currentTarget, async () => { if (!n.title.value.trim()) return; list = await call('challenges:save', { title: n.title.value, reward: n.reward.value, metric: n.metric.value, target: +n.target.value }); n.title.value = ''; n.reward.value = ''; render(); }), 'primary')),
  );
  const off1 = window.livex.on('challenges:state', (l) => { list = l; render(); });
  const off2 = window.livex.on('goal:state', showGoal);
  return () => { off1(); off2(); };
}

// ------------------------------------------------------------ GIVEAWAY + WHEEL --
export async function giveaway(root) {
  let g = await call('giveaway:get');
  let w = await call('wheel:get');
  const kw = input({ value: g.keyword, maxlength: 30, class: 'input mono' });
  const title = input({ value: g.title, maxlength: 60 });
  const stateEl = h('div'); const entriesEl = h('div', { class: 'entries' }); const winnersEl = h('div', { class: 'stack sm' });
  const show = (x) => {
    g = x;
    stateEl.replaceChildren(h('div', { class: 'row' }, badge(g.open ? t('giveaway_open') : t('giveaway_closed'), g.open ? 'ok' : ''), h('span', { class: 'big-num' }, g.total), h('span', { class: 'muted' }, t('entries'))));
    entriesEl.replaceChildren(...(g.entries.length ? g.entries.slice(-200).reverse().map((e) => h('span', { class: 'entry' }, h('span', { class: `pf-dot pf-${e.platform}` }), e.name)) : [empty(t('no_entries'))]));
    winnersEl.replaceChildren(...g.winners.slice().reverse().map((x) => h('div', { class: 'winner-row' }, h('span', { html: icon('trophy', 16) }), h('b', {}, x.name), h('span', { class: 'muted small' }, `${x.platform} · ${fmtTime(x.at)}`))));
  };
  show(g);
  const items = textarea({ value: w.items.join('\n'), rows: 6 });
  const resultEl = h('div', { class: 'wheel-result' }, w.last ? `${t('last_result')}: ${w.last.result}` : '');
  root.append(h('div', { class: 'grid g2' },
    card(t('nav_giveaway'), h('p', { class: 'muted small' }, t('giveaway_hint')),
      h('div', { class: 'grid g2' }, field(t('keyword'), kw), field(t('title'), title)),
      toggle(g.allowModsOnly, async (v) => show(await call('giveaway:configure', { keyword: kw.value, title: title.value, allowModsOnly: v })), t('mods_only')),
      btn(t('save'), (e) => act(e.currentTarget, async () => show(await call('giveaway:configure', { keyword: kw.value, title: title.value, allowModsOnly: g.allowModsOnly })), t('saved')), 'sm'),
      stateEl,
      h('div', { class: 'row' },
        btn([h('span', { html: icon('play') }), t('open_entries')], (e) => act(e.currentTarget, async () => show(await call('giveaway:open'))), 'primary'),
        btn([h('span', { html: icon('pause') }), t('close_entries')], (e) => act(e.currentTarget, async () => show(await call('giveaway:close')))),
        btn([h('span', { html: icon('trophy') }), t('draw_winner')], (e) => act(e.currentTarget, async () => { await call('giveaway:draw'); show(await call('giveaway:get')); })),
        btn([h('span', { html: icon('trash') }), t('reset')], async (e) => { if (await confirmBox(t('reset_giveaway_confirm'), true)) await act(e.currentTarget, async () => show(await call('giveaway:reset'))); }, 'danger')),
      h('h4', {}, t('winners')), winnersEl, h('h4', {}, t('entries')), entriesEl),
    card(t('wheel'), h('p', { class: 'muted small' }, t('wheel_hint')),
      field(t('wheel_items'), items, t('one_per_line')),
      toggle(w.useEntries, (v) => { w.useEntries = v; }, t('use_entries')),
      h('div', { class: 'row' },
        btn(t('save'), (e) => act(e.currentTarget, async () => { w = await call('wheel:save', { items: items.value.split('\n'), useEntries: w.useEntries }); }, t('saved'))),
        btn([h('span', { html: icon('wheel') }), t('spin')], (e) => act(e.currentTarget, async () => { const r = await call('wheel:spin'); setTimeout(() => { resultEl.textContent = `${t('last_result')}: ${r.result}`; }, 6000); resultEl.textContent = t('spinning'); }), 'primary')),
      resultEl)));
  return window.livex.on('giveaway:state', show);
}
