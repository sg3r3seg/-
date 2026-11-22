import { t } from '../i18n.js';
import { h, call, card, field, input, textarea, toggle, act, empty, btn, badge, fmtDate, fmtNum, fmtDur, confirmBox, toast } from '../ui.js';
import { icon } from '../icons.js';

const PLATFORMS = ['tiktok', 'youtube', 'kick', 'twitch'];

// ----------------------------------------------------------------- SCHEDULE --
export async function schedule(root) {
  let items = await call('schedule:list');
  const listEl = h('div', { class: 'stack' });
  const toLocal = (ms) => { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const f = { title: input({ maxlength: 100, placeholder: t('stream_title_ph') }), when: input({ type: 'datetime-local', value: toLocal(Date.now() + 3600_000) }), duration: input({ type: 'number', min: 5, value: 120 }), remind: input({ type: 'number', min: 0, value: 15 }), notes: textarea({ rows: 2 }) };
  const plats = new Set(['tiktok']);
  let announce = false; let editing = null;
  const platToggles = h('div', { class: 'row' }, ...PLATFORMS.map((p) => toggle(plats.has(p), (v) => (v ? plats.add(p) : plats.delete(p)), p)));
  const render = () => listEl.replaceChildren(...(items.length ? items.map((it) => h('div', { class: `sched ${it.startsAt < Date.now() ? 'past' : ''}` },
    h('div', { class: 'sched-date' }, h('b', {}, new Date(it.startsAt).toLocaleDateString()), h('span', {}, new Date(it.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))),
    h('div', { class: 'grow' }, h('b', {}, it.title), h('div', { class: 'muted small' }, `${it.platforms.join(' · ')} · ${it.durationMin} ${t('min_short')}${it.notes ? ` · ${it.notes}` : ''}`)),
    it.announceDiscord ? badge('Discord', 'ok') : null,
    btn(t('announce_now'), (e) => act(e.currentTarget, () => call('schedule:announce', it.id), t('announced')), 'sm'),
    h('button', { class: 'icon-btn', html: icon('settings', 15), title: t('edit'), onclick: () => { editing = it.id; f.title.value = it.title; f.when.value = toLocal(it.startsAt); f.duration.value = it.durationMin; f.remind.value = it.remindMin; f.notes.value = it.notes; } }),
    h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: async () => { if (await confirmBox(t('delete_confirm'), true)) { items = await call('schedule:remove', it.id); render(); } } }))) : [empty(t('no_schedule'))]));
  render();
  root.append(h('div', { class: 'grid g2' },
    card(t('add_stream'),
      field(t('title'), f.title), h('div', { class: 'grid g3' }, field(t('date_time'), f.when), field(t('duration_min'), f.duration), field(t('remind_min'), f.remind)),
      field(t('platforms'), platToggles), field(t('notes'), f.notes),
      toggle(false, (v) => { announce = v; }, t('announce_discord')),
      btn([h('span', { html: icon('check') }), t('save')], (e) => act(e.currentTarget, async () => {
        items = await call('schedule:save', { id: editing, title: f.title.value, startsAt: new Date(f.when.value).getTime(), durationMin: +f.duration.value, remindMin: +f.remind.value, notes: f.notes.value, platforms: [...plats], announceDiscord: announce });
        editing = null; f.title.value = ''; f.notes.value = ''; render();
      }, t('saved')), 'primary')),
    card(t('upcoming'), h('p', { class: 'muted small' }, t('schedule_hint')), listEl)));
  return window.livex.on('schedule:state', (l) => { items = l; render(); });
}

