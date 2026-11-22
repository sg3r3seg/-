'use strict';
(() => {
  let token = sessionStorage.getItem('lxr') || '';
  const $ = (id) => document.getElementById(id);
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/pin') { token = ''; sessionStorage.removeItem('lxr'); show(false); }
    if (!r.ok) throw new Error(j.error || 'Error');
    return j;
  };
  const show = (on) => { $('login').classList.toggle('hidden', on); $('panel').classList.toggle('hidden', !on); };
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const btn = (label, a, id) => { const b = document.createElement('button'); b.textContent = label; b.dataset.a = a; b.dataset.id = id; return b; };
  async function refresh() {
    const s = await api('GET', '/api/state');
    $('sounds').replaceChildren(...s.sounds.map((x) => btn(`🔊 ${x.name}`, 'sound', x.id)));
    $('macros').replaceChildren(...s.macros.map((x) => btn(`⚡ ${x.name}`, 'macro', x.id)));
    const t = s.timer; $('timer').textContent = fmt(t.mode === 'stopwatch' ? t.elapsedMs : t.remainingMs);
  }
  $('go').onclick = async () => {
    try { const r = await api('POST', '/api/pin', { pin: $('pin').value.trim() }); token = r.token; sessionStorage.setItem('lxr', token); show(true); refresh(); } catch (e) { $('err').textContent = e.message; }
  };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    try { await api('POST', '/api/action', { action: b.dataset.a, id: b.dataset.id, sec: b.dataset.sec }); $('err2').textContent = ''; refresh(); } catch (err) { $('err2').textContent = err.message; }
  });
  if (token) { show(true); refresh().catch(() => {}); }
  setInterval(() => { if (token) refresh().catch(() => {}); }, 3000);
})();
