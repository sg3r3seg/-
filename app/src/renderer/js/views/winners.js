import { t } from '../i18n.js';
import { h, call, card, badge, empty, act, fmtDate, confirmBox, toastErr } from '../ui.js';
import { icon } from '../icons.js';

// Private chats with giveaway winners. Only names and status are shown here; the
// conversation itself opens in a separate window that is hidden from screen capture.
const PLAT = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', tiktok: 'TikTok' };
export default async function winners(root) {
  const listEl = h('div', { class: 'stack' });
  const statusBadge = (r) => (r.status === 'verified' ? badge(`✓ ${t('wc_verified')}`, 'ok') : r.status === 'closed' ? badge(t('wc_closed')) : badge(t('wc_waiting'), 'warn'));
  async function load() {
    let rooms;
    try { rooms = await call('winner:list'); } catch (e) { listEl.replaceChildren(h('div', { class: 'msg show err' }, e.message)); return; }
    if (!rooms.length) { listEl.replaceChildren(empty(t('wc_none'))); return; }
    listEl.replaceChildren(...rooms.map((r) => h('div', { class: `wr-row ${r.status}` },
      h('div', { class: `sa-avatar sa-ph pf-badge pf-${r.platform}` }, (PLAT[r.platform] || '?').slice(0, 2).toUpperCase()),
      h('div', { class: 'grow' },
        h('div', { class: 'row' }, h('b', {}, h('bdi', {}, r.winnerName)), statusBadge(r), r.unread ? badge(`${r.unread} ${t('wc_new')}`, 'ok') : null),
        h('div', { class: 'muted small' }, h('bdi', {}, r.title), ` · ${PLAT[r.platform] || r.platform} · ${fmtDate(r.createdAt)}`)),
      r.status !== 'closed' ? h('button', { class: 'btn sm primary', onclick: (e) => act(e.currentTarget, () => call('winner:open', r.roomId)) }, h('span', { html: icon('chat', 14) }), t('wc_open')) : null,
      r.status !== 'closed' ? h('button', { class: 'btn sm danger', onclick: async (e) => { if (await confirmBox(t('wc_close_confirm'), true)) { await act(e.currentTarget, () => call('winner:close', r.roomId)); load(); } } }, t('wc_close')) : null)));
  }
  root.append(
    h('div', { class: 'msg show info' }, h('span', { html: icon('lock', 15) }), ' ', t('wc_intro')),
    card(t('nav_winners'), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, load) }, h('span', { html: icon('refresh', 14) }), t('refresh'))), listEl),
  );
  await load();
  const iv = setInterval(load, 10_000);
  const off = window.livex.on('winners:changed', load);
  return () => { clearInterval(iv); off(); void toastErr; };
}