// ---------------------------------------------------------------- COMMUNITY --
export async function community(root) {
  const q = input({ placeholder: t('search_viewer') });
  let sort = 'messages';
  const tbody = h('tbody'); const total = h('span', { class: 'muted small' });
  const load = async () => {
    const r = await call('community:list', { q: q.value, sort, limit: 300 });
    total.textContent = `${fmtNum(r.total)} ${t('viewers')}`;
    tbody.replaceChildren(...(r.items.length ? r.items.map((v, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, h('span', { class: `pf-dot pf-${v.platform}` }), ' ', v.name), h('td', {}, v.platform), h('td', {}, fmtNum(v.messages)), h('td', {}, fmtNum(v.gifts)), h('td', {}, fmtNum(Math.round(v.giftValue))), h('td', {}, v.follows ? '✓' : ''), h('td', {}, fmtDate(v.firstSeen)), h('td', {}, fmtDate(v.lastSeen)))) : [h('tr', {}, h('td', { colspan: 9 }, empty(t('no_viewers'))))]));
  };
  q.oninput = () => load();
  const th = (k, label) => h('th', { class: 'sortable', onclick: () => { sort = k; load(); } }, label);
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('nav_community')), h('div', { class: 'row' }, q, total,
    btn(t('reset'), async (e) => { if (await confirmBox(t('reset_community_confirm'), true)) await act(e.currentTarget, async () => { await call('community:reset'); await load(); }); }, 'danger sm'))),
  h('p', { class: 'muted small' }, t('community_hint')),
  h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('viewer')), h('th', {}, t('platform')), th('messages', t('messages')), th('gifts', t('gifts')), th('giftValue', t('gift_value')), h('th', {}, t('followed')), th('firstSeen', t('first_seen')), th('lastSeen', t('last_seen')))), tbody))));
  await load();
  const iv = setInterval(load, 10000);
  return () => clearInterval(iv);
}

// ---------------------------------------------------------------- HIGHLIGHTS --
export async function highlights(root) {
  let list = await call('highlights:list');
  const note = input({ placeholder: t('highlight_note_ph'), maxlength: 200, class: 'input grow' });
  const listEl = h('div', { class: 'stack' });
  const off = (s) => (s === null ? '—' : fmtDur(s * 1000));
  const render = () => listEl.replaceChildren(...(list.length ? list.map((x) => h('div', { class: 'highlight' },
    h('div', { class: 'hl-time' }, h('b', { class: 'mono' }, off(x.offsetSec)), h('span', { class: 'muted small' }, fmtDate(x.ts))),
    h('div', { class: 'grow' }, input({ value: x.note, placeholder: t('add_note'), onchange: async (e) => { list = await call('highlights:update', x.id, e.target.value); } }),
      x.chat.length ? h('details', {}, h('summary', { class: 'muted small' }, `${t('chat_context')} (${x.chat.length})`), ...x.chat.map((c) => h('div', { class: 'small' }, h('b', {}, c.user), ': ', c.text))) : null),
    badge(x.source), h('button', { class: 'icon-btn', html: icon('trash', 15), onclick: async () => { list = await call('highlights:delete', x.id); render(); } }))) : [empty(t('no_highlights'))]));
  render();
  const hk = await call('hotkeys:get').catch(() => ({}));
  root.append(card(t('mark_highlight'), h('p', { class: 'muted small' }, `${t('highlight_hint')} ${hk.highlight ? `(${hk.highlight})` : ''}`),
    h('div', { class: 'row' }, note, btn([h('span', { html: icon('star') }), t('mark_now')], (e) => act(e.currentTarget, async () => { await call('highlights:mark', note.value); note.value = ''; list = await call('highlights:list'); render(); }), 'primary'))),
  card(h('div', { class: 'row between' }, h('h3', {}, t('nav_highlights')), btn([h('span', { html: icon('download') }), t('export_csv')], (e) => act(e.currentTarget, async () => { const p = await call('highlights:export'); if (p) toast(`${t('saved')}: ${p}`, 'ok'); }))), listEl));
  return window.livex.on('highlights:state', (l) => { list = l; render(); });
}

