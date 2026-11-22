import { t } from '../i18n.js';
import { h, call, card, field, input, select, act, btn, badge, copy, fmtTime, confirmBox, empty, toggle } from '../ui.js';
import { icon } from '../icons.js';

const FONTS = ['Segoe UI', 'Heebo', 'Arial', 'Impact', 'Consolas', 'Georgia', 'Trebuchet MS'];

// ----------------------------------------------------------- OVERLAY EDITOR --
export async function overlayEditor(root) {
  const info = await call('overlay:info');
  if (!info.running) { root.append(card(t('nav_overlay_editor'), h('div', { class: 'msg show err' }, t('overlay_not_running')))); return undefined; }
  const routes = info.routes.filter((r) => r.allowed);
  let current = routes[0]?.route;
  const form = h('div'); const frameWrap = h('div', { class: 'preview' });
  function load(route) {
    current = route;
    const st = { accent: '#22e4d9', text: '#ffffff', background: 'rgba(5,10,20,0.82)', fontSize: 28, font: 'Segoe UI', align: 'center', maxMessages: 12, ...(info.styles[route] || {}) };
    const els = {
      accent: input({ type: 'color', value: st.accent, class: 'color' }), text: input({ type: 'color', value: st.text, class: 'color' }),
      background: input({ value: st.background }), fontSize: input({ type: 'number', min: 10, max: 120, value: st.fontSize }),
      font: select(FONTS.map((f) => ({ value: f, label: f })), st.font), align: select(['start', 'center', 'end'].map((a) => ({ value: a, label: t(`align_${a}`) })), st.align),
      position: select(['top', 'middle', 'bottom'].map((a) => ({ value: a, label: t(`pos_${a}`) })), st.position || ({ alerts: 'top', chat: 'bottom', tts: 'bottom', timer: 'top', giveaway: 'top', 'follower-goal': 'top' }[route] || 'middle')),
    };
    if (route === 'chat') els.maxMessages = input({ type: 'number', min: 1, max: 50, value: st.maxMessages });
    const values = () => Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.type === 'number' ? +el.value : el.value]));
    form.replaceChildren(
      h('div', { class: 'grid g3' }, ...Object.entries(els).map(([k, el]) => field(t(`style_${k}`), el))),
      h('div', { class: 'row' }, btn([h('span', { html: icon('check') }), t('apply_live')], (e) => act(e.currentTarget, async () => { info.styles[route] = await call('overlay:setStyle', route, values()); }, t('saved')), 'primary'),
        route === 'alerts' ? btn(t('send_test_alert'), (e) => act(e.currentTarget, () => call('alerts:test', 'follow'))) : null));
    const url = info.routes.find((r) => r.route === route).url;
    frameWrap.replaceChildren(h('iframe', { src: url, class: 'preview-frame', sandbox: 'allow-scripts allow-same-origin' }));
    frameWrap.style.setProperty('--s', String(frameWrap.clientWidth / 1920 || 0.45));
    tabs.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.r === route));
  }
  const tabs = h('div', { class: 'tabs wrap' }, ...routes.map((r) => h('button', { class: 'tab', 'data-r': r.route, onclick: () => load(r.route) }, `/${r.route}`)));
  root.append(card(t('nav_overlay_editor'), tabs, form), card(t('live_preview'), h('p', { class: 'muted small' }, t('preview_hint')), frameWrap));
  if (current) load(current);
  const ro = new ResizeObserver(() => frameWrap.style.setProperty('--s', String(frameWrap.clientWidth / 1920 || 0.45)));
  ro.observe(frameWrap);
  return () => ro.disconnect();
}

// ----------------------------------------------------------- OVERLAY CENTER --
export async function overlayCenter(root, app) {
  if (!app.has('pro') && !app.has('tts')) { root.append(card(t('nav_overlay_center'), h('p', { class: 'muted' }, t('connections_need_license')))); return undefined; }
  let info = await call('overlay:info');
  const results = {};
  const list = h('div', { class: 'stack' });
  const render = () => {
    if (!info.running) { list.replaceChildren(h('div', { class: 'msg show err' }, t('overlay_not_running'))); return; }
    list.replaceChildren(...info.routes.map((r) => {
      const res = results[r.route];
      const verified = res?.ok && !info.disabled.includes(r.route);
      return h('div', { class: `overlay-row ${r.allowed ? '' : 'locked'}` },
        h('div', { class: 'ov-name' }, h('b', {}, `/${r.route}`), h('div', { class: 'muted small' }, t(`ov_${r.route.replace('-', '_')}`))),
        h('div', { class: 'ov-url mono' }, r.allowed ? (verified ? r.url : t('verify_first')) : t('requires_license')),
        h('div', { class: 'row' },
          r.allowed ? toggle(!info.disabled.includes(r.route), async (v) => { info.disabled = await call('overlay:setEnabled', r.route, v); await verify(); }, '') : null,
          info.disabled.includes(r.route) ? badge(t('overlay_off'), 'warn') : !r.allowed ? badge(t('locked'), '') : res ? badge(verified ? `${t('verified')} ${fmtTime(res.checkedAt)}` : t('check_failed'), verified ? 'ok' : 'err') : badge(t('not_checked')),
          btn([h('span', { html: icon('eye', 14) }), t('preview')], () => call('overlay:openPreview', r.route), 'sm', { disabled: !(r.allowed && verified) }),
          badge(`${info.clients[r.route] || 0} ${t('clients')}`),
          btn([h('span', { html: icon('copy', 14) }), t('copy')], () => copy(r.url), 'sm', { disabled: !(r.allowed && verified) })));
    }));
  };
  const verify = async () => { const v = await call('overlay:verify'); for (const x of v) results[x.route] = x; info = await call('overlay:info'); render(); return v; };
  render();
  if (info.running) await verify().catch(() => {});
  root.append(card(h('div', { class: 'row between' }, h('h3', {}, t('nav_overlay_center')),
    h('div', { class: 'row' },
      btn([h('span', { html: icon('refresh') }), t('verify_all')], (e) => act(e.currentTarget, verify, t('verified'))),
      app.has('pro') ? btn(t('regenerate_key'), async (e) => { if (await confirmBox(t('regenerate_key_confirm'), true)) await act(e.currentTarget, async () => { await call('overlay:regenerateKey'); info = await call('overlay:info'); await verify(); }, t('saved')); }, 'danger') : null)),
  h('p', { class: 'muted small' }, t('overlay_center_hint')),
  h('div', { class: 'msg show info' }, t('local_only_note')),
  list,
  info.running ? null : empty('')));
  const iv = setInterval(async () => { try { info = await call('overlay:info'); render(); } catch { /* ignore */ } }, 5000);
  return () => clearInterval(iv);
}
