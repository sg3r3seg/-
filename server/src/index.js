'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

// Optional log file (used by the Windows test kit) so problems can be diagnosed later.
if (process.env.LIVEX_LOG_FILE) {
  try {
    fs.mkdirSync(path.dirname(process.env.LIVEX_LOG_FILE), { recursive: true });
    const out = fs.createWriteStream(process.env.LIVEX_LOG_FILE, { flags: 'a' });
    for (const level of ['log', 'warn', 'error']) {
      const orig = console[level].bind(console);
      console[level] = (...a) => { orig(...a); out.write(`${new Date().toISOString()} [${level}] ${a.map(String).join(' ')}\n`); };
    }
  } catch { /* logging is best effort */ }
}

const url = `http://127.0.0.1:${config.port}`;
function openBrowser() {
  if (process.env.LIVEX_OPEN_BROWSER !== '1') return;
  const { spawn } = require('node:child_process');
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* the user can open the address manually */ }
}

function fatal(lines) {
  console.error(`\n  ${'!'.repeat(60)}`);
  for (const l of lines) console.error(`  ${l}`);
  console.error(`  ${'!'.repeat(60)}\n`);
  process.exitCode = 1;
}

let db; let server;
try {
  require('./crypto').keys(); // fail fast if key material is missing
  const d = require('./db');
  d.open();
  db = d; // only set once the database really opened
} catch (e) {
  if (/Missing key/.test(e.message)) fatal(['The server keys are missing (folder "keys").', 'Copy the "keys" folder from your LiveX kit next to the "src" folder.', e.message]);
  else if (e.code === 'EACCES' || e.code === 'EPERM' || /readonly|unable to open/i.test(e.message)) fatal(['LiveX cannot write its data folder here:', config.dataDir, 'Move the whole LiveX folder somewhere you own, for example C:\\LiveX-Test-Kit or your Desktop,', 'not inside "Program Files" or a read-only / synced folder.', `(${e.message})`]);
  else fatal(['The server could not start:', e.stack || e.message]);
}

if (db) {
  const { createApp } = require('./app');
  // Express 5 also calls this callback with the error when listening fails; errors are handled below.
  server = createApp().listen(config.port, config.host, (err) => {
    if (err) return;
    console.log(`LiveX server listening on ${url} (public URL ${config.publicUrl})`);
    console.log(`Payments provider: ${config.payments.provider}${config.smtp.host ? '' : ' | Email: dev outbox (SMTP not configured)'}`);
    console.log('READY — you can now open LiveX and sign in.');
    openBrowser();
  });
  server.on('error', async (e) => {
    if (e.code !== 'EADDRINUSE') { fatal(['The server could not start:', e.message]); return; }
    // Something already listens on the port: is it LiveX?
    const isLiveX = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).then((j) => j.service === 'livex').catch(() => false);
    if (isLiveX) {
      console.log(`\n  The LiveX server is ALREADY RUNNING at ${url} (in another window).`);
      console.log('  Nothing to do — you can use LiveX. This window can be closed.\n');
      openBrowser();
    } else {
      fatal([`Port ${config.port} is used by another program.`, 'Close that program or restart the computer, then start the LiveX server again.']);
    }
    db.close();
  });
}
const stop = () => (server ? server.close(() => { db.close(); process.exit(0); }) : process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
