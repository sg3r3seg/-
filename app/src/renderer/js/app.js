import { t, setLang, lang } from './i18n.js';
import { h, call, toast, toastErr, errText, act, fmtDate } from './ui.js';
import { icon } from './icons.js';
import { VIEWS, GROUPS } from './views/index.js';
import { startPlayers } from './players.js';

const app = {
  state: null, settings: null, info: null, current: null, cleanup: null,
  platformStatus: {},
  t, call,
  go: (id) => navigate(id),
  has: (ent) => !!app.state?.entitlements?.includes(ent),
  openSite: (p) => call('app:openWebsite', p).catch(toastErr),
};
window.__livex = app; // for debugging in dev tools only
window.__livexRoute = () => { shellEls = null; route(); };

const root = document.getElementById('root');
const STEPS = ['server', 'auth', 'license', 'device', 'permissions'];

function applyTheme() {
  document.documentElement.dataset.theme = app.settings?.theme || 'navy';
  document.documentElement.lang = lang();
  document.documentElement.dir = lang() === 'he' ? 'rtl' : 'ltr';
}

// ---------------------------------------------------------------- splash ----
function renderSplash() {
  const steps = Object.fromEntries(STEPS.map((s) => [s, h('li', { class: 'step', 'data-status': 'pending' }, h('span', { class: 'step-dot' }), h('span', {}, t(`boot_${s}`)), h('span', { class: 'step-detail' }))]));
  const el = h('div', { class: 'splash' },
    h('div', { class: 'splash-glow' }),
    h('div', { class: 'logo-big' }, h('div', { class: 'logo-mark', html: logoSvg(96) }), h('div', { class: 'logo-word' }, 'LIVEX'), h('div', { class: 'slogan' }, 'ONE PLATFORM. EVERY CREATOR.')),
    h('div', { class: 'loader' }, h('div', { class: 'loader-bar' })),
    h('ul', { class: 'steps' }, ...Object.values(steps)),
    h('div', { class: 'splash-foot' }, `v${app.info?.version || ''}`));
  root.replaceChildren(el);
  return (step, status, detail) => {
    const li = steps[step]; if (!li) return;
    li.dataset.status = status;
    li.querySelector('.step-detail').textContent = status === 'fail' && detail ? detail : '';
  };
}

export function logoSvg(size = 40) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256"><defs><linearGradient id="lg${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22e4d9"/><stop offset=".55" stop-color="#4cc9ff"/><stop offset="1" stop-color="#2f6bff"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="#050a14"/><rect x="10" y="10" width="236" height="236" rx="48" fill="none" stroke="url(#lg${size})" stroke-width="8"/><path d="M70 64h34l24 40 24-40h34l-41 64 41 64h-34l-24-40-24 40H70l41-64z" fill="url(#lg${size})"/><circle cx="196" cy="60" r="12" fill="#ff3b6b"/></svg>`;
}

async function boot() {
  const update = renderSplash();
  const off = window.livex.on('boot:progress', ({ step, status, detail }) => update(step, status, detail));
  const started = Date.now();
  try {
    app.state = await call('session:boot');
  } catch (e) {
    app.state = { phase: 'error', notice: { code: e.code, text: e.message } };
  }
  off();
  await new Promise((r) => setTimeout(r, Math.max(0, 1400 - (Date.now() - started))));
  app.booted = true;
  route();
}

// Decide which top-level screen to show from the session state.
function route() {
  const st = app.state;
  if (!st) return;
  if (st.phase === 'signed_out') return renderAuth();
  if (st.phase === 'offline_blocked') return renderBlocked('offline');
  if (st.phase === 'error') return renderBlocked('error');
  if (st.phase === 'ready') return renderShell();
  return renderAuth();
}

// ---------------------------------------------------------------- blocked ----
function renderBlocked(kind) {
  const n = app.state.notice || {};
  root.replaceChildren(h('div', { class: 'center-screen' }, h('div', { class: 'card auth-card' },
    h('div', { class: 'logo-row', html: `${logoSvg(44)}<span class="logo-word sm">LIVEX</span>` }),
    h('h2', {}, kind === 'offline' ? t('offline_title') : t('error_title')),
    h('p', { class: 'muted' }, kind === 'offline' ? t('offline_no_lease') : (t(n.text) !== n.text ? t(n.text) : n.text || t('err_NETWORK'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => boot() }, h('span', { html: icon('refresh') }), t('retry')),
      h('button', { class: 'btn', onclick: async () => { app.state = await call('session:logout'); route(); } }, t('sign_out'))))));
}

