import { t, setLang } from './i18n.js';
import { h, call, toastErr, confirmBox, fmtTime } from './ui.js';
import { icon } from './icons.js';

// Private chat with a giveaway winner. Runs in its own window, which the main process
// marks as protected from screen capture (not visible in OBS / screen sharing).
const q = new URLSearchParams(location.search);
const roomId = q.get('room') || '';
setLang(q.get('lang') === 'he' ? 'he' : 'en');
document.documentElement.lang = q.get('lang') === 'he' ? 'he' : 'en';
document.documentElement.dir = q.get('lang') === 'he' ? 'rtl' : 'ltr';

const root = document.getElementById('root');
const head = h('div', { class: 'wc-head' });
const banner = h('div', { class: 'wc-banner' }, h('span', { html: icon('lock', 14) }), ' ', t('wc_hidden_note'));
const list = h('div', { class: 'wc-msgs' });
const input = h('textarea', { rows: 2, maxlength: 1000, placeholder: t('wc_placeholder') });
const sendBtn = h('button', { class: 'btn primary', type: 'submit' }, t('wc_send'));
const form = h('form', { class: 'wc-form' }, input, sendBtn);
root.append(head, banner, list, form);

let room = null; let lastId = 0; const seen = new Set(); let timer = null;
const PLAT = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', tiktok: 'TikTok' };

function renderHead() {
  if (!room) return;
  document.title = `${t('wc_title')} — ${room.winnerName}`;
  const status = room.status === 'verified' ? h('span', { class: 'badge ok' }, `✓ ${t('wc_verified')}`)
    : room.status === 'closed' ? h('span', { class: 'badge err' }, t('wc_closed'))
      : h('span', { class: 'badge warn' }, t('wc_waiting'));
  head.replaceChildren(
    h('div', { class: 'wc-who' },
      h('div', { class: `sa-avatar sa-ph pf-badge pf-${room.platform}` }, (PLAT[room.platform] || '?').slice(0, 2).toUpperCase()),
      h('div', { class: 'grow' }, h('div', { class: 'wc-name' }, h('bdi', {}, room.winnerName)), h('div', { class: 'muted small' }, h('bdi', {}, room.title), ` · ${PLAT[room.platform] || room.platform}`)),
      status),
    room.status === 'waiting' ? h('div', { class: 'msg show info small' }, t('wc_waiting_help')) : null,
    room.claimUrl ? h('div', { class: 'row wc-link' }, h('code', { class: 'mono small' }, room.claimUrl),
      h('button', { class: 'btn sm', onclick: () => call('app:copy', room.claimUrl).catch(toastErr) }, h('span', { html: icon('copy', 13) }), t('copy'))) : null,
    room.status !== 'closed' ? h('div', { class: 'row' }, h('button', { class: 'btn sm danger', onclick: closeRoom }, h('span', { html: icon('x', 13) }), t('wc_close'))) : null,
  );
  input.disabled = sendBtn.disabled = room.status === 'closed';
}
function add(msgs) {
  if (msgs.length && list.querySelector('.wc-empty')) list.replaceChildren();
  for (const m of msgs) {
    if (seen.has(m.id)) continue; seen.add(m.id); lastId = Math.max(lastId, m.id);
    const mine = m.from === 'host';
    list.append(h('div', { class: `wc-msg ${mine ? 'me' : 'them'}` },
      h('div', { class: 'wc-meta' }, mine ? t('wc_you') : h('bdi', {}, room?.verifiedName || room?.winnerName || ''), ` · ${fmtTime(m.at)}`),
      h('div', { class: 'wc-bubble' }, m.text)));
  }
  if (!list.children.length) list.append(h('div', { class: 'wc-empty muted' }, t('wc_empty')));
  list.scrollTop = list.scrollHeight;
}
async function refresh() {
  try {
    const r = await call('winner:messages', roomId, lastId);
    const changed = !room || r.room.status !== room.status;
    room = r.room; if (changed) renderHead();
    add(r.messages);
    if (room.status === 'closed') clearInterval(timer);
  } catch (e) { if (e.code === 'NOT_FOUND') { clearInterval(timer); head.replaceChildren(h('div', { class: 'msg show err' }, t('wc_not_found'))); } }
}
async function closeRoom() {
  if (!(await confirmBox(t('wc_close_confirm'), true))) return;
  try { await call('winner:close', roomId); } catch (e) { toastErr(e); }
}
form.addEventListener('submit', async (e) => {
  e.preventDefault(); const text = input.value.trim(); if (!text) return;
  sendBtn.disabled = true;
  try { const r = await call('winner:send', roomId, text); add([r.message]); input.value = ''; } catch (err) { toastErr(err); } finally { sendBtn.disabled = room?.status === 'closed'; input.focus(); }
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

add([]);
refresh();
timer = setInterval(refresh, 2500); // the window drives polling (reliable in Electron)
