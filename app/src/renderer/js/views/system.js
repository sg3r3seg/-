import { t, setLang } from '../i18n.js';
import { h, call, card, field, input, select, toggle, act, btn, badge, fmtNum, fmtDur, fmtTime, toast, empty } from '../ui.js';
import { icon } from '../icons.js';
import { outputDevices } from './tts.js';

// -------------------------------------------------------------- PERFORMANCE --
export async function performance(root) {
  const wrap = h('div');
  const history = [];
  const gauge = (label, pct, sub) => h('div', { class: 'gauge' }, h('div', { class: 'gauge-ring', style: { '--p': `${Math.min(100, pct)}` } }, h('span', {}, `${Math.round(pct)}%`)), h('div', { class: 'gauge-l' }, label), h('div', { class: 'muted small' }, sub || ''));
  const load = async () => {
    const p = await call('perf:get');
    history.push(p.systemCpu); if (history.length > 60) history.shift();
    const memUsed = ((p.memTotal - p.memFree) / p.memTotal) * 100;
    const epm = p.eventsPerMinute.length ? p.eventsPerMinute[p.eventsPerMinute.length - 1].n : 0;
    wrap.replaceChildren(
      h('div', { class: 'grid g4' }, gauge(t('system_cpu'), p.systemCpu), gauge(t('system_memory'), memUsed, `${fmtNum(Math.round((p.memTotal - p.memFree) / 1048576))} / ${fmtNum(Math.round(p.memTotal / 1048576))} MB`),
        h('div', { class: 'stat' }, h('div', { class: 'stat-head' }, t('app_usage')), h('div', { class: 'stat-value' }, `${p.appCpu}%`), h('div', { class: 'stat-sub' }, `${fmtNum(p.appMemMB)} MB · ${p.processes} ${t('processes')}`)),
        h('div', { class: 'stat' }, h('div', { class: 'stat-head' }, t('events')), h('div', { class: 'stat-value' }, fmtNum(epm)), h('div', { class: 'stat-sub' }, `${t('per_minute')} · ${fmtNum(p.eventsTotal)} ${t('total')} · ${t('uptime')} ${fmtDur(p.uptimeSec * 1000)}`))),
      card(t('cpu_history'), spark(history)),
      h('div', { class: 'grid g2' },
        card(t('platforms'), ...p.platforms.map((x) => h('div', { class: 'plat-row' }, h('span', { class: `pf-dot pf-${x.platform}` }), h('span', { class: 'grow' }, x.platform), badge(t(`state_${x.state}`), x.state === 'connected' ? 'ok' : ''), h('span', { class: 'muted small' }, x.lastEventAt ? fmtTime(x.lastEventAt) : '—')))),
        card(t('overlay_clients'), ...Object.entries(p.overlayClients).map(([r, n]) => h('div', { class: 'plat-row' }, h('span', { class: 'grow mono' }, `/${r}`), badge(String(n), n ? 'ok' : ''))))));
  };
  await load();
  root.append(wrap);
  const iv = setInterval(() => load().catch(() => {}), 2000);
  return () => clearInterval(iv);
}
function spark(values) {
  const ns = 'http://www.w3.org/2000/svg'; const w = 600; const hh = 80;
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hh}`); svg.setAttribute('class', 'chart spark'); svg.setAttribute('preserveAspectRatio', 'none');
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${hh - (v / 100) * (hh - 4) - 2}`).join(' ');
  const pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', pts); svg.append(pl);
  return svg;
}

// -------------------------------------------------------------- DIAGNOSTICS --
export async function diagnostics(root, app) {
  const results = h('div', { class: 'stack sm' });
  const logsEl = h('pre', { class: 'logs' });
  const run = async () => {
    results.replaceChildren(h('div', { class: 'muted' }, t('running_checks')));
    const r = await call('diag:run');
    results.replaceChildren(h('div', { class: 'muted small' }, `LiveX v${r.version} · ${r.os}`), ...r.checks.map((c) => h('div', { class: `check ${c.ok ? 'ok' : 'bad'}` }, h('span', { html: icon(c.ok ? 'check' : 'x', 16) }), h('b', {}, t(`diag_${c.id.split(':')[0]}`), c.id.includes(':') ? ` · ${c.id.split(':')[1]}` : ''), h('span', { class: 'muted small grow' }, c.detail))));
    // audio devices (renderer side)
    const devs = await outputDevices();
    results.append(h('div', { class: 'check ok' }, h('span', { html: icon('music', 16) }), h('b', {}, t('diag_audio')), h('span', { class: 'muted small grow' }, devs.map((d) => d.label).join(', '))));
  };
  const loadLogs = async () => { const l = await call('diag:logs'); logsEl.textContent = l.map((x) => `${new Date(x.ts).toLocaleTimeString()} [${x.level}] ${x.source}: ${x.message}`).join('\n') || '—'; logsEl.scrollTop = logsEl.scrollHeight; };
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('system_checks')), btn([h('span', { html: icon('refresh') }), t('run_checks')], (e) => act(e.currentTarget, run), 'primary')), results),
    card(h('div', { class: 'row between' }, h('h3', {}, t('logs')), h('div', { class: 'row' }, btn(t('refresh'), (e) => act(e.currentTarget, loadLogs), 'sm'), btn([h('span', { html: icon('download', 14) }), t('export')], (e) => act(e.currentTarget, async () => { const p = await call('diag:exportLogs'); if (p) toast(`${t('saved')}: ${p}`, 'ok'); }), 'sm'))), logsEl));
  await Promise.all([run().catch((e) => results.replaceChildren(empty(e.message))), loadLogs()]);
  const off = window.livex.on('log', () => loadLogs().catch(() => {}));
  void app;
  return off;
}

