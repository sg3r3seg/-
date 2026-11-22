'use strict';
// Shared client for LiveX overlays (OBS Browser Source). Receive-only WebSocket.
window.LiveXOverlay = function connect(route, handlers) {
  const key = new URLSearchParams(location.search).get('key') || '';
  let retry = 0;
  const applyStyle = (st) => {
    if (!st) return;
    const r = document.documentElement.style;
    if (st.accent) r.setProperty('--accent', st.accent);
    if (st.text) r.setProperty('--text', st.text);
    if (st.background) r.setProperty('--bg', st.background);
    if (st.fontSize) r.setProperty('--size', `${Number(st.fontSize)}px`);
    if (st.font) r.setProperty('--font', st.font);
    if (st.align) document.body.dataset.align = st.align; else delete document.body.dataset.align;
    if (st.position) document.body.dataset.position = st.position; else delete document.body.dataset.position;
    if (st.text) document.body.style.color = st.text;
    handlers.style && handlers.style(st);
  };
  function setLang(l) {
    window.lxLang = l === 'he' ? 'he' : 'en';
    document.documentElement.lang = window.lxLang;
    document.documentElement.dir = window.lxLang === 'he' ? 'rtl' : 'ltr';
    if (handlers.lang) handlers.lang(window.lxLang);
  }
  function open() {
    const ws = new WebSocket(`ws://${location.host}/ws?key=${encodeURIComponent(key)}&route=${encodeURIComponent(route)}`);
    ws.onopen = () => { retry = 0; document.body.classList.remove('lx-offline'); };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'lang') { setLang(msg.payload); return; }
      if (msg.type === 'hello') { setLang(msg.lang); applyStyle(msg.style); if (msg.state && handlers[msg.state.type]) handlers[msg.state.type](msg.state.payload, true); return; }
      if (msg.type === 'style') return applyStyle(msg.payload);
      if (handlers[msg.type]) handlers[msg.type](msg.payload, false);
    };
    ws.onclose = () => { document.body.classList.add('lx-offline'); setTimeout(open, Math.min(10000, 500 * 2 ** retry++)); };
  }
  open();
};
window.lxEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small overlay dictionary (overlay pages follow the LiveX app language).
window.lxT = (k) => ({
  en: { join: 'Type {k} to join', closed: 'Entries closed', entries: 'entries' },
  he: { join: 'כתבו {k} כדי להשתתף', closed: 'ההרשמה נסגרה', entries: 'משתתפים' },
}[window.lxLang || 'en'][k] || k);
