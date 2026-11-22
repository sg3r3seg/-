import { t } from '../i18n.js';
import { h, call, card, badge, fmtNum, fmtTime, stateBadge, empty } from '../ui.js';
import { icon } from '../icons.js';
import { VIEWS } from './index.js';

const TYPE_ICON = { chat: 'bot', gift: 'gift', follow: 'users', sub: 'star', like: 'star', share: 'external', superchat: 'gift', bits: 'gift', raid: 'users', join: 'users', bot: 'bot', macro: 'zap', highlight: 'star', giveaway: 'gift', wheel: 'wheel', timer: 'timer', challenge: 'trophy', schedule: 'calendar', session: 'chart' };

export function eventLine(e) {
  const who = e.user?.name ? h('b', {}, e.user.name) : null;
  let text;
  switch (e.type) {
    case 'chat': text = e.text; break;
    case 'gift': text = `${t('ev_gift')} ${e.gift || ''}${e.count > 1 ? ` x${e.count}` : ''}`; break;
    case 'follow': text = t('ev_follow'); break;
    case 'sub': text = t('ev_sub'); break;
    case 'like': text = `${t('ev_like')} ${e.count ? `x${e.count}` : ''}`; break;
    case 'share': text = t('ev_share'); break;
    case 'superchat': case 'bits': text = `${e.amount} ${e.currency || ''} ${e.text ? `— ${e.text}` : ''}`; break;
    case 'raid': text = `${t('ev_raid')} ${e.count || ''}`; break;
    case 'join': text = t('ev_join'); break;
    default: text = e.text || e.type;
  }
  return h('div', { class: 'feed-item' }, h('span', { class: `feed-icon t-${e.type || e.kind}`, html: icon(TYPE_ICON[e.type || e.kind] || 'zap', 15) }),
    h('span', { class: 'feed-pf' }, e.platform || e.kind || ''), h('span', { class: 'feed-text' }, who, who ? ' ' : '', text), h('span', { class: 'feed-time' }, fmtTime(e.ts)));
}

export default async function dashboard(root, app) {
  const st = app.state;
  const user = st.user || {};
  const statuses = await call('platforms:list').catch(() => []);
  for (const s of statuses) app.platformStatus[s.platform] = s;
  const viewersEl = h('div', { class: 'stat-value' }, '—');
  const viewersSub = h('div', { class: 'stat-sub' });
  const liveEl = h('div', { class: 'stat-value' }, '—');
  const platEl = h('div', { class: 'plat-list' });

  function renderPlatforms() {
    const list = Object.values(app.platformStatus).filter((p) => p.platform !== 'discord');
    platEl.replaceChildren(...list.map((p) => h('div', { class: 'plat-row' }, h('span', { class: `pf-dot pf-${p.platform}` }), h('span', { class: 'grow' }, p.label), stateBadge(p.state))));
    const withViewers = list.filter((p) => p.state === 'connected' && typeof p.viewers === 'number');
    viewersEl.textContent = withViewers.length ? fmtNum(withViewers.reduce((a, p) => a + p.viewers, 0)) : '—';
    viewersSub.textContent = withViewers.length ? withViewers.map((p) => `${p.label}: ${fmtNum(p.viewers)}`).join(' · ') : t('viewers_not_provided');
    const live = list.filter((p) => p.live === true);
    const connected = list.filter((p) => p.state === 'connected');
    liveEl.textContent = live.length ? t('live_now') : connected.length ? t('connected_waiting') : t('offline_stream');
    liveEl.className = `stat-value ${live.length ? 'live' : ''}`;
  }
  renderPlatforms();

  const feed = h('div', { class: 'feed' });
  const activity = await call('activity:recent').catch(() => []);
  if (activity.length) feed.append(...activity.slice(0, 40).map(eventLine)); else feed.append(empty(t('no_activity')));

  const lic = st.entitlements.length ? st.entitlements.map((e) => e.toUpperCase()).join(' + ') : t('no_license');
  root.append(
    h('div', { class: 'hero-card' },
      h('div', {}, h('div', { class: 'hello' }, `${t('hello')}, ${user.firstName || user.fullName || ''}`), h('div', { class: 'muted' }, t('dashboard_sub'))),
      h('div', { class: 'hero-ids' }, h('div', {}, h('span', { class: 'muted small' }, t('user_id')), h('div', { class: 'mono' }, user.userId || '—')))),
    h('div', { class: 'stats' },
      stat('wifi', t('connection_status'), st.offline ? t('offline') : t('online'), st.offline ? t('offline_mode_short') : app.info?.apiBase, st.offline ? 'warn' : 'ok'),
      stat('key', t('license_status'), lic, st.lease?.expiresAt ? `${t('verified_until')} ${new Date(st.lease.expiresAt).toLocaleString()}` : '', st.entitlements.length ? 'ok' : 'err'),
      h('div', { class: 'stat' }, h('div', { class: 'stat-head', html: `${icon('monitor', 16)}<span>${t('broadcast_status')}</span>` }), liveEl, h('div', { class: 'stat-sub' }, t('broadcast_hint'))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-head', html: `${icon('users', 16)}<span>${t('viewers_live')}</span>` }), viewersEl, viewersSub)),
    h('div', { class: 'grid g3-1' },
      card(h('div', { class: 'row between' }, h('h3', {}, t('recent_activity')), badge(t('live_feed'), 'ok')), feed),
      h('div', { class: 'stack' },
        card(h('div', { class: 'row between' }, h('h3', {}, t('platforms')), h('button', { class: 'btn sm', onclick: () => app.go('connections') }, t('manage'))), platEl),
        card(t('shortcuts'), h('div', { class: 'shortcuts' }, ...VIEWS.filter((v) => !['dashboard'].includes(v.id)).map((v) => h('button', { class: `shortcut ${v.ent && !app.has(v.ent) ? 'locked' : ''}`, onclick: () => app.go(v.id) }, h('span', { html: icon(v.icon, 20) }), h('span', {}, t(v.title)))))))),
  );

  const offEv = window.livex.on('event', (e) => {
    if (e.type === 'viewers') return;
    feed.querySelector('.empty')?.remove();
    feed.prepend(eventLine(e));
    while (feed.children.length > 60) feed.lastChild.remove();
  });
  const offAct = window.livex.on('activity', (a) => { feed.querySelector('.empty')?.remove(); feed.prepend(eventLine({ ...a, text: a.text + (a.note ? ` (${a.note})` : '') })); });
  const offSt = window.livex.on('platform:status', () => renderPlatforms());
  return () => { offEv(); offAct(); offSt(); };
}

function stat(ic, label, value, sub, kind) {
  return h('div', { class: `stat ${kind || ''}` }, h('div', { class: 'stat-head', html: `${icon(ic, 16)}<span>${label}</span>` }), h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-sub' }, sub || ''));
}
