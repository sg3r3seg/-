import { t } from '../i18n.js';
import { h, call, card, badge, toggle, act, fmtDate, toastErr } from '../ui.js';
import { icon } from '../icons.js';

// Built-in automations: ship with LiveX and are locked (cannot be deleted or edited).
// The creator can switch each one on/off and preview the exact message.
export default async function automations(root) {
  const grid = h('div', { class: 'au-grid' });
  const render = (list) => grid.replaceChildren(...list.map((a) => h('div', { class: `au-card ${a.enabled ? 'on' : ''}` },
    h('div', { class: 'au-head' },
      h('div', { class: 'au-ic', html: icon(a.icon, 20) }),
      h('div', { class: 'grow' }, h('div', { class: 'au-name' }, a.name), h('div', { class: 'row au-tags' }, badge(`🔒 ${t('au_locked')}`, 'lock'), badge(t('au_builtin')))),
      toggle(a.enabled, async (v) => { try { render(await call('automations:setEnabled', a.id, v)); } catch (e) { toastErr(e); render(await call('automations:list')); } }, a.enabled ? t('on') : t('off'))),
    h('p', { class: 'muted small' }, a.desc),
    h('div', { class: 'au-text' }, h('span', { class: 'muted small' }, t('au_message')), h('div', { class: 'au-quote' }, a.text)),
    h('div', { class: 'row between' },
      h('span', { class: 'muted small' }, a.stats.count ? `${t('au_ran')} ${a.stats.count}× · ${fmtDate(a.stats.lastAt)}` : t('au_never')),
      h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, () => call('automations:preview', a.id), t('au_preview_done')) }, h('span', { html: icon('play', 13) }), t('au_preview'))))));
  render(await call('automations:list'));
  root.append(
    h('div', { class: 'msg show info' }, h('span', { html: icon('lock', 15) }), ' ', t('au_intro')),
    card(t('nav_automations'), grid),
  );
  return window.livex.on('automations:state', render);
}
