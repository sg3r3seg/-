// LiveX renderer UI helpers. No innerHTML with dynamic data — elements are
// built with textContent to keep the renderer XSS-safe.
import { t, lang } from './i18n.js';

// Conditional children (cond ? node : null) are common in the views: make
// append/prepend/replaceChildren skip null/false/undefined instead of
// rendering the text "null".
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function patched(...nodes) {
    return orig.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
  };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // static, trusted markup only (icons)
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export class CallError extends Error { constructor(e) { super(e.message); this.code = e.code; this.data = e.data; } }

// Invoke a main-process handler. Rejects on failure — a failed call is never shown as success.
export async function call(channel, ...args) {
  const r = await window.livex.invoke(channel, ...args);
  if (!r || !r.ok) throw new CallError(r?.error || { code: 'ERROR', message: 'Unknown error' });
  return r.data;
}

export function errText(e) {
  const key = `err_${e.code}`;
  const tr = t(key);
  return tr !== key ? tr : (e.message || String(e));
}

let toastWrap;
export function toast(msg, kind = 'info', ms = 3800) {
  if (!toastWrap) { toastWrap = h('div', { class: 'toasts' }); document.body.append(toastWrap); }
  const el = h('div', { class: `toast ${kind}` }, h('span', { class: 'toast-dot' }), msg);
  toastWrap.append(el);
  setTimeout(() => { el.classList.add('leave'); setTimeout(() => el.remove(), 400); }, ms);
}
export const toastErr = (e) => toast(errText(e), 'err', 6000);

// Run an async action from a button, with busy state and error toast.
export async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; } catch (e) { toastErr(e); return undefined; } finally { if (btn) btn.disabled = false; }
}

export function modal(title, body, actions = []) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.classList.add('leave'); setTimeout(() => overlay.remove(), 200); resolve(v); };
    const overlay = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === overlay) close(null); } },
      h('div', { class: 'modal' }, h('h3', {}, title), h('div', { class: 'modal-body' }, body),
        h('div', { class: 'modal-actions' }, ...actions.map((a) => h('button', { class: `btn ${a.kind || ''}`, onclick: async () => { const v = a.value ? await a.value() : a.key; if (v !== false) close(v); } }, a.label)))));
    document.body.append(overlay);
    setTimeout(() => overlay.querySelector('input,textarea,select')?.focus(), 50);
  });
}
export async function confirmBox(text, danger = false) {
  return (await modal(t('confirm'), h('p', {}, text), [{ label: t('cancel'), key: false }, { label: t('ok'), key: true, kind: danger ? 'danger' : 'primary' }])) === true;
}

export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(lang() === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtTime = (ms) => (ms ? new Date(ms).toLocaleTimeString(lang() === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const fmtNum = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString(lang() === 'he' ? 'he-IL' : 'en-US'));
export const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60; return `${hh ? `${hh}:` : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };

// Form field builders -------------------------------------------------------
export const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
export const input = (attrs = {}) => h('input', { class: 'input', ...attrs });
export const textarea = (attrs = {}) => h('textarea', { class: 'input', rows: 3, ...attrs });
export function select(options, value, attrs = {}) {
  const s = h('select', { class: 'input', ...attrs }, ...options.map((o) => h('option', { value: o.value }, o.label)));
  s.value = value ?? options[0]?.value ?? '';
  return s;
}
export function toggle(checked, onchange, label) {
  const cb = h('input', { type: 'checkbox', checked, onchange: (e) => onchange && onchange(e.target.checked) });
  return h('label', { class: 'toggle' }, cb, h('span', { class: 'track' }, h('span', { class: 'thumb' })), label ? h('span', {}, label) : null);
}
export const card = (title, ...children) => h('section', { class: 'card' }, title ? h('div', { class: 'card-head' }, typeof title === 'string' ? h('h3', {}, title) : title) : null, ...children);
export const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
export const empty = (text) => h('div', { class: 'empty' }, text);
export const btn = (label, onclick, kind = '', attrs = {}) => h('button', { class: `btn ${kind}`, onclick, ...attrs }, label);
export const row = (...c) => h('div', { class: 'row' }, ...c);
export const grid = (cols, ...c) => h('div', { class: `grid g${cols}` }, ...c);

export function stateBadge(state) {
  const map = { connected: 'ok', connecting: 'warn', error: 'err', disconnected: '', not_configured: '' };
  return badge(t(`state_${state}`), map[state] ?? '');
}

// Download/copy helpers
export async function copy(text) { await call('app:copy', text); toast(t('copied'), 'ok', 1800); }

// Base64 -> Blob URL
export function b64ToUrl(b64, mime) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([arr], { type: mime }));
}
export function blobToB64(blob) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(blob); });
}
