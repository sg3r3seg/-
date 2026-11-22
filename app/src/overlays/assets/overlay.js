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
    if (st.align) document.body.dataset.align = st.align;
    if (st.position) document.body.dataset.position = st.position;
    handlers.style && handlers.style(st);
  };
  function open() {
    const ws = new WebSocket(`ws://${location.host}/ws?key=${encodeURIComponent(key)}&route=${encodeURIComponent(route)}`);
    ws.onopen = () => { retry = 0; document.body.classList.remove('lx-offline'); };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.type === 'hello') { applyStyle(msg.style); if (msg.state && handlers[msg.state.type]) handlers[msg.state.type](msg.state.payload, true); return; }
      if (msg.type === 'style') return applyStyle(msg.payload);
      if (handlers[msg.type]) handlers[msg.type](msg.payload, false);
    };
    ws.onclose = () => { document.body.classList.add('lx-offline'); setTimeout(open, Math.min(10000, 500 * 2 ** retry++)); };
  }
  open();
};
window.lxEsc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
