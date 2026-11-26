'use strict';
// E2E: ElevenLabs voices in the real Electron app (Voice Studio) against a real LiveX server
// and a stand-in ElevenLabs API (server/test/elevenlabs-mock.js). Linux: xvfb-run.
//   npm run test:e2e-elevenlabs
const { _electron: electron } = require('playwright');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawn } = require('node:child_process');
const REPO = path.resolve(__dirname, '../../..');
const { createXiMock } = require(path.join(REPO, 'server/test/elevenlabs-mock.js'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'livex-xi-e2e-'));
const DATA = path.join(WORK, 'data'); fs.mkdirSync(DATA);
const SHOTS = process.env.SHOTS || path.join(WORK, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://127.0.0.1:8794';
const KEY = 'k-e2eCreatorKey123456789wxyz';
const res = []; const ok = (c, cond, d = '') => { res.push({ c, s: cond ? 'PASS' : 'FAIL' }); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${c}${d ? ` :: ${String(d).slice(0, 220)}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(250); } return null; };
async function api(m, u, b, t) { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => null); }
const mail = (to, tag) => fs.readdirSync(`${DATA}/outbox`).sort().map((f) => JSON.parse(fs.readFileSync(`${DATA}/outbox/${f}`, 'utf8'))).filter((x) => x.to === to && x.tag === tag).pop();

(async () => {
  const xi = await createXiMock().listen();
  const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(REPO, 'server'), env: { ...process.env, ELEVENLABS_API_URL: `http://127.0.0.1:${xi.port}`, ELEVENLABS_API_KEY: '', DATA_DIR: DATA, ADMIN_TOKEN: 'a'.repeat(40), PORT: '8794', PUBLIC_URL: BASE, RATE_LIMIT_MULTIPLIER: '20' }, stdio: ['ignore', fs.openSync(`${DATA}/server.log`, 'a'), fs.openSync(`${DATA}/server.log`, 'a')] });
  const cleanup = [() => srv.kill(), () => xi.server.close()];
  try {
    for (let i = 0; i < 60; i++) { if (await fetch(`${BASE}/api/health`).then(() => 1).catch(() => 0)) break; await sleep(200); }
    const email = `voice-${Date.now()}@qa.livex`; const password = 'Str0ngPass1';
    await api('POST', '/api/auth/register', { firstName: 'Shay', lastName: 'QA', email, password });
    await api('POST', '/api/auth/verify-email', { token: /#token=([\w-]+)/.exec(mail(email, 'verify').text)[1] });
    const web = (await api('POST', '/api/auth/login', { email, password })).accessToken;
    const co = await api('POST', '/api/shop/checkout', { product: 'BUNDLE' }, web); await api('POST', '/api/payments/sandbox/complete', { orderId: co.orderId }, web);
    const code = /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(mail(email, 'activation').text)[1];

    const app = await electron.launch({ executablePath: require(path.join(REPO, 'app/node_modules/electron')), args: [path.join(REPO, 'app'), '--no-sandbox'], env: { ...process.env, LIVEX_API_BASE: BASE, XDG_CONFIG_HOME: path.join(WORK, 'ud'), LIVEX_TEST_PLAINTEXT_STORAGE: '1' } });
    cleanup.unshift(() => app.close());
    const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
    const inv = (ch, ...a) => win.evaluate(([c, args]) => window.livex.invoke(c, ...args), [ch, a]);
    await win.waitForSelector('.auth-card', { timeout: 30000 });
    await inv('settings:set', { language: 'he' }); await win.evaluate(() => location.reload()); await win.waitForSelector('.auth-card', { timeout: 30000 });
    await win.fill('input[name=email]', email); await win.fill('input[name=password]', password); await win.click('button[type=submit]');
    await win.waitForSelector('.shell', { timeout: 20000 });
    await inv('session:activate', code); await sleep(1200);
    // Record what is played (no audio hardware here).
    await win.evaluate(() => { window.__played = []; const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function q() { window.__played.push(this.src); return p.call(this).catch(() => {}); }; });

    await win.click('.nav-item[data-view="voice-studio"]'); await win.waitForSelector('input[type=password]');
    const view = () => win.textContent('.view');
    ok('Voice Studio shows "connect ElevenLabs" with a link to the API keys page', /קולות ElevenLabs/.test(await view()) && (await win.$('a[href="https://elevenlabs.io/app/settings/api-keys"]')) !== null);
    ok('Creating a voice is disabled until ElevenLabs is connected', await win.$eval('button.btn.primary:has-text("יצירת קול")', (b) => b.disabled).catch(async () => (await win.locator('.card', { hasText: 'יצירת קול חדש ב-ElevenLabs' }).locator('button.primary').last().isDisabled())));
    // wrong key
    await win.fill('input[type=password]', 'zz-not-a-valid-key-1234567'); await win.click('button:has-text("חיבור ElevenLabs")');
    await until(async () => /לא קיבלה את מפתח/.test(await win.textContent('body')));
    ok('A wrong key shows a clear Hebrew error and does NOT sign out of LiveX', /לא קיבלה את מפתח/.test(await win.textContent('body')) && !!(await win.$('.shell')));
    // right key
    await win.fill('input[type=password]', KEY); await win.click('button:has-text("חיבור ElevenLabs")');
    await until(async () => /מחובר/.test(await win.textContent('.xi-acct')));
    ok('Connected: account name, plan and only the last 4 key characters shown', /Shay/.test(await win.textContent('.xi-acct')) && /creator/.test(await win.textContent('.xi-acct')) && /••••wxyz/.test(await win.textContent('.xi-acct')));
    const secureFile = fs.readFileSync(path.join(WORK, 'ud', 'LiveX', 'secure.bin')).toString('latin1');
    const settingsDir = path.join(WORK, 'ud', 'LiveX');
    const anyLocal = fs.readdirSync(settingsDir).filter((f) => { try { return fs.lstatSync(path.join(settingsDir, f)).isFile(); } catch { return false; } }).some((f) => fs.readFileSync(path.join(settingsDir, f)).toString('latin1').includes(KEY));
    ok('The API key is not stored on the computer (only on the server, encrypted)', !anyLocal && !secureFile.includes(KEY));
    // library
    await win.fill('input[placeholder^="חיפוש קולות"]', 'noa'); await win.click('button:has-text("חיפוש")');
    await win.waitForSelector('.xi-voice');
    ok('Library search (Hebrew) finds ElevenLabs voices with preview', /Noa — Hebrew narrator/.test(await win.textContent('.xi-lib')) && (await win.$('.xi-voice audio')) !== null);
    await win.click('.xi-voice button:has-text("הוספה לקולות שלי")');
    await until(async () => (await inv('tts:aiVoices')).data?.some((v) => v.name === 'Noa — Hebrew narrator'));
    ok('"Add to my voices" adds it to the ElevenLabs account and the voice list', (await inv('tts:aiVoices')).data.some((v) => v.name === 'Noa — Hebrew narrator'));
    await win.screenshot({ path: `${SHOTS}/voice-studio-elevenlabs.png`, fullPage: true });
    // profile with the new voice; model automatic -> Hebrew model
    const vid = (await inv('tts:aiVoices')).data.find((v) => v.name === 'Noa — Hebrew narrator').id;
    const prof = (await inv('tts:saveProfile', { name: 'נועה', engine: 'ai', aiVoiceId: vid, aiModelId: '', rate: 1, pitch: 1, volume: 1 })).data;
    const sp = await inv('tts:synthAi', { text: 'תודה רבה על המתנה!', voiceId: prof.aiVoiceId, modelId: prof.aiModelId });
    ok('Speaking Hebrew with the added voice uses the Hebrew-capable model of the account', sp.ok && xi.synth.at(-1).model === 'eleven_v3' && xi.synth.at(-1).key === KEY, JSON.stringify(xi.synth.at(-1)));
    await win.click('.nav-item[data-view="tts"]'); await sleep(600); await win.click('.nav-item[data-view="voice-studio"]'); await win.waitForSelector('.profile-item');
    await win.click('.profile-item:has-text("נועה")'); await sleep(300);
    ok('Profile editor offers the account\'s models, marking Hebrew', /Eleven v3 · עברית/.test(await win.textContent('.view')));
    // create a voice from an uploaded sample (same IPC the upload/record buttons use)
    const clone = await inv('tts:aiClone', { name: 'הקול שלי', voiceOwnerName: 'Shay', consentStatement: 'אני הבעלים של הקול ומאשר שימוש בו', consent: true, audioBase64: Buffer.alloc(30_000, 9).toString('base64'), mimeType: 'audio/mpeg' });
    ok('Uploading a sample creates the voice in the creator\'s ElevenLabs account', clone.ok && (await inv('tts:aiVoices')).data.some((v) => v.name === 'הקול שלי'), JSON.stringify(clone.error || ''));
    ok('Creating a voice without consent is refused', (await inv('tts:aiClone', { name: 'x', voiceOwnerName: 'y', consentStatement: 'z'.repeat(20), consent: false, audioBase64: 'AA==' })).error?.code === 'CONSENT_REQUIRED');
    // disconnect
    await win.click('.xi-acct button.danger'); await win.click('.modal button.danger');
    await until(async () => !!(await win.$('input[type=password]')));
    ok('Disconnect removes the connection', (await inv('tts:aiStatus')).data.account.connected === false);
    ok('No renderer errors', errs.length === 0, errs.join(' | '));
    const log = fs.readFileSync(`${DATA}/server.log`, 'utf8');
    ok('The API key never appears in server logs', !log.includes(KEY));
  } catch (e) { ok('E2E completed without crashing', false, e.stack); }
  for (const f of cleanup) { try { await f(); } catch { /* ignore */ } }
  const pass = res.filter((r) => r.s === 'PASS').length;
  console.log(`\n${pass}/${res.length} PASS  (screenshots: ${SHOTS})`);
  process.exit(pass === res.length ? 0 : 1);
})();
