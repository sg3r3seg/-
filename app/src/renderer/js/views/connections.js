import { t } from '../i18n.js';
import { h, call, card, badge, stateBadge, field, input, act, toast, fmtTime, errText } from '../ui.js';
import { icon } from '../icons.js';

// Per-platform connection forms. Status shown is the connector's real state.
const DEFS = {
  tiktok: { fields: [['providerUrl', 'tiktok_provider_url', 'ws://127.0.0.1:21213/'], ['username', 'tiktok_username', '@username']], help: 'tiktok_help' },
  youtube: { fields: [['apiKey', 'youtube_api_key', 'AIza…', 'password'], ['videoOrChannel', 'youtube_target', 'https://youtube.com/watch?v=… / UC…']], help: 'youtube_help' },
  kick: { fields: [['channel', 'kick_channel', 'channel'], ['chatroomId', 'kick_chatroom', '']], help: 'kick_help' },
  twitch: { fields: [['channel', 'twitch_channel', 'channel'], ['username', 'twitch_username', ''], ['oauthToken', 'twitch_token', 'oauth:…', 'password']], help: 'twitch_help' },
  discord: { fields: [['webhookUrl', 'discord_webhook', 'https://discord.com/api/webhooks/…', 'password']], help: 'discord_help', ent: 'pro' },
};

export default async function connections(root, app) {
  if (!app.has('pro') && !app.has('tts')) {
    root.append(card(t('nav_connections'), h('p', { class: 'muted' }, t('connections_need_license')), h('button', { class: 'btn primary', onclick: () => app.go('account') }, t('enter_activation_code'))));
    return undefined;
  }
  const list = await call('platforms:list');
  let soc = {}; try { soc = Object.fromEntries((await call('social:list')).map((x) => [x.platform, x])); } catch { /* not signed in */ }
  root.append(h('div', { class: 'msg show info row between' }, h('span', {}, h('span', { html: icon('globe', 15) }), ' ', t('conn_use_social')),
    h('button', { class: 'btn sm primary', onclick: () => app.go('social') }, t('nav_social'))));
  const cards = {};
  for (const p of list) {
    const def = DEFS[p.platform];
    const inputs = {};
    const statusEl = h('div', { class: 'conn-status' });
    const render = (s) => {
      statusEl.replaceChildren(stateBadge(s.state), h('span', { class: 'muted small' }, s.detail || ''),
        s.unofficial ? badge(t('unofficial'), 'warn') : null,
        s.state === 'connected' ? h('span', { class: 'muted small' }, `${t('last_event')}: ${s.lastEventAt ? fmtTime(s.lastEventAt) : t('none_yet')}`) : null,
        typeof s.viewers === 'number' ? badge(`${t('viewers')}: ${s.viewers}`, 'ok') : null,
        s.canWrite ? badge(t('can_write'), 'ok') : null);
    };
    render(p);
    const locked = def.ent && !app.has(def.ent);
    const form = h('div', { class: 'grid g2' }, ...def.fields.map(([k, label, ph, type]) => {
      inputs[k] = input({ placeholder: ph, type: type || 'text', value: p.saved?.[k] || '', autocomplete: 'off', spellcheck: 'false' });
      return field(t(label), inputs[k]);
    }));
    const values = () => Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
    const connectBtn = h('button', { class: 'btn primary', disabled: locked }, h('span', { html: icon('plug') }), t('connect'));
    connectBtn.onclick = () => act(connectBtn, async () => { const s = await call('platforms:connect', p.platform, values()); render(s); });
    cards[p.platform] = { render };
    root.append(card(
      h('div', { class: 'row between' }, h('div', { class: 'row' }, h('span', { class: `pf-badge pf-${p.platform}` }, p.label.slice(0, 2).toUpperCase()), h('h3', {}, p.label)), statusEl),
      soc[p.platform]?.status === 'connected' ? h('div', { class: 'msg show ok' }, `${t('conn_signed_in_as')} ${soc[p.platform].account?.name || ''} — ${t('conn_fields_optional')}`) : null,
      h('p', { class: 'muted small' }, t(def.help)),
      locked ? h('div', { class: 'msg show warn' }, t('requires_pro')) : form,
      locked ? null : h('div', { class: 'row' }, connectBtn,
        h('button', { class: 'btn', onclick: (e) => act(e.target, async () => render(await call('platforms:disconnect', p.platform))) }, t('disconnect')),
        p.platform === 'discord' ? h('button', { class: 'btn', onclick: (e) => act(e.target, () => call('platforms:discordTest'), t('discord_test_sent')) }, t('send_test_message')) : null,
        h('button', { class: 'btn ghost', onclick: (e) => act(e.target, async () => { await call('platforms:forget', p.platform); Object.values(inputs).forEach((i) => { i.value = ''; }); }, t('credentials_removed')) }, h('span', { html: icon('trash') }), t('forget'))),
    ));
  }
  const off = window.livex.on('platform:status', (s) => cards[s.platform]?.render(s));
  void toast; void errText;
  return off;
}