// ---------------------------------------------------------------- auth ----
function renderAuth(tab = 'login') {
  const msg = h('div', { class: 'msg' });
  const show = (kind, text) => { msg.className = `msg show ${kind}`; msg.textContent = text; };
  const notice = app.state?.notice;
  const tabs = h('div', { class: 'tabs' }, ...['login', 'register', 'forgot'].map((k) => h('button', { class: `tab ${k === tab ? 'active' : ''}`, onclick: () => renderAuth(k) }, t(`auth_${k}`))));
  let form;
  const inp = (name, type = 'text', extra = {}) => h('input', { class: 'input', name, type, required: true, ...extra });
  if (tab === 'login') {
    form = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('email')), inp('email', 'email', { autocomplete: 'email' })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('password')), inp('password', 'password', { autocomplete: 'current-password' })),
      h('button', { class: 'btn primary wide', type: 'submit' }, t('sign_in')), msg);
    form.onsubmit = async (e) => {
      e.preventDefault(); const b = form.querySelector('button[type=submit]'); b.disabled = true;
      const v = Object.fromEntries(new FormData(form));
      try { app.state = await call('session:login', v.email, v.password); route(); } catch (err) {
        show('err', errText(err));
        if (err.code === 'EMAIL_NOT_VERIFIED') {
          if (err.data?.devMailbox) msg.append(h('div', { class: 'msg-note' }, t('dev_mailbox_note')));
          msg.append(h('div', { class: 'row' },
            err.data?.devMailbox ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => app.openSite('/mailbox.html') }, h('span', { html: icon('external', 14) }), t('open_dev_mailbox')) : null,
            h('button', { class: 'btn sm', type: 'button', onclick: (ev) => act(ev.target, () => call('session:resend', v.email, v.password), t('verification_resent')) }, t('resend_verification'))));
        }
      } finally { b.disabled = false; }
    };
  } else if (tab === 'register') {
    form = h('form', { class: 'form' },
      h('div', { class: 'grid g2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('first_name')), inp('firstName', 'text', { maxlength: 60, autocomplete: 'given-name' })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('last_name')), inp('lastName', 'text', { maxlength: 60, autocomplete: 'family-name' }))),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('email')), inp('email', 'email')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('password')), inp('password', 'password', { minlength: 8, autocomplete: 'new-password' }), h('span', { class: 'hint' }, t('password_hint'))),
      h('button', { class: 'btn primary wide', type: 'submit' }, t('create_account')), msg);
    form.onsubmit = async (e) => {
      e.preventDefault(); const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try {
        const r = await call('session:register', Object.fromEntries(new FormData(form)));
        show('ok', `${t('registered')} ${r.user.userId}${r.verificationEmail === 'queued_dev_outbox' ? ` — ${t('dev_outbox')}` : ''}`);
        if (r.devMailbox) msg.append(h('div', { class: 'row' }, h('button', { class: 'btn sm primary', type: 'button', onclick: () => app.openSite('/mailbox.html') }, h('span', { html: icon('external', 14) }), t('open_dev_mailbox'))));
        form.reset();
      } catch (err) { show('err', errText(err)); } finally { b.disabled = false; }
    };
  } else {
    form = h('form', { class: 'form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('email')), inp('email', 'email')),
      h('button', { class: 'btn primary wide', type: 'submit' }, t('send_reset')), msg);
    form.onsubmit = async (e) => {
      e.preventDefault(); const b = form.querySelector('button[type=submit]'); b.disabled = true;
      try { await call('session:forgot', new FormData(form).get('email')); show('ok', t('reset_sent')); } catch (err) { show('err', errText(err)); } finally { b.disabled = false; }
    };
  }
  root.replaceChildren(h('div', { class: 'center-screen auth-bg' },
    h('div', { class: 'auth-side' }, h('div', { html: logoSvg(72) }), h('div', { class: 'logo-word' }, 'LIVEX'), h('div', { class: 'slogan' }, 'ONE PLATFORM. EVERY CREATOR.'),
      h('ul', { class: 'auth-points' }, ...['TikTok LIVE', 'YouTube LIVE', 'Kick', 'Twitch'].map((p) => h('li', {}, h('span', { html: icon('check', 16) }), p)))),
    h('div', { class: 'card auth-card' },
      h('div', { class: 'auth-top' }, h('h2', {}, t(`auth_${tab}`)), langButton()),
      notice?.code && notice.code !== 'OFFLINE' ? h('div', { class: 'msg show warn' }, errText(notice)) : null,
      tabs, form,
      app.info?.officialSiteUrl ? h('button', { class: 'official-site', type: 'button', title: app.info.officialSiteUrl, onclick: () => call('app:openOfficialSite').catch(toastErr) },
        h('span', { class: 'os-icon', html: icon('globe', 18) }),
        h('span', { class: 'os-text' }, h('span', { class: 'os-label' }, t('official_site')), h('span', { class: 'os-url mono' }, app.info.officialSiteUrl.replace(/^https:\/\//, '').replace(/\/$/, ''))),
        h('span', { class: 'os-go', html: icon('external', 15) })) : null,
      h('p', { class: 'muted small' }, t('server_label'), ' ', h('span', { class: 'mono' }, app.info?.apiBase || '')),
      h('button', { class: 'link', onclick: () => app.openSite('/') }, t('open_website')))));
}

function langButton() {
  return h('button', { class: 'btn ghost sm', onclick: async () => { const l = lang() === 'he' ? 'en' : 'he'; app.settings = await call('settings:set', { language: l }); setLang(l); applyTheme(); route(); } }, lang() === 'he' ? 'English' : 'עברית');
}

// ---------------------------------------------------------------- shell ----
let shellEls = null;
function renderShell() {
  const nav = h('nav', { class: 'nav' });
  for (const g of GROUPS) {
    nav.append(h('div', { class: 'nav-group' }, t(`group_${g}`)));
    for (const v of VIEWS.filter((x) => x.group === g)) {
      const locked = v.ent && !app.has(v.ent);
      nav.append(h('button', { class: 'nav-item', 'data-view': v.id, onclick: () => navigate(v.id), title: t(v.title) },
        h('span', { class: 'nav-icon', html: icon(v.icon) }), h('span', { class: 'nav-label' }, t(v.title)), locked ? h('span', { class: 'nav-lock', html: icon('lock', 13) }) : null));
    }
  }
  const banner = h('div', { class: 'banner hidden' });
  const top = h('header', { class: 'topbar' },
    h('div', { class: 'top-title' }), h('div', { class: 'top-status' }), h('div', { class: 'top-right' }));
  const main = h('main', { class: 'content' });
  root.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('div', { class: 'brand', html: `${logoSvg(34)}<div><div class="logo-word sm">LIVEX</div><div class="slogan sm">ONE PLATFORM. EVERY CREATOR.</div></div>` }),
      nav,
      h('div', { class: 'side-foot' }, h('div', { class: 'user-chip' }, h('div', { class: 'avatar' }, (app.state.user?.fullName || '?').slice(0, 1)), h('div', {}, h('div', { class: 'uname' }, app.state.user?.fullName || ''), h('div', { class: 'uid mono' }, app.state.user?.userId || ''))))),
    h('div', { class: 'main-col' }, top, banner, main)));
  shellEls = { nav, banner, top, main };
  updateChrome();
  navigate(app.current && VIEWS.some((v) => v.id === app.current) ? app.current : 'dashboard');
}

function updateChrome() {
  if (!shellEls) return;
  const st = app.state;
  // Banner for offline / revoked / lost license
  const n = st.notice;
  const b = shellEls.banner;
  if (n && ['OFFLINE', 'LICENSE_REVOKED', 'LICENSE_LOST', 'LEASE_INVALID'].includes(n.code)) {
    b.className = `banner ${n.code === 'OFFLINE' ? 'warn' : 'err'}`;
    b.replaceChildren(...[h('span', { html: icon(n.code === 'OFFLINE' ? 'wifiOff' : 'shield') }),
      h('span', {}, n.code === 'OFFLINE' ? `${t('offline_mode')} ${fmtDate(n.until)}` : t(n.text)),
      n.code !== 'OFFLINE' ? h('button', { class: 'btn sm', onclick: () => navigate('account') }, t('nav_account')) : null].filter(Boolean));
  } else b.className = 'banner hidden';
  // Status chips
  const server = st.offline ? h('span', { class: 'chip warn', html: `${icon('wifiOff', 14)}<span>${t('offline')}</span>` }) : h('span', { class: 'chip ok', html: `${icon('wifi', 14)}<span>${t('online')}</span>` });
  const lic = h('span', { class: `chip ${st.entitlements.length ? 'ok' : 'err'}` }, h('span', { html: icon('key', 14) }), st.entitlements.length ? st.entitlements.map((e) => e.toUpperCase()).join(' + ') : t('no_license'));
  const live = Object.values(app.platformStatus).filter((p) => p.state === 'connected' && p.platform !== 'discord');
  const conn = h('span', { class: `chip ${live.length ? 'ok' : ''}` }, h('span', { html: icon('plug', 14) }), live.length ? live.map((p) => p.label).join(' · ') : t('no_platform'));
  shellEls.top.querySelector('.top-status').replaceChildren(server, lic, conn);
  shellEls.top.querySelector('.top-right').replaceChildren(langButton());
  shellEls.nav.querySelectorAll('.nav-item').forEach((el) => {
    const v = VIEWS.find((x) => x.id === el.dataset.view);
    const locked = v.ent && !app.has(v.ent);
    const lock = el.querySelector('.nav-lock');
    if (locked && !lock) el.append(h('span', { class: 'nav-lock', html: icon('lock', 13) }));
    if (!locked && lock) lock.remove();
  });
}

async function navigate(id) {
  const v = VIEWS.find((x) => x.id === id) || VIEWS[0];
  if (app.cleanup) { try { app.cleanup(); } catch { /* ignore */ } app.cleanup = null; }
  app.current = v.id;
  if (!shellEls) return;
  shellEls.nav.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === v.id));
  shellEls.top.querySelector('.top-title').replaceChildren(h('span', { html: icon(v.icon, 20) }), h('h1', {}, t(v.title)));
  const container = h('div', { class: 'view enter' });
  shellEls.main.replaceChildren(container);
  if (v.ent && !app.has(v.ent)) { container.append(lockScreen(v)); return; }
  try {
    const cleanup = await v.render(container, app);
    if (app.current === v.id) app.cleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (e) {
    container.replaceChildren(h('div', { class: 'card' }, h('h3', {}, t('error_title')), h('p', { class: 'muted' }, errText(e))));
  }
}

function lockScreen(v) {
  const isTts = v.ent === 'tts';
  return h('div', { class: 'lock-screen' },
    h('div', { class: 'lock-icon', html: icon('lock', 42) }),
    h('h2', {}, isTts ? t('lock_tts_title') : t('lock_pro_title')),
    h('p', { class: 'muted' }, isTts ? t('lock_tts_text') : t('lock_pro_text')),
    h('div', { class: 'price-row' },
      ...(isTts ? [['TTS', '₪29.90'], ['BUNDLE', '₪39.90']] : [['PRO', '₪19.90'], ['BUNDLE', '₪39.90']]).map(([p, price]) => h('div', { class: 'price-pill' }, h('b', {}, p === 'BUNDLE' ? 'COMPLETE BUNDLE' : `LiveX ${p}`), h('span', {}, price)))),
    h('div', { class: 'row center' },
      h('button', { class: 'btn primary', onclick: () => app.openSite('/index.html#pricing') }, h('span', { html: icon('external') }), t('buy_on_website')),
      h('button', { class: 'btn', onclick: () => navigate('account') }, h('span', { html: icon('key') }), t('enter_activation_code'))));
}

// ---------------------------------------------------------------- events ----
window.livex.on('session:changed', (st) => {
  if (!app.booted) { app.state = st; return; }
  const prevPhase = app.state?.phase; const prevEnt = (app.state?.entitlements || []).join();
  app.state = st;
  if (st.phase !== prevPhase && !(prevPhase === 'ready' && st.phase === 'ready')) { shellEls = st.phase === 'ready' ? shellEls : null; route(); return; }
  updateChrome();
  if (prevEnt !== st.entitlements.join() && app.current) {
    if (st.notice?.code === 'LICENSE_REVOKED') toast(t('license_revoked'), 'err', 8000);
    navigate(app.current);
  }
});
window.livex.on('platform:status', (s) => { app.platformStatus[s.platform] = s; updateChrome(); });
window.livex.on('update:state', (s) => { if (s.phase === 'available') toast(`${t('update_available')} v${s.version}`, 'info', 8000); });

(async function init() {
  try {
    [app.info, app.settings] = await Promise.all([call('app:info'), call('settings:get')]);
  } catch (e) { app.info = {}; app.settings = { language: 'en', theme: 'navy' }; }
  setLang(app.settings.language || 'en');
  applyTheme();
  startPlayers(app);
  await boot();
  try { (await call('platforms:list')).forEach((s) => { app.platformStatus[s.platform] = s; }); updateChrome(); } catch { /* not licensed */ }
})();

export { app, navigate, route, applyTheme, updateChrome };
