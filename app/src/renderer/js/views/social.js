import { t } from '../i18n.js';
import { h, call, card, badge, fmtDate, act, errText, confirmBox } from '../ui.js';
import { icon } from '../icons.js';

// Social Accounts: each platform's official sign-in (OAuth) in the user's browser.
const BADGE = { youtube: 'YT', twitch: 'TW', kick: 'KI', tiktok: 'TT', discord: 'DC' };
const PF = { youtube: 'youtube', twitch: 'twitch', kick: 'kick', tiktok: 'tiktok', discord: 'discord' };
const statusBadge = (st) => ({ connected: badge(t('sa_connected'), 'ok'), connecting: badge(t('sa_connecting'), 'warn'), reconnect: badge(t('sa_reconnect_needed'), 'err'), disconnected: badge(t('sa_disconnected')) }[st]);

export default async function social(root) {
  const grid = h('div', { class: 'sa-grid' });
  const rows = {};
  const render = (v) => {
    const el = rows[v.platform] || (rows[v.platform] = h('div', { class: 'sa-card' }));
    // Platform badge is always there; the profile picture fades in on top once it loads.
    const avatar = h('div', { class: `sa-avatar sa-ph pf-badge pf-${PF[v.platform]}` }, BADGE[v.platform],
      v.account?.avatar ? h('img', { src: v.account.avatar, alt: '', referrerpolicy: 'no-referrer', onload: (e) => e.target.classList.add('ready'), onerror: (e) => e.target.remove() }) : null);
    const busy = v.status === 'connecting';
    const btn = (label, ic, kind, fn) => h('button', { class: `btn sm ${kind}`, onclick: (e) => act(e.currentTarget, fn) }, h('span', { html: icon(ic, 14) }), label);
    el.replaceChildren(
      h('div', { class: 'sa-head' }, avatar,
        h('div', { class: 'grow' }, h('div', { class: 'sa-name' }, v.account?.name || t('sa_no_account')), h('div', { class: 'muted small' }, v.label)),
        statusBadge(v.status)),
      h('dl', { class: 'kv small' },
        h('dt', {}, t('sa_last_connected')), h('dd', {}, v.connectedAt ? fmtDate(v.connectedAt) : '—'),
        v.lastRefreshAt ? [h('dt', {}, t('sa_last_refresh')), h('dd', {}, fmtDate(v.lastRefreshAt))] : null),
      v.platform === 'tiktok' ? h('div', { class: 'muted small' }, t('sa_tiktok_note')) : null,
      v.configured === false ? h('div', { class: 'msg show warn' }, t('sa_not_configured')) : null,
      v.error && !busy ? h('div', { class: 'msg show err' }, t(`sa_err_${v.error}`) !== `sa_err_${v.error}` ? t(`sa_err_${v.error}`) : errText({ code: v.error, message: v.error })) : null,
      busy ? h('div', { class: 'msg show info' }, h('span', { class: 'eq' }, h('i'), h('i'), h('i')), ' ', t('sa_waiting_browser')) : null,
      h('div', { class: 'row' },
        busy ? btn(t('cancel'), 'x', '', async () => render(await call('social:cancel', v.platform))) : null,
        !busy && v.status === 'disconnected' ? btn(t('connect'), 'plug', 'primary', async () => render(await call('social:connect', v.platform))) : null,
        !busy && v.status !== 'disconnected' ? btn(t('sa_reconnect'), 'refresh', v.status === 'reconnect' ? 'primary' : '', async () => render(await call('social:reconnect', v.platform))) : null,
        !busy && v.status !== 'disconnected' ? btn(t('disconnect'), 'logout', 'danger', async () => { if (await confirmBox(t('sa_disconnect_confirm'), true)) render(await call('social:disconnect', v.platform)); }) : null),
    );
    return el;
  };
  const list = await call('social:list');
  grid.replaceChildren(...list.map(render));
  root.append(
    h('div', { class: 'msg show info' }, h('span', { html: icon('shield', 15) }), ' ', t('sa_intro')),
    card(t('nav_social'), grid),
  );
  // Updates come from main-process events, the background poll in app.js, and a
  // refresh when the user comes back from the browser window.
  const onPoll = (e) => render(e.detail);
  const onFocus = async () => { try { (await call('social:list')).forEach(render); } catch { /* signed out */ } };
  window.addEventListener('livex:social', onPoll); window.addEventListener('focus', onFocus);
  const off = window.livex.on('social:changed', (v) => render(v));
  return () => { off(); window.removeEventListener('livex:social', onPoll); window.removeEventListener('focus', onFocus); };
}
