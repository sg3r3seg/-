'use strict';
// Giveaway winner's private chat page. The winner proves who they are with the
// platform's official sign-in; the server then sets an HttpOnly cookie for this room.
(() => {
  const T = {
    en: {
      claim_title: 'You won "{title}"!', claim_text: '{host} wants to talk with you privately about your prize. Confirm that it\'s you with the {platform} account you used in the live chat.',
      verify: 'Sign in with {platform}', p_private: 'Private: only you and {host} see this chat. It is not shown on the stream.',
      p_check: 'LiveX checks that the account you sign in with is the one that won.', p_nopass: 'Your password stays with {platform}. LiveX never sees it.',
      chat_title: 'Private chat with {host}', chat_sub: '{title} · {platform}', locked: '🔒 Private', send: 'Send', placeholder: 'Write a message…',
      empty: 'No messages yet. Say hi! 👋', you: 'You', closed_t: 'This chat was closed', closed_x: 'The creator closed this private chat. Its messages were deleted.',
      taken_t: 'Already confirmed', taken_x: 'The winner already opened this private chat on another browser.',
      nf_t: 'Link not valid', nf_x: 'This private chat link does not exist or has expired.',
      notcfg: '{platform} sign-in is not set up on the LiveX server yet. Ask the creator for another way to get in touch.',
      e_NOT_WINNER: 'The account you signed in with is not the account that won. Sign in with the account you used in the live chat.',
      e_ACCESS_DENIED: 'Sign-in was cancelled.', e_FLOW_EXPIRED: 'The sign-in took too long. Try again.', e_EXCHANGE_FAILED: 'The platform did not complete the sign-in. Try again.',
      e_ALREADY_VERIFIED: 'The winner already confirmed this chat.', e_ROOM_CLOSED: 'This chat was closed.', e_default: 'Something went wrong. Try again.',
      ok_verified: '✓ Confirmed! You can now chat privately.', e_send: 'Could not send the message.',
    },
    he: {
      claim_title: 'זכית ב״{title}״!', claim_text: '{host} רוצה לדבר איתך באופן פרטי על הפרס. אשרו שזה אתם עם חשבון ה-{platform} שאיתו כתבתם בצ׳אט של השידור.',
      verify: 'התחברות עם {platform}', p_private: 'פרטי: רק אתם ו-{host} רואים את הצ׳אט הזה. הוא לא מוצג בשידור.',
      p_check: 'LiveX בודקת שהחשבון שאיתו התחברתם הוא החשבון שזכה.', p_nopass: 'הסיסמה נשארת אצל {platform}. LiveX לא רואה אותה.',
      chat_title: 'צ׳אט פרטי עם {host}', chat_sub: '{title} · {platform}', locked: '🔒 פרטי', send: 'שליחה', placeholder: 'כתבו הודעה…',
      empty: 'אין עדיין הודעות. תגידו שלום! 👋', you: 'את/ה', closed_t: 'הצ׳אט נסגר', closed_x: 'היוצר/ת סגר/ה את הצ׳אט הפרטי וההודעות נמחקו.',
      taken_t: 'כבר אושר', taken_x: 'הזוכה כבר פתח/ה את הצ׳אט הפרטי בדפדפן אחר.',
      nf_t: 'הקישור לא תקף', nf_x: 'הקישור לצ׳אט הפרטי לא קיים או שפג תוקפו.',
      notcfg: 'ההתחברות עם {platform} עוד לא הוגדרה בשרת LiveX. בקשו מהיוצר/ת דרך אחרת ליצור קשר.',
      e_NOT_WINNER: 'החשבון שאיתו התחברתם הוא לא החשבון שזכה. התחברו עם החשבון שאיתו כתבתם בצ׳אט של השידור.',
      e_ACCESS_DENIED: 'ההתחברות בוטלה.', e_FLOW_EXPIRED: 'ההתחברות לקחה יותר מדי זמן. נסו שוב.', e_EXCHANGE_FAILED: 'הפלטפורמה לא השלימה את ההתחברות. נסו שוב.',
      e_ALREADY_VERIFIED: 'הזוכה כבר אישר/ה את הצ׳אט הזה.', e_ROOM_CLOSED: 'הצ׳אט נסגר.', e_default: 'משהו השתבש. נסו שוב.',
      ok_verified: '✓ אושר! עכשיו אפשר לדבר בפרטיות.', e_send: 'לא ניתן לשלוח את ההודעה.',
    },
  };
  let lang = localStorage.getItem('lvx_lang') || ((navigator.language || '').startsWith('he') ? 'he' : 'en');
  const $ = (id) => document.getElementById(id);
  const code = location.pathname.split('/').filter(Boolean)[1] || '';
  const qs = new URLSearchParams(location.search);
  let info = null; let lastId = 0; let poll = null; const seen = new Set();
  const t = (k, v = {}) => (T[lang][k] || T.en[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  const vars = () => ({ title: info?.title, host: info?.host, platform: info?.platformLabel });
  const show = (id) => ['loading', 'claim', 'chat', 'state'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
  const msg = (id, kind, text) => { const el = $(id); el.className = `msg show ${kind}`; el.textContent = text; };
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || 'Error'), { code: j.error, status: r.status });
    return j;
  }
  function state(icon, title, text) { $('stateIcon').textContent = icon; $('stateTitle').textContent = title; $('stateText').textContent = text; show('state'); }
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' }); }
  function addMsgs(list) {
    const box = $('msgs');
    if (list.length && box.querySelector('.win-empty')) box.innerHTML = '';
    for (const m of list) {
      if (seen.has(m.id)) continue; seen.add(m.id); lastId = Math.max(lastId, m.id);
      const el = document.createElement('div'); el.className = `win-msg ${m.from === 'winner' ? 'me' : 'them'}`;
      const who = document.createElement('div'); who.className = 'win-who'; who.textContent = `${m.from === 'winner' ? t('you') : info.host} · ${fmtTime(m.at)}`;
      const b = document.createElement('div'); b.className = 'win-bubble'; b.textContent = m.text; // text only, never HTML
      el.append(who, b); box.append(el);
    }
    box.scrollTop = box.scrollHeight;
  }
  async function refresh() {
    try { addMsgs((await api('GET', `/api/winner/${code}/messages?after=${lastId}`)).messages); } catch (e) {
      if (e.code === 'ROOM_CLOSED') { clearInterval(poll); state('🔒', t('closed_t'), t('closed_x')); }
    }
  }
  function render() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    $('langBtn').textContent = lang === 'he' ? 'English' : 'עברית';
    if (!info) return;
    const v = vars();
    $('claimTitle').textContent = t('claim_title', v); $('claimText').textContent = t('claim_text', v); $('verifyBtn').textContent = t('verify', v);
    $('pPrivate').textContent = t('p_private', v); $('pCheck').textContent = t('p_check', v); $('pNoPass').textContent = t('p_nopass', v);
    $('chatTitle').textContent = t('chat_title', v); $('chatSub').textContent = t('chat_sub', v); $('lockBadge').textContent = t('locked');
    $('sendBtn').textContent = t('send'); $('text').placeholder = t('placeholder');
    if (!$('msgs').children.length || $('msgs').querySelector('.win-empty')) {
      const empty = document.createElement('div'); empty.className = 'win-empty muted'; empty.textContent = t('empty');
      $('msgs').replaceChildren(empty);
    }
  }
  async function load() {
    try { info = await api('GET', `/api/winner/${code}`); } catch { render(); return state('🔗', t('nf_t'), t('nf_x')); }
    render();
    if (info.status === 'closed') return state('🔒', t('closed_t'), t('closed_x'));
    if (info.you) {
      show('chat'); if (qs.get('ok')) { msg('chatMsg', 'ok', t('ok_verified')); history.replaceState(null, '', location.pathname); }
      await refresh(); clearInterval(poll); poll = setInterval(refresh, 3000); return;
    }
    if (info.status === 'verified') return state('✅', t('taken_t'), t('taken_x'));
    show('claim');
    if (!info.signInReady) { $('verifyBtn').disabled = true; msg('claimMsg', 'info', t('notcfg', vars())); }
    const e = qs.get('e');
    if (e) { msg('claimMsg', 'err', T[lang][`e_${e}`] || t('e_default')); history.replaceState(null, '', location.pathname); }
  }
  $('verifyBtn').addEventListener('click', async () => {
    $('verifyBtn').disabled = true;
    try { location.href = (await api('POST', `/api/winner/${code}/verify`)).authorizeUrl; } catch (e) { $('verifyBtn').disabled = false; msg('claimMsg', 'err', T[lang][`e_${e.code}`] || e.message || t('e_default')); }
  });
  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const text = $('text').value.trim(); if (!text) return;
    $('sendBtn').disabled = true;
    try { addMsgs([(await api('POST', `/api/winner/${code}/messages`, { text })).message]); $('text').value = ''; $('chatMsg').className = 'msg'; } catch (e) { msg('chatMsg', 'err', e.code === 'ROOM_CLOSED' ? t('closed_x') : t('e_send')); } finally { $('sendBtn').disabled = false; $('text').focus(); }
  });
  $('langBtn').addEventListener('click', () => { lang = lang === 'he' ? 'en' : 'he'; try { localStorage.setItem('lvx_lang', lang); } catch { /* ignore */ } render(); });
  load();
})();
