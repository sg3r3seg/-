'use strict';
/* LiveX website — vanilla JS, no inline scripts (strict CSP). */
(() => {
  const I18N = {
    en: {
      nav_pricing: 'Pricing', nav_account: 'My account', nav_login: 'Sign in', nav_register: 'Create account', nav_logout: 'Sign out',
      hero_text: 'Professional live-stream management for TikTok LIVE, YouTube LIVE, Kick and Twitch creators: alerts, TTS, overlays, chat bot, giveaways and analytics in one secure desktop app for Windows.',
      get_started: 'Get started', see_pricing: 'See pricing', pricing: 'Pricing', buy: 'Buy now', best: 'Best value',
      pro_feats: 'All creator modules|Alerts, overlays & chat bot|Giveaways, timers & challenges|Analytics & diagnostics',
      tts_feats: 'LiveX TTS reader|Voice Studio profiles|Word filters & queue control|TTS overlay',
      bundle_feats: 'Everything in LiveX PRO|Everything in LiveX TTS|One license key|Best price',
      first_name: 'First name', last_name: 'Last name', email: 'Email', password: 'Password', password_hint: 'At least 8 characters, letters and numbers',
      create_account: 'Create account', sign_in: 'Sign in', forgot: 'Forgot password?', send_reset: 'Send reset link', new_password: 'New password', save_password: 'Save new password',
      have_account: 'Already have an account?', no_account: 'No account yet?',
      registered: 'Account created. We sent a verification link to your email. Your User ID: ',
      dev_outbox: ' (Test server: no real email is sent — open the local mailbox below to find the link.)',
      verifying: 'Verifying…', verified: 'Email verified. You can now sign in.', reset_sent: 'If an account exists for this email, a reset link was sent.', reset_done: 'Password changed. Please sign in.',
      account: 'My account', profile: 'Profile', user_id: 'User ID', licenses: 'Licenses', devices: 'Devices', orders: 'Orders', no_licenses: 'No licenses yet.',
      license_id: 'License ID', personal_code: 'Personal code', holder: 'License holder', status: 'Status', purchased: 'Purchased', activated: 'Activated', device: 'Device',
      activation_code: 'One-time activation code', code_used: 'Activation code used', code_expired: 'Activation code expired — contact support',
      transfer: 'Transfer to new computer', transfer_prompt: 'Enter your password to confirm your identity:', transfer_sent: 'A confirmation link was sent to your email. Open it to finish the transfer.',
      transferring: 'Confirming transfer…', transfer_done: 'The license was removed from the old computer. Sign in to LiveX on the new computer and choose "Use this computer".',
      checkout_title: 'Checkout', sandbox_banner: 'SANDBOX PAYMENT — development server. No real money is charged.', pay_sandbox: 'Complete sandbox payment', paid_ok: 'Payment confirmed. Your license and one-time activation code are ready in your account.',
      payments_unavailable: 'Payments are not available on this server yet.', login_to_buy: 'Sign in to purchase.', download: 'Download LiveX for Windows', no_release: 'No installer has been published on this server yet.',
      st_active: 'Active', st_pending_activation: 'Awaiting activation', st_revoked: 'Revoked', st_issued: 'Issued', st_used: 'Used', st_paid: 'Paid', st_pending: 'Pending', st_failed: 'Failed', st_deactivated: 'Removed', st_expired: 'Expired',
      mb_title: 'Local mailbox (test server)', mb_hint: 'This test server does not send real emails. Every email it would send — verification links, activation codes (KEYNAME), password resets — appears here. Click a link to use it.', mb_filter: 'Filter by email address…', mb_empty: 'No emails yet.', mb_open: 'Open the local mailbox',
      last_seen: 'Last seen', os: 'OS', product: 'Product', amount: 'Amount', date: 'Date', redirecting: 'Redirecting to secure checkout…',
    },
    he: {
      nav_pricing: 'מחירים', nav_account: 'האזור האישי', nav_login: 'התחברות', nav_register: 'הרשמה', nav_logout: 'יציאה',
      hero_text: 'ניהול שידורים חיים מקצועי ליוצרי TikTok LIVE, ‏YouTube LIVE, ‏Kick ו-Twitch: התראות, הקראת הודעות, Overlays, בוט צ׳אט, הגרלות ואנליטיקה — באפליקציית Windows אחת ומאובטחת.',
      get_started: 'מתחילים', see_pricing: 'למחירים', pricing: 'מחירים', buy: 'לרכישה', best: 'הכי משתלם',
      pro_feats: 'כל מודולי היוצרים|התראות, Overlays ובוט צ׳אט|הגרלות, טיימרים ואתגרים|אנליטיקה ואבחון',
      tts_feats: 'הקראת הודעות LiveX TTS|פרופילים ב-Voice Studio|סינון מילים ושליטה בתור|TTS Overlay',
      bundle_feats: 'כל מה שב-LiveX PRO|כל מה שב-LiveX TTS|רישיון אחד|המחיר הטוב ביותר',
      first_name: 'שם פרטי', last_name: 'שם משפחה', email: 'דוא"ל', password: 'סיסמה', password_hint: 'לפחות 8 תווים, אותיות ומספרים',
      create_account: 'יצירת חשבון', sign_in: 'התחברות', forgot: 'שכחת סיסמה?', send_reset: 'שליחת קישור לאיפוס', new_password: 'סיסמה חדשה', save_password: 'שמירת סיסמה',
      have_account: 'כבר יש לך חשבון?', no_account: 'עדיין אין חשבון?',
      registered: 'החשבון נוצר. שלחנו קישור אימות לדוא"ל שלך. מזהה המשתמש שלך: ',
      dev_outbox: ' (שרת בדיקות: לא נשלח מייל אמיתי — הקישור נמצא בתיבת הדואר המקומית למטה.)',
      verifying: 'מאמת…', verified: 'כתובת הדוא"ל אומתה. אפשר להתחבר.', reset_sent: 'אם קיים חשבון עם כתובת זו, נשלח אליה קישור לאיפוס.', reset_done: 'הסיסמה עודכנה. יש להתחבר מחדש.',
      account: 'האזור האישי', profile: 'פרופיל', user_id: 'מזהה משתמש', licenses: 'רישיונות', devices: 'מכשירים', orders: 'הזמנות', no_licenses: 'אין רישיונות עדיין.',
      license_id: 'מזהה רישיון', personal_code: 'קוד אישי', holder: 'בעל הרישיון', status: 'סטטוס', purchased: 'נרכש', activated: 'הופעל', device: 'מכשיר',
      activation_code: 'קוד הפעלה חד-פעמי', code_used: 'קוד ההפעלה נוצל', code_expired: 'תוקף קוד ההפעלה פג — פנה לתמיכה',
      transfer: 'העברה למחשב חדש', transfer_prompt: 'הזן את הסיסמה לאימות זהות:', transfer_sent: 'נשלח קישור אישור לדוא"ל. פתח אותו להשלמת ההעברה.',
      transferring: 'מאשר העברה…', transfer_done: 'הרישיון הוסר מהמחשב הישן. התחבר ל-LiveX במחשב החדש ובחר "שימוש במחשב זה".',
      checkout_title: 'תשלום', sandbox_banner: 'תשלום SANDBOX — שרת פיתוח. לא מתבצע חיוב אמיתי.', pay_sandbox: 'השלמת תשלום Sandbox', paid_ok: 'התשלום אושר. הרישיון וקוד ההפעלה החד-פעמי מחכים באזור האישי.',
      payments_unavailable: 'תשלומים עדיין לא זמינים בשרת זה.', login_to_buy: 'יש להתחבר כדי לרכוש.', download: 'הורדת LiveX ל-Windows', no_release: 'עדיין לא פורסם קובץ התקנה בשרת זה.',
      st_active: 'פעיל', st_pending_activation: 'ממתין להפעלה', st_revoked: 'בוטל', st_issued: 'הונפק', st_used: 'נוצל', st_paid: 'שולם', st_pending: 'ממתין', st_failed: 'נכשל', st_deactivated: 'הוסר', st_expired: 'פג תוקף',
      mb_title: 'תיבת דואר מקומית (שרת בדיקות)', mb_hint: 'שרת הבדיקות לא שולח מיילים אמיתיים. כל מייל שהיה נשלח — קישורי אימות, קודי הפעלה (KEYNAME) ואיפוס סיסמה — מופיע כאן. לוחצים על הקישור כדי להשתמש בו.', mb_filter: 'סינון לפי כתובת דוא"ל…', mb_empty: 'אין מיילים עדיין.', mb_open: 'פתיחת תיבת הדואר המקומית',
      last_seen: 'נראה לאחרונה', os: 'מערכת הפעלה', product: 'מוצר', amount: 'סכום', date: 'תאריך', redirecting: 'מעביר לתשלום מאובטח…',
    },
  };
  const ERR_HE = {
    INVALID_CREDENTIALS: 'דוא"ל או סיסמה שגויים', EMAIL_TAKEN: 'כבר קיים חשבון עם כתובת זו', EMAIL_NOT_VERIFIED: 'יש לאמת את כתובת הדוא"ל לפני ההתחברות',
    WEAK_PASSWORD: 'הסיסמה חייבת לכלול לפחות 8 תווים, אותיות ומספרים', INVALID_TOKEN: 'הקישור אינו תקף או שפג תוקפו', RATE_LIMITED: 'יותר מדי ניסיונות. נסה שוב מאוחר יותר.',
    TRANSFER_LIMIT: 'הגעת למגבלת ההעברות השנתית', PAYMENTS_UNAVAILABLE: 'תשלומים אינם זמינים כרגע', NETWORK: 'אין חיבור לשרת LiveX',
  };

  let lang = localStorage.getItem('lvx_lang') || 'en';
  const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = (s) => t(`st_${s}`);
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB') : '—');

  function applyLang() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-list]').forEach((el) => {
      el.innerHTML = t(el.dataset.i18nList).split('|').map((x) => `<li>${esc(x)}</li>`).join('');
    });
    const b = $('#langBtn'); if (b) b.textContent = lang === 'he' ? 'English' : 'עברית';
  }

  // ---- API ----------------------------------------------------------------
  let accessToken = null;
  async function api(method, url, body, retry = true) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'livex-web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error('network'), { code: 'NETWORK' });
    }
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && retry && url !== '/api/auth/refresh' && await refresh()) return api(method, url, body, false);
    if (!res.ok) throw Object.assign(new Error(json.message || 'Error'), { code: json.error, status: res.status, data: json });
    return json;
  }
  async function refresh() {
    try {
      const r = await api('POST', '/api/auth/refresh', {}, false);
      accessToken = r.accessToken; return r.user;
    } catch { accessToken = null; return null; }
  }
  const errText = (e) => (lang === 'he' && ERR_HE[e.code]) || e.message || String(e);
  function show(el, kind, text) { el.className = `msg show ${kind}`; el.textContent = text; }
  const hashParam = (k) => new URLSearchParams(location.hash.slice(1)).get(k);
  function bindForm(id, fn) {
    const f = $(id); if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = f.querySelector('button[type=submit]'); const msg = f.querySelector('.msg');
      btn.disabled = true;
      try { await fn(Object.fromEntries(new FormData(f)), msg); } catch (e) { show(msg, 'err', errText(e)); } finally { btn.disabled = false; }
    });
  }

  async function initNav() {
    const user = await refresh();
    document.querySelectorAll('[data-auth=in]').forEach((el) => el.classList.toggle('hidden', !user));
    document.querySelectorAll('[data-auth=out]').forEach((el) => el.classList.toggle('hidden', !!user));
    const lo = $('#logoutLink');
    if (lo) lo.addEventListener('click', async (e) => { e.preventDefault(); await api('POST', '/api/auth/logout', {}).catch(() => {}); accessToken = null; location.href = '/index.html'; });
    return user;
  }

  // ---- pages ----------------------------------------------------------------
  const pages = {
    async home(user) {
      let data;
      try { data = await api('GET', '/api/products'); } catch (e) { return; }
      document.querySelectorAll('[data-product]').forEach((card) => {
        const p = data.products.find((x) => x.code === card.dataset.product);
        if (p) $('.price', card).innerHTML = `₪${esc(p.price)} <small>/ ${lang === 'he' ? 'רישיון' : 'license'}</small>`;
        const btn = $('button', card);
        btn.addEventListener('click', async () => {
          const msg = $('.msg', card);
          if (!user) { location.href = `/login.html#next=${encodeURIComponent('/index.html#pricing')}`; return; }
          if (!data.available) { show(msg, 'err', t('payments_unavailable')); return; }
          btn.disabled = true; show(msg, 'info', t('redirecting'));
          try { const r = await api('POST', '/api/shop/checkout', { product: p.code }); location.href = r.checkoutUrl; } catch (e) { show(msg, 'err', errText(e)); btn.disabled = false; }
        });
      });
      try {
        const rel = await api('GET', '/api/updates/latest?current=0.0.0');
        const dl = $('#downloadBtn');
        if (rel.available) { dl.href = rel.manifest.url; dl.classList.remove('hidden'); $('#dlInfo').textContent = `v${rel.manifest.version}`; } else $('#dlInfo').textContent = t('no_release');
      } catch { /* ignore */ }
    },
    register() {
      bindForm('#registerForm', async (v, msg) => {
        const r = await api('POST', '/api/auth/register', v);
        show(msg, 'ok', t('registered') + r.user.userId + (r.verificationEmail === 'queued_dev_outbox' ? t('dev_outbox') : ''));
        if (r.devMailbox) { const a = document.createElement('a'); a.href = '/mailbox.html'; a.className = 'btn primary'; a.style.marginTop = '10px'; a.textContent = t('mb_open'); msg.append(document.createElement('br'), a); }
        $('#registerForm').reset();
      });
    },
    login(user) {
      const next = hashParam('next');
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/account.html';
      if (user) { location.href = safeNext; return; }
      bindForm('#loginForm', async (v) => {
        let r;
        try { r = await api('POST', '/api/auth/login', { ...v, client: 'web' }); } catch (e) {
          if (e.data && e.data.devMailbox) { e.message = `${errText(e)} — ${t('mb_open')}: ${location.origin}/mailbox.html`; e.code = null; }
          throw e;
        }
        accessToken = r.accessToken; location.href = safeNext;
      });
    },
    async verify() {
      const msg = $('#verifyMsg'); show(msg, 'info', t('verifying'));
      try { await api('POST', '/api/auth/verify-email', { token: hashParam('token') }); show(msg, 'ok', t('verified')); history.replaceState(null, '', location.pathname); } catch (e) { show(msg, 'err', errText(e)); }
    },
    forgot() { bindForm('#forgotForm', async (v, msg) => { await api('POST', '/api/auth/forgot', v); show(msg, 'ok', t('reset_sent')); }); },
    reset() {
      bindForm('#resetForm', async (v, msg) => {
        await api('POST', '/api/auth/reset', { token: hashParam('token'), password: v.password });
        show(msg, 'ok', t('reset_done')); history.replaceState(null, '', location.pathname);
      });
    },
    async account(user) {
      if (!user) { location.href = '/login.html#next=/account.html'; return; }
      await renderAccount();
      const paid = new URLSearchParams(location.search).get('paid');
      if (paid) show($('#accountMsg'), 'info', t('paid_ok'));
    },
    async transfer(user) {
      const msg = $('#transferMsg');
      if (!user) { location.href = `/login.html#next=${encodeURIComponent(`/transfer.html${location.hash}`)}`; return; }
      show(msg, 'info', t('transferring'));
      try { await api('POST', '/api/account/transfer/confirm', { token: hashParam('token') }); show(msg, 'ok', t('transfer_done')); history.replaceState(null, '', location.pathname); } catch (e) { show(msg, 'err', errText(e)); }
    },
    async mailbox() {
      const box = $('#mailbox'); const filter = $('#mbFilter');
      filter.placeholder = t('mb_filter');
      const linkify = (txt) => esc(txt).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/(LVX(?:-[A-Z0-9]{4}){5})/g, '<span class="code-box u-fs16">$1</span>');
      let all = [];
      const render = () => {
        const q = filter.value.trim().toLowerCase();
        const list = all.filter((m) => !q || m.to.toLowerCase().includes(q));
        box.innerHTML = list.length ? list.map((m) => `<div class="card"><div class="muted u-fs13">${esc(fmtDate(Date.parse(m.at)))} · <span class="mono">${esc(m.to)}</span></div><h3 class="u-my6">${esc(m.subject)}</h3><div class="u-pre">${linkify(m.text)}</div></div>`).join('') : `<p class="muted">${t('mb_empty')}</p>`;
      };
      try { all = (await api('GET', '/api/dev/mailbox')).messages; } catch (e) { box.innerHTML = `<div class="msg show err">${esc(errText(e))}</div>`; return; }
      filter.addEventListener('input', render); render();
      setInterval(async () => { try { all = (await api('GET', '/api/dev/mailbox')).messages; render(); } catch { /* ignore */ } }, 5000);
    },
    async checkout(user) {
      if (!user) { location.href = `/login.html#next=${encodeURIComponent(`/checkout-sandbox.html${location.hash}`)}`; return; }
      const orderId = hashParam('order');
      const msg = $('#checkoutMsg');
      try {
        const { order } = await api('GET', `/api/shop/orders/${encodeURIComponent(orderId)}`);
        $('#orderInfo').innerHTML = `<dl class="kv"><dt>Order</dt><dd class="mono">${esc(order.id)}</dd><dt>${t('product')}</dt><dd>${esc(order.product_code)}</dd><dt>${t('amount')}</dt><dd>₪${(order.amount_agorot / 100).toFixed(2)}</dd><dt>${t('status')}</dt><dd><span class="badge ${esc(order.status)}">${esc(st(order.status))}</span></dd></dl>`;
        const btn = $('#payBtn');
        if (order.status !== 'pending') btn.disabled = true;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try { await api('POST', '/api/payments/sandbox/complete', { orderId }); location.href = `/account.html?paid=${encodeURIComponent(orderId)}`; } catch (e) { show(msg, 'err', errText(e)); btn.disabled = false; }
        });
      } catch (e) { show(msg, 'err', errText(e)); }
    },
  };

  async function renderAccount() {
    const a = await api('GET', '/api/account');
    const u = a.user;
    $('#profile').innerHTML = `<dl class="kv"><dt>${t('user_id')}</dt><dd class="mono">${esc(u.userId)}</dd><dt>${t('first_name')}</dt><dd>${esc(u.firstName)}</dd><dt>${t('last_name')}</dt><dd>${esc(u.lastName)}</dd><dt>${t('email')}</dt><dd>${esc(u.email)}</dd></dl>`;
    $('#licenses').innerHTML = a.licenses.length ? a.licenses.map((l) => {
      const ac = l.activationCode;
      let codeHtml = '';
      if (ac && ac.code) codeHtml = `<p class="muted">${t('activation_code')}</p><div class="code-box">${esc(ac.code)}</div><p class="muted u-fs12">⏳ ${fmtDate(ac.expiresAt)}</p>`;
      else if (ac && ac.status === 'used') codeHtml = `<p class="muted">✓ ${t('code_used')} — ${fmtDate(ac.usedAt)}</p>`;
      else if (ac && ac.status === 'expired') codeHtml = `<p class="msg show err">${t('code_expired')}</p>`;
      return `<div class="card"><h3 class="u-mt0">${esc(l.product === 'BUNDLE' ? 'LiveX COMPLETE BUNDLE' : `LiveX ${l.product}`)} <span class="badge ${esc(l.status)}">${esc(st(l.status))}</span></h3>
        <dl class="kv"><dt>${t('holder')}</dt><dd>${esc(l.holderName)}</dd><dt>${t('user_id')}</dt><dd class="mono">${esc(l.userId)}</dd><dt>${t('email')}</dt><dd>${esc(l.email)}</dd>
        <dt>${t('license_id')}</dt><dd class="mono">${esc(l.licenseId)}</dd><dt>${t('personal_code')}</dt><dd class="mono">${esc(l.personalCode)}</dd>
        <dt>${t('purchased')}</dt><dd>${fmtDate(l.purchasedAt)}</dd><dt>${t('activated')}</dt><dd>${fmtDate(l.activatedAt)}</dd>
        <dt>${t('device')}</dt><dd>${l.device ? `${esc(l.device.name)} <span class="mono muted">${esc(l.device.deviceId)}</span>` : '—'}</dd></dl>${codeHtml}</div>`;
    }).join('') : `<p class="muted">${t('no_licenses')} <a href="/index.html#pricing">${t('pricing')}</a></p>`;
    $('#devices').innerHTML = a.devices.length ? `<table><tr><th>${t('device')}</th><th>${t('os')}</th><th>${t('license_id')}</th><th>${t('activated')}</th><th>${t('last_seen')}</th><th>${t('status')}</th><th></th></tr>${a.devices.map((d) => `<tr><td>${esc(d.name)}<div class="mono muted u-fs11">${esc(d.deviceId)}</div></td><td>${esc(d.os)}</td><td class="mono">${esc(d.licenseId)}</td><td>${fmtDate(d.activatedAt)}</td><td>${fmtDate(d.lastSeenAt)}</td><td><span class="badge ${esc(d.status)}">${esc(st(d.status))}</span></td><td>${d.status === 'active' ? `<button class="btn danger" data-transfer="${esc(d.deviceId)}">${t('transfer')}</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">—</p>';
    $('#orders').innerHTML = a.orders.length ? `<table><tr><th>Order</th><th>${t('product')}</th><th>${t('amount')}</th><th>${t('status')}</th><th>${t('date')}</th></tr>${a.orders.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td>${esc(o.product_code)}</td><td>₪${(o.amount_agorot / 100).toFixed(2)}</td><td><span class="badge ${esc(o.status)}">${esc(st(o.status))}</span></td><td>${fmtDate(o.created_at)}</td></tr>`).join('')}</table>` : '<p class="muted">—</p>';
    document.querySelectorAll('[data-transfer]').forEach((b) => b.addEventListener('click', async () => {
      const pw = window.prompt(t('transfer_prompt'));
      if (!pw) return;
      const msg = $('#accountMsg');
      try {
        const r = await api('POST', `/api/account/devices/${encodeURIComponent(b.dataset.transfer)}/transfer`, { password: pw });
        show(msg, 'ok', t('transfer_sent') + (r.confirmationEmail === 'queued_dev_outbox' ? t('dev_outbox') : ''));
      } catch (e) { show(msg, 'err', errText(e)); }
    }));
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!localStorage.getItem('lvx_lang')) lang = (navigator.language || 'en').startsWith('he') ? 'he' : 'en';
    applyLang();
    $('#langBtn')?.addEventListener('click', () => { lang = lang === 'he' ? 'en' : 'he'; localStorage.setItem('lvx_lang', lang); location.reload(); });
    const user = await initNav();
    const page = document.body.dataset.page;
    if (pages[page]) await pages[page](user);
  });
})();