// ----------------------------------------------------------------- SETTINGS --
export async function settings(root, app) {
  const s = await call('settings:get');
  const save = async (patch) => { try { app.settings = await call('settings:set', patch); return app.settings; } catch (e) { toast(e.message, 'err'); return null; } };
  const devices = await outputDevices();
  const hk = (app.has('pro') || app.has('tts')) ? await call('hotkeys:get').catch(() => null) : null;
  const upd = h('div');
  const renderUpdate = (u) => {
    upd.replaceChildren(h('div', { class: 'row' }, badge(`${t('current_version')} v${app.info.version}`),
      u.phase === 'up-to-date' ? badge(t('up_to_date'), 'ok') : null,
      u.phase === 'available' ? badge(`${t('update_available')} v${u.version}`, 'warn') : null,
      u.phase === 'downloading' ? badge(`${t('downloading')} ${u.progress || 0}%`, 'warn') : null,
      u.phase === 'ready' ? badge(`${t('update_verified')}${u.authenticode && u.authenticode !== 'Valid' ? ` · Authenticode: ${u.authenticode}` : ''}`, 'ok') : null,
      u.phase === 'error' ? badge(u.error, 'err') : null),
    u.notes ? h('p', { class: 'muted small' }, u.notes) : null,
    h('div', { class: 'row' },
      btn([h('span', { html: icon('refresh') }), t('check_updates')], (e) => act(e.currentTarget, async () => renderUpdate(await call('update:check')))),
      u.phase === 'available' ? btn([h('span', { html: icon('download') }), t('download_update')], (e) => act(e.currentTarget, async () => renderUpdate(await call('update:download'))), 'primary') : null,
      u.phase === 'ready' ? btn(t('install_restart'), (e) => act(e.currentTarget, () => call('update:install')), 'primary') : null));
  };
  renderUpdate(await call('update:state'));
  const offU = window.livex.on('update:state', renderUpdate);

  const hl = hk ? input({ value: hk.highlight || '', class: 'input mono' }) : null;
  const skip = hk ? input({ value: hk.ttsSkip || '', class: 'input mono' }) : null;
  root.append(
    h('div', { class: 'grid g2' },
      card(t('appearance'),
        field(t('language'), select([{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }], s.language, { onchange: async (e) => { await save({ language: e.target.value }); setLang(e.target.value); document.documentElement.dir = e.target.value === 'he' ? 'rtl' : 'ltr'; document.documentElement.lang = e.target.value; window.__livexRoute?.(); } })),
        field(t('theme'), select([{ value: 'navy', label: t('theme_navy') }, { value: 'midnight', label: t('theme_midnight') }, { value: 'oled', label: t('theme_oled') }], s.theme, { onchange: async (e) => { await save({ theme: e.target.value }); document.documentElement.dataset.theme = e.target.value; } }))),
      card(t('notifications_audio'),
        toggle(s.notifications, (v) => save({ notifications: v }), t('desktop_notifications')),
        toggle(s.minimizeToTray, (v) => save({ minimizeToTray: v }), t('minimize_to_tray')),
        field(t('sound_output'), select(devices, s.outputDeviceId, { onchange: (e) => save({ outputDeviceId: e.target.value }) }), t('sound_output_hint')),
        app.has('tts') ? btn([h('span', { html: icon('mic', 14) }), t('tts_settings')], () => app.go('tts'), 'sm') : null)),
    h('div', { class: 'grid g2' },
      card(t('account_settings'), h('dl', { class: 'kv' }, h('dt', {}, t('full_name')), h('dd', {}, app.state.user?.fullName || ''), h('dt', {}, t('user_id')), h('dd', { class: 'mono' }, app.state.user?.userId || ''), h('dt', {}, t('email')), h('dd', {}, app.state.user?.email || '')),
        h('div', { class: 'row' }, btn([h('span', { html: icon('external', 14) }), t('edit_on_website')], () => app.openSite('/account.html'), 'sm'), btn(t('change_password'), () => app.openSite('/forgot.html'), 'sm'))),
      card(t('security_devices'), h('p', { class: 'muted small' }, t('security_hint')),
        h('div', { class: 'row' }, btn([h('span', { html: icon('monitor', 14) }), t('manage_devices')], () => app.go('account'), 'sm'),
          btn([h('span', { html: icon('shield', 14) }), t('sign_out_all')], async () => { app.state = await call('session:logout', true); }, 'sm danger')))),
    h('div', { class: 'grid g2' },
      card(t('hotkeys'), hk ? [field(t('hotkey_highlight'), hl), field(t('hotkey_tts_skip'), skip), h('div', { class: 'muted small' }, `${t('hotkeys_registered')}: ${hk.registered.join(', ') || '—'}`),
        btn(t('save'), (e) => act(e.currentTarget, () => save({ hotkeys: { highlight: hl.value, ttsSkip: skip.value } }), t('saved')), 'sm primary')] : h('p', { class: 'muted' }, t('requires_license')),
      ),
      card(t('advanced'),
        field(t('overlay_port'), input({ type: 'number', min: 1024, max: 65535, value: s.overlayPort, onchange: (e) => save({ overlayPort: e.target.value }) })),
        field(t('remote_port'), input({ type: 'number', min: 1024, max: 65535, value: s.remotePort, onchange: (e) => save({ remotePort: e.target.value }) })),
        h('div', { class: 'muted small' }, `${t('server_label')} ${app.info.apiBase}`))),
    card(t('updates'), toggle(s.autoUpdateCheck, (v) => save({ autoUpdateCheck: v }), t('auto_check_updates')), upd),
    card(t('sign_out'), h('div', { class: 'row' }, btn([h('span', { html: icon('logout') }), t('sign_out')], async () => { app.state = await call('session:logout', false); }, 'danger'))),
  );
  return offU;
}
