import { t } from '../i18n.js';
import { h, call, card, badge, fmtDate, act, toast, errText, empty, confirmBox } from '../ui.js';
import { icon } from '../icons.js';

const PRODUCT = { PRO: 'LiveX PRO', TTS: 'LiveX TTS', BUNDLE: 'LiveX COMPLETE BUNDLE' };
const statusKind = (s) => ({ active: 'ok', pending_activation: 'warn', revoked: 'err' }[s] || '');

export default async function account(root, app) {
  const st = app.state; const u = st.user || {};
  const msg = h('div', { class: 'msg' });
  const codeInput = h('input', { class: 'input code-input mono', placeholder: 'LVX-XXXX-XXXX-XXXX-XXXX-XXXX', maxlength: 40, autocomplete: 'off', spellcheck: 'false' });
  codeInput.addEventListener('input', () => {
    const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^LVX/, '').slice(0, 20);
    codeInput.value = raw ? `LVX-${raw.match(/.{1,4}/g).join('-')}` : '';
  });
  const activateBtn = h('button', { class: 'btn primary' }, h('span', { html: icon('key') }), t('activate'));
  activateBtn.onclick = async () => {
    activateBtn.disabled = true; msg.className = 'msg';
    try {
      const r = await call('session:activate', codeInput.value);
      app.state = r.state;
      msg.className = 'msg show ok'; msg.textContent = `${t('activation_success')} ${PRODUCT[r.license.product] || r.license.product} — ${r.license.licenseId}`;
      codeInput.value = '';
      toast(t('activation_success'), 'ok');
      setTimeout(() => app.go('account'), 1200);
    } catch (e) { msg.className = 'msg show err'; msg.textContent = errText(e); } finally { activateBtn.disabled = false; }
  };

  const lic = st.licenses || [];
  const licList = lic.length ? lic.map((l) => h('div', { class: `license ${l.status}` },
    h('div', { class: 'license-head' }, h('div', {}, h('div', { class: 'license-name' }, PRODUCT[l.product] || l.product), h('div', { class: 'muted small' }, l.entitlements.map((e) => e.toUpperCase()).join(' + '))), badge(t(`lic_${l.status}`), statusKind(l.status))),
    h('dl', { class: 'kv' },
      h('dt', {}, t('holder')), h('dd', {}, l.holderName),
      h('dt', {}, t('user_id')), h('dd', { class: 'mono' }, l.userId),
      h('dt', {}, t('email')), h('dd', {}, l.email),
      h('dt', {}, t('license_id')), h('dd', { class: 'mono' }, l.licenseId),
      h('dt', {}, t('personal_code')), h('dd', { class: 'mono accent' }, l.personalCode),
      h('dt', {}, t('purchased')), h('dd', {}, fmtDate(l.purchasedAt)),
      h('dt', {}, t('activated')), h('dd', {}, fmtDate(l.activatedAt)),
      h('dt', {}, t('linked_device')), h('dd', {}, l.device ? `${l.device.name} · ${l.device.os} (${l.device.deviceId})` : '—'),
      l.status === 'revoked' ? [h('dt', {}, t('revoke_reason')), h('dd', { class: 'err-text' }, l.revokeReason || '—')] : null),
    l.boundToThisDevice ? h('div', { class: 'msg show ok' }, h('span', { html: icon('check', 14) }), ' ', t('bound_here')) : null,
    l.status === 'active' && !l.boundToThisDevice ? h('div', { class: 'msg show warn' },
      l.device ? t('bound_elsewhere') : t('not_bound'),
      h('div', { class: 'row' },
        !l.device ? h('button', { class: 'btn primary sm', onclick: (e) => act(e.target, async () => { app.state = await call('session:bind', l.licenseId); app.go('account'); }, t('bound_ok')) }, t('use_this_computer')) : null,
        l.device ? h('button', { class: 'btn sm', onclick: () => app.openSite('/account.html') }, h('span', { html: icon('external', 14) }), t('transfer_on_website')) : null)) : null,
    l.status === 'pending_activation' ? h('div', { class: 'msg show info' }, t('pending_hint')) : null,
  )) : [empty(t('no_licenses_yet'))];

  const devicesEl = h('div', {}, h('div', { class: 'muted' }, t('loading')));
  call('session:devices').then((list) => {
    devicesEl.replaceChildren(list.length ? h('table', { class: 'table' }, h('tr', {}, ...['device', 'os', 'license_id', 'activated', 'last_seen', 'status'].map((k) => h('th', {}, t(k)))),
      ...list.map((d) => h('tr', {}, h('td', {}, d.name, d.thisDevice ? badge(t('this_computer'), 'ok') : null, h('div', { class: 'mono muted small' }, d.deviceId)), h('td', {}, d.os), h('td', { class: 'mono' }, d.licenseId), h('td', {}, fmtDate(d.activatedAt)), h('td', {}, fmtDate(d.lastSeenAt)), h('td', {}, badge(t(`dev_${d.status}`), d.status === 'active' ? 'ok' : ''))))) : empty(t('no_devices')));
  }).catch((e) => devicesEl.replaceChildren(h('div', { class: 'msg show err' }, errText(e))));

  root.append(
    h('div', { class: 'grid g2' },
      card(t('profile'), h('dl', { class: 'kv' },
        h('dt', {}, t('full_name')), h('dd', {}, u.fullName || '—'),
        h('dt', {}, t('user_id')), h('dd', { class: 'mono accent' }, u.userId || '—'),
        h('dt', {}, t('email')), h('dd', {}, u.email || '—'),
        h('dt', {}, t('this_device')), h('dd', {}, `${st.device?.name || ''} · ${st.device?.os || ''}`)),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: (e) => act(e.target, async () => { app.state = await call('session:refresh'); app.go('account'); }, t('refreshed')) }, h('span', { html: icon('refresh') }), t('refresh_license')),
        h('button', { class: 'btn', onclick: () => app.openSite('/account.html') }, h('span', { html: icon('external') }), t('manage_on_website')))),
      card(t('activate_license'), h('p', { class: 'muted' }, t('activate_hint')), codeInput, h('div', { class: 'row' }, activateBtn, h('button', { class: 'btn ghost', onclick: () => app.openSite('/index.html#pricing') }, t('buy_on_website'))), msg)),
    h('h2', { class: 'section-title' }, t('licenses')),
    h('div', { class: 'grid g2' }, ...licList),
    card(t('devices'), devicesEl, h('p', { class: 'muted small' }, t('devices_hint'))),
    card(t('security'), h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { app.state = await call('session:logout', false); } }, h('span', { html: icon('logout') }), t('sign_out')),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox(t('sign_out_all_confirm'), true)) app.state = await call('session:logout', true); } }, t('sign_out_all')))),
  );
}
