import { t } from '../i18n.js';
import { h, call, card, badge, field, input, textarea, select, toggle, act, toast, toastErr, errText, empty, confirmBox, blobToB64, b64ToUrl, fmtTime } from '../ui.js';
import { icon } from '../icons.js';
import { speak } from '../players.js';

export async function outputDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return [{ value: 'default', label: t('default_device') }, ...list.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default').map((d, i) => ({ value: d.deviceId, label: d.label || `${t('audio_device')} ${i + 1}` }))];
  } catch { return [{ value: 'default', label: t('default_device') }]; }
}

export async function tts(root, app) {
  const data = await call('tts:get');
  let s = data.settings;
  const save = async (patch) => { try { s = await call('tts:saveSettings', patch); } catch (e) { toastErr(e); } };

  const queueEl = h('div', { class: 'queue' });
  const nowEl = h('div', { class: 'now-playing' });
  const pauseBtn = h('button', { class: 'btn' });
  function renderState(st) {
    nowEl.replaceChildren(st.current ? h('div', { class: 'np' }, h('span', { class: 'eq' }, h('i'), h('i'), h('i')), h('div', {}, h('b', {}, st.current.user || 'LiveX'), h('div', {}, st.current.text))) : h('span', { class: 'muted' }, st.paused ? t('tts_paused') : t('tts_idle')));
    pauseBtn.replaceChildren(h('span', { html: icon(st.paused ? 'play' : 'pause') }), st.paused ? t('resume') : t('pause'));
    pauseBtn.onclick = () => act(pauseBtn, async () => renderState(await call(st.paused ? 'tts:resume' : 'tts:pause')));
    queueEl.replaceChildren(...(st.queue.length ? st.queue.map((q) => h('div', { class: 'q-item' }, h('span', { class: 'feed-pf' }, q.platform), h('span', { class: 'grow' }, q.text), h('span', { class: 'feed-time' }, fmtTime(q.ts)), h('button', { class: 'icon-btn', title: t('remove'), html: icon('x', 14), onclick: async () => renderState(await call('tts:remove', q.id)) }))) : [empty(t('queue_empty'))]));
  }
  renderState(data.state);

  const sayInput = input({ placeholder: t('type_to_speak'), maxlength: 500 });
  const sayBtn = h('button', { class: 'btn primary' }, h('span', { html: icon('mic') }), t('speak'));
  const doSay = () => act(sayBtn, async () => { if (!sayInput.value.trim()) return; await call('tts:say', sayInput.value); sayInput.value = ''; });
  sayBtn.onclick = doSay; sayInput.onkeydown = (e) => { if (e.key === 'Enter') doSay(); };

  const devices = await outputDevices();
  const profiles = data.profiles;
  const blocked = textarea({ value: (s.blockedWords || []).join(', '), placeholder: t('blocked_words_ph') });
  blocked.onchange = () => save({ blockedWords: blocked.value });
  const maxLen = input({ type: 'number', min: 10, max: 500, value: s.maxLength }); maxLen.onchange = () => save({ maxLength: maxLen.value });

  root.append(
    h('div', { class: 'grid g2' },
      card(h('div', { class: 'row between' }, h('h3', {}, t('tts_player')), toggle(s.enabled, (v) => save({ enabled: v }), t('enabled'))),
        nowEl,
        h('div', { class: 'row' }, pauseBtn,
          h('button', { class: 'btn', onclick: (e) => act(e.target, async () => renderState(await call('tts:skip'))) }, h('span', { html: icon('skip') }), t('skip')),
          h('button', { class: 'btn danger', onclick: (e) => act(e.target, async () => renderState(await call('tts:clear'))) }, h('span', { html: icon('stop') }), t('stop_clear'))),
        h('div', { class: 'row' }, sayInput, sayBtn),
        h('h4', {}, t('queue')), queueEl),
      card(t('tts_sources'),
        h('div', { class: 'toggles' },
          toggle(s.readChat, (v) => save({ readChat: v }), t('read_chat')),
          toggle(s.readGifts, (v) => save({ readGifts: v }), t('read_gifts')),
          toggle(s.readSuperchats, (v) => save({ readSuperchats: v }), t('read_superchats')),
          toggle(s.readSubs, (v) => save({ readSubs: v }), t('read_subs')),
          toggle(s.readFollows, (v) => save({ readFollows: v }), t('read_follows')),
          toggle(s.readUsername, (v) => save({ readUsername: v }), t('read_username')),
          toggle(s.onlyMods, (v) => save({ onlyMods: v }), t('only_mods'))),
        h('p', { class: 'muted small' }, t('tts_events_note')),
        h('div', { class: 'grid g2' },
          field(t('voice_profile'), select(profiles.map((p) => ({ value: p.id, label: p.name })), s.activeProfileId, { onchange: (e) => save({ activeProfileId: e.target.value }) })),
          field(t('audio_output'), select(devices, s.outputDeviceId, { onchange: (e) => save({ outputDeviceId: e.target.value }) }))),
        h('button', { class: 'btn ghost sm', onclick: () => app.go('voice-studio') }, h('span', { html: icon('wave', 14) }), t('open_voice_studio')))),
    card(t('tts_filters'),
      h('div', { class: 'toggles' },
        toggle(s.filterProfanity, (v) => save({ filterProfanity: v }), t('filter_profanity')),
        toggle(s.skipCommands, (v) => save({ skipCommands: v }), t('skip_commands')),
        toggle(s.skipLinks, (v) => save({ skipLinks: v }), t('skip_links'))),
      h('div', { class: 'grid g3' },
        field(t('max_length'), maxLen),
        field(t('profanity_mode'), select([{ value: 'skip', label: t('mode_skip') }, { value: 'mask', label: t('mode_mask') }], s.profanityMode, { onchange: (e) => save({ profanityMode: e.target.value }) })),
        field(t('max_queue'), input({ type: 'number', min: 1, max: 200, value: s.maxQueue, onchange: (e) => save({ maxQueue: e.target.value }) }))),
      field(t('blocked_words'), blocked, t('blocked_words_hint'))),
    card(t('tts_overlay'), h('p', { class: 'muted' }, t('tts_overlay_hint')), h('button', { class: 'btn', onclick: () => app.go('overlay-center') }, h('span', { html: icon('layers') }), t('nav_overlay_center'))),
  );
  return window.livex.on('tts:state', renderState);
}

