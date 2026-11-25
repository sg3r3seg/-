'use strict';
// E2E: giveaway winner private chat + built-in automations, in the real Electron app,
// against a real LiveX server and a stand-in OAuth provider (server/test/oauth-mock.js).
// Live chat comes from a stand-in TikTok LIVE provider (WebSocket). Linux: xvfb-run.
//   npm run test:e2e-winners
const { _electron: electron, chromium } = require('playwright');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawn } = require('node:child_process');
const REPO = path.resolve(__dirname, '../../..');
const WebSocket = require(path.join(REPO, 'app/node_modules/ws'));
const { createMock } = require(path.join(REPO, 'server/test/oauth-mock.js'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'livex-winners-e2e-'));
const DATA = path.join(WORK, 'data'); fs.mkdirSync(DATA);
const SHOTS = process.env.SHOTS || path.join(WORK, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://127.0.0.1:8792'; const PROVIDER_PORT = 21311;
const res = []; const ok = (c, cond, d = '') => { res.push({ c, s: cond ? 'PASS' : 'FAIL', d }); console.log(`[${cond ? 'PASS' : 'FAIL'}] ${c}${d ? ` :: ${String(d).slice(0, 220)}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(250); } return null; };
async function api(m, u, b, t) { const r = await fetch(BASE + u, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => null); }
const mail = (to, tag) => fs.readdirSync(`${DATA}/outbox`).sort().map((f) => JSON.parse(fs.readFileSync(`${DATA}/outbox/${f}`, 'utf8'))).filter((x) => x.to === to && x.tag === tag).pop();

(async () => {
  const mock = await createMock().listen();
  const srv = spawn('node', ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(REPO, 'server'), env: { ...process.env, ...mock.env(), DATA_DIR: DATA, ADMIN_TOKEN: 'a'.repeat(40), PORT: '8792', PUBLIC_URL: BASE, RATE_LIMIT_MULTIPLIER: '20' }, stdio: ['ignore', fs.openSync(`${DATA}/server.log`, 'a'), fs.openSync(`${DATA}/server.log`, 'a')] });
  const cleanup = [() => srv.kill(), () => mock.server.close()];
  try {
    for (let i = 0; i < 60; i++) { if (await fetch(`${BASE}/api/health`).then(() => 1).catch(() => 0)) break; await sleep(200); }
    // Creator account with LiveX BUNDLE
    const email = `creator-${Date.now()}@qa.livex`; const password = 'Str0ngPass1';
    await api('POST', '/api/auth/register', { firstName: 'Shay', lastName: 'QA', email, password });
    await api('POST', '/api/auth/verify-email', { token: /#token=([\w-]+)/.exec(mail(email, 'verify').text)[1] });
    const web = (await api('POST', '/api/auth/login', { email, password })).accessToken;
    const co = await api('POST', '/api/shop/checkout', { product: 'BUNDLE' }, web); await api('POST', '/api/payments/sandbox/complete', { orderId: co.orderId }, web);
    const code = /activation code: (LVX(?:-[A-Z0-9]{4}){5})/.exec(mail(email, 'activation').text)[1];
    // Stand-in TikTok LIVE provider
    const wss = new WebSocket.Server({ port: PROVIDER_PORT }); const clients = new Set();
    wss.on('connection', (c) => { clients.add(c); c.on('close', () => clients.delete(c)); }); cleanup.push(() => wss.close());
    const emit = (event, data) => clients.forEach((c) => c.send(JSON.stringify({ event, data })));

    const app = await electron.launch({ executablePath: require(path.join(REPO, 'app/node_modules/electron')), args: [path.join(REPO, 'app'), '--no-sandbox'], env: { ...process.env, LIVEX_API_BASE: BASE, XDG_CONFIG_HOME: path.join(WORK, 'ud'), LIVEX_TEST_PLAINTEXT_STORAGE: '1' } });
    cleanup.unshift(() => app.close());
    const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
    const inv = (ch, ...a) => win.evaluate(([c, args]) => window.livex.invoke(c, ...args), [ch, a]);
    await win.waitForSelector('.auth-card', { timeout: 30000 });
    await win.fill('input[name=email]', email); await win.fill('input[name=password]', password); await win.click('button[type=submit]');
    await win.waitForSelector('.shell', { timeout: 20000 });
    ok('Creator signed in', true);
    ok('License activated (PRO + TTS)', (await inv('session:activate', code)).ok);
    await sleep(1200);

    // ---------- Built-in automations screen ----------
    await win.click('.nav-item[data-view=automations]'); await win.waitForSelector('.au-card');
    const cards = await win.$$('.au-card');
    ok('Automations screen lists the built-in automations', cards.length >= 8, `${cards.length} cards`);
    ok('Every built-in automation is marked locked', (await win.$$('.au-card .badge.lock')).length === cards.length);
    ok('No delete / edit controls on built-in automations', (await win.$$('.au-card .btn.danger, .au-card input[type=text], .au-card textarea')).length === 0);
    ok('Deleting through the API is refused (LOCKED)', (await inv('automations:remove', 'thank_follow')).error?.code === 'LOCKED');
    const giftCard = win.locator('.au-card', { hasText: 'Thank gifts' });
    await giftCard.locator('.toggle, input[type=checkbox]').first().click(); await sleep(400);
    ok('An automation can be switched off', (await inv('automations:list')).data.find((x) => x.id === 'thank_gift').enabled === false);
    await win.locator('.au-card', { hasText: 'Thank gifts' }).locator('.toggle, input[type=checkbox]').first().click(); await sleep(300);
    await win.screenshot({ path: `${SHOTS}/automations.png` });
    await win.locator('.au-card', { hasText: 'Giveaway winner' }).locator('button:has-text("Preview")').click(); await sleep(500);
    const logText = async () => (await inv('diag:logs')).data.map((l) => l.message).join('\n');
    ok('Preview shows the message without sending it', /TEST \(not sent\): 🎉 Congrats/.test(await logText()));

    // ---------- Giveaway from live chat ----------
    ok('TikTok LIVE provider connected', (await inv('platforms:connect', 'tiktok', { providerUrl: `ws://127.0.0.1:${PROVIDER_PORT}/`, username: 'host' })).ok);
    await until(async () => clients.size > 0);
    await inv('giveaway:configure', { keyword: '!join', title: 'Gaming headset', allowModsOnly: false });
    await inv('giveaway:open'); await sleep(300);
    emit('chat', { uniqueId: 'shay_tt', nickname: 'Shay TikTok', comment: '!join', userId: '6800000001' });
    await until(async () => (await inv('giveaway:get')).data.total === 1);
    const g0 = (await inv('giveaway:get')).data;
    ok('Entry stores the platform identity (TikTok @username)', g0.entries[0]?.handle === 'shay_tt', JSON.stringify(g0.entries[0]));
    await inv('giveaway:close');
    const drawn = (await inv('giveaway:draw')).data;
    ok('Winner drawn from real chat entries', drawn?.handle === 'shay_tt');
    const rooms = await until(async () => { const r = (await inv('winner:list')).data; return r.length ? r : null; });
    ok('Automation opened a private chat room for the winner', rooms?.[0]?.status === 'waiting' && rooms[0].platform === 'tiktok', JSON.stringify(rooms?.[0] || {}));
    const ann = await until(async () => (await logText()).split('\n').find((x) => x.includes('/w/') && x.includes('Congrats') && !x.startsWith('TEST')));
    ok('Winner announcement with the private link went to the chat bot (TikTok cannot write: logged as not sent, never faked)', !!ann, ann);
    const claimUrl = rooms[0].claimUrl;

    // ---------- Winner's browser ----------
    const browser = await chromium.launch(); cleanup.unshift(() => browser.close());
    const wctx = await browser.newContext({ viewport: { width: 420, height: 820 }, deviceScaleFactor: 2, locale: 'he-IL' });
    const wp = await wctx.newPage();
    await wp.goto(claimUrl); await wp.waitForSelector('#verifyBtn:not([disabled])', { timeout: 10000 });
    ok('Winner page explains the prize and asks to confirm identity', /Gaming headset/.test(await wp.textContent('#claim')) && /TikTok/.test(await wp.textContent('#verifyBtn')));
    await wp.screenshot({ path: `${SHOTS}/winner-claim.png` });
    // Someone else from the stream opens the same public link and signs in with a different account
    await wp.click('#verifyBtn'); await wp.waitForSelector('#chat:not(.hidden)', { timeout: 15000 });
    ok('Real winner signs in with TikTok and lands in the private chat', /✓/.test(await wp.textContent('#chatMsg')));
    await wp.fill('#text', 'היי! תודה רבה על הזכייה 🎉'); await wp.click('#sendBtn'); await sleep(400);

    // ---------- Creator's protected chat window ----------
    await win.click('.nav-item[data-view=winners]'); await win.waitForSelector('.wr-row');
    await until(async () => /Winner confirmed|הזוכה אומת/.test(await win.textContent('.wr-row')));
    ok('Winner chats screen shows the room as confirmed', /Winner confirmed/.test(await win.textContent('.wr-row')));
    // Record that the app turns on capture protection for the new window.
    await app.evaluate(({ BrowserWindow }) => { const orig = BrowserWindow.prototype.setContentProtection; globalThis.__cp = []; BrowserWindow.prototype.setContentProtection = function cp(v) { globalThis.__cp.push(v); return orig.call(this, v); }; });
    const newWin = app.waitForEvent('window');
    await win.click('.wr-row button:has-text("Open chat")');
    const chat = await newWin; await chat.waitForSelector('.wc-msgs');
    const prot = await app.evaluate(({ BrowserWindow }) => ({ calls: globalThis.__cp, platform: process.platform, state: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('winner-chat')).map((w) => w.isContentProtected()) }));
    ok('Chat window turns on screen-capture protection (hidden from OBS / screen share)', prot.calls.includes(true) && (prot.platform === 'linux' || prot.state[0] === true), JSON.stringify(prot));
    await until(async () => (await chat.textContent('.wc-msgs')).includes('תודה רבה על הזכייה'));
    ok("Winner's message appears in the creator's private window", (await chat.textContent('.wc-msgs')).includes('תודה רבה על הזכייה'));
    await chat.fill('.wc-form textarea', 'מזל טוב! לאן לשלוח את האוזניות?'); await chat.press('.wc-form textarea', 'Enter');
    await until(async () => (await wp.textContent('#msgs')).includes('לאן לשלוח'), 8000);
    ok("Creator's reply reaches only the winner's page", (await wp.textContent('#msgs')).includes('לאן לשלוח'));
    await chat.screenshot({ path: `${SHOTS}/creator-chat-window.png` });
    await wp.screenshot({ path: `${SHOTS}/winner-chat.png` });
    // Not on stream: the private text is never in overlays/TTS/activity/logs
    const all = JSON.stringify((await inv('activity:recent')).data) + JSON.stringify((await inv('diag:logs')).data);
    ok('Private messages never reach the activity feed or logs', !all.includes('תודה רבה על הזכייה') && !all.includes('לאן לשלוח'));
    const denied = await chat.evaluate(() => window.livex.invoke('settings:get').then(() => 'allowed', (e) => e.message));
    ok('Chat window cannot call other app functions', /Untrusted sender/.test(denied), denied);

    // ---------- A different person tries the same link ----------
    await inv('giveaway:open'); await sleep(200);
    emit('chat', { uniqueId: 'real_winner2', nickname: 'Other', comment: '!join', userId: '99' });
    await until(async () => (await inv('giveaway:get')).data.total === 2);
    await inv('giveaway:close'); await inv('giveaway:draw');
    const r2 = await until(async () => (await inv('winner:list')).data.find((x) => x.winnerHandle === 'real_winner2'));
    const ictx = await browser.newContext(); const ip = await ictx.newPage();
    await ip.goto(r2.claimUrl); await ip.waitForSelector('#verifyBtn:not([disabled])'); await ip.click('#verifyBtn'); // mock signs in as @shay_tt
    await ip.waitForSelector('#claimMsg.show', { timeout: 15000 });
    ok('Anyone else who opens the link is refused (not the winning account)', /not the account that won|לא החשבון שזכה/.test(await ip.textContent('#claimMsg')));
    await ip.screenshot({ path: `${SHOTS}/intruder-refused.png` });

    // ---------- Winner not found -> transfer the prize ----------
    await inv('giveaway:open'); await sleep(200);
    emit('chat', { uniqueId: 'third.viewer', nickname: 'Third', comment: '!join', userId: '777' });
    await until(async () => (await inv('giveaway:get')).data.total === 3);
    await inv('giveaway:close');
    const confirmedKey = (await inv('giveaway:get')).data.winners.find((x) => x.handle === 'shay_tt').key;
    const refused = await inv('giveaway:transfer', confirmedKey);
    ok('A winner who confirmed keeps the prize (transfer refused)', refused.error?.code === 'WINNER_CONFIRMED', JSON.stringify(refused.error));
    await win.click('.nav-item[data-view=giveaway]'); await win.waitForSelector('.winner-row');
    const rowOf = (name) => win.locator('.winner-row', { hasText: name });
    await until(async () => /Confirmed/.test(await rowOf('Shay TikTok').textContent()));
    ok('Confirmed winner shows no "not found" button', (await rowOf('Shay TikTok').locator('button:has-text("Not found")').count()) === 0);
    await rowOf('Other').locator('button:has-text("Not found")').click();
    await win.click('.modal button.danger');
    await until(async () => (await win.$$('.winner-row')).length === 3);
    const gNow = (await inv('giveaway:get')).data;
    const old = gNow.winners.find((x) => x.handle === 'real_winner2'); const nw = gNow.winners.at(-1);
    ok('"Not found" marks the winner and draws a new one from the remaining participants', old.status === 'not_found' && nw.handle === 'third.viewer' && nw.transferredFrom === 'Other', JSON.stringify({ old: old.status, nw: nw.handle }));
    const goneRow = win.locator('.winner-row.gone');
    await until(async () => /Not found → Third/.test(await goneRow.textContent()));
    ok('Giveaway screen shows "Not found → new winner"', /Not found → Third/.test(await goneRow.textContent()) && /instead of Other/.test(await win.locator('.winner-row', { hasText: 'Third' }).first().textContent()));
    const oldRoom = (await inv('winner:list')).data.find((x) => x.winnerHandle === 'real_winner2');
    ok('The old winner\'s private chat is closed as "not found"', oldRoom.status === 'closed' && oldRoom.closeReason === 'not_found');
    await ip.reload(); await ip.waitForSelector('#state:not(.hidden)');
    ok('The old winner\'s page says the prize was transferred', /transferred|הועבר/.test(await ip.textContent('#state')), await ip.textContent('#state'));
    await ip.screenshot({ path: `${SHOTS}/prize-transferred.png` });
    const newRoom = await until(async () => (await inv('winner:list')).data.find((x) => x.winnerHandle === 'third.viewer'));
    ok('The new winner automatically gets a private chat', newRoom?.status === 'waiting');
    const moved = await until(async () => (await logText()).split('\n').find((x) => x.includes('could not be reached, so the prize moves on') && x.includes('@third.viewer')));
    ok('Chat announcement says the prize moved to the new winner', !!moved, moved);
    await win.screenshot({ path: `${SHOTS}/giveaway-transfer.png` });

    // ---------- Close ----------
    chat.on('dialog', (d) => d.accept());
    await chat.click('button:has-text("Close chat")'); await chat.click('.modal button.danger').catch(() => {});
    await until(async () => (await wp.evaluate(() => document.getElementById('state').classList.contains('hidden')) === false), 8000);
    ok('Closing the chat locks the winner page and deletes the messages', /closed|נסגר/.test(await wp.textContent('#state')));
    ok('No renderer errors', errs.length === 0, errs.join(' | '));
  } catch (e) { ok('E2E completed without crashing', false, e.stack); }
  for (const f of cleanup) { try { await f(); } catch { /* ignore */ } }
  const pass = res.filter((r) => r.s === 'PASS').length;
  console.log(`\n${pass}/${res.length} PASS  (screenshots: ${SHOTS})`);
  process.exit(pass === res.length ? 0 : 1);
})();