// ---------------------------------------------------------------- ANALYTICS --
function bars(timeline, key, cls) {
  if (!timeline.length) return empty(t('no_data'));
  const max = Math.max(1, ...timeline.map((b) => b[key] || 0));
  const w = 600; const hgt = 120; const bw = Math.max(2, w / Math.max(timeline.length, 1) - 1);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', `chart ${cls}`); svg.setAttribute('preserveAspectRatio', 'none');
  timeline.forEach((b, i) => {
    const r = document.createElementNS(ns, 'rect'); const v = b[key] || 0; const bh = (v / max) * (hgt - 4);
    r.setAttribute('x', String(i * (w / timeline.length))); r.setAttribute('y', String(hgt - bh)); r.setAttribute('width', String(bw)); r.setAttribute('height', String(bh)); r.setAttribute('rx', '1.5');
    const tt = document.createElementNS(ns, 'title'); tt.textContent = `${t('minute')} ${b.m}: ${v}`; r.append(tt);
    svg.append(r);
  });
  return svg;
}

export async function analytics(root) {
  const wrap = h('div');
  const load = async () => {
    const { current, sessions } = await call('analytics:get');
    const s = current || sessions[0];
    const kpi = (label, v) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, v), h('div', { class: 'kpi-l' }, label));
    wrap.replaceChildren(
      card(h('div', { class: 'row between' }, h('h3', {}, current ? t('current_session') : t('last_session')),
        h('div', { class: 'row' }, current ? badge(t('live_now'), 'ok') : null,
          btn(t('start_session'), (e) => act(e.currentTarget, async () => { await call('analytics:startSession'); await load(); }), 'sm'),
          current ? btn(t('end_session'), (e) => act(e.currentTarget, async () => { await call('analytics:endSession'); await load(); }), 'sm') : null)),
      s ? [
        h('div', { class: 'muted small' }, `${fmtDate(s.startedAt)} → ${s.endedAt ? fmtDate(s.endedAt) : t('now')} · ${fmtDur((s.endedAt || Date.now()) - s.startedAt)} · ${s.platforms.join(', ')}`),
        h('div', { class: 'kpis' }, kpi(t('messages'), fmtNum(s.messages)), kpi(t('unique_chatters'), fmtNum(s.uniqueChatters)), kpi(t('gifts'), fmtNum(s.gifts)), kpi(t('follows'), fmtNum(s.follows)), kpi(t('subs'), fmtNum(s.subs)), kpi(t('likes'), fmtNum(s.likes)), kpi(t('shares'), fmtNum(s.shares)), kpi(t('peak_viewers'), s.peakViewers ? fmtNum(s.peakViewers) : '—')),
        Object.keys(s.giftValue).length ? h('div', { class: 'muted small' }, `${t('gift_value')}: ${Object.entries(s.giftValue).map(([c, v]) => `${fmtNum(Math.round(v * 100) / 100)} ${c}`).join(' · ')}`) : null,
        h('h4', {}, t('chat_per_minute')), bars(s.timeline, 'chat', 'teal'),
        h('h4', {}, t('gifts_per_minute')), bars(s.timeline, 'gifts', 'blue'),
      ] : empty(t('no_sessions'))),
      card(h('div', { class: 'row between' }, h('h3', {}, t('session_history')), btn(t('clear'), async (e) => { if (await confirmBox(t('delete_confirm'), true)) await act(e.currentTarget, async () => { await call('analytics:clear'); await load(); }); }, 'sm danger')),
        sessions.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tr', {}, ...['date', 'duration', 'platforms', 'messages', 'unique_chatters', 'gifts', 'follows', 'peak_viewers'].map((k) => h('th', {}, t(k)))),
          ...sessions.map((x) => h('tr', {}, h('td', {}, fmtDate(x.startedAt)), h('td', {}, fmtDur((x.endedAt || Date.now()) - x.startedAt)), h('td', {}, x.platforms.join(', ')), h('td', {}, fmtNum(x.messages)), h('td', {}, fmtNum(x.uniqueChatters)), h('td', {}, fmtNum(x.gifts)), h('td', {}, fmtNum(x.follows)), h('td', {}, x.peakViewers ? fmtNum(x.peakViewers) : '—'))))) : empty(t('no_sessions'))));
  };
  await load();
  root.append(h('p', { class: 'muted small' }, t('analytics_hint')), wrap);
  const iv = setInterval(() => load().catch(() => {}), 15000);
  return () => clearInterval(iv);
}