// ------------------------------------------------------------- Voice Studio --
export async function voiceStudio(root, app) {
  const data = await call('tts:get');
  let profiles = data.profiles;
  const isWin = app.info?.platform === 'win32';
  let systemVoices = [];
  try { systemVoices = isWin ? await call('tts:systemVoices') : speechSynthesis.getVoices().map((v) => ({ name: v.name, culture: v.lang })); } catch { systemVoices = []; }
  let ai = { configured: false, account: { connected: false } }; let aiVoices = []; let aiModels = []; let aiError = '';
  async function loadAi() {
    aiError = '';
    try {
      ai = await call('tts:aiStatus');
      aiVoices = ai.configured ? await call('tts:aiVoices') : [];
      aiModels = ai.configured ? await call('tts:aiModels').catch(() => []) : [];
    } catch (e) { aiError = errText(e); aiVoices = []; }
  }
  await loadAi();

  const listEl = h('div', { class: 'profile-list' });
  const editor = h('div');
  function renderList() {
    listEl.replaceChildren(...profiles.map((p) => h('button', { class: 'profile-item', onclick: () => edit(p) }, h('span', { html: icon(p.engine === 'ai' ? 'zap' : 'mic') }), h('span', { class: 'grow' }, p.name), badge(p.engine === 'ai' ? 'AI' : t('system_voice')))),
      h('button', { class: 'btn primary wide', onclick: () => edit({ name: t('new_profile'), engine: 'system', rate: 1, pitch: 1, volume: 1 }) }, h('span', { html: icon('plus') }), t('new_profile')));
  }
  function edit(p) {
    editor.dataset.profile = p.id || '';
    const name = input({ value: p.name, maxlength: 40 });
    const engine = select([{ value: 'system', label: t('system_voice') }, { value: 'ai', label: t('ai_voice') }], p.engine);
    const voiceSel = select([{ value: '', label: t('default_voice') }, ...systemVoices.map((v) => ({ value: v.name, label: `${v.name} (${v.culture})` }))], p.voice || '');
    const aiSel = select([{ value: '', label: '—' }, ...aiVoices.map((v) => ({ value: v.id, label: `${v.name}${v.category ? ` · ${v.category}` : ''}` }))], p.aiVoiceId || '');
    // Model: "automatic" picks, for Hebrew text, a model your ElevenLabs account reports as supporting Hebrew.
    const modelSel = select([{ value: '', label: t('xi_model_auto') }, ...aiModels.map((m) => ({ value: m.id, label: `${m.name}${m.hebrew ? ` · ${t('xi_hebrew')}` : ''}` }))], p.aiModelId || '');
    const slider = (val, min, max, step) => h('input', { type: 'range', class: 'range', min, max, step, value: val });
    const rate = slider(p.rate ?? 1, 0.5, 2, 0.05); const pitch = slider(p.pitch ?? 1, 0.5, 2, 0.05); const volume = slider(p.volume ?? 1, 0, 1, 0.05);
    const sample = input({ value: t('preview_sample'), maxlength: 200 });
    const sysField = field(t('system_voice'), voiceSel, systemVoices.length ? (isWin ? t('system_voices_hint') : '') : t('no_system_voices'));
    const aiField = h('div', { class: 'grid g2' }, field(t('ai_voice'), aiSel, ai.configured ? '' : (aiError || t('xi_connect_first'))), field(t('xi_model'), modelSel, t('xi_model_hint')));
    const sync = () => { sysField.style.display = engine.value === 'system' ? '' : 'none'; aiField.style.display = engine.value === 'ai' ? '' : 'none'; };
    engine.onchange = sync; sync();
    const current = () => ({ ...p, name: name.value, engine: engine.value, voice: voiceSel.value, aiVoiceId: aiSel.value, aiModelId: modelSel.value, rate: +rate.value, pitch: +pitch.value, volume: +volume.value });
    editor.replaceChildren(card(p.id ? `${t('edit_profile')}: ${p.name}` : t('new_profile'),
      h('div', { class: 'grid g2' }, field(t('profile_name'), name), field(t('voice_engine'), engine)), sysField, aiField,
      h('div', { class: 'grid g3' }, field(`${t('speed')}`, rate), field(t('pitch'), pitch), field(t('volume'), volume)),
      field(t('preview_text'), sample),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: (e) => act(e.target, () => speak(sample.value, current(), 'default')) }, h('span', { html: icon('play') }), t('preview')),
        h('button', { class: 'btn primary', onclick: (e) => act(e.target, async () => { const saved = await call('tts:saveProfile', current()); profiles = (await call('tts:get')).profiles; renderList(); edit(saved); }, t('saved')) }, h('span', { html: icon('check') }), t('save')),
        p.id && p.id !== 'default' ? h('button', { class: 'btn danger', onclick: async (e) => { if (!(await confirmBox(t('delete_profile_confirm'), true))) return; await act(e.target, async () => { profiles = await call('tts:deleteProfile', p.id); renderList(); editor.replaceChildren(); }); } }, h('span', { html: icon('trash') }), t('delete')) : null)));
  }

  // --- recording + cloning (with explicit consent) ---
  let recBlob = null; let recExt = '.webm'; let mediaRec = null;
  const recStatus = h('span', { class: 'muted small' }, t('no_recording'));
  const audioEl = h('audio', { controls: true, class: 'audio hidden' });
  const setRecording = (blob, ext) => { recBlob = blob; recExt = ext; audioEl.src = URL.createObjectURL(blob); audioEl.classList.remove('hidden'); recStatus.textContent = `${t('recording_ready')} (${Math.round(blob.size / 1024)} KB)`; };
  const recBtn = h('button', { class: 'btn' }, h('span', { html: icon('mic') }), t('record'));
  recBtn.onclick = async () => {
    if (mediaRec && mediaRec.state === 'recording') { mediaRec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = []; mediaRec = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRec.ondataavailable = (e) => chunks.push(e.data);
      mediaRec.onstop = () => { stream.getTracks().forEach((tr) => tr.stop()); setRecording(new Blob(chunks, { type: 'audio/webm' }), '.webm'); recBtn.replaceChildren(h('span', { html: icon('mic') }), t('record')); };
      mediaRec.start(); recBtn.replaceChildren(h('span', { html: icon('stop') }), t('stop_recording')); recStatus.textContent = t('recording');
    } catch (e) { toast(t('mic_denied'), 'err'); }
  };
  const importBtn = h('button', { class: 'btn', onclick: (e) => act(e.target, async () => { const f = await call('voice:importSample'); if (f) setRecording(await (await fetch(b64ToUrl(f.base64, 'audio/*'))).blob(), f.ext); }) }, h('span', { html: icon('upload') }), t('upload_recording'));
  const saveLocalBtn = h('button', { class: 'btn', onclick: (e) => act(e.target, async () => { if (!recBlob) throw new Error(t('no_recording')); await call('voice:saveSample', await blobToB64(recBlob), recExt); }, t('saved')) }, t('save_locally'));
  const cloneName = input({ placeholder: t('voice_name'), maxlength: 60 });
  const owner = input({ placeholder: t('voice_owner_name'), maxlength: 100 });
  const statement = textarea({ value: t('consent_statement_default'), maxlength: 1000 });
  const consent = h('input', { type: 'checkbox' });
  const cloneBtn = h('button', { class: 'btn primary', disabled: !ai.configured }, h('span', { html: icon('zap') }), t('create_ai_voice'));
  cloneBtn.onclick = () => act(cloneBtn, async () => {
    if (!recBlob) throw new Error(t('no_recording'));
    if (!consent.checked) throw new Error(t('consent_required'));
    const r = await call('tts:aiClone', { name: cloneName.value, voiceOwnerName: owner.value, consentStatement: statement.value, consent: true, audioBase64: await blobToB64(recBlob), mimeType: recBlob.type || 'audio/webm' });
    await call('tts:saveProfile', { name: cloneName.value || 'AI voice', engine: 'ai', aiVoiceId: r.voiceId, rate: 1, pitch: 1, volume: 1, consent: { owner: owner.value, at: Date.now() } });
    profiles = (await call('tts:get')).profiles; renderList(); await loadAi(); refreshAll();
  }, t('ai_voice_created'));

  // --- ElevenLabs account (connected in the app; key kept encrypted on the LiveX server) ---
  const xiCard = h('div');
  const libResults = h('div', { class: 'xi-lib' });
  function renderXi() {
    const a = ai.account || {};
    const keyInput = input({ type: 'password', placeholder: t('xi_key_placeholder'), autocomplete: 'off', spellcheck: 'false' });
    xiCard.replaceChildren(card(t('xi_title'),
      h('p', { class: 'muted small' }, t('xi_intro')),
      a.connected
        ? h('div', { class: 'row between xi-acct' },
          h('div', { class: 'row' }, badge(`✓ ${t('xi_connected')}`, 'ok'), h('b', {}, a.name || 'ElevenLabs'), a.tier ? badge(a.tier) : null, h('span', { class: 'muted small mono' }, `••••${a.keyHint}`)),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, async () => { await loadAi(); refreshAll(); }) }, h('span', { html: icon('refresh', 14) }), t('refresh')),
            h('button', { class: 'btn sm danger', onclick: async (e) => { if (!(await confirmBox(t('xi_disconnect_confirm'), true))) return; await act(e.currentTarget, async () => { await call('tts:aiDisconnect'); await loadAi(); refreshAll(); }); } }, t('disconnect'))))
        : h('div', { class: 'stack sm' },
          h('ol', { class: 'xi-steps small' }, ...t('xi_steps').split('|').map((x, i) => h('li', {}, i === 0 ? [x, ' ', h('a', { href: 'https://elevenlabs.io/app/settings/api-keys', target: '_blank', rel: 'noopener' }, 'elevenlabs.io/app/settings/api-keys')] : x))),
          field(t('xi_key'), keyInput),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: (e) => act(e.currentTarget, async () => { if (!keyInput.value.trim()) throw new Error(t('xi_key_missing')); await call('tts:aiConnect', keyInput.value.trim()); keyInput.value = ''; await loadAi(); refreshAll(); }, t('xi_connected_toast')) }, h('span', { html: icon('plug', 14) }), t('xi_connect'))),
          ai.via === 'livex' ? h('div', { class: 'msg show info small' }, t('xi_livex_fallback')) : null),
      aiError ? h('div', { class: 'msg show err' }, aiError) : null,
      a.connected ? h('div', { class: 'row between' }, h('span', { class: 'muted small' }, `${t('xi_voices_count')}: ${aiVoices.length}`),
        h('button', { class: 'btn sm', onclick: (e) => act(e.currentTarget, runDiag) }, h('span', { html: icon('stetho', 14) }), t('xi_diag'))) : null,
      diagEl));
  }
  // Connection test: each step with ElevenLabs' own answer (what works, what does not).
  const diagEl = h('div', { class: 'xi-diag' });
  async function runDiag() {
    diagEl.replaceChildren(h('div', { class: 'muted small' }, t('xi_diag_running')));
    const r = await call('tts:aiDiagnose');
    diagEl.replaceChildren(...r.steps.map((st) => h('div', { class: `xi-step ${st.ok ? 'ok' : 'err'}` },
      h('span', { class: 'xi-dot' }, st.ok ? '✓' : '✕'), h('b', {}, t(`xi_step_${st.id}`)),
      h('span', { class: 'muted small grow' }, st.ok ? st.detail : `${t(`err_${st.code}`) !== `err_${st.code}` ? t(`err_${st.code}`) : ''} ${st.detail || ''}${st.providerStatus ? ` (${st.providerStatus})` : ''}`))));
  }
  // Voice Library search (ElevenLabs community voices) -> "Add to my voices"
  const libSearch = input({ placeholder: t('xi_lib_search'), maxlength: 80 });
  const libLang = select([{ value: '', label: t('xi_any_language') }, { value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }, { value: 'ru', label: 'Русский' }, { value: 'es', label: 'Español' }], 'he');
  async function searchLib() {
    const r = await call('tts:aiLibrary', { search: libSearch.value.trim(), language: libLang.value });
    libResults.replaceChildren(...(r.voices.length ? r.voices.map((v) => h('div', { class: 'xi-voice' },
      h('div', { class: 'grow' }, h('b', {}, v.name), h('div', { class: 'muted small' }, [v.language, v.accent, v.gender, v.age, v.useCase].filter(Boolean).join(' · ')), v.description ? h('div', { class: 'small' }, v.description) : null),
      v.previewUrl ? h('audio', { controls: true, preload: 'none', src: v.previewUrl, class: 'xi-preview' }) : null,
      h('button', { class: 'btn sm primary', onclick: (e) => act(e.currentTarget, async () => { await call('tts:aiLibraryAdd', { publicOwnerId: v.publicOwnerId, voiceId: v.id, name: v.name.slice(0, 60) }); await loadAi(); refreshAll(); }, t('xi_added')) }, h('span', { html: icon('plus', 14) }), t('xi_add')))) : [empty(t('xi_lib_none'))]));
  }
  const libCard = h('div');
  function renderLib() {
    libCard.replaceChildren(ai.account?.connected ? card(t('xi_lib_title'), h('p', { class: 'muted small' }, t('xi_lib_hint')),
      h('div', { class: 'row' }, libSearch, libLang, h('button', { class: 'btn', onclick: (e) => act(e.currentTarget, searchLib) }, h('span', { html: icon('globe', 14) }), t('xi_lib_go'))), libResults) : '');
  }
  function refreshAll() {
    renderXi(); renderLib();
    cloneBtn.disabled = !ai.configured;
    cloneWarn.replaceChildren(ai.configured ? '' : h('div', { class: 'msg show warn' }, aiError || t('xi_connect_first')));
    const cur = profiles.find((x) => x.id === editor.dataset.profile) || profiles[0];
    edit(cur);
  }
  const cloneWarn = h('div');

  renderList();
  edit(profiles[0]);
  renderXi(); renderLib();
  cloneWarn.replaceChildren(ai.configured ? '' : h('div', { class: 'msg show warn' }, aiError || t('xi_connect_first')));
  root.append(
    xiCard,
    h('div', { class: 'grid g1-2' }, card(t('voice_profiles'), listEl), editor),
    card(t('custom_voice'),
      h('p', { class: 'muted' }, t('custom_voice_hint')),
      h('div', { class: 'row' }, recBtn, importBtn, saveLocalBtn, recStatus), audioEl,
      h('div', { class: 'grid g2' }, field(t('voice_name'), cloneName), field(t('voice_owner_name'), owner)),
      field(t('consent_statement'), statement),
      h('label', { class: 'consent' }, consent, h('span', {}, t('consent_checkbox'))),
      cloneWarn,
      cloneBtn),
    libCard,
  );
  return () => { if (mediaRec && mediaRec.state === 'recording') mediaRec.stop(); };
}
