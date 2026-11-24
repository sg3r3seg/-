'use strict';
// E2E: Social Accounts (official OAuth) in the real Electron app + real LiveX server +
// a stand-in OAuth provider (server/test/oauth-mock.js). Linux: run under xvfb-run.
//   npm run test:e2e-oauth
// The stand-in "system browser" is a fake xdg-open placed first on PATH that records the
// URL; the test then follows it in a separate Chromium, like the user would.
const { _electron: electron, chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REPO = path.resolve(__dirname, '../../..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'livex-oauth-e2e-'));
const BIN = path.join(WORK, 'bin'); fs.mkdirSync(BIN);
fs.writeFileSync(path.join(BIN, 'xdg-open'), `#!/bin/sh\necho "$1" >> ${path.join(WORK, 'opened.txt')}\n`, { mode: 0o755 });
const { spawn } = require('node:child_process');
const { createMock } = require(path.join(REPO, 'server/test/oauth-mock.js'));
const BASE = 'http://127.0.0.1:8788';
const DATA = path.join(WORK, 'data'); fs.mkdirSync(DATA);
const SHOTS = process.env.SHOTS || path.join(WORK, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const res = []; const ok = (c, cond, d = '') => { res.push({ c, s: cond ? 'PASS' : 'FAIL', d }); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${c}${d ? ` :: ${String(d).slice(0, 200)}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(m, u, b, t) { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }
const mail = (to, tag) => fs.readdirSync(`${DATA}/outbox`).sort().map((f) => JSON.parse(fs.readFileSync(`${DATA}/outbox/${f}`, 'utf8'))).filter((x) => x.to === to && x.tag === tag).pop();
let server; let mock;
async function startServer() {
  server = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(REPO, 'server'), env: { ...process.env, ...mock.env(), DATA_DIR: DATA, ADMIN_TOKEN: 'a'.repeat(40), PORT: '8788', PUBLIC_URL: BASE, RATE_LIMIT_MULTIPLIER: '20' }, stdio: ['ignore', fs.openSync(`${DATA}/server.log`, 'a'), fs.openSync(`${DATA}/server.log`, 'a')] });
  for (let i = 0; i < 60; i++) { if (await fetch(`${BASE}/api/health`).then(() => true).catch(() => false)) return; await sleep(200); }
  throw new Error('server did not start');
}
let browser; const opened = [];
// Real app without a debugger on the main process: Electron is started directly with a
// renderer DevTools port, and the "system browser" is a stand-in xdg-open that records the URL.
let procs = [];
async function launch(ud, viaPlaywright = false) {
  if (viaPlaywright) {
    const app = await electron.launch({ executablePath: require(path.join(REPO, 'app/node_modules/electron')), args: [path.join(REPO, 'app'), '--no-sandbox'], env: { ...process.env, LIVEX_API_BASE: BASE, XDG_CONFIG_HOME: ud, LIVEX_TEST_PLAINTEXT_STORAGE: '1' } });
    const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
    return { app, win, errs, close: () => app.close(), inv: (ch, ...a) => win.evaluate(([c, args]) => window.livex.invoke(c, ...args), [ch, a]) };
  }
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(require(path.join(REPO, 'app/node_modules/electron')), [path.join(REPO, 'app'), '--no-sandbox', `--remote-debugging-port=${port}`], { env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, LIVEX_API_BASE: BASE, XDG_CONFIG_HOME: ud, LIVEX_TEST_PLAINTEXT_STORAGE: '1' }, stdio: 'ignore' });
  procs.push(proc);
  let cdp;
  for (let i = 0; i < 80 && !cdp; i++) { await sleep(250); cdp = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null); }
  let win;
  for (let i = 0; i < 80 && !win; i++) { win = cdp.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith('devtools')); if (!win) await sleep(250); }
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  const close = async () => { await cdp.close().catch(() => {}); proc.kill(); await new Promise((r) => proc.once('exit', r)); };
  return { win, errs, close, inv: (ch, ...a) => win.evaluate(([c, args]) => window.livex.invoke(c, ...args), [ch, a]) };
}
const OPENED = path.join(WORK, 'opened.txt'); let seen = 0;
async function takeOpened() { for (let i = 0; i < 60; i++) { const l = fs.existsSync(OPENED) ? fs.readFileSync(OPENED, 'utf8').split('\n').filter(Boolean) : []; if (l.length > seen) { seen += 1; return l[seen - 1]; } await sleep(150); } return null; }
async function userBrowser(url) { const p = await browser.newPage(); await p.goto(url); const txt = await p.textContent('body'); await p.close(); return txt; }
async function card(win, label) { return win.locator('.sa-card', { hasText: label }); }
async function waitStatus(win, label, re, ms = 12000) { const c = await card(win, label); const t0 = Date.now(); while (Date.now() - t0 < ms) { const b = await c.locator('.sa-head .badge').textContent(); const t = await c.textContent(); if (re.test(b) || (re.source.includes('cancel') || re.source.includes('complete')) && re.test(t)) return `[${b}] ${t}`; await sleep(250); } return `[${await c.locator('.sa-head .badge').textContent()}] ${await c.textContent()}`; }

(async () => {
  mock = await createMock().listen(); await startServer(); browser = await chromium.launch();
  const email = `oauth-${Date.now()}@qa.livex`; const password = 'Str0ngPass1';
  await api('POST', '/api/auth/register', { firstName: 'Shay', lastName: 'QA', email, password });
  await api('POST', '/api/auth/verify-email', { token: /#token=([\w-]+)/.exec(mail(email, 'verify').text)[1] });
  const ud = fs.mkdtempSync(path.join(WORK, 'ud-'));
  let A = await launch(ud);
  await A.win.waitForSelector('.auth-card', { timeout: 20000 });
  await A.win.fill('input[name=email]', email); await A.win.fill('input[name=password]', password); await A.win.click('button[type=submit]');
  await A.win.waitForSelector('.shell', { timeout: 15000 });
  await A.win.click('.nav-item[data-view=social]'); await A.win.waitForSelector('.sa-card');
  ok('Social Accounts screen lists all 5 platforms', (await A.win.$$('.sa-card')).length === 5);
  ok('All start Disconnected', (await A.win.textContent('.sa-grid')).match(/Disconnected/g)?.length === 5);
  await A.win.screenshot({ path: `${SHOTS}/1-empty.png` });

  // 1. New account connect (Twitch)
  let c = await card(A.win, 'Twitch'); await c.locator('button:has-text("Connect")').click();
  ok('Connect shows "waiting for sign-in"', /Waiting for sign-in/.test(await waitStatus(A.win, 'Twitch', /Waiting/)));
  let url = await takeOpened();
  ok('Connect opens the official authorize URL in the system browser', url && url.includes('/twitch/authorize') && url.includes('state=') && !url.includes('secret'), url);
  const page = await userBrowser(url);
  ok('Browser lands on LiveX success page after approval', /connected|חובר/i.test(page), page.slice(0, 120));
  let t = await waitStatus(A.win, 'Twitch', /Connected/);
  ok('Twitch shows Connected with username', /^\[Connected\]/.test(t) && /ShayLive/.test(t), t);
  ok('Avatar shown (profile picture, or the platform badge if the picture cannot load)', (await c.locator('.sa-avatar').count()) === 1);
  ok('Last connection date shown', !/Connected on\s*—/.test(t));
  await A.win.screenshot({ path: `${SHOTS}/2-twitch-connected.png` });

  // Tokens never reach renderer / logs; stored encrypted per user
  const list = await A.inv('social:list'); const js = JSON.stringify(list);
  ok('Renderer never receives access/refresh tokens', !/at-twitch|rt-twitch|accessToken|refreshToken/.test(js));
  const logs = fs.readFileSync(`${DATA}/server.log`, 'utf8');
  ok('Server log has no tokens', !/at-twitch-|rt-twitch-/.test(logs));
  const dbRaw = fs.readFileSync(`${DATA}/livex.db`).toString('latin1') + (fs.existsSync(`${DATA}/livex.db-wal`) ? fs.readFileSync(`${DATA}/livex.db-wal`).toString('latin1') : '');
  ok('Server DB keeps no plaintext tokens after hand-off', !/at-twitch-\d|rt-twitch-\d/.test(dbRaw));

  // 2. Other platforms incl. PKCE (YouTube / Kick) and Discord webhook
  for (const [label, prov, name] of [['YouTube', 'google', 'Shay Live'], ['Kick', 'kick', 'shaykick'], ['Discord', 'discord', 'Shay'], ['TikTok', 'tiktok', 'Shay TikTok']]) {
    await (await card(A.win, label)).locator('button:has-text("Connect")').click();
    const u = await takeOpened(); await userBrowser(u);
    const tt = await waitStatus(A.win, label, /Connected/);
    ok(`${label} connect via OAuth (${prov}${['google', 'kick'].includes(prov) ? ', PKCE' : ''})`, /^\[Connected\]/.test(tt) && tt.includes(name), tt.slice(0, 90));
  }

  // 3. Cancel the sign-in window (user denies)
  await (await card(A.win, 'Twitch')).locator('button:has-text("Disconnect")').click();
  await A.win.click('.modal button.danger, .modal button:has-text("OK"), .modal button:has-text("Confirm")').catch(() => {});
  t = await waitStatus(A.win, 'Twitch', /Disconnected/);
  ok('Disconnect removes account', /Disconnected/.test(t));
  ok('Disconnect revokes access at the platform', mock.revoked.some((r) => r.prov === 'twitch'), JSON.stringify(mock.revoked.map((r) => r.prov)));
  mock.mode = 'deny';
  await (await card(A.win, 'Twitch')).locator('button:has-text("Connect")').click();
  await userBrowser(await takeOpened());
  t = await waitStatus(A.win, 'Twitch', /cancelled/i);
  ok('Denying permissions in the browser → "Sign-in was cancelled", stays Disconnected', /cancelled/i.test(t) && /Disconnected/.test(t), t);
  mock.mode = 'allow';
  // 4. Closing the window without finishing → Cancel button in app
  await (await card(A.win, 'Twitch')).locator('button:has-text("Connect")').click(); await takeOpened();
  await waitStatus(A.win, 'Twitch', /Waiting/);
  await (await card(A.win, 'Twitch')).locator('button:has-text("Cancel")').click();
  t = await waitStatus(A.win, 'Twitch', /cancelled/i);
  ok('Cancelling a pending sign-in in the app', /cancelled/i.test(t) && /Disconnected/.test(t), t);
  // 5. Provider failure (token exchange error)
  mock.tokenMode = 'fail';
  await (await card(A.win, 'Twitch')).locator('button:has-text("Connect")').click();
  const failPage = await userBrowser(await takeOpened());
  t = await waitStatus(A.win, 'Twitch', /did not complete/);
  ok('Sign-in failure is reported clearly (app + browser page)', /did not complete/.test(t) && /fail|נכשל|could not/i.test(failPage), t);
  mock.tokenMode = 'ok';
  // 6. Reconnect (existing account)
  await (await card(A.win, 'Twitch')).locator('button:has-text("Connect")').click(); await userBrowser(await takeOpened());
  await waitStatus(A.win, 'Twitch', /Connected/);
  await (await card(A.win, 'Twitch')).locator('button:has-text("Reconnect")').click(); await userBrowser(await takeOpened());
  t = await waitStatus(A.win, 'Twitch', /Connected/);
  ok('Reconnect an existing account', /^\[Connected\]/.test(t) && /ShayLive/.test(t), t);
  // 7. Replayed callback (used state) is refused
  const replay = await userBrowser(url);
  ok('Replaying an old sign-in link is refused', /used|expired|invalid|כבר|פג/i.test(replay), replay.slice(0, 100));

  // 8. Persistence after restart
  await A.close(); A = await launch(ud);
  await A.win.waitForSelector('.shell', { timeout: 20000 });
  await A.win.click('.nav-item[data-view=social]'); await A.win.waitForSelector('.sa-card');
  const after = await A.win.textContent('.sa-grid');
  ok('Connections kept after app restart', (await A.win.$$eval('.sa-head .badge.ok', (e) => e.length)) === 5 && /ShayLive/.test(after), after.slice(0, 200));
  await A.win.screenshot({ path: `${SHOTS}/3-after-restart.png` });

  // 9. Token expiry → refresh, then revoked refresh → Reconnect needed
  await A.close(); A = await launch(ud, true);
  await A.win.waitForSelector('.shell', { timeout: 20000 });
  await A.win.click('.nav-item[data-view=social]'); await A.win.waitForSelector('.sa-card');
  const MAIN = path.join(REPO, 'app/src/main');
  const expire = (p) => A.app.evaluate(async (_e, [p2, dir]) => { const m = process.mainModule; const secure = m.require(`${dir}/secure.js`); const social = m.require(`${dir}/social.js`); const k = social.key(p2); secure.set(k, { ...secure.get(k), expiresAt: Date.now() - 1000 }); return social.accessToken(p2); }, [p, MAIN]);
  const tok = await expire('twitch');
  ok('Expired access token is refreshed automatically', typeof tok === 'string' && /^at-twitch-r/.test(tok));
  mock.refreshMode = 'revoked';
  const tok2 = await expire('twitch');
  t = await waitStatus(A.win, 'Twitch', /Reconnect needed/);
  ok('Revoked/expired permission → "Reconnect needed"', tok2 === null && /Reconnect needed/.test(t), t);
  await A.win.screenshot({ path: `${SHOTS}/4-reconnect-needed.png` });
  mock.refreshMode = 'ok';
  await A.close(); A = await launch(ud);
  await A.win.waitForSelector('.shell', { timeout: 20000 });
  await A.win.click('.nav-item[data-view=social]'); await A.win.waitForSelector('.sa-card');
  ok('"Reconnect needed" state survives restart', /Reconnect needed/.test(await (await card(A.win, 'Twitch')).textContent()));
  await (await card(A.win, 'Twitch')).locator('button:has-text("Reconnect")').click(); await userBrowser(await takeOpened());
  t = await waitStatus(A.win, 'Twitch', /Connected/);
  ok('Reconnect after permission expiry', /^\[Connected\]/.test(t));

  // 10. Another LiveX user on the same PC does not see these accounts
  await A.inv('session:logout');
  const e2 = `oauth2-${Date.now()}@qa.livex`;
  await api('POST', '/api/auth/register', { firstName: 'Ron', lastName: 'QA', email: e2, password });
  await api('POST', '/api/auth/verify-email', { token: /#token=([\w-]+)/.exec(mail(e2, 'verify').text)[1] });
  await A.win.waitForSelector('.auth-card', { timeout: 20000 });
  await A.win.fill('input[name=email]', e2); await A.win.fill('input[name=password]', password); await A.win.click('button[type=submit]');
  await A.win.waitForSelector('.shell', { timeout: 15000 });
  const l2 = await A.inv('social:list');
  ok('Second LiveX user on same PC sees no connected accounts', l2.ok !== false && (l2.data || l2).every((x) => x.status === 'disconnected'), JSON.stringify(l2).slice(0, 160));

  // Hebrew (RTL) + narrow window rendering of the Social Accounts screen
  await A.inv('session:logout'); await A.win.waitForSelector('.auth-card', { timeout: 20000 });
  await A.win.fill('input[name=email]', email); await A.win.fill('input[name=password]', password); await A.win.click('button[type=submit]');
  await A.win.waitForSelector('.shell', { timeout: 15000 });
  await A.inv('settings:set', { language: 'he' }); await A.win.evaluate(() => location.reload()); await A.win.waitForSelector('.shell', { timeout: 20000 });
  await A.win.click('.nav-item[data-view=social]'); await A.win.waitForSelector('.sa-card');
  await sleep(800);
  const heTxt = await A.win.textContent('.view');
  ok('Hebrew: screen title and statuses translated, page is RTL', /חשבונות רשתות/.test(heTxt) && /מחובר/.test(heTxt) && (await A.win.evaluate(() => document.documentElement.dir)) === 'rtl');
  await A.win.screenshot({ path: `${SHOTS}/5-hebrew.png` });
  await A.win.setViewportSize({ width: 820, height: 760 }).catch(() => {});
  await sleep(400);
  const overflow = await A.win.evaluate(() => [...document.querySelectorAll('.sa-card')].some((c) => c.scrollWidth > c.clientWidth + 1));
  ok('Narrow window: cards reflow without overflow', !overflow);
  await A.win.screenshot({ path: `${SHOTS}/6-narrow.png` });
  ok('No renderer errors', A.errs.length === 0, A.errs.join(' | '));
  await A.close(); await browser.close(); server.kill(); mock.server.close();
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify(res, null, 1));
  const pass = res.filter((r) => r.s === 'PASS').length;
  console.log(`\n${pass}/${res.length} PASS  (screenshots: ${SHOTS})`);
  process.exit(pass === res.length ? 0 : 1);
})().catch(async (e) => { console.error('FATAL', e); try { server.kill(); } catch {} procs.forEach((p) => p.kill()); try { mock.server.close(); } catch {} process.exit(1); });
